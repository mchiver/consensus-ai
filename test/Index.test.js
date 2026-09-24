'use strict';

// Our own embedding: chunking, tokens and the stemmer, BM25 weights against values worked by hand,
// search ranking on a small known corpus, and a refresh that re-weighs only what changed.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const INDEX = require( '../src/Index.js' );


function close( actual, expected, label )
{
	ASSERT.ok( Math.abs( actual - expected ) < 0.001, label + ': ' + actual + ' vs ' + expected );
}


TEST( 'tokens are lowercase words without stop words, lightly stemmed', function ()
{
	ASSERT.deepEqual( INDEX.Tokens( 'The LLM resolves a Thread, and the User is resolving it!' ), [ 'llm', 'resolv', 'thread', 'user', 'resolv' ] );
	ASSERT.deepEqual( INDEX.Tokens( '' ), [] );
	ASSERT.deepEqual( INDEX.Tokens( 'a the of' ), [] );
} );


TEST( 'the stemmer brings inflections together without mangling short or root words', function ()
{
	for ( let words of [ [ 'resolve', 'resolves', 'resolved', 'resolving' ], [ 'apply', 'applied', 'applies', 'applying' ], [ 'embed', 'embeds', 'embedding', 'embedded' ], [ 'comment', 'comments', 'commented' ], [ 'anchor', 'anchors', 'anchored' ], [ 'plan', 'plans', 'planned', 'planning' ] ] )
	{
		let stems = new Set( words.map( INDEX.Stem ) );
		ASSERT.equal( stems.size, 1, words.join( ' ' ) + ' -> ' + Array.from( stems ).join( ' ' ) );
	}
	ASSERT.equal( INDEX.Stem( 'status' ), 'status' );
	ASSERT.equal( INDEX.Stem( 'consensus' ), 'consensus' );
	ASSERT.equal( INDEX.Stem( 'yes' ), 'yes' );
	ASSERT.equal( INDEX.Stem( 'the' ), 'the' );
	ASSERT.equal( INDEX.Stem( 'quickly' ), 'quick' );
} );


TEST( 'chunks are paragraphs, a heading joined with the short paragraphs under it, and one per thread', function ()
{
	let text = [
		'Opening paragraph.',
		'',
		'# Heading one',
		'',
		'Under one.',
		'',
		'Still under one.',
		'',
		'# Heading two',
		'',
		'x'.repeat( 500 ),
		'',
		'y'.repeat( 200 ),
		'',
	].join( '\n' );
	let threads = [
		{ Id: 't1', Anchor: { Text: 'Under one.' }, Replies: [ { Text: 'A comment.' }, { Text: 'An answer.' } ] },
		{ Id: 't2', Anchor: null, Replies: [ { Text: 'On the whole document.' } ] },
	];
	let chunks = INDEX.Chunk( { Id: 'p', Revision: 3 }, text, threads );
	ASSERT.deepEqual( chunks.map( function ( chunk ) { return chunk.Text; } ), [
		'Opening paragraph.',
		'# Heading one\n\nUnder one.\n\nStill under one.',
		'# Heading two\n\n' + 'x'.repeat( 500 ),
		'y'.repeat( 200 ),
		'Under one.\n\nA comment.\n\nAn answer.',
		'On the whole document.',
	] );
	ASSERT.deepEqual( chunks.map( function ( chunk ) { return chunk.Chunk; } ), [ 1, 2, 3, 4, 5, 6 ] );
	ASSERT.equal( chunks[ 0 ].Proposal, 'p' );
	ASSERT.equal( chunks[ 0 ].Revision, 3 );
	ASSERT.equal( chunks[ 4 ].Thread, 't1' );
	ASSERT.equal( chunks[ 0 ].Thread, undefined );
	ASSERT.match( chunks[ 0 ].Hash, /^[0-9a-f]{16}$/ );
	ASSERT.deepEqual( INDEX.Chunk( { Id: 'e', Revision: 1 }, '', [] ), [] );
} );


