'use strict';

// Server - Start( { Config, Port, Scope, Project, Clerk? } ) returns { App, Address, Url, Settings, Store, Events, Close, ... }.
// The config folder (plan Run Shapes, Step 1) is <user>/.consensus unless given (Data is the older name of the same
// option); its consensus.json holds the settings, whose Projects list the project folders (Step 2: Store.js). The server
// listens as the Scope says (the option, else the settings', else Local): Local on 127.0.0.1, Public on 0.0.0.0, and
// None not at all, in which case Address, Url and Server are null and the settings and the store are still there for
// the desktop. The settings are read once at start and changed in place by the settings routes (Api.js); Scope and
// Port take effect at the next start. Step 3: the server runs the LLMs: the settings' Llms (Llms.js) are filled and
// checked, the desktop's workspaces from before are moved into the projects, and the runs (Runs.js, their records in
// <config>/runs/) and the Runner are attached to the API; a run's changes go out over the events. Step 4: Project
// (a folder on the command line) loads that project alone, Scope None taken as Local for it; the configured port in
// use (another instance) gives way to a free one, PortTaken saying which was taken. Plan User Management, Step 4: Clerk
// (Clerk.js) over the settings' Clerk section and the registry; the option Clerk = { Jwks, FetchUser } is the tests'
// way of standing in for the instance.

const PATH = require( 'path' );
const OS = require( 'os' );
const FS = require( 'fs' );
const EXPRESS = require( 'express' );
const STORE = require( './Store.js' );
const PARTICIPANTS = require( './Participants.js' );
const EVENTS = require( './Events.js' );
const API = require( './Api.js' );
const INSTRUCTIONS = require( './Instructions.js' );
const LLMS = require( './Llms.js' );
const RUNS = require( './Runs.js' );
const RUNNER = require( './Runner.js' );
const GIT = require( './Git.js' );
const USERS = require( './Users.js' );
const CLERK = require( './Clerk.js' );
const ROLES = require( './Roles.js' );

const DEFAULT_PORT = 3500;
const DEFAULT_CONFIG = PATH.join( OS.homedir(), '.consensus' );
const PUBLIC_FOLDER = PATH.join( __dirname, '..', 'public' );


