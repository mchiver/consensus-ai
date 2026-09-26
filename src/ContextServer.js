'use strict';

// ContextServer - a small server beside Consensus that gives it a live corpus (a folder read as it is now) and
// passes prompts to local LLMs. Read-only: it has no write routes, and a path outside a corpus's Root is refused,
// links included. Every request carries the settings' Token.
//
//   context-server.json:
//   {
//     "Host": "127.0.0.1", "Port": 3600, "Token": "<a long random string>",
//     "Corpus": { "MaxFileKilobytes": 512 },     a file larger than this, or binary, is listed but not read
//     "Embedding": { "Url": "http://127.0.0.1:11434", "Model": "nomic-embed-text" },    optional, as Consensus's
//     "Items": [
//       { "Kind": "Corpus", "Name": "Consensus", "Root": "W:\\code", "Include": [], "Exclude": [ ".git/**" ] },
//       { "Kind": "Inference", "Name": "Ollama", "Type": "ollama", "Url": "http://127.0.0.1:11434" },
//       { "Kind": "Inference", "Name": "Claude CLI", "Type": "claude-cli" }
//     ]
//   }
//
// A corpus is indexed at start with Consensus's own index (Index.js: BM25, and Ollama vectors when Embedding names a
// model), and again when a file watcher sees a change. Every .gitignore under Root applies to its folder and below,
// in addition to Exclude; an empty Include means every file. Every file let in is read unless it is larger than
// MaxFileKilobytes or binary (it holds a NUL byte); there is no list of types.
//
//   GET  /api/items                           { Corpus: [ { Name, Files, Indexed } ], Inference: [ { Name, Type, Model } ] }
//   GET  /api/corpus/:name                    { Name, Files: [ { Path, Size, Modified, Indexed, Reason? } ] }
//   GET  /api/corpus/:name/file?path=         { Path, Text }
//   GET  /api/corpus/:name/search?q=&limit=   { Hits: [ { Path, Text, Score } ] }
//   GET  /api/inference/:name/models          { Models: [ name ] }
//   POST /api/inference/:name                 { Prompt, Model? } -> { Answer, Usage }

const FS = require( 'fs' );
const PATH = require( 'path' );
const CRYPTO = require( 'crypto' );
const EXPRESS = require( 'express' );
const IGNORE = require( 'ignore' );
const INDEX = require( './Index.js' );
const VECTORS = require( './Vectors.js' );
const CORPUS = require( './Corpus.js' );
const LLM = require( './Llm.js' );

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3600;
const INFERENCE_TYPES = [ 'claude-cli', 'ollama' ];
const WATCH_DELAY = 500;
const SEARCH_LIMIT = 10;


//---------------------------------------------------------------------
// DefaultSettings: a settings file to start from, with a new token and no items.

function DefaultSettings()
{
	return {
		Host: DEFAULT_HOST,
		Port: DEFAULT_PORT,
		Token: CRYPTO.randomBytes( 24 ).toString( 'hex' ),
		Corpus: { MaxFileKilobytes: CORPUS.DEFAULT_LIMITS.MaxFileKilobytes },
		Items: [],
	};
}


//---------------------------------------------------------------------
// Validate: the problems with the settings, as sentences; none when they are usable.

