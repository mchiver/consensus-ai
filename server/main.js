'use strict';

// main - the Server application's main process (plan The Server, Step 3). The Server runs the server in this process
// over every registered project (src/Start.js, the same as `consensus serve`), under the authority of its
// Administrator (src/Gate.js); its window shows the server's page, the whole tree with the management parts open to
// the Administrator and the Managers. One Server per machine: a second launch hands its arguments to the first and
// quits. Closing the window hides it; the tray icon brings it back, and the tray's Quit ends the Server. --open <folder>
// (the file explorer's "Open in Consensus Server") registers the folder as a project, or finds it when it is registered
// already, and shows it. --headless runs the server with no window and no tray: a headless gate, which also takes the
// Administrator's account in Users.json for its authority.
//
// The window's gate: the machine's current user (<config>/user.json) must be the Administrator, or the first licensed
// user when there is none yet, with Personal or Professional. While it is closed, and while the license is Personal,
// the server listens on this machine alone (Scope Local, whatever the file says), so the window can sign in; a
// sign-in in the window writes the current user, the gate is checked again, and the server starts again on the
// file's Scope when that changed what it may listen on.
//
// Plan Review 2026-10-29, Step 3: the window is a window of the shared kind (electron/Windows.js: frameless, the window
// buttons over the page's title bar, the page asked before a dirty document is lost, the report window with Print to
// PDF and View in Browser), loading the page from the page server (electron/Page.js) on its own loopback origin with
// one root, Key server, forwarded to the server's address; its look and remembered state are <config>/server.json
// (Settings.js); the command line, the saving, the common handlers and the failed start are electron/App.js's. The
// tray, the single instance and the gate stay as they were; the tray's Quit asks the page first.
//
//   consensus-server [--open <folder>] [--config <folder>] [--port <port>] [--scope none|local|public] [--headless]

const FS = require( 'fs' );
const PATH = require( 'path' );
const ELECTRON = require( 'electron' );
const START = require( '../src/Start.js' );
const SERVER = require( '../src/Server.js' );
const LICENSE = require( '../src/License.js' );
const WINDOWS = require( '../electron/Windows.js' );
const APP = require( '../electron/App.js' );
const CURRENT_USER = require( '../electron/CurrentUser.js' );
const SETTINGS = require( './Settings.js' );

const VERSION = require( '../package.json' ).version;
const TITLE = 'Consensus Server';
const ICON = PATH.join( __dirname, '..', 'desktop', 'icon.ico' );
const PRELOAD = PATH.join( __dirname, 'preload.js' );
const USAGE = 'usage: consensus-server [--open <folder>] [--config <folder>] [--port <port>] [--scope none|local|public] [--headless]';
const FLAGS = [ { Name: '--open', Takes: 'value', Key: 'Open', Needs: 'a folder' } ];

let options = null;		// the command line's (src/Start.js)
let running = null;		// src/Server.js's, from START.Run
let window_settings = null;	// server.json, filled: { Theme, Scale, Remembered }; null when headless
let page = null;		// electron/Page.js's, forwarding /servers/server/api to the server
let window = null;
let attached = null;		// Windows.Attach's handle on the window: AskClose
let tray = null;
let quitting = false;

// The machine's current user (plan The Server, Step 1): <config>/user.json, shared with the Desktop (electron/CurrentUser.js).
const USER = CURRENT_USER.Make( config_folder );
// The window's settings saved: now, or a moment after the last change (the view state changes often: a fold, a tab).
const SAVER = APP.Saver( { Write: function () { SETTINGS.Write( config_folder(), window_settings ); }, Label: SETTINGS.FILE } );


//---------------------------------------------------------------------
// The command line

// The arguments after the app's (electron/App.js): --open <folder> taken out, the rest left for src/Start.js.
function own_arguments( argv )
{
	let parsed = APP.Arguments( argv, { Title: 'the Server', Rest: true, Flags: FLAGS } );
	return { Open: parsed.Options.Open, Arguments: parsed.Rest };
}


