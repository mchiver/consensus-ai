'use strict';

// Consensus with a context server: the server listed in the settings is asked what it offers; a corpus of it is
// linked into a project, listed, read and searched through it; its Inference item is a destination, and a session
// through it reads a linked file on the LLM's request; a server that stops answering shows as offline.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const FS = require( 'fs' );
const OS = require( 'os' );
const PATH = require( 'path' );
const SERVER = require( '../src/Server.js' );
const PARTICIPANTS = require( '../src/Participants.js' );
const CONTEXT_SERVER = require( '../src/ContextServer.js' );

const TOKEN = 'link-test-token-0123456789';

let root = null;
let data = null;
let context = null;
let running = null;
let prompts = [];


// The LLM behind the context server's Inference item: it asks for a file, then replies with what it read.
function remote_caller( Call )
{
	return async function ( Prompt )
	{
		prompts.push( Prompt );
		let thread = /## Thread (t[0-9a-f]{8})/.exec( Prompt )[ 1 ];
		if ( prompts.length === 1 )
		{
			return { Answer: { Actions: [], Requests: [ { Tool: 'read_file', Zip: 'Docs', Path: 'guide.md' } ] }, Usage: { Model: Call.Model || 'remote', Input: 5, Output: 1 } };
		}
		return { Answer: { Actions: [ { Thread: thread, Kind: 'reply', Reply: 'The guide speaks of a pelican.' } ] }, Usage: { Model: Call.Model || 'remote', Input: 9, Output: 3 } };
	};
}


async function call( method, path, body )
{
	let headers = body === undefined ? {} : { 'Content-Type': 'application/json' };
	let response = await fetch( running.Url + path, { method: method, headers: headers, body: ( body === undefined ) ? undefined : JSON.stringify( body ) } );
	return { Status: response.status, Body: await response.json() };
}


TEST.before( async function ()
{
	root = FS.mkdtempSync( PATH.join( OS.tmpdir(), 'consensus-link-corpus-' ) );
	FS.writeFileSync( PATH.join( root, 'guide.md' ), '# Guide\n\nA pelican stands on the pier.\n' );
	FS.writeFileSync( PATH.join( root, 'tool.js' ), 'function paddle() { return 1; }\n' );
	context = await CONTEXT_SERVER.Start( {
		Port: 0,
		Settings: {
			Token: TOKEN,
			Items: [
				{ Kind: 'Corpus', Name: 'Docs', Root: root },
				{ Kind: 'Inference', Name: 'Model', Type: 'claude-cli' },
			],
		},
		Caller: remote_caller,
	} );
	data = FS.mkdtempSync( PATH.join( OS.tmpdir(), 'consensus-link-data-' ) );
	let settings = PARTICIPANTS.DefaultSettings( 0 );
	settings.ContextServers = [ { Name: 'Box', Url: context.Url, Token: TOKEN } ];
	FS.writeFileSync( PATH.join( data, 'consensus.json' ), JSON.stringify( settings, null, '\t' ) );
	running = await SERVER.Start( { Data: data, Port: 0 } );
} );


TEST.after( async function ()
{
	await running.Close();
	await context.Close();
	FS.rmSync( root, { recursive: true, force: true } );
	FS.rmSync( data, { recursive: true, force: true } );
} );


//---------------------------------------------------------------------

TEST( 'settings: a context server needs a Name, a Url and its Token', async function ()
{
	let settings = PARTICIPANTS.DefaultSettings( 0 );
	settings.ContextServers = [ { Name: 'A', Url: 'ftp://x', Token: '' }, { Name: 'A', Url: 'http://x', Token: 't' } ];
	let folder = FS.mkdtempSync( PATH.join( OS.tmpdir(), 'consensus-link-bad-' ) );
	FS.writeFileSync( PATH.join( folder, 'consensus.json' ), JSON.stringify( settings ) );
	await ASSERT.rejects( SERVER.Start( { Data: folder, Port: 0 } ), /needs a Url.*needs its Token.*named twice/ );
	FS.rmSync( folder, { recursive: true, force: true } );
} );


TEST( 'a linked corpus is listed, read and searched through its context server', async function ()
{
	let servers = ( await call( 'GET', '/api/context-servers' ) ).Body.Servers;
	ASSERT.equal( servers[ 0 ].Online, true );
	ASSERT.deepEqual( servers[ 0 ].Corpus.map( function ( item ) { return item.Name; } ), [ 'Docs' ] );
	ASSERT.equal( JSON.stringify( servers ).includes( TOKEN ), false );

	ASSERT.equal( ( await call( 'POST', '/api/projects/default/corpus-link', { Server: 'Box', Corpus: 'Nothing' } ) ).Status, 400 );
	let linked = await call( 'POST', '/api/projects/default/corpus-link', { Server: 'Box', Corpus: 'Docs' } );
	ASSERT.equal( linked.Status, 201 );
	let id = linked.Body.Corpus.Id;

	let project = ( await call( 'GET', '/api/projects' ) ).Body.Projects[ 0 ];
	let node = project.Items.find( function ( item ) { return item.Id === id; } );
	ASSERT.equal( node.Linked, 'Box / Docs' );
	ASSERT.equal( node.Files, 2 );
	ASSERT.equal( node.Offline, false );

	let corpus = ( await call( 'GET', '/api/corpus/' + id ) ).Body.Corpus;
	ASSERT.deepEqual( corpus.Files.map( function ( file ) { return file.Path; } ), [ 'guide.md', 'tool.js' ] );
	ASSERT.match( ( await call( 'GET', '/api/corpus/' + id + '/file?path=guide.md' ) ).Body.Text, /pelican/ );
	ASSERT.equal( ( await call( 'PUT', '/api/corpus/' + id ) ).Status, 409 );

	let hits = ( await call( 'GET', '/api/search?q=pelican&project=default' ) ).Body.Hits;
	ASSERT.equal( hits[ 0 ].Corpus, id );
	ASSERT.equal( hits[ 0 ].Path, 'guide.md' );
} );


