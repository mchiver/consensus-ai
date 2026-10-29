'use strict';

// Windows - the window parts Desktop and Sidecar share (plan Sidecar Edition, Step 1, taken out of desktop/main.js):
// a window with no frame of its own and Electron's window buttons over the page's title bar (plan UI Components,
// Step 5), the detached tabs and the report windows it opens, the page asked before its window closes (plan Markdown
// Editor, Step 4), the title bar's colours from the page, the report's Print to PDF and View in Browser (plan Printing
// and Reporting), the folder dialog and the hidden menu that keeps the accelerators. Each app keeps its own state
// (its settings, its project); what a function needs of it is passed in.
//
//   Dark( Theme, DarkThemes )                 whether the theme is a dark one (System: the system's)
//   ApplyNativeTheme( Theme, DarkThemes )     the window's dialogs and native parts light or dark
//   Options( { Width, Height, Title, Icon, Theme, DarkThemes, Preload } )   a window's options
//   Attach( Window, { PageUrl, Icon, Preload, Options( Width, Height ), AsksPage( Url )?, OnClosed? } )
//                                             the main window's detached tabs, report windows and close; AsksPage says
//                                             which pages are asked before closing (every one when not given)
//   MenuTemplate( { NewWindow?, OpenFolderWindow?, Reload? } )   the menu's template, an item left out with its action
//   AttachChrome()                            the 'chrome' message: the window buttons follow the page's palette
//   PrintToPdf( Sender, Name, Folder )        the save dialog in Folder, then the page as a PDF: { Path } | { Cancelled } | { Error }
//   ViewInBrowser( Url, Roots )               the report at its root's own address, in the system browser: { Url } | { Error }
//   PickFolder( Owner, Current )              the folder dialog: the folder with forward slashes, or null
//   BuildMenu( { NewWindow, OpenFolderWindow, Reload } )   the menu (not shown; its accelerators are)

const FS = require( 'fs' );
const PATH = require( 'path' );
const ELECTRON = require( 'electron' );

