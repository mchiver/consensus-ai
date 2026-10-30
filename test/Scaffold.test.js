'use strict';

// Scaffold.test - the shared Electron scaffold (plan Review 2026-10-29, Step 2), in plain node: App.Arguments on each
// app's command line, the Saver, the base Settings module, the look lists kept equal to the page's theme.js, the
// current user over a config folder.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const FS = require( 'fs' );
const OS = require( 'os' );
const PATH = require( 'path' );
const APP = require( '../electron/App.js' );
const SETTINGS = require( '../electron/Settings.js' );
const SERVERS = require( '../electron/Servers.js' );
const CURRENT_USER = require( '../electron/CurrentUser.js' );
const LICENSE = require( '../src/License.js' );

const EXE = [ 'C:/electron.exe', 'W:/checkout' ];		// from the checkout: the executable and the app folder lead


function temporary_folder()
{
	return FS.mkdtempSync( PATH.join( OS.tmpdir(), 'consensus-scaffold-' ) );
}


function wait( milliseconds )
{
	return new Promise( function ( resolve ) { setTimeout( resolve, milliseconds ); } );
}


//---------------------------------------------------------------------
// App.Arguments

TEST( 'Arguments: the Sidecar\'s line: one folder and --port; a second folder, an unknown flag and a bad port are refused', function ()
{
	let flags = [ { Name: '--port', Takes: 'number', Key: 'Port', Needs: 'a port number' }, { Name: '--help', Alias: '-h', Takes: 'flag', Key: 'Help' } ];
	let options = { Title: 'Sidecar', Positional: true, Flags: flags, Packaged: false };
	ASSERT.deepEqual( APP.Arguments( EXE.concat( [ 'W:/p', '--port', '52001', '--remote-debugging-port=9222' ] ), options ), { Options: { Port: 52001, Help: false }, Positional: 'W:/p', Rest: [] } );
	ASSERT.deepEqual( APP.Arguments( EXE, options ), { Options: { Port: null, Help: false }, Positional: null, Rest: [] } );
	ASSERT.deepEqual( APP.Arguments( EXE.concat( [ '-h' ] ), options ).Options.Help, true );
	ASSERT.deepEqual( APP.Arguments( [ 'C:/Consensus Sidecar.exe', 'W:/p' ], Object.assign( {}, options, { Packaged: true } ) ).Positional, 'W:/p' );
	ASSERT.throws( function () { APP.Arguments( EXE.concat( [ 'W:/p', 'W:/q' ] ), options ); }, /one folder only: W:\/q/ );
	ASSERT.throws( function () { APP.Arguments( EXE.concat( [ '--config', 'x' ] ), options ); }, /not an argument Sidecar knows: --config/ );
	ASSERT.throws( function () { APP.Arguments( EXE.concat( [ '--port' ] ), options ); }, /--port needs a port number/ );
	ASSERT.throws( function () { APP.Arguments( EXE.concat( [ '--port', '--help' ] ), options ); }, /--port needs a port number/ );
	ASSERT.throws( function () { APP.Arguments( EXE.concat( [ '--port', 'abc' ] ), options ); }, /--port needs a port number/ );
	ASSERT.throws( function () { APP.Arguments( EXE.concat( [ '--port', '-1' ] ), options ); }, /--port needs a port number/ );
} );


TEST( 'Arguments: the Desktop\'s line: --config alone; a bare argument and --port are refused (plan Review 2026-10-29, Step 5.1: the Desktop opens no folder and has no server)', function ()
{
	let flags = [ { Name: '--config', Takes: 'value', Key: 'Config', Needs: 'a folder' }, { Name: '--help', Alias: '-h', Takes: 'flag', Key: 'Help' } ];
	let options = { Title: 'the Desktop', Flags: flags, Packaged: false };
	ASSERT.deepEqual( APP.Arguments( EXE.concat( [ '--config', 'C:/cfg' ] ), options ), { Options: { Config: 'C:/cfg', Help: false }, Positional: null, Rest: [] } );
	ASSERT.throws( function () { APP.Arguments( EXE.concat( [ 'W:/p' ] ), options ); }, /not an argument the Desktop knows: W:\/p/ );
	ASSERT.throws( function () { APP.Arguments( EXE.concat( [ '--port', '0' ] ), options ); }, /not an argument the Desktop knows: --port/ );
	ASSERT.throws( function () { APP.Arguments( EXE.concat( [ '--config' ] ), options ); }, /--config needs a folder/ );
} );