async function Start( Options )
{
	let options = Options || {};

	let store = STORE.Open( options.Config || options.Data || DEFAULT_CONFIG );
	let settings = await store.ReadSettings();
	let settings_written = false;
	if ( !settings )
	{
		settings = PARTICIPANTS.DefaultSettings( DEFAULT_PORT, options.Scope );
		await store.WriteSettings( settings );
		settings_written = true;
	}
	let migrated = PARTICIPANTS.Migrate( settings );
	if ( migrated.length )
	{
		await store.WriteSettings( settings );
		console.log( 'settings brought up to date: ' + migrated.join( '; ' ) );
	}
	let before = JSON.stringify( settings.Llms || [] );
	settings.Llms = ( Array.isArray( settings.Llms ) ? settings.Llms : [] ).map( LLMS.Fill );
	for ( let line of LLMS.Migrate( settings ) )
	{
		console.log( 'settings brought up to date: ' + line );
	}
	if ( JSON.stringify( settings.Llms ) !== before )
	{
		await store.WriteSettings( settings );
	}
	let problems = PARTICIPANTS.Validate( settings ).concat( LLMS.Problems( settings ) );
	if ( problems.length )
	{
		throw new Error( 'settings ' + store.SettingsPath() + ': ' + problems.join( '; ' ) );
	}
	for ( let line of await store.Prepare( settings, { Project: options.Project } ) )
	{
		console.log( 'prepared ' + line );
	}
	let project = store.Isolated() ? await store.ReadProject( store.Isolated() ) : null;
	for ( let line of await migrate_workspaces( store, settings ) )
	{
		console.log( line );
	}
	let renamed = await rename_state( store, settings );
	if ( renamed )
	{
		console.log( renamed );
	}
	// The users and the role folders (plan User Management, Step 3): the owner's record, and empty Roles in each project.
	let users = USERS.Users( { Folder: store.Folder } );
	for ( let line of users.Migrate( settings ) )
	{
		console.log( 'users brought up to date: ' + line );
	}
	for ( let line of await migrate_roles( store ) )
	{
		console.log( line );
	}
	// The Administrator from the environment (plan Clerk, Step 5: a Docker server nobody signed in to yet).
	let admin_from_env = ( process.env.CONSENSUS_ADMIN || '' ).trim();
	if ( admin_from_env && !( settings.Clerk && settings.Clerk.AdminEmail ) )
	{
		let with_admin = Object.assign( {}, settings, { Clerk: Object.assign( {}, settings.Clerk || {}, { AdminEmail: admin_from_env } ) } );
		if ( PARTICIPANTS.Validate( with_admin ).length === 0 )
		{
			settings.Clerk = with_admin.Clerk;
			await store.WriteSettings( settings );
			console.log( 'the Administrator from CONSENSUS_ADMIN: ' + admin_from_env );
		}
		else
		{
			console.log( 'CONSENSUS_ADMIN is not an email address: ignored' );
		}
	}
	let clerk = CLERK.Clerk( { Settings: settings, Users: users, Jwks: options.Clerk ? options.Clerk.Jwks : null, FetchUser: options.Clerk ? options.Clerk.FetchUser : null } );
	if ( clerk.On() && PARTICIPANTS.Trust( settings ) === 'clerk' )
	{
		let admin_email = ( settings.Clerk && settings.Clerk.AdminEmail ) ? settings.Clerk.AdminEmail : null;
		console.log( 'Clerk: people sign in through ' + ( clerk.FrontendApi() || 'an instance the publishable key does not name' ) + ' with a license; ' + ( admin_email ? ( 'the Administrator is ' + admin_email ) : 'no Administrator yet: the first sign-in with a Host license becomes it' ) );
	}
	let port = ( options.Port !== undefined ) ? options.Port : ( settings.Port || DEFAULT_PORT );
	let scope = PARTICIPANTS.SCOPES.includes( options.Scope ) ? options.Scope : PARTICIPANTS.Scope( settings );
	let scope_forced = false;
	if ( project && scope === 'None' )
	{
		scope = 'Local';
		scope_forced = true;
	}
	let host = PARTICIPANTS.HostOf( scope );

	let app = EXPRESS();
	app.disable( 'x-powered-by' );
	let events = EVENTS.Hub();
	events.Attach( app, '/api/events' );
	let url = null;
	let tokens = PARTICIPANTS.RunTokens();
	let runs = RUNS.Runs( { Folder: PATH.join( store.Folder, 'runs' ), Tokens: tokens } );
	runs.OnChange( function ( summary )
	{
		events.Send( { Kind: 'run', Run: summary.Id, Llm: summary.Llm ? summary.Llm.Id : null, Status: summary.Status } );
	} );
	let git = GIT.Git();
	let runner = RUNNER.Runner( { Store: store, Settings: settings, Runs: runs, Url: function () { return url; }, Tokens: tokens, Git: git } );
	API.Attach( app, { Store: store, Settings: settings, Events: events, Runs: runs, Runner: runner, Tokens: tokens, Git: git, Users: users, Clerk: clerk, Url: function () { return url; } } );
	INSTRUCTIONS.Attach( app, { Settings: settings } );
	attach_vendor( app );
	if ( FS.existsSync( PUBLIC_FOLDER ) )
	{
		app.use( EXPRESS.static( PUBLIC_FOLDER ) );
	}

	let server = null;
	let port_taken = null;
	if ( host )
	{
		try
		{
			server = await listen( app, host, port );
		}
		catch ( error )
		{
			// The configured port in use (another instance, plan Run Shapes, Step 4): a free one is taken instead; a port
			// asked for on the command line is not given up.
			if ( error.code !== 'EADDRINUSE' || options.Port !== undefined )
			{
				throw error;
			}
			port_taken = port;
			server = await listen( app, host, 0 );
		}
	}
	let address = server ? server.address() : null;
	url = server ? 'http://' + url_host( host ) + ':' + address.port : null;

	async function Close()
	{
		await runs.Close();
		events.Close();
		if ( server )
		{
			server.closeAllConnections();
			await new Promise( function ( resolve ) { server.close( resolve ); } );
		}
	}

	return {
		App: app,
		Server: server,
		Scope: scope,
		Address: server ? { Host: host, Port: address.port, Local: ( scope === 'Local' ) } : null,
		Url: url,
		Project: project,
		PortTaken: port_taken,
		ScopeForced: scope_forced,
		Settings: settings,
		Tokens: tokens,
		Users: users,
		Clerk: clerk,
		SettingsWritten: settings_written,
		Store: store,
		Events: events,
		Runs: runs,
		Runner: runner,
		Close: Close,
	};
}


