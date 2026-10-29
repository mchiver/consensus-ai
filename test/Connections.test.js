'use strict';

// Plan Tool calls only, Step 2: the API connections (claude, chatgpt, gemini, grok, openai-compatible). Their fields
// and their write-only Key (Llms.js), the Anthropic and OpenAI adapters of the tool loop against a stand-in service
// (test/support/Service.js), the Check with its models, and a run through the Server end to end with the Key in no
// answer, no record and no request body.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const FS = require( 'fs' );
const OS = require( 'os' );
const PATH = require( 'path' );
const LLMS = require( '../src/Llms.js' );
const LLM = require( '../src/Llm.js' );
const LOOP = require( '../src/Loop.js' );
const TOOLS = require( '../src/Tools.js' );
const SERVER = require( '../src/Server.js' );
const SERVICE = require( './support/Service.js' );

const KEY = 'sk-test-key-of-the-stand-in-0123456789';

let folders = [];


function temporary_folder( prefix )
{
	let folder = FS.mkdtempSync( PATH.join( OS.tmpdir(), prefix ) );
	folders.push( folder );
	return folder;
}


TEST.after( function ()
{
	for ( let folder of folders )
	{
		FS.rmSync( folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 } );
	}
} );


function a_place()
{
	let folder = temporary_folder( 'consensus-connections-folder-' );
	FS.writeFileSync( PATH.join( folder, 'readme.md' ), '# Readme\n' );
	return { Path: folder, Include: [], Exclude: [], Commands: [] };
}


async function owner( url, method, path, body )
{
	let options = { method: method, headers: {} };
	if ( body !== undefined )
	{
		options.headers[ 'Content-Type' ] = 'application/json';
		options.body = JSON.stringify( body );
	}
	let response = await fetch( url + path, options );
	return { Status: response.status, Body: await response.json() };
}


//---------------------------------------------------------------------

TEST( 'an API connection is filled with its kind\'s Url, named <kind>-<model>, needs a Model, and its Key is never shown', function ()
{
	let claude = LLMS.Fill( { Kind: 'claude', Model: 'claude-sonnet-4-5', Key: KEY } );
	ASSERT.equal( claude.Url, 'https://api.anthropic.com/v1' );
	ASSERT.equal( claude.Name, 'claude-claude-sonnet-4-5' );
	ASSERT.equal( LLMS.Fill( { Kind: 'chatgpt' } ).Url, 'https://api.openai.com/v1' );
	ASSERT.equal( LLMS.Fill( { Kind: 'gemini' } ).Url, 'https://generativelanguage.googleapis.com/v1beta/openai' );
	ASSERT.equal( LLMS.Fill( { Kind: 'grok' } ).Url, 'https://api.x.ai/v1' );
	ASSERT.equal( LLMS.Fill( { Kind: 'openai-compatible', Url: 'https://api.mistral.ai/v1/' } ).Url, 'https://api.mistral.ai/v1' );
	ASSERT.deepEqual( [ 'claude-cli', 'ollama', 'claude', 'chatgpt', 'gemini', 'grok', 'openai-compatible' ].map( LLMS.IsLoop ), [ false, true, true, true, true, true, true ] );
	ASSERT.deepEqual( [ 'ollama', 'claude', 'chatgpt', 'gemini', 'grok', 'openai-compatible', 'claude-cli' ].map( LLMS.FormatOf ), [ 'ollama', 'anthropic', 'openai', 'openai', 'openai', 'openai', null ] );
	// the problems: a Model, and a Url for the compatible kind
	let settings = { Owner: { Name: 'user', Display: 'User' }, Llms: [ LLMS.Fill( { Name: 'a', Kind: 'chatgpt' } ), LLMS.Fill( { Name: 'b', Kind: 'openai-compatible', Model: 'm' } ) ] };
	ASSERT.deepEqual( LLMS.Problems( settings ), [ 'LLM connection "a": a Model is needed', 'LLM connection "b": the Url must start with http:// or https://' ] );
	// the Key: never in what an answer carries, KeySet in its place
	let whole = LLMS.Public( claude, settings, true );
	ASSERT.equal( whole.Key, undefined );
	ASSERT.equal( whole.KeySet, true );
	ASSERT.equal( JSON.stringify( whole ).includes( KEY ), false );
	ASSERT.equal( LLMS.Public( claude, settings, false ).Key, undefined );
	ASSERT.equal( LLMS.Hidden( LLMS.Fill( { Kind: 'grok' } ) ).KeySet, false );
	// a save with no Key keeps the one there
	ASSERT.deepEqual( LLMS.Given( { Model: 'm', Key: '  ' } ), { Model: 'm' } );
	ASSERT.deepEqual( LLMS.Given( { Key: 'new', KeySet: true } ), { Key: 'new' } );
} );