TEST( 'Arguments: the Client\'s line: --connect <server> with and without the project, --config; --port and a second project are refused (the bare folder is main.js\'s to refuse, test/Client.test.js)', function ()
{
	let flags = [ { Name: '--connect', Takes: 'value', Key: 'Connect', Needs: 'the Name of a saved Server' }, { Name: '--config', Takes: 'value', Key: 'Config', Needs: 'a folder' }, { Name: '--help', Alias: '-h', Takes: 'flag', Key: 'Help' } ];
	let options = { Title: 'the Client', Positional: true, PositionalName: 'project', Flags: flags, Packaged: false };
	ASSERT.deepEqual( APP.Arguments( EXE.concat( [ '--connect', 'Team', 'Alpha', '--config', 'C:/cfg' ] ), options ), { Options: { Connect: 'Team', Config: 'C:/cfg', Help: false }, Positional: 'Alpha', Rest: [] } );
	ASSERT.deepEqual( APP.Arguments( EXE.concat( [ '--connect', 'Team' ] ), options ).Positional, null );
	ASSERT.throws( function () { APP.Arguments( EXE.concat( [ '--connect' ] ), options ); }, /--connect needs the Name of a saved Server/ );
	ASSERT.throws( function () { APP.Arguments( EXE.concat( [ '--connect', '--config', 'x' ] ), options ); }, /--connect needs the Name of a saved Server/ );
	ASSERT.throws( function () { APP.Arguments( EXE.concat( [ '--port', '0' ] ), options ); }, /not an argument the Client knows: --port/ );
	ASSERT.throws( function () { APP.Arguments( EXE.concat( [ '--connect', 'Team', 'Alpha', 'Beta' ] ), options ); }, /one project only: Beta/ );
} );


TEST( 'Arguments: the Server\'s line: its own flag taken, the rest kept in order for Start.js', function ()
{
	let server = { Title: 'the Server', Rest: true, Flags: [ { Name: '--open', Takes: 'value', Key: 'Open', Needs: 'a folder' } ], Packaged: false };
	ASSERT.deepEqual( APP.Arguments( EXE.concat( [ '--headless', '--open', 'W:/p', '--scope', 'public', '--allow-file-access' ] ), server ), { Options: { Open: 'W:/p' }, Positional: null, Rest: [ '--headless', '--scope', 'public' ] } );
	ASSERT.deepEqual( APP.Arguments( EXE.concat( [ 'W:/p', '--config', 'C:/cfg' ] ), server ), { Options: { Open: null }, Positional: null, Rest: [ 'W:/p', '--config', 'C:/cfg' ] } );
	ASSERT.throws( function () { APP.Arguments( EXE.concat( [ '--open' ] ), server ); }, /--open needs a folder/ );
	ASSERT.ok( APP.ELECTRON_SWITCH.test( '--user-data-dir=C:/x' ) );
	ASSERT.ok( !APP.ELECTRON_SWITCH.test( '--config' ) );
} );


//---------------------------------------------------------------------
// App.Saver

TEST( 'Saver: Save writes now, SaveSoon a moment after the last call, Flush what is pending; a Write that throws is logged, not thrown', async function ()
{
	let writes = 0;
	let saver = APP.Saver( { Write: function () { writes++; }, Label: 'the test settings' } );
	saver.Save();
	ASSERT.equal( writes, 1 );
	saver.SaveSoon();
	saver.SaveSoon();
	saver.SaveSoon();
	ASSERT.equal( writes, 1 );
	await wait( APP.SAVE_DELAY + 100 );
	ASSERT.equal( writes, 2, 'three SaveSoon calls are one write' );
	saver.Flush();
	ASSERT.equal( writes, 2, 'nothing pending: nothing written' );
	saver.SaveSoon();
	saver.Flush();
	ASSERT.equal( writes, 3, 'Flush writes what SaveSoon left pending' );
	await wait( APP.SAVE_DELAY + 100 );
	ASSERT.equal( writes, 3, 'and the timer is gone' );
	let logged = [];
	let original = console.error;
	console.error = function ( line ) { logged.push( line ); };
	try
	{
		APP.Saver( { Write: function () { throw new Error( 'disk full' ); }, Label: 'the test settings' } ).Save();
	}
	finally
	{
		console.error = original;
	}
	ASSERT.deepEqual( logged, [ 'the test settings could not be written: disk full' ] );
} );


