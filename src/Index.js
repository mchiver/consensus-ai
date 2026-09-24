'use strict';

// Index - our own lexical embedding: chunks of every proposal and thread, weighted by BM25.
// Pure functions over chunks; no model and no dependency.

const CRYPTO = require( 'crypto' );

const BM25_K1 = 1.2;
const BM25_B = 0.75;
const CHUNK_TARGET_LENGTH = 600;

const STOP_WORDS = new Set( [
	'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'else', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with',
	'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'it', 'its', 'this', 'that', 'these', 'those', 'there',
	'here', 'from', 'into', 'than', 'so', 'not', 'no', 'nor', 'do', 'does', 'did', 'has', 'have', 'had', 'he', 'she',
	'they', 'them', 'his', 'her', 'their', 'we', 'our', 'you', 'your', 'i', 'me', 'my', 'what', 'which', 'who',
	'whom', 'when', 'where', 'how', 'why', 'can', 'could', 'would', 'should', 'will', 'shall', 'may', 'might',
	'also', 'any', 'all', 'each', 'every', 'some', 'such', 'only', 'own', 'same', 'other', 'more', 'most', 'very',
	'just', 'about', 'over', 'under', 'up', 'down', 'out', 'off', 'again', 'once', 'one', 'two', 'both', 'either',
	'while', 'until', 'after', 'before', 'through', 'between', 'because', 'via', 'per', 's', 't',
] );


//---------------------------------------------------------------------
// Tokens: lowercase words, stop words dropped, lightly stemmed.

function Tokens( Text )
{
	let words = ( Text || '' ).toLowerCase().split( /[^a-z0-9]+/ );
	let tokens = [];
	for ( let word of words )
	{
		if ( !word || STOP_WORDS.has( word ) )
		{
			continue;
		}
		tokens.push( Stem( word ) );
	}
	return tokens;
}


// A handful of suffix rules, so that resolve, resolves, resolved and resolving meet.
function Stem( Word )
{
	let word = Word;
	if ( word.length <= 3 )
	{
		return word;
	}
	if ( word.endsWith( 'ies' ) )
	{
		word = word.slice( 0, -3 ) + 'i';
	}
	else if ( word.endsWith( 'sses' ) )
	{
		word = word.slice( 0, -2 );
	}
	else if ( word.endsWith( 's' ) && !word.endsWith( 'ss' ) && !word.endsWith( 'us' ) )
	{
		word = word.slice( 0, -1 );
	}
	if ( word.endsWith( 'ing' ) && word.length > 5 )
	{
		word = undouble( word.slice( 0, -3 ) );
	}
	else if ( word.endsWith( 'ed' ) && word.length > 5 )
	{
		word = undouble( word.slice( 0, -2 ) );
	}
	else if ( word.endsWith( 'ly' ) && word.length > 5 )
	{
		word = word.slice( 0, -2 );
	}
	if ( word.endsWith( 'e' ) && word.length > 3 )
	{
		word = word.slice( 0, -1 );
	}
	if ( word.endsWith( 'y' ) && word.length > 3 )
	{
		word = word.slice( 0, -1 ) + 'i';
	}
	return word;
}


// A doubled final consonant left by stripping a suffix becomes one: embedd -> embed, planned -> plan.
function undouble( word )
{
	let last = word[ word.length - 1 ];
	if ( word.length > 3 && last === word[ word.length - 2 ] && 'bdgmnprt'.includes( last ) )
	{
		return word.slice( 0, -1 );
	}
	return word;
}


//---------------------------------------------------------------------
// Hash: a short fingerprint of a chunk's text, so only changed chunks are re-weighed.

function Hash( Text )
{
	return CRYPTO.createHash( 'sha1' ).update( Text || '', 'utf8' ).digest( 'hex' ).slice( 0, 16 );
}


//---------------------------------------------------------------------
// Chunk: a proposal's text by paragraph (a heading and the short paragraphs under it as one chunk),
// and each thread as one chunk (its anchor words plus its replies).