TEST( 'the OpenAI adapter: the tools offered in its form, a call\'s result sent back as a tool message, the Key in the header alone', async function ()
{
	let service = await SERVICE.Start( { Format: 'openai', Key: KEY, Script: [
		{ calls: [ [ 'glob', { Pattern: '*.md' } ] ] },
		{ content: 'One readme.' },
	] } );
	try
	{
		let llm = LLMS.Fill( { Name: 'gpt', Kind: 'chatgpt', Url: service.Url, Model: 'gpt-test', Key: KEY, Timeout: 30 } );
		let entries = [];
		let result = await LOOP.Run( { Llm: llm, Prompt: 'What is here?', Tools: TOOLS.Tools( { Writes: 'consensus', Folder: a_place() } ), Adapter: LLM.Adapter( llm ), OnProgress: function ( entry ) { entries.push( entry ); } } );
		ASSERT.deepEqual( [ result.Answer, result.Rounds, result.Usage ], [ 'One readme.', 2, { Prompt: 20, Answer: 10 } ] );
		ASSERT.deepEqual( entries.map( function ( entry ) { return entry.Kind; } ), [ 'call', 'answer' ] );
		ASSERT.equal( entries[ 0 ].Result, 'readme.md' );
		ASSERT.equal( service.Requests[ 0 ].model, 'gpt-test' );
		ASSERT.equal( service.Requests[ 0 ].tools[ 0 ].function.name, 'glob' );
		ASSERT.deepEqual( service.Requests[ 1 ].messages[ 2 ], { role: 'tool', tool_call_id: 'call_1_0', content: 'readme.md' } );
		ASSERT.equal( service.Headers[ 0 ].authorization, 'Bearer ' + KEY );
		ASSERT.equal( JSON.stringify( service.Requests ).includes( KEY ), false );
	}
	finally
	{
		await service.Close();
	}
	// a wrong Key: the service's refusal ends the run with its words
	let refusing = await SERVICE.Start( { Format: 'openai', Key: KEY, Script: [] } );
	try
	{
		let llm = LLMS.Fill( { Name: 'grok', Kind: 'grok', Url: refusing.Url, Model: 'grok-test', Key: 'wrong', Timeout: 30 } );
		await ASSERT.rejects( LOOP.Run( { Llm: llm, Prompt: 'p', Tools: TOOLS.Tools( {} ), Adapter: LLM.Adapter( llm ) } ), /^Error: Grok refused: 401 .*invalid api key/ );
	}
	finally
	{
		await refusing.Close();
	}
} );


