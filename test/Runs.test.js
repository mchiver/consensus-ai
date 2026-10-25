'use strict';

// The LLM connections and the runs in the server (plan Run Shapes, Step 3; from Consensus Desktop, Step 3): the
// connections filled and checked (Llms.js), each a speaker of the server (Participants.js: its runs post as the
// owner through it, "<connection> by <owner>"), the
// package (Package.js), the check and the command line (Llm.js), the records of a run (Runs.js) and the files of a
// folder (Files.js). Nothing here needs Electron; the last test starts a server over a read-only store (plan
// Rearchitecturation, Step 4) and runs a connection through it.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const FS = require( 'fs' );
const OS = require( 'os' );
const PATH = require( 'path' );
const LLMS = require( '../src/Llms.js' );
const PARTICIPANTS = require( '../src/Participants.js' );
const PACKAGE = require( '../src/Package.js' );
const TASKS = require( '../src/Tasks.js' );
const LLM = require( '../src/Llm.js' );
const RUNS = require( '../src/Runs.js' );
const FILES = require( '../src/Files.js' );
const STORE = require( '../src/Store.js' );
const SERVER = require( '../src/Server.js' );		// plan Rearchitecturation, Step 4: a run from a read-only store's server

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
		FS.rmSync( folder, { recursive: true, force: true } );
	}
} );


//---------------------------------------------------------------------
// The connections

TEST( 'an LLM connection is filled in with an id and the defaults, no token, named by its kind when unnamed, and its problems are named', function ()
{
	let claude = LLMS.Fill( { Name: ' claude-cli ', Model: 'sonnet', Timeout: '120', Checks: { Readme: false }, Prompts: { Review: 'old', Session: 'Be brief.' } } );
	ASSERT.match( claude.Id, /^llm-[0-9a-z]{3}-[0-9a-z]{3}-[0-9a-z]{3}$/ );
	ASSERT.equal( claude.Name, 'claude-cli' );
	ASSERT.equal( claude.Kind, 'claude-cli' );
	ASSERT.equal( claude.Command, 'claude' );
	ASSERT.deepEqual( claude.Arguments, LLMS.DEFAULT_ARGUMENTS );
	ASSERT.equal( claude.Timeout, 120 );
	ASSERT.equal( 'Checks' in claude, false );
	ASSERT.deepEqual( claude.Unchecked, { Documents: [], Threads: [] } );
	ASSERT.deepEqual( LLMS.Fill( { Name: 'u', Unchecked: { Documents: [ 'doc-1', ' ' ], Threads: 'thr-1\nthr-2' } } ).Unchecked, { Documents: [ 'doc-1' ], Threads: [ 'thr-1', 'thr-2' ] } );
	ASSERT.deepEqual( Object.keys( claude.Prompts ), [ 'Session' ] );
	ASSERT.equal( claude.Prompts.Session, 'Be brief.' );
	ASSERT.equal( 'Token' in claude, false );
	let local = LLMS.Fill( { Id: 'llm-aaa-bbb-ccc', Kind: 'ollama', Model: 'llama3', Token: 'a-token-from-before' } );
	ASSERT.equal( local.Id, 'llm-aaa-bbb-ccc' );
	ASSERT.equal( local.Name, 'ollama-llama3' );
	ASSERT.equal( local.Url, LLMS.DEFAULT_OLLAMA_URL );
	ASSERT.equal( local.Timeout, LLMS.DEFAULT_TIMEOUT );
	ASSERT.equal( local.Context, LLMS.DEFAULT_CONTEXT );
	ASSERT.equal( local.Rounds, LLMS.DEFAULT_ROUNDS );
	ASSERT.equal( 'Token' in local, false );
	ASSERT.equal( LLMS.Fill( { Name: 'o', Context: '8192', Rounds: 5.5 } ).Context, 8192 );
	ASSERT.equal( LLMS.Fill( { Name: 'o', Context: -1, Rounds: 'x' } ).Rounds, LLMS.DEFAULT_ROUNDS );
	ASSERT.equal( LLMS.Fill( {} ).Name, 'claude-cli' );
	ASSERT.equal( LLMS.DefaultName( 'ollama', 'kimi-k2.6:cloud' ), 'ollama-kimi-k2.6:cloud' );
	ASSERT.equal( LLMS.DefaultName( 'ollama', 'a model/here' ), 'ollama-a-model-here' );

	let settings = { Name: 'cube4', Owner: { Name: 'user', Display: 'User' }, Llms: [ claude, local ] };
	ASSERT.deepEqual( LLMS.Problems( settings ), [] );
	ASSERT.equal( LLMS.ById( settings, 'llm-aaa-bbb-ccc' ), local );
	ASSERT.equal( LLMS.ById( settings, 'nope' ), null );
	ASSERT.equal( LLMS.SpeakerName( claude, settings ), 'claude-cli by user' );
	ASSERT.equal( LLMS.SpeakerDisplay( claude, settings ), 'claude-cli by User' );
	ASSERT.deepEqual( LLMS.Public( local, settings, false ), { Id: 'llm-aaa-bbb-ccc', Name: 'ollama-llama3', Kind: 'ollama', Model: 'llama3', Speaker: 'ollama-llama3 by User' } );
	ASSERT.equal( 'Token' in LLMS.Public( local, settings, true ), false );
	ASSERT.equal( LLMS.Public( local, settings, true ).Speaker, 'ollama-llama3 by User' );

	let broken = {
		Name: 'srv',
		Llms: [ LLMS.Fill( { Name: 'a' } ), LLMS.Fill( { Name: 'a' } ), LLMS.Fill( { Name: 'o', Kind: 'ollama', Url: 'nowhere', Model: '' } ), LLMS.Fill( { Name: 'bad name' } ), LLMS.Fill( { Name: 'x' } ), { Name: '', Id: 'llm-1', Kind: 'claude-cli', Command: 'c' } ],
	};
	ASSERT.deepEqual( LLMS.Problems( broken ), [
		'LLM connection "a" is named twice',
		'LLM connection "o": the Url must start with http:// or https://',
		'LLM connection "o": a Model is needed',
		'LLM connection "bad name": the Name is letters, digits, dot, dash and colon',
		'an LLM connection has no Name',
	] );
	ASSERT.deepEqual( LLMS.Problems( { Llms: 'no' } ), [ 'Llms must be a list' ] );} );


