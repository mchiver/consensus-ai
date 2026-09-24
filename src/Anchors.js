'use strict';

// Anchors - a comment anchors to the visible text of a proposal, not to its markdown source.
// An anchor is { Text, Prefix, Suffix }: the anchored words plus a few dozen visible characters on each side.

const MARKED = require( 'marked' );

const CONTEXT_LENGTH = 32;
const BLOCK_TAGS = [ 'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'ul', 'ol', 'blockquote', 'pre', 'table', 'tr', 'hr', 'br', 'td', 'th', 'dd', 'dt' ];
const MIN_CONTEXT_MATCH = 12;
const MIN_SIMILARITY = 0.6;


//---------------------------------------------------------------------
// PlainText: the visible text of a markdown document, whitespace collapsed to single spaces.
// The page walks the rendered text nodes and collapses the same way, so positions agree.

function PlainText( Markdown )
{
	let html = MARKED.parse( Markdown || '' );
	let text = html.replace( /<\/?([a-zA-Z0-9]+)[^>]*>/g, replace_tag );
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


//---------------------------------------------------------------------
// Make: an anchor for the visible text between Start and End.

function Make( Plain, Start, End )
{
	let prefix_start = Math.max( 0, Start - CONTEXT_LENGTH );
	let suffix_end = Math.min( Plain.length, End + CONTEXT_LENGTH );
	return {
		Text: Plain.slice( Start, End ),
		Prefix: Plain.slice( prefix_start, Start ),
		Suffix: Plain.slice( End, suffix_end ),
	};
}


//---------------------------------------------------------------------
// Find: where an anchor is in the visible text.
// Returns { Start, End, Method } or null. Method is 'exact' when the anchored words are present
// and 'context' when the words changed but their surroundings still place them.

function Find( Plain, Anchor )
{
	if ( !Anchor || !Anchor.Text )
	{
		return null;
	}
	let exact = find_exact( Plain, Anchor );
	if ( exact )
	{
		return exact;
	}
	return find_by_context( Plain, Anchor );
}


function find_exact( plain, anchor )
{
	let candidates = [];
	let from = 0;
	while ( true )
	{
		let index = plain.indexOf( anchor.Text, from );
		if ( index < 0 )
		{
			break;
		}
		candidates.push( index );
		from = index + 1;
	}
	if ( candidates.length === 0 )
	{
		return null;
	}
	let best = candidates[ 0 ];
	let best_score = -1;
	for ( let candidate of candidates )
	{
		let score = context_score( plain, candidate, candidate + anchor.Text.length, anchor );
		if ( score > best_score )
		{
			best_score = score;
			best = candidate;
		}
	}
	return { Start: best, End: best + anchor.Text.length, Method: 'exact' };
}


// How many characters of prefix and suffix agree around a candidate position.
function context_score( plain, start, end, anchor )
{
	let score = 0;
	let prefix = anchor.Prefix || '';
	let suffix = anchor.Suffix || '';
	let index = 0;
	while ( index < prefix.length && ( start - 1 - index ) >= 0 && plain[ start - 1 - index ] === prefix[ prefix.length - 1 - index ] )
	{
		index++;
	}
	score += index;
	index = 0;
	while ( index < suffix.length && ( end + index ) < plain.length && plain[ end + index ] === suffix[ index ] )
	{
		index++;
	}
	score += index;
	return score;
}


function find_by_context( plain, anchor )
{
	let prefix_end = find_prefix_end( plain, anchor.Prefix || '' );
	let suffix_start = find_suffix_start( plain, anchor.Suffix || '', prefix_end );
	let candidate = null;
	if ( prefix_end >= 0 && suffix_start >= 0 && suffix_start >= prefix_end )
	{
		candidate = { Start: prefix_end, End: suffix_start };
	}
	else if ( prefix_end >= 0 )
	{
		candidate = best_window( plain, anchor.Text, prefix_end, 'after' );
	}
	else if ( suffix_start >= 0 )
	{
		candidate = best_window( plain, anchor.Text, suffix_start, 'before' );
	}
	if ( !candidate )
	{
		return null;
	}
	let found_text = plain.slice( candidate.Start, candidate.End );
	let similarity = Similarity( found_text, anchor.Text );
	if ( similarity < MIN_SIMILARITY )
	{
		return null;
	}
	return { Start: candidate.Start, End: candidate.End, Method: 'context', Similarity: similarity };
}


// With only one side of the context found: the window of words after (or before) it, between half and one
// and a half times the anchor's length, ending on a word boundary, that shares the most words with it.
function best_window( plain, text, edge, direction )
{
	let shortest = Math.max( 1, Math.floor( text.length / 2 ) );
	let longest = Math.ceil( text.length * 1.5 );
	let best = null;
	let best_similarity = -1;
	for ( let length = shortest; length <= longest; length++ )
	{
		let start = ( direction === 'after' ) ? edge : edge - length;
		let end = ( direction === 'after' ) ? edge + length : edge;
		if ( start < 0 || end > plain.length )
		{
			break;
		}
		let boundary = ( direction === 'after' ) ? is_word_boundary( plain, end ) : is_word_boundary( plain, start );
		if ( !boundary )
		{
			continue;
		}
		let similarity = Similarity( plain.slice( start, end ), text );
		if ( similarity > best_similarity )
		{
			best_similarity = similarity;
			best = { Start: start, End: end };
		}
	}
	return best;
}


function is_word_boundary( plain, position )
{
	if ( position <= 0 || position >= plain.length )
	{
		return true;
	}
	let before = /[a-z0-9]/i.test( plain[ position - 1 ] );
	let after = /[a-z0-9]/i.test( plain[ position ] );
	return before !== after;
}


// The end of the longest tail of the prefix that occurs exactly once; -1 when none of it does.
function find_prefix_end( plain, prefix )
{
	for ( let length = prefix.length; length >= MIN_CONTEXT_MATCH; length-- )
	{
		let tail = prefix.slice( prefix.length - length );
		let index = plain.indexOf( tail );
		if ( index >= 0 && plain.indexOf( tail, index + 1 ) < 0 )
		{
			return index + length;
		}
	}
	return -1;
}


// The start of the longest head of the suffix that occurs exactly once after From; -1 when none does.
function find_suffix_start( plain, suffix, from )
{
	let search_from = ( from >= 0 ) ? from : 0;
	for ( let length = suffix.length; length >= MIN_CONTEXT_MATCH; length-- )
	{
		let head = suffix.slice( 0, length );
		let index = plain.indexOf( head, search_from );
		if ( index >= 0 && plain.indexOf( head, index + 1 ) < 0 )
		{
			return index;
		}
	}
	return -1;
}


//---------------------------------------------------------------------
// Similarity: Dice coefficient over the words of two texts, 0 to 1.

function Similarity( TextA, TextB )
{
	let words_a = words_of( TextA );
	let words_b = words_of( TextB );
	if ( words_a.size === 0 && words_b.size === 0 )
	{
		return 1;
	}
	let shared = 0;
	for ( let word of words_a )
	{
		if ( words_b.has( word ) )
		{
			shared++;
		}
	}
	return ( 2 * shared ) / ( words_a.size + words_b.size );
}


function words_of( text )
{
	let words = ( text || '' ).toLowerCase().split( /[^a-z0-9]+/ );
	let set = new Set();
	for ( let word of words )
	{
		if ( word )
		{
			set.add( word );
		}
	}
	return set;
}


//---------------------------------------------------------------------
// Refind: every thread's anchor against a new text. Returns [ { Id, Found, Detached } ].

function Refind( Threads, Markdown )
{
	let plain = PlainText( Markdown );
	let results = [];
	for ( let thread of Threads )
	{
		if ( !thread.Anchor )
		{
			results.push( { Id: thread.Id, Found: null, Detached: false } );
			continue;
		}
		let found = Find( plain, thread.Anchor );
		results.push( { Id: thread.Id, Found: found, Detached: ( found === null ) } );
	}
	return results;
}


module.exports = {
	PlainText: PlainText,
	Make: Make,
	Find: Find,
	Similarity: Similarity,
	Refind: Refind,
	CONTEXT_LENGTH: CONTEXT_LENGTH,
};