function config_folder()
{
	return ( options && options.Config ) ? options.Config : SERVER.DEFAULT_CONFIG;
}


// The Scope the settings file names, read without writing it (Local when there is no file yet).
function file_scope()
{
	try
	{
		let settings = JSON.parse( FS.readFileSync( PATH.join( config_folder(), 'consensus.json' ), 'utf8' ) );
		return ( typeof settings.Scope === 'string' && settings.Scope ) ? settings.Scope : 'Local';
	}
	catch ( error )
	{
		return 'Local';
	}
}


// The Scope the window's server takes: the command line's or the file's, but Local while the gate would be closed
// or the license is not Professional.
function window_scope()
{
	let wanted = options.Scope || file_scope();
	if ( wanted !== 'Public' )
	{
		return wanted;
	}
	let settings = null;
	try
	{
		settings = JSON.parse( FS.readFileSync( PATH.join( config_folder(), 'consensus.json' ), 'utf8' ) );
	}
	catch ( error )
	{
		settings = {};
	}
	let admin = ( settings.Clerk && settings.Clerk.AdminEmail ) ? settings.Clerk.AdminEmail : null;
	let authority = LICENSE.Authority( LICENSE.Read( config_folder() ), admin );
	if ( authority.Ok && authority.Public )
	{
		return 'Public';
	}
	console.log( 'Scope Public waits for the Administrator\'s Professional sign-in: listening on this machine alone for now' );
	return 'Local';
}


//---------------------------------------------------------------------
// The server

async function start_server()
{
	let scope = options.Headless ? options.Scope : window_scope();
	running = await START.Run( Object.assign( {}, options, { Scope: scope, Gate: { Mode: options.Headless ? 'headless' : 'window' } } ), console.log );
	if ( !running.Server )
	{
		throw new Error( 'Scope None: the Server has nothing to serve; --scope local or public' );
	}
	apply_roots();
	refresh_tray();
	return running;
}


// The gate checked again after a sign-in or a sign-out; the server started again when the Scope it may listen on
// changed (a Professional Administrator signing in on a Public file), and the window reloaded either way.
async function recheck()
{
	if ( !running || !running.Gate )
	{
		return;
	}
	await running.Gate.Check();
	if ( !options.Headless && window_scope() !== running.Scope )
	{
		await running.Close();
		await start_server();
	}
	refresh_tray();
	show_page();
}


// --open <folder>: the folder registered as a project of the Server (a folder holding one already is opened under its
// own name, one registered already is found), then shown; answers the project or { Error }.
async function open_folder( Folder, Cwd )
{
	let path = PATH.resolve( Cwd || process.cwd(), String( Folder || '' ) );
	if ( !FS.existsSync( path ) || !FS.statSync( path ).isDirectory() )
	{
		return { Error: 'no such folder: ' + path };
	}
	let store = running.Store;
	let project = await store.OpenProject( path );
	if ( !project )
	{
		project = await store.CreateProject( { Name: PATH.basename( path ), Path: path } );
	}
	running.Events.Send( { Project: project.Id, Kind: 'project' } );
	console.log( 'project ' + project.Name + ' at ' + project.Path + ( project.Mounted === true ? '' : ' (unmounted)' ) );
	show_page( project.Context ? '#/p/' + project.Context : '' );
	return project;
}


//---------------------------------------------------------------------
// The page: served by the page server on its own origin, the server its one root, Key server.

function root()
{
	return { Key: 'server', Name: ( running && running.Settings && running.Settings.Name ) || TITLE, Url: running ? running.Url : '', Kind: 'server', Version: VERSION };
}


// The page server forwards /servers/server/api to the server as it runs now (its port may change at a restart).
function apply_roots()
{
	if ( page && running )
	{
		page.SetRoots( [ { Key: 'server', Url: running.Url } ] );
	}
}


function page_url( Hash )
{
	return page.Url + '/' + ( Hash || '' );
}