function Chunk( Proposal, Text, Threads )
{
	let chunks = [];
	let paragraphs = split_paragraphs( Text || '' );
	let current = null;
	let index = 0;
	for ( let paragraph of paragraphs )
	{
		let is_heading = /^#{1,6}\s/.test( paragraph );
		let fits = current && current.Heading && !is_heading && ( current.Text.length + paragraph.length ) <= CHUNK_TARGET_LENGTH;
		if ( fits )
		{
			current.Text += '\n\n' + paragraph;
			continue;
		}
		if ( current )
		{
			delete current.Heading;
			chunks.push( current );
		}
		index++;
		current = { Chunk: index, Proposal: Proposal.Id, Revision: Proposal.Revision, Text: paragraph, Heading: is_heading };
	}
	if ( current )
	{
		delete current.Heading;
		chunks.push( current );
	}
	for ( let thread of ( Threads || [] ) )
	{
		let parts = [];
		if ( thread.Anchor && thread.Anchor.Text )
		{
			parts.push( thread.Anchor.Text );
		}
		for ( let reply of ( thread.Replies || [] ) )
		{
			parts.push( reply.Text );
		}
		index++;
		chunks.push( { Chunk: index, Proposal: Proposal.Id, Revision: Proposal.Revision, Thread: thread.Id, Text: parts.join( '\n\n' ) } );
	}
	for ( let chunk of chunks )
	{
		chunk.Hash = Hash( chunk.Text );
	}
	return chunks;
}


function split_paragraphs( text )
{
	let paragraphs = [];
	for ( let block of text.split( /\n\s*\n/ ) )
	{
		let trimmed = block.trim();
		if ( trimmed )
		{
			paragraphs.push( trimmed );
		}
	}
	return paragraphs;
}


//---------------------------------------------------------------------
// Weigh: BM25 term weights for every chunk, across the whole corpus. Sets chunk.Terms and returns the chunks.

function Weigh( Chunks )
{
	let token_lists = [];
	let document_frequency = {};
	let total_length = 0;
	for ( let chunk of Chunks )
	{
		let tokens = Tokens( chunk.Text );
		token_lists.push( tokens );
		total_length += tokens.length;
		let seen = new Set( tokens );
		for ( let term of seen )
		{
			document_frequency[ term ] = ( document_frequency[ term ] || 0 ) + 1;
		}
	}
	let chunk_count = Chunks.length;
	let average_length = chunk_count ? ( total_length / chunk_count ) : 0;
	for ( let index = 0; index < Chunks.length; index++ )
	{
		let tokens = token_lists[ index ];
		let counts = {};
		for ( let term of tokens )
		{
			counts[ term ] = ( counts[ term ] || 0 ) + 1;
		}
		let terms = {};
		let length_ratio = average_length ? ( tokens.length / average_length ) : 1;
		for ( let term of Object.keys( counts ) )
		{
			let frequency = counts[ term ];
			let idf = Math.log( 1 + ( chunk_count - document_frequency[ term ] + 0.5 ) / ( document_frequency[ term ] + 0.5 ) );
			let saturation = ( frequency * ( BM25_K1 + 1 ) ) / ( frequency + BM25_K1 * ( 1 - BM25_B + BM25_B * length_ratio ) );
			terms[ term ] = round( idf * saturation );
		}
		Chunks[ index ].Terms = terms;
	}
	return Chunks;
}


function round( value )
{
	return Math.round( value * 10000 ) / 10000;
}


//---------------------------------------------------------------------
// Search: the best chunks for a question, by the sum of shared term weights.

function Search( Query, Chunks, Limit )
{
	let query_terms = Tokens( Query );
	let hits = [];
	for ( let chunk of Chunks )
	{
		let score = 0;
		for ( let term of query_terms )
		{
			if ( chunk.Terms && chunk.Terms[ term ] )
			{
				score += chunk.Terms[ term ];
			}
		}
		if ( score > 0 )
		{
			hits.push( { Proposal: chunk.Proposal, Revision: chunk.Revision, Chunk: chunk.Chunk, Thread: chunk.Thread || null, Text: chunk.Text, Score: round( score ) } );
		}
	}
	hits.sort( by_score );
	return hits.slice( 0, Limit || 10 );
}


function by_score( a, b )
{
	return b.Score - a.Score;
}


