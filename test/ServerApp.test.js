'use strict';

// ServerApp.test - the Server on the command line (plan The Server, Step 3): bin/consensus-server.js --headless is
// consensus serve, gated: closed with no licensed sign-in behind it, open under a Personal current user; --open needs
// the window. The window itself is looked at by the smoke (npm run smoke), which needs Electron with a screen.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const FS = require( 'fs' );
const OS = require( 'os' );
const PATH = require( 'path' );
const CHILD_PROCESS = require( 'child_process' );
const LICENSE = require( '../src/License.js' );

const BIN = PATH.join( __dirname, '..', 'bin', 'consensus-server.js' );


function temporary_folder()
{
	return FS.mkdtempSync( PATH.join( OS.tmpdir(), 'consensus-server-app-' ) );
}


// The headless Server started until a line matches Pattern; answers { Child, Lines, Url }.
function start_until( Config, Pattern )
{
	return new Promise( function ( Resolve, Reject )
	{
		let child = CHILD_PROCESS.spawn( process.execPath, [ BIN, '--headless', '--config', Config, '--port', '0' ], { stdio: [ 'ignore', 'pipe', 'pipe' ] } );
		let text = '';
		let timer = setTimeout( function () { child.kill(); Reject( new Error( 'no line matching ' + Pattern + ' in: ' + text ) ); }, 20000 );
		function seen( chunk )
		{
			text += String( chunk );
			if ( Pattern.test( text ) )
			{
				clearTimeout( timer );
				let url = /Consensus at (http:\/\/[^\s]+?)\/ /.exec( text );
				Resolve( { Child: child, Lines: text.split( /\r?\n/ ), Url: url ? url[ 1 ] : null } );
			}
		}
		child.stdout.on( 'data', seen );
		child.stderr.on( 'data', seen );
		child.on( 'exit', function () { clearTimeout( timer ); } );
	} );
}


function stop( Child )
{
	return new Promise( function ( Resolve )
	{
		if ( Child.exitCode !== null )
		{
			Resolve();
			return;
		}
		Child.on( 'exit', function () { Resolve(); } );
		Child.kill();
	} );
}


TEST( 'consensus-server --headless: consensus serve behind the gate: closed with nobody behind it, the API refused but Clerk\'s route; open under a Personal current user, who becomes the Administrator', async function ()
{
	let config = temporary_folder();
	let closed = await start_until( config, /Ctrl\+C stops the server/ );
	try
	{
		ASSERT.ok( closed.Lines.some( function ( line ) { return line.startsWith( 'closed: the Server waits for its first sign-in' ); } ), closed.Lines.join( '\n' ) );
		let me = await fetch( closed.Url + '/api/me' );
		let body = await me.json();
		ASSERT.deepEqual( [ me.status, body.Error, body.Closed ], [ 401, 'sign in', true ] );
		ASSERT.match( body.Reason, /first sign-in/ );
		ASSERT.equal( ( await fetch( closed.Url + '/api/clerk' ) ).status, 200, 'what the page needs to sign in stays open' );
		ASSERT.equal( ( await fetch( closed.Url + '/' ) ).status, 200, 'the page itself is served' );
	}
	finally
	{
		await stop( closed.Child );
	}
	LICENSE.Write( config, { Email: 'ann@example.com', Clerk: 'user_ann', Display: 'Ann', Plan: 'personal', Until: null, Checked: new Date().toISOString() } );
	let open = await start_until( config, /Ctrl\+C stops the server/ );
	try
	{
		ASSERT.ok( open.Lines.some( function ( line ) { return line === 'open under the Administrator ann@example.com (personal)'; } ), open.Lines.join( '\n' ) );
		// open, and as any Server it tells people apart (plan The Server, Step 5): a bare request signs in
		let bare = await fetch( open.Url + '/api/me' );
		ASSERT.deepEqual( [ bare.status, ( await bare.json() ).Closed ], [ 401, undefined ] );
		ASSERT.equal( JSON.parse( FS.readFileSync( PATH.join( config, 'consensus.json' ), 'utf8' ) ).Clerk.AdminEmail, 'ann@example.com' );
	}
	finally
	{
		await stop( open.Child );
	}
} );


