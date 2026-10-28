'use strict';

// The Client (plan Client Edition): its settings, client.json in the config folder (Step 1).

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const FS = require( 'fs' );
const OS = require( 'os' );
const PATH = require( 'path' );
const SETTINGS = require( '../client/Settings.js' );


function temporary_folder()
{
	return FS.mkdtempSync( PATH.join( OS.tmpdir(), 'consensus-client-test-' ) );
}


//---------------------------------------------------------------------
// client.json (Step 1)

TEST( 'client.json: in the config folder; missing, the defaults with no Servers; nothing written by a read', function ()
{
	let config = temporary_folder();
	ASSERT.equal( SETTINGS.Path( config ), PATH.join( config, 'client.json' ) );
	let loaded = SETTINGS.Load( config );
	ASSERT.deepEqual( loaded.Settings, { Servers: [], Theme: 'system', Scale: 'normal', Remembered: {} } );
	ASSERT.equal( loaded.Path, SETTINGS.Path( config ) );
	ASSERT.equal( FS.existsSync( SETTINGS.Path( config ) ), false );
} );


TEST( 'client.json: nothing is carried over from desktop.json\'s saved Servers', function ()
{
	let config = temporary_folder();
	FS.writeFileSync( PATH.join( config, 'desktop.json' ), JSON.stringify( { Hosts: [ { Name: 'Team', Url: 'http://team:3500', Project: null } ], Theme: 'nord' } ) );
	ASSERT.deepEqual( SETTINGS.Load( config ).Settings, SETTINGS.Default() );
} );


TEST( 'client.json: written whole and read back; Servers kept by name and address, trimmed; what is not usable is left out', function ()
{
	let config = temporary_folder();
	let path = SETTINGS.Write( config, {
		Servers: [
			{ Name: ' Team ', Url: 'https://consensus.example.com/ ' },
			{ Name: 'team', Url: 'http://other:3500' },
			{ Name: 'Home', Url: 'http://127.0.0.1:3500' },
			{ Name: 'No address', Url: 'ftp://nowhere' },
			{ Name: 'a/b', Url: 'http://slashed:3500' },
			{ Url: 'http://nameless:3500' },
			'Team',
		],
		Theme: 'nord',
		Scale: 'large',
		Remembered: { 'consensus.open': 'pln-1', 'page-port': 51234 },
		Other: 1,
	} );
	ASSERT.equal( path, SETTINGS.Path( config ) );
	let written = JSON.parse( FS.readFileSync( path, 'utf8' ) );
	ASSERT.deepEqual( written, {
		Servers: [ { Name: 'Team', Url: 'https://consensus.example.com' }, { Name: 'Home', Url: 'http://127.0.0.1:3500' } ],
		Theme: 'nord',
		Scale: 'large',
		Remembered: { 'consensus.open': 'pln-1', 'page-port': 51234 },
	} );
	ASSERT.deepEqual( SETTINGS.Load( config ).Settings, written );
	ASSERT.equal( FS.readdirSync( config ).filter( function ( name ) { return name.endsWith( '.tmp' ); } ).length, 0 );
	ASSERT.deepEqual( SETTINGS.Fill( { Servers: 'x', Theme: 'purple', Scale: 'huge', Remembered: [ 1 ] } ), SETTINGS.Default() );
	ASSERT.equal( SETTINGS.CleanName( 'x'.repeat( SETTINGS.NAME_LIMIT ) ), 'x'.repeat( SETTINGS.NAME_LIMIT ) );
	ASSERT.equal( SETTINGS.CleanName( 'x'.repeat( SETTINGS.NAME_LIMIT + 1 ) ), null );
	ASSERT.equal( SETTINGS.CleanName( 'a\nb' ), null );
	ASSERT.equal( SETTINGS.CleanUrl( 'http://host:3500/base//' ), 'http://host:3500/base' );
	ASSERT.equal( SETTINGS.CleanUrl( 'host:3500' ), null );
	ASSERT.equal( SETTINGS.CleanUrl( 'http://a b' ), null );
} );


TEST( 'client.json: a file that cannot be read is the defaults, left as it is', function ()
{
	let config = temporary_folder();
	FS.writeFileSync( SETTINGS.Path( config ), '{ not json' );
	let loaded = SETTINGS.Load( config );
	ASSERT.deepEqual( loaded.Settings, SETTINGS.Default() );
	ASSERT.match( loaded.Lines[ 0 ], /could not be read/ );
	ASSERT.equal( FS.readFileSync( SETTINGS.Path( config ), 'utf8' ), '{ not json' );
} );


TEST( 'client.json: a remembered value set, changed and removed, each saying whether it changed', function ()
{
	let settings = SETTINGS.Default();
	ASSERT.equal( SETTINGS.Remember( settings, 'consensus.open', 'pln-1' ), true );
	ASSERT.equal( SETTINGS.Remember( settings, 'consensus.open', 'pln-1' ), false );
	ASSERT.equal( SETTINGS.Remember( settings, 'folds', { a: true } ), true );
	ASSERT.equal( SETTINGS.Remember( settings, 'folds', { a: true } ), false );
	ASSERT.equal( SETTINGS.Remember( settings, 'consensus.open', null ), true );
	ASSERT.equal( SETTINGS.Remember( settings, 'consensus.open', undefined ), false );
	ASSERT.equal( SETTINGS.Remember( settings, '', 1 ), false );
	ASSERT.deepEqual( settings.Remembered, { folds: { a: true } } );
} );


