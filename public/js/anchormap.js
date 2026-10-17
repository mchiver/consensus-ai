// AnchorMap - the visible text of a markdown source, as the server renders it, with the source span of every
// character (plan UI Components, Step 3). The server (src/Anchors.js) finds a thread's passage in the plain text of
// marked's HTML: the tags gone (block tags as breaks), entities decoded, whitespace collapsed, the whole trimmed.
// Build walks the Lezer markdown tree of the source instead, keeps the text of the content nodes, skips the syntax,
// decodes the same entities and the backslash escapes, and collapses the same way, so that when its Plain equals the
// server's, a position in the plain text maps to an offset in the source. PlainTextOfHtml is the server's rule, for
// the check. An ES module: the page's bundle imports it, and so does test/AnchorMap.test.js in node.
//
//   Build( Source ) -> { Plain, Starts, Ends }       Starts[ i ] .. Ends[ i ] the source span of Plain[ i ]
//   SourceRange( Map, Start, End ) -> { From, To }   the source span of Plain.slice( Start, End ), or null
//   PlainRange( Map, From, To ) -> { Start, End }    the plain range of the characters inside a source span, or null
//   PlainTextOfHtml( Html ) -> the server's plain text of marked's HTML
//   Parser() -> the Lezer markdown parser used (CommonMark with GFM, as marked's default)

import { parser as COMMONMARK, GFM } from '@lezer/markdown';

