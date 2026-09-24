'use strict';

// Vectors - the optional upgrade to our own index: embeddings from Ollama over fetch, a cosine score,
// and a rank fusion that merges them with the lexical search. Absent settings mean none of it runs.
//
//   consensus.json: "Embedding": { "Url": "http://127.0.0.1:11434", "Model": "nomic-embed-text" }

const RANK_CONSTANT = 60;
const EMBED_BATCH = 16;


//---------------------------------------------------------------------
// Embedder: null when the settings name no model; otherwise { Url, Model, Embed( Texts ) }.

function Embedder( Settings )
{
	let embedding = Settings && Settings.Embedding;
	if ( !embedding || !embedding.Url || !embedding.Model )
	{
		return null;
	}
	let url = String( embedding.Url ).replace( /\/+$/, '' ) + '/api/embed';
	let model = embedding.Model;


	// One vector per text, in order. Throws when Ollama is unreachable or refuses; the caller logs and goes on.
	async function Embed( Texts )
	{
		let vectors = [];
		for ( let start = 0; start < Texts.length; start += EMBED_BATCH )
		{
			let batch = Texts.slice( start, start + EMBED_BATCH );
			let response = await fetch( url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify( { model: model, input: batch } ),
			} );
			if ( !response.ok )
			{
				throw new Error( 'embedding refused by ' + url + ': ' + response.status + ' ' + ( await response.text() ).slice( 0, 200 ) );
			}
			let json = await response.json();
			if ( !json.embeddings || json.embeddings.length !== batch.length )
			{
				throw new Error( 'embedding answered ' + ( json.embeddings ? json.embeddings.length : 0 ) + ' vectors for ' + batch.length + ' texts' );
			}
			vectors = vectors.concat( json.embeddings );
		}
		return vectors;
	}


	return { Url: embedding.Url, Model: model, Embed: Embed };
}


//---------------------------------------------------------------------
// Cosine: the similarity of two vectors, 0 when either is empty.

function Cosine( A, B )
{
	if ( !A || !B || A.length === 0 || A.length !== B.length )
	{
		return 0;
	}
	let dot = 0;
	let norm_a = 0;
	let norm_b = 0;
	for ( let index = 0; index < A.length; index++ )
	{
		dot += A[ index ] * B[ index ];
		norm_a += A[ index ] * A[ index ];
		norm_b += B[ index ] * B[ index ];
	}
	let norm = Math.sqrt( norm_a ) * Math.sqrt( norm_b );
	return norm ? ( dot / norm ) : 0;
}


//---------------------------------------------------------------------
// Merge: reciprocal rank fusion of two ranked lists of keys. Returns [ { Key, Score } ] best first.

function Merge( KeysA, KeysB )
{
	let scores = {};
	for ( let list of [ KeysA || [], KeysB || [] ] )
	{
		for ( let index = 0; index < list.length; index++ )
		{
			scores[ list[ index ] ] = ( scores[ list[ index ] ] || 0 ) + 1 / ( RANK_CONSTANT + index + 1 );
		}
	}
	let merged = Object.keys( scores ).map( function ( key ) { return { Key: key, Score: scores[ key ] }; } );
	merged.sort( function ( a, b ) { return b.Score - a.Score; } );
	return merged;
}


module.exports = {
	Embedder: Embedder,
	Cosine: Cosine,
	Merge: Merge,
};
