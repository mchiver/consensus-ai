'use strict';

// ContextServers - Consensus's side of the context servers (src/ContextServer.js) listed in consensus.json:
//
//   "ContextServers": [ { "Name": "Workstation", "Url": "http://127.0.0.1:3600", "Token": "…" } ]
//
// Each server's Corpus and Inference items are asked for at start and on Refresh, and kept; a server that does not
// answer is offline until the next Refresh, and nothing else breaks. The tokens never leave this module.

const LIST_TIMEOUT = 3000;
const READ_TIMEOUT = 15000;


//---------------------------------------------------------------------
// Validate: the problems with the settings' ContextServers, as sentences.

function Validate( Settings )
{
	let problems = [];
	let servers = Settings ? Settings.ContextServers : undefined;
	if ( servers === undefined )
	{
		return problems;
	}
	if ( !Array.isArray( servers ) )
	{
		return [ 'ContextServers must be a list' ];
	}
	let names = new Set();
	for ( let server of servers )
	{
		if ( !server || typeof server.Name !== 'string' || !server.Name.trim() )
		{
			problems.push( 'a context server has no Name' );
			continue;
		}
		if ( names.has( server.Name ) )
		{
			problems.push( 'context server "' + server.Name + '" is named twice' );
		}
		names.add( server.Name );
		if ( typeof server.Url !== 'string' || !/^https?:\/\//.test( server.Url ) )
		{
			problems.push( 'context server "' + server.Name + '" needs a Url starting with http:// or https://' );
		}
		if ( typeof server.Token !== 'string' || !server.Token )
		{
			problems.push( 'context server "' + server.Name + '" needs its Token' );
		}
	}
	return problems;
}


//---------------------------------------------------------------------
// Open( Settings ) -> { List, Refresh, Has, Files, ReadFile, Search, Models, Infer }

function Open( Settings )
{
	let servers = ( Settings && Settings.ContextServers ) || [];
	let known = {};
	for ( let server of servers )
	{
		known[ server.Name ] = { Name: server.Name, Url: server.Url, Online: false, Error: 'not asked yet', Corpus: [], Inference: [] };
	}


	function server_named( name )
	{
		let server = servers.find( function ( candidate ) { return candidate.Name === name; } );
		if ( !server )
		{
			throw new Error( 'no context server is named "' + name + '" in consensus.json' );
		}
		return server;
	}


	// One request to a server; its JSON answer, or an error naming the server.
	async function ask( name, method, path, body, timeout )
	{
		let server = server_named( name );
		let url = String( server.Url ).replace( /\/+$/, '' ) + path;
		let response = null;
		try
		{
			response = await fetch( url, {
				method: method,
				headers: { 'Authorization': 'Bearer ' + server.Token, 'Content-Type': 'application/json' },
				body: body ? JSON.stringify( body ) : undefined,
				signal: AbortSignal.timeout( timeout || READ_TIMEOUT ),
			} );
		}
		catch ( error )
		{
			throw new Error( 'context server "' + name + '" did not answer: ' + error.message );
		}
		let json = null;
		try
		{
			json = await response.json();
		}
		catch ( error )
		{
			json = {};
		}
		if ( !response.ok )
		{
			throw new Error( 'context server "' + name + '": ' + ( json.Error || response.status ) );
		}
		return json;
	}


	// What each server offers, as last heard: [ { Name, Url, Online, Error?, Corpus: [ { Name, Files, Indexed } ], Inference: [ { Name, Type, Model } ] } ]
	function List()
	{
		return servers.map( function ( server ) { return known[ server.Name ]; } );
	}


	async function Refresh()
	{
		await Promise.all( servers.map( async function ( server )
		{
			try
			{
				let items = await ask( server.Name, 'GET', '/api/items', null, LIST_TIMEOUT );
				known[ server.Name ] = { Name: server.Name, Url: server.Url, Online: true, Corpus: items.Corpus || [], Inference: items.Inference || [] };
			}
			catch ( error )
			{
				known[ server.Name ] = { Name: server.Name, Url: server.Url, Online: false, Error: error.message, Corpus: [], Inference: [] };
			}
		} ) );
		return List();
	}


	// The corpus item as last heard, or null.
	function Has( Server, Corpus )
	{
		let server = known[ Server ];
		return server ? ( server.Corpus.find( function ( item ) { return item.Name === Corpus; } ) || null ) : null;
	}


	function path_of( Corpus )
	{
		return '/api/corpus/' + encodeURIComponent( Corpus );
	}


	async function Files( Server, Corpus )
	{
		return ( await ask( Server, 'GET', path_of( Corpus ) ) ).Files || [];
	}


	async function ReadFile( Server, Corpus, Path )
	{
		return ( await ask( Server, 'GET', path_of( Corpus ) + '/file?path=' + encodeURIComponent( Path ) ) ).Text;
	}


	async function Search( Server, Corpus, Query, Limit )
	{
		let path = path_of( Corpus ) + '/search?q=' + encodeURIComponent( Query ) + '&limit=' + ( Limit || 10 );
		return ( await ask( Server, 'GET', path ) ).Hits || [];
	}


	async function Models( Server, Inference )
	{
		return ( await ask( Server, 'GET', '/api/inference/' + encodeURIComponent( Inference ) + '/models' ) ).Models || [];
	}


	// A prompt passed through the server's Inference item: { Answer, Usage }, as Llm.Caller answers.
	async function Infer( Server, Inference, Prompt, Model, TimeoutSeconds )
	{
		let body = { Prompt: Prompt };
		if ( Model )
		{
			body.Model = Model;
		}
		return await ask( Server, 'POST', '/api/inference/' + encodeURIComponent( Inference ), body, ( TimeoutSeconds || 600 ) * 1000 + 5000 );
	}


	return { List: List, Refresh: Refresh, Has: Has, Files: Files, ReadFile: ReadFile, Search: Search, Models: Models, Infer: Infer };
}


module.exports = {
	Validate: Validate,
	Open: Open,
};
