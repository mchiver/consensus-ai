'use strict';

// The desktop (plan Consensus Desktop, Step 2), without Electron: its settings module (the desktop's fields of the
// global config, filled, applied, moved in from desktop.json once: plan Run Shapes, Step 1), and the page server
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
	ASSERT.deepEqual( read, { Servers: [], Local: { Theme: null }, Last: null, Theme: 'system', Scale: 'normal', Remembered: {} } );

	let settings = SETTINGS.Fill( {
		Servers: [ { Name: ' cube4 ', Url: 'http://cube4:3500/' } ],
		Local: { Data: folder, Port: 3500 },
		Last: { Kind: 'server', Name: 'cube4' },
		Theme: 'dark',
		Scale: 'huge',
		Extra: true,
	} );
	ASSERT.deepEqual( settings, {
		Servers: [ { Name: 'cube4', Url: 'http://cube4:3500', Theme: null } ],
		Local: { Theme: null },
		Last: { Kind: 'server', Name: 'cube4' },
		Theme: 'dark',
		Scale: 'normal',
		Remembered: {},
	} );
	SETTINGS.Write( path, settings );
	ASSERT.deepEqual( SETTINGS.Read( path ), settings );
	ASSERT.equal( FS.readdirSync( folder ).some( function ( name ) { return name.endsWith( '.tmp' ); } ), false );
	ASSERT.deepEqual( SETTINGS.Fill( { Last: { Kind: 'local', Name: 'ignored' } } ).Last, { Kind: 'local' } );
	ASSERT.deepEqual( SETTINGS.Fill( { Last: { Kind: 'elsewhere' } } ).Last, null );
	// the palettes (plan UI Tweaks IV): any of them is a Theme; the dark ones are named
	ASSERT.equal( SETTINGS.Fill( { Theme: 'nord' } ).Theme, 'nord' );
	ASSERT.equal( SETTINGS.Fill( { Theme: 'neon' } ).Theme, 'system' );
	ASSERT.equal( SETTINGS.DARK_THEMES.includes( 'nord' ), true );
	ASSERT.equal( SETTINGS.DARK_THEMES.includes( 'sepia' ), false );
	ASSERT.equal( SETTINGS.DARK_THEMES.every( function ( theme ) { return SETTINGS.THEMES.includes( theme ); } ), true );

	// a theme per server (plan UI Tweaks V): the server's own, else the default; set for what is connected
	let themed = SETTINGS.Fill( { Theme: 'sepia', Servers: [ { Name: 'a', Url: 'http://a:1', Theme: 'nord' }, { Name: 'b', Url: 'http://b:1', Theme: 'neon' } ], Local: { Theme: 'slate' } } );
	ASSERT.equal( themed.Servers[ 0 ].Theme, 'nord' );
	ASSERT.equal( themed.Servers[ 1 ].Theme, null );
	ASSERT.equal( themed.Local.Theme, 'slate' );
	ASSERT.equal( SETTINGS.ThemeFor( themed, null ), 'sepia' );
	ASSERT.equal( SETTINGS.ThemeFor( themed, { Kind: 'server', Name: 'a' } ), 'nord' );
	ASSERT.equal( SETTINGS.ThemeFor( themed, { Kind: 'server', Name: 'b' } ), 'sepia' );
	ASSERT.equal( SETTINGS.ThemeFor( themed, { Kind: 'server', Name: 'nobody' } ), 'sepia' );
	ASSERT.equal( SETTINGS.ThemeFor( themed, { Kind: 'local' } ), 'slate' );
	SETTINGS.SetThemeFor( themed, { Kind: 'server', Name: 'b' }, 'midnight' );
	SETTINGS.SetThemeFor( themed, { Kind: 'local' }, 'paper' );
	SETTINGS.SetThemeFor( themed, null, 'light' );
	SETTINGS.SetThemeFor( themed, { Kind: 'server', Name: 'a' }, 'neon' );
	ASSERT.equal( themed.Servers[ 1 ].Theme, 'midnight' );
	ASSERT.equal( themed.Local.Theme, 'paper' );
	ASSERT.equal( themed.Theme, 'light' );
	ASSERT.equal( themed.Servers[ 0 ].Theme, 'nord' );
	SETTINGS.Write( path, themed );
	ASSERT.equal( SETTINGS.ThemeFor( SETTINGS.Read( path ), { Kind: 'server', Name: 'b' } ), 'midnight' );

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
	ASSERT.deepEqual( SETTINGS.ServerNamed( settings, 'cube4' ), { Name: 'cube4', Url: 'http://cube4:3500', Theme: null } );
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
// The desktop's fields in the global config (plan Run Shapes, Step 1)

