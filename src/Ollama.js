'use strict';

// Ollama - a one-shot through a local model (plan Consensus Desktop, Step 4): Ollama's chat endpoint as an adapter of
// the tool loop (plan Tool calls only, Step 1: Loop.js runs the rounds, the tools and the transcript). One request per
// round, stream off, the connection's Context as the model's window (num_ctx); the tools in the form the run's tools
// already have, a call's arguments an object or a JSON string, a result sent back as a tool message.
//
//   ADAPTER                         the adapter Loop.Run takes (Label, First, Request, Read, Results, User)
//   Run( { Llm: { Url, Model, Timeout, Rounds, Context }, Prompt, Tools, Signal?, OnProgress? } )
//     -> { Answer, Rounds, Usage: { Prompt, Answer } }: Loop.Run with this adapter
//   Render( Entries ) -> markdown: Loop.Render

const LLMS = require( './Llms.js' );
const LOOP = require( './Loop.js' );


function endpoint( llm )
{
	return String( llm.Url || LLMS.DEFAULT_OLLAMA_URL ).replace( /\/+$/, '' ) + '/api/chat';
}


function parse_arguments( call )
{
	let input = call.function ? call.function.arguments : {};
	if ( typeof input === 'string' )
	{
		try
		{
			input = JSON.parse( input );
		}
		catch ( error )
		{
			input = {};
		}
	}
	return ( input && typeof input === 'object' ) ? input : {};
}


//---------------------------------------------------------------------

const ADAPTER = {
	Label: 'Ollama',

	First: function ( Prompt )
	{
		return [ { role: 'user', content: Prompt } ];
	},

	Request: function ( Llm, Messages, Definitions )
	{
		let body = { model: Llm.Model, messages: Messages, stream: false, options: { num_ctx: Llm.Context || LLMS.DEFAULT_CONTEXT } };
		if ( Definitions && Definitions.length )
		{
			body.tools = Definitions;
		}
		return { Url: endpoint( Llm ), Headers: {}, Body: body };
	},

	Read: function ( Json )
	{
		let reply = Json || {};
		let message = reply.message || { role: 'assistant', content: '' };
		let calls = ( message.tool_calls || [] ).map( function ( call )
		{
			return { Id: null, Name: call.function ? call.function.name : '', Arguments: parse_arguments( call ) };
		} );
		return {
			Message: message,
			Text: String( message.content || '' ),
			Calls: calls,
			Usage: { Prompt: reply.prompt_eval_count || 0, Answer: reply.eval_count || 0 },
		};
	},

	Results: function ( Calls )
	{
		return Calls.map( function ( call ) { return { role: 'tool', content: call.Result, tool_name: call.Name }; } );
	},

	User: function ( Text )
	{
		return { role: 'user', content: Text };
	},
};


async function Run( Request )
{
	return await LOOP.Run( Object.assign( {}, Request, { Adapter: ADAPTER } ) );
}


module.exports = {
	ADAPTER: ADAPTER,
	RESULT_LIMIT: LOOP.RESULT_LIMIT,
	Run: Run,
	Render: LOOP.Render,
};
