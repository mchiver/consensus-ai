'use strict';

// The desktop (plan Consensus Desktop, Step 2), without Electron: its settings module (the desktop's fields of the
// global config, filled, applied and prepared at start: plan Run Shapes, Step 1), and the page server
// that serves its copy of the Consensus page and the vendor files.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const FS = require( 'fs' );
const OS = require( 'os' );
const PATH = require( 'path' );
const SETTINGS = require( '../desktop/Settings.js' );
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
	ASSERT.deepEqual( read, { Servers: [], Theme: 'system', Scale: 'normal', Remembered: {} } );

	let settings = SETTINGS.Fill( {
		Servers: [ { Name: ' cube4 ', Url: 'http://cube4:3500/' } ],
		Local: { Data: folder, Port: 3500 },
		Last: { Kind: 'server', Name: 'cube4' },
		Theme: 'dark',
		Scale: 'huge',
		Extra: true,
	} );
	// Last and the theme per server (before plan Run Shapes, Step 5) are not kept
	ASSERT.deepEqual( settings, {
		Servers: [ { Name: 'cube4', Url: 'http://cube4:3500' } ],
		Theme: 'dark',
		Scale: 'normal',
		Remembered: {},
	} );
	SETTINGS.Write( path, settings );
	ASSERT.deepEqual( SETTINGS.Read( path ), settings );
	ASSERT.equal( FS.readdirSync( folder ).some( function ( name ) { return name.endsWith( '.tmp' ); } ), false );
	ASSERT.equal( 'Last' in SETTINGS.Fill( { Last: { Kind: 'local' } } ), false );
	ASSERT.equal( 'Theme' in SETTINGS.Fill( { Servers: [ { Name: 'a', Url: 'http://a:1', Theme: 'nord' } ] } ).Servers[ 0 ], false );
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
// The desktop's fields in the global config (plan Run Shapes, Step 1)

TEST( 'Prepare fills the desktop\'s fields in on the global config, once; Apply puts them on in place', function ()
{
	let config = { Name: 'here', Port: 3500, Scope: 'Local', States: [ 'Draft' ], Owner: { Name: 'user', Display: 'User' } };
	// a config with none yet: the defaults, with a line; a second start changes nothing
	ASSERT.deepEqual( SETTINGS.Prepare( config ), [ 'the desktop\'s settings start with the defaults' ] );
	ASSERT.deepEqual( [ config.Servers, config.Theme, config.Scale, config.Remembered ], [ [], 'system', 'normal', {} ] );
	ASSERT.deepEqual( [ config.Name, config.Scope, config.Owner.Name ], [ 'here', 'Local', 'user' ] );
	ASSERT.deepEqual( Object.keys( config ).sort(), [ 'Name', 'Port', 'Scope', 'States', 'Owner' ].concat( SETTINGS.DESKTOP_FIELDS ).sort() );
	ASSERT.deepEqual( SETTINGS.Prepare( config ), [] );
	// one written by hand gets the fields it lacks, the rest kept and filled
	let by_hand = { Name: 'h', Scope: 'None', Owner: { Name: 'user' }, Servers: [ { Name: 's', Url: 'http://s:1/' } ], Theme: 'light' };
	ASSERT.deepEqual( SETTINGS.Prepare( by_hand ), [ 'the desktop\'s settings filled in: Scale, Remembered' ] );
	ASSERT.deepEqual( [ by_hand.Servers[ 0 ], by_hand.Theme, by_hand.Scale, by_hand.Remembered, by_hand.Scope ], [ { Name: 's', Url: 'http://s:1' }, 'light', 'normal', {}, 'None' ] );
	ASSERT.deepEqual( SETTINGS.Prepare( by_hand ), [] );
	ASSERT.equal( SETTINGS.Remember( {}, 'k', 1 ), true );
	// Apply: in place, the server's fields untouched, the desktop's all replaced
	let same = config;
	SETTINGS.Apply( config, SETTINGS.Fill( Object.assign( {}, config, { Theme: 'sepia', Servers: [] } ) ) );
	ASSERT.equal( same, config );
	ASSERT.equal( config.Theme, 'sepia' );
	ASSERT.deepEqual( config.Servers, [] );
	ASSERT.equal( config.Name, 'here' );
	// Fill gives the pages the desktop's fields only: no owner, no server fields
	ASSERT.equal( 'Owner' in SETTINGS.Fill( config ), false );
} );