TEST( 'every connection is a speaker of its server: listed after the owner, its runs identified by a run token the server minted', function ()
{
	let claude = LLMS.Fill( { Name: 'claude-cli' } );
	let settings = { Name: 'cube4', Owner: { Name: 'user', Display: 'User' }, Llms: [ claude ] };
	ASSERT.deepEqual( PARTICIPANTS.Speakers( settings ), [
		{ Name: 'user', Display: 'User', Role: 'owner', Owner: true },
		{ Name: 'claude-cli by user', Display: 'claude-cli by User', Role: 'llm', Llm: claude.Id },
	] );
	let tokens = PARTICIPANTS.RunTokens();
	let value = tokens.Mint( { Service: claude.Name, Name: 'Review run', Project: 'prj-1' } );
	let run = PARTICIPANTS.Identify( settings, { Authorization: 'Bearer ' + value }, tokens );
	ASSERT.deepEqual( [ run.Name, run.Service, run.Token, run.Speaker ], [ 'user', 'claude-cli', 'Review run', 'claude-cli by user' ] );
	ASSERT.equal( PARTICIPANTS.Identify( settings, { Authorization: 'Bearer nothing-like-it-0123456789' }, tokens ), null );
	ASSERT.equal( PARTICIPANTS.Identify( settings, { Authorization: '' }, tokens ).Speaker, 'user' );
	ASSERT.equal( PARTICIPANTS.Speakers( { Name: 'x' } ).length, 1 );
} );


//---------------------------------------------------------------------
// The package

