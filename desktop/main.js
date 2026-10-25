'use strict';

// main - the desktop's main process (plan Consensus Desktop, Step 2): one window that shows the Consensus page (served
// by Page.js on 127.0.0.1, which forwards the page's API calls to the servers the page shows) and, with no server to
// show, the connect screen, where the saved servers are kept. Since plan Run Shapes, Step 5, the page shows every
// server at once, each a root of its tree: this machine's server when it runs and every saved server; nothing is
// connected to, and the connect screen is the servers' list (the Server menu's Servers…). Plan Run Shapes, Step 1: the app is the second entry
// point over src/Start.js: it takes the command line's --config, --port, --scope and --headless, starts this
// machine's server from the global config as the Scope says, and keeps its own settings (Settings.js) in desktop.json
// beside it (plan Rearchitecturation, Step 1: consensus.json is the Server Host's, and the Desktop never writes it;
// the desktop reads it for the server's Name). With --headless there is no window. A second server at the
// same time is a second instance (New window). Plan Run Shapes, Step 3: the LLM connections, the workspaces and
// the runs the desktop kept (Consensus Desktop, Steps 3 and 4) are the server's: the page gets them from the API. Plan Run
// Shapes, Step 4: a project folder on the command line (`consensus <path>`) opens the app on this machine's server
// with that project alone, whatever was open last; Open folder in new window starts another instance that way; the
// configured port in use leaves the server a free one (Server.js). Plan UI Components, Step 5: the window has no
// frame of its own: Electron draws the window buttons over the page's title bar (titleBarStyle hidden with
// titleBarOverlay; the page sends the bar's colours and height over the chrome message, so the buttons follow the
// palette), the bar is the drag region, and the native menu is not shown; it is still set, for its accelerators,
// and the page's application menu (public/components/title-bar) has Servers…, New window, Open folder in new
// window, Reload and Quit, over the bridge.
//
//   npm run desktop          (electron desktop, from the checkout)

const FS = require( 'fs' );
const PATH = require( 'path' );
const CHILD_PROCESS = require( 'child_process' );
const ELECTRON = require( 'electron' );
const SETTINGS = require( './Settings.js' );
const START = require( '../src/Start.js' );
const PAGE = require( './Page.js' );

const VERSION = require( '../package.json' ).version;
const ICON = PATH.join( __dirname, 'icon.ico' );		// the windows' icon from the checkout; the packaged executable carries its own (plan Installer)
const TRY_TIMEOUT = 5000;
// Electron's own switches, which stay on the command line the app parses.
const ELECTRON_SWITCH = /^--(remote-debugging-port|user-data-dir|inspect|enable-logging|no-sandbox|disable-gpu|trace-warnings)/;

let running = null;		// src/Server.js's, from START.Run: this machine's server, or none with Scope None
let store = null;
let settings = null;		// this machine's server's settings (consensus.json): read, never written here
let desktop = null;		// the desktop's own (desktop.json, Settings.js)
let desktop_path = null;
let page = null;
let window = null;
let reason = null;		// why this machine's server could not start, for the connect screen
let closing = false;
const CLOSE_ANSWER_WAIT = 3000;		// the page's answer to a close, before the window closes anyway
let isolated = false;	// a project on the command line: this machine's server, that project alone, Last untouched


//---------------------------------------------------------------------
// Settings

function save_settings()
{
	try
	{
		SETTINGS.Write( desktop_path, desktop );
	}
	catch ( error )
	{
		console.error( 'the desktop settings could not be written: ' + error.message );
	}
}


// The settings as the pages see them: the desktop's own, filled.
function desktop_settings()
{
	return SETTINGS.Fill( desktop );
}


// The page's remembered state changes often (a fold, a tab): written a moment after the last change.
let remember_timer = null;

function save_settings_soon()
{
	if ( remember_timer )
	{
		clearTimeout( remember_timer );
	}
	remember_timer = setTimeout( function ()
	{
		remember_timer = null;
		save_settings();
	}, 300 );
}


// The theme in use: the window's one theme (the theme per server went with plan Run Shapes, Step 5).
function theme_in_use()
{
	return desktop.Theme;
}


