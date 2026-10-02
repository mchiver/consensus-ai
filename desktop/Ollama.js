'use strict';

// Ollama - a one-shot through a local model (plan Consensus Desktop, Step 4): the tool loop over Ollama's chat
// endpoint. One request per round, the package as the first message and the connection's tools offered; each call
// the model makes is run by Tools.js and its result sent back; the model's text without a call is the answer. The
// connection's Timeout is the deadline of the whole run, its Rounds the most requests made, and its Context the
// model's window (num_ctx). Nothing streams: the transcript grows an entry at a time through OnProgress.
//
//   Run( { Llm: { Url, Model, Timeout, Rounds, Context }, Prompt, Tools, Signal?, OnProgress? } )
//     -> { Answer, Rounds, Usage: { Prompt, Answer } }
//   OnProgress( entry ): an entry of the transcript, in order:
//     { Round, Kind: 'text', Text }                                              what the model said in a round
//     { Round, Kind: 'call', Name, Arguments, Described, Result, Duration }      a tool call and its whole result
//     { Round, Kind: 'answer', Text, Nudged }                                    the answer (Nudged: asked for after the rounds)
//   Render( Entries ) -> markdown: a heading per round, the text, each call in bold with its result fenced (clipped
//     to RESULT_LIMIT), the answer under its own heading; what the run's Output holds.
//   A refusal, a timeout, an abort or the rounds running out throws an Error whose message says which.

const SETTINGS = require( './Settings.js' );

const ANSWER_NUDGE = 'You have used every round you had. Answer now, in words, with no tool call.';
const RESULT_KEPT = 50000;
const RESULT_LIMIT = 2000;


function endpoint( llm )
{
	return String( llm.Url || SETTINGS.DEFAULT_OLLAMA_URL ).replace( /\/+$/, '' ) + '/api/chat';
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

async function Run( Request )
{
	let request = Request || {};
	let llm = request.Llm || {};
	let tools = request.Tools;
	let progress = ( typeof request.OnProgress === 'function' ) ? request.OnProgress : function () {};
	let timeout = ( llm.Timeout || SETTINGS.DEFAULT_TIMEOUT ) * 1000;
	let deadline = Date.now() + timeout;
	let rounds_allowed = llm.Rounds || SETTINGS.DEFAULT_ROUNDS;
	let messages = [ { role: 'user', content: String( request.Prompt || '' ) } ];
	let usage = { Prompt: 0, Answer: 0 };
	let rounds = 0;
	let definitions = tools ? tools.Definitions : [];


	async function chat( body )
	{
		let left = deadline - Date.now();
		if ( left <= 0 )
		{
			throw new Error( 'Ollama took longer than ' + ( timeout / 1000 ) + ' seconds' );
		}
		let signals = [ AbortSignal.timeout( left ) ];
		if ( request.Signal )
		{
			signals.push( request.Signal );
		}
		let response = null;
		try
		{
			response = await fetch( endpoint( llm ), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify( body ),
				signal: AbortSignal.any( signals ),
			} );
		}
		catch ( error )
		{
			if ( request.Signal && request.Signal.aborted )
			{
				throw new Error( 'stopped' );
			}
			if ( error.name === 'TimeoutError' || error.name === 'AbortError' )
			{
				throw new Error( 'Ollama took longer than ' + ( timeout / 1000 ) + ' seconds' );
			}
			throw new Error( 'Ollama at ' + llm.Url + ' did not answer: ' + error.message );
		}
		if ( !response.ok )
		{
			let said = await response.text().catch( function () { return ''; } );
			throw new Error( 'Ollama refused: ' + response.status + ' ' + said.slice( 0, 300 ).trim() );
		}
		let reply = await response.json();
		usage.Prompt += reply.prompt_eval_count || 0;
		usage.Answer += reply.eval_count || 0;
		return reply;
	}


	function body_of( offered )
	{
		let body = { model: llm.Model, messages: messages, stream: false, options: { num_ctx: llm.Context || SETTINGS.DEFAULT_CONTEXT } };
		if ( offered && offered.length )
		{
			body.tools = offered;
		}
		return body;
	}


	while ( rounds < rounds_allowed )
	{
		rounds++;
		let reply = await chat( body_of( definitions ) );
		let message = reply.message || { role: 'assistant', content: '' };
		messages.push( message );
		let calls = message.tool_calls || [];
		if ( !calls.length )
		{
			progress( { Round: rounds, Kind: 'answer', Text: String( message.content || '' ), Nudged: false } );
			return { Answer: String( message.content || '' ), Rounds: rounds, Usage: usage };
		}
		if ( message.content && String( message.content ).trim() )
		{
			progress( { Round: rounds, Kind: 'text', Text: String( message.content ).trim() } );
		}
		for ( let call of calls )
		{
			if ( request.Signal && request.Signal.aborted )
			{
				throw new Error( 'stopped' );
			}
			let name = call.function ? call.function.name : '';
			let input = parse_arguments( call );
			let began = Date.now();
			let result = tools ? await tools.Call( name, input ) : 'there are no tools';
			let described = tools ? tools.Describe( name, input ) : name;
			progress( { Round: rounds, Kind: 'call', Name: name, Arguments: input, Described: described, Result: String( result ).slice( 0, RESULT_KEPT ), Duration: Math.round( ( Date.now() - began ) / 100 ) / 10 } );
			messages.push( { role: 'tool', content: String( result ), tool_name: name } );
		}
	}

	// The rounds are spent: one last request, with no tools, for the answer.
	messages.push( { role: 'user', content: ANSWER_NUDGE } );
	let final = await chat( body_of( [] ) );
	let content = ( final.message && final.message.content ) ? String( final.message.content ) : '';
	if ( !content.trim() )
	{
		throw new Error( 'the model took ' + rounds + ' rounds without answering' );
	}
	progress( { Round: rounds, Kind: 'answer', Text: content, Nudged: true } );
	return { Answer: content, Rounds: rounds, Usage: usage };
}