const BLOCK_TAGS = [ 'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'ul', 'ol', 'blockquote', 'pre', 'table', 'tr', 'hr', 'br', 'td', 'th', 'dd', 'dt' ];
const TAG = /<\/?([a-zA-Z0-9]+)[^>]*>/g;
const PARSER = COMMONMARK.configure( [ GFM ] );

// Syntax that renders to nothing: dropped with everything inside.
const SKIPPED = new Set( [ 'HeaderMark', 'EmphasisMark', 'CodeMark', 'LinkTitle', 'ListMark', 'QuoteMark', 'TaskMarker', 'StrikethroughMark', 'CodeInfo', 'HorizontalRule', 'Image', 'LinkReference', 'TableDelimiter' ] );
// Rows whose text lives in their cells alone: between the cells, the pipes render as the breaks between <td>s.
const CELL_ROWS = new Set( [ 'Table', 'TableHeader', 'TableRow' ] );


//---------------------------------------------------------------------
// The server's rule over marked's HTML.

export function PlainTextOfHtml( Html )
{
	let text = ( Html || '' ).replace( TAG, replace_tag );
	text = decode_entities( text );
	text = text.replace( /\s+/g, ' ' ).trim();
	return text;
}


function replace_tag( match, tag_name )
{
	if ( BLOCK_TAGS.includes( tag_name.toLowerCase() ) )
	{
		return '\n';
	}
	return '';
}


function decode_entities( text )
{
	text = text.replace( /&#x([0-9a-fA-F]+);/g, decode_hex );
	text = text.replace( /&#([0-9]+);/g, decode_decimal );
	text = text.replace( /&quot;/g, '"' );
	text = text.replace( /&#39;/g, "'" );
	text = text.replace( /&lt;/g, '<' );
	text = text.replace( /&gt;/g, '>' );
	text = text.replace( /&nbsp;/g, ' ' );
	text = text.replace( /&amp;/g, '&' );
	return text;
}


function decode_hex( match, digits )
{
	return String.fromCodePoint( parseInt( digits, 16 ) );
}


function decode_decimal( match, digits )
{
	return String.fromCodePoint( parseInt( digits, 10 ) );
}


export function Parser()
{
	return PARSER;
}


//---------------------------------------------------------------------
// Build: the tree walked, the characters collected with their spans, then collapsed as the server collapses.

export function Build( Source )
{
	let source = Source || '';
	let tree = PARSER.parse( source );
	let raw = [];
	let context = { Source: source, Raw: raw, Definitions: definitions( tree, source ) };
	visit( tree.topNode, context, { Parent: '', InAutolink: false, Literal: false } );
	return collapse( raw );
}


// A reference label the way marked matches it: case folded, its whitespace collapsed.
function normalize_label( text )
{
	return text.trim().replace( /\s+/g, ' ' ).toLowerCase();
}


// The labels defined in the document ([label]: url): a reference link to another label is not a link to marked, which
// leaves its brackets in the text, while Lezer parses it as one regardless.
function definitions( tree, source )
{
	let defined = new Set();
	let cursor = tree.cursor();
	do
	{
		if ( cursor.name === 'LinkReference' )
		{
			let node = cursor.node;
			let label = node.getChild( 'LinkLabel' );
			if ( label )
			{
				defined.add( normalize_label( source.slice( label.from + 1, label.to - 1 ) ) );
			}
		}
	}
	while ( cursor.next() );
	return defined;
}


// Whether a Link node is one to marked: an inline link (a URL child) always; a reference link when its label (the
// bracketed one after it, or its own text) is defined.
function is_link( node, context )
{
	if ( node.getChild( 'URL' ) )
	{
		return true;
	}
	let source = context.Source;
	let marks = node.getChildren( 'LinkMark' );
	let label = node.getChild( 'LinkLabel' );
	let text = '';
	if ( label && label.to - label.from > 2 )
	{
		text = source.slice( label.from + 1, label.to - 1 );
	}
	else if ( marks.length >= 2 )
	{
		text = source.slice( marks[ 0 ].to, marks[ 1 ].from );
	}
	return context.Definitions.has( normalize_label( text ) );
}


function emit_text( context, from, to )
{
	for ( let index = from; index < to; index++ )
	{
		context.Raw.push( { Char: context.Source[ index ], Start: index, End: index + 1 } );
	}
}


function emit_space( context, from, to )
{
	context.Raw.push( { Char: ' ', Start: from, End: Math.max( to, from + 1 ) } );
}


// Raw HTML: its text stays, a block tag reads as a break, any other tag as nothing (the server's regex).
function emit_html( context, from, to )
{
	let segment = context.Source.slice( from, to );
	let at = 0;
	let regex = new RegExp( TAG.source, 'g' );
	let match = regex.exec( segment );
	while ( match )
	{
		emit_text( context, from + at, from + match.index );
		if ( BLOCK_TAGS.includes( match[ 1 ].toLowerCase() ) )
		{
			emit_space( context, from + match.index, from + match.index + match[ 0 ].length );
		}
		at = match.index + match[ 0 ].length;
		match = regex.exec( segment );
	}
	emit_text( context, from + at, to );
}


function visit( node, context, where )
{
	let name = node.name;
	if ( SKIPPED.has( name ) )
	{
		return;
	}
	// a link's syntax: skipped in a link, text in a bracketed phrase marked leaves as it is
	if ( name === 'LinkMark' || name === 'LinkLabel' )
	{
		if ( where.Literal )
		{
			emit_text( context, node.from, node.to );
		}
		return;
	}
	// a URL is the link's target inside a Link (not shown), the text itself in <angle brackets> or bare (GFM)
	if ( name === 'URL' && where.Parent === 'Link' )
	{
		return;
	}
	if ( name === 'HardBreak' )
	{
		emit_space( context, node.from, node.to );
		return;
	}
	if ( name === 'Entity' )
	{
		let decoded = decode_entities( context.Source.slice( node.from, node.to ) );
		for ( let character of decoded )
		{
			context.Raw.push( { Char: character, Start: node.from, End: node.to } );
		}
		return;
	}
	if ( name === 'Escape' )
	{
		context.Raw.push( { Char: context.Source[ node.to - 1 ], Start: node.from, End: node.to } );
		return;
	}
	if ( name === 'HTMLBlock' || name === 'HTMLTag' )
	{
		emit_html( context, node.from, node.to );
		return;
	}
	let literal = where.Literal || ( name === 'Link' && !is_link( node, context ) );
	let cells_only = CELL_ROWS.has( name );
	let inner = { Parent: name, InAutolink: where.InAutolink || name === 'Autolink', Literal: literal };
	let at = node.from;
	let child = node.firstChild;
	while ( child )
	{
		if ( child.from > at )
		{
			if ( cells_only )
			{
				emit_space( context, at, child.from );
			}
			else
			{
				emit_text( context, at, child.from );
			}
		}
		visit( child, context, inner );
		at = child.to;
		child = child.nextSibling;
	}
	if ( node.to > at )
	{
		if ( cells_only )
		{
			emit_space( context, at, node.to );
		}
		else
		{
			emit_text( context, at, node.to );
		}
	}
}


// Whitespace runs become one space, carrying the span of the run's first character; the ends are trimmed.
function collapse( raw )
{
	let map = { Plain: '', Starts: [], Ends: [] };
	let space = null;
	for ( let item of raw )
	{
		if ( /\s/.test( item.Char ) )
		{
			if ( map.Plain.length && !space )
			{
				space = item;
			}
			continue;
		}
		if ( space )
		{
			map.Plain += ' ';
			map.Starts.push( space.Start );
			map.Ends.push( space.End );
			space = null;
		}
		map.Plain += item.Char;
		map.Starts.push( item.Start );
		map.Ends.push( item.End );
	}
	return map;
}


//---------------------------------------------------------------------
// SourceRange: the source span of a plain-text range.

export function SourceRange( Map, Start, End )
{
	if ( !Map || Start < 0 || End > Map.Plain.length || End <= Start )
	{
		return null;
	}
	return { From: Map.Starts[ Start ], To: Map.Ends[ End - 1 ] };
}


//---------------------------------------------------------------------
// PlainRange: the plain-text range of the characters whose spans lie inside a source span (plan Markdown Editor,
// Step 2: the editor's selection as an anchor), as { Start, End }, or null when none lies inside.

export function PlainRange( Map, From, To )
{
	if ( !Map || To <= From )
	{
		return null;
	}
	let start = first_at_or_after( Map.Starts, From );
	let end = start;
	while ( end < Map.Plain.length && Map.Ends[ end ] <= To )
	{
		end++;
	}
	if ( end <= start )
	{
		return null;
	}
	return { Start: start, End: end };
}


// The first index whose start is at or after Position; the starts never go backwards.
function first_at_or_after( starts, position )
{
	let low = 0;
	let high = starts.length;
	while ( low < high )
	{
		let middle = ( low + high ) >> 1;
		if ( starts[ middle ] < position )
		{
			low = middle + 1;
		}
		else
		{
			high = middle;
		}
	}
	return low;
}
