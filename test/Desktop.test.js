'use strict';

// The desktop (plan Consensus Desktop, Step 2), without Electron: its settings module (desktop.json, the desktop's own
// file beside the Server Host's consensus.json: plan Rearchitecturation, Step 1), and the page server that serves its
// copy of the Consensus page and the vendor files. Plan Rearchitecturation, Step 4: the window's server over the Host's
// consensus.json read-only: the connections read, a change in the file reaching it, a save refused with the Host's line.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const FS = require( 'fs' );
const OS = require( 'os' );
const PATH = require( 'path' );
const SETTINGS = require( '../desktop/Settings.js' );
const PAGE = require( '../desktop/Page.js' );
const PROJECTS = require( '../desktop/Projects.js' );
const SERVER = require( '../src/Server.js' );
const HOST = require( '../desktop/Host.js' );
const LICENSE = require( '../src/License.js' );
const CRYPTO = require( 'crypto' );		// plan Rearchitecturation, Step 5: the Server Host from the Desktop
const NET = require( 'net' );

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

TEST( 'settings: a missing desktop.json reads as the defaults, and a written one reads back filled in; Recent and the Hosts', function ()
{
	let folder = temporary_folder( 'desktop-settings-' );
	let path = SETTINGS.Path( folder );
	ASSERT.equal( path, PATH.join( folder, 'desktop.json' ) );
	ASSERT.deepEqual( SETTINGS.Read( path ), { Recent: [], Hosts: [], Theme: 'system', Scale: 'normal', Remembered: {} } );

	let settings = SETTINGS.Fill( {
		Hosts: [ { Name: ' cube4 ', Url: 'http://cube4:3500/', Token: 'secret' }, { Name: 'cube4', Url: 'http://cube4:3500', Project: 'prj-aaa-bbb-ccc', Title: ' Test ' } ],
		Recent: [ { Path: ' W:/code/tic-tac-toe ', Opened: '2026-10-25T10:00:00.000Z' }, { Path: '' }, null ],
		Servers: [ { Name: 'old', Url: 'http://old:1' } ],
		Theme: 'dark',
		Scale: 'huge',
		Extra: true,
		License: { Plan: 'personal', Until: null, Checked: '2026-10-25T10:00:00.000Z' },
	} );
	// the saved servers of before, a token on a Host, the License of before (plan The Server, Step 1: user.json now) and
	// anything else are not kept; a Host project (Step 2) carries its
	// Title, the project's name as last seen
	ASSERT.deepEqual( settings, {
		Recent: [ { Path: 'W:/code/tic-tac-toe', Opened: '2026-10-25T10:00:00.000Z' } ],
		Hosts: [ { Name: 'cube4', Url: 'http://cube4:3500', Project: null, Title: null }, { Name: 'cube4', Url: 'http://cube4:3500', Project: 'prj-aaa-bbb-ccc', Title: 'Test' } ],
		Theme: 'dark',
		Scale: 'normal',
		Remembered: {},
	} );
	SETTINGS.Write( path, settings );
	ASSERT.deepEqual( SETTINGS.Read( path ), settings );
	ASSERT.equal( FS.readdirSync( folder ).some( function ( name ) { return name.endsWith( '.tmp' ); } ), false );
	ASSERT.deepEqual( Object.keys( SETTINGS.Fill( {} ) ).sort(), SETTINGS.DESKTOP_FIELDS.slice().sort() );
	// the palettes (plan UI Tweaks IV): any of them is a Theme; the dark ones are named
	ASSERT.equal( SETTINGS.Fill( { Theme: 'nord' } ).Theme, 'nord' );
	ASSERT.equal( SETTINGS.Fill( { Theme: 'neon' } ).Theme, 'system' );
	ASSERT.equal( SETTINGS.DARK_THEMES.includes( 'nord' ), true );
	ASSERT.equal( SETTINGS.DARK_THEMES.includes( 'sepia' ), false );
	ASSERT.equal( SETTINGS.DARK_THEMES.every( function ( theme ) { return SETTINGS.THEMES.includes( theme ); } ), true );

	// the page's remembered state (plan UI Tweaks V): kept by key in desktop.json, forgotten with null
	let kept = SETTINGS.Fill( { Remembered: { 'consensus.a:1.project': 'default', 'consensus.threads-hidden': true }, Extra: 1 } );
	ASSERT.deepEqual( kept.Remembered, { 'consensus.a:1.project': 'default', 'consensus.threads-hidden': true } );
	ASSERT.equal( SETTINGS.Remember( kept, 'consensus.a:1.tabs', { Tabs: [ { Key: 'p:x' } ], Active: 'p:x' } ), true );
	ASSERT.equal( SETTINGS.Remember( kept, 'consensus.a:1.tabs', { Tabs: [ { Key: 'p:x' } ], Active: 'p:x' } ), false );
	ASSERT.equal( SETTINGS.Remember( kept, 'consensus.threads-hidden', null ), true );
	ASSERT.equal( SETTINGS.Remember( kept, 'consensus.threads-hidden', null ), false );
	ASSERT.equal( SETTINGS.Remember( kept, '', 1 ), false );
	SETTINGS.Write( path, kept );
	ASSERT.deepEqual( SETTINGS.Read( path ).Remembered, { 'consensus.a:1.project': 'default', 'consensus.a:1.tabs': { Tabs: [ { Key: 'p:x' } ], Active: 'p:x' } } );
	ASSERT.deepEqual( SETTINGS.Fill( { Remembered: [ 1 ] } ).Remembered, {} );
	ASSERT.deepEqual( SETTINGS.HostNamed( settings, 'cube4' ), { Name: 'cube4', Url: 'http://cube4:3500', Project: null, Title: null } );
	ASSERT.equal( SETTINGS.HostNamed( settings, 'nope' ), null );
	ASSERT.deepEqual( SETTINGS.HostEntry( settings, 'cube4', 'prj-aaa-bbb-ccc' ), { Name: 'cube4', Url: 'http://cube4:3500', Project: 'prj-aaa-bbb-ccc', Title: 'Test' } );
	ASSERT.equal( SETTINGS.HostEntry( settings, 'cube4', 'prj-zzz-zzz-zzz' ), null );

	// Recent: a folder opened goes first, once; the newest RECENT_LIMIT are kept
	ASSERT.equal( SETTINGS.Opened( settings, 'W:/code/other', '2026-10-25T11:00:00.000Z' ), true );
	ASSERT.equal( SETTINGS.Opened( settings, 'W:/code/tic-tac-toe', '2026-10-25T12:00:00.000Z' ), true );
	ASSERT.deepEqual( settings.Recent, [ { Path: 'W:/code/tic-tac-toe', Opened: '2026-10-25T12:00:00.000Z' }, { Path: 'W:/code/other', Opened: '2026-10-25T11:00:00.000Z' } ] );
	ASSERT.equal( SETTINGS.Opened( settings, '' ), false );
	for ( let index = 0; index < SETTINGS.RECENT_LIMIT + 5; index++ )
	{
		SETTINGS.Opened( settings, 'W:/many/' + index );
	}
	ASSERT.equal( settings.Recent.length, SETTINGS.RECENT_LIMIT );
	ASSERT.equal( settings.Recent[ 0 ].Path, 'W:/many/' + ( SETTINGS.RECENT_LIMIT + 4 ) );
	ASSERT.match( settings.Recent[ 0 ].Opened, /^20[0-9][0-9]-/ );
} );