function boot_info()
{
	return {
		Base: '',		// the page's own origin: Page.js forwards /servers/server/api to the server
		Version: VERSION,
		Theme: window_settings.Theme,
		Scale: window_settings.Scale,
		Remembered: window_settings.Remembered,
		Roots: [ root() ],
		License: USER.Tier(),
		Project: null,
		Recent: [],
		Reason: null,
		Edition: 'server',
	};
}


//---------------------------------------------------------------------
// The window and the tray

function window_options( Width, Height )
{
	return WINDOWS.Options( { Width: Width, Height: Height, Title: TITLE, Icon: ICON, Theme: window_settings.Theme, DarkThemes: SETTINGS.DARK_THEMES, Preload: PRELOAD } );
}


// The window, of the shared kind (electron/Windows.js). Closing it hides it: the Server keeps serving from the tray
// until its Quit, which asks the page first and then closes the window without asking again.
function create_window()
{
	window = new ELECTRON.BrowserWindow( window_options( 1400, 900 ) );
	attached = WINDOWS.Attach( window, {
		PageUrl: function () { return page ? page.Url : null; },
		Icon: ICON,
		Preload: PRELOAD,
		Options: window_options,
		CloseAction: function () { return quitting ? 'close' : 'hide'; },
		OnClosed: function () { window = null; attached = null; },
	} );
}


function show_page( Hash )
{
	if ( !window || window.isDestroyed() || !running || !page )
	{
		return;
	}
	window.loadURL( page_url( Hash ) );
	show_window();
}


function show_window()
{
	if ( !window || window.isDestroyed() )
	{
		return;
	}
	if ( window.isMinimized() )
	{
		window.restore();
	}
	window.show();
	window.focus();
}


// The tray's Quit: the page asked about its unsaved edits first (the window may be hidden; its page still answers),
// then the app quits, which closes the server.
function quit_asking()
{
	if ( attached && window && !window.isDestroyed() )
	{
		attached.AskClose( function () { ELECTRON.app.quit(); } );
		return;
	}
	ELECTRON.app.quit();
}


function tray_tip()
{
	if ( !running )
	{
		return TITLE;
	}
	let state = running.Gate ? running.Gate.State() : { Open: true };
	return TITLE + ' at ' + running.Url + '/' + ( state.Open ? '' : ' (waiting for its Administrator)' );
}


function refresh_tray()
{
	if ( !tray )
	{
		return;
	}
	tray.setToolTip( tray_tip() );
	tray.setContextMenu( ELECTRON.Menu.buildFromTemplate( [
		{ label: 'Open ' + TITLE, click: show_window },
		{ label: running ? running.Url + '/' : 'not serving', enabled: false },
		{ type: 'separator' },
		{ label: 'Quit', click: quit_asking },
	] ) );
}


function create_tray()
{
	tray = new ELECTRON.Tray( ICON );
	tray.on( 'click', show_window );
	refresh_tray();
}


//---------------------------------------------------------------------
// The bridge (preload.js): the common handlers (electron/App.js), then the Server's own.

function attach_handlers()
{
	APP.AttachHandlers( {
		Boot: boot_info,
		Settings: function () { return window_settings; },
		Saver: SAVER,
		Roots: function () { return [ root() ]; },
		NewWindow: show_window,		// one window: New window brings it forward
		Protected: [ APP.PAGE_PORT ],
	} );

	ELECTRON.ipcMain.handle( 'set-license', async function ( event, token )
	{
		let answer = await USER.SetLicense( token, running ? running.Settings : {} );
		if ( answer.Error )
		{
			return Object.assign( answer.Tier, { Error: answer.Error } );
		}
		// the same user checked again changes nothing but Checked: the page is not reloaded for it; a first sign-in,
		// with no record before, is never the same (plan Review 2026-10-29, Step 1)
		let was_open = running && running.Gate ? running.Gate.Open() : true;
		let same = LICENSE.SameUser( answer.Before, answer.Record );
		if ( running && running.Gate )
		{
			await running.Gate.Check();
		}
		if ( !same || was_open !== ( running && running.Gate ? running.Gate.Open() : true ) )
		{
			setTimeout( function () { recheck().catch( function ( error ) { console.error( error.message ); } ); }, 0 );
		}
		return USER.Tier();
	} );

	ELECTRON.ipcMain.handle( 'clear-license', async function ()
	{
		USER.Clear();
		setTimeout( function () { recheck().catch( function ( error ) { console.error( error.message ); } ); }, 0 );
		return USER.Tier();
	} );

	// The folder picker for a new project's folder (tree.js).
	ELECTRON.ipcMain.handle( 'folder', function ( event, current )
	{
		return WINDOWS.PickFolder( window, current );
	} );
}


