'use strict';

// main - the Server application's main process (plan The Server, Step 3). The Server runs the server in this process
// over every registered project (src/Start.js, the same as `consensus serve`), under the authority of its
// Administrator (src/Gate.js); its window shows the server's own page at its loopback address, the whole tree with
// the management parts open to the Administrator and the Managers. One Server per machine: a second launch hands its
// arguments to the first and quits. Closing the window hides it; the tray icon brings it back, and the tray's Quit
// ends the Server. --open <folder> (the file explorer's "Open in Consensus Server") registers the folder as a project,
// or finds it when it is registered already, and shows it. --headless runs the server with no window and no tray: a
// headless gate, which also takes the Administrator's account in Users.json for its authority.
//
// The window's gate: the machine's current user (<config>/user.json) must be the Administrator, or the first licensed
// user when there is none yet, with Personal or Professional. While it is closed, and while the license is Personal,
// the server listens on this machine alone (Scope Local, whatever the file says), so the window can sign in; a
// sign-in in the window writes the current user, the gate is checked again, and the server starts again on the
// file's Scope when that changed what it may listen on.
//
//   consensus-server [--open <folder>] [--config <folder>] [--port <port>] [--scope none|local|public] [--headless]

const FS = require( 'fs' );
const PATH = require( 'path' );
const ELECTRON = require( 'electron' );
const START = require( '../src/Start.js' );
const SERVER = require( '../src/Server.js' );
const LICENSE = require( '../src/License.js' );

const VERSION = require( '../package.json' ).version;
const ICON = PATH.join( __dirname, '..', 'desktop', 'icon.ico' );
const OPEN_ARGUMENT = '--open';
const USAGE = 'usage: consensus-server [--open <folder>] [--config <folder>] [--port <port>] [--scope none|local|public] [--headless]';
// Electron's own switches, which stay on the command line the app parses.
const ELECTRON_SWITCH = /^--(remote-debugging-port|user-data-dir|inspect|enable-logging|no-sandbox|disable-gpu|trace-warnings|allow-file-access)/;

let options = null;		// the command line's (src/Start.js)
let running = null;		// src/Server.js's, from START.Run
let window = null;
let tray = null;
let quitting = false;


//---------------------------------------------------------------------
// The command line

