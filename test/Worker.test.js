'use strict';

// The worker (plans Workers and Review): its file tools, its settings, and its jobs against a Consensus over a
// temporary folder: a review with a stand-in model, the Ollama tool loop against a stand-in Ollama, claude -p as a
// stand-in script, the plan tools' MCP server, pause, resume and cancel. Nothing here calls a real model.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const FS = require( 'fs' );
const OS = require( 'os' );
const PATH = require( 'path' );
const HTTP = require( 'http' );
const CHILD_PROCESS = require( 'child_process' );
const SERVER = require( '../src/Server.js' );
const PARTICIPANTS = require( '../src/Participants.js' );
const WORKER = require( '../src/Worker.js' );
const WORKSPACE = require( '../src/Workspace.js' );

const TOKEN = 'worker-test-token-0123456789';
const TEXT = '# Worked plan\n\nThe worker reads the code.\n\nA closing paragraph.\n';

let folders = [];
let root = null;
let running = null;
let ollama = null;
let ollama_requests = [];
let ollama_replies = [];


function temporary_folder( prefix )
{
	let folder = FS.mkdtempSync( PATH.join( OS.tmpdir(), prefix ) );
	folders.push( folder );
	return folder;
}


async function call( method, path, body, authorization )
{
	let headers = ( body === undefined ) ? {} : { 'Content-Type': 'application/json' };
	if ( authorization )
	{
		headers.Authorization = authorization;
	}
	let response = await fetch( running.Url + path, { method: method, headers: headers, body: ( body === undefined ) ? undefined : JSON.stringify( body ) } );
	return { Status: response.status, Body: await response.json() };
}


async function wait_until( check, what )
{
	for ( let attempt = 0; attempt < 1200; attempt++ )
	{
		let value = await check();
		if ( value )
		{
			return value;
		}
		await new Promise( function ( resolve ) { setTimeout( resolve, 25 ); } );
	}
	throw new Error( 'waited too long for ' + what );
}


function worker_settings()
{
	return {
		Name: 'Desk',
		Consensus: { Url: running.Url, Token: TOKEN },
		Items: [
			{ Kind: 'Workspace', Name: 'Code', Root: root, Exclude: [ 'private/**' ] },
			{ Kind: 'Inference', Name: 'Claude', Type: 'claude-cli' },
			{ Kind: 'Inference', Name: 'Ollama', Type: 'ollama', Url: 'http://127.0.0.1:' + ollama.address().port, Model: 'fake-model' },
		],
		MaxRounds: 5,
		TimeoutSeconds: 30,
	};
}


async function start_worker( options )
{
	return await WORKER.Start( Object.assign( { Settings: worker_settings(), Folder: temporary_folder( 'consensus-worker-' ), Port: 0 }, options || {} ) );
}


// A plan in a project whose workspace is the worker's, with one thread waiting on the llm.
async function plan_with_question( name )
{
	let project = ( await call( 'POST', '/api/projects', { Name: name } ) ).Body.Project;
	await wait_until( async function ()
	{
		return ( await call( 'PUT', '/api/projects/' + project.Id + '/workspace', { Worker: 'Desk', Name: 'Code' } ) ).Status === 200;
	}, 'the worker to offer its workspace' );
	let plan = ( await call( 'POST', '/api/proposals', { Title: name + ' plan', Text: TEXT, Project: project.Id } ) ).Body.Proposal;
	let thread = ( await call( 'POST', '/api/proposals/' + plan.Id + '/threads', { Anchor: { Text: 'A closing paragraph.' }, Text: 'Does the code agree?' } ) ).Body.Thread;
	return { Project: project, Plan: plan, Thread: thread };
}


async function idle( id )
{
	return await wait_until( async function ()
	{
		let read = await call( 'GET', '/api/proposals/' + id );
		return read.Body.Llm.Running ? null : read.Body;
	}, 'the session to end' );
}


async function last_steps( id )
{
	let runs = ( await call( 'GET', '/api/proposals/' + id + '/runs' ) ).Body.Runs;
	return runs[ runs.length - 1 ].Steps.map( function ( step ) { return step.Text; } );
}


