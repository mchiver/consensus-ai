'use strict';

// The one start module (plan Run Shapes, Step 1): the command line parsed, the server run from a config folder, the
// lines it prints; and bin/consensus.js, the headless entry point, spawned once. Step 4: a project folder on the
// command line, that project alone; the configured port in use. Plan Rearchitecturation, Step 1: the word serve.
// Step 3: the sidecar: the port from the hash, the step on a taken port, the second open activating the first and
// exiting, a stale address file overwritten.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const FS = require( 'fs' );
const OS = require( 'os' );
const PATH = require( 'path' );
const CHILD_PROCESS = require( 'child_process' );
const NET = require( 'net' );
const START = require( '../src/Start.js' );
const SIDECAR = require( '../src/Sidecar.js' );
const LICENSE = require( '../src/License.js' );

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


TEST( 'the arguments: serve, a path or --project, --config (and --data, its older name), --port, --scope, --headless, --help; the rest refused with a reason', function ()
{
	ASSERT.deepEqual( START.Parse( [] ), { Headless: false, Help: false } );
	// serve (plan Rearchitecturation, Step 1) is the Host's word: the same as no path at all, and no folder with it
	ASSERT.deepEqual( START.Parse( [ 'serve' ] ), START.Parse( [] ) );
	ASSERT.deepEqual( START.Parse( [ 'serve', '--config', '/data', '--scope', 'public', '--port', '3500', '--headless' ] ), START.Parse( [ '--config', '/data', '--scope', 'public', '--port', '3500', '--headless' ] ) );
	ASSERT.throws( function () { START.Parse( [ 'serve', 'W:/x' ] ); }, /serve takes no project folder/ );
	ASSERT.throws( function () { START.Parse( [ 'W:/x', 'serve' ] ); }, /serve takes no project folder/ );
	ASSERT.match( START.USAGE, /[serve | <path> | --project <folder>]/ );
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
	ASSERT.equal( lines.length, 7 );
	ASSERT.equal( lines[ 0 ], 'Consensus at ' + running.Url + '/ (Scope Local, listening on 127.0.0.1)' );
	// the Server's gate (plan The Server, Step 3): closed until a licensed sign-in stands behind it
	ASSERT.equal( lines[ 1 ], 'closed: the Server waits for its first sign-in: a Personal or Professional license makes the Administrator; the page at ' + running.Url + '/ signs in' );
	ASSERT.equal( lines[ 2 ], 'config folder ' + running.Store.Folder );
	ASSERT.equal( lines[ 3 ], 'settings written to ' + PATH.join( config, 'consensus.json' ) );
	// a registered project starts unmounted and the Host says how many are (plan Rearchitecturation, Step 5), and where its address file is
	ASSERT.equal( lines[ 4 ], 'project Default at ' + PATH.join( config, 'projects', 'Default' ) + ' (unmounted)' );
	ASSERT.equal( lines[ 5 ], '1 project is unmounted: accounts see mounted projects alone; the Administrator mounts a project in its menu on the Server\'s page' );
	ASSERT.equal( lines[ 6 ], 'Server address in ' + PATH.join( config, '~host.json' ) );
	ASSERT.deepEqual( Object.keys( JSON.parse( FS.readFileSync( PATH.join( config, '~host.json' ), 'utf8' ) ) ).sort(), [ 'Pid', 'Port', 'Started', 'Url' ] );
	let closed = await fetch( running.Url + '/api/me' );
	ASSERT.deepEqual( [ closed.status, ( await closed.json() ).Closed ], [ 401, true ] );
	// a Personal current user on the machine opens it, recorded as the Administrator
	LICENSE.Write( config, { Email: 'ann@example.com', Clerk: 'user_ann', Display: 'Ann', Plan: 'personal', Until: null, Checked: new Date().toISOString() } );
	ASSERT.equal( ( await running.Gate.Check() ).Open, true );
	// open, and as any Server it tells people apart (plan The Server, Step 5): a bare request is asked to sign in
	let bare = await ( await fetch( running.Url + '/api/me' ) ).json();
	ASSERT.deepEqual( [ bare.Error, bare.Closed ], [ 'sign in', undefined ] );
	await running.Close();
	ASSERT.equal( FS.existsSync( PATH.join( config, '~host.json' ) ), false, 'the Host\'s address file goes at Close' );

	lines = [];
	let everywhere = await START.Run( { Config: config, Port: 0, Scope: 'Public' }, function ( line ) { lines.push( line ); } );
	ASSERT.match( lines[ 0 ], /Scope Public, listening on 0\.0\.0\.0/ );
	ASSERT.match( lines[ 1 ], /^warning: listening beyond this machine/ );
	ASSERT.equal( lines[ 2 ].startsWith( 'closed: a Public Server needs the Administrator' ), true, 'Personal does not open a Public Server' );
	ASSERT.equal( lines[ 4 ], 'settings from ' + PATH.join( config, 'consensus.json' ) );
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
	// Scope None (plan Rearchitecturation, Step 3): the server listens for the window, the sidecar is off: no address file
	ASSERT.ok( lines.includes( 'Scope None: the server listens on this machine for the window alone; the sidecar is off, no address file written' ), lines.join( '\n' ) );
	ASSERT.equal( running.SidecarOff, true );
	ASSERT.equal( running.Sidecar, null );
	ASSERT.equal( FS.existsSync( SIDECAR.FilePath( folder ) ), false );
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
	ASSERT.ok( lines.includes( 'project tic-tac-toe at ' + folder + ' (unmounted)' ) );
	ASSERT.ok( lines.includes( 'project Default at ' + PATH.join( config, 'projects', 'Default' ) + ' (unmounted)' ) );
	ASSERT.ok( lines.includes( '2 projects are unmounted: accounts see mounted projects alone; the Administrator mounts a project in its menu on the Server\'s page' ), lines.join( '\n' ) );
	await plain.Close();
	await ASSERT.rejects( START.Run( { Config: config, Port: 0, Project: PATH.join( folder, 'nowhere' ) } ), /no such folder/ );
} );


