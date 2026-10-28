'use strict';

// main - the Client's main process (plan Client Edition, Step 1): a new app beside Sidecar, Desktop and the Server that
// connects to projects on one or more Consensus Servers. It has no Sidecar functionality (no local folder, no server
// of its own), no token-based service API (no API or MCP of its own, no LLM Instructions, no tokens) and no current
// user (no user.json, no license read); all configuration is the Servers' own. A window shows every added Server as a
// root of the page's tree; the window's page is served by the page server (electron/Page.js) on 127.0.0.1, which
// forwards each Server's API through /servers/<name>/api. New window opens another window of this process on the
// same list. The settings are client.json in the config folder (Settings.js). The window parts are shared with
// Desktop and Sidecar (electron/Windows.js).
//
//   npm run client -- [--config <folder>]

const PATH = require( 'path' );
const ELECTRON = require( 'electron' );
const SERVER = require( '../src/Server.js' );
const PAGE = require( '../electron/Page.js' );
const WINDOWS = require( '../electron/Windows.js' );
const SETTINGS = require( './Settings.js' );

const VERSION = require( '../package.json' ).version;
const TITLE = 'Consensus Client';
const ICON = PATH.join( __dirname, '..', 'desktop', 'icon.ico' );
const PRELOAD = PATH.join( __dirname, 'preload.js' );
const USAGE = 'usage: consensus-client [--config <folder>]';
const DARK_THEMES = SETTINGS.DARK_THEMES;
const SAVE_DELAY = 300;		// the view state changes often (a fold, a tab): written a moment after the last change
const PAGE_PORT = 'page-port';
// Electron's own switches, which stay on the command line the app parses.
const ELECTRON_SWITCH = /^--(remote-debugging-port|user-data-dir|inspect|enable-logging|no-sandbox|disable-gpu|trace-warnings)/;

let options = null;		// { Config }
let client = null;		// client.json, filled: { Servers, Theme, Scale, Remembered }
let save_timer = null;
let page = null;		// electron/Page.js's
let windows = [];		// the open windows, all on the same list of Servers


//---------------------------------------------------------------------
// The settings: <config>/client.json

function config_folder()
{
	return options.Config || SERVER.DEFAULT_CONFIG;
}


function save_settings()
{
	if ( save_timer )
	{
		clearTimeout( save_timer );
		save_timer = null;
	}
	try
	{
		SETTINGS.Write( config_folder(), client );
	}
	catch ( error )
	{
		console.error( SETTINGS.FILE + ' could not be written: ' + error.message );
	}
}


function save_settings_soon()
{
	if ( save_timer )
	{
		clearTimeout( save_timer );
	}
	save_timer = setTimeout( save_settings, SAVE_DELAY );
}


//---------------------------------------------------------------------
// The arguments: after the executable (and, from the checkout, the app folder), Electron's switches left out.

function parse_arguments( argv )
{
	let list = argv.slice( ELECTRON.app.isPackaged ? 1 : 2 ).filter( function ( argument ) { return !ELECTRON_SWITCH.test( argument ); } );
	let parsed = { Config: null, Help: false };
	for ( let index = 0; index < list.length; index++ )
	{
		let argument = list[ index ];
		if ( argument === '--help' || argument === '-h' )
		{
			parsed.Help = true;
		}
		else if ( argument === '--config' )
		{
			let folder = list[ index + 1 ];
			if ( folder === undefined || folder.startsWith( '--' ) )
			{
				throw new Error( '--config needs a folder' );
			}
			parsed.Config = PATH.resolve( folder );
			index++;
		}
		else
		{
			throw new Error( 'not an argument the Client knows: ' + argument );
		}
	}
	return parsed;
}


//---------------------------------------------------------------------
// The Servers: one root of the page each, keyed by its name.

function roots_now()
{
	return client.Servers.map( function ( server )
	{
		return { Key: server.Name, Name: server.Name, Url: server.Url, Kind: 'server' };
	} );
}


function apply_roots()
{
	page.SetRoots( roots_now().map( function ( root ) { return { Key: root.Key, Url: root.Url }; } ) );
}


//---------------------------------------------------------------------
// The page server on the port it had last time, so the window's origin stays the same between starts and Clerk's
// session in the window's storage survives a restart; a port in use gives way to a free one, remembered instead.

async function serve_page()
{
	let remembered = Number.isInteger( client.Remembered[ PAGE_PORT ] ) ? client.Remembered[ PAGE_PORT ] : 0;
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
	if ( SETTINGS.Remember( client, PAGE_PORT, Number( new URL( served.Url ).port ) ) )
	{
		save_settings();
	}
	return served;
}


//---------------------------------------------------------------------
// The windows

