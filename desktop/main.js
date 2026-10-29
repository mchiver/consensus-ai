'use strict';

// main - the desktop's main process (plan Consensus Desktop, Step 2): one window that shows the Consensus page (served
// by Page.js on 127.0.0.1, which forwards the page's API calls to the server the page shows). A window is one project
// (plan Rearchitecturation, Step 2): a folder on the command line (`consensus-desktop <folder>`) opens on this machine's
// server over that folder alone, as the headless `consensus <folder>` does; `--connect <server name>` opens a saved Server
// project (desktop.json's Hosts) as a thin client, the page pointed at the Server's API through the app's own origin
// (/servers/<key>); with neither the window shows the chooser (desktop/page/connect.html): the recent folders, Open
// folder, New project and the Hosts, each opening in this window. Another project is another instance (New window
// opens another chooser; Open folder in new window and the recent folders start one on a folder). The desktop keeps its
// own settings (Settings.js) in desktop.json beside consensus.json (Step 1), which is the Server's and never
// written here.
// Step 3: the window's server is the sidecar (src/Sidecar.js): its port hashed from the folder, its address in the
// folder's .consensus/~sidecar.json; a folder already open in another window is not opened again: that window is
// brought to the front (the sidecar's POST /api/desktop/activate, answered here) and a launch on it exits, as VS Code
// activates the window that has the folder. Step 5: Open folder on a folder the Server's registry lists as mounted,
// while the Server runs (found by its address file or its port, desktop/ServerStatus.js), connects the window to the Server's
// project instead of opening the folder, so one folder never has two writers. Step 6: the tiers: the page's sign-in
// hands its token here (set-license), verified against Clerk's keys. Plan The Server, Step 4: the Desktop's split: it
// no longer starts, opens or stops a Server (the Server is an application of its own) and has no --headless form; its
// sidecar reads no connections or tasks from the Server's file, so a folder opened here has no LLMs, no users and no
// roles (sidecar mode); Connect to Server (the Hosts of before) needs a sign-in, Registered and above, and a Server's
// project in client mode runs the Server's tasks. Plan The Server, Step 1: the
// sign-in is the machine's current user, <config>/user.json (src/License.js), shared with the Server and read at each
// use, so a sign-in in another window or application counts here; the tiers are Unlicensed (no sign-in, the sidecar),
// Registered (a sign-in with no license), Personal and Professional; after 14 days with no check the user is signed out.
// Plan UI Components, Step 5: the window has no frame of its own: Electron draws the window buttons over the page's
// title bar (titleBarStyle hidden with titleBarOverlay; the page sends the bar's colours and height over the chrome
// message, so the buttons follow the palette), the bar is the drag region, and the native menu is not shown; it is
// still set, for its accelerators, and the page's application menu (public/components/title-bar) has New window, Open
// folder in new window, the recent folders, Settings, Reload and Quit, over the bridge. Plan Review 2026-10-29, Step 2:
// the command line, the saving, the common bridge handlers, the page server on its remembered port and the shutdown
// are electron/App.js's, the current user electron/CurrentUser.js's and the probe src/Probe.js's.
//
//   npm run desktop -- [<folder> | --connect <server name>] [--config <folder>] [--port <port>]

const PATH = require( 'path' );
const CHILD_PROCESS = require( 'child_process' );
const ELECTRON = require( 'electron' );
const SETTINGS = require( './Settings.js' );
const PROJECTS = require( './Projects.js' );
const SERVER_STATUS = require( './ServerStatus.js' );
const LICENSE = require( '../src/License.js' );
const PROBE = require( '../src/Probe.js' );
const START = require( '../src/Start.js' );
const WINDOWS = require( '../electron/Windows.js' );
const APP = require( '../electron/App.js' );
const CURRENT_USER = require( '../electron/CurrentUser.js' );
const SERVER = require( '../src/Server.js' );

