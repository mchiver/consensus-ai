'use strict';

// Mcp - the plan tools as a small MCP server over stdio, for claude -p in a worker's job (plan Review): one JSON-RPC
// message per line in, one per line out. Written without a dependency: initialize, tools/list, tools/call and ping.
// Each call is passed to Consensus's tool route for the job, with the worker's token; Consensus answers it within
// the job's project. The worker writes the MCP config that starts it, with these in its env:
//
//   CONSENSUS_WORKER_URL     Consensus's address, e.g. http://cube4:3500
//   CONSENSUS_WORKER_TOKEN   the worker's token
//   CONSENSUS_WORKER_JOB     the job's id

const READLINE = require( 'readline' );

const PROTOCOL_VERSION = '2025-06-18';
const CALL_TIMEOUT = 60000;

const TOOLS = [
	{
		name: 'list_project',
		description: 'The project\'s plans, documents and corpora in Consensus, with their ids and states.',
		inputSchema: { type: 'object', properties: {} },
	},
	{
		name: 'read_plan',
		description: 'A plan or document\'s whole text, by its id or title.',
		inputSchema: { type: 'object', properties: { Plan: { type: 'string', description: 'the plan\'s id or title' } }, required: [ 'Plan' ] },
	},
	{
		name: 'read_revision',
		description: 'An older revision of a plan or document, by its id or title and the revision\'s number.',
		inputSchema: { type: 'object', properties: { Plan: { type: 'string' }, Revision: { type: 'integer' } }, required: [ 'Plan', 'Revision' ] },
	},
	{
		name: 'search',
		description: 'The best passages in the project\'s plans, documents, threads and attached zips for some words.',
		inputSchema: { type: 'object', properties: { Query: { type: 'string' } }, required: [ 'Query' ] },
	},
];


//---------------------------------------------------------------------
// Serve( { Url, Token, Job, Input?, Output? } ): answers until Input ends. Input and Output default to stdin and
// stdout.

function Serve( Options )
{
	let input = Options.Input || process.stdin;
	let output = Options.Output || process.stdout;
	let lines = READLINE.createInterface( { input: input, crlfDelay: Infinity } );

	function send( message )
	{
		output.write( JSON.stringify( message ) + '\n' );
	}

	lines.on( 'line', function ( line )
	{
		if ( !line.trim() )
		{
			return;
		}
		let message = null;
		try
		{
			message = JSON.parse( line );
		}
		catch ( error )
		{
			send( { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'not JSON' } } );
			return;
		}
		answer( message ).then( function ( reply )
		{
			if ( reply )
			{
				send( reply );
			}
		} );
	} );

	return new Promise( function ( resolve ) { lines.on( 'close', resolve ); } );


	// The reply to one message; none for a notification.
	async function answer( message )
	{
		let has_id = message.id !== undefined && message.id !== null;
		if ( !has_id )
		{
			return null;
		}
		let method = message.method;
		if ( method === 'initialize' )
		{
			let asked = message.params && message.params.protocolVersion;
			return result( message, {
				protocolVersion: asked || PROTOCOL_VERSION,
				capabilities: { tools: {} },
				serverInfo: { name: 'consensus', version: '1.0.0' },
			} );
		}
		if ( method === 'ping' )
		{
			return result( message, {} );
		}
		if ( method === 'tools/list' )
		{
			return result( message, { tools: TOOLS } );
		}
		if ( method === 'tools/call' )
		{
			let params = message.params || {};
			let tool = TOOLS.find( function ( candidate ) { return candidate.name === params.name; } );
			if ( !tool )
			{
				return result( message, { content: [ { type: 'text', text: 'no tool ' + params.name } ], isError: true } );
			}
			try
			{
				let text = await call_tool( Options, tool.name, params.arguments || {} );
				return result( message, { content: [ { type: 'text', text: text } ] } );
			}
			catch ( error )
			{
				return result( message, { content: [ { type: 'text', text: error.message } ], isError: true } );
			}
		}
		return { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'no method ' + method } };
	}
}


function result( message, value )
{
	return { jsonrpc: '2.0', id: message.id, result: value };
}


// One plan tool, answered by Consensus for the job.
async function call_tool( Options, name, input )
{
	let body = Object.assign( {}, input, { Tool: name } );
	let url = String( Options.Url ).replace( /\/+$/, '' ) + '/api/workers/jobs/' + encodeURIComponent( Options.Job ) + '/tool';
	let response = await fetch( url, {
		method: 'POST',
		headers: { 'Authorization': 'Bearer ' + Options.Token, 'Content-Type': 'application/json' },
		body: JSON.stringify( body ),
		signal: AbortSignal.timeout( CALL_TIMEOUT ),
	} );
	let json = await response.json().catch( function () { return {}; } );
	if ( !response.ok )
	{
		throw new Error( 'Consensus refused the tool: ' + ( json.Error || response.status ) );
	}
	return String( json.Result );
}


module.exports = {
	TOOLS: TOOLS,
	Serve: Serve,
};