//---------------------------------------------------------------------
// The start

async function main()
{
	let own = null;
	try
	{
		own = own_arguments( process.argv );
		options = START.Parse( own.Arguments );
	}
	catch ( error )
	{
		APP.FailToStart( TITLE, error.message + '\n\n' + USAGE, process.argv.includes( '--headless' ) );
		return;
	}
	if ( options.Help )
	{
		console.log( USAGE );
		ELECTRON.app.exit( 0 );
		return;
	}
	if ( options.Project !== undefined )
	{
		APP.FailToStart( TITLE, 'the Server serves every registered project: --open <folder> registers one\n\n' + USAGE, options.Headless );
		return;
	}
	// One Server per machine: a second launch hands its --open and folder to the first.
	if ( !ELECTRON.app.requestSingleInstanceLock( { Open: own.Open, Cwd: process.cwd() } ) )
	{
		console.log( 'the Server runs already: handed over to it' );
		ELECTRON.app.exit( 0 );
		return;
	}
	ELECTRON.app.on( 'second-instance', function ( event, argv, cwd, data )
	{
		let handed = ( data && typeof data === 'object' ) ? data : null;
		if ( !handed )
		{
			try
			{
				handed = own_arguments( argv );
			}
			catch ( error )
			{
				handed = { Open: null };
			}
		}
		if ( handed.Open && running )
		{
			open_folder( handed.Open, handed.Cwd || cwd ).then( function ( answer )
			{
				if ( answer && answer.Error )
				{
					console.error( answer.Error );
				}
			} );
			return;
		}
		show_window();
	} );
	await ELECTRON.app.whenReady();
	if ( !options.Headless )
	{
		let loaded = SETTINGS.Load( config_folder() );
		window_settings = loaded.Settings;
		loaded.Lines.forEach( function ( line ) { console.log( line ); } );
		WINDOWS.ApplyNativeTheme( window_settings.Theme, SETTINGS.DARK_THEMES );
		attach_handlers();
	}
	await start_server();
	ELECTRON.app.on( 'before-quit', function ( event )
	{
		if ( quitting )
		{
			return;
		}
		quitting = true;
		event.preventDefault();
		SAVER.Flush();
		let closing = Promise.resolve().then( function () { return page ? page.Close() : null; } ).catch( function () {} ).then( function () { return running ? running.Close() : null; } );
		closing.catch( function () {} ).then( function () { ELECTRON.app.exit( 0 ); } );
	} );
	if ( options.Headless )
	{
		console.log( 'no window (--headless); Ctrl+C stops the Server' );
		process.on( 'SIGINT', function () { ELECTRON.app.quit(); } );
		process.on( 'SIGTERM', function () { ELECTRON.app.quit(); } );
		if ( own.Open )
		{
			await open_folder( own.Open );
		}
		return;
	}
	// the page server, the window and the tray: closing the window keeps the Server; the app ends at the tray's Quit
	page = await APP.ServePage( { Settings: window_settings, Saver: SAVER } );
	apply_roots();
	console.log( TITLE + ': the page on ' + page.Url );
	ELECTRON.app.on( 'window-all-closed', function () {} );
	create_window();
	create_tray();
	if ( own.Open )
	{
		let answer = await open_folder( own.Open );
		if ( answer && answer.Error )
		{
			console.error( answer.Error );
			show_page();
		}
		return;
	}
	show_page();
}


main().catch( function ( error )
{
	APP.FailToStart( TITLE, error.message, process.argv.includes( '--headless' ) );
} );
