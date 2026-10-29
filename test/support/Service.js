'use strict';

// A stand-in for a hosted model's API (plan Tool calls only, Step 2): an HTTP server on 127.0.0.1 that speaks OpenAI's
// chat completions or Anthropic's Messages, answering each request from a script and keeping what it was sent, so
// the tests and the smoke run an API connection end to end with no service and no key of ours.
//
//   Start( { Format: 'openai' | 'anthropic', Key?, Models?, Script } ) -> promise of { Url, Requests, Headers, Close() }
//     Url       the base a connection takes, ending /v1
//     Key       the key a request must carry (Authorization: Bearer <key>, or x-api-key); a wrong or missing one
//               answers 401; none given takes any
//     Models    the ids GET /v1/models lists
//     Script    one entry per model request, in order: { content?, calls?: [ [ name, arguments ] ], delay?, status?, text? };
//               status answers that status with text; past its end the answer is "nothing scripted"
//     Requests  the bodies of the model requests, parsed; Headers their headers

const HTTP = require( 'http' );


function key_of( format, request )
{
	if ( format === 'anthropic' )
	{
		return request.headers[ 'x-api-key' ] || '';
	}
	let match = /^Bearer\s+(.+)$/i.exec( request.headers.authorization || '' );
	return match ? match[ 1 ].trim() : '';
}


function openai_reply( entry, body, index )
{
	let message = { role: 'assistant', content: entry.content || null };
	if ( entry.calls )
	{
		message.tool_calls = entry.calls.map( function ( call, number )
		{
			return { id: 'call_' + index + '_' + number, type: 'function', function: { name: call[ 0 ], arguments: JSON.stringify( call[ 1 ] ) } };
		} );
	}
	return { id: 'chatcmpl-' + index, model: body.model, choices: [ { index: 0, message: message, finish_reason: entry.calls ? 'tool_calls' : 'stop' } ], usage: { prompt_tokens: 10, completion_tokens: 5 } };
}


function anthropic_reply( entry, body, index )
{
	let content = [];
	if ( entry.content )
	{
		content.push( { type: 'text', text: entry.content } );
	}
	for ( let number = 0; number < ( entry.calls || [] ).length; number++ )
	{
		let call = entry.calls[ number ];
		content.push( { type: 'tool_use', id: 'toolu_' + index + '_' + number, name: call[ 0 ], input: call[ 1 ] } );
	}
	return { id: 'msg_' + index, type: 'message', role: 'assistant', model: body.model, content: content, stop_reason: entry.calls ? 'tool_use' : 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } };
}


function Start( Options )
{
	let options = Options || {};
	let format = options.Format || 'openai';
	let script = options.Script || [];
	let requests = [];
	let headers = [];
	let server = HTTP.createServer( function ( request, response )
	{
		let text = '';
		request.on( 'data', function ( chunk ) { text += chunk; } );
		request.on( 'end', function ()
		{
			function send( status, json )
			{
				response.writeHead( status, { 'Content-Type': 'application/json' } );
				response.end( JSON.stringify( json ) );
			}
			if ( options.Key && key_of( format, request ) !== options.Key )
			{
				return send( 401, { error: { message: 'invalid api key' } } );
			}
			let path = request.url.split( '?' )[ 0 ];
			if ( request.method === 'GET' && path === '/v1/models' )
			{
				return send( 200, { data: ( options.Models || [] ).map( function ( id ) { return { id: id }; } ) } );
			}
			let wanted = ( format === 'anthropic' ) ? '/v1/messages' : '/v1/chat/completions';
			if ( request.method !== 'POST' || path !== wanted )
			{
				return send( 404, { error: { message: 'no such route ' + request.method + ' ' + path } } );
			}
			let body = JSON.parse( text || '{}' );
			requests.push( body );
			headers.push( request.headers );
			let index = requests.length;
			let entry = script[ index - 1 ] || { content: 'nothing scripted' };
			setTimeout( function ()
			{
				if ( entry.status )
				{
					response.writeHead( entry.status, { 'Content-Type': 'text/plain' } );
					response.end( entry.text || 'no' );
					return;
				}
				send( 200, ( format === 'anthropic' ) ? anthropic_reply( entry, body, index ) : openai_reply( entry, body, index ) );
			}, entry.delay || 0 );
		} );
	} );
	return new Promise( function ( resolve )
	{
		server.listen( 0, '127.0.0.1', function ()
		{
			resolve( {
				Url: 'http://127.0.0.1:' + server.address().port + '/v1',
				Requests: requests,
				Headers: headers,
				Close: function () { return new Promise( function ( done ) { server.closeAllConnections(); server.close( done ); } ); },
			} );
		} );
	} );
}


module.exports = {
	Start: Start,
};
