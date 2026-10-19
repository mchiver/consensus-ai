'use strict';

// The LLM connections and the runs in the server (plan Run Shapes, Step 3; from Consensus Desktop, Step 3): the
// connections filled and checked (Llms.js), each a speaker of the server (Participants.js: its runs post as the
// owner through it, "<connection> by <owner>"), the
// package (Package.js), the check and the command line (Llm.js), the records of a run (Runs.js) and the files of a
// folder (Files.js). Nothing here needs Electron or a running server.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const FS = require( 'fs' );
const OS = require( 'os' );
const PATH = require( 'path' );
const LLMS = require( '../src/Llms.js' );
const PARTICIPANTS = require( '../src/Participants.js' );
const PACKAGE = require( '../src/Package.js' );
const LLM = require( '../src/Llm.js' );
const RUNS = require( '../src/Runs.js' );
const FILES = require( '../src/Files.js' );
const STORE = require( '../src/Store.js' );

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
	let claude = LLMS.Fill( { Name: ' claude-cli ', Model: 'sonnet', Timeout: '120', Checks: { Readme: false }, Prompts: { Session: 'Be brief.' } } );
	ASSERT.match( claude.Id, /^llm-[0-9a-z]{3}-[0-9a-z]{3}-[0-9a-z]{3}$/ );
	ASSERT.equal( claude.Name, 'claude-cli' );
	ASSERT.equal( claude.Kind, 'claude-cli' );
	ASSERT.equal( claude.Command, 'claude' );
	ASSERT.deepEqual( claude.Arguments, LLMS.DEFAULT_ARGUMENTS );
	ASSERT.equal( claude.Timeout, 120 );
	ASSERT.deepEqual( claude.Checks, { Instructions: true, Readme: false, Documents: true, Threads: true } );
	ASSERT.deepEqual( claude.Unchecked, { Documents: [], Threads: [] } );
	ASSERT.deepEqual( LLMS.Fill( { Name: 'u', Unchecked: { Documents: [ 'doc-1', ' ' ], Threads: 'thr-1\nthr-2' } } ).Unchecked, { Documents: [ 'doc-1' ], Threads: [ 'thr-1', 'thr-2' ] } );
	ASSERT.equal( claude.Prompts.Review, PACKAGE.DEFAULT_PROMPTS.Review );
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
	ASSERT.deepEqual( LLMS.Problems( { Llms: 'no' } ), [ 'Llms must be a list' ] );

	// Migrate: a name from before with other characters is brought up to date rather than refused; one used twice
	// gets a number; a usable list is left alone
	let older = { Name: 'srv', Llms: [ LLMS.Fill( { Name: 'Claude CLI' } ), LLMS.Fill( { Name: ' my model / fast ', Kind: 'ollama', Model: 'm' } ), LLMS.Fill( { Name: 'Claude-CLI' } ), LLMS.Fill( { Name: 'x' } ), LLMS.Fill( { Name: '???', Kind: 'ollama', Model: 'llama3' } ) ] };
	ASSERT.deepEqual( LLMS.Migrate( older ), [
		'LLM connection "Claude CLI" renamed "Claude-CLI": a Name is letters, digits, dot, dash and colon, used once',
		'LLM connection "my model / fast" renamed "my-model-fast": a Name is letters, digits, dot, dash and colon, used once',
		'LLM connection "Claude-CLI" renamed "Claude-CLI-2": a Name is letters, digits, dot, dash and colon, used once',
		'LLM connection "???" renamed "ollama-llama3": a Name is letters, digits, dot, dash and colon, used once',
	] );
	ASSERT.deepEqual( older.Llms.map( function ( llm ) { return llm.Name; } ), [ 'Claude-CLI', 'my-model-fast', 'Claude-CLI-2', 'x', 'ollama-llama3' ] );
	ASSERT.deepEqual( LLMS.Problems( older ), [] );
	ASSERT.deepEqual( LLMS.Migrate( older ), [] );
	ASSERT.deepEqual( LLMS.Migrate( settings ), [] );
} );