function boot_info()
{
	return {
		Base: '',		// the page's own origin: Page.js forwards /servers/<name>/api to each Server
		Version: VERSION,
		Theme: client.Theme,
		Scale: client.Scale,
		Remembered: client.Remembered,
		Roots: roots_now(),
		License: null,
		Project: null,
		Recent: [],
		Reason: null,
		Client: true,
	};
}


function window_options( Width, Height )
{
	return WINDOWS.Options( { Width: Width, Height: Height, Title: TITLE, Icon: ICON, Theme: client.Theme, DarkThemes: DARK_THEMES, Preload: PRELOAD } );
}


// A window on the list of Servers: its detached tabs, its report windows and its close (electron/Windows.js).
function open_window()
{
	let window = new ELECTRON.BrowserWindow( window_options( 1400, 900 ) );
	windows.push( window );
	WINDOWS.Attach( window, {
		PageUrl: function () { return page ? page.Url : null; },
		Icon: ICON,
		Preload: PRELOAD,
		Options: window_options,
		OnClosed: function () { windows = windows.filter( function ( one ) { return one !== window; } ); },
	} );
	window.loadURL( page.Url + '/' );
	return window;
}


// The menu (not shown; its accelerators are): New window opens another window here; there is no folder to open.
function build_menu()
{
	WINDOWS.BuildMenu( {
		NewWindow: function () { open_window(); },
		OpenFolderWindow: function () {},
		Reload: function ()
		{
			let focused = ELECTRON.BrowserWindow.getFocusedWindow();
			if ( focused )
			{
				focused.webContents.reload();
			}
		},
	} );
}


//---------------------------------------------------------------------
// The bridge's handlers

function attach_handlers()
{
	ELECTRON.ipcMain.on( 'boot', function ( event )
	{
		event.returnValue = boot_info();
	} );

	ELECTRON.ipcMain.on( 'remember', function ( event, change )
	{
		if ( change && typeof change.Key === 'string' && change.Key !== PAGE_PORT && SETTINGS.Remember( client, change.Key, change.Value ) )
		{
			save_settings_soon();
		}
	} );

	ELECTRON.ipcMain.on( 'theme', function ( event, change )
	{
		if ( change && SETTINGS.THEMES.includes( change.Theme ) )
		{
			client.Theme = change.Theme;
		}
		if ( change && SETTINGS.SCALES.includes( change.Scale ) )
		{
			client.Scale = change.Scale;
		}
		save_settings();
		WINDOWS.ApplyNativeTheme( client.Theme, DARK_THEMES );
	} );

	ELECTRON.ipcMain.handle( 'new-window', function ()
	{
		open_window();
		return {};
	} );

	ELECTRON.ipcMain.handle( 'print-pdf', async function ( event, name )
	{
		let remembered = client.Remembered[ 'report-folder' ];
		let answer = await WINDOWS.PrintToPdf( event.sender, name, ( typeof remembered === 'string' ) ? remembered : null );
		if ( answer.Path && SETTINGS.Remember( client, 'report-folder', PATH.dirname( answer.Path ) ) )
		{
			save_settings_soon();
		}
		return answer;
	} );

	ELECTRON.ipcMain.handle( 'view-in-browser', function ( event )
	{
		return WINDOWS.ViewInBrowser( event.sender.getURL(), roots_now() );
	} );

	ELECTRON.ipcMain.handle( 'quit', function ()
	{
		ELECTRON.app.quit();
		return {};
	} );

	WINDOWS.AttachChrome();
}


//---------------------------------------------------------------------

async function main()
{
	try
	{
		options = parse_arguments( process.argv );
	}
	catch ( error )
	{
		fail_to_start( error.message + '\n\n' + USAGE );
		return;
	}
	if ( options.Help )
	{
		console.log( USAGE );
		ELECTRON.app.exit( 0 );
		return;
	}
	await ELECTRON.app.whenReady();
	let loaded = SETTINGS.Load( config_folder() );
	client = loaded.Settings;
	loaded.Lines.forEach( function ( line ) { console.log( line ); } );
	WINDOWS.ApplyNativeTheme( client.Theme, DARK_THEMES );
	page = await serve_page();
	apply_roots();
	console.log( TITLE + ': the page on ' + page.Url + ', ' + client.Servers.length + ' Server' + ( client.Servers.length === 1 ? '' : 's' ) );
	attach_handlers();
	build_menu();
	open_window();
	ELECTRON.app.on( 'window-all-closed', function ()
	{
		if ( save_timer )
		{
			save_settings();
		}
		page.Close().catch( function () {} ).then( function () { ELECTRON.app.quit(); } );
	} );
}


// A start that fails: the message on the console and in a dialog, since an icon has no console.
function fail_to_start( message )
{
	console.error( message );
	ELECTRON.dialog.showErrorBox( TITLE + ' could not start', message );
	ELECTRON.app.exit( 1 );
}


main().catch( function ( error )
{
	fail_to_start( error.message );
} );
