'use strict';

// The Live Preview's plan (public/js/live-preview.js, plan Markdown Editor, Step 1): over a source holding every
// construct of the first cut, Plan lists the decorations the editor makes, off the revealed lines the syntax hidden
// and the constructs replaced, on them the source left alone; the block kinds cover whole lines; no two
// replacements overlap; and the editor's own tree gives the same plan as the parser here.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const PATH = require( 'path' );
const URL = require( 'url' );

const ROOT = PATH.join( __dirname, '..' );

const LINES = [
	'# Title',																													// 1
	'',
	'Text with *emphasis*, **strong**, ~~struck~~, `code`, a [link](http://x.y "t"), <http://auto.link> and an escaped \\* star.',	// 3
	'',
	'## Second heading ##',																										// 5
	'',
	'Setext',																													// 7
	'------',																													// 8
	'',
	'> A quote',																												// 10
	'> continued',																												// 11
	'',
	'- one',																													// 13
	'- [ ] a task',																												// 14
	'- [x] done',																												// 15
	'  1. nested',																												// 16
	'',
	'```js',																													// 18
	'let x = 1;',																												// 19
	'```',																														// 20
	'',
	'---',																														// 22
	'',
	'| Head | Other |',																											// 24
	'| --- | --- |',																											// 25
	'| a | b |',																												// 26
	'',
	'![alt text](pic.png)',																										// 28
	'',
	'<div>html</div>',																											// 30
	'',
	'[ref]: http://ref.link',																									// 32
	'A [reference][ref] link and &amp; an entity.',																				// 33
];
const SOURCE = LINES.join( '\n' ) + '\n';

const REPLACING = new Set( [ 'hide', 'bullet', 'check', 'image', 'fence-start', 'fence-end', 'setext', 'rule', 'table' ] );
const BLOCKS = new Set( [ 'fence-start', 'fence-end', 'setext', 'rule', 'table' ] );


async function load()
{
	return import( URL.pathToFileURL( PATH.join( ROOT, 'public', 'js', 'live-preview.js' ) ).href );
}


// The source offset where a 1-based line starts, and where it ends.
function start_of( number )
{
	let at = 0;
	for ( let index = 1; index < number; index++ )
	{
		at += LINES[ index - 1 ].length + 1;
	}
	return at;
}


function end_of( number )
{
	return start_of( number ) + LINES[ number - 1 ].length;
}


function line_of( position )
{
	let number = 1;
	while ( number < LINES.length && start_of( number + 1 ) <= position )
	{
		number++;
	}
	return number;
}


function on_line( items, number, kind )
{
	return items.filter( function ( item ) { return line_of( item.From ) === number && ( !kind || item.Kind === kind ); } );
}


function text_of( item )
{
	return SOURCE.slice( item.From, item.To );
}


TEST( 'with nothing revealed, every construct of the first cut is planned', async function ()
{
	let LIVE = await load();
	let items = LIVE.Plan( SOURCE, [] );

	// headings: the line class and the hidden marks
	ASSERT.deepEqual( on_line( items, 1, 'line' ).map( function ( item ) { return item.Class; } ), [ 'h1' ] );
	ASSERT.deepEqual( on_line( items, 1, 'hide' ).map( text_of ), [ '# ' ] );
	ASSERT.deepEqual( on_line( items, 5, 'line' ).map( function ( item ) { return item.Class; } ), [ 'h2' ] );
	ASSERT.deepEqual( on_line( items, 5, 'hide' ).map( text_of ), [ '## ', ' ##' ] );
	ASSERT.deepEqual( on_line( items, 7, 'line' ).map( function ( item ) { return item.Class; } ), [ 'h2' ] );
	ASSERT.deepEqual( on_line( items, 8, 'setext' ).map( text_of ), [ '------' ] );

	// inline: emphasis marks, code, link, autolink, escape
	ASSERT.deepEqual( on_line( items, 3, 'hide' ).map( text_of ), [ '*', '*', '**', '**', '~~', '~~', '`', '`', '[', '](http://x.y "t")', '\\' ] );
	ASSERT.deepEqual( on_line( items, 3, 'code' ).map( text_of ), [ 'code' ] );
	ASSERT.deepEqual( on_line( items, 3, 'link' ).map( function ( item ) { return text_of( item ) + '>' + item.Url; } ), [ 'link>http://x.y', '<http://auto.link>>http://auto.link' ] );

	// blockquote lines and marks
	ASSERT.deepEqual( on_line( items, 10, 'line' ).concat( on_line( items, 11, 'line' ) ).map( function ( item ) { return item.Class; } ), [ 'quote', 'quote' ] );
	ASSERT.deepEqual( on_line( items, 10, 'hide' ).concat( on_line( items, 11, 'hide' ) ).map( text_of ), [ '> ', '> ' ] );

	// lists: bullets for the dashes, not for the number; the task markers as checkboxes
	ASSERT.deepEqual( items.filter( function ( item ) { return item.Kind === 'bullet'; } ).map( function ( item ) { return line_of( item.From ); } ), [ 13, 14, 15 ] );
	ASSERT.deepEqual( items.filter( function ( item ) { return item.Kind === 'check'; } ).map( function ( item ) { return line_of( item.From ) + ':' + item.Checked; } ), [ '14:false', '15:true' ] );
	ASSERT.deepEqual( on_line( items, 16 ), [] );

	// fenced code: the fence lines replaced, the code line styled
	ASSERT.deepEqual( on_line( items, 18 ).map( function ( item ) { return item.Kind + ':' + item.Language; } ), [ 'fence-start:js' ] );
	ASSERT.deepEqual( on_line( items, 19 ).map( function ( item ) { return item.Kind + ':' + item.Class; } ), [ 'line:code-line' ] );
	ASSERT.deepEqual( on_line( items, 20 ).map( function ( item ) { return item.Kind; } ), [ 'fence-end' ] );

	// the rule, the table, the image
	ASSERT.deepEqual( on_line( items, 22 ).map( function ( item ) { return item.Kind; } ), [ 'rule' ] );
	let table = items.find( function ( item ) { return item.Kind === 'table'; } );
	ASSERT.equal( table.From, start_of( 24 ) );
	ASSERT.equal( table.To, end_of( 26 ) );
	ASSERT.equal( table.Text, LINES.slice( 23, 26 ).join( '\n' ) );
	ASSERT.deepEqual( items.filter( function ( item ) { return item.Kind === 'image'; } ).map( function ( item ) { return item.Url + '|' + item.Alt + '|' + text_of( item ); } ), [ 'pic.png|alt text|![alt text](pic.png)' ] );

	// html, the reference definition, the reference link and the entity stay as they are
	for ( let number of [ 30, 32, 33 ] )
	{
		ASSERT.deepEqual( on_line( items, number ), [], 'nothing planned on line ' + number );
	}
} );