TEST( 'consensus-server --headless --open: refused, the folder command needs the window', function ()
{
	let answer = CHILD_PROCESS.spawnSync( process.execPath, [ BIN, '--headless', '--open', temporary_folder() ], { encoding: 'utf8' } );
	ASSERT.equal( answer.status, 1 );
	ASSERT.match( answer.stderr, /--open needs the Server application's window/ );
} );


//---------------------------------------------------------------------
// The window of the shared kind (plan Review 2026-10-29, Step 3): what plain node can check of it. The window itself
// is looked at by the smoke.

TEST( 'server.json: the window\'s look and remembered state in the config folder, over the base Settings; nothing of consensus.json', function ()
{
	const SETTINGS = require( '../server/Settings.js' );
	const BASE = require( '../electron/Settings.js' );
	let config = temporary_folder();
	ASSERT.equal( SETTINGS.Path( config ), PATH.join( config, 'server.json' ) );
	FS.writeFileSync( PATH.join( config, 'consensus.json' ), JSON.stringify( { Name: 'host', Theme: 'dark', Scope: 'Local' } ) );
	let loaded = SETTINGS.Load( config );
	ASSERT.deepEqual( loaded.Settings, { Theme: 'system', Scale: 'normal', Remembered: {} } );
	ASSERT.deepEqual( loaded.Lines, [ 'server settings start with the defaults (' + loaded.Path + ' is written at the first change)' ] );
	ASSERT.equal( SETTINGS.Write( config, { Theme: 'nord', Scale: 'large', Remembered: { 'page-port': 51000 }, Projects: [ 'not ours' ] } ), loaded.Path );
	ASSERT.deepEqual( SETTINGS.Load( config ).Settings, { Theme: 'nord', Scale: 'large', Remembered: { 'page-port': 51000 } } );
	ASSERT.equal( SETTINGS.THEMES, BASE.THEMES );
	ASSERT.equal( SETTINGS.Remember, BASE.Remember );
	ASSERT.equal( JSON.parse( FS.readFileSync( PATH.join( config, 'consensus.json' ), 'utf8' ) ).Theme, 'dark', 'the server\'s own file is not touched' );
} );


TEST( 'the Server window\'s bridge is the shared one: the preload exposes ConsensusDesktop with Edition server, SetLicense and the folder picker, and no ConsensusServer; every preload names its Edition; the build carries electron/', function ()
{
	let preload = FS.readFileSync( PATH.join( __dirname, '..', 'server', 'preload.js' ), 'utf8' );
	ASSERT.match( preload, /exposeInMainWorld\( 'ConsensusDesktop', \{\s*Edition: 'server',/ );
	ASSERT.match( preload, /SetLicense: function \( Token \) \{ return invoke\( 'set-license', Token \); \}/ );
	ASSERT.match( preload, /PickFolder: function \( Current \) \{ return invoke\( 'folder', Current \); \}/ );
	ASSERT.doesNotMatch( preload, /ConsensusServer/ );
	for ( let edition of [ 'desktop', 'sidecar', 'client' ] )
	{
		let text = FS.readFileSync( PATH.join( __dirname, '..', edition, 'preload.js' ), 'utf8' );
		ASSERT.match( text, new RegExp( 'Edition: \'' + edition + '\',' ), edition );
	}
	for ( let script of [ 'roots.js', 'session.js' ] )
	{
		ASSERT.doesNotMatch( FS.readFileSync( PATH.join( __dirname, '..', 'public', 'js', script ), 'utf8' ), /ConsensusServer/, script );
	}
	let build = JSON.parse( FS.readFileSync( PATH.join( __dirname, '..', 'build', 'server.json' ), 'utf8' ) );
	ASSERT.ok( build.files.includes( 'electron/**' ), 'electron/** in the build' );
	ASSERT.ok( build.files.includes( 'server/Settings.js' ), 'server/Settings.js in the build' );
} );
