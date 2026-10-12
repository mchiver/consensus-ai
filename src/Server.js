'use strict';

// Server - Start( { Config, Port, Scope, Project } ) returns { App, Address, Url, Settings, Store, Events, Close, ... }.
// The config folder (plan Run Shapes, Step 1) is <user>/.consensus unless given (Data is the older name of the same
// option); its consensus.json holds the settings, whose Projects list the project folders (Step 2: Store.js). The server
// listens as the Scope says (the option, else the settings', else Local): Local on 127.0.0.1, Public on 0.0.0.0, and
// None not at all, in which case Address, Url and Server are null and the settings and the store are still there for
// the desktop. The settings are read once at start and changed in place by the settings routes (Api.js); Scope and
// Port take effect at the next start. Step 3: the server runs the LLMs: the settings' Llms (Llms.js) are filled and
// checked, the desktop's workspaces from before are moved into the projects, and the runs (Runs.js, their records in
// <config>/runs/) and the Runner are attached to the API; a run's changes go out over the events. Step 4: Project
// (a folder on the command line) loads that project alone, Scope None taken as Local for it; the configured port in
// use (another instance) gives way to a free one, PortTaken saying which was taken.

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
	let runs = RUNS.Runs( { Folder: PATH.join( store.Folder, 'runs' ) } );
	runs.OnChange( function ( summary )
	{
		events.Send( { Kind: 'run', Run: summary.Id, Llm: summary.Llm ? summary.Llm.Id : null, Status: summary.Status } );
	} );
	let runner = RUNNER.Runner( { Store: store, Settings: settings, Runs: runs, Url: function () { return url; } } );
	API.Attach( app, { Store: store, Settings: settings, Events: events, Runs: runs, Runner: runner } );
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
		SettingsWritten: settings_written,
		Store: store,
		Events: events,
		Runs: runs,
		Runner: runner,
		Close: Close,
	};
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
	for ( let proposal of await store.ListProposals() )
	{
		if ( proposal.Kind === 'plan' && proposal.State === from )
		{
			await store.UpdateProposal( proposal.Id, { State: to } );
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
	MigrateWorkspaces: migrate_workspaces,
	DEFAULT_PORT: DEFAULT_PORT,
	DEFAULT_CONFIG: DEFAULT_CONFIG,
};
