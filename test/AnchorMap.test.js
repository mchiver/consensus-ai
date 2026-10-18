'use strict';

// The anchor map (public/js/anchormap.js, plan UI Components, Step 3): over a corpus of real markdown (the guide's
// pages, the Consensus project's texts in .consensus) and a few made-up cases, the plain text it derives from the
// Lezer tree equals the server's PlainText (src/Anchors.js) character for character, every character carries a
// source span that holds it, and a plain-text range maps to a source range. Its PlainTextOfHtml is the server's
// rule. And index.html's import map names exactly the CodeMirror packages the server serves, at their entries.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const FS = require( 'fs' );
const PATH = require( 'path' );
const URL = require( 'url' );
const MARKED = require( 'marked' );
const ANCHORS = require( '../src/Anchors.js' );
const SERVER = require( '../src/Server.js' );

const ROOT = PATH.join( __dirname, '..' );

const CASES = {
	'inline syntax': '# A *title* with **bold** and `code`\n\nText with a [link](http://x.y "title") and an ![image](i.png) and <http://auto.link> and bare http://bare.link here.\n\nA line\\\nwith a hard break, and a soft\nbreak, and an escaped \\* star, and &amp; entities &lt; &copy; &#39; &#x41;.\n',
	'blocks': '> A quote\n> over two lines\n\n- one\n- two with *emphasis*\n  1. nested\n  2. list\n\n- [ ] a task\n- [x] done\n\n---\n\n    indented code\n    second line\n\n```js\nlet x = 1 < 2 && "q";\n```\n\n~~struck~~ text\n',
	'tables and html': '| Head | Other |\n| --- | :---: |\n| a | **b** |\n| c & d | `e` |\n\n<div class="x">raw <b>html</b> block</div>\n\nInline <span>html</span> here.\n\n<!-- a comment -->\n\nSetext\n======\n\nAnother\n-------\n\n[ref]: http://ref.link\nA [reference][ref] link and a [collapsed][] one.\n\n[collapsed]: http://c.link\n',
};


function corpus()
{
	let files = {};
	for ( let name of FS.readdirSync( PATH.join( ROOT, 'docs', 'guide' ) ) )
	{
		if ( name.endsWith( '.md' ) )
		{
			files[ 'docs/guide/' + name ] = FS.readFileSync( PATH.join( ROOT, 'docs', 'guide', name ), 'utf8' );
		}
	}
	let content = PATH.join( ROOT, '.consensus', 'content' );
	if ( FS.existsSync( content ) )
	{
		for ( let id of FS.readdirSync( content ) )
		{
			let file = PATH.join( content, id, 'content.md' );
			if ( FS.existsSync( file ) )
			{
				files[ '.consensus/' + id ] = FS.readFileSync( file, 'utf8' );
			}
		}
	}
	return Object.assign( files, CASES );
}


function first_difference( a, b )
{
	let at = 0;
	while ( at < a.length && at < b.length && a[ at ] === b[ at ] )
	{
		at++;
	}
	return 'at ' + at + ': ours "' + a.slice( Math.max( 0, at - 30 ), at + 30 ) + '" vs server "' + b.slice( Math.max( 0, at - 30 ), at + 30 ) + '"';
}


async function load_map()
{
	return import( URL.pathToFileURL( PATH.join( ROOT, 'public', 'js', 'anchormap.js' ) ).href );
}


TEST( 'the anchor map derives the server\'s plain text from the source, every character with a source span that holds it', async function ()
{
	let MAP = await load_map();
	let files = corpus();
	let names = Object.keys( files );
	ASSERT.ok( names.length > 20, 'the corpus has the guide and the project: ' + names.length );
	let failures = [];
	for ( let name of names )
	{
		let source = files[ name ];
		let expected = ANCHORS.PlainText( source );
		let map = MAP.Build( source );
		if ( map.Plain !== expected )
		{
			failures.push( name + ' ' + first_difference( map.Plain, expected ) );
			continue;
		}
		ASSERT.equal( map.Starts.length, map.Plain.length, name + ': a start per character' );
		ASSERT.equal( map.Ends.length, map.Plain.length, name + ': an end per character' );
		for ( let index = 0; index < map.Plain.length; index++ )
		{
			let character = map.Plain[ index ];
			let start = map.Starts[ index ];
			let end = map.Ends[ index ];
			ASSERT.ok( start >= 0 && end > start && end <= source.length, name + ': the span of character ' + index + ' is inside the source' );
			if ( index > 0 )
			{
				ASSERT.ok( start >= map.Starts[ index - 1 ], name + ': the spans do not go backwards at ' + index );
			}
			// a plain letter is where its span says; a decoded entity, an escape or a collapsed space spans more
			if ( end - start === 1 && character !== ' ' )
			{
				ASSERT.equal( source[ start ], character, name + ': character ' + index + ' is at its offset' );
			}
		}
	}
	ASSERT.deepEqual( failures, [], 'texts whose plain text differs from the server\'s' );
} );


