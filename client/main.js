'use strict';

// main - the Client's main process (plan Review 2026-10-29, Step 5.1: the editions cut). The Client opens one remote
// project on one Consensus Server per window: it took the desktop code of before (plan Consensus Desktop, Step 2; plan
// Rearchitecturation, Step 2: a window is one project), narrowed, the Desktop taking the Client's code base. A saved
// Server named on the command line (--connect <server> [<project>]) opens that project, else the window shows the
// chooser (page/connect.html): the saved Servers, each with its last project (client.json, Settings.js), and Connect to
// Server (an address tried, src/Probe.js, then one of its projects picked), each opening in this window; another
// project is another instance (New window opens another chooser). The page is served by the page server
// (electron/Page.js) on 127.0.0.1, which forwards the page's API calls to the Server through the app's own origin
// (/servers/<key>). The Server signs the person in on its page (session.js takes the window's one Server root as its
// own; a Server takes no bare request) and the sign-in's token is handed here (set-license), verified and written as
// the machine's current user (electron/CurrentUser.js), shared with the Server application on the same machine:
// Registered is the minimum, which any sign-in is. No local folder, no server of its own, no address file and no
// port: the desktop code's folder opening, New project, the recent folders, the routing to this machine's Server
// (desktop/ServerStatus.js) and the start module are gone. Plan UI Components, Step 5: the window has no frame of its
// own (Electron's window buttons over the page's title bar, the bar the drag region, the native menu set for its
// accelerators alone); the window parts are electron/Windows.js's and the command line, the saving, the common bridge
// handlers, the page server on its remembered port and the shutdown electron/App.js's.
//
//   npm run client -- [--connect <server> [<project>]] [--config <folder>]

const PATH = require( 'path' );
const CHILD_PROCESS = require( 'child_process' );
const ELECTRON = require( 'electron' );
const SETTINGS = require( './Settings.js' );
const PROJECTS = require( './Projects.js' );
const PROBE = require( '../src/Probe.js' );
const SERVER = require( '../src/Server.js' );
const WINDOWS = require( '../electron/Windows.js' );
const APP = require( '../electron/App.js' );
const SERVERS = require( '../electron/Servers.js' );
const CURRENT_USER = require( '../electron/CurrentUser.js' );

const VERSION = require( '../package.json' ).version;
const TITLE = 'Consensus Client';
const PRELOAD = PATH.join( __dirname, 'preload.js' );
const CONNECT_FOLDER = PATH.join( __dirname, 'page' );		// the chooser, served beside the page
const ICON = PATH.join( __dirname, '..', 'desktop', 'icon.ico' );
const TRY_TIMEOUT = 5000;
const USAGE = 'usage: consensus-client [--connect <server> [<project>]] [--config <folder>]';
const FLAGS = [
	{ Name: '--connect', Takes: 'value', Key: 'Connect', Needs: 'the Name of a saved Server' },
	{ Name: '--config', Takes: 'value', Key: 'Config', Needs: 'a folder' },
	{ Name: '--help', Alias: '-h', Takes: 'flag', Key: 'Help' },
];

let options = null;		// { Connect, Project, Config, Help }
let client = null;		// client.json, filled: { Servers, Theme, Scale, Remembered }
let client_path = null;
let opened = null;		// the window's project: { Server: { Name, Url }, Project: { Id, Name } or null for the whole Server }
let page = null;
let window = null;
let reason = null;		// why the project asked for could not open, for the chooser
let pick = null;		// the saved Server whose projects the chooser lists first (--connect with no project known)

// The settings saved: now, or a moment after the last change (the view state changes often: a fold, a tab).
const SAVER = APP.Saver( { Write: function () { SETTINGS.Write( config_folder(), client ); }, Label: SETTINGS.FILE } );
// The machine's current user (plan The Server, Step 1): <config>/user.json, shared with the Server (electron/CurrentUser.js).
const USER = CURRENT_USER.Make( config_folder );


//---------------------------------------------------------------------
// The settings: <config>/client.json

