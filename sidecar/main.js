'use strict';

// main - Sidecar's main process (plan Sidecar Edition, Step 1): a new app beside Desktop and the Server, simpler than
// Desktop. A window holds one local project folder and nothing else: no Server, no sign-in, no license, no users, no
// LLM connections, tasks or runs. The window's server is the sidecar over the folder (src/Server.js with the settings
// given, its port hashed from the folder into 52000 to 52999, no address file); the LLM session beside it connects
// through the project's LLM Instructions, pasted into it. Each window is its own process; a second window on the same
// folder is the user's own business. Started with no folder, Sidecar shows the folder dialog, and Cancel quits.
// The window parts and the page server are shared with Desktop (electron/Windows.js, electron/Page.js). Step 2: the
// settings are the project's .consensus/sidecar.json (Settings.js): the user, the look and the view state; the user is
// the server's owner, renamed in place from the project's Settings (set-user). Step 3: the instructions serve
// Sidecar's own guide (.guides/build-with-sidecar.md).
//
//   npm run sidecar -- [<folder>] [--port <port>]

const PATH = require( 'path' );
const CHILD_PROCESS = require( 'child_process' );
const ELECTRON = require( 'electron' );
const SERVER = require( '../src/Server.js' );
const SIDECAR = require( '../src/Sidecar.js' );
const INSTRUCTIONS = require( '../src/Instructions.js' );
const PAGE = require( '../electron/Page.js' );
const WINDOWS = require( '../electron/Windows.js' );
const SETTINGS = require( './Settings.js' );

const VERSION = require( '../package.json' ).version;
const TITLE = 'Consensus Sidecar';
const ICON = PATH.join( __dirname, '..', 'desktop', 'icon.ico' );
const PRELOAD = PATH.join( __dirname, 'preload.js' );
const USAGE = 'usage: consensus-sidecar [<folder>] [--port <port>]';
const DARK_THEMES = SETTINGS.DARK_THEMES;
const SAVE_DELAY = 300;		// the view state changes often (a fold, a tab): written a moment after the last change
// Electron's own switches, which stay on the command line the app parses.
const ELECTRON_SWITCH = /^--(remote-debugging-port|user-data-dir|inspect|enable-logging|no-sandbox|disable-gpu|trace-warnings)/;

let options = null;		// { Folder, Port }
let sidecar = null;		// the project's sidecar.json, filled: { User, Theme, Scale, Remembered }
let folder = null;		// the window's project folder
let save_timer = null;
let running = null;		// src/Server.js's: the sidecar over the folder
let page = null;		// electron/Page.js's
let window = null;


//---------------------------------------------------------------------
// The settings: the project's .consensus/sidecar.json

