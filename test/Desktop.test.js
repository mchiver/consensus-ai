'use strict';

// The desktop (plan Consensus Desktop, Step 2), without Electron: its settings module (desktop.json read, filled,
// written, checked), the page server that serves its copy of the Consensus page and the vendor files, and the local
// Consensus server started and stopped with the real Start over a temporary folder.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const FS = require( 'fs' );
const OS = require( 'os' );
const PATH = require( 'path' );
const SETTINGS = require( '../desktop/Settings.js' );
const LOCAL = require( '../desktop/Local.js' );
const PAGE = require( '../desktop/Page.js' );
const PACKAGE = require( '../desktop/Package.js' );
const LLM = require( '../desktop/Llm.js' );
const RUNS = require( '../desktop/Runs.js' );
const SERVER = require( '../src/Server.js' );

const VERSION = require( '../package.json' ).version;

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
// Settings

TEST( 'settings: a missing desktop.json reads as the defaults, and a written one reads back filled in', function ()
{
	let folder = temporary_folder( 'desktop-settings-' );
	let path = PATH.join( folder, 'desktop.json' );
	let read = SETTINGS.Read( path );
	ASSERT.deepEqual( read, { Servers: [], Local: { Data: '', Port: null }, Last: null, Theme: 'system', Scale: 'normal', Llms: [], Workspaces: [] } );

	let settings = SETTINGS.Fill( {
		Servers: [ { Name: ' cube4 ', Url: 'http://cube4:3500/' } ],
		Local: { Data: folder, Port: 3500 },
		Last: { Kind: 'server', Name: 'cube4' },
		Theme: 'dark',
		Scale: 'huge',
		Extra: true,
	} );
	ASSERT.deepEqual( settings, {
		Servers: [ { Name: 'cube4', Url: 'http://cube4:3500' } ],
		Local: { Data: folder, Port: 3500 },
		Last: { Kind: 'server', Name: 'cube4' },
		Theme: 'dark',
		Scale: 'normal',
		Llms: [],
		Workspaces: [],
	} );
	SETTINGS.Write( path, settings );
	ASSERT.deepEqual( SETTINGS.Read( path ), settings );
	ASSERT.equal( FS.readdirSync( folder ).some( function ( name ) { return name.endsWith( '.tmp' ); } ), false );
	ASSERT.deepEqual( SETTINGS.Fill( { Last: { Kind: 'local', Name: 'ignored' } } ).Last, { Kind: 'local' } );
	ASSERT.deepEqual( SETTINGS.Fill( { Last: { Kind: 'elsewhere' } } ).Last, null );
	ASSERT.deepEqual( SETTINGS.ServerNamed( settings, 'cube4' ), { Name: 'cube4', Url: 'http://cube4:3500' } );
	ASSERT.equal( SETTINGS.ServerNamed( settings, 'nope' ), null );
} );


TEST( 'settings: the problems are named', function ()
{
	ASSERT.deepEqual( SETTINGS.Problems( SETTINGS.Default() ), [] );
	let problems = SETTINGS.Problems( SETTINGS.Fill( { Servers: [ { Name: 'a', Url: 'http://a:1' }, { Name: 'a', Url: 'cube4:3500' }, { Name: '', Url: 'http://b:2' } ] } ) );
	ASSERT.deepEqual( problems, [ 'server "a" is named twice', 'server "a": the Url must start with http:// or https://', 'a server has no Name' ] );
} );


//---------------------------------------------------------------------
// The page server