// The arguments after the app's: Electron's own switches dropped, --open <folder> taken out.
function own_arguments( argv )
{
	let rest = ELECTRON.app.isPackaged ? argv.slice( 1 ) : argv.slice( 2 );
	let open = null;
	let kept = [];
	for ( let index = 0; index < rest.length; index++ )
	{
		let argument = rest[ index ];
		if ( ELECTRON_SWITCH.test( argument ) )
		{
			continue;
		}
		if ( argument === OPEN_ARGUMENT )
		{
			open = rest[ index + 1 ] || null;
			index++;
			continue;
		}
		kept.push( argument );
	}
	return { Open: open, Arguments: kept };
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


function page_url( Hash )
{
	return 'http://127.0.0.1:' + running.Address.Port + '/' + ( Hash || '' );
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
// The window and the tray

function create_window()
{
	window = new ELECTRON.BrowserWindow( {
		width: 1400,
		height: 900,
		title: 'Consensus Server',
		icon: ICON,
		show: false,
		webPreferences: { preload: PATH.join( __dirname, 'preload.js' ), contextIsolation: true, nodeIntegration: false },
	} );
	window.setMenuBarVisibility( false );
	// links to other origins open in the system browser; the page's own windows (a report, a detached tab) stay the app's
	window.webContents.setWindowOpenHandler( function ( details )
	{
		if ( running && details.url.startsWith( page_url() ) )
		{
			return { action: 'allow', overrideBrowserWindowOptions: { width: 1000, height: 800, icon: ICON, webPreferences: { preload: PATH.join( __dirname, 'preload.js' ), contextIsolation: true } } };
		}
		ELECTRON.shell.openExternal( details.url );
		return { action: 'deny' };
	} );
	window.once( 'ready-to-show', function () { window.show(); } );
	// Closing the window hides it: the Server keeps serving from the tray until its Quit.
	window.on( 'close', function ( event )
	{
		if ( !quitting )
		{
			event.preventDefault();
			window.hide();
		}
	} );
	window.on( 'closed', function ()
	{
		window = null;
	} );
}


function show_page( Hash )
{
	if ( !window || window.isDestroyed() || !running )
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


function tray_tip()
{
	if ( !running )
	{
		return 'Consensus Server';
	}
	let state = running.Gate ? running.Gate.State() : { Open: true };
	return 'Consensus Server at ' + running.Url + '/' + ( state.Open ? '' : ' (waiting for its Administrator)' );
}


function refresh_tray()
{
	if ( !tray )
	{
		return;
	}
	tray.setToolTip( tray_tip() );
	tray.setContextMenu( ELECTRON.Menu.buildFromTemplate( [
		{ label: 'Open Consensus Server', click: show_window },
		{ label: running ? running.Url + '/' : 'not serving', enabled: false },
		{ type: 'separator' },
		{ label: 'Quit', click: function () { ELECTRON.app.quit(); } },
	] ) );
}


function create_tray()
{
	tray = new ELECTRON.Tray( ICON );
	tray.on( 'click', show_window );
	refresh_tray();
}


//---------------------------------------------------------------------
// The bridge (preload.js)

function attach_handlers()
{
	ELECTRON.ipcMain.on( 'server-boot', function ( event )
	{
		event.returnValue = { Version: VERSION, License: tier_now() };
	} );
	ELECTRON.ipcMain.handle( 'set-license', async function ( event, token )
	{
		let record = null;
		try
		{
			record = await LICENSE.Verify( String( token || '' ), { Settings: running ? running.Settings : {} } );
		}
		catch ( error )
		{
			return Object.assign( tier_now(), { Error: 'the sign-in could not be verified: ' + error.message } );
		}
		if ( !record )
		{
			return Object.assign( tier_now(), { Error: 'the sign-in could not be verified' } );
		}
		let before = JSON.stringify( LICENSE.Read( config_folder() ) );
		LICENSE.Write( config_folder(), record );
		console.log( 'signed in: ' + LICENSE.Line( record ) );
		// the same user checked again changes nothing but Checked: the page is not reloaded for it
		let was_open = running && running.Gate ? running.Gate.Open() : true;
		let same = before && JSON.parse( before ).Clerk === record.Clerk && JSON.parse( before ).Plan === record.Plan;
		if ( running && running.Gate )
		{
			await running.Gate.Check();
		}
		if ( !same || was_open !== ( running && running.Gate ? running.Gate.Open() : true ) )
		{
			setTimeout( function () { recheck().catch( function ( error ) { console.error( error.message ); } ); }, 0 );
		}
		return tier_now();
	} );
	ELECTRON.ipcMain.handle( 'clear-license', async function ()
	{
		LICENSE.Remove( config_folder() );
		console.log( 'signed out' );
		setTimeout( function () { recheck().catch( function ( error ) { console.error( error.message ); } ); }, 0 );
		return tier_now();
	} );
	ELECTRON.ipcMain.handle( 'folder', async function ( event, current )
	{
		let picker_options = { properties: [ 'openDirectory', 'createDirectory' ] };
		if ( current )
		{
			picker_options.defaultPath = current;
		}
		let picked = await ELECTRON.dialog.showOpenDialog( window, picker_options );
		if ( picked.canceled || !picked.filePaths.length )
		{
			return null;
		}
		return picked.filePaths[ 0 ].replace( /\\/g, '/' );
	} );
}


function tier_now()
{
	let record = LICENSE.Read( config_folder() );
	let tier = LICENSE.Tier( record );
	return { Tier: tier.Tier, Rank: tier.Rank, Plan: tier.Plan, Email: tier.Email, Display: tier.Display, Days: tier.Days, Until: tier.Until, Checked: tier.Checked, Lapsed: tier.Lapsed, Line: LICENSE.Line( record ) };
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
		console.error( error.message );
		console.error( USAGE );
		fail_to_start( error.message + '\n\n' + USAGE, process.argv.includes( '--headless' ) );
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
		fail_to_start( 'the Server serves every registered project: --open <folder> registers one\n\n' + USAGE, options.Headless );
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
		let handed = ( data && typeof data === 'object' ) ? data : own_arguments( argv );
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
		let closing = running ? running.Close() : Promise.resolve();
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
	// the window and the tray: closing the window keeps the Server; the app ends at the tray's Quit
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


// A start that fails: the message on the console, and in a dialog unless --headless.
function fail_to_start( message, headless )
{
	if ( !headless )
	{
		ELECTRON.dialog.showErrorBox( 'Consensus Server could not start', message );
	}
	ELECTRON.app.exit( 1 );
}


main().catch( function ( error )
{
	console.error( error.message );
	fail_to_start( error.message, process.argv.includes( '--headless' ) );
} );
