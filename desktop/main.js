'use strict';

// main - the desktop's main process (plan Consensus Desktop, Step 2): one window that opens on the connect screen
// and, once connected, shows the desktop's own copy of the Consensus page (served by Page.js on 127.0.0.1, which
// forwards the page's API calls to the connected server). Plan Run Shapes, Step 1: the app is the second entry
// point over src/Start.js: it takes the command line's --config, --port, --scope and --headless, starts this
// machine's server from the global config as the Scope says, and keeps its own settings (Settings.js) in that same
// consensus.json, where desktop.json is moved in once. With --headless there is no window. A second server at the
// same time is a second instance (New window).
// Step 3: the LLM connections and the workspaces (Settings.js), shown by the page in each project's Context
// folder; a connection's Check (Llm.js); the one-shots, packaged here from what the connected server says
// (Package.js) and run by Runs.js, their records in the user-data folder's runs/.
// Step 4: an ollama connection's one-shot gets the desktop's tool instructions (Tools.js) in place of the agent
// guide, and its Consensus tools the llm participant's token, read from the server's settings as the owner.
//
//   npm run desktop          (electron desktop, from the checkout)

const PATH = require( 'path' );
const CHILD_PROCESS = require( 'child_process' );
const ELECTRON = require( 'electron' );
const SETTINGS = require( './Settings.js' );
const START = require( '../src/Start.js' );
const PAGE = require( './Page.js' );
const LLM = require( './Llm.js' );
const PACKAGE = require( './Package.js' );
const RUNS = require( './Runs.js' );
const FILES = require( './Files.js' );
const TOOLS = require( './Tools.js' );

const VERSION = require( '../package.json' ).version;
const TRY_TIMEOUT = 5000;
const FETCH_TIMEOUT = 15000;
// Electron's own switches, which stay on the command line the app parses.
const ELECTRON_SWITCH = /^--(remote-debugging-port|user-data-dir|inspect|enable-logging|no-sandbox|disable-gpu|trace-warnings)/;

let running = null;		// src/Server.js's, from START.Run: this machine's server, or none with Scope None
let store = null;
let settings = null;
let page = null;
let runs = null;
let window = null;
let current = null;		// { Kind: 'server' | 'local', Name, Url, Version } while connected
let reason = null;		// why the last connection failed, for the connect screen
let closing = false;


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
	settings.Last = ( target.Kind === 'local' ) ? { Kind: 'local' } : { Kind: 'server', Name: target.Name };
	save_settings();
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
		runs.Close().catch( function () {} ).then( function ()
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
	return { Url: running.Url, Port: running.Address.Port, Scope: running.Scope, Config: store.Folder };
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
	let in_progress = runs.List().filter( function ( run ) { return run.Status === 'running'; } );
	return { Llms: settings.Llms, Workspaces: settings.Workspaces, Running: in_progress, DefaultPrompts: PACKAGE.DEFAULT_PROMPTS, Server: boot_info().Server };
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
	settings[ list_name ] = list;
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


// The first words of a thread's last reply, for the packaging popup's list.
function last_words( thread )
{
	let replies = thread.Replies || [];
	let last = replies.length ? replies[ replies.length - 1 ] : null;
	if ( !last )
	{
		return '';
	}
	let words = String( last.Text || '' ).replace( /\s+/g, ' ' ).trim();
	return last.By + ': ' + ( ( words.length > 90 ) ? words.slice( 0, 90 ) + '…' : words );
}


// The lists the packaging popup checks: the other Context documents of the project, and the threads of the plan
// waiting on the llm participant. Request = { ProjectId, PlanId? }
async function package_lists( request )
{
	if ( !current )
	{
		return { Error: 'not connected to a Consensus server' };
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
			return { Error: 'no project with the id ' + request.ProjectId };
		}
		let context_folder = ( project.Items || [] ).find( function ( node ) { return node.Id === project.ContextFolder; } );
		let documents = documents_of( context_folder ? context_folder.Items : [], project.Context ? project.Context.Id : null );
		let threads = [];
		if ( request.PlanId )
		{
			let answer = await fetch_json( '/api/proposals/' + encodeURIComponent( request.PlanId ) );
			for ( let thread of answer.Threads || [] )
			{
				if ( ( thread.Turn || [] ).includes( participant ) )
				{
					threads.push( { Id: thread.Id, Status: thread.Status, Anchor: thread.Anchor ? thread.Anchor.Text : null, Last: last_words( thread ) } );
				}
			}
		}
		return { Documents: documents, Threads: threads, Participant: participant };
	}
	catch ( error )
	{
		return { Error: 'the lists could not be read: ' + error.message };
	}
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
	if ( request.Overrides && typeof request.Overrides === 'object' )
	{
		// a preview of what the packaging popup holds before it is saved
		llm = SETTINGS.FillLlm( Object.assign( {}, llm, request.Overrides, { Id: llm.Id } ) );
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
		let is_ollama = ( llm.Kind === 'ollama' );
		let instructions = null;
		if ( llm.Checks.Instructions )
		{
			instructions = is_ollama ? tools_for( request.Kind, workspace, project.Id, null ).Instructions() : await fetch_text( '/instructions' );
		}
		let plan = null;
		let threads = [];
		if ( request.PlanId )
		{
			let answer = await fetch_json( '/api/proposals/' + encodeURIComponent( request.PlanId ) );
			plan = { Id: answer.Proposal.Id, Title: answer.Proposal.Title, State: answer.Proposal.State };
			threads = ( answer.Threads || [] ).filter( function ( thread ) { return ( thread.Turn || [] ).includes( participant ) && !llm.Unchecked.Threads.includes( thread.Id ); } );
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
			InstructionsTitle: is_ollama ? 'Tool instructions' : 'Agent instructions',
			DocumentsHint: is_ollama ? 'Read one with the read_document tool.' : undefined,
			Readme: readme,
			Documents: documents_of( context_folder ? context_folder.Items : [], readme_id ).filter( function ( document ) { return !llm.Unchecked.Documents.includes( document.Id ); } ),
			Threads: threads,
		} );
		return { Prompt: prompt, Llm: llm, Project: { Id: project.Id, Name: project.Name }, Plan: plan, Workspace: workspace, Participant: participant };
	}
	catch ( error )
	{
		return { Error: 'the package could not be made: ' + error.message };
	}
}


