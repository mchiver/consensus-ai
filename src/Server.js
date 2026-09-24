'use strict';

// Server - Start( { Data, Port, Host, Caller? } ) returns { App, Address, Url, Settings, Store, Events, Close }.
// Localhost only: any other host is refused. The data folder is ~data beside package.json unless given.
// Caller, for tests only, replaces how the LLM is called (see Llm.Caller).

const PATH = require( 'path' );
const FS = require( 'fs' );
const EXPRESS = require( 'express' );
const STORE = require( './Store.js' );
const PARTICIPANTS = require( './Participants.js' );
const EVENTS = require( './Events.js' );
const API = require( './Api.js' );
const INDEX = require( './Index.js' );
const VECTORS = require( './Vectors.js' );


// A first start over an existing data folder indexes every proposal once; later starts only what is stale.
async function index_missing( store, refresh )
{
	for ( let proposal of await store.ListProposals() )
	{
		let index = await store.ReadIndex( proposal.Id );
		let current = index.length > 0 && index.every( function ( chunk ) { return chunk.Revision === proposal.Revision; } );
		if ( !current )
		{
			await refresh( proposal.Id );
		}
	}
}

const DEFAULT_PORT = 3500;
const DEFAULT_HOST = '127.0.0.1';
const LOCAL_HOSTS = [ '127.0.0.1', 'localhost', '::1' ];
const DEFAULT_DATA = PATH.join( __dirname, '..', '~data' );
const PUBLIC_FOLDER = PATH.join( __dirname, '..', 'public' );


async function Start( Options )
{
	let options = Options || {};
	let host = options.Host || DEFAULT_HOST;
	if ( !LOCAL_HOSTS.includes( host ) )
	{
		throw new Error( 'Consensus binds to localhost only; "' + host + '" is refused' );
	}

	let store = STORE.Open( options.Data || DEFAULT_DATA );
	let settings = await store.ReadSettings();
	let settings_written = false;
	if ( !settings )
	{
		settings = PARTICIPANTS.DefaultSettings( DEFAULT_PORT );
		await store.WriteSettings( settings );
		settings_written = true;
	}
	let problems = PARTICIPANTS.Validate( settings );
	if ( problems.length )
	{
		throw new Error( 'settings ' + store.SettingsPath() + ': ' + problems.join( '; ' ) );
	}
	let port = ( options.Port !== undefined ) ? options.Port : ( settings.Port || DEFAULT_PORT );

	// The search index: ours always; Ollama vectors when the settings name a model.
	let embedder = VECTORS.Embedder( settings );
	function refresh( id )
	{
		return INDEX.Refresh( store, id, embedder );
	}
	function search( query, limit )
	{
		return INDEX.SearchAll( store, query, limit, embedder );
	}
	await index_missing( store, refresh );

	let app = EXPRESS();
	app.disable( 'x-powered-by' );
	let events = EVENTS.Hub();
	events.Attach( app, '/api/events' );
	API.Attach( app, { Store: store, Settings: settings, Events: events, Refresh: refresh, Search: search, Caller: options.Caller } );
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
		Address: { Host: host, Port: address.port },
		Url: 'http://' + host + ':' + address.port,
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
	DEFAULT_PORT: DEFAULT_PORT,
	DEFAULT_DATA: DEFAULT_DATA,
};
