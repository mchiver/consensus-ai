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
			thread( 't2', 'resolved', [ 'llm' ], [ { By: 'llm', Text: 'Outcome: x.' } ], { Resolved: { By: 'user' } } ),
			thread( 't3', 'contested', [ 'user' ], [ { By: 'llm', Text: 'Asked.' } ] ),
			thread( 't4', 'resolved', [], [ { By: 'llm', Text: 'Done.' } ], { Anchor: null, Resolved: { By: 'user' }, Applied: { Revision: 2, Outcome: 'done' } } ),
		],
		Me: 'llm',
		Participants: PARTICIPANTS,
		Search: { t1: [ { Title: 'Other', Thread: null, Text: 'a passage elsewhere' } ], t2: [] },
	} );
	ASSERT.match( prompt, /# The rules/ );
	ASSERT.match( prompt, /You never build: implementing a plan in code is done\n  by an agent session/ );
	ASSERT.match( prompt, /when the\n  owner resolved it with a reply of their own, that reply is the outcome/ );
	ASSERT.match( prompt, /when the owner resolved it with no reply, they accept the outcome or the recommendation in your last reply/ );
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
	let read = Object.assign( { Requests: [] }, actions );
	ASSERT.deepEqual( LLM.Parse( actions ), read );
	ASSERT.deepEqual( LLM.Parse( JSON.stringify( actions ) ), read );
	ASSERT.deepEqual( LLM.Parse( '```json\n' + JSON.stringify( actions, null, 2 ) + '\n```' ), read );
	ASSERT.deepEqual( LLM.Parse( '{ "Actions": [] }' ), { Actions: [], Requests: [] } );
	ASSERT.throws( function () { LLM.Parse( 'I think so.' ); }, /not JSON/ );
	ASSERT.throws( function () { LLM.Parse( { Answer: [] } ); }, /no Actions/ );
	ASSERT.throws( function () { LLM.Parse( { Actions: [ { Thread: 't1', Kind: 'resolve' } ] } ); }, /unknown Kind/ );
	// an answer that asks for more
	let asking = { Actions: [], Requests: [ { Tool: 'read_plan', Plan: 'Tabs' } ] };
	ASSERT.deepEqual( LLM.Parse( asking ), asking );
	ASSERT.throws( function () { LLM.Parse( { Actions: [], Requests: [ { Plan: 'Tabs' } ] } ); }, /a request has no Tool/ );
	// a context action needs no thread, but needs its text
	let context = { Actions: [ { Kind: 'context', Text: '# Context\n', Reason: 'why' } ] };
	ASSERT.deepEqual( LLM.Parse( context ), Object.assign( { Requests: [] }, context ) );
	ASSERT.throws( function () { LLM.Parse( { Actions: [ { Kind: 'context', Text: '  ' } ] } ); }, /context action has no Text/ );
} );


TEST( 'the prompt holds the project\'s context after the rules, or asks for one; the size comes from the settings', function ()
{
	function prompt_with( context )
	{
		return LLM.Prompt( { Proposal: { Title: 'P', Revision: 1 }, Text: 'x', Threads: [], Me: 'llm', Participants: PARTICIPANTS, Context: context, MaxCharacters: 900 } );
	}
	let written = prompt_with( { Text: '# Context\n\nLamps stay lit.\n', Revision: 4 } );
	ASSERT.match( written, /Keep it under 900 characters/ );
	ASSERT.match( written, /# The project's context, revision 4\n\n````markdown\n# Context\n\nLamps stay lit\.\n\n````/ );
	ASSERT.ok( written.indexOf( '# The rules' ) < written.indexOf( '# The project\'s context, revision 4' ) );
	ASSERT.ok( written.indexOf( '# The project\'s context, revision 4' ) < written.indexOf( '# The proposal' ) );
	ASSERT.match( prompt_with( { Text: '  \n', Revision: 1 } ), /This project has no context yet\. Write one with a context action\./ );
	ASSERT.equal( prompt_with( null ).includes( '# The project\'s context:' ), false );
	ASSERT.deepEqual( LLM.ContextSettings( {} ), { MaxCharacters: 12000 } );
	ASSERT.deepEqual( LLM.ContextSettings( { Context: { MaxCharacters: 5000 } } ), { MaxCharacters: 5000 } );
} );


TEST( 'the initialize prompt holds the project\'s items, its files and its key files, clipped', function ()
{
	let prompt = LLM.InitializePrompt( {
		Project: 'Lamps',
		Context: { Text: '', Revision: 1 },
		MaxCharacters: 12000,
		Items: [ { Kind: 'plan', Title: 'Light them', State: 'Working' }, { Kind: 'document', Title: 'Notes' } ],
		Files: [ 'code/README.md', 'code/src/index.js' ],
		KeyFiles: [ { Path: 'code/README.md', Text: 'x'.repeat( 9000 ) } ],
	} );
	ASSERT.match( prompt, /Write the context of the project "Lamps"/ );
	ASSERT.match( prompt, /- plan: Light them \(Working\)\n- document: Notes/ );
	ASSERT.match( prompt, /# The files in its uploaded zips\n\n- code\/README\.md\n- code\/src\/index\.js/ );
	ASSERT.match( prompt, /# The file code\/README\.md\n\n````\nx{8000}\n…\n````/ );
} );


TEST( 'turns: the rules offer the requests; the next prompt ends with what was asked for, what it found, and which answer is next', function ()
{
	let base = { Proposal: { Title: 'P', Revision: 1 }, Text: 'x', Threads: [], Me: 'llm', Participants: PARTICIPANTS };
	let first = LLM.Prompt( base );
	ASSERT.match( first, /# Asking for more/ );
	ASSERT.match( first, /\{ "Tool": "read_plan", "Plan": "<id or title>" \}/ );
	ASSERT.equal( first.includes( '# What you asked for' ), false );
	let turns = [ { Requests: [ { Tool: 'read_plan', Plan: 'Tabs' }, { Tool: 'search', Query: 'drag' } ], Results: [ '# Tabs\n\nOne per item.', 'refused: no hits' ] } ];
	let second = LLM.PromptParts( Object.assign( { Turns: turns }, base ) );
	let answers = second[ second.length - 1 ];
	ASSERT.equal( answers.Name, 'Answers' );
	ASSERT.match( answers.Text, /## read_plan "Tabs"\n\n````\n# Tabs\n\nOne per item\.\n````/ );
	ASSERT.match( answers.Text, /## search "drag"/ );
	ASSERT.match( answers.Text, /This is your answer 2 of 5\. Act, or ask for more\./ );
	let last = LLM.Prompt( Object.assign( { Turns: [ turns[ 0 ], turns[ 0 ], turns[ 0 ], turns[ 0 ] ] }, base ) );
	ASSERT.match( last, /This is your answer 5 of 5, the last: act now\./ );
	ASSERT.equal( LLM.DescribeRequest( { Tool: 'read_file', Zip: 'code', Path: 'a.md' } ), 'read_file "code" a.md' );
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
		ASSERT.deepEqual( result.Answer, { Actions: [ { Thread: 't1', Kind: 'reply', Reply: 'Hi.' } ], Requests: [] } );
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
