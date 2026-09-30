'use strict';

// The worker app (plan Worker Electron App), without Electron: its settings module (app.json read and written, a
// worker's worker.json built from it, the problems it reports) and its manager with a stand-in Start (start, stop,
// autostart, a saved change reloading the running workers, a worker that fails while the others run).

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const FS = require( 'fs' );
const OS = require( 'os' );
const PATH = require( 'path' );
const SETTINGS = require( '../worker-app/Settings.js' );
const MANAGER = require( '../worker-app/Manager.js' );

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


function app_settings( root )
{
	return SETTINGS.Fill( {
		Consensus: { Url: 'http://127.0.0.1:3500' },
		Inference: [
			{ Name: 'Claude CLI', Type: 'claude-cli', Command: 'claude' },
			{ Name: 'Ollama', Type: 'ollama', Url: 'http://127.0.0.1:11434', Model: 'fake-model' },
		],
		Workers: [
			{ Name: 'Code', Token: 'code-token-0123456789abcdef', Root: root, Exclude: [ 'private/**' ], Build: { Remote: 'origin', Commands: [ 'npm test' ] }, AutoStart: true },
			{ Name: 'Docs', Token: 'docs-token-0123456789abcdef', Root: root, AutoStart: false },
		],
		MaxRounds: 7,
		TimeoutSeconds: 70,
	} );
}


//---------------------------------------------------------------------
// Settings

TEST( 'settings: a missing app.json reads as the defaults, and a written one reads back', function ()
{
	let folder = temporary_folder( 'worker-app-settings-' );
	let path = PATH.join( folder, 'app.json' );
	let read = SETTINGS.Read( path );
	ASSERT.equal( read.Consensus.Url, 'http://127.0.0.1:3500' );
	ASSERT.deepEqual( read.Inference, [] );
	ASSERT.deepEqual( read.Workers, [] );
	ASSERT.equal( read.MaxRounds, 20 );
	ASSERT.equal( read.TimeoutSeconds, 600 );

	let settings = app_settings( folder );
	SETTINGS.Write( path, settings );
	let again = SETTINGS.Read( path );
	ASSERT.deepEqual( again, settings );
	ASSERT.equal( FS.readdirSync( folder ).filter( function ( name ) { return name.endsWith( '.tmp' ); } ).length, 0 );
} );


TEST( 'settings: a worker without a token gets one when filled in', function ()
{
	let filled = SETTINGS.Fill( { Workers: [ { Name: 'New', Root: 'W:/x' } ] } );
	ASSERT.equal( typeof filled.Workers[ 0 ].Token, 'string' );
	ASSERT.ok( filled.Workers[ 0 ].Token.length >= 32 );
	ASSERT.equal( filled.Workers[ 0 ].Build, null );
	ASSERT.equal( filled.Workers[ 0 ].AutoStart, false );
	ASSERT.notEqual( SETTINGS.NewToken(), SETTINGS.NewToken() );
} );


TEST( 'settings: a worker\'s worker.json is built in the worker\'s format', function ()
{
	let folder = temporary_folder( 'worker-app-build-' );
	let settings = app_settings( folder );
	let built = SETTINGS.WorkerSettings( settings, settings.Workers[ 0 ], 3701 );
	ASSERT.equal( built.Name, 'Code' );
	ASSERT.deepEqual( built.Consensus, { Url: 'http://127.0.0.1:3500', Token: 'code-token-0123456789abcdef' } );
	ASSERT.deepEqual( built.Web, { Host: '127.0.0.1', Port: 3701 } );
	ASSERT.equal( built.MaxRounds, 7 );
	ASSERT.equal( built.TimeoutSeconds, 70 );
	ASSERT.equal( built.Items.length, 3 );
	ASSERT.deepEqual( built.Items[ 0 ], { Kind: 'Workspace', Name: 'Code', Root: folder, Include: [], Exclude: [ 'private/**' ], Build: { Remote: 'origin', Commands: [ 'npm test' ] } } );
	ASSERT.deepEqual( built.Items[ 1 ], { Kind: 'Inference', Name: 'Claude CLI', Type: 'claude-cli', Command: 'claude' } );
	ASSERT.equal( built.Items[ 2 ].Type, 'ollama' );

	let docs = SETTINGS.WorkerSettings( settings, settings.Workers[ 1 ], 3702 );
	ASSERT.equal( docs.Items[ 0 ].Build, undefined );
} );