//---------------------------------------------------------------------
// The base Settings module

TEST( 'Settings.Make: Path under the folder (a File may hold a folder), Load the defaults when missing or unreadable with a line, Write filled and whole', function ()
{
	let made = SETTINGS.Make( {
		File: '.app/test.json',
		Label: 'test settings',
		Default: function () { return { Name: 'none', Theme: 'system', Scale: 'normal', Remembered: {} }; },
		Fill: function ( given ) { let settings = { Name: ( given && typeof given.Name === 'string' ) ? given.Name : 'none', Theme: 'system', Scale: 'normal', Remembered: {} }; return SETTINGS.FillLook( given, settings ); },
	} );
	let folder = temporary_folder();
	let path = made.Path( folder );
	ASSERT.equal( path, PATH.join( folder, '.app', 'test.json' ) );
	let loaded = made.Load( folder );
	ASSERT.deepEqual( loaded, { Settings: { Name: 'none', Theme: 'system', Scale: 'normal', Remembered: {} }, Path: path, Lines: [ 'test settings start with the defaults (' + path + ' is written at the first change)' ] } );
	ASSERT.equal( FS.existsSync( path ), false, 'a read writes nothing' );
	ASSERT.equal( made.Write( folder, { Name: 'ann', Theme: 'nord', Scale: 'huge', Remembered: { a: 1 }, Extra: true } ), path );
	ASSERT.deepEqual( JSON.parse( FS.readFileSync( path, 'utf8' ) ), { Name: 'ann', Theme: 'nord', Scale: 'normal', Remembered: { a: 1 } } );
	ASSERT.deepEqual( made.Load( folder ), { Settings: { Name: 'ann', Theme: 'nord', Scale: 'normal', Remembered: { a: 1 } }, Path: path, Lines: [ 'test settings from ' + path ] } );
	FS.writeFileSync( path, '{ not json' );
	let broken = made.Load( folder );
	ASSERT.deepEqual( broken.Settings, { Name: 'none', Theme: 'system', Scale: 'normal', Remembered: {} } );
	ASSERT.match( broken.Lines[ 0 ], /^test\.json could not be read \(.*\): the defaults, and the file is left as it is/ );
	ASSERT.equal( FS.readFileSync( path, 'utf8' ), '{ not json' );
} );


TEST( 'Settings.Remember: one behaviour for every app: a deep copy, the key capped, null or undefined forgets, whether anything changed', function ()
{
	let settings = { Remembered: {} };
	let value = { Tabs: [ { Key: 'p:x' } ] };
	ASSERT.equal( SETTINGS.Remember( settings, 'consensus.tabs', value ), true );
	ASSERT.equal( SETTINGS.Remember( settings, 'consensus.tabs', value ), false );
	value.Tabs.push( { Key: 'p:y' } );
	ASSERT.deepEqual( settings.Remembered[ 'consensus.tabs' ], { Tabs: [ { Key: 'p:x' } ] }, 'a copy, not the caller\'s object' );
	ASSERT.equal( SETTINGS.Remember( settings, 'consensus.tabs', value ), true );
	ASSERT.equal( SETTINGS.Remember( settings, 'consensus.tabs', null ), true );
	ASSERT.equal( SETTINGS.Remember( settings, 'consensus.tabs', undefined ), false );
	ASSERT.equal( SETTINGS.Remember( settings, '', 1 ), false );
	ASSERT.equal( SETTINGS.Remember( settings, 'k'.repeat( SETTINGS.KEY_LIMIT + 1 ), 1 ), false );
	ASSERT.equal( SETTINGS.Remember( settings, 'k'.repeat( SETTINGS.KEY_LIMIT ), 1 ), true );
	ASSERT.equal( SETTINGS.Remember( settings, 'fn', function () {} ), false, 'what JSON cannot hold is not remembered' );
	ASSERT.equal( SETTINGS.Remember( null, 'x', 1 ), false );
	let fresh = {};
	ASSERT.equal( SETTINGS.Remember( fresh, 'x', 1 ), true );
	ASSERT.deepEqual( fresh.Remembered, { x: 1 } );
} );


//---------------------------------------------------------------------
// The look lists, kept equal to the page's