TEST.before( async function ()
{
	root = temporary_folder( 'consensus-workspace-' );
	FS.writeFileSync( PATH.join( root, 'a.js' ), 'const HERON = 1;\nfunction wade()\n{\n\treturn HERON;\n}\n' );
	FS.mkdirSync( PATH.join( root, 'src' ) );
	FS.writeFileSync( PATH.join( root, 'src', 'b.md' ), '# B\n\nThe heron waits.\n' );
	FS.writeFileSync( PATH.join( root, '.gitignore' ), 'secret.txt\n' );
	FS.writeFileSync( PATH.join( root, 'secret.txt' ), 'heron password\n' );
	FS.mkdirSync( PATH.join( root, 'private' ) );
	FS.writeFileSync( PATH.join( root, 'private', 'notes.md' ), 'heron notes\n' );
	FS.writeFileSync( PATH.join( root, 'image.bin' ), Buffer.from( [ 1, 0, 2, 0 ] ) );

	ollama = HTTP.createServer( function ( request, response )
	{
		let body = '';
		request.on( 'data', function ( chunk ) { body += chunk; } );
		request.on( 'end', function ()
		{
			if ( request.url === '/api/tags' )
			{
				response.end( JSON.stringify( { models: [ { name: 'fake-model' } ] } ) );
				return;
			}
			ollama_requests.push( JSON.parse( body ) );
			let reply = ollama_replies.shift() || { message: { role: 'assistant', content: '{"Actions":[]}' } };
			response.end( JSON.stringify( reply ) );
		} );
	} );
	await new Promise( function ( resolve ) { ollama.listen( 0, '127.0.0.1', resolve ); } );

	let data = temporary_folder( 'consensus-worker-data-' );
	let settings = PARTICIPANTS.DefaultSettings( 0 );
	settings.Workers = [ { Name: 'Desk', Token: TOKEN } ];
	FS.writeFileSync( PATH.join( data, 'consensus.json' ), JSON.stringify( settings, null, '\t' ) );
	running = await SERVER.Start( { Data: data, Port: 0, Workers: { WaitSeconds: 1 } } );
} );


TEST.after( async function ()
{
	await running.Close();
	await new Promise( function ( resolve ) { ollama.close( resolve ); } );
	for ( let folder of folders )
	{
		FS.rmSync( folder, { recursive: true, force: true } );
	}
} );


//---------------------------------------------------------------------

TEST( 'workspace: glob, grep and read within Root, its Exclude and .gitignore; outside, left out or binary is refused', function ()
{
	let workspace = WORKSPACE.Open( { Name: 'Code', Root: root, Exclude: [ 'private/**' ] } );
	ASSERT.deepEqual( workspace.Files(), [ '.gitignore', 'a.js', 'image.bin', 'src/b.md' ] );
	ASSERT.equal( workspace.Glob( '**/*.js' ), 'a.js' );
	ASSERT.equal( workspace.Glob( 'src/*.md' ), 'src/b.md' );
	ASSERT.match( workspace.Glob( '*.py' ), /^no files match/ );
	ASSERT.equal( workspace.Grep( 'heron', null, true ), 'a.js:1: const HERON = 1;\na.js:4: \treturn HERON;\nsrc/b.md:3: The heron waits.' );
	ASSERT.equal( workspace.Grep( 'heron', '*.md' ), 'src/b.md:3: The heron waits.' );
	ASSERT.match( workspace.Grep( '(' ), /^refused: the Pattern is not a regular expression/ );
	ASSERT.equal( workspace.Read( 'a.js', 2, 2 ), '     2\tfunction wade()\n     3\t{\n… lines 4 to 6 not shown' );
	ASSERT.match( workspace.Read( PATH.join( root, 'src', 'b.md' ) ), /The heron waits/ );
	ASSERT.match( workspace.Read( '../outside.txt' ), /^refused:/ );
	ASSERT.match( workspace.Read( 'secret.txt' ), /^refused:/ );
	ASSERT.match( workspace.Read( 'private/notes.md' ), /^refused:/ );
	ASSERT.match( workspace.Read( 'image.bin' ), /^refused: image.bin is larger than 512 KB, or binary/ );
} );


TEST( 'settings: Validate names what is wrong; DefaultSettings is valid once it has a real Url', function ()
{
	ASSERT.deepEqual( WORKER.Validate( WORKER.DefaultSettings() ), [] );
	let problems = WORKER.Validate( { Name: 'a/b', Consensus: { Url: 'cube4', Token: 'short' }, MaxRounds: 0, Items: [ { Kind: 'Workspace', Name: 'W', Root: 'relative' }, { Kind: 'Inference', Name: 'O', Type: 'ollama' }, { Kind: 'Other' } ] } );
	ASSERT.deepEqual( problems, [
		'Name must be a name without "/"',
		'Consensus.Url must start with http:// or https://',
		'Consensus.Token must be a string of 16 characters or more',
		'MaxRounds must be a number above 0',
		'Workspace "W" needs an absolute Root',
		'Inference "O" of type ollama needs a Url',
		'an item\'s Kind must be Workspace or Inference',
	] );
} );