TEST( 'the Anthropic adapter: tools as input_schema, tool_use answered with tool_result, the last round told to call none', async function ()
{
	let service = await SERVICE.Start( { Format: 'anthropic', Key: KEY, Script: [
		{ content: 'Looking.', calls: [ [ 'glob', { Pattern: '*.md' } ] ] },
		{ calls: [ [ 'glob', { Pattern: '*.js' } ] ] },
		{ content: 'One readme, no scripts.' },
	] } );
	try
	{
		let llm = LLMS.Fill( { Name: 'claude', Kind: 'claude', Url: service.Url, Model: 'claude-test', Key: KEY, Timeout: 30, Rounds: 2 } );
		let entries = [];
		let result = await LOOP.Run( { Llm: llm, Prompt: 'What is here?', Tools: TOOLS.Tools( { Writes: 'consensus', Folder: a_place() } ), Adapter: LLM.Adapter( llm ), OnProgress: function ( entry ) { entries.push( entry ); } } );
		ASSERT.equal( result.Answer, 'One readme, no scripts.' );
		ASSERT.deepEqual( entries.map( function ( entry ) { return entry.Kind; } ), [ 'text', 'call', 'call', 'answer' ] );
		ASSERT.equal( entries[ 3 ].Nudged, true );
		let first = service.Requests[ 0 ];
		ASSERT.deepEqual( [ first.model, typeof first.max_tokens, first.tools[ 0 ].name, first.tools[ 0 ].input_schema.type ], [ 'claude-test', 'number', 'glob', 'object' ] );
		ASSERT.equal( first.tool_choice, undefined );
		ASSERT.deepEqual( service.Requests[ 1 ].messages[ 2 ], { role: 'user', content: [ { type: 'tool_result', tool_use_id: 'toolu_1_0', content: 'readme.md' } ] } );
		ASSERT.deepEqual( service.Requests[ 2 ].tool_choice, { type: 'none' } );
		ASSERT.equal( service.Headers[ 0 ][ 'x-api-key' ], KEY );
		ASSERT.equal( service.Headers[ 0 ][ 'anthropic-version' ], '2023-06-01' );
		ASSERT.equal( JSON.stringify( service.Requests ).includes( KEY ), false );
	}
	finally
	{
		await service.Close();
	}
} );


TEST( 'the Check of an API connection: the Key tried against the models, the Model among them, and the models answered for the list', async function ()
{
	let service = await SERVICE.Start( { Format: 'openai', Key: KEY, Models: [ 'model-b', 'models/model-a' ] } );
	try
	{
		let good = await LLM.Check( LLMS.Fill( { Kind: 'openai-compatible', Url: service.Url, Model: 'model-a', Key: KEY } ) );
		ASSERT.deepEqual( [ good.Ok, good.Models ], [ true, [ 'model-a', 'model-b' ] ] );
		ASSERT.match( good.Result, /^the Key is good; 2 models: model-a, model-b$/ );
		let missing = await LLM.Check( LLMS.Fill( { Kind: 'openai-compatible', Url: service.Url, Model: 'model-c', Key: KEY } ) );
		ASSERT.deepEqual( [ missing.Ok, missing.Models.length ], [ false, 2 ] );
		ASSERT.match( missing.Error, /the Model "model-c" is not among the 2 models/ );
		let unpicked = await LLM.Check( LLMS.Fill( { Kind: 'openai-compatible', Url: service.Url, Key: KEY } ) );
		ASSERT.match( unpicked.Error, /pick a Model/ );
		let wrong = await LLM.Check( LLMS.Fill( { Kind: 'openai-compatible', Url: service.Url, Model: 'model-a', Key: 'wrong' } ) );
		ASSERT.deepEqual( [ wrong.Ok, wrong.Error ], [ false, 'The service refused the Key (401)' ] );
		ASSERT.match( ( await LLM.Check( LLMS.Fill( { Kind: 'chatgpt', Url: service.Url, Model: 'model-a' } ) ) ).Error, /no Key is set/ );
	}
	finally
	{
		await service.Close();
	}
	let anthropic = await SERVICE.Start( { Format: 'anthropic', Key: KEY, Models: [ 'claude-test' ] } );
	try
	{
		let checked = await LLM.Check( LLMS.Fill( { Kind: 'claude', Url: anthropic.Url, Model: 'claude-test', Key: KEY } ) );
		ASSERT.deepEqual( [ checked.Ok, checked.Models ], [ true, [ 'claude-test' ] ] );
	}
	finally
	{
		await anthropic.Close();
	}
} );