function Validate( Settings )
{
	let problems = [];
	if ( !Settings || typeof Settings !== 'object' )
	{
		return [ 'the settings are not an object' ];
	}
	if ( typeof Settings.Token !== 'string' || Settings.Token.length < 16 )
	{
		problems.push( 'Token must be a string of 16 characters or more' );
	}
	if ( Settings.Items !== undefined && !Array.isArray( Settings.Items ) )
	{
		problems.push( 'Items must be a list' );
		return problems;
	}
	let names = { Corpus: new Set(), Inference: new Set() };
	for ( let item of Settings.Items || [] )
	{
		if ( !item || ( item.Kind !== 'Corpus' && item.Kind !== 'Inference' ) )
		{
			problems.push( 'an item\'s Kind must be Corpus or Inference' );
			continue;
		}
		if ( typeof item.Name !== 'string' || !item.Name.trim() )
		{
			problems.push( 'a ' + item.Kind + ' item has no Name' );
			continue;
		}
		if ( names[ item.Kind ].has( item.Name ) )
		{
			problems.push( item.Kind + ' "' + item.Name + '" is named twice' );
		}
		names[ item.Kind ].add( item.Name );
		if ( item.Kind === 'Corpus' )
		{
			if ( typeof item.Root !== 'string' || !PATH.isAbsolute( item.Root ) )
			{
				problems.push( 'Corpus "' + item.Name + '" needs an absolute Root' );
			}
			else if ( !FS.existsSync( item.Root ) || !FS.statSync( item.Root ).isDirectory() )
			{
				problems.push( 'Corpus "' + item.Name + '": Root ' + item.Root + ' is not a folder' );
			}
			for ( let field of [ 'Include', 'Exclude' ] )
			{
				if ( item[ field ] !== undefined && !Array.isArray( item[ field ] ) )
				{
					problems.push( 'Corpus "' + item.Name + '": ' + field + ' must be a list of patterns' );
				}
			}
		}
		else
		{
			if ( !INFERENCE_TYPES.includes( item.Type ) )
			{
				problems.push( 'Inference "' + item.Name + '": Type must be one of ' + INFERENCE_TYPES.join( ', ' ) );
			}
			if ( item.Type === 'ollama' && !item.Url )
			{
				problems.push( 'Inference "' + item.Name + '" of type ollama needs a Url' );
			}
		}
	}
	return problems;
}


//---------------------------------------------------------------------
// Walk: the files of a corpus that its settings and .gitignore files let in, as posix paths relative to Root.
// A folder left out is not walked. A link is followed only when it lands inside Root.

function Walk( Root, Include, Exclude )
{
	let root = FS.realpathSync( Root );
	let exclude = IGNORE().add( Exclude || [] );
	let include = ( Include && Include.length ) ? IGNORE().add( Include ) : null;
	let paths = [];

	function ignored_by( rules, relative, is_folder )
	{
		let target = is_folder ? relative + '/' : relative;
		if ( exclude.ignores( target ) )
		{
			return true;
		}
		for ( let rule of rules )
		{
			let below = rule.Base ? PATH.posix.relative( rule.Base, relative ) : relative;
			if ( below && !below.startsWith( '..' ) && rule.Matcher.ignores( is_folder ? below + '/' : below ) )
			{
				return true;
			}
		}
		return false;
	}

	function visit( folder, base, rules )
	{
		let here = rules;
		let gitignore = PATH.join( folder, '.gitignore' );
		if ( FS.existsSync( gitignore ) )
		{
			here = rules.concat( [ { Base: base, Matcher: IGNORE().add( FS.readFileSync( gitignore, 'utf8' ) ) } ] );
		}
		let entries = FS.readdirSync( folder, { withFileTypes: true } );
		entries.sort( function ( a, b ) { return a.name.localeCompare( b.name ); } );
		for ( let entry of entries )
		{
			let full = PATH.join( folder, entry.name );
			let relative = base ? base + '/' + entry.name : entry.name;
			let is_folder = entry.isDirectory();
			let is_file = entry.isFile();
			if ( entry.isSymbolicLink() )
			{
				let real = null;
				try
				{
					real = FS.realpathSync( full );
				}
				catch ( error )
				{
					continue;
				}
				if ( !inside( root, real ) )
				{
					continue;
				}
				let stat = FS.statSync( real );
				is_folder = stat.isDirectory();
				is_file = stat.isFile();
			}
			if ( ignored_by( here, relative, is_folder ) )
			{
				continue;
			}
			if ( is_folder )
			{
				visit( full, relative, here );
			}
			else if ( is_file && ( !include || include.ignores( relative ) ) )
			{
				paths.push( relative );
			}
		}
	}

	visit( root, '', [] );
	return paths;
}