const VERSION = require( '../package.json' ).version;
const TITLE = 'Consensus Desktop';
const PRELOAD = PATH.join( __dirname, 'preload.js' );
const CONNECT_FOLDER = PATH.join( __dirname, 'page' );		// the chooser, served beside the page
const ICON = PATH.join( __dirname, 'icon.ico' );		// the windows' icon from the checkout; the packaged executable carries its own (plan Installer)
const TRY_TIMEOUT = 5000;
const DESKTOP_USAGE = 'usage: consensus-desktop [<folder> | --connect <server name>] [--config <folder>] [--port <port>]';
const CONNECT_ARGUMENT = '--connect';		// the desktop's own argument: a saved Server project to open
const SERVER_NAME = 'Server';				// the name a folder routed to this machine's Server goes by
const FLAGS = [ { Name: CONNECT_ARGUMENT, Takes: 'value', Key: 'Connect', Needs: 'the Name of a saved Server' } ];

let options = null;		// the command line's (src/Start.js), kept for the server a folder opened later needs
let running = null;		// src/Server.js's, from START.Run: this machine's server over the window's folder, or none
let store = null;
let settings = null;		// the window's server's settings (the Server's consensus.json): read, never written here
let desktop = null;		// the desktop's own (desktop.json, Settings.js)
let desktop_path = null;
let opened = null;		// the window's project: { Kind: 'folder', Path, Project: { Id, Name } } or { Kind: 'host', Host: { Name, Url, Project }, Project: { Id, Name } }
let page = null;
let window = null;
let reason = null;		// why the project asked for could not open, for the chooser

// The desktop's settings saved: now, or a moment after the last change (the view state changes often: a fold, a tab).
const SAVER = APP.Saver( { Write: function () { SETTINGS.Write( desktop_path, desktop ); }, Label: 'the desktop settings' } );
// The machine's current user (plan The Server, Step 1): <config>/user.json, shared with the Server (electron/CurrentUser.js).
const USER = CURRENT_USER.Make( config_folder );


//---------------------------------------------------------------------
// Settings

// The settings as the pages see them: the desktop's own, filled.
function desktop_settings()
{
	return SETTINGS.Fill( desktop );
}


// The theme in use: the window's one theme (the theme per server went with plan Run Shapes, Step 5).
function theme_in_use()
{
	return desktop.Theme;
}


// The window's dialogs and native parts follow the theme (electron/Windows.js since plan Sidecar Edition, Step 1; the
// window buttons over the title bar take theirs from Windows.Options).
function apply_native_theme()
{
	WINDOWS.ApplyNativeTheme( theme_in_use(), SETTINGS.DARK_THEMES );
}


//---------------------------------------------------------------------
// Trying a server (src/Probe.js): GET /api/me, as the owner. Returns { Ok, SignIn, Version, Me, Participants, States, Url }
// or { Ok: false, Error }; a Server that asks for a sign-in answers, and the window's page makes the sign-in.

function try_server( url )
{
	return PROBE.Probe( url, { Timeout: TRY_TIMEOUT } );
}


//---------------------------------------------------------------------
// The window's project (plan Rearchitecturation, Step 2): the one root the page shows, and what the page is told.