function config_folder()
{
	return ( options && options.Config ) ? options.Config : SERVER.DEFAULT_CONFIG;
}


//---------------------------------------------------------------------
// The arguments (electron/App.js): --connect <server> [<project>] and --config. The one bare argument allowed is the
// project after --connect; a bare folder, the desktop's line of before, is refused: the Client opens no folder.

function parse_arguments( argv )
{
	let parsed = APP.Arguments( argv, { Title: 'the Client', Flags: FLAGS, Positional: true, PositionalName: 'project' } );
	if ( parsed.Positional !== null && !parsed.Options.Connect )
	{
		throw new Error( 'not an argument the Client knows: ' + parsed.Positional );
	}
	return {
		Connect: parsed.Options.Connect,
		Project: parsed.Positional,
		Config: parsed.Options.Config ? PATH.resolve( parsed.Options.Config ) : null,
		Help: parsed.Options.Help,
	};
}


//---------------------------------------------------------------------
// The window's project: the one root the page shows, and what the page is told.

function roots_now()
{
	if ( !opened )
	{
		return [];
	}
	return [ { Key: opened.Server.Name, Name: opened.Server.Name, Url: opened.Server.Url, Kind: 'server', StoredKey: PROJECTS.Key( opened.Server, opened.Project ) } ];
}


// The project as the page and the chooser see it, or null (and null for a window on a whole Server, plan The Server,
// Step 5: the page then shows the Server's projects).
function project_info()
{
	if ( !opened || !opened.Project )
	{
		return null;
	}
	return {
		Id: opened.Project.Id,
		Name: opened.Project.Name,
		Path: null,
		Host: opened.Server.Name,
		Key: PROJECTS.Key( opened.Server, opened.Project ),
	};
}


// The page server forwards to the root as it stands now.
function apply_roots()
{
	if ( page )
	{
		page.SetRoots( roots_now().map( function ( root ) { return { Key: root.Key, Url: root.Url }; } ) );
	}
}


// A Server's project opened in this window: the Server tried, the project found among its projects (by id, else by
// name), the Server saved with that project as its last. A Server that asks for a sign-in cannot list its projects
// first (plan The Server, Step 5): the project named is taken as given, or the window shows the whole Server, whose
// page signs in and lists the projects the person may see. Answers { Ok, Project } or { Error }.
async function connect_server_here( Entry )
{
	if ( opened )
	{
		return { Error: 'this window has a project open: open another in a new window' };
	}
	let entry = Entry || {};
	let name = SERVERS.CleanName( entry.Name );
	if ( !name )
	{
		return { Error: 'a Server\'s name is one to ' + SERVERS.NAME_LIMIT + ' characters, with no slash' };
	}
	let tried = await PROBE.Probe( entry.Url, { Timeout: TRY_TIMEOUT } );
	if ( !tried.Ok )
	{
		return { Error: tried.Error };
	}
	let project = null;
	if ( entry.Project )
	{
		if ( tried.SignIn )
		{
			project = { Id: String( entry.Project ), Name: String( entry.Title || entry.Project ) };
		}
		else
		{
			let projects = [];
			try
			{
				projects = await PROJECTS.ServerProjects( tried.Url, TRY_TIMEOUT );
			}
			catch ( error )
			{
				return { Error: error.message };
			}
			project = PROJECTS.FindProject( projects, entry.Project );
			if ( !project )
			{
				return { Error: 'no project "' + entry.Project + '" on ' + name + ' (' + tried.Url + ')' };
			}
		}
	}
	let saved = save_server( name, tried.Url, project );
	if ( saved.Error )
	{
		return saved;
	}
	opened = { Server: { Name: saved.Server.Name, Url: saved.Server.Url }, Project: project };
	console.log( 'connected to ' + saved.Server.Name + ' at ' + saved.Server.Url + ( project ? ', project ' + project.Name : ', the whole Server' ) );
	return { Ok: true, Project: project_info() };
}