TEST( 'the look lists: electron/Settings.js names the palettes theme.js names, the same ones dark, and the same scales', function ()
{
	let text = FS.readFileSync( PATH.join( __dirname, '..', 'public', 'js', 'theme.js' ), 'utf8' );
	let palettes = [];
	let pattern = /\{\s*Id:\s*'([^']+)',\s*Label:\s*'[^']*',\s*Dark:\s*(true|false|null)\s*\}/g;
	let match = pattern.exec( text );
	while ( match )
	{
		palettes.push( { Id: match[ 1 ], Dark: match[ 2 ] === 'true' } );
		match = pattern.exec( text );
	}
	ASSERT.ok( palettes.length >= 5, 'theme.js lists its palettes as { Id, Label, Dark }' );
	ASSERT.deepEqual( SETTINGS.THEMES, palettes.map( function ( palette ) { return palette.Id; } ) );
	ASSERT.deepEqual( SETTINGS.DARK_THEMES, palettes.filter( function ( palette ) { return palette.Dark; } ).map( function ( palette ) { return palette.Id; } ) );
	let scales = /const SCALES = \{([^}]*)\}/.exec( text );
	ASSERT.ok( scales, 'theme.js lists its scales' );
	ASSERT.deepEqual( SETTINGS.SCALES, scales[ 1 ].split( ',' ).map( function ( part ) { return part.split( ':' )[ 0 ].trim(); } ).filter( Boolean ) );
	// the app modules carry the one list
	for ( let module of [ '../desktop/Settings.js', '../sidecar/Settings.js', '../client/Settings.js' ] )
	{
		let app = require( module );
		ASSERT.equal( app.THEMES, SETTINGS.THEMES, module );
		ASSERT.equal( app.DARK_THEMES, SETTINGS.DARK_THEMES, module );
		ASSERT.equal( app.SCALES, SETTINGS.SCALES, module );
		ASSERT.equal( app.Remember, SETTINGS.Remember, module );
	}
} );


//---------------------------------------------------------------------
// The Servers store and the current user

TEST( 'Servers.Fill: the usable entries, a name taken twice kept once; Named finds whatever the case', function ()
{
	let servers = SERVERS.Fill( [ { Name: ' Team ', Url: 'https://team.example.com/' }, { Name: 'team', Url: 'http://other:1' }, { Name: 'Bad', Url: 'bad' }, { Name: 'a/b', Url: 'http://x:1' }, null ] );
	ASSERT.deepEqual( servers, [ { Name: 'Team', Url: 'https://team.example.com' } ] );
	ASSERT.equal( SERVERS.Named( { Servers: servers }, 'TEAM' ), servers[ 0 ] );
	ASSERT.equal( SERVERS.Named( { Servers: servers }, 'nope' ), null );
	ASSERT.deepEqual( SERVERS.Fill( 'x' ), [] );
} );


TEST( 'CurrentUser.Make: over a config folder given as a path or a function; nobody is unlicensed, a lapsed record is removed, Clear signs out', function ()
{
	let folder = temporary_folder();
	let user = CURRENT_USER.Make( function () { return folder; } );
	ASSERT.equal( user.Read(), null );
	ASSERT.equal( user.Tier().Tier, 'unlicensed' );
	LICENSE.Write( folder, { Email: 'ann@example.com', Clerk: 'user_ann', Display: 'Ann', Plan: 'personal', Until: null, Checked: new Date().toISOString() } );
	ASSERT.equal( user.Read().Email, 'ann@example.com' );
	ASSERT.equal( user.Tier().Tier, 'personal' );
	ASSERT.equal( CURRENT_USER.Make( folder ).Tier().Tier, 'personal', 'a path works as well as a function' );
	ASSERT.equal( user.Clear().Tier, 'unlicensed' );
	ASSERT.equal( LICENSE.Read( folder ), null );
	let lapsed = new Date( Date.now() - ( LICENSE.CACHE_DAYS + 1 ) * 24 * 3600 * 1000 ).toISOString();
	LICENSE.Write( folder, { Email: 'old@example.com', Clerk: 'user_old', Display: 'Old', Plan: 'personal', Until: null, Checked: lapsed } );
	let logged = [];
	let original = console.log;
	console.log = function ( line ) { logged.push( line ); };
	try
	{
		ASSERT.equal( user.Read(), null, 'lapsed: signed out' );
	}
	finally
	{
		console.log = original;
	}
	ASSERT.equal( LICENSE.Read( folder ), null, 'and the record is removed' );
	ASSERT.match( logged[ 0 ], /^signed out: old@example.com, not checked for/ );
} );
