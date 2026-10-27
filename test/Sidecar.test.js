'use strict';

// Sidecar (plan Sidecar Edition, Step 1), without Electron: the server the app starts over a project folder, with the
// settings given (no consensus.json read), its port hashed into Sidecar's range, 52000 to 52999, and no address file.
// Desktop's range and its address file are unchanged (test/Start.test.js).

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const FS = require( 'fs' );
const OS = require( 'os' );
const PATH = require( 'path' );
const SERVER = require( '../src/Server.js' );
const SIDECAR = require( '../src/Sidecar.js' );

let folders = [];


function temporary_folder( prefix )
{
	let folder = FS.mkdtempSync( PATH.join( OS.tmpdir(), prefix || 'sidecar-' ) );
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


// The server as sidecar/main.js starts it.
function start( Folder, Extra )
{
	return SERVER.Start( Object.assign( {
		Project: Folder,
		Config: PATH.join( Folder, '.consensus' ),
		ReadOnly: true,
		Settings: { Name: 'Consensus Sidecar', States: [ 'Draft', 'Plan', 'Working', 'Finished' ], Owner: { Name: 'andre@cube1', Display: 'andre@cube1' } },
		Ports: SIDECAR.SIDECAR_APP_RANGE,
		AddressFile: false,
	}, Extra || {} ) );
}


TEST( 'a range of its own: the folder\'s port hashed into 52000 to 52999, every port of it tried once; the default range unchanged', function ()
{
	let folder = temporary_folder();
	let range = SIDECAR.SIDECAR_APP_RANGE;
	ASSERT.deepEqual( range, { Start: 52000, Count: 1000 } );
	let port = SIDECAR.Port( folder, range );
	ASSERT.ok( port >= 52000 && port <= 52999, String( port ) );
	let ports = SIDECAR.Ports( folder, range );
	ASSERT.equal( ports.length, 1000 );
	ASSERT.equal( ports[ 0 ], port );
	ASSERT.equal( new Set( ports ).size, 1000 );
	ASSERT.ok( ports.every( function ( one ) { return one >= 52000 && one <= 52999; } ) );
	let desktop = SIDECAR.Port( folder );
	ASSERT.ok( desktop >= SIDECAR.RANGE_START && desktop < SIDECAR.RANGE_START + SIDECAR.RANGE_COUNT, String( desktop ) );
	ASSERT.equal( SIDECAR.Ports( folder ).length, SIDECAR.RANGE_COUNT );
} );


TEST( 'the server over a folder: the settings given, the port in Sidecar\'s range, no address file, nothing of a config folder read or written', async function ()
{
	let folder = PATH.join( temporary_folder(), 'tic-tac-toe' );
	FS.mkdirSync( folder );
	let running = await start( folder );
	try
	{
		ASSERT.ok( running.Server );
		ASSERT.equal( running.Project.Name, 'tic-tac-toe' );
		let port = running.Address.Port;
		ASSERT.ok( port >= 52000 && port <= 52999, String( port ) );
		ASSERT.equal( running.Sidecar, null );
		ASSERT.equal( FS.existsSync( SIDECAR.FilePath( folder ) ), false );
		// the project's .consensus is made; no settings, users or runs are written there
		ASSERT.ok( FS.existsSync( PATH.join( folder, '.consensus', 'project.json' ) ) );
		ASSERT.equal( FS.existsSync( PATH.join( folder, '.consensus', 'consensus.json' ) ), false );
		ASSERT.equal( FS.existsSync( PATH.join( folder, '.consensus', 'runs' ) ), false );
		// the user is the owner, under the name given; no connections or tasks
		let me = await ( await fetch( running.Url + '/api/me' ) ).json();
		ASSERT.equal( me.Me.Name, 'andre@cube1' );
		ASSERT.equal( me.Me.Role, 'owner' );
		ASSERT.deepEqual( running.Settings.Llms, [] );
		ASSERT.deepEqual( running.Settings.Tasks, [] );
		// what the LLM posts reads "<service> by <user>"
		let projects = await ( await fetch( running.Url + '/api/projects' ) ).json();
		let made = await ( await fetch( running.Url + '/api/plans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify( { Title: 'A plan', Text: '# A plan\n\nSome text.\n', Project: projects.Projects[ 0 ].Id } ) } ) ).json();
		let posted = await fetch( running.Url + '/api/plans/' + made.Plan.Id + '/threads', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Consensus-Service': 'Claude-CLI' }, body: JSON.stringify( { Text: 'A question.' } ) } );
		ASSERT.equal( posted.status, 201 );
		let read = await ( await fetch( running.Url + '/api/plans/' + made.Plan.Id ) ).json();
		ASSERT.equal( read.Threads[ 0 ].Replies[ 0 ].By, 'andre@cube1' );
		ASSERT.equal( read.Threads[ 0 ].Replies[ 0 ].Service, 'Claude-CLI' );
	}
	finally
	{
		await running.Close();
	}
} );


TEST( 'a consensus.json in the folder is not read: the settings given are the settings', async function ()
{
	let folder = temporary_folder();
	FS.mkdirSync( PATH.join( folder, '.consensus' ) );
	FS.writeFileSync( PATH.join( folder, '.consensus', 'consensus.json' ), JSON.stringify( { Owner: { Name: 'someone', Display: 'Someone' }, States: [ 'Only' ] } ) );
	let running = await start( folder );
	try
	{
		let me = await ( await fetch( running.Url + '/api/me' ) ).json();
		ASSERT.equal( me.Me.Name, 'andre@cube1' );
		ASSERT.deepEqual( running.Settings.States, [ 'Draft', 'Plan', 'Working', 'Finished' ] );
	}
	finally
	{
		await running.Close();
	}
} );


TEST( 'a taken port steps up to the next one in the range', async function ()
{
	let folder = temporary_folder();
	let first = await start( folder );
	let second = null;
	try
	{
		second = await start( folder );
		let expected = ( first.Address.Port === 52999 ) ? 52000 : first.Address.Port + 1;
		ASSERT.equal( second.Address.Port, expected );
		ASSERT.equal( second.PortTaken, first.Address.Port );
	}
	finally
	{
		if ( second )
		{
			await second.Close();
		}
		await first.Close();
	}
} );


//---------------------------------------------------------------------
// sidecar.json (plan Sidecar Edition, Step 2)

const SETTINGS = require( '../sidecar/Settings.js' );


TEST( 'sidecar.json: in the project\'s .consensus; missing, the defaults with the user <os user>@<machine>; nothing written by a read', function ()
{
	let folder = temporary_folder();
	ASSERT.equal( SETTINGS.Path( folder ), PATH.join( folder, '.consensus', 'sidecar.json' ) );
	let expected_user = ( OS.userInfo().username + '@' + OS.hostname() ).toLowerCase();
	ASSERT.equal( SETTINGS.DefaultUser(), expected_user );
	let loaded = SETTINGS.Load( folder );
	ASSERT.deepEqual( loaded.Settings, { User: expected_user, Theme: 'system', Scale: 'normal', Remembered: {} } );
	ASSERT.equal( loaded.Path, SETTINGS.Path( folder ) );
	ASSERT.equal( FS.existsSync( SETTINGS.Path( folder ) ), false );
} );


TEST( 'sidecar.json: written whole and read back; whatever name the user types, trimmed; fields that are not usable are the defaults', function ()
{
	let folder = temporary_folder();
	let path = SETTINGS.Write( folder, { User: '  Andre Bowlin ', Theme: 'nord', Scale: 'large', Remembered: { 'consensus.open': 'pln-1' }, Other: 1 } );
	ASSERT.equal( path, SETTINGS.Path( folder ) );
	let written = JSON.parse( FS.readFileSync( path, 'utf8' ) );
	ASSERT.deepEqual( written, { User: 'Andre Bowlin', Theme: 'nord', Scale: 'large', Remembered: { 'consensus.open': 'pln-1' } } );
	ASSERT.deepEqual( SETTINGS.Load( folder ).Settings, written );
	ASSERT.equal( FS.readdirSync( PATH.dirname( path ) ).filter( function ( name ) { return name.endsWith( '.tmp' ); } ).length, 0 );
	let filled = SETTINGS.Fill( { User: '', Theme: 'purple', Scale: 'huge', Remembered: [ 1 ] } );
	ASSERT.deepEqual( filled, SETTINGS.Default() );
	ASSERT.equal( SETTINGS.CleanUser( 'x'.repeat( SETTINGS.USER_LIMIT ) ), 'x'.repeat( SETTINGS.USER_LIMIT ) );
	ASSERT.equal( SETTINGS.CleanUser( 'x'.repeat( SETTINGS.USER_LIMIT + 1 ) ), null );
	ASSERT.equal( SETTINGS.CleanUser( 'a\nb' ), null );
	ASSERT.equal( SETTINGS.CleanUser( 42 ), null );
} );


TEST( 'sidecar.json: a file that cannot be read is the defaults, left as it is', function ()
{
	let folder = temporary_folder();
	FS.mkdirSync( PATH.join( folder, '.consensus' ) );
	FS.writeFileSync( SETTINGS.Path( folder ), '{ not json' );
	let loaded = SETTINGS.Load( folder );
	ASSERT.deepEqual( loaded.Settings, SETTINGS.Default() );
	ASSERT.match( loaded.Lines[ 0 ], /could not be read/ );
	ASSERT.equal( FS.readFileSync( SETTINGS.Path( folder ), 'utf8' ), '{ not json' );
} );


TEST( 'the user renamed in place: the server\'s owner follows at the next request, and what the LLM posts carries the new name', async function ()
{
	let folder = temporary_folder();
	let running = await start( folder );
	try
	{
		running.Settings.Owner = { Name: 'Andre', Display: 'Andre' };
		running.Users.Prepare( running.Settings );
		let me = await ( await fetch( running.Url + '/api/me' ) ).json();
		ASSERT.equal( me.Me.Name, 'Andre' );
		let projects = await ( await fetch( running.Url + '/api/projects' ) ).json();
		let made = await ( await fetch( running.Url + '/api/plans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify( { Title: 'A plan', Text: '# A plan\n\nSome text.\n', Project: projects.Projects[ 0 ].Id } ) } ) ).json();
		await fetch( running.Url + '/api/plans/' + made.Plan.Id + '/threads', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Consensus-Service': 'Claude-CLI' }, body: JSON.stringify( { Text: 'A question.' } ) } );
		let read = await ( await fetch( running.Url + '/api/plans/' + made.Plan.Id ) ).json();
		ASSERT.equal( read.Threads[ 0 ].Replies[ 0 ].By, 'Andre' );
		ASSERT.equal( FS.existsSync( PATH.join( folder, '.consensus', 'users.json' ) ), false );
	}
	finally
	{
		await running.Close();
	}
} );


//---------------------------------------------------------------------
// The instructions (plan Sidecar Edition, Step 3): Sidecar's own guide, on the page and through MCP

const INSTRUCTIONS = require( '../src/Instructions.js' );


TEST( 'the instructions: Sidecar\'s guide on /instructions and the MCP instructions tool, with no Server, token or address file in it; Desktop\'s guide unchanged', async function ()
{
	let folder = temporary_folder();
	let running = await start( folder, { Guide: INSTRUCTIONS.SIDECAR_GUIDE_PATH } );
	try
	{
		let page = await ( await fetch( running.Url + '/instructions' ) ).text();
		ASSERT.match( page, /^# This server/ );
		ASSERT.match( page, /# Build with Consensus Sidecar/ );
		ASSERT.match( page, /a request with none is the owner, andre@cube1,/ );
		ASSERT.doesNotMatch( page, /~sidecar\.json|Bearer|CONSENSUS_TOKEN|consensus mcp <folder>/ );
		let called = await fetch( running.Url + '/api/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Consensus-Service': 'Claude-CLI' }, body: JSON.stringify( { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'instructions', arguments: {} } } ) } );
		let answer = await called.json();
		let text = answer.result.content.map( function ( part ) { return part.text || ''; } ).join( '' );
		ASSERT.match( text, /# Build with Consensus Sidecar/ );
	}
	finally
	{
		await running.Close();
	}
	let other = temporary_folder();
	let desktop = await start( other );
	try
	{
		let page = await ( await fetch( desktop.Url + '/instructions' ) ).text();
		ASSERT.match( page, /# Build with Consensus\n/ );
	}
	finally
	{
		await desktop.Close();
	}
} );