TEST( 'the page server serves the desktop\'s copy of the page, the connect screen and the vendor files', async function ()
{
	let served = await PAGE.Serve();
	try
	{
		ASSERT.match( served.Url, /^http:\/\/127\.0\.0\.1:\d+$/ );
		let index = await fetch( served.Url + '/' );
		ASSERT.equal( index.status, 200 );
		ASSERT.match( await index.text(), /ng-app="Consensus"/ );
		let connect = await fetch( served.Url + '/connect.html' );
		ASSERT.equal( connect.status, 200 );
		ASSERT.match( await connect.text(), /ng-app="Connect"/ );
		ASSERT.equal( ( await fetch( served.Url + '/vendor/angular.min.js' ) ).status, 200 );
		ASSERT.equal( ( await fetch( served.Url + '/vendor/bootstrap.min.css' ) ).status, 200 );
		ASSERT.equal( ( await fetch( served.Url + '/js/client.js' ) ).status, 200 );
		ASSERT.match( await ( await fetch( served.Url + '/js/client.js' ) ).text(), /ConsensusDesktop/ );
		// no target: the API answers 503; with one, /api and /instructions are forwarded, bodies and the events stream too
		ASSERT.equal( ( await fetch( served.Url + '/api/me' ) ).status, 503 );
		ASSERT.equal( served.Target(), null );
		let data = temporary_folder( 'desktop-page-target-' );
		FS.writeFileSync( PATH.join( data, 'consensus.json' ), JSON.stringify( { Port: 0, Participants: [ { Name: 'user', Display: 'User', Role: 'owner' } ] } ) );
		let target = await SERVER.Start( { Data: data, Port: 0 } );
		try
		{
			served.SetTarget( target.Url + '/' );
			ASSERT.equal( served.Target(), target.Url );
			let me = await fetch( served.Url + '/api/me' );
			ASSERT.equal( me.status, 200 );
			ASSERT.equal( ( await me.json() ).Version, VERSION );
			let made = await fetch( served.Url + '/api/proposals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify( { Title: 'Through the desktop', Text: '# T\n' } ) } );
			ASSERT.equal( made.status, 201 );
			let id = ( await made.json() ).Proposal.Id;
			ASSERT.equal( ( await ( await fetch( target.Url + '/api/proposals/' + id ) ).json() ).Proposal.Title, 'Through the desktop' );
			ASSERT.equal( ( await fetch( served.Url + '/api/proposals/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify( { Title: 'Renamed through the desktop' } ) } ) ).status, 200 );
			ASSERT.equal( ( await fetch( served.Url + '/api/nothing' ) ).status, 404 );
			ASSERT.match( await ( await fetch( served.Url + '/instructions' ) ).text(), /^# This server/ );
			let events = await fetch( served.Url + '/api/events' );
			ASSERT.equal( events.headers.get( 'content-type' ), 'text/event-stream' );
			let reader = events.body.getReader();
			await fetch( target.Url + '/api/proposals/' + id + '/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify( { State: 'Plan' } ) } );
			let heard = '';
			for ( let attempt = 0; attempt < 20 && !/"Kind":"state"/.test( heard ); attempt++ )
			{
				let chunk = await reader.read();
				heard += new TextDecoder().decode( chunk.value || new Uint8Array() );
				if ( chunk.done ) { break; }
			}
			ASSERT.match( heard, /"Kind":"state"/ );
			await reader.cancel();
			served.SetTarget( null );
			ASSERT.equal( ( await fetch( served.Url + '/api/me' ) ).status, 503 );
			served.SetTarget( 'http://127.0.0.1:1' );
			ASSERT.equal( ( await fetch( served.Url + '/api/me' ) ).status, 502 );
		}
		finally
		{
			await target.Close();
		}
	}
	finally
	{
		await served.Close();
	}
	await ASSERT.rejects( PAGE.Serve( { Folder: temporary_folder( 'desktop-nopage-' ) } ), /the page is missing/ );
} );


//---------------------------------------------------------------------
// The local server

TEST( 'the local server starts over a data folder with the real Start, answers with its version, and stops', async function ()
{
	let local = LOCAL.Local();
	ASSERT.equal( local.Running(), null );
	await ASSERT.rejects( local.Start( '' ), /a data folder is needed/ );

	let folder = temporary_folder( 'desktop-local-' );
	let settings = { Port: 0, Host: '127.0.0.1', States: [ 'Proposal', 'Done' ], Participants: [ { Name: 'user', Display: 'User', Role: 'owner' } ] };
	FS.writeFileSync( PATH.join( folder, 'consensus.json' ), JSON.stringify( settings ) );
	let running = await local.Start( folder );
	ASSERT.match( running.Url, /^http:\/\/127\.0\.0\.1:\d+$/ );
	ASSERT.equal( running.Port > 0, true );
	ASSERT.equal( running.Data, PATH.resolve( folder ) );
	ASSERT.equal( running.SettingsWritten, false );
	ASSERT.deepEqual( local.Running(), running );
	let me = await ( await fetch( running.Url + '/api/me' ) ).json();
	ASSERT.equal( me.Version, VERSION );
	ASSERT.deepEqual( me.States, [ 'Proposal', 'Done' ] );
	ASSERT.equal( me.Me.Role, 'owner' );
	// over the same folder: as it is
	ASSERT.deepEqual( await local.Start( folder ), running );

	// over another folder, with no consensus.json: the defaults are written there, and the first server is stopped
	let other = temporary_folder( 'desktop-local-other-' );
	let second = await local.Start( other, 0 );
	ASSERT.notEqual( second.Url, running.Url );
	ASSERT.equal( second.SettingsWritten, true );
	ASSERT.equal( FS.existsSync( PATH.join( other, 'consensus.json' ) ), true );
	ASSERT.equal( JSON.parse( FS.readFileSync( PATH.join( other, 'consensus.json' ), 'utf8' ) ).Port, 3500 );
	ASSERT.equal( ( await fetch( second.Url + '/api/projects' ) ).status, 200 );
	await ASSERT.rejects( fetch( running.Url + '/api/me', { signal: AbortSignal.timeout( 2000 ) } ) );

	await local.Stop();
	ASSERT.equal( local.Running(), null );
	await ASSERT.rejects( fetch( second.Url + '/api/me', { signal: AbortSignal.timeout( 2000 ) } ) );
	await local.Stop();
	await local.Close();
} );


TEST( 'the local server with a stand-in Start: a failure is thrown, and leaves nothing running', async function ()
{
	let local = LOCAL.Local( { Start: async function ( options )
	{
		if ( options.Data.endsWith( 'broken' ) )
		{
			throw new Error( 'settings: no participant has the owner role' );
		}
		return { Url: 'http://127.0.0.1:1', Address: { Port: 1 }, SettingsWritten: false, Close: async function () {} };
	} } );
	await ASSERT.rejects( local.Start( PATH.join( OS.tmpdir(), 'broken' ) ), /no participant has the owner role/ );
	ASSERT.equal( local.Running(), null );
	let fine = await local.Start( PATH.join( OS.tmpdir(), 'fine' ) );
	ASSERT.equal( fine.Port, 1 );
	await local.Close();
	ASSERT.equal( local.Running(), null );
} );


//---------------------------------------------------------------------
// Step 3: LLM connections, workspaces, the package, the check and the runs

TEST( 'settings: LLM connections and workspaces are filled in with ids and defaults, and their problems named', function ()
{
	let settings = SETTINGS.Fill( {
		Llms: [ { Name: ' Claude ', Model: 'sonnet', Timeout: '120', Checks: { Readme: false }, Prompts: { Session: 'Be brief.' } }, { Id: 'llm-aaa-bbb-ccc', Name: 'Local', Kind: 'ollama', Model: 'llama3' } ],
		Workspaces: [ { Name: 'repo', Project: 'default', Path: 'W:\\code\\repo\\', Include: 'src/**\ntest/**', Exclude: [] } ],
	} );
	let claude = settings.Llms[ 0 ];
	ASSERT.match( claude.Id, /^llm-[0-9a-z]{3}-[0-9a-z]{3}-[0-9a-z]{3}$/ );
	ASSERT.equal( claude.Name, 'Claude' );
	ASSERT.equal( claude.Kind, 'claude-cli' );
	ASSERT.equal( claude.Command, 'claude' );
	ASSERT.deepEqual( claude.Arguments, SETTINGS.DEFAULT_ARGUMENTS );
	ASSERT.equal( claude.Timeout, 120 );
	ASSERT.deepEqual( claude.Checks, { Instructions: true, Readme: false, Documents: true, Threads: true } );
	ASSERT.equal( claude.Prompts.Review, PACKAGE.DEFAULT_PROMPTS.Review );
	ASSERT.equal( claude.Prompts.Session, 'Be brief.' );
	let local = settings.Llms[ 1 ];
	ASSERT.equal( local.Id, 'llm-aaa-bbb-ccc' );
	ASSERT.equal( local.Url, SETTINGS.DEFAULT_OLLAMA_URL );
	ASSERT.equal( local.Timeout, SETTINGS.DEFAULT_TIMEOUT );
	let workspace = settings.Workspaces[ 0 ];
	ASSERT.match( workspace.Id, /^wks-/ );
	ASSERT.equal( workspace.Path, 'W:/code/repo' );
	ASSERT.deepEqual( workspace.Include, [ 'src/**', 'test/**' ] );
	ASSERT.deepEqual( workspace.Exclude, [] );
	ASSERT.deepEqual( SETTINGS.FillWorkspace( { Name: 'w', Project: 'p', Path: '/w' } ).Exclude, SETTINGS.DEFAULT_EXCLUDE );
	ASSERT.deepEqual( SETTINGS.Problems( settings ), [] );
	ASSERT.equal( SETTINGS.LlmById( settings, 'llm-aaa-bbb-ccc' ), local );
	ASSERT.equal( SETTINGS.WorkspaceById( settings, workspace.Id ), workspace );
	ASSERT.equal( SETTINGS.LlmById( settings, 'nope' ), null );

	let broken = SETTINGS.Fill( {
		Llms: [ { Name: 'a' }, { Name: 'a' }, { Name: '' }, { Name: 'o', Kind: 'ollama', Url: 'nowhere', Model: '' } ],
		Workspaces: [ { Name: '', Project: '', Path: '' }, { Name: 'w', Project: 'p', Path: '/x' }, { Name: 'w', Project: 'p', Path: '/y' } ],
	} );
	ASSERT.deepEqual( SETTINGS.Problems( broken ), [
		'LLM connection "a" is named twice',
		'an LLM connection has no Name',
		'LLM connection "o": the Url must start with http:// or https://',
		'LLM connection "o": a Model is needed',
		'a workspace has no Name',
		'workspace "?" is attached to no project',
		'workspace "?" has no Path',
		'workspace "w" is named twice in its project',
	] );
	// the ids read back as written
	let folder = temporary_folder( 'desktop-settings-3-' );
	SETTINGS.Write( PATH.join( folder, 'desktop.json' ), settings );
	ASSERT.deepEqual( SETTINGS.Read( PATH.join( folder, 'desktop.json' ) ), settings );
} );


TEST( 'the package is one prompt from the checked items in order, the task of the button, and the session prompt last', function ()
{
	let llm = SETTINGS.FillLlm( { Name: 'Claude', Prompts: { Session: 'Answer in English.' } } );
	let request = {
		Kind: 'review',
		Llm: llm,
		Server: { Url: 'http://cube4:3500/' },
		Project: { Id: 'default', Name: 'Consensus' },
		Plan: { Id: 'pln-1', Title: 'Step 3', State: 'Plan' },
		Workspace: { Name: 'repo', Path: 'W:/code/repo' },
		Instructions: '# This server\n\n- API: http://cube4:3500/api\n',
		Readme: { Id: 'ctx-1', Title: 'Readme', Text: '# Consensus\n\nThe background.\n' },
		Documents: [ { Id: 'doc-1', Title: 'Notes' } ],
		Threads: [ { Id: 'thr-1', Status: 'contested', Anchor: { Text: 'a passage' }, Replies: [ { By: 'user', At: '2026-10-01T05:00:00.000Z', Text: 'Why?' } ] } ],
	};
	let text = PACKAGE.Build( request );
	let order = [ '# A review one-shot', '## This run', '- Consensus API: http://cube4:3500/api', '- The plan at hand: Step 3 (pln-1), state Plan', '- Workspace: repo, the folder W:/code/repo', '## Agent instructions', '# This server', '## Readme of Consensus (ctx-1)', 'The background.', '## Other documents of the Context folder', '- Notes (doc-1)', '## Threads of the plan waiting on llm', '### Thread thr-1 (contested, on "a passage")', '**user**', 'Why?', '## Your task: review', 'Take the llm participant', '## Further instructions', 'Answer in English.' ];
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
	let session = PACKAGE.Build( Object.assign( {}, request, { Kind: 'session', Llm: llm, Plan: null, Workspace: null } ) );
	ASSERT.match( session, /- No plan is selected\./ );
	ASSERT.match( session, /- No workspace/ );
	ASSERT.equal( session.includes( 'Your task: review' ), false );
	ASSERT.match( session, /## Your task\n\nAnswer in English\./ );
	// a readme holding a fence is fenced with a longer one
	let fenced = PACKAGE.Build( Object.assign( {}, request, { Llm: SETTINGS.FillLlm( { Name: 'x' } ), Readme: { Id: 'ctx-1', Title: 'Readme', Text: 'a\n```\nb\n```\n' } } ) );
	ASSERT.match( fenced, /````\na\n```\nb\n```\n````/ );
} );


TEST( 'the check runs the command with --version, and the command line carries the arguments and the model', async function ()
{
	let llm = SETTINGS.FillLlm( { Name: 'node', Command: process.execPath, Model: 'sonnet' } );
	let checked = await LLM.Check( llm );
	ASSERT.equal( checked.Ok, true );
	ASSERT.match( checked.Result, /--version: v\d+/ );
	let missing = await LLM.Check( SETTINGS.FillLlm( { Name: 'nope', Command: PATH.join( OS.tmpdir(), 'no-such-command-here' ) } ) );
	ASSERT.equal( missing.Ok, false );
	ASSERT.match( missing.Error, /--version/ );
	let line = LLM.CommandLine( llm );
	ASSERT.equal( line.Command, process.execPath );
	ASSERT.deepEqual( line.Arguments, SETTINGS.DEFAULT_ARGUMENTS.concat( [ '--model', 'sonnet' ] ) );
	let ollama = await LLM.Check( SETTINGS.FillLlm( { Name: 'o', Kind: 'ollama', Url: 'http://127.0.0.1:1', Model: 'm' } ) );
	ASSERT.equal( ollama.Ok, false );
	ASSERT.match( ollama.Error, /does not answer/ );
} );


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


TEST( 'a run keeps its record: the prompt on stdin, the output, the exit, the duration; stopped and timed out runs say so', async function ()
{
	let folder = temporary_folder( 'desktop-runs-' );
	let runs = RUNS.Runs( { Folder: PATH.join( folder, 'runs' ) } );
	let echo = SETTINGS.FillLlm( { Name: 'echo', Command: process.execPath, Arguments: [ '-e', "let t='';process.stdin.on('data',function(c){t+=c});process.stdin.on('end',function(){process.stdout.write('got: '+t);process.stderr.write('noted')})" ], Timeout: 30 } );
	let heard = [];
	runs.OnChange( function ( summary ) { heard.push( summary.Status ); } );
	ASSERT.deepEqual( runs.List(), [] );
	ASSERT.throws( function () { runs.Start( { Llm: SETTINGS.FillLlm( { Name: 'o', Kind: 'ollama', Model: 'm' } ), Kind: 'review', Prompt: 'x' } ); }, /Step 4/ );
	ASSERT.throws( function () { runs.Start( { Llm: echo, Kind: 'review', Prompt: 'x', Workspace: { Id: 'w', Name: 'w', Path: PATH.join( folder, 'missing' ) } } ); }, /does not exist/ );

	let started = runs.Start( { Llm: echo, Kind: 'review', Project: { Id: 'default', Name: 'Consensus' }, Plan: { Id: 'pln-1', Title: 'Step 3' }, Workspace: { Id: 'wks-1', Name: 'here', Path: folder }, Prompt: 'hello there' } );
	ASSERT.match( started.Id, /^run-/ );
	ASSERT.equal( started.Status, 'running' );
	ASSERT.equal( started.Prompt, undefined );
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
	ASSERT.equal( record.Workspace.Path, folder );
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
	let failing = SETTINGS.FillLlm( { Name: 'fail', Command: process.execPath, Arguments: [ '-e', 'process.stdout.write("partial");process.exit(3)' ] } );
	let failed = await settled( runs, runs.Start( { Llm: failing, Kind: 'build', Prompt: '' } ).Id );
	ASSERT.equal( failed.Status, 'failed' );
	ASSERT.equal( failed.Exit, 3 );
	ASSERT.match( failed.Error, /exited 3/ );
	ASSERT.equal( failed.Output, 'partial' );

	// stopped, and timed out
	let sleeper = SETTINGS.FillLlm( { Name: 'sleep', Command: process.execPath, Arguments: [ '-e', 'setTimeout(function(){},60000)' ], Timeout: 60 } );
	let sleeping = runs.Start( { Llm: sleeper, Kind: 'session', Prompt: '' } );
	ASSERT.equal( runs.Stop( sleeping.Id ), true );
	ASSERT.equal( runs.Stop( 'run-nothing' ), false );
	ASSERT.equal( ( await settled( runs, sleeping.Id ) ).Status, 'stopped' );
	let slow = SETTINGS.FillLlm( { Name: 'slow', Command: process.execPath, Arguments: [ '-e', 'setTimeout(function(){},60000)' ], Timeout: 1 } );
	let timed = await settled( runs, runs.Start( { Llm: slow, Kind: 'session', Prompt: '' } ).Id );
	ASSERT.equal( timed.Status, 'failed' );
	ASSERT.match( timed.Error, /longer than 1 seconds/ );
	ASSERT.equal( runs.List().length, 4 );
	ASSERT.equal( runs.List()[ 0 ].Id, timed.Id );
	ASSERT.equal( runs.Read( 'run-nothing' ), null );
	await runs.Close();
} );