// Each project without role folders gets the four, empty (plan User Management, Step 3).
async function migrate_roles( store )
{
	let lines = [];
	for ( let project of await store.ListProjects() )
	{
		if ( project.Roles && typeof project.Roles === 'object' )
		{
			continue;
		}
		project.Roles = ROLES.Empty();
		await store.WriteProject( project );
		lines.push( 'project ' + project.Name + ': the role folders Owners, Members, Service and Watchers made, empty' );
	}
	return lines;
}


// Vendor packages, each served from where require resolves it; never a joined node_modules path.
function attach_vendor( app )
{
	let files = {
		'angular.min.js': require.resolve( 'angular/angular.min.js' ),
		'angular.min.js.map': require.resolve( 'angular/angular.min.js.map' ),
		'bootstrap.min.css': require.resolve( 'bootstrap/dist/css/bootstrap.min.css' ),
		'bootstrap.min.css.map': require.resolve( 'bootstrap/dist/css/bootstrap.min.css.map' ),
		'marked.umd.js': PATH.join( PATH.dirname( require.resolve( 'marked' ) ), 'marked.umd.js' ),
	};
	for ( let name of Object.keys( files ) )
	{
		if ( !FS.existsSync( files[ name ] ) )
		{
			throw new Error( 'vendor file missing: ' + files[ name ] );
		}
	}
	app.get( '/vendor/:name', function ( request, response )
	{
		let file = files[ request.params.name ];
		if ( !file )
		{
			return response.status( 404 ).json( { Error: 'no such vendor file' } );
		}
		response.sendFile( file );
	} );
	// monaco-editor resolves to min/vs/index.js; the folder around it is the AMD build (pinned: 0.56.0).
	let monaco_folder = PATH.dirname( require.resolve( 'monaco-editor' ) );
	if ( !FS.existsSync( PATH.join( monaco_folder, 'loader.js' ) ) )
	{
		throw new Error( 'monaco-editor AMD build missing at ' + monaco_folder );
	}
	app.use( '/vendor/monaco', EXPRESS.static( monaco_folder ) );
	// CodeMirror 6 (plan UI Components, Step 3): the six packages the page imports and every package under them,
	// each served at /vendor/codemirror/<name>/ from where require resolves it; index.html's import map names them.
	for ( let one of codemirror_packages() )
	{
		app.use( '/vendor/codemirror/' + one.Name, EXPRESS.static( one.Folder ) );
	}
}


const CODEMIRROR_TOP = [ '@codemirror/state', '@codemirror/view', '@codemirror/language', '@codemirror/commands', '@codemirror/search', '@codemirror/lang-markdown' ];


// The folder of a package: up from the file require resolves to the nearest package.json carrying its name (these
// packages restrict their exports, so their package.json cannot be resolved by name).
function package_folder( name )
{
	let folder = PATH.dirname( require.resolve( name ) );
	while ( true )
	{
		let manifest = PATH.join( folder, 'package.json' );
		if ( FS.existsSync( manifest ) && JSON.parse( FS.readFileSync( manifest, 'utf8' ) ).name === name )
		{
			return folder;
		}
		let up = PATH.dirname( folder );
		if ( up === folder )
		{
			throw new Error( 'package folder not found: ' + name );
		}
		folder = up;
	}
}