TEST( 'the package is one prompt from the items the task switches on, in order, the task\'s prompt, and the connection\'s session prompt last', function ()
{
	let llm = LLMS.Fill( { Name: 'claude-cli', Prompts: { Session: 'Answer in English.' } } );
	let request = {
		Task: TASKS.DefaultOf( 'answer' ),
		Llm: llm,
		Server: { Url: 'http://cube4:3500/', Name: 'cube4' },
		Project: { Id: 'prj-1', Name: 'Consensus' },
		Plan: { Id: 'pln-1', Title: 'Step 3', State: 'Plan' },
		Folder: 'W:/code/repo',
		Owner: { Name: 'user', Display: 'User' },
		Service: 'claude-cli',
		Token: 'the-token-of-claude-cli-0123',
		Instructions: '# This server\n\n- API: http://cube4:3500/api\n',
		Readme: { Id: 'ctx-1', Title: 'Readme', Text: '# Consensus\n\nThe background.\n' },
		Documents: [ { Id: 'doc-1', Title: 'Notes' } ],
		Threads: [ { Id: 'thr-1', Status: 'contested', Anchor: { Text: 'a passage' }, Replies: [ { By: 'user', At: '2026-10-01T05:00:00.000Z', Text: 'Why?' } ] } ],
	};
	let text = PACKAGE.Build( request );
	let order = [ '# Answer: a one-shot from Consensus', 'You act for User, the owner of the Consensus server below', 'run once by that server "cube4" through its LLM connection "claude-cli": what you post reads "claude-cli by User".', '## This run', '- Task: Answer', '- Writes: consensus. You may change Consensus', '- Consensus API: http://cube4:3500/api', '- Your token, sent as "Authorization: Bearer <token>": the-token-of-claude-cli-0123', '- The plan at hand: Step 3 (pln-1), state Plan', '- The project\'s folder: W:/code/repo', '## Agent instructions', '# This server', '## Readme of Consensus (ctx-1)', 'The background.', '## Other documents of the Context folder', '- Notes (doc-1)', '## Threads of the plan waiting on claude-cli by User', '### Thread thr-1 (contested, on "a passage")', '**user**', 'Why?', '## Your task: Answer', 'Take your turn on the plan at hand', '## Further instructions', 'Answer in English.' ];
	let at = -1;
	for ( let piece of order )
	{
		let found = text.indexOf( piece, at + 1 );
		ASSERT.notEqual( found, -1, 'missing or out of order: ' + piece );
		at = found;
	}
	ASSERT.equal( text.includes( '## Your task: Work' ), false );

	// a task with every switch off carries its own prompt only; Work writes files and packages no threads
	let bare = TASKS.Fill( { Id: 'bare', Name: 'Bare', Package: { Instructions: false, Readme: false, Documents: false, Plan: false, Threads: false, Files: false }, Writes: 'files', Prompt: 'Do the thing.' } );
	let built = PACKAGE.Build( Object.assign( {}, request, { Task: bare } ) );
	ASSERT.equal( built.includes( '## Agent instructions' ), false );
	ASSERT.equal( built.includes( '## Readme' ), false );
	ASSERT.equal( built.includes( '## Threads' ), false );
	ASSERT.equal( built.includes( 'The plan at hand' ), false );
	ASSERT.match( built, /- Writes: files\. You may change Consensus and the project's files/ );
	ASSERT.match( built, /- No folder: this run has no files to work in\./ );
	ASSERT.match( built, /## Your task: Bare\n\nDo the thing\./ );
	let work = PACKAGE.Build( Object.assign( {}, request, { Task: TASKS.DefaultOf( 'work' ), Text: 'Not read: Work has no box.' } ) );
	ASSERT.match( work, /## Your task: Work\n\nBuild the plan at hand/ );
	ASSERT.equal( work.includes( '## Threads' ), false );
	ASSERT.equal( work.includes( 'Not read' ), false );
	// Enhance (Step 2): the person's instructions after the prompt, before the session prompt; no threads, no folder
	let enhance = PACKAGE.Build( Object.assign( {}, request, { Task: TASKS.DefaultOf( 'enhance' ), Text: ' Three sections, please. ' } ) );
	ASSERT.match( enhance, /## Your task: Enhance\n\nReplace the plan's text[^]*## Your instructions\n\nThree sections, please\.\n\n\n## Further instructions\n\nAnswer in English\./ );
	ASSERT.equal( enhance.includes( '## Threads' ), false );
	ASSERT.match( enhance, /- No folder/ );
	ASSERT.match( enhance, /- The plan at hand: Step 3/ );
	ASSERT.equal( PACKAGE.Build( Object.assign( {}, request, { Task: TASKS.DefaultOf( 'enhance' ), Text: '  ' } ) ).includes( 'Your instructions' ), false );
	// Explain (Step 4): the project's shape and the last runs under the Project switch, after the threads and before the task
	let shape = { Items: [ { Id: 'pln-1', Title: 'Step 3', Kind: 'plan', State: 'Plan', Tally: { Contested: 1, Resolved: 0, Applied: 2 }, Archived: false }, { Id: 'doc-1', Title: 'Notes', Kind: 'document', State: null, Tally: null, Archived: true } ], Runs: [ { Task: 'Work', By: 'user', Started: '2026-10-19T10:00:00.000Z', Status: 'done', Plan: 'Step 3' } ] };
	let explain = PACKAGE.Build( Object.assign( {}, request, { Task: TASKS.DefaultOf( 'explain' ), Text: 'Who resolved Step 3?', Shape: shape } ) );
	ASSERT.match( explain, /## The project\n\nEvery plan and document of Consensus[^]*\n- Step 3 \(pln-1\): Plan, contested 1, resolved 0, applied 2\n- Notes \(doc-1\): a document, archived\n\n\n## Runs\n\n[^]*\n- Work by user at 2026-10-19T10:00:00.000Z: done, on Step 3\n\n\n## Your task: Explain\n\nAnswer the question[^]*## Your instructions\n\nWho resolved Step 3\?/ );
	ASSERT.match( explain, /- Writes: none\. This run reads only/ );
	ASSERT.equal( explain.includes( 'The plan at hand' ), false );
	ASSERT.equal( explain.includes( '## Threads' ), false );
	ASSERT.equal( PACKAGE.Build( Object.assign( {}, request, { Shape: shape } ) ).includes( '## The project' ), false );
	ASSERT.match( PACKAGE.Build( Object.assign( {}, request, { Task: TASKS.DefaultOf( 'explain' ), Shape: { Items: [], Runs: [] } } ) ), /## The project\n\n[^\n]*\n\nNone\.\n\n\n## Runs\n\n[^\n]*\n\nNone\./ );
	// a session: no plan line, no threads, the session prompt as the task; no token for a local model
	let session = PACKAGE.Build( Object.assign( {}, request, { Task: TASKS.DefaultOf( 'session' ), Plan: null, Folder: null, Token: null } ) );
	ASSERT.equal( session.includes( 'No plan is selected' ), false );
	ASSERT.match( session, /- No folder/ );
	ASSERT.equal( session.includes( 'Your token' ), false );
	ASSERT.equal( session.includes( 'Your task: Answer' ), false );
	ASSERT.match( session, /## Your task\n\nAnswer in English\./ );
	// an Answer with no plan says so; a none task says it reads only
	ASSERT.match( PACKAGE.Build( Object.assign( {}, request, { Plan: null } ) ), /- No plan is selected\./ );
	ASSERT.match( PACKAGE.Build( Object.assign( {}, request, { Task: TASKS.Fill( { Id: 'ro', Name: 'Explain', Writes: 'none' } ) } ) ), /- Writes: none\. This run reads only/ );
	// a preview (no token yet) says the server makes one when the run starts
	ASSERT.match( PACKAGE.Build( Object.assign( {}, request, { Token: undefined } ) ), /Your token, sent as "Authorization: Bearer <token>": made by the server when the run starts/ );
	// a readme holding a fence is fenced with a longer one
	let fenced = PACKAGE.Build( Object.assign( {}, request, { Llm: LLMS.Fill( { Name: 'x' } ), Readme: { Id: 'ctx-1', Title: 'Readme', Text: 'a\n```\nb\n```\n' } } ) );
	ASSERT.match( fenced, /````\na\n```\nb\n```\n````/ );
} );

//---------------------------------------------------------------------
// The check and the command line

TEST( 'the check runs the command with --version, and the command line carries the arguments and the model', async function ()
{
	let llm = LLMS.Fill( { Name: 'node', Command: process.execPath, Model: 'sonnet' } );
	let checked = await LLM.Check( llm );
	ASSERT.equal( checked.Ok, true );
	ASSERT.match( checked.Result, /--version: v\d+/ );
	let missing = await LLM.Check( LLMS.Fill( { Name: 'nope', Command: PATH.join( OS.tmpdir(), 'no-such-command-here' ) } ) );
	ASSERT.equal( missing.Ok, false );
	ASSERT.match( missing.Error, /--version/ );
	let line = LLM.CommandLine( llm );
	ASSERT.equal( line.Command, process.execPath );
	ASSERT.deepEqual( line.Arguments, LLMS.DEFAULT_ARGUMENTS.concat( [ '--model', 'sonnet' ] ) );
	let ollama = await LLM.Check( LLMS.Fill( { Name: 'o', Kind: 'ollama', Url: 'http://127.0.0.1:1', Model: 'm' } ) );
	ASSERT.equal( ollama.Ok, false );
	ASSERT.match( ollama.Error, /does not answer/ );
} );


//---------------------------------------------------------------------
// The runs

async function settled( runs, id )
{
	let record = null;
	for ( let attempt = 0; attempt < 200 && ( !record || record.Status === 'running' || record.Status === 'queued' ); attempt++ )
	{
		await new Promise( function ( resolve ) { setTimeout( resolve, 50 ); } );
		record = runs.Read( id );
	}
	return record;
}


TEST( 'a run keeps its record: the prompt on stdin, the output, the exit, the duration, who asked; stopped and timed out runs say so', async function ()
{
	let folder = temporary_folder( 'consensus-runs-' );
	let runs = RUNS.Runs( { Folder: PATH.join( folder, 'runs' ) } );
	let echo = LLMS.Fill( { Name: 'echo', Command: process.execPath, Arguments: [ '-e', "let t='';process.stdin.on('data',function(c){t+=c});process.stdin.on('end',function(){process.stdout.write('got: '+t);process.stderr.write('noted')})" ], Timeout: 30 } );
	let heard = [];
	runs.OnChange( function ( summary ) { heard.push( summary.Status ); } );
	ASSERT.deepEqual( runs.List(), [] );
	ASSERT.throws( function () { runs.Start( { Llm: echo, Task: { Id: 'answer', Name: 'Answer' }, Writes: 'consensus', Prompt: 'x', Folder: { Path: PATH.join( folder, 'missing' ) } } ); }, /does not exist/ );

	let started = runs.Start( { Llm: echo, Task: { Id: 'answer', Name: 'Answer' }, Writes: 'consensus', By: 'user', Project: { Id: 'prj-1', Name: 'Consensus', Path: folder }, Plan: { Id: 'pln-1', Title: 'Step 3' }, Folder: { Path: folder, Include: [], Exclude: [], Commands: [] }, Prompt: 'hello there' } );
	ASSERT.deepEqual( [ started.Task, started.Writes, 'Kind' in started ], [ { Id: 'answer', Name: 'Answer' }, 'consensus', false ] );
	ASSERT.match( started.Id, /^run-/ );
	ASSERT.equal( started.Status, 'running' );
	ASSERT.equal( started.Prompt, undefined );
	ASSERT.equal( started.By, 'user' );
	ASSERT.deepEqual( runs.Running( echo.Id ), started );
	let record = await settled( runs, started.Id );
	ASSERT.equal( record.Status, 'done' );
	ASSERT.equal( record.Exit, 0 );
	ASSERT.equal( record.Error, null );
	ASSERT.equal( record.Prompt, 'hello there' );
	ASSERT.equal( record.Output, 'got: hello there\n--- stderr ---\nnoted' );
	ASSERT.equal( typeof record.Duration, 'number' );
	ASSERT.deepEqual( record.Plan, { Id: 'pln-1', Title: 'Step 3' } );
	ASSERT.deepEqual( record.Project, { Id: 'prj-1', Name: 'Consensus', Path: folder } );
	ASSERT.equal( record.Workspace, undefined );
	ASSERT.equal( runs.Running( echo.Id ), null );
	ASSERT.deepEqual( heard, [ 'running', 'done' ] );
	let listed = runs.List( echo.Id );
	ASSERT.equal( listed.length, 1 );
	ASSERT.equal( listed[ 0 ].Id, started.Id );
	ASSERT.equal( listed[ 0 ].Output, undefined );
	ASSERT.equal( listed[ 0 ].OutputLength, record.Output.length );
	ASSERT.deepEqual( runs.List( 'llm-other' ), [] );
	ASSERT.equal( FS.existsSync( PATH.join( folder, 'runs', started.Id + '.json' ) ), true );

	// a failing command
	let failing = LLMS.Fill( { Name: 'fail', Command: process.execPath, Arguments: [ '-e', 'process.stdout.write("partial");process.exit(3)' ] } );
	let failed = await settled( runs, runs.Start( { Llm: failing, Task: { Id: 'work', Name: 'Work' }, Writes: 'files', Prompt: '' } ).Id );
	ASSERT.equal( failed.Status, 'failed' );
	ASSERT.equal( failed.Exit, 3 );
	ASSERT.match( failed.Error, /exited 3/ );
	ASSERT.equal( failed.Output, 'partial' );

	// stopped, and timed out
	let sleeper = LLMS.Fill( { Name: 'sleep', Command: process.execPath, Arguments: [ '-e', 'setTimeout(function(){},60000)' ], Timeout: 60 } );
	let sleeping = runs.Start( { Llm: sleeper, Task: { Id: 'session', Name: 'Session' }, Writes: 'files', Prompt: '' } );
	ASSERT.equal( runs.Stop( sleeping.Id ), true );
	ASSERT.equal( runs.Stop( 'run-nothing' ), false );
	ASSERT.equal( ( await settled( runs, sleeping.Id ) ).Status, 'stopped' );
	let slow = LLMS.Fill( { Name: 'slow', Command: process.execPath, Arguments: [ '-e', 'setTimeout(function(){},60000)' ], Timeout: 1 } );
	let timed = await settled( runs, runs.Start( { Llm: slow, Task: { Id: 'session', Name: 'Session' }, Writes: 'files', Prompt: '' } ).Id );
	ASSERT.equal( timed.Status, 'failed' );
	ASSERT.match( timed.Error, /longer than 1 seconds/ );
	ASSERT.equal( runs.List().length, 4 );
	ASSERT.equal( runs.List()[ 0 ].Id, timed.Id );
	ASSERT.equal( runs.Read( 'run-nothing' ), null );
	await runs.Close();
} );


TEST( 'one run per connection and per plan at a time (plan Multiuser, Step 3): a second press queues behind the first and is told so, is packaged again and runs when its turn comes; a queued run is stopped out of the line; other plans on other connections go together', async function ()
{
	let folder = temporary_folder( 'consensus-queue-' );
	let runs = RUNS.Runs( { Folder: PATH.join( folder, 'runs' ) } );
	const ECHO = [ '-e', "let t='';process.stdin.on('data',function(c){t+=c});process.stdin.on('end',function(){process.stdout.write('got: '+t)})" ];
	let echo = LLMS.Fill( { Name: 'echo', Command: process.execPath, Arguments: ECHO } );
	let other = LLMS.Fill( { Name: 'other', Command: process.execPath, Arguments: ECHO } );
	let heard = [];
	runs.OnChange( function ( summary ) { heard.push( summary.Id + ' ' + summary.Status ); } );
	let first = runs.Start( { Llm: echo, Task: { Id: 'work', Name: 'Work' }, Writes: 'consensus', Plan: { Id: 'pln-1', Title: 'One' }, Prompt: 'first' } );
	ASSERT.deepEqual( [ first.Status, first.Queued, first.Behind ], [ 'running', null, null ] );
	// the connection is busy: the second waits, told what for, and is packaged afresh when it starts
	let prepared = 0;
	let second = runs.Start( { Llm: echo, Task: { Id: 'answer', Name: 'Answer' }, Writes: 'consensus', Plan: { Id: 'pln-2', Title: 'Two' }, Prompt: 'stale', Prepare: async function () { prepared++; return { Prompt: 'fresh' }; } } );
	ASSERT.deepEqual( [ second.Status, second.Started, second.Behind.Id, second.Behind.Task.Name, second.Behind.Plan.Title ], [ 'queued', null, first.Id, 'Work', 'One' ] );
	ASSERT.equal( typeof second.Queued, 'string' );
	ASSERT.equal( runs.Read( second.Id ).Status, 'queued' );
	// the same plan on another connection waits too; another plan on that connection waits behind it in press order
	let third = runs.Start( { Llm: other, Task: { Id: 'work', Name: 'Work' }, Writes: 'consensus', Plan: { Id: 'pln-1', Title: 'One' }, Prompt: 'third' } );
	ASSERT.deepEqual( [ third.Status, third.Behind.Id ], [ 'queued', first.Id ] );
	ASSERT.equal( runs.IsBlocked( { Llm: other.Id, Plan: 'pln-1' } ).Id, first.Id );
	ASSERT.equal( runs.IsBlocked( { Llm: other.Id, Plan: 'pln-3' } ).Id, third.Id );
	ASSERT.equal( runs.IsBlocked( { Llm: 'llm-free', Plan: 'pln-3' } ), null );
	let fourth = runs.Start( { Llm: other, Task: { Id: 'work', Name: 'Work' }, Writes: 'consensus', Plan: { Id: 'pln-3', Title: 'Three' }, Prompt: 'fourth' } );
	ASSERT.deepEqual( [ fourth.Status, fourth.Behind.Id ], [ 'queued', third.Id ] );
	// a queued run is stopped out of the line; one in the line is not deleted
	ASSERT.equal( runs.Stop( fourth.Id ), true );
	ASSERT.deepEqual( [ runs.Read( fourth.Id ).Status, runs.Read( fourth.Id ).Error, runs.Read( fourth.Id ).Duration ], [ 'stopped', 'stopped before it started', 0 ] );
	ASSERT.throws( function () { runs.Delete( third.Id ); }, /still queued/ );
	// the first ends: the second (its connection free) and the third (its plan free) start
	let done_first = await settled( runs, first.Id );
	let done_second = await settled( runs, second.Id );
	let done_third = await settled( runs, third.Id );
	ASSERT.equal( done_first.Output, 'got: first' );
	ASSERT.deepEqual( [ done_second.Status, done_second.Output, done_second.Behind.Id, prepared ], [ 'done', 'got: fresh', first.Id, 1 ] );
	ASSERT.deepEqual( [ done_third.Status, done_third.Output ], [ 'done', 'got: third' ] );
	ASSERT.equal( done_second.Started >= done_second.Queued, true );
	ASSERT.deepEqual( heard.slice( 0, 6 ), [ first.Id + ' running', second.Id + ' queued', third.Id + ' queued', fourth.Id + ' queued', fourth.Id + ' stopped', first.Id + ' done' ] );
	ASSERT.deepEqual( heard.slice( 6 ).sort(), [ second.Id + ' done', second.Id + ' running', third.Id + ' done', third.Id + ' running' ].sort() );
	// the list is in press order, newest first (presses in one burst can share a millisecond, so the order is checked by time)
	let listed = runs.List();
	ASSERT.deepEqual( listed.map( function ( one ) { return one.Id; } ).sort(), [ first.Id, second.Id, third.Id, fourth.Id ].sort() );
	let presses = listed.map( function ( one ) { return one.Queued || one.Started; } );
	ASSERT.deepEqual( presses, presses.slice().sort().reverse() );
	// a run whose package fails when its turn comes fails without running
	let fifth = runs.Start( { Llm: echo, Task: { Id: 'work', Name: 'Work' }, Writes: 'consensus', Plan: { Id: 'pln-1', Title: 'One' }, Prompt: 'fifth' } );
	let sixth = runs.Start( { Llm: echo, Task: { Id: 'work', Name: 'Work' }, Writes: 'consensus', Plan: { Id: 'pln-1', Title: 'One' }, Prompt: 'sixth', Prepare: async function () { return { Error: 'the plan is gone' }; } } );
	ASSERT.equal( sixth.Status, 'queued' );
	await settled( runs, fifth.Id );
	let failed = await settled( runs, sixth.Id );
	ASSERT.deepEqual( [ failed.Status, failed.Error, failed.Output ], [ 'failed', 'the plan is gone', '' ] );
	// a run left queued by a server that stopped is closed at the next start
	let orphan = Object.assign( runs.Read( sixth.Id ), { Id: 'run-orphan', Status: 'queued', Ended: null, Error: null } );
	FS.writeFileSync( PATH.join( folder, 'runs', 'run-orphan.json' ), JSON.stringify( orphan ) );
	let again = RUNS.Runs( { Folder: PATH.join( folder, 'runs' ) } );
	ASSERT.deepEqual( [ again.Read( 'run-orphan' ).Status, again.Read( 'run-orphan' ).Error ], [ 'stopped', 'the server stopped before the run started' ] );
	await runs.Close();
} );


//---------------------------------------------------------------------
// The files of a folder (plan UI Tweaks IV)

TEST( 'the files of a folder: globs over relative paths, excluded folders not entered, the list capped', function ()
{
	ASSERT.equal( FILES.Matches( '*.js', 'a.js' ), true );
	ASSERT.equal( FILES.Matches( '*.js', 'src/a.js' ), true );		// no slash: at any depth
	ASSERT.equal( FILES.Matches( 'src/*.js', 'src/a.js' ), true );
	ASSERT.equal( FILES.Matches( 'src/*.js', 'src/deep/a.js' ), false );
	ASSERT.equal( FILES.Matches( 'src/**/*.js', 'src/deep/er/a.js' ), true );
	ASSERT.equal( FILES.Matches( 'src/**/*.js', 'src/a.js' ), true );
	ASSERT.equal( FILES.Matches( 'src/**', 'src/deep/a.js' ), true );
	ASSERT.equal( FILES.Matches( '~*/**', '~data/x.json' ), true );
	ASSERT.equal( FILES.Matches( '~*/**', 'data/x.json' ), false );
	ASSERT.equal( FILES.Matches( 'a?c', 'abc' ), true );
	ASSERT.equal( FILES.Matches( 'a?c', 'a/c' ), false );
	ASSERT.equal( FILES.Matches( '.git/**', '.git/HEAD' ), true );

	let folder = temporary_folder( 'consensus-files-' );
	FS.mkdirSync( PATH.join( folder, 'src', 'deep' ), { recursive: true } );
	FS.mkdirSync( PATH.join( folder, 'node_modules', 'thing' ), { recursive: true } );
	FS.mkdirSync( PATH.join( folder, '~data' ), { recursive: true } );
	FS.mkdirSync( PATH.join( folder, '.git' ), { recursive: true } );
	FS.writeFileSync( PATH.join( folder, 'readme.md' ), '# r' );
	FS.writeFileSync( PATH.join( folder, 'src', 'a.js' ), '' );
	FS.writeFileSync( PATH.join( folder, 'src', 'deep', 'b.js' ), '' );
	FS.writeFileSync( PATH.join( folder, 'src', 'deep', 'c.txt' ), '' );
	FS.writeFileSync( PATH.join( folder, 'node_modules', 'thing', 'index.js' ), '' );
	FS.writeFileSync( PATH.join( folder, '~data', 'x.json' ), '' );
	FS.writeFileSync( PATH.join( folder, '.git', 'HEAD' ), '' );
	let all = FILES.Walk( folder, [], STORE.DEFAULT_EXCLUDE );
	ASSERT.deepEqual( all, { Count: 4, Files: [ 'readme.md', 'src/a.js', 'src/deep/b.js', 'src/deep/c.txt' ], Truncated: false } );
	let everything = FILES.Walk( folder, [], [] );
	ASSERT.equal( everything.Count, 7 );
	let only_js = FILES.Walk( folder, [ '**/*.js' ], STORE.DEFAULT_EXCLUDE );
	ASSERT.deepEqual( only_js.Files, [ 'src/a.js', 'src/deep/b.js' ] );
	let no_deep = FILES.Walk( folder, [], STORE.DEFAULT_EXCLUDE.concat( [ 'src/deep' ] ) );
	ASSERT.deepEqual( no_deep.Files, [ 'readme.md', 'src/a.js' ] );
	let capped = FILES.Walk( folder, [], STORE.DEFAULT_EXCLUDE, 2 );
	ASSERT.deepEqual( capped, { Count: 4, Files: [ 'readme.md', 'src/a.js' ], Truncated: true } );
	ASSERT.equal( FILES.Walk( PATH.join( folder, 'nope' ), [], [] ).Count, 0 );
	ASSERT.match( FILES.Walk( PATH.join( folder, 'nope' ), [], [] ).Error, /not a folder/ );
	ASSERT.equal( FILES.Walk( '', [], [] ).Error, 'no Path' );
} );


//---------------------------------------------------------------------
// A run from a read-only store's server (plan Rearchitecturation, Step 4): the Desktop's window server runs the
// connection the Host's file declares, in the project's folder, and writes the record under <config>/runs/ as today.

const READONLY_ECHO = [ '-e', "let t='';process.stdin.on('data',function(c){t+=c});process.stdin.on('end',function(){process.stdout.write('got: '+t.length)})" ];


TEST( 'a read-only store\'s server runs a connection from the Host\'s file in the project\'s folder and writes the run\'s record under the config folder, the settings untouched', async function ()
{
	let config = temporary_folder( 'consensus-runs-readonly-' );
	let folder = PATH.join( temporary_folder( 'consensus-runs-readonly-project-' ), 'thing' );
	FS.mkdirSync( folder );
	let file = PATH.join( config, 'consensus.json' );
	let written = JSON.stringify( { Port: 0, Owner: { Name: 'user', Display: 'User' }, Llms: [ { Name: 'echo', Kind: 'claude-cli', Command: process.execPath, Arguments: READONLY_ECHO, Timeout: 30 } ] }, null, '\t' );
	FS.writeFileSync( file, written );
	let running = await SERVER.Start( { Config: config, Port: 0, Project: folder, ReadOnly: true } );
	let headers = { 'X-Consensus-Service': 'Test', 'Content-Type': 'application/json' };
	async function api( method, path, body )
	{
		let response = await fetch( running.Url + path, { method: method, headers: headers, body: body ? JSON.stringify( body ) : undefined } );
		return { Status: response.status, Body: await response.json() };
	}
	try
	{
		let echo = ( await api( 'GET', '/api/llms' ) ).Body.Llms[ 0 ];
		ASSERT.equal( echo.Name, 'echo' );
		let plan = ( await api( 'POST', '/api/plans', { Title: 'Run me', Text: '# Run me\n', Project: running.Project.Id } ) ).Body.Plan;
		let started = await api( 'POST', '/api/runs', { Llm: echo.Id, Task: 'answer', Project: running.Project.Id, Plan: plan.Id } );
		ASSERT.equal( started.Status, 201, JSON.stringify( started.Body ) );
		let run = started.Body.Run;
		let waited = 0;
		while ( waited < 20000 )
		{
			run = ( await api( 'GET', '/api/runs/' + run.Id ) ).Body.Run;
			if ( run.Status !== 'queued' && run.Status !== 'running' )
			{
				break;
			}
			await new Promise( function ( resolve ) { setTimeout( resolve, 100 ); } );
			waited += 100;
		}
		ASSERT.equal( run.Status, 'done', JSON.stringify( run ) );
		ASSERT.match( run.Output, /^got: \d+/ );
		ASSERT.equal( run.Project.Id, running.Project.Id );
		ASSERT.ok( FS.existsSync( PATH.join( config, 'runs', run.Id + '.json' ) ), 'the record under <config>/runs/' );
		ASSERT.equal( FS.readFileSync( file, 'utf8' ), written, 'consensus.json untouched' );
	}
	finally
	{
		await running.Close();
	}
} );