// The Server saved under its name with the project as its last: a new entry, or the entry of that name with the
// address as tried. Answers { Server } or { Error } (the address listed under another name).
function save_server( Name, Url, Project )
{
	let server = SERVERS.Named( client, Name );
	if ( !server )
	{
		let added = SERVERS.AddServer( client, { Name: Name, Url: Url } );
		if ( added.Error )
		{
			return added;
		}
		server = added.Server;
	}
	else
	{
		server.Url = Url;
	}
	SERVERS.SetProject( client, server.Name, Project ? Project.Id : null, Project ? Project.Name : null );
	SAVER.Save();
	return { Server: server };
}


function remove_server( Name )
{
	let removed = SERVERS.RemoveServer( client, Name );
	if ( removed.Server )
	{
		SAVER.Save();
	}
	return removed;
}


// The chooser's open: the project opened, then the page; the answer goes back to the chooser first.
async function open_then_show( Open )
{
	let answer = await Open();
	if ( answer.Ok )
	{
		setImmediate( show_page );
	}
	return answer;
}


//---------------------------------------------------------------------
// The window: the chooser, or the Consensus page copy.

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
		Base: '',		// the page's own origin: Page.js forwards /servers/<key>/api to the Server
		Version: VERSION,
		Theme: client.Theme,
		Scale: client.Scale,
		Remembered: client.Remembered,
		Roots: roots_now(),
		License: USER.Tier(),
		Project: project_info(),
		Recent: [],
		Reason: reason,
	};
}


// A window of the app (plan UI Components, Step 5): no frame, Electron's window buttons over the page's title bar.
function window_options( Width, Height )
{
	return WINDOWS.Options( { Width: Width, Height: Height, Title: TITLE, Icon: ICON, Theme: client.Theme, DarkThemes: SETTINGS.DARK_THEMES, Preload: PRELOAD } );
}


// The main window: its detached tabs, its report windows and its close (electron/Windows.js).
function create_window()
{
	window = new ELECTRON.BrowserWindow( window_options( 1400, 900 ) );
	WINDOWS.Attach( window, {
		PageUrl: function () { return page ? page.Url : null; },
		Icon: ICON,
		Preload: PRELOAD,
		Options: window_options,
		// the chooser has no draft to ask about (plan Review 2026-10-29, Step 1)
		AsksPage: function ( url ) { return String( url || '' ).indexOf( 'connect.html' ) < 0; },
		OnClosed: function () { window = null; },
	} );
}


//---------------------------------------------------------------------
// The menu: Project (New window, Reload), View, Quit. Not shown (the window has no menu bar; the page's application
// menu has the app's items), but set, since its accelerators are what keep Ctrl+R, Ctrl+N, the DevTools, the zoom and
// F11 working. There is no folder to open, so no OpenFolderWindow is given and the item and its accelerator are left
// out (plan Review 2026-10-29, Step 1).

function build_menu()
{
	WINDOWS.BuildMenu( {
		NewWindow: function () { new_window(); },
		Reload: function () { if ( window ) { window.webContents.reload(); } },
	} );
}


//---------------------------------------------------------------------
// The machine's current user (electron/CurrentUser.js): read at each use since another window or the Server may sign
// someone in; a record with no check for 14 days is removed, the user signed out.

// A sign-in's session token: verified, written whole as the current user (replacing whoever was there); answers the
// tier, or the tier with an Error and the user unchanged. The Client has no server settings of its own: Clerk's keys
// are the built-in ones.
async function set_license( Token )
{
	let answer = await USER.SetLicense( Token, {} );
	if ( answer.Error )
	{
		return Object.assign( answer.Tier, { Error: answer.Error } );
	}
	return answer.Tier;
}


// Sign out: the current user removed.
function clear_license()
{
	return USER.Clear();
}


//---------------------------------------------------------------------
// Another instance of the app, over the same config, on the chooser: a window is one project.

function new_window()
{
	let leading = ELECTRON.app.isPackaged ? [] : [ ELECTRON.app.getAppPath() ];		// installed, the executable is the app; from the checkout, electron takes the app folder
	let passed = [];
	if ( options && options.Config )
	{
		passed.push( '--config', options.Config );
	}
	let child = CHILD_PROCESS.spawn( process.execPath, leading.concat( passed ), { detached: true, stdio: 'ignore' } );
	child.unref();
}