// The root: this machine's server over the folder, or the Server; none on the chooser.
function roots_now()
{
	if ( !opened )
	{
		return [];
	}
	if ( opened.Kind === 'folder' )
	{
		let served = local_running();
		return served ? [ { Key: 'local', Name: settings.Name || 'This machine', Url: served.Url, Kind: 'local', Version: VERSION, StoredKey: PROJECTS.Key( opened ) } ] : [];
	}
	return [ { Key: opened.Host.Name, Name: opened.Host.Name, Url: opened.Host.Url, Kind: 'server', StoredKey: PROJECTS.Key( opened ) } ];
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
		Path: ( opened.Kind === 'folder' || opened.Host.Routed ) ? opened.Path : null,
		Host: ( opened.Kind === 'host' ) ? opened.Host.Name : null,
		Routed: !!( opened.Kind === 'host' && opened.Host.Routed ),		// a mounted folder served by the Server (plan Rearchitecturation, Step 5)
		Key: PROJECTS.Key( opened ),
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


// A folder opened in this window: this machine's server over it alone (its .consensus made when missing), the folder
// first in Recent. Answers { Ok, Project } or { Error }.
async function open_folder_here( Folder )
{
	if ( opened )
	{
		return { Error: 'this window has a project open: open another in a new window' };
	}
	let folder = PROJECTS.Normalize( Folder );
	// A folder the Server serves (plan Rearchitecturation, Step 5): the window connects to the Server's project; no
	// tier is asked, since the Server's own sign-in decides.
	let routed = null;
	try
	{
		routed = await SERVER_STATUS.Routed( config_folder(), folder );
	}
	catch ( error )
	{
		routed = null;
	}
	if ( routed )
	{
		opened = { Kind: 'host', Host: { Name: SERVER_NAME, Url: routed.Url, Project: routed.Project.Id, Routed: true }, Project: routed.Project, Path: folder };
		if ( SETTINGS.Opened( desktop, folder ) )
		{
			SAVER.Save();
		}
		console.log( 'folder ' + folder + ' is mounted on the Server at ' + routed.Url + ': connected to its project ' + routed.Project.Name );
		return { Ok: true, Project: project_info() };
	}
	try
	{
		// the Server's file read-only (plan Rearchitecturation, Step 4), never written here; its connections and tasks
		// are not read (plan The Server, Step 4: sidecar mode)
		running = await START.Run( Object.assign( {}, options, { Project: folder, Activate: activate_window, ReadOnly: true } ), console.log );
	}
	catch ( error )
	{
		running = null;
		return { Error: error.message };
	}
	if ( running.Open )
	{
		// open in another window already (plan Rearchitecturation, Step 3): that window was asked to the front
		let open = running;
		running = null;
		return { Error: ( open.Open.Project ? open.Open.Project.Name : 'the project' ) + ' is open in another window' + ( open.Activated ? ', brought to the front' : '' ), Open: true };
	}
	store = running.Store;
	settings = running.Settings;
	if ( !running.Server || !running.Project )
	{
		await running.Close().catch( function () {} );
		running = null;
		return { Error: 'this machine\'s server did not start for ' + folder };
	}
	opened = { Kind: 'folder', Path: folder, Project: { Id: running.Project.Id, Name: running.Project.Name } };
	if ( SETTINGS.Opened( desktop, folder ) )
	{
		SAVER.Save();
	}
	return { Ok: true, Project: project_info() };
}


// A Server's project opened in this window (Connect to Server, client mode): the Server tried, the project found
// among its projects (by id, else by name), the pair saved as a Hosts entry. Answers { Ok, Project } or { Error }.
async function connect_host_here( Host )
{
	if ( opened )
	{
		return { Error: 'this window has a project open: open another in a new window' };
	}
	let name = String( ( Host && Host.Name ) || '' ).trim();
	if ( !name )
	{
		return { Error: 'a Server needs a Name' };
	}
	if ( !LICENSE.AtLeast( USER.Read(), 'registered' ) )
	{
		return { Error: 'a sign-in: connecting to a Server needs one (Registered is free); sign in from a project page\'s menu' };
	}
	let tried = await try_server( Host.Url );
	if ( !tried.Ok )
	{
		return { Error: tried.Error };
	}
	if ( tried.SignIn || !Host.Project )
	{
		// A Server that asks for a sign-in (plan The Server, Step 5), or no project named: the window shows the whole
		// Server, its page signs in and lists the projects the person may see; a project named opens on it.
		let named = Host.Project ? { Id: String( Host.Project ), Name: String( Host.Title || Host.Project ) } : null;
		opened = { Kind: 'host', Host: { Name: name, Url: tried.Url, Project: named ? named.Id : null }, Project: named };
		desktop.Hosts = SETTINGS.Fill( { Hosts: desktop.Hosts } ).Hosts.filter( function ( entry ) { return !( entry.Name === name && ( entry.Project || null ) === ( named ? named.Id : null ) ); } );
		desktop.Hosts.push( { Name: name, Url: tried.Url, Project: named ? named.Id : null, Title: named ? named.Name : null } );
		SAVER.Save();
		return { Ok: true, Project: project_info() };
	}
	let projects = [];
	try
	{
		projects = await PROJECTS.HostProjects( tried.Url, TRY_TIMEOUT );
	}
	catch ( error )
	{
		return { Error: error.message };
	}
	let project = PROJECTS.FindProject( projects, Host.Project );
	if ( !project )
	{
		return { Error: 'no project "' + ( Host.Project || '' ) + '" on ' + name + ' (' + tried.Url + ')' };
	}
	opened = { Kind: 'host', Host: { Name: name, Url: tried.Url, Project: project.Id }, Project: { Id: project.Id, Name: project.Name } };
	desktop.Hosts = SETTINGS.Fill( { Hosts: desktop.Hosts } ).Hosts.filter( function ( entry ) { return !( entry.Name === name && ( entry.Project === project.Id || !entry.Project ) ); } );
	desktop.Hosts.push( { Name: name, Url: tried.Url, Project: project.Id, Title: project.Name } );
	SAVER.Save();
	return { Ok: true, Project: project_info() };
}


// The sidecar's activate (plan Rearchitecturation, Step 3): this window to the front, for a launch on its folder.
function activate_window()
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
	ELECTRON.app.focus( { steal: true } );
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
// The page server on the port it had last time (remembered in desktop.json as page-port, electron/App.js), so the
// window's origin stays the same between starts and a sign-in through Clerk survives a restart (plan Clerk, Step 7).

function serve_page()
{
	return APP.ServePage( { Settings: desktop, Saver: SAVER, Folders: [ CONNECT_FOLDER ] } );
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
		Base: '',		// the page's own origin: Page.js forwards /api to the connected server
		Version: VERSION,
		Theme: theme_in_use(),
		Scale: desktop.Scale,
		Remembered: desktop.Remembered,
		Roots: roots_now(),
		License: USER.Tier(),
		Project: project_info(),
		Recent: desktop_settings().Recent,
		Reason: reason,
		Local: local_running(),
	};
}


