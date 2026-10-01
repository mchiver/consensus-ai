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
	ASSERT.deepEqual( read, { Servers: [], Local: { Data: '', Port: null }, Last: null, Theme: 'system', Scale: 'normal' } );

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