TEST( 'every connection is a speaker of its server: listed after the owner, its runs identified by a run token the server minted', function ()
{
	let claude = LLMS.Fill( { Name: 'claude-cli' } );
	let settings = { Name: 'cube4', Owner: { Name: 'user', Display: 'User' }, Llms: [ claude ] };
	ASSERT.deepEqual( PARTICIPANTS.Speakers( settings ), [
		{ Name: 'user', Display: 'User', Role: 'owner' },
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

TEST( 'the package is one prompt from the checked items in order, the task of the button, and the session prompt last', function ()
{
	let llm = LLMS.Fill( { Name: 'claude-cli', Prompts: { Session: 'Answer in English.' } } );
	let request = {
		Kind: 'review',
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
	let order = [ '# A review one-shot from Consensus', 'You act for User, the owner of the Consensus server below', 'run once by that server "cube4" through its LLM connection "claude-cli": what you post reads "claude-cli by User".', '## This run', '- Consensus API: http://cube4:3500/api', '- Your token, sent as "Authorization: Bearer <token>": the-token-of-claude-cli-0123', '- The plan at hand: Step 3 (pln-1), state Plan', '- The project\'s folder: W:/code/repo', '## Agent instructions', '# This server', '## Readme of Consensus (ctx-1)', 'The background.', '## Other documents of the Context folder', '- Notes (doc-1)', '## Threads of the plan waiting on claude-cli by User', '### Thread thr-1 (contested, on "a passage")', '**user**', 'Why?', '## Your task: review', 'Take the llm participant', '## Further instructions', 'Answer in English.' ];
	let at = -1;
	for ( let piece of order )
	{
		let found = text.indexOf( piece, at + 1 );
		ASSERT.notEqual( found, -1, 'missing or out of order: ' + piece );
		at = found;
	}
	ASSERT.equal( text.includes( '## Your task: build' ), false );

	// unchecked items are left out; a build carries the build prompt; a session only the session prompt; no plan, no threads
	llm.Checks = { Instructions: false, Readme: false, Documents: false, Threads: false };
	let build = PACKAGE.Build( Object.assign( {}, request, { Kind: 'build', Llm: llm } ) );
	ASSERT.equal( build.includes( '## Agent instructions' ), false );
	ASSERT.equal( build.includes( '## Readme' ), false );
	ASSERT.equal( build.includes( '## Threads' ), false );
	ASSERT.match( build, /## Your task: build\n\nBuild the plan at hand/ );
	let session = PACKAGE.Build( Object.assign( {}, request, { Kind: 'session', Llm: llm, Plan: null, Folder: null, Token: null } ) );
	ASSERT.match( session, /- No plan is selected\./ );
	ASSERT.match( session, /- No folder/ );
	ASSERT.equal( session.includes( 'Your token' ), false );
	// a preview (no token yet) says the server makes one when the run starts
	ASSERT.match( PACKAGE.Build( Object.assign( {}, request, { Token: undefined } ) ), /Your token, sent as "Authorization: Bearer <token>": made by the server when the run starts/ );
	ASSERT.equal( session.includes( 'Your task: review' ), false );
	ASSERT.match( session, /## Your task\n\nAnswer in English\./ );
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
	for ( let attempt = 0; attempt < 200 && ( !record || record.Status === 'running' ); attempt++ )
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
	ASSERT.throws( function () { runs.Start( { Llm: echo, Kind: 'review', Prompt: 'x', Folder: { Path: PATH.join( folder, 'missing' ) } } ); }, /does not exist/ );

	let started = runs.Start( { Llm: echo, Kind: 'review', By: 'user', Project: { Id: 'prj-1', Name: 'Consensus', Path: folder }, Plan: { Id: 'pln-1', Title: 'Step 3' }, Folder: { Path: folder, Include: [], Exclude: [], Commands: [] }, Prompt: 'hello there' } );
	ASSERT.match( started.Id, /^run-/ );
	ASSERT.equal( started.Status, 'running' );
	ASSERT.equal( started.Prompt, undefined );
	ASSERT.equal( started.By, 'user' );
	ASSERT.deepEqual( runs.Running( echo.Id ), started );
	ASSERT.throws( function () { runs.Start( { Llm: echo, Kind: 'review', Prompt: 'again' } ); }, /already running/ );
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
	let failed = await settled( runs, runs.Start( { Llm: failing, Kind: 'build', Prompt: '' } ).Id );
	ASSERT.equal( failed.Status, 'failed' );
	ASSERT.equal( failed.Exit, 3 );
	ASSERT.match( failed.Error, /exited 3/ );
	ASSERT.equal( failed.Output, 'partial' );

	// stopped, and timed out
	let sleeper = LLMS.Fill( { Name: 'sleep', Command: process.execPath, Arguments: [ '-e', 'setTimeout(function(){},60000)' ], Timeout: 60 } );
	let sleeping = runs.Start( { Llm: sleeper, Kind: 'session', Prompt: '' } );
	ASSERT.equal( runs.Stop( sleeping.Id ), true );
	ASSERT.equal( runs.Stop( 'run-nothing' ), false );
	ASSERT.equal( ( await settled( runs, sleeping.Id ) ).Status, 'stopped' );
	let slow = LLMS.Fill( { Name: 'slow', Command: process.execPath, Arguments: [ '-e', 'setTimeout(function(){},60000)' ], Timeout: 1 } );
	let timed = await settled( runs, runs.Start( { Llm: slow, Kind: 'session', Prompt: '' } ).Id );
	ASSERT.equal( timed.Status, 'failed' );
	ASSERT.match( timed.Error, /longer than 1 seconds/ );
	ASSERT.equal( runs.List().length, 4 );
	ASSERT.equal( runs.List()[ 0 ].Id, timed.Id );
	ASSERT.equal( runs.Read( 'run-nothing' ), null );
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