TEST( 'an API connection through the Server: the Key saved and kept but never answered, and a run posts through it with the Key in no record', async function ()
{
	let data = temporary_folder( 'consensus-connections-server-' );
	FS.writeFileSync( PATH.join( data, 'consensus.json' ), JSON.stringify( { Name: 'test', Port: 0, Scope: 'Local', States: [ 'Draft', 'Working', 'Finished' ], Owner: { Name: 'user', Display: 'User' } } ) );
	let target = await SERVER.Start( { Data: data, Port: 0 } );
	let service = null;
	try
	{
		let url = target.Url;
		let project = ( await owner( url, 'GET', '/api/projects' ) ).Body.Projects[ 0 ];
		let plan = ( await owner( url, 'POST', '/api/plans', { Title: 'A sketch', Text: '# A sketch\n\nOne line.\n', Project: project.Id } ) ).Body.Plan;
		let contested = ( await owner( url, 'POST', '/api/plans/' + plan.Id + '/threads', { Text: 'Why one line?' } ) ).Body.Thread;
		service = await SERVICE.Start( { Format: 'anthropic', Key: KEY, Models: [ 'claude-test' ], Script: [
			{ calls: [ [ 'reply', { Id: plan.Id, Thread: contested.Id, Text: 'Because a sketch is short.' } ] ] },
			{ content: 'Replied.' },
		] } );
		// made with its Key: the answer says a Key is set, and carries none
		let made = await owner( url, 'POST', '/api/llms', { Name: 'claude', Kind: 'claude', Url: service.Url, Model: 'claude-test', Key: KEY, Timeout: 30 } );
		ASSERT.equal( made.Status, 201 );
		ASSERT.deepEqual( [ made.Body.Llm.KeySet, made.Body.Llm.Key ], [ true, undefined ] );
		let file = function () { return FS.readFileSync( PATH.join( data, 'consensus.json' ), 'utf8' ); };
		ASSERT.equal( JSON.parse( file() ).Llms[ 0 ].Key, KEY );
		for ( let path of [ '/api/llms', '/api/settings' ] )
		{
			ASSERT.equal( JSON.stringify( ( await owner( url, 'GET', path ) ).Body ).includes( KEY ), false, path + ' carries the Key' );
		}
		// a save without a Key keeps it; the Check of the saved one uses it
		let changed = await owner( url, 'PUT', '/api/llms/' + made.Body.Llm.Id, { Timeout: 40, Key: '' } );
		ASSERT.deepEqual( [ changed.Body.Llm.Timeout, changed.Body.Llm.KeySet ], [ 40, true ] );
		ASSERT.equal( JSON.parse( file() ).Llms[ 0 ].Key, KEY );
		ASSERT.equal( ( await owner( url, 'POST', '/api/llms/' + made.Body.Llm.Id + '/check', {} ) ).Body.Ok, true );
		ASSERT.equal( JSON.stringify( ( await owner( url, 'PUT', '/api/settings', { Name: 'test' } ) ).Body ).includes( KEY ), false );
		// a run: Enhance on the plan, posting a reply through the connection
		let started = await owner( url, 'POST', '/api/runs', { Llm: made.Body.Llm.Id, Task: 'enhance', Project: project.Id, Plan: plan.Id, Text: 'Answer the thread.' } );
		ASSERT.equal( started.Status, 201 );
		ASSERT.equal( started.Body.Run.Command, 'claude claude-test at ' + service.Url );
		let record = null;
		for ( let attempt = 0; attempt < 200 && ( !record || record.Status === 'running' ); attempt++ )
		{
			await new Promise( function ( resolve ) { setTimeout( resolve, 50 ); } );
			record = ( await owner( url, 'GET', '/api/runs/' + started.Body.Run.Id ) ).Body.Run;
		}
		ASSERT.equal( record.Status, 'done' );
		ASSERT.deepEqual( record.Usage, { Prompt: 20, Answer: 10 } );
		ASSERT.match( record.Output, /### Answer\n\nReplied\./ );
		ASSERT.equal( JSON.stringify( record ).includes( KEY ), false );
		ASSERT.equal( JSON.stringify( service.Requests ).includes( KEY ), false );
		ASSERT.equal( target.Tokens.Count(), 0 );
		let thread = ( await owner( url, 'GET', '/api/plans/' + plan.Id ) ).Body.Threads.find( function ( one ) { return one.Id === contested.Id; } );
		ASSERT.deepEqual( [ thread.Replies[ 1 ].By, thread.Replies[ 1 ].Service, thread.Replies[ 1 ].Text ], [ 'user', 'claude', 'Because a sketch is short.' ] );
		let runs_folder = PATH.join( data, 'runs' );
		for ( let name of FS.readdirSync( runs_folder ) )
		{
			ASSERT.equal( FS.readFileSync( PATH.join( runs_folder, name ), 'utf8' ).includes( KEY ), false, name + ' holds the Key' );
		}
	}
	finally
	{
		if ( service )
		{
			await service.Close();
		}
		await target.Close();
	}
} );