// The CodeMirror packages, the six and everything under them, sorted by name: [ { Name, Folder, Entry } ], Entry the
// ES module file inside the folder that the import map points at.
function codemirror_packages()
{
	let found = new Map();
	function walk( name )
	{
		if ( found.has( name ) )
		{
			return;
		}
		let folder = package_folder( name );
		let manifest = JSON.parse( FS.readFileSync( PATH.join( folder, 'package.json' ), 'utf8' ) );
		let exported = manifest.exports ? ( manifest.exports[ '.' ] || manifest.exports ) : null;
		let entry = exported ? ( exported.import || exported.default ) : manifest.module;
		if ( entry && typeof entry === 'object' )
		{
			entry = entry.default;
		}
		if ( !entry )
		{
			throw new Error( 'no module entry for ' + name );
		}
		found.set( name, { Name: name, Folder: folder, Entry: entry.replace( /^\.\//, '' ) } );
		for ( let dependency of Object.keys( manifest.dependencies || {} ) )
		{
			walk( dependency );
		}
	}
	for ( let name of CODEMIRROR_TOP )
	{
		walk( name );
	}
	return Array.from( found.values() ).sort( function ( a, b ) { return a.Name < b.Name ? -1 : 1; } );
}


// The host to put in a URL for this machine: every interface is reached at 127.0.0.1; IPv6 goes in brackets.
function url_host( host )
{
	if ( host === '0.0.0.0' || host === '::' )
	{
		return '127.0.0.1';
	}
	return host.includes( ':' ) ? '[' + host + ']' : host;
}


// The first state's new name (plan UI Tweaks V): a settings list that still has the old name and not the new one is
// changed in place and written back, and every plan in the old state is put in the new one, with no revision. A list
// the owner named otherwise is left alone. Returns the line to log, or null when nothing was renamed.
async function rename_state( store, settings )
{
	let from = PARTICIPANTS.RENAMED_STATE.From;
	let to = PARTICIPANTS.RENAMED_STATE.To;
	let states = Array.isArray( settings.States ) ? settings.States : [];
	if ( !states.includes( from ) || states.includes( to ) )
	{
		return null;
	}
	settings.States = states.map( function ( state ) { return ( state === from ) ? to : state; } );
	await store.WriteSettings( settings );
	// Each project's own list too (plan Run Shapes, Step 2), when it still has the old name.
	for ( let project of await store.ListProjects() )
	{
		if ( Array.isArray( project.States ) && project.States.includes( from ) && !project.States.includes( to ) )
		{
			project.States = project.States.map( function ( state ) { return ( state === from ) ? to : state; } );
			await store.WriteProject( project );
		}
	}
	let count = 0;
	for ( let plan of await store.ListPlans() )
	{
		if ( plan.Kind === 'plan' && plan.State === from )
		{
			await store.UpdatePlan( plan.Id, { State: to } );
			count += 1;
		}
	}
	return 'renamed state ' + from + ' to ' + to + ' in the settings and ' + count + ' plan' + ( ( count === 1 ) ? '' : 's' );
}


// The desktop's workspaces (from before plan Run Shapes, Step 3) into the projects: a workspace on a project's folder
// gives that project its Include, Exclude and Commands when the project has none of its own, and the list is then
// dropped from the settings. Returns the lines to log; none when there is no list.
async function migrate_workspaces( store, settings )
{
	if ( !Array.isArray( settings.Workspaces ) )
	{
		return [];
	}
	let lines = [];
	let projects = await store.ListProjects();
	for ( let workspace of settings.Workspaces )
	{
		let what = 'workspace "' + ( workspace.Name || '?' ) + '" (' + ( workspace.Path || '?' ) + ')';
		let project = projects.find( function ( one ) { return same_folder( one.Path, workspace.Path ); } );
		if ( !project )
		{
			lines.push( what + ' dropped: no project is on that folder' );
			continue;
		}
		if ( !lists_empty( project ) )
		{
			lines.push( what + ' dropped: the project ' + project.Name + ' has lists of its own' );
			continue;
		}
		project.Include = lines_of( workspace.Include );
		project.Exclude = lines_of( workspace.Exclude );
		project.Commands = lines_of( workspace.Commands );
		await store.WriteProject( project );
		lines.push( what + ': its Include, Exclude and Commands moved into the project ' + project.Name );
	}
	delete settings.Workspaces;
	await store.WriteSettings( settings );
	return lines;
}


function same_folder( one, other )
{
	if ( !one || !other )
	{
		return false;
	}
	let a = PATH.resolve( String( one ) ).replace( /\\/g, '/' ).replace( /\/+$/, '' );
	let b = PATH.resolve( String( other ) ).replace( /\\/g, '/' ).replace( /\/+$/, '' );
	if ( process.platform === 'win32' )
	{
		return a.toLowerCase() === b.toLowerCase();
	}
	return a === b;
}


function lists_empty( project )
{
	let exclude = Array.isArray( project.Exclude ) ? project.Exclude : [];
	return !( project.Include || [] ).length && !( project.Commands || [] ).length && exclude.join( '\n' ) === STORE.DEFAULT_EXCLUDE.join( '\n' );
}


function lines_of( value )
{
	if ( !Array.isArray( value ) )
	{
		return [];
	}
	return value.map( function ( line ) { return String( line ).trim(); } ).filter( function ( line ) { return line; } );
}


function listen( app, host, port )
{
	return new Promise( function ( resolve, reject )
	{
		let server = app.listen( port, host );
		server.once( 'listening', function () { resolve( server ); } );
		server.once( 'error', reject );
	} );
}


module.exports = {
	Start: Start,
	AttachVendor: attach_vendor,
	CodeMirrorPackages: codemirror_packages,
	MigrateWorkspaces: migrate_workspaces,
	DEFAULT_PORT: DEFAULT_PORT,
	DEFAULT_CONFIG: DEFAULT_CONFIG,
};
