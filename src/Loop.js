'use strict';

// Loop - a one-shot as a tool loop (plan Tool calls only, Step 1; the loop of src/Ollama.js before it): one request
// per round, the package as the first message and the run's tools offered; each call the model makes is run by
// Tools.js, inside the Server, and its result sent back; the model's text without a call is the answer. The
// connection's Timeout is the deadline of the whole run and its Rounds the most requests made. Nothing streams: the
// transcript grows an entry at a time through OnProgress. What a service's requests and replies look like is its
// adapter's (Ollama.js today); the loop knows none of them.
//
//   Run( { Llm, Prompt, Tools, Adapter, Signal?, OnProgress? } ) -> { Answer, Rounds, Usage: { Prompt, Answer } }
//   Adapter = {
//     Label                                     the service's name in an error ("Ollama took longer than ...")
//     First( Prompt ) -> [ message ]            the conversation's start
//     Request( Llm, Messages, Definitions )     -> { Url, Headers, Body }: one round's request; Definitions empty for the last
//     Read( Json ) -> { Message, Text, Calls: [ { Id, Name, Arguments } ], Usage: { Prompt, Answer } }
//                                               the reply: Message is pushed onto the conversation as it is
//     Results( Calls ) -> [ message ]           the results of a round's calls ({ Id, Name, Arguments, Result }) as messages
//     User( Text ) -> message                   a line of ours (the nudge for an answer)
//   }
//   OnProgress( entry ): an entry of the transcript, in order:
//     { Round, Kind: 'text', Text }                                              what the model said in a round
//     { Round, Kind: 'call', Name, Arguments, Described, Result, Duration }      a tool call and its whole result
//     { Round, Kind: 'answer', Text, Nudged }                                    the answer (Nudged: asked for after the rounds)
//   Render( Entries ) -> markdown: a heading per round, the text, each call in bold with its result fenced (clipped
//     to RESULT_LIMIT), the answer under its own heading; what the run's Output holds.
//   A refusal, a timeout, an abort or the rounds running out throws an Error whose message says which.

const LLMS = require( './Llms.js' );

const ANSWER_NUDGE = 'You have used every round you had. Answer now, in words, with no tool call.';
const RESULT_KEPT = 50000;
const RESULT_LIMIT = 2000;


//---------------------------------------------------------------------

async function Run( Request )
{
	let request = Request || {};
	let llm = request.Llm || {};
	let tools = request.Tools;
	let adapter = request.Adapter;
	let progress = ( typeof request.OnProgress === 'function' ) ? request.OnProgress : function () {};
	let timeout = ( llm.Timeout || LLMS.DEFAULT_TIMEOUT ) * 1000;
	let deadline = Date.now() + timeout;
	let rounds_allowed = llm.Rounds || LLMS.DEFAULT_ROUNDS;
	let messages = adapter.First( String( request.Prompt || '' ) );
	let usage = { Prompt: 0, Answer: 0 };
	let rounds = 0;
	let definitions = tools ? tools.Definitions : [];


	function too_long()
	{
		return new Error( adapter.Label + ' took longer than ' + ( timeout / 1000 ) + ' seconds' );
	}


	async function round_trip( offered )
	{
		let left = deadline - Date.now();
		if ( left <= 0 )
		{
			throw too_long();
		}
		let signals = [ AbortSignal.timeout( left ) ];
		if ( request.Signal )
		{
			signals.push( request.Signal );
		}
		let made = adapter.Request( llm, messages, offered );
		let headers = Object.assign( { 'Content-Type': 'application/json' }, made.Headers || {} );
		let response = null;
		try
		{
			response = await fetch( made.Url, {
				method: 'POST',
				headers: headers,
				body: JSON.stringify( made.Body ),
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
				throw too_long();
			}
			throw new Error( adapter.Label + ' at ' + llm.Url + ' did not answer: ' + error.message );
		}
		if ( !response.ok )
		{
			let said = await response.text().catch( function () { return ''; } );
			throw new Error( adapter.Label + ' refused: ' + response.status + ' ' + said.slice( 0, 300 ).trim() );
		}
		let read = adapter.Read( await response.json() );
		usage.Prompt += read.Usage.Prompt || 0;
		usage.Answer += read.Usage.Answer || 0;
		return read;
	}


	while ( rounds < rounds_allowed )
	{
		rounds++;
		let reply = await round_trip( definitions );
		messages.push( reply.Message );
		if ( !reply.Calls.length )
		{
			progress( { Round: rounds, Kind: 'answer', Text: reply.Text, Nudged: false } );
			return { Answer: reply.Text, Rounds: rounds, Usage: usage };
		}
		if ( reply.Text.trim() )
		{
			progress( { Round: rounds, Kind: 'text', Text: reply.Text.trim() } );
		}
		let done = [];
		for ( let call of reply.Calls )
		{
			if ( request.Signal && request.Signal.aborted )
			{
				throw new Error( 'stopped' );
			}
			let began = Date.now();
			let result = tools ? await tools.Call( call.Name, call.Arguments ) : 'there are no tools';
			let described = tools ? tools.Describe( call.Name, call.Arguments ) : call.Name;
			progress( { Round: rounds, Kind: 'call', Name: call.Name, Arguments: call.Arguments, Described: described, Result: String( result ).slice( 0, RESULT_KEPT ), Duration: Math.round( ( Date.now() - began ) / 100 ) / 10 } );
			done.push( { Id: call.Id, Name: call.Name, Arguments: call.Arguments, Result: String( result ) } );
		}
		for ( let message of adapter.Results( done ) )
		{
			messages.push( message );
		}
	}

	// The rounds are spent: one last request, with no tools, for the answer.
	messages.push( adapter.User( ANSWER_NUDGE ) );
	let final = await round_trip( [] );
	if ( !final.Text.trim() )
	{
		throw new Error( 'the model took ' + rounds + ' rounds without answering' );
	}
	progress( { Round: rounds, Kind: 'answer', Text: final.Text, Nudged: true } );
	return { Answer: final.Text, Rounds: rounds, Usage: usage };
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
	ANSWER_NUDGE: ANSWER_NUDGE,
	RESULT_LIMIT: RESULT_LIMIT,
	Run: Run,
	Render: Render,
};