//---------------------------------------------------------------------
// The bridge's handlers: the common ones (electron/App.js), then the Client's own.

function attach_handlers()
{
	APP.AttachHandlers( {
		Boot: boot_info,
		Settings: function () { return client; },
		Saver: SAVER,
		Roots: roots_now,
		NewWindow: function () { new_window(); },
		Protected: [ APP.PAGE_PORT ],
	} );

	// The chooser's list, and the window's project when it has one; Pick names the Server whose projects it lists first.
	ELECTRON.ipcMain.handle( 'settings', function ()
	{
		return { Settings: SETTINGS.Fill( client ), Path: client_path, Config: config_folder(), Version: VERSION, Reason: reason, Pick: pick, Project: project_info(), License: USER.Tier() };
	} );

	// A Server tried, and its projects listed for the chooser to pick from.
	ELECTRON.ipcMain.handle( 'server-projects', async function ( event, url )
	{
		let tried = await PROBE.Probe( url, { Timeout: TRY_TIMEOUT } );
		if ( !tried.Ok )
		{
			return tried;
		}
		if ( tried.SignIn )
		{
			tried.Projects = [];		// listed once signed in, in the window
			return tried;
		}
		try
		{
			tried.Projects = await PROJECTS.ServerProjects( tried.Url, TRY_TIMEOUT );
		}
		catch ( error )
		{
			return { Ok: false, Error: error.message };
		}
		return tried;
	} );

	// A Server's project, in this window, the Server saved with it.
	ELECTRON.ipcMain.handle( 'connect-server', function ( event, entry )
	{
		return open_then_show( function () { return connect_server_here( entry || {} ); } );
	} );

	// A saved Server removed from the list; the Server itself is not told.
	ELECTRON.ipcMain.handle( 'remove-server', function ( event, name )
	{
		let removed = remove_server( name );
		return { Settings: SETTINGS.Fill( client ), Error: removed.Error };
	} );

	// The license (plan Rearchitecturation, Step 6): the page's sign-in token verified and cached; a sign-out clears it.
	ELECTRON.ipcMain.handle( 'set-license', function ( event, token )
	{
		return set_license( String( token || '' ) );
	} );

	ELECTRON.ipcMain.handle( 'clear-license', function ()
	{
		return clear_license();
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
	let loaded = SETTINGS.Load( config_folder() );
	client = loaded.Settings;
	client_path = loaded.Path;
	loaded.Lines.forEach( function ( line ) { console.log( line ); } );
	WINDOWS.ApplyNativeTheme( client.Theme, SETTINGS.DARK_THEMES );
	page = await APP.ServePage( { Settings: client, Saver: SAVER, Folders: [ CONNECT_FOLDER ] } );
	attach_handlers();
	create_window();
	APP.AttachShutdown( {
		Saver: SAVER,
		Close: function () { return page.Close(); },
	} );
	// The window's project: the saved Server --connect names, with the project after it, else the Server's last; with
	// neither the chooser lists that Server's projects; with no --connect the chooser; the reason shown on the chooser
	// when the one asked for could not open.
	if ( options.Connect )
	{
		let entry = SERVERS.Named( client, options.Connect );
		if ( !entry )
		{
			reason = 'no saved Server named "' + options.Connect + '" in ' + client_path;
		}
		else if ( options.Project || entry.Project )
		{
			let answer = await connect_server_here( { Name: entry.Name, Url: entry.Url, Project: options.Project || entry.Project, Title: options.Project ? null : entry.Title } );
			if ( answer.Error )
			{
				reason = answer.Error;
			}
		}
		else
		{
			pick = entry.Name;
		}
	}
	if ( reason )
	{
		console.error( reason );
	}
	if ( opened )
	{
		show_page();
	}
	else
	{
		show_connect();
	}
}


main().catch( function ( error )
{
	APP.FailToStart( TITLE, error.message );
} );