//---------------------------------------------------------------------
// Refresh: a proposal's index.json after a change. Only chunks whose text changed are re-embedded;
// the rest keep their vector. Term weights are not stored: they depend on the whole corpus and are
// computed at search time, which takes milliseconds at this size.

async function Refresh( Store, Id, Embedder )
{
	let read = await Store.ReadProposal( Id );
	if ( !read )
	{
		return null;
	}
	let chunks = Chunk( read.Proposal, read.Text, read.Threads );
	let previous = await Store.ReadIndex( Id );
	let vectors_by_hash = {};
	for ( let chunk of previous )
	{
		if ( chunk.Vector )
		{
			vectors_by_hash[ chunk.Hash ] = chunk.Vector;
		}
	}
	for ( let chunk of chunks )
	{
		if ( vectors_by_hash[ chunk.Hash ] )
		{
			chunk.Vector = vectors_by_hash[ chunk.Hash ];
		}
	}
	if ( Embedder )
	{
		let missing = chunks.filter( function ( chunk ) { return !chunk.Vector; } );
		if ( missing.length )
		{
			try
			{
				let vectors = await Embedder.Embed( missing.map( function ( chunk ) { return chunk.Text; } ) );
				for ( let index = 0; index < missing.length; index++ )
				{
					missing[ index ].Vector = vectors[ index ];
				}
			}
			catch ( error )
			{
				console.error( 'index: no vectors for ' + Id + ': ' + error.message );
			}
		}
	}
	await Store.WriteIndex( Id, chunks );
	return chunks;
}


//---------------------------------------------------------------------
// Corpus: every proposal's chunks, weighed together.

async function Corpus( Store )
{
	let chunks = [];
	for ( let proposal of await Store.ListProposals() )
	{
		chunks = chunks.concat( await Store.ReadIndex( proposal.Id ) );
	}
	return Weigh( chunks );
}


//---------------------------------------------------------------------
// SearchAll: the best chunks across proposals. With an embedder and vectors in the corpus, the cosine
// ranking is merged with ours by rank; without, the lexical ranking answers alone.

async function SearchAll( Store, Query, Limit, Embedder )
{
	let VECTORS = require( './Vectors.js' );
	let limit = Limit || 10;
	let chunks = await Corpus( Store );
	let by_key = {};
	for ( let chunk of chunks )
	{
		by_key[ key_of( chunk ) ] = chunk;
	}
	let lexical = Search( Query, chunks, limit * 3 );
	let vector_keys = [];
	let has_vectors = chunks.some( function ( chunk ) { return !!chunk.Vector; } );
	if ( Embedder && has_vectors )
	{
		try
		{
			let query_vector = ( await Embedder.Embed( [ Query ] ) )[ 0 ];
			let scored = chunks.filter( function ( chunk ) { return !!chunk.Vector; } ).map( function ( chunk )
			{
				return { Key: key_of( chunk ), Score: VECTORS.Cosine( query_vector, chunk.Vector ) };
			} );
			scored.sort( function ( a, b ) { return b.Score - a.Score; } );
			vector_keys = scored.slice( 0, limit * 3 ).map( function ( hit ) { return hit.Key; } );
		}
		catch ( error )
		{
			console.error( 'search: no vectors for the query: ' + error.message );
		}
	}
	let hits = [];
	if ( vector_keys.length )
	{
		let merged = VECTORS.Merge( lexical.map( key_of ), vector_keys );
		for ( let entry of merged.slice( 0, limit ) )
		{
			hits.push( present( by_key[ entry.Key ], round( entry.Score * 100 ) ) );
		}
	}
	else
	{
		for ( let hit of lexical.slice( 0, limit ) )
		{
			hits.push( hit );
		}
	}
	return hits;
}


function key_of( chunk )
{
	return chunk.Proposal + '#' + chunk.Chunk;
}


function present( chunk, score )
{
	return { Proposal: chunk.Proposal, Revision: chunk.Revision, Chunk: chunk.Chunk, Thread: chunk.Thread || null, Text: chunk.Text, Score: score };
}


module.exports = {
	Tokens: Tokens,
	Stem: Stem,
	Hash: Hash,
	Chunk: Chunk,
	Weigh: Weigh,
	Search: Search,
	Refresh: Refresh,
	Corpus: Corpus,
	SearchAll: SearchAll,
};
