'use strict';

// OpenAI - a chatgpt, gemini, grok or openai-compatible connection (plan Tool calls only, Step 2): OpenAI's chat
// completions as an adapter of the tool loop (Loop.js), which xAI, Google's OpenAI-compatible endpoint and the
// compatible services (Mistral, DeepSeek, Groq, OpenRouter, LM Studio, vLLM) speak too. The connection's Key goes in
// the Authorization header and nowhere else; a compatible service on the network may take none. The run's tools are
// already in this form; a call's arguments come as a JSON string; each result goes back as a tool message. The last
// round offers no tools, so the model answers in words.
//
//   ADAPTER(Label)                  the adapter Loop.Run takes, its Label the service's name in an error
//   Models( Llm ) -> { Url, Headers }    the request for the models the Key may use (GET), for the connection's Check
//   ModelNames( Json ) -> [ id ]         the ids in that answer ("models/" taken off, as Google writes them)

const LABELS = { 'chatgpt': 'ChatGPT', 'gemini': 'Gemini', 'grok': 'Grok', 'openai-compatible': 'The service' };


function base_of( llm )
{
	return String( llm.Url || '' ).replace( /\/+$/, '' );
}


function headers_of( llm )
{
	let headers = {};
	if ( llm.Key )
	{
		headers.Authorization = 'Bearer ' + llm.Key;
	}
	return headers;
}


function parse_arguments( text )
{
	if ( text && typeof text === 'object' )
	{
		return text;
	}
	try
	{
		let parsed = JSON.parse( String( text || '{}' ) );
		return ( parsed && typeof parsed === 'object' ) ? parsed : {};
	}
	catch ( error )
	{
		return {};
	}
}


//---------------------------------------------------------------------

function ADAPTER( Kind )
{
	return {
		Label: LABELS[ Kind ] || 'The service',

		First: function ( Prompt )
		{
			return [ { role: 'user', content: Prompt } ];
		},

		Request: function ( Llm, Messages, Definitions, Final )
		{
			let body = { model: Llm.Model, messages: Messages };
			if ( !Final && Definitions && Definitions.length )
			{
				body.tools = Definitions;
			}
			return { Url: base_of( Llm ) + '/chat/completions', Headers: headers_of( Llm ), Body: body };
		},

		Read: function ( Json )
		{
			let reply = Json || {};
			let choice = ( Array.isArray( reply.choices ) && reply.choices[ 0 ] ) ? reply.choices[ 0 ] : {};
			let message = choice.message || { role: 'assistant', content: '' };
			let calls = ( message.tool_calls || [] ).map( function ( call )
			{
				let named = call.function || {};
				return { Id: call.id, Name: named.name || '', Arguments: parse_arguments( named.arguments ) };
			} );
			let usage = reply.usage || {};
			return {
				Message: message,
				Text: String( message.content || '' ),
				Calls: calls,
				Usage: { Prompt: usage.prompt_tokens || 0, Answer: usage.completion_tokens || 0 },
			};
		},

		Results: function ( Calls )
		{
			return Calls.map( function ( call ) { return { role: 'tool', tool_call_id: call.Id, content: call.Result }; } );
		},

		User: function ( Text )
		{
			return { role: 'user', content: Text };
		},
	};
}


function Models( Llm )
{
	return { Url: base_of( Llm ) + '/models', Headers: headers_of( Llm ) };
}


function ModelNames( Json )
{
	return ( ( Json && Json.data ) || [] ).map( function ( model ) { return String( model.id || '' ).replace( /^models\//, '' ); } ).filter( function ( id ) { return id; } );
}


module.exports = {
	ADAPTER: ADAPTER,
	Models: Models,
	ModelNames: ModelNames,
};
