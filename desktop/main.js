'use strict';

// main - the desktop's main process (plan Consensus Desktop, Step 2): one window that opens on the connect screen
// and, once connected, shows the desktop's own copy of the Consensus page (served by Page.js on 127.0.0.1, which
// forwards the page's API calls to the connected server). Plan Run Shapes, Step 1: the app is the second entry
// point over src/Start.js: it takes the command line's --config, --port, --scope and --headless, starts this
// machine's server from the global config as the Scope says, and keeps its own settings (Settings.js) in that same
// consensus.json, where desktop.json is moved in once. With --headless there is no window. A second server at the
// same time is a second instance (New window). Plan Run Shapes, Step 3: the LLM connections, the workspaces and
// the runs the desktop kept (Consensus Desktop, Steps 3 and 4) are the server's: the page gets them from the API;
// desktop.json's connections and workspaces are moved in once (Settings.js, then the server's migration). Plan Run
// Shapes, Step 4: a project folder on the command line (`consensus <path>`) opens the app on this machine's server
// with that project alone, whatever was open last; Open folder in new window starts another instance that way; the
// configured port in use leaves the server a free one (Server.js).
//
//   npm run desktop          (electron desktop, from the checkout)

const PATH = require( 'path' );
const CHILD_PROCESS = require( 'child_process' );
const ELECTRON = require( 'electron' );
const SETTINGS = require( './Settings.js' );
const START = require( '../src/Start.js' );
const PAGE = require( './Page.js' );
const SERVER = require( '../src/Server.js' );

const VERSION = require( '../package.json' ).version;
const TRY_TIMEOUT = 5000;
// Electron's own switches, which stay on the command line the app parses.
const ELECTRON_SWITCH = /^--(remote-debugging-port|user-data-dir|inspect|enable-logging|no-sandbox|disable-gpu|trace-warnings)/;

let running = null;		// src/Server.js's, from START.Run: this machine's server, or none with Scope None
let store = null;
let settings = null;
let page = null;
let window = null;
let current = null;		// { Kind: 'server' | 'local', Name, Url, Version } while connected
let reason = null;		// why the last connection failed, for the connect screen
let closing = false;
let isolated = false;	// a project on the command line: this machine's server, that project alone, Last untouched


//---------------------------------------------------------------------
// Settings

function save_settings()
{
	store.WriteSettings( settings ).catch( function ( error )
	{
		console.error( 'the settings could not be written: ' + error.message );
	} );
}