TEST( 'a context server\'s Inference item is a destination; its session reads a linked file on request', async function ()
{
	let destinations = ( await call( 'GET', '/api/llm/destinations' ) ).Body.Destinations;
	ASSERT.ok( destinations.some( function ( destination ) { return destination.Name === 'Box / Model'; } ) );

	let proposal = ( await call( 'POST', '/api/proposals', { Title: 'Ask the box', Text: '# Ask the box\n\nWhat does the guide say?\n' } ) ).Body.Proposal;
	let thread = ( await call( 'POST', '/api/proposals/' + proposal.Id + '/threads', { Text: 'What does the guide say?' } ) ).Body.Thread;
	let started = await call( 'POST', '/api/proposals/' + proposal.Id + '/session', { Destination: 'Box / Model', Options: { Search: false } } );
	ASSERT.equal( started.Status, 202 );
	for ( let attempt = 0; attempt < 200; attempt++ )
	{
		let read = await call( 'GET', '/api/proposals/' + proposal.Id );
		if ( !read.Body.Llm.Running )
		{
			break;
		}
		await new Promise( function ( resolve ) { setTimeout( resolve, 25 ); } );
	}
	let read = ( await call( 'GET', '/api/proposals/' + proposal.Id ) ).Body;
	let answered = read.Threads.find( function ( candidate ) { return candidate.Id === thread.Id; } );
	ASSERT.equal( answered.Replies[ answered.Replies.length - 1 ].Text, 'The guide speaks of a pelican.' );
	ASSERT.equal( prompts.length, 2 );
	ASSERT.equal( prompts[ 0 ].includes( 'A pelican stands on the pier' ), false );
	ASSERT.match( prompts[ 1 ], /A pelican stands on the pier/ );
} );


TEST( 'a linked corpus\'s Include and Exclude narrow what its server gives: the list, a file, and search', async function ()
{
	let project = ( await call( 'GET', '/api/projects' ) ).Body.Projects[ 0 ];
	let id = project.Items.find( function ( item ) { return item.Linked; } ).Id;
	ASSERT.equal( ( await call( 'GET', '/api/corpus/' + id ) ).Body.Corpus.Source, 'linked' );
	ASSERT.equal( ( await call( 'GET', '/api/search?q=paddle&project=default' ) ).Body.Hits[ 0 ].Path, 'tool.js' );
	let narrowed = await call( 'PUT', '/api/corpus/' + id + '/filter', { Exclude: '*.js' } );
	ASSERT.deepEqual( narrowed.Body.Corpus.Exclude, [ '*.js' ] );
	let files = ( await call( 'GET', '/api/corpus/' + id ) ).Body.Corpus.Files;
	ASSERT.equal( files.find( function ( file ) { return file.Path === 'tool.js'; } ).Reason, 'left out by Exclude' );
	ASSERT.equal( files.find( function ( file ) { return file.Path === 'guide.md'; } ).Indexed, true );
	ASSERT.equal( ( await call( 'GET', '/api/corpus/' + id + '/file?path=tool.js' ) ).Status, 404 );
	let hits = ( await call( 'GET', '/api/search?q=paddle&project=default' ) ).Body.Hits;
	ASSERT.equal( hits.some( function ( hit ) { return hit.Path === 'tool.js'; } ), false );
} );


TEST( 'a context server that stops answering shows as offline, and nothing else breaks', async function ()
{
	await context.Close();
	let servers = ( await call( 'POST', '/api/context-servers/refresh' ) ).Body.Servers;
	ASSERT.equal( servers[ 0 ].Online, false );
	let project = ( await call( 'GET', '/api/projects' ) ).Body.Projects[ 0 ];
	let node = project.Items.find( function ( item ) { return item.Linked; } );
	ASSERT.equal( node.Offline, true );
	let corpus = ( await call( 'GET', '/api/corpus/' + node.Id ) ).Body.Corpus;
	ASSERT.deepEqual( corpus.Files, [] );
	ASSERT.match( corpus.Offline, /did not answer/ );
	ASSERT.equal( ( await call( 'GET', '/api/search?q=pelican' ) ).Status, 200 );
	let destinations = ( await call( 'GET', '/api/llm/destinations' ) ).Body.Destinations;
	ASSERT.equal( destinations.some( function ( destination ) { return destination.Name === 'Box / Model'; } ), false );
	context = { Close: async function () {} };
} );