TEST( 'settings: the problems are named', function ()
{
	ASSERT.deepEqual( SETTINGS.Problems( SETTINGS.Default() ), [] );
	// a Host project is listed once: the Name and the Project together (Step 2), so one Host may hold several projects
	let problems = SETTINGS.Problems( SETTINGS.Fill( { Hosts: [ { Name: 'a', Url: 'http://a:1' }, { Name: 'a', Url: 'cube4:3500' }, { Name: '', Url: 'http://b:2' }, { Name: 'a', Url: 'http://a:1', Project: 'prj-1' }, { Name: 'a', Url: 'http://a:1', Project: 'prj-1' } ] } ) );
	ASSERT.deepEqual( problems, [ 'host "a" is listed twice', 'host "a": the Url must start with http:// or https://', 'a host has no Name', 'host "a" with the project prj-1 is listed twice' ] );
} );


TEST( 'settings: Load reads the desktop\'s file from the config folder and says so; the desktop writes desktop.json and never consensus.json', function ()
{
	let folder = temporary_folder( 'desktop-two-files-' );
	let host_file = PATH.join( folder, 'consensus.json' );
	let host_text = JSON.stringify( { Name: 'host', Port: 3500, Scope: 'Local', Owner: { Name: 'user' }, Projects: [ { Path: 'W:/p', Mounted: true } ], Theme: 'dark', Servers: [ { Name: 'old', Url: 'http://old:1' } ] }, null, '\t' );
	FS.writeFileSync( host_file, host_text );
	let loaded = SETTINGS.Load( folder );
	ASSERT.equal( loaded.Path, PATH.join( folder, 'desktop.json' ) );
	// the Host's file is not the desktop's: its Theme and its old Servers are not read
	ASSERT.deepEqual( loaded.Settings, SETTINGS.Default() );
	ASSERT.deepEqual( loaded.Lines, [ 'desktop settings start with the defaults (' + loaded.Path + ' is written at the first change)' ] );
	loaded.Settings.Theme = 'nord';
	SETTINGS.Opened( loaded.Settings, 'W:/p', '2026-10-25T10:00:00.000Z' );
	SETTINGS.Write( loaded.Path, loaded.Settings );
	let again = SETTINGS.Load( folder );
	ASSERT.deepEqual( again.Lines, [ 'desktop settings from ' + loaded.Path ] );
	ASSERT.equal( again.Settings.Theme, 'nord' );
	ASSERT.deepEqual( again.Settings.Recent, [ { Path: 'W:/p', Opened: '2026-10-25T10:00:00.000Z' } ] );
	ASSERT.deepEqual( Object.keys( JSON.parse( FS.readFileSync( loaded.Path, 'utf8' ) ) ).sort(), SETTINGS.DESKTOP_FIELDS.slice().sort() );
	ASSERT.equal( FS.readFileSync( host_file, 'utf8' ), host_text );
	// Apply: in place, every field replaced
	let same = loaded.Settings;
	SETTINGS.Apply( loaded.Settings, SETTINGS.Fill( { Theme: 'sepia' } ) );
	ASSERT.equal( same, loaded.Settings );
	ASSERT.deepEqual( loaded.Settings, SETTINGS.Fill( { Theme: 'sepia' } ) );
} );