TEST( 'settings: the problems are reported once, and each worker as the worker checks itself', function ()
{
	let folder = temporary_folder( 'worker-app-problems-' );
	ASSERT.deepEqual( SETTINGS.Problems( app_settings( folder ) ), [] );

	let settings = app_settings( folder );
	settings.Consensus.Url = 'cube4:3500';
	settings.MaxRounds = 0;
	settings.Inference.push( { Name: 'Claude CLI', Type: 'claude-cli' } );
	settings.Workers[ 0 ].Root = PATH.join( folder, 'gone' );
	settings.Workers[ 1 ].Name = 'Bad/Name';
	settings.Workers.push( { Name: 'Docs', Token: 'short', Root: folder } );
	settings.Workers.push( { Name: '', Root: folder } );
	let problems = SETTINGS.Problems( settings );
	ASSERT.ok( problems.some( function ( problem ) { return problem.startsWith( 'Consensus Url' ); } ), problems.join( '\n' ) );
	ASSERT.equal( problems.filter( function ( problem ) { return /^Consensus Url/.test( problem ); } ).length, 1, problems.join( '\n' ) );
	ASSERT.equal( problems.filter( function ( problem ) { return /MaxRounds/.test( problem ); } ).length, 1, problems.join( '\n' ) );
	ASSERT.ok( problems.some( function ( problem ) { return problem === 'LLM "Claude CLI" is named twice'; } ), problems.join( '\n' ) );
	ASSERT.ok( problems.some( function ( problem ) { return problem.startsWith( 'worker "Code": Workspace "Code": Root' ); } ), problems.join( '\n' ) );
	ASSERT.ok( problems.some( function ( problem ) { return problem.startsWith( 'worker "Bad/Name": the Name must be usable as a folder name' ); } ), problems.join( '\n' ) );
	ASSERT.ok( problems.some( function ( problem ) { return problem === 'worker "Docs": Consensus.Token must be a string of 16 characters or more'; } ), problems.join( '\n' ) );
	ASSERT.ok( problems.some( function ( problem ) { return problem === 'a worker has no Name'; } ), problems.join( '\n' ) );
} );


//---------------------------------------------------------------------
// The manager, with a stand-in Start.

function fake_start_factory()
{
	let calls = [];
	async function fake_start( Options )
	{
		calls.push( Options );
		if ( Options.Settings.Name === 'Broken' )
		{
			throw new Error( 'listen EADDRINUSE' );
		}
		let closed = false;
		let reloads = 0;
		let state = { Consensus: { Connected: true, Heard: '2026-09-30T00:00:00.000Z', Error: null }, Paused: false, Current: null };
		return {
			Url: 'http://127.0.0.1:' + Options.Settings.Web.Port,
			State: function () { return { Name: Options.Settings.Name, Consensus: state.Consensus, Paused: state.Paused, Current: state.Current, Jobs: [] }; },
			Reload: function ()
			{
				reloads++;
				let fresh = JSON.parse( FS.readFileSync( Options.SettingsPath, 'utf8' ) );
				return fresh.Items.length ? [] : [ 'no items' ];
			},
			Close: async function () { closed = true; },
			Fake: { Closed: function () { return closed; }, Reloads: function () { return reloads; }, State: state },
		};
	}
	return { Start: fake_start, Calls: calls };
}