const LIGHT_OVERLAY = { color: '#f8f9fa', symbolColor: '#212529', height: 35 };
const DARK_OVERLAY = { color: '#1e1e1e', symbolColor: '#e6e6e6', height: 35 };
const CLOSE_ANSWER_WAIT = 3000;		// the page's answer to a close, before the window closes anyway
const REPORT_PATH = /\/api\/plans\/[^/?#]+\/report(\.md)?(\?|#|$)/;


//---------------------------------------------------------------------
// The theme

function Dark( Theme, DarkThemes )
{
	if ( Theme === 'system' )
	{
		return ELECTRON.nativeTheme.shouldUseDarkColors;
	}
	return ( DarkThemes || [] ).includes( Theme );
}


// The window's dialogs and native parts follow the theme, light or dark (plan UI Tweaks IV); System follows the system.
function ApplyNativeTheme( Theme, DarkThemes )
{
	if ( Theme === 'system' )
	{
		ELECTRON.nativeTheme.themeSource = 'system';
		return;
	}
	ELECTRON.nativeTheme.themeSource = ( DarkThemes || [] ).includes( Theme ) ? 'dark' : 'light';
}


// A light or a dark pair of window buttons to open with; the page sends the palette's own colours and the bar's
// height once it is drawn (the chrome message).
function Overlay( Theme, DarkThemes )
{
	let dark = Dark( Theme, DarkThemes );
	return Object.assign( {}, dark ? DARK_OVERLAY : LIGHT_OVERLAY );
}


//---------------------------------------------------------------------
// The windows

function WebPreferences( Preload )
{
	return {
		preload: Preload,
		contextIsolation: true,
		nodeIntegration: false,
	};
}


// A window of the app: no frame, Electron's window buttons over the page's title bar.
function Options( Fields )
{
	let fields = Fields || {};
	return {
		width: fields.Width,
		height: fields.Height,
		title: fields.Title,
		icon: fields.Icon,
		titleBarStyle: 'hidden',
		titleBarOverlay: Overlay( fields.Theme, fields.DarkThemes ),
		webPreferences: WebPreferences( fields.Preload ),
	};
}


// A report page of the window's server, opened from the page: /api/plans/<id>/report, on the app's own origin.
function IsReportUrl( PageUrl, Url )
{
	return !!PageUrl && String( Url ).startsWith( PageUrl + '/' ) && REPORT_PATH.test( Url );
}


// The main window: a tab's Detach opens "?detached=1#/p/<id>" on the page's origin, which becomes a window of the app;
// a report opens in a plain framed window; any other address goes to the system browser. The window and each detached
// one ask their page before they close; Fields.AsksPage( url ), when given, says whether the page at that address is
// one to ask (the Desktop's chooser is not; plan Review 2026-10-29, Step 1), else every page is asked.
function Attach( Window, Fields )
{
	let fields = Fields || {};
	let asks_page = ( typeof fields.AsksPage === 'function' ) ? fields.AsksPage : null;
	let closing = false;
	Window.setMenuBarVisibility( false );
	Window.webContents.on( 'preload-error', function ( event, path, error )
	{
		console.error( 'preload error in ' + path + ': ' + ( error && error.stack || error ) );
	} );
	Window.webContents.setWindowOpenHandler( function ( details )
	{
		let page_url = fields.PageUrl();
		if ( IsReportUrl( page_url, details.url ) )
		{
			return { action: 'allow', overrideBrowserWindowOptions: { width: 1000, height: 800, title: 'Consensus report', icon: fields.Icon, titleBarStyle: 'default', titleBarOverlay: false, webPreferences: WebPreferences( fields.Preload ) } };
		}
		if ( page_url && details.url.startsWith( page_url + '/' ) )
		{
			return { action: 'allow', overrideBrowserWindowOptions: fields.Options( 1000, 800 ) };
		}
		ELECTRON.shell.openExternal( details.url );
		return { action: 'deny' };
	} );
	Window.webContents.on( 'did-create-window', function ( child, details )
	{
		child.setMenuBarVisibility( false );
		if ( details && IsReportUrl( fields.PageUrl(), details.url ) )
		{
			return;
		}
		// a detached window asks its page about its own draft, as the main window does
		child.on( 'close', function ( event )
		{
			event.preventDefault();
			AskToClose( child, function () { child.destroy(); }, asks_page );
		} );
	} );
	Window.on( 'close', function ( event )
	{
		if ( closing )
		{
			return;
		}
		event.preventDefault();
		AskToClose( Window, function ()
		{
			closing = true;
			Window.destroy();
		}, asks_page );
	} );
	Window.on( 'closed', function ()
	{
		if ( typeof fields.OnClosed === 'function' )
		{
			fields.OnClosed();
		}
	} );
}


// The page is asked before its window closes: close-requested goes to it, and it answers close-decided once its
// prompt about the unsaved edits is settled, or at once when nothing is dirty or Confirm on close is off; a page the
// app says not to ask (AsksPage( url ) false: the Desktop's chooser) is not asked; no answer within CLOSE_ANSWER_WAIT
// and the window closes anyway. Destroy closes it without another close event.
function AskToClose( Target, Destroy, AsksPage )
{
	let contents = Target.webContents;
	if ( Target.isDestroyed() || contents.isDestroyed() || ( typeof AsksPage === 'function' && !AsksPage( contents.getURL() ) ) )
	{
		Destroy();
		return;
	}
	let settled = false;
	let timer = null;
	function settle( ok )
	{
		if ( settled )
		{
			return;
		}
		settled = true;
		clearTimeout( timer );
		ELECTRON.ipcMain.removeListener( 'close-decided', on_decided );
		if ( ok && !Target.isDestroyed() )
		{
			Destroy();
		}
	}
	function on_decided( event, ok )
	{
		if ( event.sender === contents )
		{
			settle( !!ok );
		}
	}
	timer = setTimeout( function () { settle( true ); }, CLOSE_ANSWER_WAIT );
	ELECTRON.ipcMain.on( 'close-decided', on_decided );
	contents.send( 'close-requested' );
}


// The title bar's colours and height, from the page once its bar is drawn and after every change of theme or size:
// the window buttons follow the palette.
function AttachChrome()
{
	ELECTRON.ipcMain.on( 'chrome', function ( event, chrome )
	{
		let owner = ELECTRON.BrowserWindow.fromWebContents( event.sender );
		if ( !owner || !chrome )
		{
			return;
		}
		let overlay = {};
		if ( /^#[0-9a-f]{6}$/i.test( chrome.Color || '' ) )
		{
			overlay.color = chrome.Color;
		}
		if ( /^#[0-9a-f]{6}$/i.test( chrome.Symbol || '' ) )
		{
			overlay.symbolColor = chrome.Symbol;
		}
		let height = Number( chrome.Height );
		if ( height >= 24 && height <= 96 )
		{
			overlay.height = Math.round( height );
		}
		try
		{
			owner.setTitleBarOverlay( overlay );
		}
		catch ( error )
		{
			console.error( 'the title bar overlay was not set: ' + error.message );
		}
	} );
}


//---------------------------------------------------------------------
// The report window

// Print to PDF: the save dialog in Folder (the documents folder when none), then the page printed to that file.
function PrintToPdf( Sender, Name, Folder )
{
	return print_to_pdf( Sender, Name, Folder );
}


async function print_to_pdf( sender, name_given, folder_given )
{
	let owner = ELECTRON.BrowserWindow.fromWebContents( sender );
	let folder = ( typeof folder_given === 'string' && folder_given ) ? folder_given : ELECTRON.app.getPath( 'documents' );
	let name = String( name_given || 'report' ).replace( /[\\/:*?"<>|\u0000-\u001f]+/g, ' ' ).trim() || 'report';
	let picked = await ELECTRON.dialog.showSaveDialog( owner, { defaultPath: PATH.join( folder, name + '.pdf' ), filters: [ { name: 'PDF', extensions: [ 'pdf' ] } ] } );
	if ( picked.canceled || !picked.filePath )
	{
		return { Cancelled: true };
	}
	try
	{
		let data = await sender.printToPDF( { printBackground: true, pageSize: 'A4' } );
		await FS.promises.writeFile( picked.filePath, data );
	}
	catch ( error )
	{
		return { Error: 'not written: ' + ( error && error.message || error ) };
	}
	return { Path: picked.filePath };
}


// View in Browser: the window's URL is the forwarder's, /servers/<key>/api/plans/<id>/report on the app's origin; the
// same path on the root's own address is what a browser can open.
function ViewInBrowser( Url, Roots )
{
	let match = /^\/servers\/([^/]+)(\/.*)$/.exec( new URL( String( Url ) ).pathname );
	if ( !match )
	{
		return { Error: 'this page is not a server\'s' };
	}
	let root = ( Roots || [] ).find( function ( one ) { return one.Key === decodeURIComponent( match[ 1 ] ); } );
	if ( !root || !root.Url )
	{
		return { Error: 'no server "' + match[ 1 ] + '" in this window' };
	}
	let target = root.Url.replace( /\/+$/, '' ) + match[ 2 ];
	ELECTRON.shell.openExternal( target );
	return { Url: target };
}


//---------------------------------------------------------------------
// The folder dialog and the menu

function PickFolder( Owner, Current )
{
	return pick_folder( Owner, Current );
}


async function pick_folder( owner, current_folder )
{
	let picker_options = { properties: [ 'openDirectory', 'createDirectory' ] };
	if ( current_folder )
	{
		picker_options.defaultPath = current_folder;
	}
	let picked = owner ? await ELECTRON.dialog.showOpenDialog( owner, picker_options ) : await ELECTRON.dialog.showOpenDialog( picker_options );
	if ( picked.canceled || !picked.filePaths.length )
	{
		return null;
	}
	return picked.filePaths[ 0 ].replace( /\\/g, '/' );
}


// The menu: Project (New window, Open folder in new window, Reload), View, Quit. Not shown (the window has no menu bar;
// the page's application menu has the app's items), but set, since its accelerators are what keep Ctrl+R, Ctrl+N,
// Ctrl+Shift+O, the DevTools, the zoom and F11 working. An item whose action is not given is left out, with its
// accelerator (the Client has no folder to open; plan Review 2026-10-29, Step 1): MenuTemplate is the template alone,
// for the tests.
function MenuTemplate( Actions )
{
	let actions = Actions || {};
	let project = [
		{ Label: 'New window', Accelerator: 'CmdOrCtrl+N', Action: actions.NewWindow },
		{ Label: 'Open folder in new window…', Accelerator: 'CmdOrCtrl+Shift+O', Action: actions.OpenFolderWindow },
		{ Separator: true },
		{ Label: 'Reload', Accelerator: 'CmdOrCtrl+R', Action: actions.Reload },
		{ Separator: true },
		{ Role: 'quit' },
	];
	let items = [];
	for ( let entry of project )
	{
		if ( entry.Separator )
		{
			items.push( { type: 'separator' } );
		}
		else if ( entry.Role )
		{
			items.push( { role: entry.Role } );
		}
		else if ( typeof entry.Action === 'function' )
		{
			items.push( { label: entry.Label, accelerator: entry.Accelerator, click: entry.Action } );
		}
	}
	return [
		{
			label: 'Project',
			submenu: items,
		},
		{
			label: 'View',
			submenu: [
				{ role: 'toggleDevTools' },
				{ role: 'resetZoom' },
				{ role: 'zoomIn' },
				{ role: 'zoomOut' },
				{ type: 'separator' },
				{ role: 'togglefullscreen' },
			],
		},
	];
}


function BuildMenu( Actions )
{
	ELECTRON.Menu.setApplicationMenu( ELECTRON.Menu.buildFromTemplate( MenuTemplate( Actions ) ) );
}


module.exports = {
	Dark: Dark,
	ApplyNativeTheme: ApplyNativeTheme,
	Options: Options,
	Attach: Attach,
	AttachChrome: AttachChrome,
	PrintToPdf: PrintToPdf,
	ViewInBrowser: ViewInBrowser,
	PickFolder: PickFolder,
	MenuTemplate: MenuTemplate,
	BuildMenu: BuildMenu,
};