TEST( 'Apply puts the desktop\'s fields on the global config in place; MoveIn takes them from desktop.json once, else the defaults', function ()
{
	let config = { Name: 'here', Port: 3500, Scope: 'Local', States: [ 'Draft' ], Participants: [ { Name: 'user', Role: 'owner', Token: 'a-token-long-enough-0123' } ] };
	let folder = temporary_folder( 'desktop-movein-' );
	let path = PATH.join( folder, 'desktop.json' );
	let written = SETTINGS.Fill( { Servers: [ { Name: 'cube4', Url: 'http://cube4:3500' } ], Local: { Data: 'W:/old', Port: 3500, Theme: 'nord' }, Last: { Kind: 'local' }, Theme: 'dark', Remembered: { 'consensus.x': 1 } } );
	written.Llms = [ { Name: 'Claude', Kind: 'claude-cli', Model: 'sonnet' } ];
	written.Workspaces = [ { Id: 'wks-1', Name: 'repo', Project: 'default', Path: 'W:/code/repo', Include: [], Exclude: [], Commands: [ 'npm test' ] } ];
	SETTINGS.Write( path, written );
	let lines = SETTINGS.MoveIn( config, path );
	ASSERT.equal( lines.length, 3 );
	ASSERT.match( lines[ 0 ], /desktop\.json moved into the config/ );
	ASSERT.match( lines[ 1 ], /1 LLM connection\(s\) moved in/ );
	ASSERT.match( lines[ 2 ], /1 workspace\(s\) moved in/ );
	// the LLM connections become the server's (plan Run Shapes, Step 3), filled with a token; the workspaces wait for the migration
	ASSERT.equal( config.Llms.length, 1 );
	ASSERT.equal( config.Llms[ 0 ].Name, 'Claude' );
	ASSERT.equal( config.Llms[ 0 ].Token.length >= 16, true );
	ASSERT.deepEqual( config.Workspaces, written.Workspaces );
	ASSERT.equal( FS.existsSync( path ), false );
	ASSERT.equal( FS.existsSync( path + '.moved' ), true );
	ASSERT.deepEqual( config.Servers, [ { Name: 'cube4', Url: 'http://cube4:3500', Theme: null } ] );
	ASSERT.deepEqual( config.Local, { Theme: 'nord' } );
	ASSERT.deepEqual( config.Last, { Kind: 'local' } );
	ASSERT.equal( config.Theme, 'dark' );
	ASSERT.deepEqual( config.Remembered, { 'consensus.x': 1 } );
	ASSERT.deepEqual( [ config.Name, config.Scope, config.Participants[ 0 ].Token ], [ 'here', 'Local', 'a-token-long-enough-0123' ] );
	// once: a config with its desktop fields is left alone; one written by hand gets the fields it lacks
	ASSERT.deepEqual( SETTINGS.MoveIn( config, path ), [] );
	let by_hand = { Name: 'h', Scope: 'None', Participants: [], Servers: [ { Name: 's', Url: 'http://s:1' } ], Theme: 'light' };
	ASSERT.deepEqual( SETTINGS.MoveIn( by_hand, path ), [ 'the desktop\'s settings filled in: Local, Last, Scale, Remembered' ] );
	ASSERT.deepEqual( [ by_hand.Servers[ 0 ].Theme, by_hand.Theme, by_hand.Scale, by_hand.Remembered, by_hand.Scope ], [ null, 'light', 'normal', {}, 'None' ] );
	ASSERT.equal( SETTINGS.Remember( {}, 'k', 1 ), true );
	// no desktop.json: the defaults
	let fresh = { Name: 'n', Scope: 'Local', Participants: [] };
	ASSERT.match( SETTINGS.MoveIn( fresh, PATH.join( folder, 'none.json' ) )[ 0 ], /start with the defaults/ );
	ASSERT.deepEqual( fresh.Servers, [] );
	ASSERT.equal( fresh.Theme, 'system' );
	ASSERT.deepEqual( Object.keys( fresh ).sort(), [ 'Name', 'Participants', 'Scope' ].concat( SETTINGS.DESKTOP_FIELDS ).sort() );
	ASSERT.equal( config.Llms.length, 1 );
	// Apply: in place, the server's fields untouched, the desktop's all replaced
	let same = config;
	SETTINGS.Apply( config, SETTINGS.Fill( Object.assign( {}, config, { Theme: 'sepia', Servers: [] } ) ) );
	ASSERT.equal( same, config );
	ASSERT.equal( config.Theme, 'sepia' );
	ASSERT.deepEqual( config.Servers, [] );
	ASSERT.deepEqual( config.Local, { Theme: 'nord' } );
	ASSERT.equal( config.Name, 'here' );
	// Fill gives the pages the desktop's fields only: no participants, no tokens
	ASSERT.equal( 'Participants' in SETTINGS.Fill( config ), false );
} );