TEST( 'manager: a worker starts on a free port with its worker.json and jobs folder, and stops', async function ()
{
	let folder = temporary_folder( 'worker-app-manager-' );
	let user_data = PATH.join( folder, 'user-data' );
	let settings = app_settings( folder );
	let fake = fake_start_factory();
	let manager = MANAGER.Manager( { UserData: user_data, Settings: settings, Start: fake.Start, Vendor: 'vendor' } );

	let before = manager.Snapshot();
	ASSERT.deepEqual( before.map( function ( entry ) { return entry.Name + ':' + entry.Status; } ), [ 'Code:stopped', 'Docs:stopped' ] );

	let entry = await manager.Start( 'Code' );
	ASSERT.equal( entry.Status, 'connected' );
	ASSERT.equal( fake.Calls.length, 1 );
	let options = fake.Calls[ 0 ];
	ASSERT.equal( options.Vendor, 'vendor' );
	ASSERT.equal( options.Folder, PATH.join( user_data, 'workers', 'Code' ) );
	ASSERT.equal( options.SettingsPath, PATH.join( user_data, 'workers', 'Code', 'worker.json' ) );
	ASSERT.ok( options.Settings.Web.Port > 0 );
	ASSERT.equal( entry.Url, 'http://127.0.0.1:' + options.Settings.Web.Port );
	let written = JSON.parse( FS.readFileSync( options.SettingsPath, 'utf8' ) );
	ASSERT.deepEqual( written, options.Settings );
	ASSERT.equal( written.Items[ 0 ].Name, 'Code' );

	// Starting again does nothing.
	await manager.Start( 'Code' );
	ASSERT.equal( fake.Calls.length, 1 );

	// The statuses follow the worker's state.
	let worker = fake.Calls[ 0 ];
	let started = manager.Snapshot()[ 0 ];
	ASSERT.equal( started.Status, 'connected' );
	let running = await ( async function () { return ( await fake.Start( { Settings: { Name: 'Probe', Web: { Port: 1 } }, SettingsPath: options.SettingsPath } ) ); } )();
	ASSERT.equal( typeof running.Fake, 'object' );

	await manager.Stop( 'Code' );
	let stopped = manager.Snapshot()[ 0 ];
	ASSERT.equal( stopped.Status, 'stopped' );
	ASSERT.equal( stopped.Url, null );
	ASSERT.equal( stopped.Stopped.Why, MANAGER.STOPPED_BY_YOU );
	ASSERT.equal( worker.Settings.Name, 'Code' );
	await ASSERT.rejects( manager.Start( 'Nobody' ), /no worker named "Nobody"/ );
} );


TEST( 'manager: the statuses are paused, working and offline as the worker reports', async function ()
{
	let folder = temporary_folder( 'worker-app-status-' );
	let settings = app_settings( folder );
	let fakes = [];
	async function start( Options )
	{
		let fake = fake_start_factory();
		let started = await fake.Start( Options );
		fakes.push( started );
		return started;
	}
	let manager = MANAGER.Manager( { UserData: PATH.join( folder, 'user-data' ), Settings: settings, Start: start } );
	await manager.Start( 'Code' );
	let state = fakes[ 0 ].Fake.State;
	state.Paused = true;
	ASSERT.equal( manager.Snapshot()[ 0 ].Status, 'paused' );
	state.Current = { Title: 'A plan' };
	ASSERT.equal( manager.Snapshot()[ 0 ].Status, 'working' );
	ASSERT.equal( manager.Snapshot()[ 0 ].Working, 'A plan' );
	state.Current = null;
	state.Paused = false;
	state.Consensus.Connected = false;
	state.Consensus.Error = 'Consensus answered 401';
	let offline = manager.Snapshot()[ 0 ];
	ASSERT.equal( offline.Status, 'offline' );
	ASSERT.equal( offline.Error, 'Consensus answered 401' );
	await manager.Close();
	ASSERT.equal( manager.Snapshot()[ 0 ].Status, 'stopped' );
	ASSERT.equal( manager.Snapshot()[ 0 ].Stopped.Why, MANAGER.STOPPED_APP_CLOSED );
	ASSERT.ok( fakes[ 0 ].Fake.Closed() );
} );