//---------------------------------------------------------------------
// The page server

TEST( 'the page server serves the page, the connect screen and the vendor files, and forwards to each root\'s server', async function ()
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
		// no root: the API answers 503; with roots (plan Run Shapes, Step 5), /servers/<key>/api and /instructions are
		// forwarded to that root's server, bodies and the events stream too; a key the window has not is 503
		ASSERT.equal( ( await fetch( served.Url + '/api/me' ) ).status, 503 );
		ASSERT.equal( ( await fetch( served.Url + '/servers/a/api/me' ) ).status, 503 );
		ASSERT.deepEqual( served.Roots(), [] );
		let data = temporary_folder( 'desktop-page-target-' );
		FS.writeFileSync( PATH.join( data, 'consensus.json' ), JSON.stringify( { Port: 0, Owner: { Name: 'user', Display: 'User' } } ) );
		let target = await SERVER.Start( { Data: data, Port: 0 } );
		try
		{
			served.SetRoots( [ { Key: 'a', Url: target.Url + '/' }, { Key: 'b', Url: 'http://127.0.0.1:1' } ] );
			ASSERT.deepEqual( served.Roots(), [ { Key: 'a', Url: target.Url }, { Key: 'b', Url: 'http://127.0.0.1:1' } ] );
			let me = await fetch( served.Url + '/servers/a/api/me' );
			ASSERT.equal( me.status, 200 );
			ASSERT.equal( ( await me.json() ).Version, VERSION );
			let made = await fetch( served.Url + '/servers/a/api/plans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify( { Title: 'Through the desktop', Text: '# T\n' } ) } );
			ASSERT.equal( made.status, 201 );
			let id = ( await made.json() ).Plan.Id;
			ASSERT.equal( ( await ( await fetch( target.Url + '/api/plans/' + id ) ).json() ).Plan.Title, 'Through the desktop' );
			ASSERT.equal( ( await fetch( served.Url + '/servers/a/api/plans/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify( { Title: 'Renamed through the desktop' } ) } ) ).status, 200 );
			ASSERT.equal( ( await fetch( served.Url + '/servers/a/api/nothing' ) ).status, 404 );
			ASSERT.equal( ( await fetch( served.Url + '/servers/a/nothing' ) ).status, 404 );
			ASSERT.equal( ( await fetch( served.Url + '/servers/b/api/me' ) ).status, 502 );
			ASSERT.equal( ( await fetch( served.Url + '/servers/c/api/me' ) ).status, 503 );
			ASSERT.equal( ( await fetch( served.Url + '/api/me' ) ).status, 503 );
			ASSERT.match( await ( await fetch( served.Url + '/servers/a/instructions' ) ).text(), /^# This server/ );
			let events = await fetch( served.Url + '/servers/a/api/events' );
			ASSERT.equal( events.headers.get( 'content-type' ), 'text/event-stream' );
			let reader = events.body.getReader();
			await fetch( target.Url + '/api/plans/' + id + '/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify( { State: 'Plan' } ) } );
			let heard = '';
			for ( let attempt = 0; attempt < 20 && !/"Kind":"state"/.test( heard ); attempt++ )
			{
				let chunk = await reader.read();
				heard += new TextDecoder().decode( chunk.value || new Uint8Array() );
				if ( chunk.done ) { break; }
			}
			ASSERT.match( heard, /"Kind":"state"/ );
			await reader.cancel();
			served.SetRoots( [] );
			ASSERT.equal( ( await fetch( served.Url + '/servers/a/api/me' ) ).status, 503 );
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
// The chooser's work without Electron (plan Rearchitecturation, Step 2)

TEST( 'projects: a new project\'s folder is made under a parent and refused when it is not new; the key of a window\'s project', function ()
{
	let parent = temporary_folder( 'desktop-projects-' );
	let folder = PROJECTS.NewFolder( parent, ' tic-tac-toe ' );
	ASSERT.equal( folder, PROJECTS.Normalize( PATH.join( parent, 'tic-tac-toe' ) ) );
	ASSERT.equal( FS.statSync( folder ).isDirectory(), true );
	ASSERT.equal( folder.includes( '\\' ), false );
	// an empty folder that is there already is taken; one holding anything is refused, as is a file, a bad name, a missing parent
	ASSERT.equal( PROJECTS.NewFolder( parent, 'tic-tac-toe' ), folder );
	FS.writeFileSync( PATH.join( folder, 'readme.md' ), '# T\n' );
	ASSERT.throws( function () { PROJECTS.NewFolder( parent, 'tic-tac-toe' ); }, /holds something: open it instead/ );
	ASSERT.throws( function () { PROJECTS.NewFolder( parent, 'tic-tac-toe/readme.md' ); }, /a project needs a folder name/ );
	ASSERT.throws( function () { PROJECTS.NewFolder( parent, '..' ); }, /a project needs a folder name/ );
	ASSERT.throws( function () { PROJECTS.NewFolder( parent, '' ); }, /a project needs a folder name/ );
	ASSERT.throws( function () { PROJECTS.NewFolder( PATH.join( parent, 'nowhere' ), 'x' ); }, /the parent folder is not there/ );
	FS.writeFileSync( PATH.join( parent, 'notes.md' ), '# N\n' );
	ASSERT.throws( function () { PROJECTS.NewFolder( parent, 'notes.md' ); }, /a file is there already/ );
	// the key: the folder with forward slashes, or the Host's address and the project id
	ASSERT.equal( PROJECTS.Key( { Kind: 'folder', Path: 'W:\\code\\one' } ), 'W:/code/one' );
	ASSERT.equal( PROJECTS.Key( { Kind: 'host', Host: { Name: 'cube4', Url: 'http://cube4:3500/' }, Project: { Id: 'prj-aaa-bbb-ccc' } } ), 'host:cube4:3500/prj-aaa-bbb-ccc' );
	ASSERT.equal( PROJECTS.Key( null ), null );
	// a project found among a Host's, by id first, else by name
	let list = [ { Id: 'prj-1', Name: 'Alpha' }, { Id: 'prj-2', Name: 'prj-1' } ];
	ASSERT.deepEqual( PROJECTS.FindProject( list, 'prj-1' ), { Id: 'prj-1', Name: 'Alpha' } );
	ASSERT.deepEqual( PROJECTS.FindProject( list, 'Alpha' ), { Id: 'prj-1', Name: 'Alpha' } );
	ASSERT.equal( PROJECTS.FindProject( list, 'Beta' ), null );
	ASSERT.equal( PROJECTS.FindProject( list, '' ), null );
} );


TEST( 'projects: a Host\'s projects are listed from its API for the chooser to pick from; a Host that does not answer says so', async function ()
{
	let data = temporary_folder( 'desktop-host-' );
	FS.writeFileSync( PATH.join( data, 'consensus.json' ), JSON.stringify( { Port: 0, Owner: { Name: 'user', Display: 'User' } } ) );
	let host = await SERVER.Start( { Data: data, Port: 0 } );
	try
	{
		let made = await host.Store.CreateProject( { Name: 'Second' } );
		let listed = await PROJECTS.HostProjects( host.Url + '/' );
		ASSERT.deepEqual( listed.map( function ( project ) { return project.Name; } ), [ 'Default', 'Second' ] );
		ASSERT.equal( listed[ 1 ].Id, made.Id );
		ASSERT.deepEqual( Object.keys( listed[ 0 ] ).sort(), [ 'Id', 'Name' ] );
	}
	finally
	{
		await host.Close();
	}
	await ASSERT.rejects( PROJECTS.HostProjects( 'http://127.0.0.1:9', 2000 ), /does not answer/ );
	await ASSERT.rejects( PROJECTS.HostProjects( 'cube4:3500' ), /must start with http/ );
} );


//---------------------------------------------------------------------
// The Host's file read-only (plan Rearchitecturation, Step 4)

async function until( Check, TimeoutMs )
{
	let waited = 0;
	while ( waited < ( TimeoutMs || 5000 ) )
	{
		if ( await Check() )
		{
			return true;
		}
		await new Promise( function ( resolve ) { setTimeout( resolve, 100 ); } );
		waited += 100;
	}
	return false;
}


TEST( 'the window\'s server reads the Host\'s consensus.json read-only: its connections and tasks listed, a change in the file reaching the server and its events, a connection or settings save refused with the Host\'s line, the file never written; a missing file is the defaults, unwritten', async function ()
{
	let config = temporary_folder( 'desktop-readonly-' );
	let folder = PATH.join( temporary_folder( 'desktop-readonly-project-' ), 'thing' );
	FS.mkdirSync( folder );
	let file = PATH.join( config, 'consensus.json' );
	let written = JSON.stringify( { Port: 3977, Owner: { Name: 'user', Display: 'User' }, Llms: [ { Name: 'first', Kind: 'claude-cli', Command: process.execPath } ], Tasks: [ { Id: 'answer', Name: 'Answer', Prompt: 'Answer what waits on you.' } ] }, null, '\t' );
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
		ASSERT.equal( running.Users.List().some( function ( one ) { return one.Type === 'owner'; } ), true, 'the owner record kept in memory, so a sign-in on the window\'s server is the owner\'s' );
		ASSERT.ok( FS.existsSync( PATH.join( folder, '.consensus', 'project.json' ) ), 'the project\'s own folder is made' );
		let me = ( await api( 'GET', '/api/me' ) ).Body;
		ASSERT.equal( me.ReadOnly, true );
		ASSERT.equal( me.Host, 'http://127.0.0.1:3977' );
		let llms = ( await api( 'GET', '/api/llms' ) ).Body;
		ASSERT.deepEqual( llms.Llms.map( function ( llm ) { return llm.Name; } ), [ 'first' ] );
		ASSERT.equal( llms.Runs, true, 'the window\'s server runs the LLMs' );
		let tasks = ( await api( 'GET', '/api/tasks' ) ).Body;
		ASSERT.ok( tasks.Tasks.some( function ( task ) { return task.Id === 'answer' && task.Prompt === 'Answer what waits on you.'; } ), JSON.stringify( tasks.Tasks ) );
		// the writes refused with the Host's line
		let first = llms.Llms[ 0 ];
		ASSERT.deepEqual( await api( 'PUT', '/api/llms/' + first.Id, { Name: 'renamed' } ), { Status: 403, Body: { Error: 'Connections are managed by the Server Host' } } );
		ASSERT.deepEqual( await api( 'POST', '/api/llms', { Name: 'second' } ), { Status: 403, Body: { Error: 'Connections are managed by the Server Host' } } );
		ASSERT.deepEqual( await api( 'DELETE', '/api/llms/' + first.Id ), { Status: 403, Body: { Error: 'Connections are managed by the Server Host' } } );
		ASSERT.deepEqual( await api( 'PUT', '/api/settings', { Name: 'Renamed' } ), { Status: 403, Body: { Error: 'The settings are managed by the Server Host' } } );
		ASSERT.equal( FS.readFileSync( file, 'utf8' ), written, 'still untouched' );
		// a change in the file reaches the server: the events say llms, the list has the new connection
		let seen = [];
		let controller = new AbortController();
		let events = fetch( running.Url + '/api/events', { signal: controller.signal, headers: { 'X-Consensus-Service': 'Test' } } ).then( async function ( response )
		{
			let reader = response.body.getReader();
			let decoder = new TextDecoder();
			while ( true )
			{
				let chunk = await reader.read();
				if ( chunk.done ) { break; }
				seen.push( decoder.decode( chunk.value ) );
			}
		} ).catch( function () {} );
		await new Promise( function ( resolve ) { setTimeout( resolve, 200 ); } );
		let changed = JSON.parse( written );
		changed.Llms.push( { Name: 'second', Kind: 'claude-cli', Command: process.execPath } );
		changed.Tasks[ 0 ].Prompt = 'Answer briefly.';
		FS.writeFileSync( file, JSON.stringify( changed, null, '\t' ) );
		let reached = await until( async function ()
		{
			let listed = ( await api( 'GET', '/api/llms' ) ).Body.Llms;
			return listed.length === 2;
		}, 8000 );
		ASSERT.equal( reached, true, 'the watcher re-read the file' );
		ASSERT.deepEqual( ( await api( 'GET', '/api/llms' ) ).Body.Llms.map( function ( llm ) { return llm.Name; } ), [ 'first', 'second' ] );
		ASSERT.ok( ( await api( 'GET', '/api/tasks' ) ).Body.Tasks.some( function ( task ) { return task.Prompt === 'Answer briefly.'; } ) );
		await until( async function () { return seen.join( '' ).includes( '"llms"' ); }, 3000 );
		ASSERT.match( seen.join( '' ), /"Kind":"llms"/ );
		ASSERT.match( seen.join( '' ), /"Kind":"settings"/ );
		controller.abort();
		await events;
		// a file with a problem leaves the connections as they were; RereadSettings says nothing changed
		FS.writeFileSync( file, JSON.stringify( Object.assign( {}, changed, { Llms: [ { Name: 'bad name!', Kind: 'claude-cli' } ] } ) ) );
		await new Promise( function ( resolve ) { setTimeout( resolve, 700 ); } );
		ASSERT.equal( await running.RereadSettings(), false );
		ASSERT.equal( ( await api( 'GET', '/api/llms' ) ).Body.Llms.length, 2 );
		// the same again: nothing changed
		FS.writeFileSync( file, JSON.stringify( changed, null, '\t' ) );
		await new Promise( function ( resolve ) { setTimeout( resolve, 700 ); } );
		ASSERT.equal( await running.RereadSettings(), false );
	}
	finally
	{
		await running.Close();
	}
	// a missing file: the defaults in memory, nothing written, the folder's project still opens
	let empty = temporary_folder( 'desktop-readonly-empty-' );
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


//---------------------------------------------------------------------
// The Server Host from the Desktop (plan Rearchitecturation, Step 5)

async function free_port()
{
	let holder = NET.createServer();
	await new Promise( function ( resolve, reject ) { holder.once( 'error', reject ); holder.listen( 0, '127.0.0.1', resolve ); } );
	let port = holder.address().port;
	await new Promise( function ( resolve ) { holder.close( resolve ); } );
	return port;
}


TEST( 'the Server Host from the Desktop: Start runs consensus serve detached over a temporary folder with its log in ~logs, Status finds it by its file and by its port, a mounted folder is routed through it and an unmounted one is not, Stop ends it', async function ()
{
	let config = temporary_folder( 'desktop-host-' );
	let port = await free_port();
	FS.writeFileSync( PATH.join( config, 'consensus.json' ), JSON.stringify( { Port: port, Owner: { Name: 'user', Display: 'User' } } ) );
	// the Desktop's signed-in Personal user, whose sign-in opens the Server's gate (plan The Server, Step 3)
	LICENSE.Write( config, { Email: 'ann@example.com', Clerk: 'user_ann', Display: 'Ann', Plan: 'personal', Until: null, Checked: new Date().toISOString() } );
	let before = await HOST.Status( config );
	ASSERT.deepEqual( before, { Running: false, Url: 'http://127.0.0.1:' + port, Pid: null, Started: null, Ours: false } );
	ASSERT.equal( await HOST.HostPort( config ), port );
	let folder = PATH.join( temporary_folder( 'desktop-host-project-' ), 'served' );
	FS.mkdirSync( folder );
	ASSERT.equal( await HOST.Routed( config, folder ), null, 'no Host, nothing routed' );
	let started = HOST.Start( { Config: config, Command: process.execPath, Arguments: [ PATH.join( __dirname, '..', 'bin', 'consensus.js' ) ] } );
	ASSERT.match( started.Log, /[\\/]~logs[\\/]host-.*\.log$/ );
	ASSERT.ok( Number.isInteger( started.Pid ) );
	try
	{
		let status = await HOST.WaitFor( config, port, 20000 );
		ASSERT.equal( status.Running, true, FS.existsSync( started.Log ) ? FS.readFileSync( started.Log, 'utf8' ) : 'no log' );
		ASSERT.deepEqual( [ status.Url, status.Pid, status.Ours ], [ 'http://127.0.0.1:' + port, started.Pid, true ] );
		ASSERT.ok( FS.existsSync( PATH.join( config, '~host.json' ) ) );
		ASSERT.match( FS.readFileSync( started.Log, 'utf8' ), /Consensus at http:\/\/127\.0\.0\.1:/ );
		// found by its port alone when the file is not this machine's: the file set aside
		FS.renameSync( PATH.join( config, '~host.json' ), PATH.join( config, '~host.json.aside' ) );
		let by_port = await HOST.Status( config );
		ASSERT.deepEqual( [ by_port.Running, by_port.Url, by_port.Ours ], [ true, 'http://127.0.0.1:' + port, false ] );
		FS.renameSync( PATH.join( config, '~host.json.aside' ), PATH.join( config, '~host.json' ) );
		// the folder registered on the Host: unmounted, not routed; mounted, routed to the Host's project
		let headers = { 'Content-Type': 'application/json', 'X-Consensus-Service': 'Test' };
		let made = await ( await fetch( status.Url + '/api/projects', { method: 'POST', headers: headers, body: JSON.stringify( { Name: 'served', Path: folder } ) } ) ).json();
		ASSERT.equal( made.Project.Mounted, false );
		ASSERT.equal( await HOST.Routed( config, folder ), null, 'unmounted: opened as a plain project' );
		let mounted = await ( await fetch( status.Url + '/api/projects/' + made.Project.Id + '/mount', { method: 'PUT', headers: headers, body: JSON.stringify( { Mounted: true } ) } ) ).json();
		ASSERT.equal( mounted.Project.Mounted, true );
		let routed = await HOST.Routed( config, folder.toUpperCase() );
		ASSERT.deepEqual( routed, { Url: status.Url, Project: { Id: made.Project.Id, Name: 'served' } } );
		ASSERT.equal( await HOST.Routed( config, PATH.join( folder, '..', 'elsewhere' ) ), null );
	}
	finally
	{
		let stopped = HOST.Stop( config );
		ASSERT.equal( stopped.Stopped, true, stopped.Error );
		let waited = 0;
		while ( waited < 10000 && ( await HOST.Status( config, port ) ).Running )
		{
			await new Promise( function ( resolve ) { setTimeout( resolve, 200 ); } );
			waited += 200;
		}
	}
	let after = await HOST.Status( config, port );
	ASSERT.equal( after.Running, false );
	ASSERT.deepEqual( HOST.Stop( config ), { Stopped: false, Error: 'no Server Host of this machine\'s is running' } );
	ASSERT.equal( await HOST.Routed( config, folder ), null, 'the Host gone, the folder opens as a plain project' );
} );


//---------------------------------------------------------------------
// The license (plan Rearchitecturation, Step 6)

