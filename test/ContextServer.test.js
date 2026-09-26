'use strict';

// The context server: which files a corpus lets in (Include, Exclude, nested .gitignore files, links), the token,
// listing, reading and searching a corpus, a change seen by the watcher, and a prompt passed to an LLM.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const FS = require( 'fs' );
const OS = require( 'os' );
const PATH = require( 'path' );
const CONTEXT_SERVER = require( '../src/ContextServer.js' );

const TOKEN = 'test-token-0123456789';

let root = null;
let outside = null;
let running = null;
let prompts = [];


function write( relative, text )
{
	let full = PATH.join( root, relative );
	FS.mkdirSync( PATH.dirname( full ), { recursive: true } );
	FS.writeFileSync( full, text );
}


async function call( method, path, body, token )
{
	let headers = { 'Content-Type': 'application/json' };
	if ( token !== null )
	{
		headers.Authorization = 'Bearer ' + ( token || TOKEN );
	}
	let response = await fetch( running.Url + path, { method: method, headers: headers, body: body ? JSON.stringify( body ) : undefined } );
	return { Status: response.status, Body: await response.json() };
}


// Waits until Check() is true, or fails after a few seconds.
async function eventually( check )
{
	let started = Date.now();
	while ( !( await check() ) )
	{
		if ( Date.now() - started > 8000 )
		{
			throw new Error( 'timed out waiting' );
		}
		await new Promise( function ( resolve ) { setTimeout( resolve, 100 ); } );
	}
}


TEST.before( async function ()
{
	root = FS.mkdtempSync( PATH.join( OS.tmpdir(), 'consensus-context-' ) );
	outside = FS.mkdtempSync( PATH.join( OS.tmpdir(), 'consensus-outside-' ) );
	write( 'readme.md', '# Readme\n\nThe corpus speaks of anchors and threads.\n' );
	write( 'src/app.js', 'function start_the_engine()\n{\n\treturn "vroom";\n}\n' );
	write( 'src/debug.log', 'a log line\n' );
	write( 'src/.gitignore', 'secret.txt\n' );
	write( 'src/secret.txt', 'hidden words\n' );
	write( 'notes/secret.txt', 'seen words\n' );
	write( '.gitignore', '*.log\nbuild/\n' );
	write( 'build/out.js', 'built\n' );
	write( '.git/config', '[core]\n' );
	write( 'node_modules/lib/index.js', 'module.exports = 1;\n' );
	write( 'image.png', 'PNG' );
	write( 'data.txt', 'x\u0000y' );
	FS.writeFileSync( PATH.join( outside, 'far.md' ), 'far away\n' );
	running = await CONTEXT_SERVER.Start( {
		Port: 0,
		Settings: {
			Token: TOKEN,
			Items: [
				{ Kind: 'Corpus', Name: 'Code', Root: root, Exclude: [ '.git/**' ] },
				{ Kind: 'Inference', Name: 'Local', Type: 'ollama', Url: 'http://127.0.0.1:1', Model: 'fake' },
			],
		},
		Caller: function ( Call )
		{
			return async function ( Prompt )
			{
				prompts.push( { Call: Call, Prompt: Prompt } );
				return { Answer: { Actions: [] }, Usage: { Model: Call.Model, Input: 10, Output: 2 } };
			};
		},
	} );
} );


TEST.after( async function ()
{
	await running.Close();
	FS.rmSync( root, { recursive: true, force: true } );
	FS.rmSync( outside, { recursive: true, force: true } );
} );


//---------------------------------------------------------------------

TEST( 'settings: problems are named', function ()
{
	ASSERT.deepEqual( CONTEXT_SERVER.Validate( CONTEXT_SERVER.DefaultSettings() ), [] );
	let problems = CONTEXT_SERVER.Validate( { Token: 'short', Items: [
		{ Kind: 'Corpus', Name: 'A', Root: 'relative/path' },
		{ Kind: 'Corpus', Name: 'A', Root: root },
		{ Kind: 'Inference', Name: 'B', Type: 'gpt' },
		{ Kind: 'Inference', Name: 'C', Type: 'ollama' },
		{ Kind: 'Other', Name: 'D' },
	] } ).join( '; ' );
	ASSERT.match( problems, /Token/ );
	ASSERT.match( problems, /absolute Root/ );
	ASSERT.match( problems, /named twice/ );
	ASSERT.match( problems, /Type must be/ );
	ASSERT.match( problems, /needs a Url/ );
	ASSERT.match( problems, /Kind must be/ );
} );


TEST( 'walk: Exclude, nested .gitignore files and Include decide; nothing else is assumed', function ()
{
	let all = CONTEXT_SERVER.Walk( root, [], [ '.git/**' ] );
	ASSERT.deepEqual( all.sort(), [ '.gitignore', 'data.txt', 'image.png', 'node_modules/lib/index.js', 'notes/secret.txt', 'readme.md', 'src/.gitignore', 'src/app.js' ].sort() );
	let with_git = CONTEXT_SERVER.Walk( root, [], [] );
	ASSERT.ok( with_git.includes( '.git/config' ) );
	let only_source = CONTEXT_SERVER.Walk( root, [ 'src/**' ], [] );
	ASSERT.deepEqual( only_source.sort(), [ 'src/.gitignore', 'src/app.js' ] );
	let no_scripts = CONTEXT_SERVER.Walk( root, [], [ '.git/**', '*.js' ] );
	ASSERT.equal( no_scripts.includes( 'src/app.js' ), false );
} );