TEST( 'a plain-text range maps to the source range holding it', async function ()
{
	let MAP = await load_map();
	let source = '# Title\n\nSome **bold words** here, and a [link text](http://x.y).\n';
	let map = MAP.Build( source );
	ASSERT.equal( map.Plain, 'Title Some bold words here, and a link text.' );
	let bold = map.Plain.indexOf( 'bold words' );
	let range = MAP.SourceRange( map, bold, bold + 'bold words'.length );
	ASSERT.equal( source.slice( range.From, range.To ), 'bold words' );
	let link = map.Plain.indexOf( 'link text' );
	range = MAP.SourceRange( map, link, link + 'link text'.length );
	ASSERT.equal( source.slice( range.From, range.To ), 'link text' );
	// across the space between the title and the paragraph: the space spans the newlines
	range = MAP.SourceRange( map, 0, map.Plain.indexOf( 'Some' ) + 4 );
	ASSERT.equal( source.slice( range.From, range.To ), '# Title\n\nSome'.slice( 2 ) );
	ASSERT.equal( MAP.SourceRange( map, 5, 5 ), null );
	ASSERT.equal( MAP.SourceRange( map, 0, map.Plain.length + 1 ), null );
} );


TEST( 'a source range maps to the plain range of the characters inside it, the reverse of SourceRange (plan Markdown Editor, Step 2)', async function ()
{
	let MAP = await load_map();
	let source = '# Title\n\nSome **bold words** here, and a [link text](http://x.y).\n';
	let map = MAP.Build( source );
	// a plain word: its own source span comes back as itself
	let bold = map.Plain.indexOf( 'bold words' );
	let span = MAP.SourceRange( map, bold, bold + 'bold words'.length );
	ASSERT.deepEqual( MAP.PlainRange( map, span.From, span.To ), { Start: bold, End: bold + 'bold words'.length } );
	// the whole source: the whole plain text
	ASSERT.deepEqual( MAP.PlainRange( map, 0, source.length ), { Start: 0, End: map.Plain.length } );
	// a span over the syntax only (the ** marks) holds no character
	ASSERT.equal( MAP.PlainRange( map, source.indexOf( '**' ), source.indexOf( '**' ) + 2 ), null );
	// a span that cuts into a word holds the whole characters inside it
	let here = source.indexOf( 'here' );
	ASSERT.equal( map.Plain.slice( MAP.PlainRange( map, here + 1, here + 4 ).Start, MAP.PlainRange( map, here + 1, here + 4 ).End ), 'ere' );
	// the link's text, not its URL
	let url = source.indexOf( 'http://x.y' );
	ASSERT.equal( MAP.PlainRange( map, url, url + 10 ), null );
	ASSERT.equal( MAP.PlainRange( map, 5, 5 ), null );
	// a selection dragged past a line's end, to the start of the next line or block (plan UI Tweaks VIII): the line's words
	// and at most the separator space after them, never the lines beyond
	let lines = MAP.Build( '# Title\n\nThe first paragraph.\n\n- one list item\n' );
	let first = '# Title\n\n'.length;
	let newline = '# Title\n\nThe first paragraph.'.length;
	let past = MAP.PlainRange( lines, first, newline + 1 );
	ASSERT.equal( lines.Plain.slice( past.Start, past.End ).trim(), 'The first paragraph.' );
	let next = MAP.PlainRange( lines, first, newline + 2 );
	ASSERT.equal( lines.Plain.slice( next.Start, next.End ).trim(), 'The first paragraph.' );
	// every character of the corpus round-trips through its own span
	for ( let name of Object.keys( CASES ) )
	{
		let one = MAP.Build( CASES[ name ] );
		for ( let index = 0; index < one.Plain.length; index += 7 )
		{
			if ( one.Plain[ index ] === ' ' || one.Ends[ index ] - one.Starts[ index ] !== 1 )
			{
				continue;
			}
			let back = MAP.PlainRange( one, one.Starts[ index ], one.Ends[ index ] );
			ASSERT.deepEqual( back, { Start: index, End: index + 1 }, name + ' at ' + index );
		}
	}
} );


TEST( 'PlainTextOfHtml is the server\'s PlainText', async function ()
{
	let MAP = await load_map();
	let files = corpus();
	for ( let name of Object.keys( files ) )
	{
		ASSERT.equal( MAP.PlainTextOfHtml( MARKED.parse( files[ name ] ) ), ANCHORS.PlainText( files[ name ] ), name );
	}
} );


TEST( 'index.html\'s import map names the CodeMirror packages the server serves, at their module entries', function ()
{
	let index = FS.readFileSync( PATH.join( ROOT, 'public', 'index.html' ), 'utf8' );
	let match = /<script type="importmap">\s*([\s\S]*?)\s*<\/script>/.exec( index );
	ASSERT.ok( match, 'the import map is in the page' );
	let imports = JSON.parse( match[ 1 ] ).imports;
	let expected = {};
	for ( let one of SERVER.CodeMirrorPackages() )
	{
		expected[ one.Name ] = '/vendor/codemirror/' + one.Name + '/' + one.Entry;
		ASSERT.ok( FS.existsSync( PATH.join( one.Folder, one.Entry ) ), one.Name + ': its entry file exists' );
	}
	ASSERT.deepEqual( imports, expected );
	ASSERT.ok( Object.keys( expected ).length >= 6 );
} );