// The settings as the pages see them: the desktop's fields, never the participants' tokens.
function desktop_settings()
{
	return SETTINGS.Fill( settings );
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


// The theme in use: the connected server's own, or the default (plan UI Tweaks V).
function theme_in_use()
{
	return SETTINGS.ThemeFor( settings, current );
}


// The window's title bar and menu bar follow the theme, light or dark (plan UI Tweaks IV); System follows the system.
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
// Connecting: Where = { Kind: 'server', Name } (a saved server) | { Kind: 'local' } (the running local server).

async function connect( where )
{
	let target = null;
	if ( where && where.Kind === 'local' )
	{
		let served = local_running();
		if ( !served )
		{
			return { Ok: false, Error: 'this machine runs no server' };
		}
		target = { Kind: 'local', Name: settings.Name || 'This machine', Url: served.Url };
	}
	else
	{
		let saved = SETTINGS.ServerNamed( settings, where && where.Name );
		if ( !saved )
		{
			return { Ok: false, Error: 'no saved server named "' + ( where && where.Name ) + '"' };
		}
		target = { Kind: 'server', Name: saved.Name, Url: saved.Url };
	}
	let tried = await try_server( target.Url );
	if ( !tried.Ok )
	{
		reason = tried.Error;
		return tried;
	}
	current = { Kind: target.Kind, Name: target.Name, Url: tried.Url, Version: tried.Version };
	page.SetTarget( current.Url );
	reason = null;
	if ( !isolated )
	{
		settings.Last = ( target.Kind === 'local' ) ? { Kind: 'local' } : { Kind: 'server', Name: target.Name };
		save_settings();
	}
	apply_native_theme();
	show_page();
	return { Ok: true, Version: tried.Version };
}


function disconnect()
{
	current = null;
	page.SetTarget( null );
	apply_native_theme();
	show_connect();
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
		Scale: settings.Scale,
		Remembered: settings.Remembered,
		Server: current ? { Kind: current.Kind, Name: current.Name, Url: current.Url, Version: current.Version } : null,
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


function create_window()
{
	window = new ELECTRON.BrowserWindow( {
		width: 1400,
		height: 900,
		title: 'Consensus Desktop',
		webPreferences: web_preferences(),
	} );
	window.webContents.on( 'preload-error', function ( event, path, error )
	{
		console.error( 'preload error in ' + path + ': ' + ( error && error.stack || error ) );
	} );
	// A tab's Detach: the page opens "?detached=1#/p/<id>" on its own origin; it becomes a window of the app.
	window.webContents.setWindowOpenHandler( function ( details )
	{
		if ( details.url.startsWith( page.Url + '/' ) )
		{
			return { action: 'allow', overrideBrowserWindowOptions: { width: 1000, height: 800, title: 'Consensus Desktop', webPreferences: web_preferences() } };
		}
		ELECTRON.shell.openExternal( details.url );
		return { action: 'deny' };
	} );
	window.on( 'close', function ( event )
	{
		if ( closing )
		{
			return;
		}
		event.preventDefault();
		closing = true;
		window.destroy();
	} );
	window.on( 'closed', function ()
	{
		window = null;
	} );
}


//---------------------------------------------------------------------
// The menu: Server (Connect to another, Reload, New window), View, Quit.

function build_menu()
{
	let template = [
		{
			label: 'Server',
			submenu: [
				{ label: current ? 'Connect to another…' : 'Connect…', click: function () { disconnect(); } },
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
	let child = CHILD_PROCESS.spawn( process.execPath, [ ELECTRON.app.getAppPath() ].concat( Arguments || [] ), { detached: true, stdio: 'ignore' } );
	child.unref();
}


// Open folder in new window: a folder picked, opened in another instance on that project alone (`consensus <path>`).
async function open_folder_window()
{
	let picked = await pick_folder( window, null );
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
		if ( change && SETTINGS.Remember( settings, change.Key, change.Value ) )
		{
			save_settings_soon();
		}
	} );

	// The page's picker sets the connected server's own theme; the connect screen's (nothing connected) the default.
	ELECTRON.ipcMain.on( 'theme', function ( event, change )
	{
		if ( change && SETTINGS.THEMES.includes( change.Theme ) )
		{
			SETTINGS.SetThemeFor( settings, current, change.Theme );
		}
		if ( change && SETTINGS.SCALES.includes( change.Scale ) )
		{
			settings.Scale = change.Scale;
		}
		save_settings();
		apply_native_theme();
	} );

	ELECTRON.ipcMain.handle( 'settings', function ()
	{
		return { Settings: desktop_settings(), Path: store.SettingsPath(), Version: VERSION, Server: boot_info().Server, Reason: reason, Local: local_running(), Missing: store.Missing() };
	} );

	ELECTRON.ipcMain.handle( 'save', function ( event, fresh )
	{
		let filled = SETTINGS.Fill( Object.assign( {}, settings, fresh || {} ) );
		let problems = SETTINGS.Problems( filled );
		if ( problems.length )
		{
			return { Problems: problems };
		}
		SETTINGS.Apply( settings, filled );
		save_settings();
		build_menu();
		return { Settings: desktop_settings() };
	} );

	ELECTRON.ipcMain.handle( 'try', function ( event, url )
	{
		return try_server( url );
	} );

	ELECTRON.ipcMain.handle( 'connect', function ( event, where )
	{
		return connect( where );
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
		ELECTRON.app.exit( 1 );
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
	let user_data = ELECTRON.app.getPath( 'userData' );
	running = await start_server( options );
	store = running.Store;
	settings = running.Settings;
	let moved = SETTINGS.MoveIn( settings, PATH.join( user_data, 'desktop.json' ) );
	if ( moved.length )
	{
		moved.forEach( function ( line ) { console.log( line ); } );
		await store.WriteSettings( settings );
		for ( let line of await SERVER.MigrateWorkspaces( store, settings ) )
		{
			console.log( line );
		}
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
	page = await PAGE.Serve();
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
	// What was open last: a saved server, else this machine's server when it runs; a project on the command line is on
	// this machine's server whatever was last; on failure, the connect screen says why.
	let opened = false;
	if ( !isolated && settings.Last && settings.Last.Kind === 'server' )
	{
		opened = ( await connect( { Kind: 'server', Name: settings.Last.Name } ) ).Ok;
	}
	else if ( local_running() )
	{
		opened = ( await connect( { Kind: 'local' } ) ).Ok;
	}
	if ( !opened )
	{
		show_connect();
	}
}


function quit_headless()
{
	running.Close().catch( function () {} ).then( function () { ELECTRON.app.exit( 0 ); } );
}


main().catch( function ( error )
{
	console.error( error.message );
	ELECTRON.app.exit( 1 );
} );
