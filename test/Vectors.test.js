'use strict';

// The optional vectors: the cosine merge over a fake embedder (no Ollama in a test), and that nothing is
// called and the search still answers when no model is set.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const FS = require( 'fs' );
const OS = require( 'os' );
const PATH = require( 'path' );
const VECTORS = require( '../src/Vectors.js' );
const INDEX = require( '../src/Index.js' );
const STORE = require( '../src/Store.js' );


// A fake embedder: a vector of letter counts, so texts sharing letters score alike. Counts its calls.
function fake_embedder()
{
	let calls = [];
	function vector_of( text )
	{
		let counts = new Array( 26 ).fill( 0 );
		for ( let character of text.toLowerCase() )
		{
			let code = character.charCodeAt( 0 ) - 97;
			if ( code >= 0 && code < 26 )
			{
				counts[ code ]++;
			}
		}
		return counts;
	}
	return {
		Calls: calls,
		Embed: async function ( Texts )
		{
			calls.push( Texts.slice() );
			return Texts.map( vector_of );
		},
	};
}


async function corpus_store()
{
	let store = STORE.Open( FS.mkdtempSync( PATH.join( OS.tmpdir(), 'consensus-vectors-' ) ) );
	let a = await store.CreateProposal( { Title: 'A', Text: 'Only the owner resolves a thread.\n\nAny reply to a resolved thread reopens it.', By: 'user' } );
	let b = await store.CreateProposal( { Title: 'B', Text: 'Port 3500 on the loopback address.', By: 'user' } );
	await store.WriteThreads( a.Id, [ { Id: 't1', Anchor: { Text: 'reopens it' }, Replies: [ { Text: 'Reopening never reverts an applied change.' } ] } ] );
	return { Store: store, A: a, B: b };
}


TEST( 'no Embedding in the settings means no embedder', function ()
{
	ASSERT.equal( VECTORS.Embedder( {} ), null );
	ASSERT.equal( VECTORS.Embedder( { Embedding: { Url: 'http://x' } } ), null );
	ASSERT.equal( VECTORS.Embedder( null ), null );
	let embedder = VECTORS.Embedder( { Embedding: { Url: 'http://127.0.0.1:11434/', Model: 'nomic-embed-text' } } );
	ASSERT.equal( embedder.Model, 'nomic-embed-text' );
	ASSERT.equal( typeof embedder.Embed, 'function' );
} );


TEST( 'cosine and rank fusion', function ()
{
	ASSERT.equal( VECTORS.Cosine( [ 1, 0 ], [ 1, 0 ] ), 1 );
	ASSERT.equal( VECTORS.Cosine( [ 1, 0 ], [ 0, 1 ] ), 0 );
	ASSERT.equal( VECTORS.Cosine( [], [] ), 0 );
	ASSERT.equal( VECTORS.Cosine( [ 1 ], [ 1, 2 ] ), 0 );
	let merged = VECTORS.Merge( [ 'a', 'b', 'c' ], [ 'b', 'a' ] );
	ASSERT.deepEqual( merged.map( function ( entry ) { return entry.Key; } ), [ 'a', 'b', 'c' ] );
	ASSERT.ok( merged[ 0 ].Score > merged[ 2 ].Score );
	ASSERT.deepEqual( VECTORS.Merge( [ 'x' ], [] ).map( function ( entry ) { return entry.Key; } ), [ 'x' ] );
} );


TEST( 'without an embedder the index has no vectors and the search answers from terms alone', async function ()
{
	let corpus = await corpus_store();
	await INDEX.Refresh( corpus.Store, corpus.A.Id, null );
	await INDEX.Refresh( corpus.Store, corpus.B.Id, null );
	let index = await corpus.Store.ReadIndex( corpus.A.Id );
	ASSERT.equal( index.length, 3 );
	ASSERT.equal( index.some( function ( chunk ) { return 'Vector' in chunk; } ), false );
	let hits = await INDEX.SearchAll( corpus.Store, 'reply reopens a resolved thread', 5, null );
	ASSERT.equal( hits[ 0 ].Proposal, corpus.A.Id );
	ASSERT.match( hits[ 0 ].Text, /reopens/ );
	ASSERT.equal( ( await INDEX.SearchAll( corpus.Store, 'loopback port', 5, null ) )[ 0 ].Proposal, corpus.B.Id );
} );


TEST( 'with an embedder, only changed chunks are embedded and the cosine ranking merges in', async function ()
{
	let corpus = await corpus_store();
	let embedder = fake_embedder();
	await INDEX.Refresh( corpus.Store, corpus.A.Id, embedder );
	ASSERT.equal( embedder.Calls.length, 1 );
	ASSERT.equal( embedder.Calls[ 0 ].length, 3 );
	let index = await corpus.Store.ReadIndex( corpus.A.Id );
	ASSERT.equal( index.every( function ( chunk ) { return Array.isArray( chunk.Vector ) && chunk.Vector.length === 26; } ), true );
	// a reply changes one chunk: only that one is embedded again
	await corpus.Store.WriteThreads( corpus.A.Id, [ { Id: 't1', Anchor: { Text: 'reopens it' }, Replies: [ { Text: 'Reopening never reverts an applied change.' }, { Text: 'Agreed.' } ] } ] );
	await INDEX.Refresh( corpus.Store, corpus.A.Id, embedder );
	ASSERT.equal( embedder.Calls.length, 2 );
	ASSERT.equal( embedder.Calls[ 1 ].length, 1 );
	ASSERT.match( embedder.Calls[ 1 ][ 0 ], /Agreed/ );
	await INDEX.Refresh( corpus.Store, corpus.B.Id, embedder );
	let hits = await INDEX.SearchAll( corpus.Store, 'reply reopens a resolved thread', 5, embedder );
	ASSERT.equal( embedder.Calls[ embedder.Calls.length - 1 ].length, 1 );
	ASSERT.equal( hits[ 0 ].Proposal, corpus.A.Id );
	ASSERT.ok( hits.length >= 2 );
	ASSERT.ok( hits[ 0 ].Score > 0 );
	ASSERT.deepEqual( Object.keys( hits[ 0 ] ), [ 'Proposal', 'Revision', 'Chunk', 'Thread', 'Text', 'Score' ] );
} );


TEST( 'an embedder that fails is a logged line, not a failed refresh or search', async function ()
{
	let corpus = await corpus_store();
	let broken = { Embed: async function () { throw new Error( 'Ollama is down' ); } };
	let errors = [];
	let original = console.error;
	console.error = function ( line ) { errors.push( line ); };
	try
	{
		let chunks = await INDEX.Refresh( corpus.Store, corpus.A.Id, broken );
		ASSERT.equal( chunks.length, 3 );
		ASSERT.equal( chunks.some( function ( chunk ) { return chunk.Vector; } ), false );
		let hits = await INDEX.SearchAll( corpus.Store, 'owner resolves', 5, broken );
		ASSERT.equal( hits[ 0 ].Proposal, corpus.A.Id );
	}
	finally
	{
		console.error = original;
	}
	ASSERT.equal( errors.length, 1 );
	ASSERT.match( errors[ 0 ], /Ollama is down/ );
} );
