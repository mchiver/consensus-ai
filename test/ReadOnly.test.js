'use strict';

// A server over a Server's consensus.json read-only (plan The Server, Step 4: the Desktop's sidecar mode, which took
// none of the Server's connections or tasks). No edition starts a server this way since the editions cut (plan Review
// 2026-10-29, Step 5.1: the Desktop opens no folder); the option stays in src/Server.js, src/Store.js and
// src/Users.js, and this test covers it while it does (it was test/Desktop.test.js's).

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const FS = require( 'fs' );
const OS = require( 'os' );
const PATH = require( 'path' );
const SERVER = require( '../src/Server.js' );

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


TEST( 'read-only: the server reads the Server\'s consensus.json read-only and takes none of its connections or tasks: /api/me says Sidecar, nothing to run, a connection or settings save refused with the Server\'s line, the file never written; a missing file is the defaults, unwritten', async function ()
{
	let config = temporary_folder( 'readonly-' );
	let folder = PATH.join( temporary_folder( 'readonly-project-' ), 'thing' );
	FS.mkdirSync( folder );
	let file = PATH.join( config, 'consensus.json' );
	let written = JSON.stringify( { Port: 3977, Owner: { Name: 'user', Display: 'User' }, Llms: [ { Name: 'first', Kind: 'claude', Model: 'claude-test' } ], Tasks: [ { Id: 'answer', Name: 'Answer', Prompt: 'Answer what waits on you.' } ] }, null, '\t' );
	FS.writeFileSync( file, written );
	let running = await SERVER.Start( { Config: config, Port: 0, Project: folder, ReadOnly: true } );
	let service = { 'X-Consensus-Service': 'Test', 'Content-Type': 'application/json' };
	async function api( method, path, body )
	{
		let response = await fetch( running.Url + path, { method: method, headers: service, body: body ? JSON.stringify( body ) : undefined } );
		return { Status: response.status, Body: await response.json() };
	}
	try
	{
		ASSERT.equal( running.ReadOnly, true );
		ASSERT.equal( running.Store.ReadOnly, true );
		ASSERT.equal( FS.readFileSync( file, 'utf8' ), written, 'the start wrote nothing' );
		ASSERT.equal( FS.existsSync( PATH.join( config, 'users.json' ) ), false, 'no users file made' );
		ASSERT.equal( running.Users.List().some( function ( one ) { return one.Type === 'owner'; } ), true, 'the owner record kept in memory' );
		ASSERT.ok( FS.existsSync( PATH.join( folder, '.consensus', 'project.json' ) ), 'the project\'s own folder is made' );
		let me = ( await api( 'GET', '/api/me' ) ).Body;
		ASSERT.equal( me.Sidecar, true );
		ASSERT.equal( me.Host, undefined );
		// none of the Server's connections or tasks
		ASSERT.deepEqual( ( await api( 'GET', '/api/llms' ) ).Body.Llms, [] );
		ASSERT.deepEqual( ( await api( 'GET', '/api/tasks' ) ).Body.Tasks, [] );
		let plan = ( await api( 'POST', '/api/plans', { Title: 'Run me', Text: '# Run me\n', Project: running.Project.Id } ) ).Body.Plan;
		let run = await api( 'POST', '/api/runs', { Llm: 'llm-aaa-bbb-ccc', Task: 'answer', Project: running.Project.Id, Plan: plan.Id } );
		ASSERT.ok( run.Status >= 400, 'nothing to run: ' + JSON.stringify( run ) );
		// the writes refused with the Server's line
		ASSERT.deepEqual( await api( 'POST', '/api/llms', { Name: 'second' } ), { Status: 403, Body: { Error: 'Connections are managed by the Server' } } );
		ASSERT.deepEqual( await api( 'PUT', '/api/settings', { Name: 'Renamed' } ), { Status: 403, Body: { Error: 'The settings are managed by the Server' } } );
		ASSERT.equal( FS.readFileSync( file, 'utf8' ), written, 'still untouched' );
		ASSERT.equal( running.RereadSettings, undefined, 'the file is not watched' );
	}
	finally
	{
		await running.Close();
	}
	// a missing file: the defaults in memory, nothing written, the folder's project still opens
	let empty = temporary_folder( 'readonly-empty-' );
	let bare = await SERVER.Start( { Config: empty, Port: 0, Project: folder, ReadOnly: true } );
	try
	{
		ASSERT.equal( FS.existsSync( PATH.join( empty, 'consensus.json' ) ), false );
		ASSERT.equal( bare.SettingsWritten, false );
		let llms = await ( await fetch( bare.Url + '/api/llms', { headers: { 'X-Consensus-Service': 'Test' } } ) ).json();
		ASSERT.deepEqual( llms.Llms, [] );
		ASSERT.equal( bare.Project.Name, 'thing' );
	}
	finally
	{
		await bare.Close();
	}
	ASSERT.equal( FS.existsSync( PATH.join( empty, 'consensus.json' ) ), false );
} );
