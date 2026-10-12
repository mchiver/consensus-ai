'use strict';

// Server - Start( { Config, Port, Scope } ) returns { App, Address, Url, Settings, Store, Events, Close }.
// The config folder (plan Run Shapes, Step 1) is <user>/.consensus unless given (Data is the older name of the same
// option); its consensus.json holds the settings, and the projects live in it as well until Step 2. The server
// listens as the Scope says (the option, else the settings', else Local): Local on 127.0.0.1, Public on 0.0.0.0, and
// None not at all, in which case Address, Url and Server are null and the settings and the store are still there for
// the desktop. The settings are read once at start and changed in place by the settings routes (Api.js); Scope and
// Port take effect at the next start.

const PATH = require( 'path' );
const OS = require( 'os' );
const FS = require( 'fs' );
const EXPRESS = require( 'express' );
const STORE = require( './Store.js' );
const PARTICIPANTS = require( './Participants.js' );
const EVENTS = require( './Events.js' );
const API = require( './Api.js' );
const INSTRUCTIONS = require( './Instructions.js' );

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
	let problems = PARTICIPANTS.Validate( settings );
	if ( problems.length )
	{
		throw new Error( 'settings ' + store.SettingsPath() + ': ' + problems.join( '; ' ) );
	}
	for ( let line of await store.Prepare() )
	{
		console.log( 'prepared ' + line );
	}
	let renamed = await rename_state( store, settings );
	if ( renamed )
	{
		console.log( renamed );
	}
	let port = ( options.Port !== undefined ) ? options.Port : ( settings.Port || DEFAULT_PORT );
	let scope = PARTICIPANTS.SCOPES.includes( options.Scope ) ? options.Scope : PARTICIPANTS.Scope( settings );
	let host = PARTICIPANTS.HostOf( scope );

	let app = EXPRESS();
	app.disable( 'x-powered-by' );
	let events = EVENTS.Hub();
	events.Attach( app, '/api/events' );
	API.Attach( app, { Store: store, Settings: settings, Events: events } );
	INSTRUCTIONS.Attach( app, { Settings: settings } );
	attach_vendor( app );
	if ( FS.existsSync( PUBLIC_FOLDER ) )
	{
		app.use( EXPRESS.static( PUBLIC_FOLDER ) );
	}

	let server = host ? await listen( app, host, port ) : null;
	let address = server ? server.address() : null;

	async function Close()
	{
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
		Url: server ? 'http://' + url_host( host ) + ':' + address.port : null,
		Settings: settings,
		SettingsWritten: settings_written,
		Store: store,
		Events: events,
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
	DEFAULT_PORT: DEFAULT_PORT,
	DEFAULT_CONFIG: DEFAULT_CONFIG,
};