// Whether the real path Path is Root itself or under it.
function inside( Root, Path )
{
	let relative = PATH.relative( Root, Path );
	return relative === '' || ( !relative.startsWith( '..' ) && !PATH.isAbsolute( relative ) );
}


//---------------------------------------------------------------------
// OpenCorpus: one corpus, indexed; Refresh() reads what changed since the last time.

function OpenCorpus( Item, Limits, Embedder )
{
	let root = FS.realpathSync( Item.Root );
	let max_bytes = Limits.MaxFileKilobytes * 1024;
	let files = [];
	let known = {};
	let chunks = [];
	let weighed = [];
	let version = 0;


	// The file at a corpus path, as a real path inside Root, or null.
	function resolve( path )
	{
		let full = PATH.resolve( root, String( path ).split( '/' ).join( PATH.sep ) );
		let real = null;
		try
		{
			real = FS.realpathSync( full );
		}
		catch ( error )
		{
			return null;
		}
		return inside( root, real ) ? real : null;
	}


	// One file's entry and text, read only when its size or time changed.
	function examine( path )
	{
		let real = resolve( path );
		if ( !real )
		{
			return null;
		}
		let stat = FS.statSync( real );
		let file = { Path: path, Size: stat.size, Modified: stat.mtime.toISOString(), Indexed: false };
		let previous = known[ path ];
		if ( previous && previous.File.Size === file.Size && previous.File.Modified === file.Modified )
		{
			return previous;
		}
		if ( stat.size > max_bytes )
		{
			file.Reason = 'larger than ' + Limits.MaxFileKilobytes + ' KB';
			return { File: file, Text: null };
		}
		let data = FS.readFileSync( real );
		if ( data.includes( 0 ) )
		{
			file.Reason = 'binary (holds a NUL byte)';
			return { File: file, Text: null };
		}
		file.Indexed = true;
		return { File: file, Text: data.toString( 'utf8' ) };
	}


	async function Refresh()
	{
		let now = {};
		for ( let path of Walk( Item.Root, Item.Include, Item.Exclude ) )
		{
			let entry = null;
			try
			{
				entry = examine( path );
			}
			catch ( error )
			{
				entry = null;
			}
			if ( entry )
			{
				now[ path ] = entry;
			}
		}
		known = now;
		files = Object.keys( now ).map( function ( path ) { return now[ path ].File; } );
		let texts = {};
		for ( let path of Object.keys( now ) )
		{
			if ( now[ path ].Text !== null )
			{
				texts[ path ] = now[ path ].Text;
			}
		}
		version++;
		let fresh = INDEX.ChunkCorpus( { Id: Item.Name, Version: version }, texts );
		await INDEX.Embed( fresh, chunks, Embedder, Item.Name );
		chunks = fresh;
		weighed = INDEX.Weigh( chunks.map( function ( chunk ) { return Object.assign( {}, chunk ); } ) );
		return files;
	}


	function Files()
	{
		return files;
	}


	// A listed, indexed file's text, read now; null when it is not one.
	function ReadFile( Path )
	{
		let entry = known[ Path ];
		if ( !entry || !entry.File.Indexed )
		{
			return null;
		}
		let real = resolve( Path );
		return real ? FS.readFileSync( real, 'utf8' ) : null;
	}


	async function Search( Query, Limit )
	{
		let hits = await INDEX.SearchChunks( Query, weighed, Limit || SEARCH_LIMIT, Embedder );
		return hits.map( function ( hit ) { return { Path: hit.Path, Text: hit.Text, Score: hit.Score }; } );
	}


	return { Name: Item.Name, Root: root, Refresh: Refresh, Files: Files, ReadFile: ReadFile, Search: Search };
}