// The window buttons Electron draws over the title bar (plan UI Components, Step 5): a light or a dark pair to open
// with; the page sends the palette's own colours and the bar's height once it is drawn (the chrome message).
const LIGHT_OVERLAY = { color: '#f8f9fa', symbolColor: '#212529', height: 35 };
const DARK_OVERLAY = { color: '#1e1e1e', symbolColor: '#e6e6e6', height: 35 };

function overlay_for_theme()
{
	let theme = theme_in_use();
	let dark = ( theme === 'system' ) ? ELECTRON.nativeTheme.shouldUseDarkColors : SETTINGS.DARK_THEMES.includes( theme );
	return Object.assign( {}, dark ? DARK_OVERLAY : LIGHT_OVERLAY );
}


// The window's dialogs and native parts follow the theme, light or dark (plan UI Tweaks IV); System follows the system.
function apply_native_theme()
{
	let theme = theme_in_use();
	if ( theme === 'system' )
	{
		ELECTRON.nativeTheme.themeSource = 'system';
		return;
	}
	ELECTRON.nativeTheme.themeSource = SETTINGS.DARK_THEMES.includes( theme ) ? 'dark' : 'light';
}


//---------------------------------------------------------------------
// Trying a server: GET /api/me, as the owner. Returns { Ok, Version, Me, Participants, States } or { Ok: false, Error }.

async function try_server( url )
{
	let base = String( url || '' ).trim().replace( /\/+$/, '' );
	if ( !/^https?:\/\/\S+$/.test( base ) )
	{
		return { Ok: false, Error: 'the Url must start with http:// or https://' };
	}
	try
	{
		let response = await fetch( base + '/api/me', { signal: AbortSignal.timeout( TRY_TIMEOUT ) } );
		let json = await response.json().catch( function () { return {}; } );
		if ( !response.ok )
		{
			return { Ok: false, Error: base + ' answered ' + response.status + ( json.Error ? ': ' + json.Error : '' ) };
		}
		if ( !json.Me || !json.Participants )
		{
			return { Ok: false, Error: base + ' answered, but not as a Consensus server' };
		}
		return { Ok: true, Version: json.Version || null, Me: json.Me, Participants: json.Participants, States: json.States, Url: base };
	}
	catch ( error )
	{
		return { Ok: false, Error: base + ' does not answer: ' + ( error.name === 'TimeoutError' ? 'no answer within ' + ( TRY_TIMEOUT / 1000 ) + ' seconds' : error.message ) };
	}
}


//---------------------------------------------------------------------
// The roots the page shows (plan Run Shapes, Step 5): this machine's server when it runs, named by the config's Name,
// then the saved Hosts in their order; a project on the command line (Step 4) shows this machine's alone.

function roots_now()
{
	let list = [];
	let served = local_running();
	if ( served )
	{
		list.push( { Key: 'local', Name: settings.Name || 'This machine', Url: served.Url, Kind: 'local', Version: VERSION } );
	}
	if ( !isolated )
	{
		for ( let host of desktop.Hosts || [] )
		{
			list.push( { Key: host.Name, Name: host.Name, Url: host.Url, Kind: 'server' } );
		}
	}
	return list;
}


// The page server forwards to the roots as they stand now.
function apply_roots()
{
	if ( page )
	{
		page.SetRoots( roots_now().map( function ( root ) { return { Key: root.Key, Url: root.Url }; } ) );
	}
}


//---------------------------------------------------------------------
// The page server on the port it had last time (remembered in desktop.json as page-port), so the window's origin
// stays the same between starts and a sign-in through Clerk survives a restart (plan Clerk, Step 7); a port in use
// gives way to a free one, which is remembered instead.

async function serve_page()
{
	let remembered = ( desktop.Remembered && Number.isInteger( desktop.Remembered[ 'page-port' ] ) ) ? desktop.Remembered[ 'page-port' ] : 0;
	if ( remembered > 0 )
	{
		try
		{
			return await PAGE.Serve( { Port: remembered } );
		}
		catch ( error )
		{
			console.log( 'the page port ' + remembered + ' is in use: another one' );
		}
	}
	let served = await PAGE.Serve();
	if ( SETTINGS.Remember( desktop, 'page-port', Number( new URL( served.Url ).port ) ) )
	{
		save_settings();
	}
	return served;
}