function save_settings()
{
	if ( save_timer )
	{
		clearTimeout( save_timer );
		save_timer = null;
	}
	try
	{
		SETTINGS.Write( folder, sidecar );
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


// The user renamed: the file written, and the server's owner renamed in place (the settings the API reads at each
// request, and the owner's record). Answers { User } or { Error }.
function set_user( Text )
{
	let user = SETTINGS.CleanUser( Text );
	if ( !user )
	{
		return { Error: 'a name is one to ' + SETTINGS.USER_LIMIT + ' characters' };
	}
	sidecar.User = user;
	save_settings();
	running.Settings.Owner = { Name: user, Display: user };
	running.Users.Prepare( running.Settings );
	return { User: user };
}


// The server's settings, from Sidecar's: the user is the owner, under one name.
function server_settings()
{
	return {
		Name: TITLE,
		Owner: { Name: sidecar.User, Display: sidecar.User },
	};
}


//---------------------------------------------------------------------
// The arguments: after the executable (and, from the checkout, the app folder), Electron's switches left out.

function parse_arguments( argv )
{
	let list = argv.slice( ELECTRON.app.isPackaged ? 1 : 2 ).filter( function ( argument ) { return !ELECTRON_SWITCH.test( argument ); } );
	let parsed = { Folder: null, Port: undefined, Help: false };
	for ( let index = 0; index < list.length; index++ )
	{
		let argument = list[ index ];
		if ( argument === '--help' || argument === '-h' )
		{
			parsed.Help = true;
		}
		else if ( argument === '--port' )
		{
			let port = Number( list[ index + 1 ] );
			if ( !Number.isInteger( port ) || port < 0 || port > 65535 )
			{
				throw new Error( '--port needs a port number' );
			}
			parsed.Port = port;
			index++;
		}
		else if ( argument.startsWith( '--' ) )
		{
			throw new Error( 'not an argument Sidecar knows: ' + argument );
		}
		else if ( parsed.Folder === null )
		{
			parsed.Folder = argument;
		}
		else
		{
			throw new Error( 'one folder only: ' + argument );
		}
	}
	return parsed;
}


//---------------------------------------------------------------------
// The project

function root()
{
	return { Key: 'local', Name: TITLE, Url: running.Url, Kind: 'local', Version: VERSION, StoredKey: SIDECAR.Normalize( running.Project.Path ) };
}


function project_info()
{
	return {
		Id: running.Project.Id,
		Name: running.Project.Name,
		Path: running.Project.Path.replace( /\\/g, '/' ),
		Host: null,
		Routed: false,
		Key: SIDECAR.Normalize( running.Project.Path ),
	};
}


// The sidecar over the folder: its .consensus made when missing, read-only toward any config folder (its own
// .consensus stands in for one, and nothing of it is read as settings).
async function start_server()
{
	return SERVER.Start( {
		Project: folder,
		Config: PATH.join( folder, '.consensus' ),
		ReadOnly: true,
		Settings: server_settings(),
		Ports: SIDECAR.SIDECAR_APP_RANGE,
		AddressFile: false,
		Guide: INSTRUCTIONS.SIDECAR_GUIDE_PATH,
		Port: options.Port,
	} );
}


//---------------------------------------------------------------------
// The window

function boot_info()
{
	return {
		Base: '',		// the page's own origin: Page.js forwards /api to the window's server
		Version: VERSION,
		Theme: sidecar.Theme,
		Scale: sidecar.Scale,
		Remembered: sidecar.Remembered,
		Roots: [ root() ],
		License: null,
		Project: project_info(),
		Recent: [],
		Reason: null,
		Sidecar: true,
		User: sidecar.User,
	};
}


function window_options( Width, Height )
{
	return WINDOWS.Options( { Width: Width, Height: Height, Title: TITLE, Icon: ICON, Theme: sidecar.Theme, DarkThemes: DARK_THEMES, Preload: PRELOAD } );
}


function create_window()
{
	window = new ELECTRON.BrowserWindow( window_options( 1400, 900 ) );
	WINDOWS.Attach( window, {
		PageUrl: function () { return page ? page.Url : null; },
		Icon: ICON,
		Preload: PRELOAD,
		Options: window_options,
		OnClosed: function () { window = null; },
	} );
	window.loadURL( page.Url + '/' );
}


function build_menu()
{
	WINDOWS.BuildMenu( {
		NewWindow: function () { new_window( [] ); },
		OpenFolderWindow: function () { open_folder_window( window ); },
		Reload: function () { if ( window ) { window.webContents.reload(); } },
	} );
}


// Another Sidecar, a process of its own: on a folder, or on none (the folder dialog first).
function new_window( Arguments )
{
	let leading = ELECTRON.app.isPackaged ? [] : [ ELECTRON.app.getAppPath() ];
	let child = CHILD_PROCESS.spawn( process.execPath, leading.concat( Arguments || [] ), { detached: true, stdio: 'ignore' } );
	child.unref();
}


async function open_folder_window( owner )
{
	let picked = await WINDOWS.PickFolder( owner, null );
	if ( picked )
	{
		new_window( [ picked ] );
	}
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
		if ( !change || typeof change.Key !== 'string' )
		{
			return;
		}
		if ( change.Value === null || change.Value === undefined )
		{
			delete sidecar.Remembered[ change.Key ];
		}
		else
		{
			sidecar.Remembered[ change.Key ] = change.Value;
		}
		save_settings_soon();
	} );

	ELECTRON.ipcMain.on( 'theme', function ( event, change )
	{
		if ( change && SETTINGS.THEMES.includes( change.Theme ) )
		{
			sidecar.Theme = change.Theme;
		}
		if ( change && SETTINGS.SCALES.includes( change.Scale ) )
		{
			sidecar.Scale = change.Scale;
		}
		save_settings();
		WINDOWS.ApplyNativeTheme( sidecar.Theme, DARK_THEMES );
	} );

	ELECTRON.ipcMain.handle( 'folder', function ( event, current_folder )
	{
		return WINDOWS.PickFolder( ELECTRON.BrowserWindow.fromWebContents( event.sender ), current_folder );
	} );

	ELECTRON.ipcMain.handle( 'new-window', function ()
	{
		new_window( [] );
		return {};
	} );

	ELECTRON.ipcMain.handle( 'open-folder-window', async function ( event )
	{
		await open_folder_window( ELECTRON.BrowserWindow.fromWebContents( event.sender ) );
		return {};
	} );

	ELECTRON.ipcMain.handle( 'print-pdf', async function ( event, name )
	{
		let remembered = sidecar.Remembered[ 'report-folder' ];
		let answer = await WINDOWS.PrintToPdf( event.sender, name, ( typeof remembered === 'string' ) ? remembered : null );
		if ( answer.Path )
		{
			sidecar.Remembered[ 'report-folder' ] = PATH.dirname( answer.Path );
			save_settings_soon();
		}
		return answer;
	} );

	ELECTRON.ipcMain.handle( 'view-in-browser', function ( event )
	{
		return WINDOWS.ViewInBrowser( event.sender.getURL(), [ root() ] );
	} );

	// The project's Settings: the name the user goes by.
	ELECTRON.ipcMain.handle( 'set-user', function ( event, text )
	{
		return set_user( text );
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
	let picked = options.Folder;
	if ( !picked )
	{
		picked = await WINDOWS.PickFolder( null, null );
		if ( !picked )
		{
			ELECTRON.app.exit( 0 );
			return;
		}
	}
	folder = PATH.resolve( picked );
	let loaded = SETTINGS.Load( folder );
	sidecar = loaded.Settings;
	loaded.Lines.forEach( function ( line ) { console.log( line ); } );
	WINDOWS.ApplyNativeTheme( sidecar.Theme, DARK_THEMES );
	try
	{
		running = await start_server();
	}
	catch ( error )
	{
		fail_to_start( error.message );
		return;
	}
	console.log( 'Sidecar on ' + running.Project.Path + ': ' + running.Url + ( running.PortTaken ? ' (port ' + running.PortTaken + ' was taken)' : '' ) );
	page = await PAGE.Serve();
	page.SetRoots( [ { Key: 'local', Url: running.Url } ] );
	attach_handlers();
	build_menu();
	create_window();
	ELECTRON.app.on( 'window-all-closed', function ()
	{
		if ( save_timer )
		{
			save_settings();
		}
		page.Close().catch( function () {} ).then( function () { return running.Close(); } ).catch( function () {} ).then( function () { ELECTRON.app.quit(); } );
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