// A window of the app (plan UI Components, Step 5): no frame, Electron's window buttons over the page's title bar.
function window_options( Width, Height )
{
	return WINDOWS.Options( { Width: Width, Height: Height, Title: TITLE, Icon: ICON, Theme: theme_in_use(), DarkThemes: SETTINGS.DARK_THEMES, Preload: PRELOAD } );
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
// The menu: Project (New window, Open folder in new window, Reload), View, Quit. Not shown since plan UI Components,
// Step 5 (the window has no menu bar; the page's application menu has the desktop items), but set, since its
// accelerators are what keep Ctrl+R, Ctrl+N, Ctrl+Shift+O, the DevTools, the zoom and F11 working.

function build_menu()
{
	WINDOWS.BuildMenu( {
		NewWindow: function () { new_window(); },
		OpenFolderWindow: function () { open_folder_window(); },
		Reload: function () { if ( window ) { window.webContents.reload(); } },
	} );
}


//---------------------------------------------------------------------
// The machine's current user (electron/CurrentUser.js): read at each use since another window or the Server may sign
// someone in; a record with no check for 14 days is removed, the user signed out.

// A sign-in's session token: verified, written whole as the current user (replacing whoever was there); answers the
// tier, or the tier with an Error and the user unchanged.
async function set_license( Token )
{
	let answer = await USER.SetLicense( Token, settings || {} );
	if ( answer.Error )
	{
		return Object.assign( answer.Tier, { Error: answer.Error } );
	}
	build_menu();
	return answer.Tier;
}


// Sign out: the current user removed.
function clear_license()
{
	let tier = USER.Clear();
	build_menu();
	return tier;
}


function config_folder()
{
	return ( options && options.Config ) ? options.Config : SERVER.DEFAULT_CONFIG;
}


//---------------------------------------------------------------------
// This machine's server: over the window's folder, started by START.Run (plan Run Shapes), or none.

function local_running()
{
	if ( !running || !running.Server )
	{
		return null;
	}
	return { Url: running.Url, Port: running.Address.Port, Scope: running.Scope, Config: store.Folder, Project: running.Project ? { Name: running.Project.Name, Path: running.Project.Path } : null, Sidecar: running.Sidecar ? running.Sidecar.Path : null };
}


// The app's own arguments (electron/App.js): the desktop's own --connect <server name> taken, the rest left for
// src/Start.js: { Arguments, Connect }.
function own_arguments( argv )
{
	let parsed = APP.Arguments( argv, { Title: 'the Desktop', Rest: true, Flags: FLAGS } );
	return { Arguments: parsed.Rest, Connect: parsed.Options.Connect };
}


// Another instance of the app, over the same config: on the chooser, or, with Arguments, as the command line would
// start it (a project folder: that project alone).
function new_window( Arguments )
{
	let leading = ELECTRON.app.isPackaged ? [] : [ ELECTRON.app.getAppPath() ];		// installed, the executable is the app; from the checkout, electron takes the app folder
	let passed = [];
	if ( options && options.Config )
	{
		passed.push( '--config', options.Config );
	}
	let child = CHILD_PROCESS.spawn( process.execPath, leading.concat( passed, Arguments || [] ), { detached: true, stdio: 'ignore' } );
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


// The folder dialog, for the chooser, the page's + Project and the menu. Returns the folder with forward slashes, or null.
function pick_folder( owner, current_folder )
{
	return WINDOWS.PickFolder( owner || window, current_folder );
}


//---------------------------------------------------------------------
// The bridge's handlers: the common ones (electron/App.js), then the Desktop's own.

function attach_handlers()
{
	APP.AttachHandlers( {
		Boot: boot_info,
		Settings: function () { return desktop; },
		Saver: SAVER,
		Roots: roots_now,
		NewWindow: function () { new_window(); },
		Protected: [ APP.PAGE_PORT ],
	} );

	// The chooser's lists, and the window's project when it has one.
	ELECTRON.ipcMain.handle( 'settings', function ()
	{
		return { Settings: desktop_settings(), Path: desktop_path, Config: options.Config || SERVER.DEFAULT_CONFIG, Version: VERSION, Reason: reason, Project: project_info(), Local: local_running(), License: USER.Tier() };
	} );

	// Open folder: the picker, then the folder in this window.
	ELECTRON.ipcMain.handle( 'open-folder', async function ( event )
	{
		let picked = await pick_folder( ELECTRON.BrowserWindow.fromWebContents( event.sender ), null );
		if ( !picked )
		{
			return { Cancelled: true };
		}
		return open_then_show( function () { return open_folder_here( picked ); } );
	} );

	// A recent folder, in this window.
	ELECTRON.ipcMain.handle( 'open-path', function ( event, path )
	{
		return open_then_show( function () { return open_folder_here( path ); } );
	} );

	// New project: its folder made under the parent, then opened in this window.
	ELECTRON.ipcMain.handle( 'new-project', function ( event, fields )
	{
		let folder = null;
		try
		{
			folder = PROJECTS.NewFolder( fields ? fields.Parent : '', fields ? fields.Name : '' );
		}
		catch ( error )
		{
			return { Error: error.message };
		}
		return open_then_show( function () { return open_folder_here( folder ); } );
	} );

	// A Server tried, and its projects listed for the chooser to pick from.
	ELECTRON.ipcMain.handle( 'host-projects', async function ( event, url )
	{
		let tried = await try_server( url );
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
			tried.Projects = await PROJECTS.HostProjects( tried.Url, TRY_TIMEOUT );
		}
		catch ( error )
		{
			return { Ok: false, Error: error.message };
		}
		return tried;
	} );

	// A Server's project, in this window, saved as a Hosts entry.
	ELECTRON.ipcMain.handle( 'connect-host', function ( event, entry )
	{
		return open_then_show( function () { return connect_host_here( entry || {} ); } );
	} );

	// Forget a recent folder (the folder stays), remove a Hosts entry.
	ELECTRON.ipcMain.handle( 'forget', function ( event, path )
	{
		desktop.Recent = ( desktop.Recent || [] ).filter( function ( entry ) { return entry.Path !== path; } );
		SAVER.Save();
		return { Settings: desktop_settings() };
	} );

	ELECTRON.ipcMain.handle( 'remove-host', function ( event, entry )
	{
		let wanted = entry || {};
		desktop.Hosts = ( desktop.Hosts || [] ).filter( function ( one ) { return !( one.Name === wanted.Name && ( one.Project || null ) === ( wanted.Project || null ) ); } );
		SAVER.Save();
		return { Settings: desktop_settings() };
	} );

	ELECTRON.ipcMain.handle( 'try', function ( event, url )
	{
		return try_server( url );
	} );

	ELECTRON.ipcMain.handle( 'folder', function ( event, current_folder )
	{
		return pick_folder( ELECTRON.BrowserWindow.fromWebContents( event.sender ), current_folder );
	} );

	// The page's application menu (plan UI Components, Step 5): Open folder in new window, a recent folder in a new
	// window, and Quit.
	ELECTRON.ipcMain.handle( 'open-folder-window', function ( event )
	{
		return open_folder_window( ELECTRON.BrowserWindow.fromWebContents( event.sender ) ).then( function () { return {}; } );
	} );

	ELECTRON.ipcMain.handle( 'open-recent', function ( event, path )
	{
		if ( typeof path === 'string' && path )
		{
			new_window( [ path ] );
		}
		return {};
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
	let connect = null;
	try
	{
		let own = own_arguments( process.argv );
		connect = own.Connect;
		options = START.Parse( own.Arguments );
	}
	catch ( error )
	{
		APP.FailToStart( TITLE, error.message + '\n\n' + DESKTOP_USAGE );
		return;
	}
	if ( options.Help )
	{
		console.log( DESKTOP_USAGE );
		ELECTRON.app.exit( 0 );
		return;
	}
	if ( options.Headless )
	{
		// The Desktop serves nothing on its own (plan The Server, Step 4): the Server is an application of its own.
		APP.FailToStart( TITLE, 'the Desktop has no headless form: consensus-server --headless runs a Server, consensus <folder> a project\'s server alone', true );
		return;
	}
	await ELECTRON.app.whenReady();
	// The desktop's own file (plan Rearchitecturation, Step 1), beside the Server's consensus.json.
	let loaded = SETTINGS.Load( options.Config || SERVER.DEFAULT_CONFIG );
	desktop = loaded.Settings;
	desktop_path = loaded.Path;
	loaded.Lines.forEach( function ( line ) { console.log( line ); } );
	apply_native_theme();
	page = await serve_page();
	attach_handlers();
	create_window();
	APP.AttachShutdown( {
		Saver: SAVER,
		Close: async function ()
		{
			await page.Close().catch( function () {} );
			if ( running )
			{
				await running.Close();
			}
		},
	} );
	// The window's project: the folder on the command line, or the saved Server project --connect names; the chooser
	// when there is neither, or when the one asked for could not open (the reason shown on it).
	let answer = null;
	if ( options.Project )
	{
		answer = await open_folder_here( options.Project );
	}
	else if ( connect )
	{
		let entry = SETTINGS.HostNamed( desktop, connect );
		answer = entry ? await connect_host_here( entry ) : { Error: 'no saved Server named "' + connect + '" in ' + desktop_path };
	}
	if ( answer && answer.Error )
	{
		reason = answer.Error;
		console.error( reason );
	}
	if ( answer && answer.Open && options.Project )
	{
		// the folder on the command line is open in another window, brought to the front: this launch is done
		await page.Close().catch( function () {} );
		ELECTRON.app.exit( 0 );
		return;
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
