'use strict';

// Server - Start( { Config, Port, Scope, Project, Clerk? } ) returns { App, Address, Url, Settings, Store, Events, Close, ... }.
// The config folder (plan Run Shapes, Step 1) is <user>/.consensus unless given (Data is the older name of the same
// option); its consensus.json holds the settings, whose Projects list the project folders (Step 2: Store.js). The server
// listens as the Scope says (the option, else the settings', else Local): Local on 127.0.0.1, Public on 0.0.0.0, and
// None not at all, in which case Address, Url and Server are null and the settings and the store are still there for
// the desktop. The settings are read once at start and changed in place by the settings routes (Api.js); Scope and
// Port take effect at the next start. Step 3: the server runs the LLMs: the settings' Llms (Llms.js) are filled and
// checked, and the runs (Runs.js, their records in
// <config>/runs/) and the Runner are attached to the API; a run's changes go out over the events. Step 4: Project
// (a folder on the command line) loads that project alone, Scope None taken as Local for it; the configured port in
// use (another instance) gives way to a free one, PortTaken saying which was taken. Plan User Management, Step 4: Clerk
// (Clerk.js) over the settings' Clerk section and the registry; the option Clerk = { Jwks } is the tests'
// way of standing in for the instance. Plan Rearchitecturation, Step 3: a project's server is the sidecar (Sidecar.js):
// with no --port its port is hashed from the folder into 3600 to 3699, stepped up while taken; it listens on 127.0.0.1
// whatever the Scope says (None keeps the window's server and turns the sidecar off: no address file); while it runs,
// <folder>/.consensus/~sidecar.json holds { Url, Port, Pid, Started, Project }, removed at Close; the option Activate
// (a function, the Desktop's) answers POST /api/desktop/activate by bringing the window to the front. Step 4: ReadOnly
// (the Desktop's) opens the config read-only (Store.Open): consensus.json is the Server's and never written (no
// settings, users or registry write; a missing file is the defaults in memory); the connection and settings writes are
// refused in Operations.js with the Server's line. Plan The Server, Step 4: the Desktop's sidecar mode: a ReadOnly
// server reads no connections or tasks from the file (none in memory, so no runs), and /api/me says Sidecar.
// Plan Sidecar Edition, Step 1: three options for the Sidecar app, which has nothing to do with the config folder:
// Settings (the settings given, in place of consensus.json, which is not read), Ports ({ Start, Count }: the range the
// folder's port is hashed into, Sidecar.SIDECAR_APP_RANGE for the app) and AddressFile (false: no ~sidecar.json).
// Step 3: Guide, the path of the guide the instructions serve, the page and the MCP tool alike
// (Instructions.SIDECAR_GUIDE_PATH for the app).
// Plan Tool calls only, Step 3: a connection of a kind the Server does not run (claude-cli) is removed from the
// settings when they are read, each named on the log; a project that had chosen it has none chosen. No run token is
// made any more: the runs are the tool loop, their tools performed inside the Server (Runner.Attach, from Api.js).

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
const TASKS = require( './Tasks.js' );
const CLERK = require( './Clerk.js' );
const SIDECAR = require( './Sidecar.js' );
const HOST = require( './Host.js' );
const ROLES = require( './Roles.js' );
const LICENSE = require( './License.js' );
const GATE = require( './Gate.js' );

const DEFAULT_PORT = 3500;
const DEFAULT_CONFIG = PATH.join( OS.homedir(), '.consensus' );
const PUBLIC_FOLDER = PATH.join( __dirname, '..', 'public' );


