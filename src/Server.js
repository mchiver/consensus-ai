'use strict';

// Server - Start( { Data, Port, Host, Caller? } ) returns { App, Address, Url, Settings, Store, Events, Close }.
// It listens on Host (the option, else the settings' Host, else 127.0.0.1); any address is accepted, and Address.Local
// says whether it stays on this machine. The data folder is ~data beside package.json unless given.
// Caller, for tests only, replaces how the LLM is called (see Llm.Caller).

const PATH = require( 'path' );
const FS = require( 'fs' );
const EXPRESS = require( 'express' );
const STORE = require( './Store.js' );
const PARTICIPANTS = require( './Participants.js' );
const EVENTS = require( './Events.js' );
const API = require( './Api.js' );
const INDEX = require( './Index.js' );
const INSTRUCTIONS = require( './Instructions.js' );
const CORPUS = require( './Corpus.js' );
const VECTORS = require( './Vectors.js' );
const LLM = require( './Llm.js' );
const CONTEXT_SERVERS = require( './ContextServers.js' );
const FILTER = require( './Filter.js' );


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

// The same for the uploaded corpora: one whose index is missing or older than its zip is indexed again.
async function index_missing_corpora( store, refresh_corpus )
{
	for ( let corpus of await store.ListCorpora() )
	{
		let index = await store.ReadCorpusIndex( corpus.Id );
		let current = index.length > 0 && index.every( function ( chunk ) { return chunk.Revision === corpus.Version; } );
		if ( !current )
		{
			try
			{
				await refresh_corpus( corpus.Id );
			}
			catch ( error )
			{
				console.error( 'index: corpus ' + corpus.Id + ': ' + error.message );
			}
		}
	}
}

// The hits of each linked corpus (among Ids, when given), one list per corpus, as our own hits are shaped.
async function linked_hits( store, context_servers, query, limit, ids )
{
	let lists = [];
	for ( let corpus of await store.ListCorpora() )
	{
		if ( !corpus.Link || ( ids && !ids.includes( corpus.Id ) ) )
		{
			continue;
		}
		try
		{
			// More hits are asked for than wanted, so a page is still full once the entry's rules have filtered them.
			let why = FILTER.Make( { Include: corpus.Include, Exclude: corpus.Exclude } );
			let hits = ( await context_servers.Search( corpus.Link.Server, corpus.Link.Corpus, query, ( limit || 10 ) * 3 ) ).filter( function ( hit ) { return !why( hit.Path ); } ).slice( 0, limit || 10 );
			lists.push( hits.map( function ( hit )
			{
				return { Proposal: null, Corpus: corpus.Id, Path: hit.Path, Revision: null, Chunk: null, Thread: null, Text: hit.Text, Score: hit.Score };
			} ) );
		}
		catch ( error )
		{
			console.error( 'search: ' + error.message );
		}
	}
	return lists;
}


// The lists' hits taken rank by rank: every list's first, then every list's second, up to Limit.
function interleave( lists, limit )
{
	let hits = [];
	for ( let rank = 0; hits.length < limit; rank++ )
	{
		let any = false;
		for ( let list of lists )
		{
			if ( rank < list.length && hits.length < limit )
			{
				hits.push( list[ rank ] );
				any = true;
			}
		}
		if ( !any )
		{
			break;
		}
	}
	return hits;
}

const DEFAULT_PORT = 3500;
const DEFAULT_HOST = '127.0.0.1';
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
		settings = PARTICIPANTS.DefaultSettings( DEFAULT_PORT );
		settings.Host = DEFAULT_HOST;
		settings.Corpus = CORPUS.Limits( {} );
		settings.Context = LLM.ContextSettings( {} );
		await store.WriteSettings( settings );
		settings_written = true;
	}
	let problems = PARTICIPANTS.Validate( settings ).concat( CONTEXT_SERVERS.Validate( settings ) );
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

	// The search index: ours always; Ollama vectors when the settings name a model.
	let embedder = VECTORS.Embedder( settings );
	function refresh( id )
	{
		return INDEX.Refresh( store, id, embedder );
	}
	// The context servers in the settings, asked what they offer before the page is served.
	let context_servers = CONTEXT_SERVERS.Open( settings );
	for ( let server of await context_servers.Refresh() )
	{
		console.log( 'context server ' + server.Name + ': ' + ( server.Online ? server.Corpus.length + ' corpora, ' + server.Inference.length + ' inference' : 'offline, ' + server.Error ) );
	}
	// Ids, when given, limits the search to those items (a project's). A corpus linked from a context server is
	// searched there, and its hits are interleaved with ours by rank, since the two indexes' scores do not compare.
	async function search( query, limit, ids )
	{
		let local = await INDEX.SearchAll( store, query, limit, embedder, ids );
		let lists = await linked_hits( store, context_servers, query, limit, ids );
		return lists.length ? interleave( [ local ].concat( lists ), limit || 10 ) : local;
	}
	// A corpus is indexed from its zip, within the settings' limits.
	async function refresh_corpus( id )
	{
		let corpus = await store.ReadCorpus( id );
		let zip = corpus ? await store.ReadCorpusZip( id ) : null;
		if ( !zip )
		{
			return null;
		}
		let extracted = await CORPUS.Extract( zip, CORPUS.Limits( settings ), corpus );
		return INDEX.RefreshCorpus( store, corpus, extracted.Texts, embedder );
	}
	await index_missing( store, refresh );
	await index_missing_corpora( store, refresh_corpus );

	let app = EXPRESS();
	app.disable( 'x-powered-by' );
	let events = EVENTS.Hub();
	events.Attach( app, '/api/events' );
	API.Attach( app, { Store: store, Settings: settings, Events: events, Refresh: refresh, RefreshCorpus: refresh_corpus, Search: search, Caller: options.Caller, ContextServers: context_servers } );
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
	DEFAULT_PORT: DEFAULT_PORT,
	DEFAULT_DATA: DEFAULT_DATA,
};
