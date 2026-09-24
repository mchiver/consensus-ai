'use strict';

// Visible-text anchors: bold, links, lists, headings; an edit before the anchor, inside it, and one that removes it.
// The thresholds were measured on the three Outline proposals at step 0 (2026-09-24).

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const ANCHORS = require( '../src/Anchors.js' );

const MARKDOWN = [
	'# The title',
	'',
	'A first paragraph with **bold words** and a [link to somewhere](http://example.com) inside it.',
	'',
	'## A heading',
	'',
	'- item one is short',
	'- item two has *emphasis* and `code`',
	'- item three ends the list',
	'',
	'A closing paragraph that says: "quoted words" & an ampersand.',
	'',
].join( '\n' );


function anchor_for( markdown, words )
{
	let plain = ANCHORS.PlainText( markdown );
	let start = plain.indexOf( words );
	ASSERT.notEqual( start, -1, 'anchor words present: ' + words );
	return ANCHORS.Make( plain, start, start + words.length );
}


TEST( 'plain text is the visible text: no markup, entities decoded, whitespace collapsed', function ()
{
	let plain = ANCHORS.PlainText( MARKDOWN );
	ASSERT.equal( plain, 'The title A first paragraph with bold words and a link to somewhere inside it. A heading item one is short item two has emphasis and code item three ends the list A closing paragraph that says: "quoted words" & an ampersand.' );
	ASSERT.equal( ANCHORS.PlainText( '' ), '' );
	ASSERT.equal( ANCHORS.PlainText( undefined ), '' );
} );


TEST( 'an anchor carries the words with a prefix and suffix of visible text', function ()
{
	let anchor = anchor_for( MARKDOWN, 'link to somewhere' );
	ASSERT.equal( anchor.Text, 'link to somewhere' );
	ASSERT.equal( anchor.Prefix, 'paragraph with bold words and a ' );
	ASSERT.equal( anchor.Suffix, ' inside it. A heading item one i' );
	ASSERT.equal( anchor.Prefix.length, ANCHORS.CONTEXT_LENGTH );
	let first = ANCHORS.Make( 'abc def', 0, 3 );
	ASSERT.deepEqual( first, { Text: 'abc', Prefix: '', Suffix: ' def' } );
} );


TEST( 'anchors across bold, a link, a list item and a heading are found exactly', function ()
{
	let plain = ANCHORS.PlainText( MARKDOWN );
	for ( let words of [ 'bold words and a link', 'A heading item one', 'two has emphasis and code', 'The title' ] )
	{
		let found = ANCHORS.Find( plain, anchor_for( MARKDOWN, words ) );
		ASSERT.equal( found.Method, 'exact', words );
		ASSERT.equal( plain.slice( found.Start, found.End ), words );
	}
} );


TEST( 'repeated words are told apart by their context', function ()
{
	let markdown = 'Say yes here.\n\nSay yes there.\n\nSay yes everywhere.\n';
	let plain = ANCHORS.PlainText( markdown );
	let second = plain.indexOf( 'Say yes', 5 );
	let anchor = ANCHORS.Make( plain, second, second + 7 );
	let found = ANCHORS.Find( plain, anchor );
	ASSERT.equal( found.Start, second );
	ASSERT.equal( found.Method, 'exact' );
} );


TEST( 'an edit before the anchor keeps it', function ()
{
	let anchor = anchor_for( MARKDOWN, 'item three ends the list' );
	let edited = 'An inserted opening paragraph.\n\n' + MARKDOWN.replace( 'item one is short', 'item one is now much longer than it was' );
	let plain = ANCHORS.PlainText( edited );
	let found = ANCHORS.Find( plain, anchor );
	ASSERT.equal( found.Method, 'exact' );
	ASSERT.equal( plain.slice( found.Start, found.End ), 'item three ends the list' );
} );


TEST( 'an edit inside the anchor re-attaches it by context', function ()
{
	let anchor = anchor_for( MARKDOWN, 'item three ends the list' );
	let edited = MARKDOWN.replace( 'item three ends the list', 'item three closes the list' );
	let plain = ANCHORS.PlainText( edited );
	let found = ANCHORS.Find( plain, anchor );
	ASSERT.equal( found.Method, 'context' );
	ASSERT.equal( plain.slice( found.Start, found.End ), 'item three closes the list' );
	ASSERT.ok( found.Similarity >= 0.6 );
} );


TEST( 'an edit that removes the anchored passage detaches it', function ()
{
	let anchor = anchor_for( MARKDOWN, 'item two has emphasis and code' );
	let edited = MARKDOWN.replace( '- item two has *emphasis* and `code`\n', '' );
	ASSERT.equal( ANCHORS.Find( ANCHORS.PlainText( edited ), anchor ), null );
	ASSERT.equal( ANCHORS.Find( ANCHORS.PlainText( '# Something else entirely\n\nNo shared words.' ), anchor ), null );
	ASSERT.equal( ANCHORS.Find( 'abc', null ), null );
	ASSERT.equal( ANCHORS.Find( 'abc', { Text: '' } ), null );
} );


TEST( 'a rewritten passage with too few shared words detaches rather than guess', function ()
{
	let anchor = anchor_for( MARKDOWN, 'item two has emphasis and code' );
	let edited = MARKDOWN.replace( 'item two has *emphasis* and `code`', 'something altogether different here' );
	ASSERT.equal( ANCHORS.Find( ANCHORS.PlainText( edited ), anchor ), null );
} );


TEST( 'similarity is the Dice coefficient over words', function ()
{
	ASSERT.equal( ANCHORS.Similarity( 'a b c', 'a b c' ), 1 );
	ASSERT.equal( ANCHORS.Similarity( 'a b c d', 'a b' ), 2 * 2 / 6 );
	ASSERT.equal( ANCHORS.Similarity( 'a', 'b' ), 0 );
	ASSERT.equal( ANCHORS.Similarity( '', '' ), 1 );
} );


TEST( 'refind reports every thread: found, detached, or unanchored', function ()
{
	let threads = [
		{ Id: 'kept', Anchor: anchor_for( MARKDOWN, 'The title' ) },
		{ Id: 'gone', Anchor: anchor_for( MARKDOWN, 'quoted words' ) },
		{ Id: 'whole', Anchor: null },
	];
	let edited = MARKDOWN.replace( 'A closing paragraph that says: "quoted words" & an ampersand.', 'Nothing.' );
	let results = ANCHORS.Refind( threads, edited );
	ASSERT.equal( results[ 0 ].Found.Method, 'exact' );
	ASSERT.equal( results[ 0 ].Detached, false );
	ASSERT.equal( results[ 1 ].Found, null );
	ASSERT.equal( results[ 1 ].Detached, true );
	ASSERT.equal( results[ 2 ].Found, null );
	ASSERT.equal( results[ 2 ].Detached, false );
} );
