'use strict';

// The package for one call, the answer read back, and the ollama caller against a stand-in server.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const HTTP = require( 'http' );
const LLM = require( '../src/Llm.js' );

const PARTICIPANTS = [ { Name: 'user', Display: 'Andre', Role: 'owner' }, { Name: 'llm', Display: 'LLM', Role: 'llm' } ];


function thread( id, status, turn, replies, extra )
{
	return Object.assign( {
		Id: id,
		Anchor: { Text: 'the words' },
		Detached: false,
		Status: status,
		Resolved: null,
		Applied: null,
		Replies: replies,
		Turn: turn,
	}, extra || {} );
}


//---------------------------------------------------------------------

TEST( 'the prompt holds the rules, the text in a fence longer than its own, every thread, and the search', function ()
{
	let prompt = LLM.Prompt( {
		Proposal: { Title: 'A title', Revision: 3 },
		Text: 'Some text with ```` four backticks.',
		Threads: [
			thread( 't1', 'contested', [ 'llm' ], [ { By: 'user', Text: 'Why?\nReally.' } ] ),
			thread( 't2', 'consensus', [ 'llm' ], [ { By: 'llm', Text: 'Outcome: x.' } ], { Resolved: { By: 'user' } } ),
			thread( 't3', 'contested', [ 'user' ], [ { By: 'llm', Text: 'Asked.' } ] ),
			thread( 't4', 'consensus', [], [ { By: 'llm', Text: 'Done.' } ], { Anchor: null, Resolved: { By: 'user' }, Applied: { Revision: 2, Outcome: 'done' } } ),
		],
		Me: 'llm',
		Participants: PARTICIPANTS,
		Search: { t1: [ { Title: 'Other', Thread: null, Text: 'a passage elsewhere' } ], t2: [] },
	} );
	ASSERT.match( prompt, /# The rules/ );
	ASSERT.match( prompt, /"A title", revision 3/ );
	ASSERT.match( prompt, /`````markdown\nSome text with ```` four backticks\.\n`````/ );
	ASSERT.match( prompt, /## Thread t1, contested, WAITING ON YOU to reply/ );
	ASSERT.match( prompt, /- Andre: Why\?\n  Really\./ );
	ASSERT.match( prompt, /## Thread t2, resolved, WAITING ON YOU to apply/ );
	ASSERT.match( prompt, /- \(resolved by Andre\)/ );
	ASSERT.match( prompt, /## Thread t3, contested, waiting on user/ );
	ASSERT.match( prompt, /## Thread t4, resolved and applied\n\nOn the whole document\./ );
	ASSERT.match( prompt, /## For thread t1\n\n- From "Other": a passage elsewhere/ );
	ASSERT.equal( prompt.includes( 'For thread t2' ), false );
} );


TEST( 'the answer is read from an object, from JSON text, or from JSON in a code fence', function ()
{
	let actions = { Actions: [ { Thread: 't1', Kind: 'reply', Reply: 'Yes.' } ] };
	ASSERT.deepEqual( LLM.Parse( actions ), actions );
	ASSERT.deepEqual( LLM.Parse( JSON.stringify( actions ) ), actions );
	ASSERT.deepEqual( LLM.Parse( '```json\n' + JSON.stringify( actions, null, 2 ) + '\n```' ), actions );
	ASSERT.deepEqual( LLM.Parse( '{ "Actions": [] }' ), { Actions: [] } );
	ASSERT.throws( function () { LLM.Parse( 'I think so.' ); }, /not JSON/ );
	ASSERT.throws( function () { LLM.Parse( { Answer: [] } ); }, /no Actions/ );
	ASSERT.throws( function () { LLM.Parse( { Actions: [ { Thread: 't1', Kind: 'resolve' } ] } ); }, /unknown Kind/ );
} );


TEST( 'call settings take their defaults and are checked', function ()
{
	ASSERT.equal( LLM.CallSettings( { Name: 'llm' } ), null );
	let call = LLM.CallSettings( { Call: { Kind: 'claude-cli' } } );
	ASSERT.equal( call.Command, 'claude' );
	ASSERT.equal( call.CallsPerHour, 20 );
	ASSERT.equal( call.TimeoutSeconds, 300 );
	ASSERT.deepEqual( LLM.Validate( { Kind: 'ollama', Url: 'http://x', Model: 'm' } ), [] );
	ASSERT.equal( LLM.Validate( { Kind: 'ollama' } ).length, 1 );
	ASSERT.equal( LLM.Validate( { Kind: 'api' } ).length, 1 );
} );


TEST( 'the ollama caller sends the prompt with the schema and reads a fenced answer and its tokens', async function ()
{
	let received = null;
	let server = HTTP.createServer( function ( request, response )
	{
		let body = '';
		request.on( 'data', function ( chunk ) { body += chunk; } );
		request.on( 'end', function ()
		{
			received = { Path: request.url, Body: JSON.parse( body ) };
			response.writeHead( 200, { 'Content-Type': 'application/json' } );
			response.end( JSON.stringify( {
				message: { role: 'assistant', content: '```json\n{ "Actions": [ { "Thread": "t1", "Kind": "reply", "Reply": "Hi." } ] }\n```' },
				prompt_eval_count: 700,
				eval_count: 50,
			} ) );
		} );
	} );
	await new Promise( function ( resolve ) { server.listen( 0, '127.0.0.1', resolve ); } );
	try
	{
		let url = 'http://127.0.0.1:' + server.address().port + '/';
		let caller = LLM.Caller( LLM.CallSettings( { Call: { Kind: 'ollama', Url: url, Model: 'test-model' } } ) );
		let result = await caller( 'the prompt' );
		ASSERT.equal( received.Path, '/api/chat' );
		ASSERT.equal( received.Body.model, 'test-model' );
		ASSERT.equal( received.Body.stream, false );
		ASSERT.deepEqual( received.Body.format, LLM.SCHEMA );
		ASSERT.equal( received.Body.messages[ 0 ].content, 'the prompt' );
		ASSERT.deepEqual( result.Answer, { Actions: [ { Thread: 't1', Kind: 'reply', Reply: 'Hi.' } ] } );
		ASSERT.deepEqual( result.Usage, { Model: 'test-model', Input: 700, Output: 50 } );
	}
	finally
	{
		server.close();
	}
} );


TEST( 'the claude-cli caller reports a command that cannot start', async function ()
{
	let caller = LLM.Caller( LLM.CallSettings( { Call: { Kind: 'claude-cli', Command: 'no-such-command-for-consensus' } } ) );
	await ASSERT.rejects( caller( 'the prompt' ), /could not start no-such-command-for-consensus/ );
} );