TEST( 'walk: a link is followed only when it lands inside Root', function ( context )
{
	try
	{
		FS.symlinkSync( outside, PATH.join( root, 'far' ), 'junction' );
		FS.symlinkSync( PATH.join( root, 'notes' ), PATH.join( root, 'near' ), 'junction' );
	}
	catch ( error )
	{
		context.skip( 'links cannot be made here: ' + error.message );
		return;
	}
	try
	{
		let paths = CONTEXT_SERVER.Walk( root, [], [ '.git/**' ] );
		ASSERT.equal( paths.includes( 'far/far.md' ), false );
		ASSERT.ok( paths.includes( 'near/secret.txt' ) );
	}
	finally
	{
		FS.rmSync( PATH.join( root, 'far' ), { recursive: false, force: true } );
		FS.rmSync( PATH.join( root, 'near' ), { recursive: false, force: true } );
	}
} );


TEST( 'the token is required', async function ()
{
	ASSERT.equal( ( await call( 'GET', '/api/items', null, null ) ).Status, 401 );
	ASSERT.equal( ( await call( 'GET', '/api/items', null, 'wrong-token-0123456789' ) ).Status, 401 );
	ASSERT.equal( ( await call( 'GET', '/api/items' ) ).Status, 200 );
} );


TEST( 'a corpus is listed, read and searched; nothing outside it is read', async function ()
{
	let items = ( await call( 'GET', '/api/items' ) ).Body;
	ASSERT.deepEqual( items.Inference, [ { Name: 'Local', Type: 'ollama', Model: 'fake' } ] );
	ASSERT.equal( items.Corpus[ 0 ].Name, 'Code' );

	let listed = ( await call( 'GET', '/api/corpus/Code' ) ).Body;
	let by_path = {};
	for ( let file of listed.Files )
	{
		by_path[ file.Path ] = file;
	}
	ASSERT.equal( by_path[ 'readme.md' ].Indexed, true );
	ASSERT.match( by_path[ 'image.png' ].Reason, /not a text type/ );
	ASSERT.match( by_path[ 'data.txt' ].Reason, /binary/ );
	ASSERT.equal( by_path[ 'src/secret.txt' ], undefined );
	ASSERT.ok( by_path[ 'readme.md' ].Modified );

	let read = await call( 'GET', '/api/corpus/Code/file?path=' + encodeURIComponent( 'src/app.js' ) );
	ASSERT.match( read.Body.Text, /start_the_engine/ );
	ASSERT.equal( ( await call( 'GET', '/api/corpus/Code/file?path=' + encodeURIComponent( '../' + PATH.basename( outside ) + '/far.md' ) ) ).Status, 404 );
	ASSERT.equal( ( await call( 'GET', '/api/corpus/Code/file?path=' + encodeURIComponent( 'src/secret.txt' ) ) ).Status, 404 );
	ASSERT.equal( ( await call( 'GET', '/api/corpus/None' ) ).Status, 404 );

	let found = ( await call( 'GET', '/api/corpus/Code/search?q=anchors' ) ).Body.Hits;
	ASSERT.equal( found[ 0 ].Path, 'readme.md' );
	ASSERT.equal( ( await call( 'GET', '/api/corpus/Code/search?q=hidden' ) ).Body.Hits.length, 0 );
} );


TEST( 'a change on disk is seen: the watcher indexes a new file', async function ()
{
	write( 'docs/new.md', '# New\n\nA pelican arrived.\n' );
	await eventually( async function ()
	{
		let hits = ( await call( 'GET', '/api/corpus/Code/search?q=pelican' ) ).Body.Hits;
		return hits.length > 0 && hits[ 0 ].Path === 'docs/new.md';
	} );
} );


TEST( 'inference passes a prompt to the LLM and returns its answer', async function ()
{
	let answered = await call( 'POST', '/api/inference/Local', { Prompt: 'hello', Model: 'other' } );
	ASSERT.equal( answered.Status, 200 );
	ASSERT.deepEqual( answered.Body.Answer, { Actions: [] } );
	ASSERT.equal( prompts[ 0 ].Prompt, 'hello' );
	ASSERT.equal( prompts[ 0 ].Call.Model, 'other' );
	ASSERT.equal( ( await call( 'POST', '/api/inference/Local', {} ) ).Status, 400 );
	ASSERT.equal( ( await call( 'POST', '/api/inference/None', { Prompt: 'x' } ) ).Status, 404 );
	ASSERT.equal( ( await call( 'GET', '/api/inference/Local/models' ) ).Status, 502 );
} );