//---------------------------------------------------------------------
// The window: the connect screen, or the Consensus page copy.

function show_connect()
{
	if ( window && !window.isDestroyed() )
	{
		window.loadURL( page.Url + '/connect.html' );
	}
	build_menu();
}


function show_page()
{
	apply_roots();
	if ( window && !window.isDestroyed() )
	{
		window.loadURL( page.Url + '/' );
	}
	build_menu();
}


function boot_info()
{
	return {
		Base: '',		// the page's own origin: Page.js forwards /api to the connected server
		Version: VERSION,
		Theme: theme_in_use(),
		Scale: desktop.Scale,
		Remembered: desktop.Remembered,
		Roots: roots_now(),
		Reason: reason,
		Local: local_running(),
	};
}


function web_preferences()
{
	return {
		preload: PATH.join( __dirname, 'preload.js' ),
		contextIsolation: true,
		nodeIntegration: false,
	};
}


// A report page of a root's server, opened from the page (plan Printing and Reporting): /api/plans/<id>/report, on
// the app's own origin through the forwarder.
function is_report_url( Url )
{
	return !!page && String( Url ).startsWith( page.Url + '/' ) && /\/api\/plans\/[^/?#]+\/report(\.md)?(\?|#|$)/.test( Url );
}


// The report window's Print to PDF (plan Printing and Reporting): the save dialog in the folder last used, then the
// page printed to that file. Answers { Path } or { Cancelled } or { Error }.
async function print_to_pdf( sender, Name )
{
	let owner = ELECTRON.BrowserWindow.fromWebContents( sender );
	let remembered = desktop.Remembered && desktop.Remembered[ 'report-folder' ];
	let folder = ( typeof remembered === 'string' && remembered ) ? remembered : ELECTRON.app.getPath( 'documents' );
	let name = String( Name || 'report' ).replace( /[\\/:*?"<>|\u0000-\u001f]+/g, ' ' ).trim() || 'report';
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
	if ( SETTINGS.Remember( desktop, 'report-folder', PATH.dirname( picked.filePath ) ) )
	{
		save_settings_soon();
	}
	return { Path: picked.filePath };
}


// The report window's View in Browser (plan Printing and Reporting): the window's URL is the forwarder's,
// /servers/<key>/api/plans/<id>/report on the app's origin; the same path on the root's own address is what a
// browser can open. Answers { Url } or { Error }.
function view_in_browser( Url )
{
	let match = /^\/servers\/([^/]+)(\/.*)$/.exec( new URL( String( Url ) ).pathname );
	if ( !match )
	{
		return { Error: 'this page is not a server\'s' };
	}
	let root = roots_now().find( function ( one ) { return one.Key === decodeURIComponent( match[ 1 ] ); } );
	if ( !root || !root.Url )
	{
		return { Error: 'no server "' + match[ 1 ] + '" in this window' };
	}
	let target = root.Url.replace( /\/+$/, '' ) + match[ 2 ];
	ELECTRON.shell.openExternal( target );
	return { Url: target };
}


// A window of the app (plan UI Components, Step 5): no frame, Electron's window buttons over the page's title bar.
function window_options( Width, Height )
{
	return {
		width: Width,
		height: Height,
		title: 'Consensus Desktop',
		icon: ICON,
		titleBarStyle: 'hidden',
		titleBarOverlay: overlay_for_theme(),
		webPreferences: web_preferences(),
	};
}


function create_window()
{
	window = new ELECTRON.BrowserWindow( window_options( 1400, 900 ) );
	window.setMenuBarVisibility( false );
	window.webContents.on( 'preload-error', function ( event, path, error )
	{
		console.error( 'preload error in ' + path + ': ' + ( error && error.stack || error ) );
	} );
	// A tab's Detach: the page opens "?detached=1#/p/<id>" on its own origin; it becomes a window of the app.
	window.webContents.setWindowOpenHandler( function ( details )
	{
		if ( is_report_url( details.url ) )
		{
			// a report (plan Printing and Reporting): a plain framed window, its Print button printing to PDF
			return { action: 'allow', overrideBrowserWindowOptions: { width: 1000, height: 800, title: 'Consensus report', icon: ICON, titleBarStyle: 'default', titleBarOverlay: false, webPreferences: web_preferences() } };
		}
		if ( details.url.startsWith( page.Url + '/' ) )
		{
			return { action: 'allow', overrideBrowserWindowOptions: window_options( 1000, 800 ) };
		}
		ELECTRON.shell.openExternal( details.url );
		return { action: 'deny' };
	} );
	window.webContents.on( 'did-create-window', function ( child, details )
	{
		child.setMenuBarVisibility( false );
		if ( details && is_report_url( details.url ) )
		{
			return;
		}
		// a detached window asks its page about its own draft, as the main window does
		child.on( 'close', function ( event )
		{
			event.preventDefault();
			ask_page_to_close( child, function () { child.destroy(); } );
		} );
	} );
	window.on( 'close', function ( event )
	{
		if ( closing )
		{
			return;
		}
		event.preventDefault();
		ask_page_to_close( window, function ()
		{
			closing = true;
			window.destroy();
		} );
	} );
	window.on( 'closed', function ()
	{
		window = null;
	} );
}


// The page is asked before its window closes (plan Markdown Editor, Step 4): close-requested goes to it, and it
// answers close-decided once its prompt about the unsaved edits is settled, or at once when nothing is dirty or
// Confirm on close is off; the connect screen has no page to ask; no answer within CLOSE_ANSWER_WAIT and the window
// closes anyway. Destroy closes it without another close event.
function ask_page_to_close( target, destroy )
{
	let contents = target.webContents;
	if ( target.isDestroyed() || contents.isDestroyed() || contents.getURL().indexOf( 'connect.html' ) >= 0 )
	{
		destroy();
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
		if ( ok && !target.isDestroyed() )
		{
			destroy();
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


//---------------------------------------------------------------------
// The menu: Server (Servers…, the page, Reload, New window, Open folder in new window), View, Quit. Not shown since
// plan UI Components, Step 5 (the window has no menu bar; the page's application menu has the Server items), but
// set, since its accelerators are what keep Ctrl+R, Ctrl+N, Ctrl+Shift+O, the DevTools, the zoom and F11 working.

function build_menu()
{
	let template = [
		{
			label: 'Server',
			submenu: [
				{ label: 'Servers…', click: function () { show_connect(); } },
				{ label: 'The page', click: function () { show_page(); } },
				{ label: 'Reload', accelerator: 'CmdOrCtrl+R', click: function () { if ( window ) { window.webContents.reload(); } } },
				{ type: 'separator' },
				{ label: 'New window', accelerator: 'CmdOrCtrl+N', click: function () { new_window(); } },
				{ label: 'Open folder in new window…', accelerator: 'CmdOrCtrl+Shift+O', click: function () { open_folder_window(); } },
				{ type: 'separator' },
				{ role: 'quit' },
			],
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
	ELECTRON.Menu.setApplicationMenu( ELECTRON.Menu.buildFromTemplate( template ) );
}


//---------------------------------------------------------------------
// This machine's server: the config's own, started with the app by START.Run as the Scope says (plan Run Shapes).

function local_running()
{
	if ( !running || !running.Server )
	{
		return null;
	}
	return { Url: running.Url, Port: running.Address.Port, Scope: running.Scope, Config: store.Folder, Project: running.Project ? { Name: running.Project.Name, Path: running.Project.Path } : null };
}


// The server from the command line's options. The settings' problems stop the app; a port in use does not: the app
// opens as a client only, over the settings read with Scope None, and the connect screen says why.
async function start_server( options )
{
	try
	{
		return await START.Run( options, console.log );
	}
	catch ( error )
	{
		if ( !/EADDRINUSE|EACCES/.test( error.message ) )
		{
			throw error;
		}
		reason = 'this machine\'s server could not start: ' + error.message;
		console.error( reason );
		return START.Run( Object.assign( {}, options, { Scope: 'None' } ), console.log );
	}
}


// The app's own arguments: after the executable (and, from the checkout, the app folder), Electron's switches left out.
function own_arguments( argv )
{
	return argv.slice( ELECTRON.app.isPackaged ? 1 : 2 ).filter( function ( argument ) { return !ELECTRON_SWITCH.test( argument ); } );
}


// Another instance of the app, over the same config, on its own connect screen; with Arguments, as the command line
// would start it (a project folder: that project alone).
function new_window( Arguments )
{
	let leading = ELECTRON.app.isPackaged ? [] : [ ELECTRON.app.getAppPath() ];		// installed, the executable is the app; from the checkout, electron takes the app folder
	let child = CHILD_PROCESS.spawn( process.execPath, leading.concat( Arguments || [] ), { detached: true, stdio: 'ignore' } );
	child.unref();
}


// Open folder in new window: a folder picked, opened in another instance on that project alone (`consensus <path>`).
async function open_folder_window( owner )
{
	let picked = await pick_folder( owner || window, null );
	if ( picked )
	{
		new_window( [ picked ] );
	}
}


// The folder dialog, for the page's + Project and the menu. Returns the folder with forward slashes, or null.
async function pick_folder( owner, current_folder )
{
	let options = { properties: [ 'openDirectory', 'createDirectory' ] };
	if ( current_folder )
	{
		options.defaultPath = current_folder;
	}
	let picked = await ELECTRON.dialog.showOpenDialog( owner || window, options );
	if ( picked.canceled || !picked.filePaths.length )
	{
		return null;
	}
	return picked.filePaths[ 0 ].replace( /\\/g, '/' );
}


//---------------------------------------------------------------------
// The bridge's handlers.

function attach_handlers()
{
	ELECTRON.ipcMain.on( 'boot', function ( event )
	{
		event.returnValue = boot_info();
	} );

	// The page's remembered state (stored.js): a value by key, into desktop.json.
	ELECTRON.ipcMain.on( 'remember', function ( event, change )
	{
		if ( change && SETTINGS.Remember( desktop, change.Key, change.Value ) )
		{
			save_settings_soon();
		}
	} );

	// The page's picker and the connect screen's set the window's theme.
	ELECTRON.ipcMain.on( 'theme', function ( event, change )
	{
		if ( change && SETTINGS.THEMES.includes( change.Theme ) )
		{
			desktop.Theme = change.Theme;
		}
		if ( change && SETTINGS.SCALES.includes( change.Scale ) )
		{
			desktop.Scale = change.Scale;
		}
		save_settings();
		apply_native_theme();
	} );

	ELECTRON.ipcMain.handle( 'settings', function ()
	{
		return { Settings: desktop_settings(), Path: desktop_path, Config: store.Folder, Version: VERSION, Roots: roots_now(), Reason: reason, Local: local_running(), Missing: store.Missing() };
	} );

	ELECTRON.ipcMain.handle( 'save', function ( event, fresh )
	{
		let filled = SETTINGS.Fill( Object.assign( {}, desktop, fresh || {} ) );
		let problems = SETTINGS.Problems( filled );
		if ( problems.length )
		{
			return { Problems: problems };
		}
		SETTINGS.Apply( desktop, filled );
		save_settings();
		apply_roots();
		build_menu();
		return { Settings: desktop_settings(), Roots: roots_now() };
	} );

	ELECTRON.ipcMain.handle( 'try', function ( event, url )
	{
		return try_server( url );
	} );

	// The servers screen, and the page again (the Server menu does the same).
	ELECTRON.ipcMain.handle( 'servers', function ()
	{
		show_connect();
		return {};
	} );

	ELECTRON.ipcMain.handle( 'page', function ()
	{
		show_page();
		return { Roots: roots_now() };
	} );

	ELECTRON.ipcMain.handle( 'local-status', function ()
	{
		return { Running: local_running() };
	} );

	ELECTRON.ipcMain.handle( 'folder', function ( event, current_folder )
	{
		return pick_folder( ELECTRON.BrowserWindow.fromWebContents( event.sender ), current_folder );
	} );

	ELECTRON.ipcMain.handle( 'new-window', function ()
	{
		new_window();
		return {};
	} );

	// The page's application menu (plan UI Components, Step 5): Open folder in new window, and Quit.
	ELECTRON.ipcMain.handle( 'open-folder-window', function ( event )
	{
		return open_folder_window( ELECTRON.BrowserWindow.fromWebContents( event.sender ) ).then( function () { return {}; } );
	} );

	// The report window's Print (plan Printing and Reporting).
	ELECTRON.ipcMain.handle( 'print-pdf', function ( event, name )
	{
		return print_to_pdf( event.sender, name );
	} );

	// The report window's View in Browser: the same report at its root's own address, in the system browser.
	ELECTRON.ipcMain.handle( 'view-in-browser', function ( event )
	{
		return view_in_browser( event.sender.getURL() );
	} );

	ELECTRON.ipcMain.handle( 'quit', function ()
	{
		ELECTRON.app.quit();
		return {};
	} );

	// The title bar's colours and height, from the page once its bar is drawn and after every change of theme or size
	// (plan UI Components, Step 5): the window buttons follow the palette.
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

async function main()
{
	let options = null;
	try
	{
		options = START.Parse( own_arguments( process.argv ) );
	}
	catch ( error )
	{
		console.error( error.message );
		console.error( START.USAGE );
		fail_to_start( error.message + '\n\n' + START.USAGE, false );
		return;
	}
	if ( options.Help )
	{
		console.log( START.USAGE );
		ELECTRON.app.exit( 0 );
		return;
	}
	isolated = !!options.Project;
	await ELECTRON.app.whenReady();
	running = await start_server( options );
	store = running.Store;
	settings = running.Settings;
	// The desktop's own file (plan Rearchitecturation, Step 1); a project folder on the command line goes first in Recent.
	let loaded = SETTINGS.Load( store.Folder );
	desktop = loaded.Settings;
	desktop_path = loaded.Path;
	loaded.Lines.forEach( function ( line ) { console.log( line ); } );
	if ( running.Project && SETTINGS.Opened( desktop, running.Project.Path ) )
	{
		save_settings();
	}
	apply_native_theme();
	if ( options.Headless )
	{
		if ( !running.Server )
		{
			console.log( 'nothing to run without a window: --scope local or public starts the server' );
			await running.Close();
			ELECTRON.app.exit( 1 );
			return;
		}
		console.log( 'no window (--headless); Ctrl+C stops the server' );
		process.on( 'SIGINT', quit_headless );
		process.on( 'SIGTERM', quit_headless );
		return;
	}
	page = await serve_page();
	attach_handlers();
	create_window();
	ELECTRON.app.on( 'window-all-closed', function ()
	{
		if ( remember_timer )
		{
			clearTimeout( remember_timer );
			remember_timer = null;
			save_settings();
		}
		page.Close().catch( function () {} ).then( function () { return running.Close(); } ).catch( function () {} ).then( function () { ELECTRON.app.quit(); } );
	} );
	// The page, with every root it has; the connect screen when it has none (Scope None and no saved server, or a
	// server that could not start), which says why.
	if ( roots_now().length )
	{
		show_page();
	}
	else
	{
		show_connect();
	}
}


function quit_headless()
{
	running.Close().catch( function () {} ).then( function () { ELECTRON.app.exit( 0 ); } );
}


// A start that fails (the settings refused, a folder that is not there, a port in use with --port): the message on
// the console, and, since an icon has no console, in a dialog unless --headless.
function fail_to_start( message, headless )
{
	if ( !headless )
	{
		ELECTRON.dialog.showErrorBox( 'Consensus could not start', message );
	}
	ELECTRON.app.exit( 1 );
}


main().catch( function ( error )
{
	console.error( error.message );
	fail_to_start( error.message, process.argv.includes( '--headless' ) );
} );