TEST( 'the configured port in use: a second instance takes a free one and says so; a port asked for on the command line is not given up', async function ()
{
	let config = temporary_folder();
	LICENSE.Write( config, { Email: 'ann@example.com', Clerk: 'user_ann', Display: 'Ann', Plan: 'personal', Until: null, Checked: new Date().toISOString() } );
	let first = await START.Run( { Config: config, Port: 0 } );
	let port = first.Address.Port;
	first.Settings.Port = port;
	await first.Store.WriteSettings( first.Settings );
	let lines = [];
	let second = await START.Run( { Config: config }, function ( line ) { lines.push( line ); } );
	ASSERT.equal( second.PortTaken, port );
	ASSERT.notEqual( second.Address.Port, port );
	ASSERT.equal( lines[ 1 ], 'port ' + port + ' is in use: listening on ' + second.Address.Port + ' instead' );
	ASSERT.equal( ( await fetch( second.Url + '/api/me' ) ).status, 401, 'it answers, asking for a sign-in' );
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


//---------------------------------------------------------------------
// The sidecar (plan Rearchitecturation, Step 3)

TEST( 'the sidecar\'s port: hashed from the folder into 3600 to 3699, the same for the folder however it is spelled, stepped up by one while taken and wrapping at the end', function ()
{
	let folder = PATH.join( temporary_folder(), 'tic-tac-toe' );
	let port = SIDECAR.Port( folder );
	ASSERT.ok( port >= SIDECAR.RANGE_START && port < SIDECAR.RANGE_START + SIDECAR.RANGE_COUNT, String( port ) );
	ASSERT.equal( SIDECAR.Port( folder + PATH.sep ), port );
	ASSERT.equal( SIDECAR.Port( folder.replace( /\\/g, '/' ) ), port );
	if ( process.platform === 'win32' )
	{
		ASSERT.equal( SIDECAR.Port( folder.toUpperCase() ), port );
	}
	ASSERT.notEqual( SIDECAR.Port( folder + '-2' ), port, 'two folders, two ports (almost always)' );
	let ports = SIDECAR.Ports( folder );
	ASSERT.equal( ports.length, SIDECAR.RANGE_COUNT );
	ASSERT.equal( ports[ 0 ], port );
	ASSERT.equal( ports[ 1 ], ( port === SIDECAR.RANGE_START + SIDECAR.RANGE_COUNT - 1 ) ? SIDECAR.RANGE_START : port + 1 );
	ASSERT.equal( new Set( ports ).size, SIDECAR.RANGE_COUNT );
	ASSERT.equal( SIDECAR.FilePath( folder ), PATH.join( folder, '.consensus', '~sidecar.json' ) );
	ASSERT.equal( SIDECAR.Alive( process.pid ), true );
	ASSERT.equal( SIDECAR.Alive( 0 ), false );
} );


TEST( 'a project\'s server is the sidecar: it listens on the folder\'s port, the next one when that is taken, and writes the address file, removed at Close; Scope Public is taken as Local', async function ()
{
	let config = temporary_folder();
	let folder = PATH.join( temporary_folder(), 'sidecar' );
	FS.mkdirSync( folder );
	let port = SIDECAR.Port( folder );
	// the folder's port held by something else: the sidecar steps up
	let holder = NET.createServer();
	await new Promise( function ( resolve, reject ) { holder.once( 'error', reject ); holder.listen( port, '127.0.0.1', resolve ); } );
	let lines = [];
	let running = null;
	try
	{
		running = await START.Run( { Config: config, Scope: 'Public', Project: folder }, function ( line ) { lines.push( line ); } );
	}
	finally
	{
		await new Promise( function ( resolve ) { holder.close( resolve ); } );
	}
	try
	{
		ASSERT.equal( running.PortTaken, port );
		ASSERT.notEqual( running.Address.Port, port );
		ASSERT.ok( running.Address.Port >= SIDECAR.RANGE_START && running.Address.Port < SIDECAR.RANGE_START + SIDECAR.RANGE_COUNT );
		ASSERT.equal( running.Address.Host, '127.0.0.1' );
		ASSERT.equal( running.Scope, 'Local' );
		ASSERT.ok( lines.includes( 'port ' + port + ' is in use: listening on ' + running.Address.Port + ' instead' ), lines.join( '\n' ) );
		ASSERT.ok( lines.includes( 'Scope Public taken as Local: the sidecar never listens beyond this machine' ), lines.join( '\n' ) );
		ASSERT.ok( lines.includes( 'sidecar address in ' + SIDECAR.FilePath( folder ) ), lines.join( '\n' ) );
		let record = JSON.parse( FS.readFileSync( SIDECAR.FilePath( folder ), 'utf8' ) );
		ASSERT.deepEqual( Object.keys( record ).sort(), [ 'Pid', 'Port', 'Project', 'Started', 'Url' ] );
		ASSERT.equal( record.Url, running.Url );
		ASSERT.equal( record.Port, running.Address.Port );
		ASSERT.equal( record.Pid, process.pid );
		ASSERT.deepEqual( record.Project, { Id: running.Project.Id, Name: 'sidecar' } );
		ASSERT.deepEqual( SIDECAR.Running( folder ), record );
		// the instructions name the one project
		let instructions = await ( await fetch( running.Url + '/instructions' ) ).text();
		ASSERT.match( instructions, new RegExp( '- This is a sidecar over one project: sidecar \\(' + running.Project.Id + '\\) at ' ) );
	}
	finally
	{
		await running.Close();
	}
	ASSERT.equal( FS.existsSync( SIDECAR.FilePath( folder ) ), false, 'the address file goes at Close' );
	// the folder's own port free again: taken, with no port line
	lines = [];
	let again = await START.Run( { Config: config, Project: folder }, function ( line ) { lines.push( line ); } );
	try
	{
		ASSERT.equal( again.Address.Port, port );
		ASSERT.equal( again.PortTaken, null );
		ASSERT.equal( lines[ 0 ], 'Consensus at http://127.0.0.1:' + port + '/ (Scope Local, listening on 127.0.0.1)' );
	}
	finally
	{
		await again.Close();
	}
} );


TEST( 'a folder open in a running sidecar: the second open asks it to bring its window to the front and answers Open in place of a server; a stale address file (its process gone) is overwritten; bin/consensus.js prints the address and exits', async function ()
{
	let config = temporary_folder();
	let folder = PATH.join( temporary_folder(), 'open-twice' );
	FS.mkdirSync( folder );
	// a stale file: a process that is not there
	let dead = 4000000;
	while ( SIDECAR.Alive( dead ) )
	{
		dead++;
	}
	SIDECAR.Write( folder, { Url: 'http://127.0.0.1:1', Port: 1, Pid: dead, Started: '2026-01-01T00:00:00.000Z', Project: { Id: 'prj-old', Name: 'old' } } );
	ASSERT.equal( SIDECAR.Running( folder ), null );
	let activated = 0;
	let first = await START.Run( { Config: config, Port: 0, Project: folder, Activate: function () { activated++; } } );
	try
	{
		let record = SIDECAR.Read( folder );
		ASSERT.equal( record.Pid, process.pid, 'the stale file is overwritten' );
		ASSERT.equal( record.Url, first.Url );
		// the second open: no server, the first's window asked to the front
		let lines = [];
		let second = await START.Run( { Config: config, Project: folder }, function ( line ) { lines.push( line ); } );
		ASSERT.equal( second.Server, null );
		ASSERT.deepEqual( second.Open, record );
		ASSERT.equal( second.Activated, true );
		ASSERT.equal( activated, 1 );
		ASSERT.deepEqual( lines, [ 'open-twice is open in Consensus at ' + first.Url + '/: its window brought to the front' ] );
		await second.Close();
		// the headless form on the open folder: the address printed, exit 0, nothing started (spawned without blocking:
		// the sidecar it asks runs in this process)
		let bin = PATH.join( __dirname, '..', 'bin', 'consensus.js' );
		let printed = await new Promise( function ( resolve )
		{
			let child = CHILD_PROCESS.spawn( process.execPath, [ bin, folder, '--config', config ], { stdio: [ 'ignore', 'pipe', 'pipe' ] } );
			let out = '';
			let err = '';
			child.stdout.on( 'data', function ( chunk ) { out += chunk; } );
			child.stderr.on( 'data', function ( chunk ) { err += chunk; } );
			child.on( 'exit', function ( code ) { resolve( { status: code, stdout: out, stderr: err } ); } );
		} );
		ASSERT.equal( printed.status, 0, printed.stderr );
		ASSERT.equal( printed.stdout.trim(), 'open-twice is open in Consensus at ' + first.Url + '/: its window brought to the front' );
		ASSERT.equal( activated, 2 );
		ASSERT.equal( SIDECAR.Read( folder ).Pid, process.pid, 'the file is still the first\'s' );
		// a sidecar with no window (no Activate) answers 404 to activate: the second open says so
		await first.Close();
		let headless = await START.Run( { Config: config, Port: 0, Project: folder } );
		try
		{
			lines = [];
			let third = await START.Run( { Config: config, Project: folder }, function ( line ) { lines.push( line ); } );
			ASSERT.equal( third.Activated, false );
			ASSERT.deepEqual( lines, [ 'open-twice is open in Consensus at ' + headless.Url + '/ (no window to bring to the front)' ] );
		}
		finally
		{
			await headless.Close();
		}
	}
	finally
	{
		await first.Close();
	}
} );
