'use strict';

// main - the desktop's main process (plan Consensus Desktop, Step 2): one window that shows the Consensus page (served
// by Page.js on 127.0.0.1, which forwards the page's API calls to the server the page shows). A window is one project
// (plan Rearchitecturation, Step 2): a folder on the command line (`consensus-desktop <folder>`) opens on this machine's
// server over that folder alone, as the headless `consensus <folder>` does; `--connect <host name>` opens a saved Host
// project (desktop.json's Hosts) as a thin client, the page pointed at the Host's API through the app's own origin
// (/servers/<key>); with neither the window shows the chooser (desktop/page/connect.html): the recent folders, Open
// folder, New project and the Hosts, each opening in this window. Another project is another instance (New window
// opens another chooser; Open folder in new window and the recent folders start one on a folder). The desktop keeps its
// own settings (Settings.js) in desktop.json beside consensus.json (Step 1), which is the Server Host's and never
// written here. With --headless there is no window: this machine's server runs from the config as the Scope says.
// Step 3: the window's server is the sidecar (src/Sidecar.js): its port hashed from the folder, its address in the
// folder's .consensus/~sidecar.json; a folder already open in another window is not opened again: that window is
// brought to the front (the sidecar's POST /api/desktop/activate, answered here) and a launch on it exits, as VS Code
// activates the window that has the folder.
// Plan UI Components, Step 5: the window has no frame of its own: Electron draws the window buttons over the page's
// title bar (titleBarStyle hidden with titleBarOverlay; the page sends the bar's colours and height over the chrome
// message, so the buttons follow the palette), the bar is the drag region, and the native menu is not shown; it is
// still set, for its accelerators, and the page's application menu (public/components/title-bar) has New window, Open
// folder in new window, the recent folders, Settings, Reload and Quit, over the bridge.
//
//   npm run desktop -- [<folder> | --connect <host name>] [--config <folder>] [--port <port>] [--scope ...] [--headless]

const FS = require( 'fs' );
const PATH = require( 'path' );
const CHILD_PROCESS = require( 'child_process' );
const ELECTRON = require( 'electron' );
const SETTINGS = require( './Settings.js' );
const PROJECTS = require( './Projects.js' );
const START = require( '../src/Start.js' );
const PAGE = require( './Page.js' );
const SERVER = require( '../src/Server.js' );

const VERSION = require( '../package.json' ).version;
const ICON = PATH.join( __dirname, 'icon.ico' );		// the windows' icon from the checkout; the packaged executable carries its own (plan Installer)
const TRY_TIMEOUT = 5000;
const CONNECT_ARGUMENT = '--connect';		// the desktop's own argument: a saved Host project to open
// Electron's own switches, which stay on the command line the app parses.
const ELECTRON_SWITCH = /^--(remote-debugging-port|user-data-dir|inspect|enable-logging|no-sandbox|disable-gpu|trace-warnings)/;

let options = null;		// the command line's (src/Start.js), kept for the server a folder opened later needs
let running = null;		// src/Server.js's, from START.Run: this machine's server over the window's folder, or none
let store = null;
let settings = null;		// this machine's server's settings (consensus.json): read, never written here
let desktop = null;		// the desktop's own (desktop.json, Settings.js)
let desktop_path = null;
let opened = null;		// the window's project: { Kind: 'folder', Path, Project: { Id, Name } } or { Kind: 'host', Host: { Name, Url, Project }, Project: { Id, Name } }
let page = null;
let window = null;
let reason = null;		// why the project asked for could not open, for the chooser
let closing = false;
const CLOSE_ANSWER_WAIT = 3000;		// the page's answer to a close, before the window closes anyway


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
// Trying a server: GET /api/me, as the owner. Returns { Ok, Version, Me, Participants, States, Url } or { Ok: false, Error }.

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
		return { Ok: true, Version: json.Version || null, Me: json.Me, Participants: json.Participants, States: json.States, Url: base };
	}
	catch ( error )
	{
		return { Ok: false, Error: base + ' does not answer: ' + ( error.name === 'TimeoutError' ? 'no answer within ' + ( TRY_TIMEOUT / 1000 ) + ' seconds' : error.message ) };
	}
}


//---------------------------------------------------------------------
// The window's project (plan Rearchitecturation, Step 2): the one root the page shows, and what the page is told.

// The root: this machine's server over the folder, or the Host; none on the chooser.
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