TEST( 'BM25 weights match values worked by hand', function ()
{
	let chunks = [ { Chunk: 1, Text: 'apple banana' }, { Chunk: 2, Text: 'apple cherry cherry' } ];
	INDEX.Weigh( chunks );
	// N = 2, average length 2.5, k1 = 1.2, b = 0.75
	// idf(apple) = ln( 1 + 0.5 / 2.5 ) = 0.18232; idf(banana) = idf(cherry) = ln( 1 + 1.5 / 1.5 ) = 0.69315
	// chunk 1, length 2: saturation( 1 ) = 2.2 / ( 1 + 1.2 * ( 0.25 + 0.75 * 0.8 ) ) = 1.08911
	// chunk 2, length 3: saturation( 1 ) = 2.2 / ( 1 + 1.2 * ( 0.25 + 0.75 * 1.2 ) ) = 0.92437; saturation( 2 ) = 4.4 / 3.38 = 1.30178
	close( chunks[ 0 ].Terms.appl, 0.1986, 'apple in chunk 1' );
	close( chunks[ 0 ].Terms.banana, 0.7549, 'banana in chunk 1' );
	close( chunks[ 1 ].Terms.appl, 0.1685, 'apple in chunk 2' );
	close( chunks[ 1 ].Terms.cherri, 0.9023, 'cherry in chunk 2' );
	ASSERT.equal( Object.keys( chunks[ 0 ].Terms ).length, 2 );
} );


TEST( 'search ranks the chunk sharing the rarest words first and answers in the plan\'s shape', function ()
{
	let chunks = [
		{ Chunk: 1, Proposal: 'p', Revision: 2, Text: 'Only the owner resolves a thread. Resolving accepts the outcome stated in the last reply.' },
		{ Chunk: 2, Proposal: 'p', Revision: 2, Text: 'Any reply to a resolved thread reopens it. Reopening never reverts a change already applied.' },
		{ Chunk: 3, Proposal: 'p', Revision: 2, Thread: 't9', Text: 'Approving the whole document turns the proposal into a Plan.' },
		{ Chunk: 4, Proposal: 'q', Revision: 1, Text: 'Port 3500 on 127.0.0.1, refusing any other bind.' },
	];
	INDEX.Weigh( chunks );
	let hits = INDEX.Search( 'does a reply reopen a resolved thread?', chunks, 10 );
	ASSERT.equal( hits[ 0 ].Chunk, 2 );
	ASSERT.deepEqual( Object.keys( hits[ 0 ] ), [ 'Proposal', 'Revision', 'Chunk', 'Thread', 'Text', 'Score' ] );
	ASSERT.equal( hits[ 0 ].Thread, null );
	ASSERT.ok( hits[ 0 ].Score > hits[ 1 ].Score );
	ASSERT.equal( INDEX.Search( 'who approves the plan', chunks, 10 )[ 0 ].Thread, 't9' );
	ASSERT.equal( INDEX.Search( 'which port', chunks, 10 )[ 0 ].Proposal, 'q' );
	ASSERT.deepEqual( INDEX.Search( 'nothing matches xyzzy', chunks, 10 ), [] );
	ASSERT.equal( INDEX.Search( 'thread', chunks, 1 ).length, 1 );
} );


TEST( 'a refresh after a change re-chunks, and unchanged chunks keep their hash', function ()
{
	let proposal = { Id: 'p', Revision: 1 };
	let text = 'First paragraph stays.\n\nSecond paragraph changes.';
	let before = INDEX.Chunk( proposal, text, [ { Id: 't1', Anchor: null, Replies: [ { Text: 'one reply' } ] } ] );
	let after_edit = INDEX.Chunk( { Id: 'p', Revision: 2 }, 'First paragraph stays.\n\nSecond paragraph is different now.', [ { Id: 't1', Anchor: null, Replies: [ { Text: 'one reply' } ] } ] );
	ASSERT.equal( after_edit[ 0 ].Hash, before[ 0 ].Hash );
	ASSERT.notEqual( after_edit[ 1 ].Hash, before[ 1 ].Hash );
	ASSERT.equal( after_edit[ 2 ].Hash, before[ 2 ].Hash );
	let after_reply = INDEX.Chunk( proposal, text, [ { Id: 't1', Anchor: null, Replies: [ { Text: 'one reply' }, { Text: 'and another' } ] } ] );
	ASSERT.equal( after_reply[ 0 ].Hash, before[ 0 ].Hash );
	ASSERT.equal( after_reply[ 1 ].Hash, before[ 1 ].Hash );
	ASSERT.notEqual( after_reply[ 2 ].Hash, before[ 2 ].Hash );
} );