// The tools of an ollama run (Step 4): over the workspace and the connected server, as the llm participant.
function tools_for( kind, workspace, project_id, token )
{
	return TOOLS.Tools( { Kind: kind, Workspace: workspace, Server: { Url: current.Url, Token: token, Project: project_id } } );
}


// The llm participant's token, from the server's settings (the owner reads them): what the Consensus tools post with.
async function llm_token()
{
	let answer = await fetch_json( '/api/settings' );
	let participants = ( answer.Settings && answer.Settings.Participants ) || [];
	let llm_participant = participants.find( function ( participant ) { return participant.Role === 'llm'; } );
	if ( !llm_participant || !llm_participant.Token )
	{
		throw new Error( 'the server has no llm participant with a Token; the owner sets one in its settings' );
	}
	return llm_participant.Token;
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
		let server = null;
		if ( made.Llm.Kind === 'ollama' )
		{
			server = { Url: current.Url, Token: await llm_token(), Project: made.Project.Id };
		}
		let run = runs.Start( { Llm: made.Llm, Kind: request.Kind, Project: made.Project, Plan: made.Plan, Workspace: made.Workspace, Prompt: made.Prompt, Server: server } );
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

	ELECTRON.ipcMain.handle( 'llm-check', async function ( event, id_or_llm )
	{
		if ( id_or_llm && typeof id_or_llm === 'object' )
		{
			return LLM.Check( SETTINGS.FillLlm( id_or_llm ) );
		}
		let llm = SETTINGS.LlmById( settings, id_or_llm );
		if ( !llm )
		{
			return { Ok: false, Error: 'no LLM connection with the id ' + id_or_llm };
		}
		return LLM.Check( llm );
	} );

	ELECTRON.ipcMain.handle( 'package-lists', function ( event, request )
	{
		return package_lists( request || {} );
	} );

	// The files a workspace includes, for its page: Request = { Path, Include, Exclude }
	ELECTRON.ipcMain.handle( 'files', function ( event, request )
	{
		let filled = SETTINGS.FillWorkspace( Object.assign( { Name: 'x', Project: 'x' }, request || {} ) );
		return FILES.Walk( filled.Path, filled.Include, filled.Exclude );
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
	}
	apply_native_theme();
	runs = RUNS.Runs( { Folder: PATH.join( user_data, 'runs' ) } );
	runs.OnChange( broadcast_run );
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
	// What was open last: a saved server, else this machine's server when it runs; on failure, the connect screen
	// says why.
	let opened = false;
	if ( settings.Last && settings.Last.Kind === 'server' )
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
	runs.Close().catch( function () {} ).then( function () { return running.Close(); } ).catch( function () {} ).then( function () { ELECTRON.app.exit( 0 ); } );
}


main().catch( function ( error )
{
	console.error( error.message );
	ELECTRON.app.exit( 1 );
} );