TEST( 'a review job: the worker says hello, takes the job, runs its tools, posts the answer; its page shows it all', async function ()
{
	let worker = await start_worker( {
		Runner: async function ( job, tools )
		{
			ASSERT.match( job.Prompt, /# Your tools/ );
			let code = await tools.Call( 'read', { Path: 'a.js' } );
			ASSERT.match( code, /HERON/ );
			let listed = await tools.Call( 'list_project', {} );
			ASSERT.match( listed, /Review plan/ );
			let refused = await tools.Call( 'read', { Path: 'private/notes.md' } );
			ASSERT.match( refused, /^refused:/ );
			let thread = /## Thread (thr-[0-9a-z-]+)/.exec( job.Prompt )[ 1 ];
			return { Answer: { Actions: [ { Thread: thread, Kind: 'reply', Reply: 'The code agrees: HERON is 1.' } ] }, Usage: { Model: 'stand-in', Input: 10, Output: 2 } };
		},
	} );
	try
	{
		let made = await plan_with_question( 'Review' );
		let destinations = ( await call( 'GET', '/api/llm/destinations' ) ).Body.Destinations;
		ASSERT.ok( destinations.some( function ( destination ) { return destination.Name === 'Desk / Ollama' && !destination.Offline; } ) );
		let models = await call( 'GET', '/api/llm/models?destination=' + encodeURIComponent( 'Desk / Ollama' ) );
		ASSERT.deepEqual( models.Body.Models, [ 'fake-model' ] );

		let sent = await call( 'POST', '/api/proposals/' + made.Plan.Id + '/session', { Destination: 'Desk / Claude' } );
		ASSERT.equal( sent.Status, 202 );
		let after = await idle( made.Plan.Id );
		let thread = after.Threads.find( function ( candidate ) { return candidate.Id === made.Thread.Id; } );
		ASSERT.equal( thread.Replies[ 1 ].Text, 'The code agrees: HERON is 1.' );
		let steps = await last_steps( made.Plan.Id );
		ASSERT.ok( steps.includes( 'Read a.js' ) );
		ASSERT.ok( steps.includes( 'list_project' ) );
		ASSERT.ok( steps.some( function ( text ) { return /stand-in answered on Desk: 1 reply/.test( text ); } ) );

		let page = await ( await fetch( worker.Url + '/api/state' ) ).json();
		ASSERT.equal( page.Name, 'Desk' );
		ASSERT.equal( page.Consensus.Connected, true );
		ASSERT.equal( page.Current, null );
		let record = page.Jobs[ 0 ];
		ASSERT.equal( record.Status, 'done' );
		ASSERT.equal( record.Title, 'Review plan' );
		ASSERT.deepEqual( record.Calls.map( function ( one ) { return one.Text; } ), [ 'Read a.js', 'list_project', 'Read private/notes.md' ] );
		ASSERT.match( record.Calls[ 0 ].Result, /HERON/ );
		ASSERT.equal( record.Answer.Actions[ 0 ].Kind, 'reply' );
		ASSERT.deepEqual( record.Carried, { Actions: 1, Refused: {} } );
		ASSERT.deepEqual( page.Workspaces, [ { Name: 'Code', Root: root, Build: false } ] );
	}
	finally
	{
		await worker.Close();
	}
} );


TEST( 'ollama: the loop runs the tools the model calls, then asks once more with the answer\'s schema', async function ()
{
	let worker = await start_worker();
	try
	{
		let made = await plan_with_question( 'Ollama' );
		ollama_requests = [];
		ollama_replies = [
			{ message: { role: 'assistant', content: '', tool_calls: [ { function: { name: 'grep', arguments: { Pattern: 'HERON' } } }, { function: { name: 'read_plan', arguments: '{"Plan":"Ollama plan"}' } } ] }, prompt_eval_count: 100, eval_count: 10 },
			{ message: { role: 'assistant', content: 'I have what I need.' }, prompt_eval_count: 200, eval_count: 20 },
			{ message: { role: 'assistant', content: JSON.stringify( { Actions: [ { Thread: made.Thread.Id, Kind: 'reply', Reply: 'Grep found HERON twice.' } ] } ) }, prompt_eval_count: 300, eval_count: 30 },
		];
		let sent = await call( 'POST', '/api/proposals/' + made.Plan.Id + '/session', { Destination: 'Desk / Ollama', Model: 'fake-model' } );
		ASSERT.equal( sent.Status, 202 );
		let after = await idle( made.Plan.Id );
		ASSERT.equal( after.Threads.find( function ( thread ) { return thread.Id === made.Thread.Id; } ).Replies[ 1 ].Text, 'Grep found HERON twice.' );
		ASSERT.equal( ollama_requests.length, 3 );
		ASSERT.ok( ollama_requests[ 0 ].tools.some( function ( tool ) { return tool.function.name === 'grep'; } ) );
		ASSERT.ok( ollama_requests[ 0 ].tools.some( function ( tool ) { return tool.function.name === 'read_plan'; } ) );
		let tool_messages = ollama_requests[ 1 ].messages.filter( function ( message ) { return message.role === 'tool'; } );
		ASSERT.equal( tool_messages[ 0 ].content, 'a.js:1: const HERON = 1;\na.js:4: \treturn HERON;' );
		ASSERT.equal( tool_messages[ 1 ].content, TEXT );
		ASSERT.equal( ollama_requests[ 2 ].tools, undefined );
		ASSERT.ok( ollama_requests[ 2 ].format.properties.Actions );
		let steps = await last_steps( made.Plan.Id );
		ASSERT.ok( steps.some( function ( text ) { return /fake-model answered on Desk: 1 reply/.test( text ); } ) );
		let usage = worker.State().Jobs[ 0 ].Usage;
		ASSERT.deepEqual( usage, { Model: 'fake-model', Input: 600, Output: 60 } );
	}
	finally
	{
		await worker.Close();
	}
} );


TEST( 'claude-cli: claude -p runs in the workspace, restricted to its read tools; its stream\'s tool calls are logged', async function ()
{
	let seen = PATH.join( temporary_folder( 'consensus-fake-claude-' ), 'seen.json' );
	let fake = PATH.join( PATH.dirname( seen ), 'fake-claude.js' );
	FS.writeFileSync( fake, [
		'const FS = require( "fs" );',
		'let input = "";',
		'process.stdin.on( "data", function ( chunk ) { input += chunk; } );',
		'process.stdin.on( "end", function () {',
		'	let args = process.argv.slice( 2 );',
		'	let config_file = args[ args.indexOf( "--mcp-config" ) + 1 ];',
		'	let config = JSON.parse( FS.readFileSync( config_file, "utf8" ) );',
		'	FS.writeFileSync( ' + JSON.stringify( seen ) + ', JSON.stringify( { Args: args, Cwd: process.cwd(), Prompt: input, Config: config, ConfigFile: config_file } ) );',
		'	let thread = /## Thread (thr-[0-9a-z-]+)/.exec( input )[ 1 ];',
		'	let lines = [',
		'		{ type: "system", subtype: "init" },',
		'		{ type: "assistant", message: { content: [ { type: "tool_use", id: "t1", name: "Read", input: { file_path: process.cwd() + "/a.js", offset: 1, limit: 3 } } ] } },',
		'		{ type: "user", message: { content: [ { type: "tool_result", tool_use_id: "t1", content: "     1\\tconst HERON = 1;" } ] } },',
		'		{ type: "assistant", message: { content: [ { type: "tool_use", id: "t2", name: "mcp__consensus__read_plan", input: { Plan: "Claude plan" } } ] } },',
		'		{ type: "user", message: { content: [ { type: "tool_result", tool_use_id: "t2", content: [ { type: "text", text: "the plan" } ] } ] } },',
		'		{ type: "result", subtype: "success", is_error: false, structured_output: { Actions: [ { Thread: thread, Kind: "reply", Reply: "Read it." } ] }, usage: { input_tokens: 5, cache_read_input_tokens: 5, output_tokens: 3 }, modelUsage: { "claude-stand-in": {} } },',
		'	];',
		'	for ( let line of lines ) { process.stdout.write( JSON.stringify( line ) + "\\n" ); }',
		'} );',
	].join( '\n' ) );
	let worker = await start_worker( { ClaudeCommand: [ process.execPath, fake ] } );
	try
	{
		let made = await plan_with_question( 'Claude' );
		let sent = await call( 'POST', '/api/proposals/' + made.Plan.Id + '/session', { Destination: 'Desk / Claude' } );
		ASSERT.equal( sent.Status, 202 );
		let after = await idle( made.Plan.Id );
		ASSERT.equal( after.Threads.find( function ( thread ) { return thread.Id === made.Thread.Id; } ).Replies[ 1 ].Text, 'Read it.' );

		let what = JSON.parse( FS.readFileSync( seen, 'utf8' ) );
		ASSERT.equal( FS.realpathSync( what.Cwd ), FS.realpathSync( root ) );
		ASSERT.match( what.Prompt, /# Your tools/ );
		let args = what.Args;
		function after_flag( flag )
		{
			return args[ args.indexOf( flag ) + 1 ];
		}
		ASSERT.ok( args.includes( '-p' ) );
		ASSERT.ok( args.includes( '--restricted' ) );
		ASSERT.ok( args.includes( '--strict-mcp-config' ) );
		ASSERT.equal( after_flag( '--tools' ), 'Read,Grep,Glob' );
		ASSERT.equal( after_flag( '--allowedTools' ), 'Read,Grep,Glob,mcp__consensus' );
		ASSERT.equal( after_flag( '--permission-mode' ), 'dontAsk' );
		ASSERT.equal( after_flag( '--output-format' ), 'stream-json' );
		ASSERT.equal( after_flag( '--max-turns' ), '5' );
		ASSERT.equal( after_flag( '--disallowedTools' ), 'Read(private/**)' );
		ASSERT.ok( JSON.parse( after_flag( '--json-schema' ) ).properties.Actions );
		let server = what.Config.mcpServers.consensus;
		ASSERT.deepEqual( server.args.slice( -1 ), [ '--mcp' ] );
		ASSERT.equal( server.env.CONSENSUS_WORKER_URL, running.Url );
		ASSERT.equal( server.env.CONSENSUS_WORKER_TOKEN, TOKEN );
		ASSERT.equal( FS.existsSync( what.ConfigFile ), false );

		let steps = await last_steps( made.Plan.Id );
		ASSERT.ok( steps.includes( 'Read a.js lines 1 to 3' ) );
		ASSERT.ok( steps.includes( 'read_plan "Claude plan"' ) );
		ASSERT.ok( steps.some( function ( text ) { return /claude-stand-in answered on Desk: 1 reply/.test( text ); } ) );
		let record = worker.State().Jobs[ 0 ];
		ASSERT.equal( record.Calls[ 0 ].Result, '     1\tconst HERON = 1;' );
		ASSERT.equal( record.Calls[ 1 ].Result, 'the plan' );
	}
	finally
	{
		await worker.Close();
	}
} );


TEST( 'mcp: bin/worker.js --mcp answers initialize, tools/list and tools/call through Consensus\'s tool route', async function ()
{
	let job = null;
	let worker = await start_worker( {
		Runner: async function ( given, tools, context )
		{
			job = given;
			await new Promise( function ( resolve ) { context.Signal.addEventListener( 'abort', resolve ); } );
			throw new Error( 'stopped' );
		},
	} );
	try
	{
		let made = await plan_with_question( 'Mcp' );
		await call( 'POST', '/api/proposals/' + made.Plan.Id + '/session', { Destination: 'Desk / Claude' } );
		await wait_until( function () { return job; }, 'the job to be taken' );
		let child = CHILD_PROCESS.spawn( process.execPath, [ PATH.join( __dirname, '..', 'bin', 'worker.js' ), '--mcp' ], {
			env: Object.assign( {}, process.env, { CONSENSUS_WORKER_URL: running.Url, CONSENSUS_WORKER_TOKEN: TOKEN, CONSENSUS_WORKER_JOB: job.Id } ),
		} );
		let replies = [];
		let buffer = '';
		child.stdout.on( 'data', function ( chunk )
		{
			buffer += chunk;
			let lines = buffer.split( '\n' );
			buffer = lines.pop();
			for ( let line of lines )
			{
				replies.push( JSON.parse( line ) );
			}
		} );
		function send( message )
		{
			child.stdin.write( JSON.stringify( message ) + '\n' );
		}
		send( { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test' } } } );
		send( { jsonrpc: '2.0', method: 'notifications/initialized' } );
		send( { jsonrpc: '2.0', id: 2, method: 'tools/list' } );
		send( { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'read_plan', arguments: { Plan: 'Mcp plan' } } } );
		send( { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'write_file', arguments: {} } } );
		await wait_until( function () { return replies.length >= 4; }, 'the MCP replies' );
		child.stdin.end();
		let by_id = {};
		for ( let reply of replies )
		{
			by_id[ reply.id ] = reply;
		}
		ASSERT.equal( by_id[ 1 ].result.serverInfo.name, 'consensus' );
		ASSERT.deepEqual( by_id[ 2 ].result.tools.map( function ( tool ) { return tool.name; } ), [ 'list_project', 'read_plan', 'read_revision', 'search' ] );
		ASSERT.equal( by_id[ 3 ].result.content[ 0 ].text, TEXT );
		ASSERT.equal( by_id[ 4 ].result.isError, true );
		await ( await fetch( worker.Url + '/api/cancel', { method: 'POST' } ) ).json();
		await idle( made.Plan.Id );
	}
	finally
	{
		await worker.Close();
	}
} );


TEST( 'the page: pause holds a job back, resume takes it; cancel ends it with the reason on its threads', async function ()
{
	let started = false;
	let worker = await start_worker( {
		Runner: async function ( job, tools, context )
		{
			started = true;
			await new Promise( function ( resolve ) { context.Signal.addEventListener( 'abort', resolve ); } );
			throw new Error( 'stopped' );
		},
	} );
	try
	{
		let made = await plan_with_question( 'Pause' );
		let paused = await ( await fetch( worker.Url + '/api/pause', { method: 'POST' } ) ).json();
		ASSERT.equal( paused.Paused, true );
		await new Promise( function ( resolve ) { setTimeout( resolve, 1200 ); } );
		await call( 'POST', '/api/proposals/' + made.Plan.Id + '/session', { Destination: 'Desk / Claude' } );
		await new Promise( function ( resolve ) { setTimeout( resolve, 1500 ); } );
		ASSERT.equal( started, false );
		await fetch( worker.Url + '/api/resume', { method: 'POST' } );
		await wait_until( function () { return started; }, 'the job to start after resume' );
		let current = ( await ( await fetch( worker.Url + '/api/state' ) ).json() ).Current;
		ASSERT.equal( current.Title, 'Pause plan' );
		ASSERT.equal( current.Status, 'running' );
		let cancelled = await fetch( worker.Url + '/api/cancel', { method: 'POST' } );
		ASSERT.equal( cancelled.status, 200 );
		let after = await idle( made.Plan.Id );
		let thread = after.Threads.find( function ( candidate ) { return candidate.Id === made.Thread.Id; } );
		ASSERT.match( thread.CallFailed.Reason, /cancelled on the worker/ );
		ASSERT.equal( worker.State().Jobs[ 0 ].Status, 'cancelled' );
		let none = await fetch( worker.Url + '/api/cancel', { method: 'POST' } );
		ASSERT.equal( none.status, 409 );
	}
	finally
	{
		await worker.Close();
	}
} );


//---------------------------------------------------------------------
// Build (plan Build): in the workspace as it is; git only when the owner presses Commit or Push.

function git( cwd, args )
{
	return CHILD_PROCESS.execFileSync( 'git', args, { cwd: cwd, encoding: 'utf8' } ).trim();
}


TEST( 'build settings: Build.Commands is a list of commands, Build.Remote a name', function ()
{
	let settings = { Name: 'Desk', Consensus: { Url: 'http://x', Token: TOKEN } };
	settings.Items = [ { Kind: 'Workspace', Name: 'W', Root: root, Build: { Commands: [] } } ];
	ASSERT.deepEqual( WORKER.Validate( settings ), [ 'Workspace "W": Build.Commands must be a list of commands, such as "npm test", without parentheses' ] );
	settings.Items = [ { Kind: 'Workspace', Name: 'W', Root: root, Build: { Commands: [ 'npm test' ], Remote: '' } } ];
	ASSERT.deepEqual( WORKER.Validate( settings ), [ 'Workspace "W": Build.Remote must be a remote\'s name' ] );
	settings.Items = [ { Kind: 'Workspace', Name: 'W', Root: root, Build: { Commands: [ 'npm test' ], Remote: 'origin' } } ];
	ASSERT.deepEqual( WORKER.Validate( settings ), [] );
} );


TEST( 'the Bash guard: only an allowed command, with arguments, and nothing chained; bin/worker.js --bash-guard exits 2 for the rest', function ()
{
	let commands = [ 'node --test', 'npm test' ];
	for ( let allowed of [ 'node --test', 'node --test test/a.test.js', 'npm test' ] )
	{
		ASSERT.equal( WORKER.BashAllowed( allowed, commands ), true, allowed );
	}
	for ( let refused of [ 'git status', 'npm testing', 'node --test && git push', 'npm test | tee x', 'node --test; rm -rf .', 'echo $( git log )', 'node --test > out.txt', '' ] )
	{
		ASSERT.equal( WORKER.BashAllowed( refused, commands ), false, refused );
	}
	function guard( command )
	{
		return CHILD_PROCESS.spawnSync( process.execPath, [ PATH.join( __dirname, '..', 'bin', 'worker.js' ), '--bash-guard' ], {
			input: JSON.stringify( { tool_name: 'Bash', tool_input: { command: command } } ),
			env: Object.assign( {}, process.env, { CONSENSUS_WORKER_COMMANDS: JSON.stringify( commands ) } ),
			encoding: 'utf8',
		} );
	}
	ASSERT.equal( guard( 'node --test' ).status, 0 );
	let refused = guard( 'git status' );
	ASSERT.equal( refused.status, 2 );
	ASSERT.match( refused.stderr, /may run only these commands/ );
} );


TEST( 'build: claude -p edits the workspace in place with its allowed commands; no branch, no commit until the owner presses Commit and Push', async function ()
{
	// A scratch repository with one commit, and a bare one as its origin.
	let repo = temporary_folder( 'consensus-build-repo-' );
	let origin = temporary_folder( 'consensus-build-origin-' );
	git( origin, [ 'init', '--bare', '-q' ] );
	git( repo, [ 'init', '-q' ] );
	git( repo, [ 'config', 'user.name', 'Build Test' ] );
	git( repo, [ 'config', 'user.email', 'build@test.invalid' ] );
	git( repo, [ 'config', 'commit.gpgsign', 'false' ] );
	FS.writeFileSync( PATH.join( repo, 'readme.md' ), '# Repo\n' );
	git( repo, [ 'add', '-A' ] );
	git( repo, [ 'commit', '-q', '-m', 'first' ] );
	git( repo, [ 'remote', 'add', 'origin', origin ] );
	let branch = git( repo, [ 'rev-parse', '--abbrev-ref', 'HEAD' ] );
	let first = git( repo, [ 'rev-parse', 'HEAD' ] );

	// The stand-in claude: it writes a file where it runs, as an Edit would, and answers with a build log.
	let seen = PATH.join( temporary_folder( 'consensus-fake-build-' ), 'seen.json' );
	let fake = PATH.join( PATH.dirname( seen ), 'fake-claude.js' );
	FS.writeFileSync( fake, [
		'const FS = require( "fs" );',
		'let input = "";',
		'process.stdin.on( "data", function ( chunk ) { input += chunk; } );',
		'process.stdin.on( "end", function () {',
		'	FS.writeFileSync( ' + JSON.stringify( seen ) + ', JSON.stringify( { Args: process.argv.slice( 2 ), Cwd: process.cwd(), Prompt: input, Commands: process.env.CONSENSUS_WORKER_COMMANDS } ) );',
		'	FS.writeFileSync( "built.js", "module.exports = 1;\\n" );',
		'	let lines = [',
		'		{ type: "assistant", message: { content: [ { type: "tool_use", id: "t1", name: "Write", input: { file_path: process.cwd() + "/built.js", content: "module.exports = 1;" } } ] } },',
		'		{ type: "user", message: { content: [ { type: "tool_result", tool_use_id: "t1", content: "written" } ] } },',
		'		{ type: "assistant", message: { content: [ { type: "tool_use", id: "t2", name: "Bash", input: { command: "node --test" } } ] } },',
		'		{ type: "user", message: { content: [ { type: "tool_result", tool_use_id: "t2", content: "# pass 1" } ] } },',
		'		{ type: "result", subtype: "success", is_error: false, structured_output: { BuildLog: "Built built.js; node --test passes.", Context: "", Threads: [] }, usage: { input_tokens: 50, output_tokens: 9 }, modelUsage: { "claude-builder": {} } },',
		'	];',
		'	for ( let line of lines ) { process.stdout.write( JSON.stringify( line ) + "\\n" ); }',
		'} );',
	].join( '\n' ) );

	let settings = worker_settings();
	settings.Items.push( { Kind: 'Workspace', Name: 'Repo', Root: repo, Exclude: [ 'secret/**' ], Build: { Remote: 'origin', Commands: [ 'node --test', 'npm test' ] } } );
	let worker = await start_worker( { Settings: settings, ClaudeCommand: [ process.execPath, fake ] } );
	try
	{
		let project = ( await call( 'POST', '/api/projects', { Name: 'Build repo' } ) ).Body.Project;
		await wait_until( async function ()
		{
			return ( await call( 'PUT', '/api/projects/' + project.Id + '/workspace', { Worker: 'Desk', Name: 'Repo' } ) ).Status === 200;
		}, 'the worker to offer Repo' );
		let plan = ( await call( 'POST', '/api/proposals', { Title: 'Build plan', Text: TEXT, Project: project.Id } ) ).Body.Proposal;
		let view = ( await call( 'GET', '/api/proposals/' + plan.Id ) ).Body.Build;
		ASSERT.equal( view.Ready, true );
		ASSERT.deepEqual( view.Destinations, [ { Name: 'Desk / Claude', Model: null } ] );
		let started = await call( 'POST', '/api/proposals/' + plan.Id + '/build', {} );
		ASSERT.equal( started.Status, 202 );
		let after = await idle( plan.Id );

		let what = JSON.parse( FS.readFileSync( seen, 'utf8' ) );
		ASSERT.equal( FS.realpathSync( what.Cwd ), FS.realpathSync( repo ) );
		function after_flag( flag )
		{
			return what.Args[ what.Args.indexOf( flag ) + 1 ];
		}
		ASSERT.equal( after_flag( '--tools' ), 'Read,Grep,Glob,Edit,Write,Bash' );
		ASSERT.equal( after_flag( '--allowedTools' ), 'Read,Grep,Glob,Edit,Write,mcp__consensus,Bash(node --test:*),Bash(npm test:*)' );
		ASSERT.ok( what.Args.includes( '--restricted' ) );
		ASSERT.ok( what.Args.includes( 'Read(secret/**)' ) && what.Args.includes( 'Edit(secret/**)' ) );
		ASSERT.deepEqual( JSON.parse( after_flag( '--json-schema' ) ).required, [ 'BuildLog' ] );
		ASSERT.match( what.Prompt, /# The plan to build: "Build plan"/ );
		ASSERT.match( what.Prompt, /# The commands you may run\n\n- node --test\n- npm test\n$/ );
		ASSERT.equal( what.Commands, JSON.stringify( [ 'node --test', 'npm test' ] ) );
		let hook = JSON.parse( after_flag( '--settings' ) ).hooks.PreToolUse[ 0 ];
		ASSERT.equal( hook.matcher, 'Bash' );
		ASSERT.match( hook.hooks[ 0 ].command, /bin\/worker\.js" --bash-guard$/ );

		let log = after.Threads.find( function ( thread ) { return thread.Build && thread.Build.Log; } );
		ASSERT.match( log.Replies[ 0 ].Text, /Built built\.js; node --test passes\./ );
		let record = worker.State().Jobs[ 0 ];
		ASSERT.equal( record.Kind, 'Build' );
		ASSERT.deepEqual( record.Calls.map( function ( one ) { return one.Text; } ), [ 'Write built.js', 'Bash node --test' ] );

		// The file changed in place; no branch, no commit.
		ASSERT.equal( FS.readFileSync( PATH.join( repo, 'built.js' ), 'utf8' ), 'module.exports = 1;\n' );
		ASSERT.equal( git( repo, [ 'rev-parse', 'HEAD' ] ), first );
		ASSERT.deepEqual( git( repo, [ 'branch', '--format=%(refname:short)' ] ).split( '\n' ), [ branch ] );

		// Commit waits for the owner to accept the build.
		let early = await fetch( worker.Url + '/api/jobs/' + record.Id + '/commit', { method: 'POST' } );
		ASSERT.equal( early.status, 409 );
		ASSERT.equal( ( await early.json() ).Error, 'the build is not accepted yet' );
		await call( 'POST', '/api/proposals/' + plan.Id + '/threads/' + log.Id + '/resolve' );
		await wait_until( function () { return worker.State().Jobs[ 0 ].Accepted; }, 'the worker to hear the build was accepted' );

		ASSERT.equal( ( await fetch( worker.Url + '/api/jobs/' + record.Id + '/commit', { method: 'POST' } ) ).status, 200 );
		ASSERT.equal( ( await fetch( worker.Url + '/api/jobs/' + record.Id + '/push', { method: 'POST' } ) ).status, 200 );
		await worker.Settled();
		let steps = worker.State().Jobs[ 0 ].Git;
		ASSERT.deepEqual( steps.map( function ( step ) { return step.Status; } ), [ 'done', 'done' ] );
		let hash = git( repo, [ 'rev-parse', '--short', 'HEAD' ] );
		ASSERT.equal( steps[ 0 ].Result, 'Committed ' + hash );
		ASSERT.equal( steps[ 1 ].Result, 'Pushed ' + branch + ' to origin' );
		ASSERT.equal( git( repo, [ 'log', '-1', '--format=%B' ] ), 'Build plan\n\nBuilt built.js; node --test passes.' );
		ASSERT.equal( git( repo, [ 'show', '--name-only', '--format=', 'HEAD' ] ), 'built.js' );
		ASSERT.equal( git( origin, [ 'rev-parse', branch ] ), git( repo, [ 'rev-parse', 'HEAD' ] ) );
		let runs = ( await call( 'GET', '/api/proposals/' + plan.Id + '/runs' ) ).Body.Runs;
		let texts = runs[ runs.length - 1 ].Steps.map( function ( step ) { return step.Text; } );
		await wait_until( async function ()
		{
			let now = ( await call( 'GET', '/api/proposals/' + plan.Id + '/runs' ) ).Body.Runs;
			texts = now[ now.length - 1 ].Steps.map( function ( step ) { return step.Text; } );
			return texts.includes( 'Pushed ' + branch + ' to origin' );
		}, 'the push in the run log' );
		ASSERT.ok( texts.includes( 'Committed ' + hash ) );

		// Nothing more to commit: said, not hidden.
		await fetch( worker.Url + '/api/jobs/' + record.Id + '/commit', { method: 'POST' } );
		await worker.Settled();
		let last = worker.State().Jobs[ 0 ].Git.slice( -1 )[ 0 ];
		ASSERT.equal( last.Status, 'failed' );
		ASSERT.match( last.Result, /^Commit failed: / );
	}
	finally
	{
		await worker.Close();
	}
} );
