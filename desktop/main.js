'use strict';

// main - the desktop's main process (plan Consensus Desktop, Step 2): one window that opens on the connect screen
// and, once connected, shows the desktop's own copy of the Consensus page (served by Page.js on 127.0.0.1, which
// forwards the page's API calls to the connected server). It can run one local Consensus server (Local.js) over a
// data folder and connect to it. Settings: desktop.json in Electron's user-data folder (Settings.js). A second
// server at the same time is a second instance (New window).
// Step 3: the LLM connections and the workspaces (Settings.js), shown by the page in each project's Context
// folder; a connection's Check (Llm.js); the one-shots, packaged here from what the connected server says
// (Package.js) and run by Runs.js, their records in the user-data folder's runs/.
//
//   npm run desktop          (electron desktop, from the checkout)

const PATH = require( 'path' );
const CHILD_PROCESS = require( 'child_process' );
const ELECTRON = require( 'electron' );
const SETTINGS = require( './Settings.js' );
const LOCAL = require( './Local.js' );
const PAGE = require( './Page.js' );
const LLM = require( './Llm.js' );
const PACKAGE = require( './Package.js' );
const RUNS = require( './Runs.js' );

const VERSION = require( '../package.json' ).version;
const TRY_TIMEOUT = 5000;
const FETCH_TIMEOUT = 15000;

let settings_path = null;
let settings = null;
let page = null;
let local = null;
let runs = null;
let window = null;
let current = null;		// { Kind: 'server' | 'local', Name, Url, Version } while connected
let reason = null;		// why the last connection failed, for the connect screen
let closing = false;


//---------------------------------------------------------------------
// Settings

function save_settings()
{
	SETTINGS.Write( settings_path, settings );
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
		let running = local.Running();
		if ( !running )
		{
			return { Ok: false, Error: 'the local server is not running' };
		}
		target = { Kind: 'local', Name: 'Local server', Url: running.Url };
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
	settings.Last = ( target.Kind === 'local' ) ? { Kind: 'local' } : { Kind: 'server', Name: target.Name };
	save_settings();
	show_page();
	return { Ok: true, Version: tried.Version };
}


function disconnect()
{
	current = null;
	page.SetTarget( null );
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
		Theme: settings.Theme,
		Scale: settings.Scale,
		Server: current ? { Kind: current.Kind, Name: current.Name, Url: current.Url, Version: current.Version } : null,
		Reason: reason,
		Local: local ? local.Running() : null,
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
		runs.Close().catch( function () {} ).then( function () { return local.Close(); } ).catch( function () {} ).then( function ()
		{
			window.destroy();
		} );
	} );
	window.on( 'closed', function ()
	{
		window = null;
	} );
}


//---------------------------------------------------------------------
// The menu: Server (Connect to another, Reload, the local server's Start and Stop, New window), View, Quit.