//---------------------------------------------------------------------
// Start( { Settings, Caller? } ) -> { Url, Address, Corpora, Close }. Caller, for tests only, replaces Llm.Caller.

async function Start( Options )
{
	let settings = Options.Settings;
	let problems = Validate( settings );
	if ( problems.length )
	{
		throw new Error( 'context server settings: ' + problems.join( '; ' ) );
	}
	let host = settings.Host || DEFAULT_HOST;
	let port = ( Options.Port !== undefined ) ? Options.Port : ( settings.Port || DEFAULT_PORT );
	let limits = CORPUS.Limits( settings );
	let embedder = VECTORS.Embedder( settings );
	let make_caller = Options.Caller || LLM.Caller;

	// The corpora, indexed before the server answers.
	let corpora = {};
	let watchers = [];
	for ( let item of settings.Items || [] )
	{
		if ( item.Kind !== 'Corpus' )
		{
			continue;
		}
		let corpus = OpenCorpus( item, limits, embedder );
		await corpus.Refresh();
		corpora[ item.Name ] = corpus;
		watchers.push( watch( corpus ) );
		console.log( 'corpus ' + item.Name + ': ' + corpus.Files().length + ' files from ' + corpus.Root );
	}
	let inference = {};
	for ( let item of settings.Items || [] )
	{
		if ( item.Kind === 'Inference' )
		{
			inference[ item.Name ] = item;
		}
	}

	let app = EXPRESS();
	app.disable( 'x-powered-by' );
	app.use( EXPRESS.json( { limit: '20mb' } ) );
	app.use( '/api', function ( request, response, next )
	{
		let given = String( request.get( 'Authorization' ) || '' ).replace( /^Bearer\s+/i, '' );
		if ( !same( given, settings.Token ) )
		{
			return response.status( 401 ).json( { Error: 'a token is required' } );
		}
		next();
	} );

	app.get( '/api/items', function ( request, response )
	{
		response.json( {
			Corpus: Object.keys( corpora ).map( function ( name )
			{
				let files = corpora[ name ].Files();
				return { Name: name, Files: files.length, Indexed: files.filter( function ( file ) { return file.Indexed; } ).length };
			} ),
			Inference: Object.keys( inference ).map( function ( name )
			{
				return { Name: name, Type: inference[ name ].Type, Model: inference[ name ].Model || null };
			} ),
		} );
	} );

	function corpus_of( request, response )
	{
		let corpus = corpora[ request.params.name ];
		if ( !corpus )
		{
			response.status( 404 ).json( { Error: 'no corpus is named "' + request.params.name + '"' } );
		}
		return corpus;
	}

	app.get( '/api/corpus/:name', function ( request, response )
	{
		let corpus = corpus_of( request, response );
		if ( corpus )
		{
			response.json( { Name: corpus.Name, Files: corpus.Files() } );
		}
	} );

	app.get( '/api/corpus/:name/file', function ( request, response )
	{
		let corpus = corpus_of( request, response );
		if ( !corpus )
		{
			return;
		}
		let path = String( request.query.path || '' );
		let text = corpus.ReadFile( path );
		if ( text === null )
		{
			return response.status( 404 ).json( { Error: 'no indexed file ' + path + ' in the corpus' } );
		}
		response.json( { Path: path, Text: text } );
	} );

	app.get( '/api/corpus/:name/search', async function ( request, response )
	{
		let corpus = corpus_of( request, response );
		if ( !corpus )
		{
			return;
		}
		let limit = parseInt( request.query.limit, 10 ) || SEARCH_LIMIT;
		response.json( { Hits: await corpus.Search( String( request.query.q || '' ), limit ) } );
	} );

	function inference_of( request, response )
	{
		let item = inference[ request.params.name ];
		if ( !item )
		{
			response.status( 404 ).json( { Error: 'no inference is named "' + request.params.name + '"' } );
		}
		return item;
	}

	app.get( '/api/inference/:name/models', async function ( request, response )
	{
		let item = inference_of( request, response );
		if ( !item )
		{
			return;
		}
		if ( item.Type !== 'ollama' )
		{
			return response.json( { Models: item.Model ? [ item.Model ] : [] } );
		}
		try
		{
			let answer = await fetch( String( item.Url ).replace( /\/+$/, '' ) + '/api/tags', { signal: AbortSignal.timeout( 5000 ) } );
			let json = await answer.json();
			response.json( { Models: ( json.models || [] ).map( function ( model ) { return model.name; } ).sort() } );
		}
		catch ( error )
		{
			response.status( 502 ).json( { Error: 'Ollama at ' + item.Url + ' did not answer: ' + error.message } );
		}
	} );

	// A prompt passed to the LLM and its answer returned; nothing else is done with it here.
	app.post( '/api/inference/:name', async function ( request, response )
	{
		let item = inference_of( request, response );
		if ( !item )
		{
			return;
		}
		let body = request.body || {};
		if ( typeof body.Prompt !== 'string' || !body.Prompt )
		{
			return response.status( 400 ).json( { Error: 'Prompt is required' } );
		}
		let call = LLM.CallSettings( { Call: { Kind: item.Type, Url: item.Url, Model: item.Model, Command: item.Command, TimeoutSeconds: item.TimeoutSeconds } } );
		if ( typeof body.Model === 'string' && body.Model.trim() )
		{
			call.Model = body.Model.trim();
		}
		if ( call.Kind === 'ollama' && !call.Model )
		{
			return response.status( 400 ).json( { Error: 'pick an Ollama model' } );
		}
		try
		{
			response.json( await make_caller( call )( body.Prompt ) );
		}
		catch ( error )
		{
			response.status( 502 ).json( { Error: error.message } );
		}
	} );

	let server = await new Promise( function ( resolve, reject )
	{
		let listening = app.listen( port, host, function () { resolve( listening ); } );
		listening.on( 'error', reject );
	} );
	let address = server.address();

	async function Close()
	{
		for ( let watcher of watchers )
		{
			watcher.Close();
		}
		server.closeAllConnections();
		await new Promise( function ( resolve ) { server.close( resolve ); } );
	}

	return {
		Url: 'http://' + host + ':' + address.port,
		Address: { Host: host, Port: address.port },
		Corpora: corpora,
		Close: Close,
	};
}