TEST( 'the plan is sorted, inside the source, its blocks cover whole lines and its replacements do not overlap', async function ()
{
	let LIVE = await load();
	let items = LIVE.Plan( SOURCE, [] );
	ASSERT.ok( items.length > 20 );
	let last_replacement = null;
	for ( let index = 0; index < items.length; index++ )
	{
		let item = items[ index ];
		ASSERT.ok( item.From >= 0 && item.To <= SOURCE.length && item.To >= item.From, 'inside the source: ' + JSON.stringify( item ) );
		if ( index > 0 )
		{
			ASSERT.ok( item.From >= items[ index - 1 ].From, 'sorted at ' + index );
		}
		if ( BLOCKS.has( item.Kind ) )
		{
			ASSERT.equal( item.From, start_of( line_of( item.From ) ), item.Kind + ' starts a line' );
			ASSERT.equal( item.To, end_of( line_of( item.To ) ), item.Kind + ' ends a line' );
		}
		if ( REPLACING.has( item.Kind ) )
		{
			if ( last_replacement )
			{
				ASSERT.ok( item.From >= last_replacement.To, 'replacements apart: ' + JSON.stringify( last_replacement ) + ' then ' + JSON.stringify( item ) );
			}
			last_replacement = item;
		}
	}
} );


TEST( 'a revealed line shows its source; a revealed line of a code block or a table reveals the block', async function ()
{
	let LIVE = await load();
	let items = LIVE.Plan( SOURCE, [ 1, 5, 11, 19, 25, 28 ] );
	// the headings keep their size, their marks show
	ASSERT.deepEqual( on_line( items, 1 ).map( function ( item ) { return item.Kind + ':' + item.Class; } ), [ 'line:h1' ] );
	ASSERT.deepEqual( on_line( items, 5 ).map( function ( item ) { return item.Kind + ':' + item.Class; } ), [ 'line:h2' ] );
	// the quote's second line shows its mark, the first still hides it
	ASSERT.deepEqual( on_line( items, 10, 'hide' ).map( text_of ), [ '> ' ] );
	ASSERT.deepEqual( on_line( items, 11 ).map( function ( item ) { return item.Kind; } ), [ 'line' ] );
	// the code block whole: no fences replaced, the code line still styled
	ASSERT.deepEqual( on_line( items, 18 ), [] );
	ASSERT.deepEqual( on_line( items, 19 ).map( function ( item ) { return item.Kind + ':' + item.Class; } ), [ 'line:code-line' ] );
	ASSERT.deepEqual( on_line( items, 20 ), [] );
	// the table and the image as source
	ASSERT.equal( items.some( function ( item ) { return item.Kind === 'table'; } ), false );
	ASSERT.equal( items.some( function ( item ) { return item.Kind === 'image'; } ), false );
	// the rest as before
	ASSERT.deepEqual( on_line( items, 22 ).map( function ( item ) { return item.Kind; } ), [ 'rule' ] );
	ASSERT.deepEqual( items.filter( function ( item ) { return item.Kind === 'bullet'; } ).length, 3 );
} );


TEST( 'a tree given to Plan gives the plan the parser here gives', async function ()
{
	let LIVE = await load();
	let MAP = await import( URL.pathToFileURL( PATH.join( ROOT, 'public', 'js', 'anchormap.js' ) ).href );
	let tree = MAP.Parser().parse( SOURCE );
	ASSERT.deepEqual( LIVE.Plan( SOURCE, [ 3 ], tree ), LIVE.Plan( SOURCE, [ 3 ] ) );
	ASSERT.deepEqual( LIVE.Plan( '', [] ), [] );
} );