function build_menu()
{
	let running = local ? local.Running() : null;
	let template = [
		{
			label: 'Server',
			submenu: [
				{ label: current ? 'Connect to another…' : 'Connect…', click: function () { disconnect(); } },
				{ label: 'Reload', accelerator: 'CmdOrCtrl+R', click: function () { if ( window ) { window.webContents.reload(); } } },
				{ type: 'separator' },
				{ label: 'Start local server', enabled: !running && !!settings.Local.Data, click: function () { start_local( settings.Local.Data ).then( function ( started ) { if ( started.Ok && !current ) { show_connect(); } } ); } },
				{ label: 'Stop local server', enabled: !!running, click: function () { stop_local(); } },
				{ type: 'separator' },
				{ label: 'New window', accelerator: 'CmdOrCtrl+N', click: function () { new_window(); } },
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
// The local server

async function start_local( data )
{
	try
	{
		let running = await local.Start( data );
		settings.Local = { Data: running.Data, Port: running.Port };
		save_settings();
		build_menu();
		return { Ok: true, Running: running };
	}
	catch ( error )
	{
		return { Ok: false, Error: error.message };
	}
}


async function stop_local()
{
	let was_connected_to_it = !!current && current.Kind === 'local';
	await local.Stop();
	build_menu();
	if ( was_connected_to_it )
	{
		reason = 'the local server was stopped';
		disconnect();
	}
	return { Ok: true };
}


// Another instance of the app, with the same desktop.json, on its own connect screen.
function new_window()
{
	let child = CHILD_PROCESS.spawn( process.execPath, [ ELECTRON.app.getAppPath() ], { detached: true, stdio: 'ignore' } );
	child.unref();
}


//---------------------------------------------------------------------
// The LLM connections and the workspaces (Step 3): saved whole in desktop.json; an item is saved or deleted one
// at a time, filled in and checked with the rest.

function items_info()
{
	let running = runs.List().filter( function ( run ) { return run.Status === 'running'; } );
	return { Llms: settings.Llms, Workspaces: settings.Workspaces, Running: running, DefaultPrompts: PACKAGE.DEFAULT_PROMPTS, Server: boot_info().Server };
}


function save_item( list_name, filler, item )
{
	let filled = filler( item );
	let list = settings[ list_name ].filter( function ( one ) { return one.Id !== filled.Id; } );
	let index = settings[ list_name ].findIndex( function ( one ) { return one.Id === filled.Id; } );
	list.splice( ( index < 0 ) ? list.length : index, 0, filled );
	let fresh = Object.assign( {}, settings );
	fresh[ list_name ] = list;
	let problems = SETTINGS.Problems( fresh );
	if ( problems.length )
	{
		return { Problems: problems };
	}
	settings = fresh;
	save_settings();
	return { Item: filled };
}


function delete_item( list_name, id )
{
	settings[ list_name ] = settings[ list_name ].filter( function ( one ) { return one.Id !== id; } );
	save_settings();
	return { Ok: true };
}


//---------------------------------------------------------------------
// The package of a one-shot: what the connected server says, as the owner, put together by Package.js.
// Request = { LlmId, Kind, ProjectId, PlanId?, WorkspaceId? } -> { Prompt, Llm, Project, Plan, Workspace, Participant } or { Error }

async function fetch_json( path )
{
	let response = await fetch( current.Url + path, { signal: AbortSignal.timeout( FETCH_TIMEOUT ) } );
	let json = await response.json().catch( function () { return {}; } );
	if ( !response.ok )
	{
		throw new Error( path + ' answered ' + response.status + ( json.Error ? ': ' + json.Error : '' ) );
	}
	return json;
}


async function fetch_text( path )
{
	let response = await fetch( current.Url + path, { signal: AbortSignal.timeout( FETCH_TIMEOUT ) } );
	if ( !response.ok )
	{
		throw new Error( path + ' answered ' + response.status );
	}
	return response.text();
}


function documents_of( items, readme_id )
{
	let documents = [];
	for ( let node of items || [] )
	{
		if ( node.Kind === 'document' && node.Id !== readme_id )
		{
			documents.push( { Id: node.Id, Title: node.Title } );
		}
	}
	return documents;
}


async function make_package( request )
{
	if ( !current )
	{
		return { Error: 'not connected to a Consensus server' };
	}
	let llm = SETTINGS.LlmById( settings, request.LlmId );
	if ( !llm )
	{
		return { Error: 'no LLM connection with the id ' + request.LlmId };
	}
	let workspace = request.WorkspaceId ? SETTINGS.WorkspaceById( settings, request.WorkspaceId ) : null;
	if ( request.WorkspaceId && !workspace )
	{
		return { Error: 'no workspace with the id ' + request.WorkspaceId };
	}
	if ( request.Kind === 'build' && !workspace )
	{
		return { Error: 'a build needs a workspace' };
	}
	try
	{
		let me = await fetch_json( '/api/me' );
		let llm_participant = ( me.Participants || [] ).find( function ( participant ) { return participant.Role === 'llm'; } );
		let participant = llm_participant ? llm_participant.Name : 'llm';
		let projects = await fetch_json( '/api/projects' );
		let project = ( projects.Projects || [] ).find( function ( candidate ) { return candidate.Id === request.ProjectId; } );
		if ( !project )
		{
			return { Error: 'no project with the id ' + request.ProjectId + ' on ' + current.Name };
		}
		let context_folder = ( project.Items || [] ).find( function ( node ) { return node.Id === project.ContextFolder; } );
		let readme_id = project.Context ? project.Context.Id : null;
		let readme = null;
		if ( llm.Checks.Readme && readme_id )
		{
			let answer = await fetch_json( '/api/proposals/' + encodeURIComponent( readme_id ) );
			readme = { Id: readme_id, Title: answer.Proposal.Title, Text: answer.Text };
		}
		let instructions = llm.Checks.Instructions ? await fetch_text( '/instructions' ) : null;
		let plan = null;
		let threads = [];
		if ( request.PlanId )
		{
			let answer = await fetch_json( '/api/proposals/' + encodeURIComponent( request.PlanId ) );
			plan = { Id: answer.Proposal.Id, Title: answer.Proposal.Title, State: answer.Proposal.State };
			threads = ( answer.Threads || [] ).filter( function ( thread ) { return ( thread.Turn || [] ).includes( participant ); } );
		}
		else if ( request.Kind !== 'session' )
		{
			return { Error: 'a ' + request.Kind + ' needs a plan: select one in the tree' };
		}
		let prompt = PACKAGE.Build( {
			Kind: request.Kind,
			Llm: llm,
			Server: { Url: current.Url },
			Project: { Id: project.Id, Name: project.Name },
			Plan: plan,
			Workspace: workspace ? { Name: workspace.Name, Path: workspace.Path } : null,
			Participant: participant,
			Instructions: instructions,
			Readme: readme,
			Documents: documents_of( context_folder ? context_folder.Items : [], readme_id ),
			Threads: threads,
		} );
		return { Prompt: prompt, Llm: llm, Project: { Id: project.Id, Name: project.Name }, Plan: plan, Workspace: workspace, Participant: participant };
	}
	catch ( error )
	{
		return { Error: 'the package could not be made: ' + error.message };
	}
}


async function start_run( request )
{
	let made = await make_package( request );
	if ( made.Error )
	{
		return made;
	}
	try
	{
		let run = runs.Start( { Llm: made.Llm, Kind: request.Kind, Project: made.Project, Plan: made.Plan, Workspace: made.Workspace, Prompt: made.Prompt } );
		return { Run: run };
	}
	catch ( error )
	{
		return { Error: error.message };
	}
}


// Every window of the app hears that a run started or ended, and refreshes.
function broadcast_run( summary )
{
	for ( let one of ELECTRON.BrowserWindow.getAllWindows() )
	{
		if ( !one.isDestroyed() )
		{
			one.webContents.send( 'runs-changed', summary );
		}
	}
}


//---------------------------------------------------------------------
// The bridge's handlers.

function attach_handlers()
{
	ELECTRON.ipcMain.on( 'boot', function ( event )
	{
		event.returnValue = boot_info();
	} );

	ELECTRON.ipcMain.on( 'theme', function ( event, change )
	{
		if ( change && SETTINGS.THEMES.includes( change.Theme ) )
		{
			settings.Theme = change.Theme;
		}
		if ( change && SETTINGS.SCALES.includes( change.Scale ) )
		{
			settings.Scale = change.Scale;
		}
		save_settings();
	} );

	ELECTRON.ipcMain.handle( 'settings', function ()
	{
		return { Settings: settings, Path: settings_path, Version: VERSION, Server: boot_info().Server, Reason: reason, Local: local.Running() };
	} );

	ELECTRON.ipcMain.handle( 'save', function ( event, fresh )
	{
		let filled = SETTINGS.Fill( Object.assign( {}, settings, fresh || {} ) );
		let problems = SETTINGS.Problems( filled );
		if ( problems.length )
		{
			return { Problems: problems };
		}
		settings = filled;
		save_settings();
		build_menu();
		return { Settings: settings };
	} );

	ELECTRON.ipcMain.handle( 'try', function ( event, url )
	{
		return try_server( url );
	} );

	ELECTRON.ipcMain.handle( 'connect', function ( event, where )
	{
		return connect( where );
	} );

	ELECTRON.ipcMain.handle( 'local-start', function ( event, data )
	{
		return start_local( data );
	} );

	ELECTRON.ipcMain.handle( 'local-stop', function ()
	{
		return stop_local();
	} );

	ELECTRON.ipcMain.handle( 'local-status', function ()
	{
		return { Running: local.Running() };
	} );

	ELECTRON.ipcMain.handle( 'folder', async function ( event, current_folder )
	{
		let options = { properties: [ 'openDirectory', 'createDirectory' ] };
		if ( current_folder )
		{
			options.defaultPath = current_folder;
		}
		let picked = await ELECTRON.dialog.showOpenDialog( ELECTRON.BrowserWindow.fromWebContents( event.sender ) || window, options );
		if ( picked.canceled || !picked.filePaths.length )
		{
			return null;
		}
		return picked.filePaths[ 0 ].replace( /\\/g, '/' );
	} );

	ELECTRON.ipcMain.handle( 'new-window', function ()
	{
		new_window();
		return {};
	} );

	// Step 3: the items, their check, the package and the runs.
	ELECTRON.ipcMain.handle( 'items', function ()
	{
		return items_info();
	} );

	ELECTRON.ipcMain.handle( 'llm-save', function ( event, llm )
	{
		return save_item( 'Llms', SETTINGS.FillLlm, llm );
	} );

	ELECTRON.ipcMain.handle( 'llm-delete', function ( event, id )
	{
		return delete_item( 'Llms', id );
	} );

	ELECTRON.ipcMain.handle( 'llm-check', async function ( event, id )
	{
		let llm = SETTINGS.LlmById( settings, id );
		if ( !llm )
		{
			return { Ok: false, Error: 'no LLM connection with the id ' + id };
		}
		return LLM.Check( llm );
	} );

	ELECTRON.ipcMain.handle( 'workspace-save', function ( event, workspace )
	{
		return save_item( 'Workspaces', SETTINGS.FillWorkspace, workspace );
	} );

	ELECTRON.ipcMain.handle( 'workspace-delete', function ( event, id )
	{
		return delete_item( 'Workspaces', id );
	} );

	ELECTRON.ipcMain.handle( 'package', function ( event, request )
	{
		return make_package( request || {} );
	} );

	ELECTRON.ipcMain.handle( 'run', function ( event, request )
	{
		return start_run( request || {} );
	} );

	ELECTRON.ipcMain.handle( 'run-stop', function ( event, id )
	{
		return { Stopped: runs.Stop( id ) };
	} );

	ELECTRON.ipcMain.handle( 'runs', function ( event, llm_id )
	{
		return { Runs: runs.List( llm_id ), Running: runs.Running( llm_id ) };
	} );

	ELECTRON.ipcMain.handle( 'run-read', function ( event, id )
	{
		return { Run: runs.Read( id ) };
	} );
}


//---------------------------------------------------------------------

async function main()
{
	await ELECTRON.app.whenReady();
	let user_data = ELECTRON.app.getPath( 'userData' );
	settings_path = PATH.join( user_data, 'desktop.json' );
	settings = SETTINGS.Read( settings_path );
	if ( !require( 'fs' ).existsSync( settings_path ) )
	{
		save_settings();
	}
	local = LOCAL.Local();
	runs = RUNS.Runs( { Folder: PATH.join( user_data, 'runs' ) } );
	runs.OnChange( broadcast_run );
	page = await PAGE.Serve();
	attach_handlers();
	create_window();
	ELECTRON.app.on( 'window-all-closed', function ()
	{
		page.Close().catch( function () {} ).then( function () { ELECTRON.app.quit(); } );
	} );
	// What was open last: a saved server, or the local server (started again over its folder); on failure, the
	// connect screen says why.
	let opened = false;
	if ( settings.Last && settings.Last.Kind === 'local' && settings.Local.Data )
	{
		let started = await start_local( settings.Local.Data );
		if ( started.Ok )
		{
			opened = ( await connect( { Kind: 'local' } ) ).Ok;
		}
		else
		{
			reason = started.Error;
		}
	}
	else if ( settings.Last && settings.Last.Kind === 'server' )
	{
		opened = ( await connect( { Kind: 'server', Name: settings.Last.Name } ) ).Ok;
	}
	if ( !opened )
	{
		show_connect();
	}
}


main().catch( function ( error )
{
	console.error( error.message );
	ELECTRON.app.exit( 1 );
} );
