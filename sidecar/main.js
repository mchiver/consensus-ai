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
// Sidecar's own guide (.guides/build-with-sidecar.md). Plan Review 2026-10-29, Step 2: the command line, the saving,
// the common bridge handlers and the shutdown are electron/App.js's; this file keeps what is Sidecar's own.
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
const APP = require( '../electron/App.js' );
const SETTINGS = require( './Settings.js' );

const VERSION = require( '../package.json' ).version;
const TITLE = 'Consensus Sidecar';
const ICON = PATH.join( __dirname, '..', 'desktop', 'icon.ico' );
const PRELOAD = PATH.join( __dirname, 'preload.js' );
const USAGE = 'usage: consensus-sidecar [<folder>] [--port <port>]';
const FLAGS = [
	{ Name: '--port', Takes: 'number', Key: 'Port', Needs: 'a port number' },
	{ Name: '--help', Alias: '-h', Takes: 'flag', Key: 'Help' },
];

let options = null;		// { Folder, Port, Help }
let sidecar = null;		// the project's sidecar.json, filled: { User, Theme, Scale, Remembered }
let folder = null;		// the window's project folder
let running = null;		// src/Server.js's: the sidecar over the folder
let page = null;		// electron/Page.js's
let window = null;

// The settings saved: now, or a moment after the last change (the view state changes often: a fold, a tab).
const SAVER = APP.Saver( { Write: function () { SETTINGS.Write( folder, sidecar ); }, Label: SETTINGS.FILE } );


//---------------------------------------------------------------------
// The settings: the project's .consensus/sidecar.json

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
	SAVER.Save();
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
// The arguments: one folder and --port (electron/App.js).

function parse_arguments( argv )
{
	let parsed = APP.Arguments( argv, { Title: 'Sidecar', Positional: true, Flags: FLAGS } );
	return { Folder: parsed.Positional, Port: ( parsed.Options.Port === null ) ? undefined : parsed.Options.Port, Help: parsed.Options.Help };
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
	return WINDOWS.Options( { Width: Width, Height: Height, Title: TITLE, Icon: ICON, Theme: sidecar.Theme, DarkThemes: SETTINGS.DARK_THEMES, Preload: PRELOAD } );
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
// The bridge's handlers: the common ones (electron/App.js), then Sidecar's own.

function attach_handlers()
{
	APP.AttachHandlers( {
		Boot: boot_info,
		Settings: function () { return sidecar; },
		Saver: SAVER,
		Roots: function () { return [ root() ]; },
		NewWindow: function () { new_window( [] ); },
	} );

	ELECTRON.ipcMain.handle( 'folder', function ( event, current_folder )
	{
		return WINDOWS.PickFolder( ELECTRON.BrowserWindow.fromWebContents( event.sender ), current_folder );
	} );

	ELECTRON.ipcMain.handle( 'open-folder-window', async function ( event )
	{
		await open_folder_window( ELECTRON.BrowserWindow.fromWebContents( event.sender ) );
		return {};
	} );

	// The project's Settings: the name the user goes by.
	ELECTRON.ipcMain.handle( 'set-user', function ( event, text )
	{
		return set_user( text );
	} );
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
		APP.FailToStart( TITLE, error.message + '\n\n' + USAGE );
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
	WINDOWS.ApplyNativeTheme( sidecar.Theme, SETTINGS.DARK_THEMES );
	try
	{
		running = await start_server();
	}
	catch ( error )
	{
		APP.FailToStart( TITLE, error.message );
		return;
	}
	console.log( 'Sidecar on ' + running.Project.Path + ': ' + running.Url + ( running.PortTaken ? ' (port ' + running.PortTaken + ' was taken)' : '' ) );
	page = await PAGE.Serve();
	page.SetRoots( [ { Key: 'local', Url: running.Url } ] );
	attach_handlers();
	build_menu();
	create_window();
	APP.AttachShutdown( {
		Saver: SAVER,
		Close: async function ()
		{
			await page.Close().catch( function () {} );
			await running.Close();
		},
	} );
}


main().catch( function ( error )
{
	APP.FailToStart( TITLE, error.message );
} );
