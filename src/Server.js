'use strict';

// Server - Start( { Data, Port, Host } ) returns { App, Address, Url, Settings, Store, Events, Close }.
// It listens on Host (the option, else the settings' Host, else 127.0.0.1); any address is accepted, and Address.Local
// says whether it stays on this machine. The data folder is ~data beside package.json unless given.
// The settings are read once at start and changed in place by the settings routes (Api.js); Host and Port take
// effect at the next start.

const PATH = require( 'path' );
const FS = require( 'fs' );
const EXPRESS = require( 'express' );
const STORE = require( './Store.js' );
const PARTICIPANTS = require( './Participants.js' );
const EVENTS = require( './Events.js' );
const API = require( './Api.js' );
const INSTRUCTIONS = require( './Instructions.js' );

const DEFAULT_PORT = 3500;
const DEFAULT_HOST = PARTICIPANTS.DEFAULT_HOST;
const LOCAL_HOSTS = [ '127.0.0.1', 'localhost', '::1' ];
const DEFAULT_DATA = PATH.join( __dirname, '..', '~data' );
const PUBLIC_FOLDER = PATH.join( __dirname, '..', 'public' );


async function Start( Options )
{
	let options = Options || {};

	let store = STORE.Open( options.Data || DEFAULT_DATA );
	let settings = await store.ReadSettings();
	let settings_written = false;
	if ( !settings )
	{
		settings = PARTICIPANTS.DefaultSettings( DEFAULT_PORT, DEFAULT_HOST );
		await store.WriteSettings( settings );
		settings_written = true;
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
	let port = ( options.Port !== undefined ) ? options.Port : ( settings.Port || DEFAULT_PORT );
	let host = options.Host || settings.Host || DEFAULT_HOST;

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

	let server = await listen( app, host, port );
	let address = server.address();

	async function Close()
	{
		events.Close();
		server.closeAllConnections();
		await new Promise( function ( resolve ) { server.close( resolve ); } );
	}

	return {
		App: app,
		Server: server,
		Address: { Host: host, Port: address.port, Local: LOCAL_HOSTS.includes( host ) },
		Url: 'http://' + url_host( host ) + ':' + address.port,
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
	DEFAULT_DATA: DEFAULT_DATA,
};