TEST( 'the Client app: its own folder and npm script, no folder, no server, no license and no user of its own', function ()
{
	let root = PATH.join( __dirname, '..' );
	let scripts = JSON.parse( FS.readFileSync( PATH.join( root, 'package.json' ), 'utf8' ) ).scripts;
	ASSERT.equal( scripts.client, 'electron client' );
	let own = JSON.parse( FS.readFileSync( PATH.join( root, 'client', 'package.json' ), 'utf8' ) );
	ASSERT.equal( own.main, 'main.js' );
	ASSERT.equal( own.version, JSON.parse( FS.readFileSync( PATH.join( root, 'package.json' ), 'utf8' ) ).version );
	let main = FS.readFileSync( PATH.join( root, 'client', 'main.js' ), 'utf8' );
	for ( let module of [ 'Sidecar.js', 'License.js', 'Instructions.js', 'Start.js', 'Mcp.js' ] )
	{
		ASSERT.equal( main.indexOf( module ), -1, 'the Client\'s main requires no ' + module );
	}
	ASSERT.equal( main.indexOf( 'SERVER.Start' ), -1, 'the Client starts no server' );
	let preload = FS.readFileSync( PATH.join( root, 'client', 'preload.js' ), 'utf8' );
	for ( let name of [ 'SetLicense', 'ClearLicense', 'SetUser', 'PickFolder', 'OpenFolderWindow' ] )
	{
		ASSERT.equal( preload.indexOf( name + ':' ), -1, 'the Client\'s bridge has no ' + name );
	}
	ASSERT.match( preload, /Client: true/ );
} );


//---------------------------------------------------------------------
// The Servers (Step 2): added by address under the Server's own name, renamed, removed

TEST( 'the Servers: added under the Server\'s name, a name taken numbered on, an address twice refused, renamed, removed', function ()
{
	let settings = SETTINGS.Default();
	ASSERT.deepEqual( SETTINGS.AddServer( settings, { Url: 'https://team.example.com/', Name: 'Team' } ), { Server: { Name: 'Team', Url: 'https://team.example.com' } } );
	ASSERT.deepEqual( SETTINGS.AddServer( settings, { Url: 'http://other:3500', Name: 'team' } ).Server, { Name: 'team 2', Url: 'http://other:3500' } );
	ASSERT.equal( SETTINGS.AddServer( settings, { Url: 'http://nameless:3500' } ).Server.Name, 'nameless:3500' );
	ASSERT.match( SETTINGS.AddServer( settings, { Url: 'HTTPS://team.example.com' } ).Error, /in the list already, as Team/ );
	ASSERT.match( SETTINGS.AddServer( settings, { Url: 'team.example.com' } ).Error, /http:\/\/ or https:\/\// );
	ASSERT.equal( settings.Servers.length, 3 );
	ASSERT.equal( SETTINGS.UniqueName( settings, 'x'.repeat( SETTINGS.NAME_LIMIT ) ), 'x'.repeat( SETTINGS.NAME_LIMIT ) );
	settings.Servers.push( { Name: 'x'.repeat( SETTINGS.NAME_LIMIT ), Url: 'http://long:1' } );
	ASSERT.equal( SETTINGS.UniqueName( settings, 'x'.repeat( SETTINGS.NAME_LIMIT ) ), 'x'.repeat( SETTINGS.NAME_LIMIT - 2 ) + ' 2' );
	ASSERT.deepEqual( SETTINGS.RenameServer( settings, 'team 2', ' Other ' ).Server, { Name: 'Other', Url: 'http://other:3500' } );
	ASSERT.match( SETTINGS.RenameServer( settings, 'Other', 'TEAM' ).Error, /another Server is named "Team"/ );
	ASSERT.match( SETTINGS.RenameServer( settings, 'Other', 'a/b' ).Error, /no slash/ );
	ASSERT.match( SETTINGS.RenameServer( settings, 'Nobody', 'x' ).Error, /no Server named/ );
	ASSERT.equal( SETTINGS.RenameServer( settings, 'Team', 'team' ).Server.Name, 'team' );
	ASSERT.deepEqual( SETTINGS.RemoveServer( settings, 'OTHER' ).Server, { Name: 'Other', Url: 'http://other:3500' } );
	ASSERT.match( SETTINGS.RemoveServer( settings, 'Other' ).Error, /no Server named/ );
	ASSERT.deepEqual( settings.Servers.map( function ( one ) { return one.Name; } ), [ 'team', 'nameless:3500', 'x'.repeat( SETTINGS.NAME_LIMIT ) ] );
} );


TEST( 'the Client\'s page: one sign-in for every Server, its configuration handed in, and a Server\'s refusal its own', function ()
{
	let root = PATH.join( __dirname, '..' );
	let session = FS.readFileSync( PATH.join( root, 'public', 'js', 'session.js' ), 'utf8' );
	ASSERT.match( session, /config = window\.ConsensusDesktop\.Clerk/ );
	ASSERT.match( session, /Every: CLIENT/ );
	let client = FS.readFileSync( PATH.join( root, 'public', 'js', 'client.js' ), 'utf8' );
	ASSERT.match( client, /Session\.Every === true \|\|/ );
	let main = FS.readFileSync( PATH.join( root, 'client', 'main.js' ), 'utf8' );
	ASSERT.equal( main.indexOf( 'SecretKey' ), -1, 'no secret goes to the page' );
	let CLERK = require( '../src/Clerk.js' );
	let clerk = CLERK.Clerk( { Settings: {} } );
	ASSERT.match( clerk.PublishableKey(), /^pk_/ );
	ASSERT.ok( clerk.FrontendApi() );
} );