// The project as the page and the chooser see it, or null.
function project_info()
{
	if ( !opened )
	{
		return null;
	}
	return {
		Id: opened.Project.Id,
		Name: opened.Project.Name,
		Path: ( opened.Kind === 'folder' ) ? opened.Path : null,
		Host: ( opened.Kind === 'host' ) ? opened.Host.Name : null,
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
	try
	{
		// the Host's file read-only (plan Rearchitecturation, Step 4): its connections and tasks read, never written here
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
		save_settings();
	}
	return { Ok: true, Project: project_info() };
}


// A Host's project opened in this window: the Host tried, the project found among its projects (by id, else by name),
// the pair saved as a Hosts entry. Answers { Ok, Project } or { Error }.
async function connect_host_here( Host )
{
	if ( opened )
	{
		return { Error: 'this window has a project open: open another in a new window' };
	}
	let name = String( ( Host && Host.Name ) || '' ).trim();
	if ( !name )
	{
		return { Error: 'a Host needs a Name' };
	}
	let tried = await try_server( Host.Url );
	if ( !tried.Ok )
	{
		return { Error: tried.Error };
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
	save_settings();
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
		Project: project_info(),
		Recent: desktop_settings().Recent,
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
// Confirm on close is off; the chooser has no page to ask; no answer within CLOSE_ANSWER_WAIT and the window
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
// The menu: Project (New window, Open folder in new window, Reload), View, Quit. Not shown since plan UI Components,
// Step 5 (the window has no menu bar; the page's application menu has the desktop items), but set, since its
// accelerators are what keep Ctrl+R, Ctrl+N, Ctrl+Shift+O, the DevTools, the zoom and F11 working.

function build_menu()
{
	let template = [
		{
			label: 'Project',
			submenu: [
				{ label: 'New window', accelerator: 'CmdOrCtrl+N', click: function () { new_window(); } },
				{ label: 'Open folder in new window…', accelerator: 'CmdOrCtrl+Shift+O', click: function () { open_folder_window(); } },
				{ label: 'Reload', accelerator: 'CmdOrCtrl+R', click: function () { if ( window ) { window.webContents.reload(); } } },
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
// This machine's server: over the window's folder, started by START.Run (plan Run Shapes), or none.

function local_running()
{
	if ( !running || !running.Server )
	{
		return null;
	}
	return { Url: running.Url, Port: running.Address.Port, Scope: running.Scope, Config: store.Folder, Project: running.Project ? { Name: running.Project.Name, Path: running.Project.Path } : null, Sidecar: running.Sidecar ? running.Sidecar.Path : null };
}


// The app's own arguments: after the executable (and, from the checkout, the app folder), Electron's switches left
// out, and the desktop's own --connect <host name> taken: { Arguments, Connect }.
function own_arguments( argv )
{
	let list = argv.slice( ELECTRON.app.isPackaged ? 1 : 2 ).filter( function ( argument ) { return !ELECTRON_SWITCH.test( argument ); } );
	let connect = null;
	let at = list.indexOf( CONNECT_ARGUMENT );
	if ( at >= 0 )
	{
		connect = list[ at + 1 ];
		if ( connect === undefined || connect.startsWith( '--' ) )
		{
			throw new Error( CONNECT_ARGUMENT + ' needs the Name of a saved Host' );
		}
		list.splice( at, 2 );
	}
	return { Arguments: list, Connect: connect };
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
async function pick_folder( owner, current_folder )
{
	let picker_options = { properties: [ 'openDirectory', 'createDirectory' ] };
	if ( current_folder )
	{
		picker_options.defaultPath = current_folder;
	}
	let picked = await ELECTRON.dialog.showOpenDialog( owner || window, picker_options );
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

	// The page's picker and the chooser's set the window's theme.
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

	// The chooser's lists, and the window's project when it has one.
	ELECTRON.ipcMain.handle( 'settings', function ()
	{
		return { Settings: desktop_settings(), Path: desktop_path, Config: options.Config || SERVER.DEFAULT_CONFIG, Version: VERSION, Reason: reason, Project: project_info(), Local: local_running() };
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

	// A Host tried, and its projects listed for the chooser to pick from.
	ELECTRON.ipcMain.handle( 'host-projects', async function ( event, url )
	{
		let tried = await try_server( url );
		if ( !tried.Ok )
		{
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

	// A Host's project, in this window, saved as a Hosts entry.
	ELECTRON.ipcMain.handle( 'connect-host', function ( event, entry )
	{
		return open_then_show( function () { return connect_host_here( entry || {} ); } );
	} );

	// Forget a recent folder (the folder stays), remove a Hosts entry.
	ELECTRON.ipcMain.handle( 'forget', function ( event, path )
	{
		desktop.Recent = ( desktop.Recent || [] ).filter( function ( entry ) { return entry.Path !== path; } );
		save_settings();
		return { Settings: desktop_settings() };
	} );

	ELECTRON.ipcMain.handle( 'remove-host', function ( event, entry )
	{
		let wanted = entry || {};
		desktop.Hosts = ( desktop.Hosts || [] ).filter( function ( one ) { return !( one.Name === wanted.Name && ( one.Project || null ) === ( wanted.Project || null ) ); } );
		save_settings();
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

	ELECTRON.ipcMain.handle( 'new-window', function ()
	{
		new_window();
		return {};
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
	let connect = null;
	try
	{
		let own = own_arguments( process.argv );
		connect = own.Connect;
		options = START.Parse( own.Arguments );
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
	await ELECTRON.app.whenReady();
	// The desktop's own file (plan Rearchitecturation, Step 1), beside the Server Host's consensus.json.
	let loaded = SETTINGS.Load( options.Config || SERVER.DEFAULT_CONFIG );
	desktop = loaded.Settings;
	desktop_path = loaded.Path;
	loaded.Lines.forEach( function ( line ) { console.log( line ); } );
	apply_native_theme();
	if ( options.Headless )
	{
		// No window: this machine's server from the config as the Scope says (every registered project, or the folder).
		running = await START.Run( options, console.log );
		if ( running.Open )
		{
			// the folder is open in a running sidecar: its address is printed above
			ELECTRON.app.exit( 0 );
			return;
		}
		store = running.Store;
		settings = running.Settings;
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
		page.Close().catch( function () {} ).then( function () { return running ? running.Close() : null; } ).catch( function () {} ).then( function () { ELECTRON.app.quit(); } );
	} );
	// The window's project: the folder on the command line, or the saved Host project --connect names; the chooser
	// when there is neither, or when the one asked for could not open (the reason shown on it).
	let answer = null;
	if ( options.Project )
	{
		answer = await open_folder_here( options.Project );
	}
	else if ( connect )
	{
		let entry = SETTINGS.HostNamed( desktop, connect );
		answer = entry ? await connect_host_here( entry ) : { Error: 'no saved Host named "' + connect + '" in ' + desktop_path };
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