// A token compared in constant time.
function same( given, expected )
{
	let a = Buffer.from( String( given ) );
	let b = Buffer.from( String( expected ) );
	return a.length === b.length && CRYPTO.timingSafeEqual( a, b );
}


// A watcher on a corpus's Root: a change re-reads the corpus once the changes have settled for WATCH_DELAY.
function watch( corpus )
{
	let timer = null;
	let running = Promise.resolve();
	let watcher = null;
	try
	{
		watcher = FS.watch( corpus.Root, { recursive: true }, function ()
		{
			clearTimeout( timer );
			timer = setTimeout( function ()
			{
				running = running.then( function () { return corpus.Refresh(); } ).catch( function ( error )
				{
					console.error( 'corpus ' + corpus.Name + ': ' + error.message );
				} );
			}, WATCH_DELAY );
		} );
		watcher.on( 'error', function ( error )
		{
			console.error( 'corpus ' + corpus.Name + ': the watcher stopped: ' + error.message );
		} );
	}
	catch ( error )
	{
		console.error( 'corpus ' + corpus.Name + ': no watcher: ' + error.message );
	}
	return {
		Close: function ()
		{
			clearTimeout( timer );
			if ( watcher )
			{
				watcher.close();
			}
		},
	};
}


module.exports = {
	DEFAULT_PORT: DEFAULT_PORT,
	DefaultSettings: DefaultSettings,
	Validate: Validate,
	Walk: Walk,
	OpenCorpus: OpenCorpus,
	Start: Start,
};