async function Start( Options )
{
	let options = Options || {};

	let read_only = !!options.ReadOnly;
	let store = STORE.Open( options.Config || options.Data || DEFAULT_CONFIG, { ReadOnly: read_only } );
	let given = ( options.Settings && typeof options.Settings === 'object' ) ? JSON.parse( JSON.stringify( options.Settings ) ) : null;
	let settings = given || await store.ReadSettings();
	let settings_written = false;
	if ( !settings )
	{
		settings = PARTICIPANTS.DefaultSettings( DEFAULT_PORT, options.Scope );
		if ( !read_only )
		{
			await store.WriteSettings( settings );
			settings_written = true;
		}
	}
	// The Tasks list made at the first start (Tasks.js), and the connections filled in.
	let prepared = TASKS.Prepare( settings );
	for ( let line of prepared )
	{
		console.log( 'settings prepared: ' + line );
	}
	let before = JSON.stringify( settings.Llms || [] );
	let unknown = LLMS.Unknown( settings.Llms );
	for ( let llm of unknown )
	{
		console.log( 'settings: the LLM connection "' + ( ( llm && llm.Name ) || '?' ) + '" removed: the kind "' + ( ( llm && llm.Kind ) || '?' ) + '" is no longer run' );
	}
	settings.Llms = ( Array.isArray( settings.Llms ) ? settings.Llms : [] ).filter( function ( llm ) { return !unknown.includes( llm ); } ).map( LLMS.Fill );
	if ( ( prepared.length || JSON.stringify( settings.Llms ) !== before ) && !read_only )
	{
		await store.WriteSettings( settings );
	}
	let problems = PARTICIPANTS.Validate( settings ).concat( LLMS.Problems( settings ) );
	if ( problems.length )
	{
		throw new Error( 'settings ' + store.SettingsPath() + ': ' + problems.join( '; ' ) );
	}
	if ( read_only )
	{
		// sidecar mode (plan The Server, Step 4): the Server's connections and tasks are the Server's alone
		settings.Llms = [];
		settings.Tasks = [];
	}
	for ( let line of await store.Prepare( settings, { Project: options.Project } ) )
	{
		console.log( 'prepared ' + line );
	}
	let project = store.Isolated() ? await store.ReadProject( store.Isolated() ) : null;
	// The users (plan User Management, Step 3): the owner's record, made at the first start.
	// Read-only (the Desktop over the Host's config): the owner's record is kept in memory, never written, so a Clerk
	// session on the window's server is the owner's as on any Local server.
	let users = USERS.Users( { Folder: store.Folder, ReadOnly: read_only } );
	for ( let line of users.Prepare( settings ) )
	{
		console.log( 'users prepared: ' + line );
	}
	// The Administrator from the environment (plan Clerk, Step 5: a Docker server nobody signed in to yet).
	let admin_from_env = ( process.env.CONSENSUS_ADMIN || '' ).trim();
	if ( admin_from_env && !read_only && !( settings.Clerk && settings.Clerk.AdminEmail ) )
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
	// People (plan The Server, Step 5): a Server over every registered project tells people apart by their sign-in
	// whatever its Scope; the same servers the gate covers (a project's own server and the tests' do not).
	let people = !!options.Gate && !project && !read_only;
	let clerk = CLERK.Clerk( { Settings: settings, Users: users, People: people, Jwks: options.Clerk ? options.Clerk.Jwks : null } );
	if ( clerk.On() && PARTICIPANTS.Trust( settings, people ) === 'clerk' )
	{
		let admin_email = ( settings.Clerk && settings.Clerk.AdminEmail ) ? settings.Clerk.AdminEmail : null;
		console.log( 'Clerk: people sign in through ' + ( clerk.FrontendApi() || 'an instance the publishable key does not name' ) + ' with a license; ' + ( admin_email ? ( 'the Administrator is ' + admin_email ) : 'no Administrator yet: the first sign-in with a Personal or Professional license becomes it' ) );
	}
	let port = ( options.Port !== undefined ) ? options.Port : ( settings.Port || DEFAULT_PORT );
	let scope = PARTICIPANTS.SCOPES.includes( options.Scope ) ? options.Scope : PARTICIPANTS.Scope( settings );
	let scope_forced = false;
	let sidecar_off = false;
	if ( project && scope !== 'Local' )
	{
		// The sidecar listens on this machine alone: Public is taken as Local; None keeps the server for the window
		// (the page reaches it through its address) and writes no address file, so nothing finds it.
		sidecar_off = ( scope === 'None' );
		scope = 'Local';
		scope_forced = true;
	}
	// The Desktop's Host (plan Rearchitecturation, Step 6): Scope Public is refused at bind time below the Professional tier,
	// the one place the tier is checked; a Host started with no Tier (the headless form, the image) listens as its file says
	// and admits licensed sign-ins alone.
	if ( scope === 'Public' && options.Tier !== undefined && options.Tier !== null && ROLES.PlanRank( options.Tier ) < ROLES.PlanRank( 'professional' ) )
	{
		throw new Error( 'Scope Public needs a Professional license: the current user is at the ' + ( LICENSE.TITLES[ options.Tier ] || 'Unlicensed' ) + ' tier; sign in with one, or run the Server with Scope Local' );
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
	// The gate (plan The Server, Step 3): a Server serving every registered project runs under its Administrator's
	// authority (Gate.js); Options.Gate = { Mode: 'window' | 'headless' } turns it on (Start.js for consensus serve,
	// the Server application for its window). Nothing else is gated: a project's own server, the tests.
	let gate = null;
	if ( options.Gate && !project && !read_only )
	{
		gate = GATE.Gate( { Config: store.Folder, Settings: settings, Users: users, Store: store, Scope: scope, Mode: options.Gate.Mode, Events: events } );
		await gate.Check();
	}
	let git = GIT.Git();
	let runner = RUNNER.Runner( { Store: store, Settings: settings, Runs: runs, Users: users, Git: git } );
	if ( project && typeof options.Activate === 'function' )
	{
		// A Desktop's sidecar brings its window to the front for a second launch on its folder (Sidecar.Activate).
		app.post( SIDECAR.ACTIVATE_PATH, function ( request, response )
		{
			options.Activate();
			response.json( { Ok: true } );
		} );
	}
	API.Attach( app, { Store: store, Settings: settings, Events: events, Runs: runs, Runner: runner, Git: git, Users: users, Clerk: clerk, Gate: gate, People: people, Guide: options.Guide || null, Url: function () { return url; } } );
	INSTRUCTIONS.Attach( app, { Settings: settings, Project: project, People: people, Guide: options.Guide || null } );
	attach_vendor( app );
	if ( FS.existsSync( PUBLIC_FOLDER ) )
	{
		app.use( EXPRESS.static( PUBLIC_FOLDER ) );
	}

	let server = null;
	let port_taken = null;
	if ( host && project && options.Port === undefined )
	{
		// The sidecar's port: the folder's, stepped up by one while taken, wrapping at the range's end.
		let ports = SIDECAR.Ports( project.Path, options.Ports );
		for ( let candidate of ports )
		{
			try
			{
				server = await listen( app, host, candidate );
				break;
			}
			catch ( error )
			{
				if ( error.code !== 'EADDRINUSE' )
				{
					throw error;
				}
				port_taken = ( port_taken === null ) ? candidate : port_taken;
			}
		}
		if ( !server )
		{
			throw new Error( 'no free port for the sidecar: every port from ' + Math.min.apply( null, ports ) + ' to ' + Math.max.apply( null, ports ) + ' is in use' );
		}
	}
	else if ( host )
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

	// The address file, while the project is open (a stale one, its process gone, is overwritten here).
	let sidecar = null;
	if ( server && project && !sidecar_off && options.AddressFile !== false )
	{
		let record = { Url: url, Port: address.port, Pid: process.pid, Started: new Date().toISOString(), Project: { Id: project.Id, Name: project.Name } };
		sidecar = { Path: SIDECAR.Write( project.Path, record ), Record: record };
	}
	// The Host's address file (plan Rearchitecturation, Step 5): the Server Host, `consensus serve`, says where it is
	// in <config>/~host.json while it runs, so the Desktop finds it and can stop the one it started.
	let host_file = null;
	if ( server && !project && !read_only )
	{
		host_file = HOST.Write( store.Folder, { Url: url, Port: address.port, Pid: process.pid, Started: new Date().toISOString() } );
	}

	async function Close()
	{
		if ( sidecar )
		{
			SIDECAR.Remove( project.Path, process.pid );
		}
		if ( host_file )
		{
			HOST.Remove( store.Folder, process.pid );
		}
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
		SidecarOff: sidecar_off,
		Sidecar: sidecar,
		ReadOnly: read_only,
		HostFile: host_file,
		Settings: settings,
		Users: users,
		Clerk: clerk,
		Gate: gate,
		People: people,
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
	DEFAULT_PORT: DEFAULT_PORT,
	DEFAULT_CONFIG: DEFAULT_CONFIG,
};