//---------------------------------------------------------------------
// Render: the transcript as markdown.

function fence_for( text )
{
	let longest = 3;
	let found = /`{3,}/g;
	let match = null;
	while ( ( match = found.exec( text || '' ) ) !== null )
	{
		longest = Math.max( longest, match[ 0 ].length + 1 );
	}
	return '`'.repeat( longest );
}


function Render( Entries )
{
	let lines = [];
	let round = null;
	for ( let entry of Entries || [] )
	{
		if ( entry.Kind === 'answer' )
		{
			lines.push( '### Answer' + ( entry.Nudged ? ' (asked for after ' + entry.Round + ' rounds)' : '' ) );
			lines.push( '' );
			lines.push( String( entry.Text || '' ).replace( /\s+$/, '' ) );
			lines.push( '' );
			continue;
		}
		if ( entry.Round !== round )
		{
			round = entry.Round;
			lines.push( '### Round ' + round );
			lines.push( '' );
		}
		if ( entry.Kind === 'text' )
		{
			lines.push( String( entry.Text || '' ).replace( /\s+$/, '' ) );
			lines.push( '' );
			continue;
		}
		let result = String( entry.Result || '' );
		let shown = ( result.length > RESULT_LIMIT ) ? result.slice( 0, RESULT_LIMIT ) : result;
		let fence = fence_for( shown );
		lines.push( '**' + entry.Described + '** · ' + entry.Duration + ' s' );
		lines.push( '' );
		lines.push( fence );
		lines.push( shown.replace( /\s+$/, '' ) );
		lines.push( fence );
		if ( result.length > shown.length )
		{
			lines.push( '… ' + ( result.length - shown.length ).toLocaleString() + ' more characters' );
		}
		lines.push( '' );
	}
	return lines.join( '\n' );
}


module.exports = {
	RESULT_LIMIT: RESULT_LIMIT,
	Run: Run,
	Render: Render,
};
