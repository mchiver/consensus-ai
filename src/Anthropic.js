'use strict';

// Anthropic - a claude connection (plan Tool calls only, Step 2): Anthropic's Messages API as an adapter of the tool
// loop (Loop.js). The connection's Key goes in the x-api-key header and nowhere else. The tools are sent in
// Anthropic's form (name, description, input_schema); a reply's text blocks are the model's words and its tool_use
// blocks the calls; the results go back in one user turn of tool_result blocks. The last round keeps the tools (a
// conversation that holds tool_use blocks needs them) and tells the model to call none.
//
//   ADAPTER                         the adapter Loop.Run takes (Label, First, Request, Read, Results, User)
//   Models( Llm ) -> { Url, Headers }    the request for the models the Key may use (GET), for the connection's Check
//   ModelNames( Json ) -> [ id ]         the ids in that answer

const VERSION = '2023-06-01';
const MAX_TOKENS = 8192;


function base_of( llm )
{
	return String( llm.Url || '' ).replace( /\/+$/, '' );
}


function headers_of( llm )
{
	let headers = { 'anthropic-version': VERSION };
	if ( llm.Key )
	{
		headers[ 'x-api-key' ] = llm.Key;
	}
	return headers;
}


function tools_of( definitions )
{
	return ( definitions || [] ).map( function ( definition )
	{
		let tool = definition.function || definition;
		return { name: tool.name, description: tool.description, input_schema: tool.parameters || { type: 'object', properties: {} } };
	} );
}


//---------------------------------------------------------------------

const ADAPTER = {
	Label: 'Claude',

	First: function ( Prompt )
	{
		return [ { role: 'user', content: Prompt } ];
	},

	Request: function ( Llm, Messages, Definitions, Final )
	{
		let body = { model: Llm.Model, max_tokens: MAX_TOKENS, messages: Messages };
		let tools = tools_of( Definitions );
		if ( tools.length )
		{
			body.tools = tools;
			if ( Final )
			{
				body.tool_choice = { type: 'none' };
			}
		}
		return { Url: base_of( Llm ) + '/messages', Headers: headers_of( Llm ), Body: body };
	},

	Read: function ( Json )
	{
		let reply = Json || {};
		let blocks = Array.isArray( reply.content ) ? reply.content : [];
		let text = blocks.filter( function ( block ) { return block.type === 'text'; } ).map( function ( block ) { return block.text || ''; } ).join( '\n\n' );
		let calls = blocks.filter( function ( block ) { return block.type === 'tool_use'; } ).map( function ( block )
		{
			return { Id: block.id, Name: block.name, Arguments: ( block.input && typeof block.input === 'object' ) ? block.input : {} };
		} );
		let usage = reply.usage || {};
		return {
			Message: { role: 'assistant', content: blocks },
			Text: text,
			Calls: calls,
			Usage: { Prompt: usage.input_tokens || 0, Answer: usage.output_tokens || 0 },
		};
	},

	Results: function ( Calls )
	{
		let content = Calls.map( function ( call ) { return { type: 'tool_result', tool_use_id: call.Id, content: call.Result }; } );
		return [ { role: 'user', content: content } ];
	},

	User: function ( Text )
	{
		return { role: 'user', content: Text };
	},
};


function Models( Llm )
{
	return { Url: base_of( Llm ) + '/models?limit=1000', Headers: headers_of( Llm ) };
}


function ModelNames( Json )
{
	return ( ( Json && Json.data ) || [] ).map( function ( model ) { return model.id; } ).filter( function ( id ) { return id; } );
}


module.exports = {
	ADAPTER: ADAPTER,
	Models: Models,
	ModelNames: ModelNames,
};
