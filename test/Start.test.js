'use strict';

// The one start module (plan Run Shapes, Step 1): the command line parsed, the server run from a config folder, the
// lines it prints; and bin/consensus.js, the headless entry point, spawned once. Step 4: a project folder on the
// command line, that project alone; the configured port in use.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const FS = require( 'fs' );
const OS = require( 'os' );
const PATH = require( 'path' );
const CHILD_PROCESS = require( 'child_process' );
const START = require( '../src/Start.js' );

let folders = [];


function temporary_folder()
{
	let folder = FS.mkdtempSync( PATH.join( OS.tmpdir(), 'consensus-start-' ) );
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


TEST( 'the arguments: a path or --project, --config (and --data, its older name), --port, --scope, --headless, --help; the rest refused with a reason', function ()
{
	ASSERT.deepEqual( START.Parse( [] ), { Headless: false, Help: false } );
	ASSERT.deepEqual( START.Parse( [ '--config', 'W:/x', '--port', '3501', '--scope', 'PUBLIC', '--headless' ] ), { Config: 'W:/x', Port: 3501, Scope: 'Public', Headless: true, Help: false } );
	ASSERT.deepEqual( START.Parse( [ '--data', '/data', '--scope', 'none' ] ), { Config: '/data', Scope: 'None', Headless: false, Help: false } );
	ASSERT.equal( START.Parse( [ '-h' ] ).Help, true );
	ASSERT.equal( START.Parse( [ '--help' ] ).Help, true );
	ASSERT.throws( function () { START.Parse( [ '--host', '0.0.0.0' ] ); }, /--host is gone: --scope local listens on this machine, --scope public on every interface/ );
	ASSERT.throws( function () { START.Parse( [ '--scope', 'everywhere' ] ); }, /--scope takes none, local or public/ );
	ASSERT.throws( function () { START.Parse( [ '--port', 'x' ] ); }, /--port takes a whole number/ );
	ASSERT.throws( function () { START.Parse( [ '--config' ] ); }, /--config needs a value/ );
	ASSERT.throws( function () { START.Parse( [ '--config', '--port', '1' ] ); }, /--config needs a value/ );
	ASSERT.deepEqual( START.Parse( [ '--project', 'W:/x' ] ), { Project: 'W:/x', Headless: false, Help: false } );
	ASSERT.deepEqual( START.Parse( [ 'W:/x', '--headless' ] ), { Project: 'W:/x', Headless: true, Help: false } );
	ASSERT.equal( START.Parse( [ '.' ] ).Project, '.' );
	ASSERT.throws( function () { START.Parse( [ 'W:/x', '--project', 'W:/y' ] ); }, /one project folder at a time: "W:\/x" and "W:\/y"/ );
	ASSERT.throws( function () { START.Parse( [ '--project' ] ); }, /--project needs a value/ );
	ASSERT.throws( function () { START.Parse( [ '--verbose' ] ); }, /unknown argument "--verbose"/ );
	ASSERT.match( START.USAGE, /^usage: consensus / );
} );


TEST( 'Run starts the server from the config folder and says where; Scope None says that no server started', async function ()
{
	let config = temporary_folder();
	let lines = [];
	let running = await START.Run( { Config: config, Port: 0 }, function ( line ) { lines.push( line ); } );
	ASSERT.equal( lines.length, 4 );
	ASSERT.equal( lines[ 0 ], 'Consensus at ' + running.Url + '/ (Scope Local, listening on 127.0.0.1)' );
	ASSERT.equal( lines[ 1 ], 'config folder ' + running.Store.Folder );
	ASSERT.equal( lines[ 2 ], 'settings written to ' + PATH.join( config, 'consensus.json' ) );
	ASSERT.equal( lines[ 3 ], 'project Default at ' + PATH.join( config, 'projects', 'Default' ) );
	ASSERT.equal( ( await fetch( running.Url + '/api/me' ) ).status, 200 );
	await running.Close();

	lines = [];
	let everywhere = await START.Run( { Config: config, Port: 0, Scope: 'Public' }, function ( line ) { lines.push( line ); } );
	ASSERT.match( lines[ 0 ], /Scope Public, listening on 0\.0\.0\.0/ );
	ASSERT.match( lines[ 1 ], /^warning: listening beyond this machine/ );
	ASSERT.equal( lines[ 3 ], 'settings from ' + PATH.join( config, 'consensus.json' ) );
	await everywhere.Close();

	lines = [];
	let none = await START.Run( { Config: config, Scope: 'None' }, function ( line ) { lines.push( line ); } );
	ASSERT.deepEqual( lines.slice( 0, 2 ), [ 'Scope None: no server started', 'config folder ' + running.Store.Folder ] );
	ASSERT.equal( none.Server, null );
	ASSERT.equal( none.Settings.Scope, 'Local' );
	await none.Close();
} );


TEST( 'a project folder on the command line: its .consensus made when missing, that project alone, first in the list, Scope None taken as Local; a folder that is not there refused', async function ()
{
	let config = temporary_folder();
	let first = await START.Run( { Config: config, Port: 0 } );
	await first.Close();
	let folder = PATH.join( temporary_folder(), 'tic-tac-toe' );
	FS.mkdirSync( folder );
	let lines = [];
	let running = await START.Run( { Config: config, Port: 0, Scope: 'None', Project: folder }, function ( line ) { lines.push( line ); } );
	ASSERT.ok( running.Server );
	ASSERT.equal( running.Scope, 'Local' );
	ASSERT.ok( lines.includes( 'Scope None taken as Local: a project on the command line needs this machine\'s server' ), lines.join( '\n' ) );
	ASSERT.ok( FS.existsSync( PATH.join( folder, '.consensus', 'project.json' ) ) );
	ASSERT.equal( running.Project.Name, 'tic-tac-toe' );
	ASSERT.equal( running.Project.Path, folder );
	ASSERT.equal( lines[ lines.length - 1 ], 'project tic-tac-toe at ' + folder + ' (this project only)' );
	let listed = await ( await fetch( running.Url + '/api/projects' ) ).json();
	ASSERT.deepEqual( listed.Projects.map( function ( project ) { return project.Name; } ), [ 'tic-tac-toe' ] );
	let settings = JSON.parse( FS.readFileSync( PATH.join( config, 'consensus.json' ), 'utf8' ) );
	ASSERT.deepEqual( settings.Projects.map( function ( entry ) { return entry.Path; } ), [ folder, PATH.join( config, 'projects', 'Default' ) ] );
	ASSERT.equal( settings.Scope, 'Local' );
	await running.Close();
	// Opened again: the project read, not made; a plain start lists both, the folder first.
	let again = await START.Run( { Config: config, Port: 0, Project: folder } );
	ASSERT.equal( again.Project.Name, 'tic-tac-toe' );
	ASSERT.equal( ( await again.Store.ListProjects() ).length, 1 );
	await again.Close();
	lines = [];
	let plain = await START.Run( { Config: config, Port: 0 }, function ( line ) { lines.push( line ); } );
	ASSERT.deepEqual( ( await plain.Store.ListProjects() ).map( function ( project ) { return project.Name; } ), [ 'tic-tac-toe', 'Default' ] );
	ASSERT.ok( lines.includes( 'project tic-tac-toe at ' + folder ) );
	ASSERT.ok( lines.includes( 'project Default at ' + PATH.join( config, 'projects', 'Default' ) ) );
	await plain.Close();
	await ASSERT.rejects( START.Run( { Config: config, Port: 0, Project: PATH.join( folder, 'nowhere' ) } ), /no such folder/ );
} );


TEST( 'the configured port in use: a second instance takes a free one and says so; a port asked for on the command line is not given up', async function ()
{
	let config = temporary_folder();
	let first = await START.Run( { Config: config, Port: 0 } );
	let port = first.Address.Port;
	first.Settings.Port = port;
	await first.Store.WriteSettings( first.Settings );
	let lines = [];
	let second = await START.Run( { Config: config }, function ( line ) { lines.push( line ); } );
	ASSERT.equal( second.PortTaken, port );
	ASSERT.notEqual( second.Address.Port, port );
	ASSERT.equal( lines[ 1 ], 'port ' + port + ' is in use: listening on ' + second.Address.Port + ' instead' );
	ASSERT.equal( ( await fetch( second.Url + '/api/me' ) ).status, 200 );
	await second.Close();
	await ASSERT.rejects( START.Run( { Config: config, Port: port } ), /EADDRINUSE/ );
	await first.Close();
} );


TEST( 'bin/consensus.js: --help prints the usage; an unknown argument fails; Scope None has nothing to run', function ()
{
	let bin = PATH.join( __dirname, '..', 'bin', 'consensus.js' );
	let help = CHILD_PROCESS.spawnSync( process.execPath, [ bin, '--help' ], { encoding: 'utf8' } );
	ASSERT.equal( help.status, 0 );
	ASSERT.equal( help.stdout.trim(), START.USAGE );
	let unknown = CHILD_PROCESS.spawnSync( process.execPath, [ bin, '--host', '0.0.0.0' ], { encoding: 'utf8' } );
	ASSERT.equal( unknown.status, 1 );
	ASSERT.match( unknown.stderr, /--host is gone/ );
	let none = CHILD_PROCESS.spawnSync( process.execPath, [ bin, '--config', temporary_folder(), '--scope', 'none', '--headless' ], { encoding: 'utf8' } );
	ASSERT.equal( none.status, 1 );
	ASSERT.match( none.stdout, /Scope None: no server started/ );
	ASSERT.match( none.stdout, /nothing to run without a window/ );
} );