TEST( 'manager: autostart starts the marked workers, and one that fails keeps its reason while the others run', async function ()
{
	let folder = temporary_folder( 'worker-app-autostart-' );
	let settings = app_settings( folder );
	settings.Workers.push( { Name: 'Broken', Token: 'broken-token-0123456789abcdef', Root: folder, Include: [], Exclude: [], Build: null, AutoStart: true } );
	let fake = fake_start_factory();
	let manager = MANAGER.Manager( { UserData: PATH.join( folder, 'user-data' ), Settings: settings, Start: fake.Start } );
	await manager.StartAutomatic();
	let snapshot = manager.Snapshot();
	ASSERT.deepEqual( snapshot.map( function ( entry ) { return entry.Name + ':' + entry.Status; } ), [ 'Code:connected', 'Docs:stopped', 'Broken:stopped' ] );
	ASSERT.equal( snapshot[ 2 ].Error, 'listen EADDRINUSE' );
	ASSERT.equal( snapshot[ 2 ].Stopped.Why, 'listen EADDRINUSE' );
	ASSERT.equal( snapshot[ 1 ].Stopped, null );
	await ASSERT.rejects( manager.Start( 'Broken' ), /EADDRINUSE/ );
	await manager.Close();
} );


TEST( 'manager: saved settings stop the workers that are gone and rewrite and reload the running ones', async function ()
{
	let folder = temporary_folder( 'worker-app-reload-' );
	let user_data = PATH.join( folder, 'user-data' );
	let settings = app_settings( folder );
	let started = [];
	let fake = fake_start_factory();
	async function start( Options )
	{
		let worker = await fake.Start( Options );
		started.push( worker );
		return worker;
	}
	let manager = MANAGER.Manager( { UserData: user_data, Settings: settings, Start: start } );
	await manager.Start( 'Code' );
	await manager.Start( 'Docs' );
	let port = fake.Calls[ 0 ].Settings.Web.Port;

	let fresh = app_settings( folder );
	fresh.Inference.push( { Name: 'Second', Type: 'ollama', Url: 'http://127.0.0.1:11435', Model: 'other' } );
	fresh.Workers = [ fresh.Workers[ 0 ], { Name: 'Third', Token: 'third-token-0123456789abcdef', Root: folder, Include: [], Exclude: [], Build: null, AutoStart: false } ];
	await manager.Settings( fresh );

	let snapshot = manager.Snapshot();
	ASSERT.deepEqual( snapshot.map( function ( entry ) { return entry.Name + ':' + entry.Status; } ), [ 'Code:connected', 'Third:stopped' ] );
	ASSERT.ok( started[ 1 ].Fake.Closed(), 'Docs was stopped' );
	ASSERT.equal( started[ 1 ].Fake.Reloads(), 0 );
	ASSERT.equal( started[ 0 ].Fake.Reloads(), 1 );
	ASSERT.equal( snapshot[ 0 ].Error, null );
	let written = JSON.parse( FS.readFileSync( PATH.join( user_data, 'workers', 'Code', 'worker.json' ), 'utf8' ) );
	ASSERT.equal( written.Web.Port, port, 'the port is kept' );
	ASSERT.equal( written.Items.length, 4 );
	ASSERT.equal( written.Items[ 3 ].Name, 'Second' );

	// A reload the worker refuses is reported on the worker, which keeps running.
	let worse = app_settings( folder );
	worse.Workers = [ worse.Workers[ 0 ] ];
	let original = FS.writeFileSync;
	FS.writeFileSync = function ( path, text )
	{
		if ( String( path ).endsWith( 'worker.json' ) )
		{
			let object = JSON.parse( text );
			object.Items = [];
			text = JSON.stringify( object );
		}
		return original.call( FS, path, text );
	};
	try
	{
		await manager.Settings( worse );
	}
	finally
	{
		FS.writeFileSync = original;
	}
	let refused = manager.Snapshot()[ 0 ];
	ASSERT.equal( refused.Status, 'connected' );
	ASSERT.equal( refused.Error, 'not reloaded: no items' );
	await manager.Close();
} );
