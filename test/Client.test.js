'use strict';

// The Client (plan Review 2026-10-29, Step 5.1: the editions cut), without Electron: one remote project on one Server
// per window. Its settings (client.json: the Servers with their last project, over the base Settings), its command
// line through App.Arguments (--connect with and without the project; --port and a bare folder refused), the chooser's
// work (a Server's projects listed, the project found, the stored key), the page server serving the page and the
// chooser (client/page), the app's files (the desktop code of before, narrowed: no folder, no server, no Start.js) and
// the installer.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const FS = require( 'fs' );
const OS = require( 'os' );
const PATH = require( 'path' );
const SETTINGS = require( '../client/Settings.js' );
const PROJECTS = require( '../client/Projects.js' );
const SERVERS = require( '../electron/Servers.js' );
const APP = require( '../electron/App.js' );
const PAGE = require( '../electron/Page.js' );
const SERVER = require( '../src/Server.js' );

const ROOT = PATH.join( __dirname, '..' );
const VERSION = require( '../package.json' ).version;
const EXE = [ 'C:/electron.exe', 'W:/checkout/client' ];
// the Client's flags, as client/main.js declares them
const FLAGS = [
	{ Name: '--connect', Takes: 'value', Key: 'Connect', Needs: 'the Name of a saved Server' },
	{ Name: '--config', Takes: 'value', Key: 'Config', Needs: 'a folder' },
	{ Name: '--help', Alias: '-h', Takes: 'flag', Key: 'Help' },
];
const LINE = { Title: 'the Client', Flags: FLAGS, Positional: true, PositionalName: 'project', Packaged: false };

let folders = [];


function temporary_folder( prefix )
{
	let folder = FS.mkdtempSync( PATH.join( OS.tmpdir(), prefix || 'consensus-client-test-' ) );
	folders.push( folder );
	return folder;
}


function read( path )
{
	return FS.readFileSync( PATH.join( ROOT, path ), 'utf8' );
}


TEST.after( function ()
{
	for ( let folder of folders )
	{
		FS.rmSync( folder, { recursive: true, force: true } );
	}
} );


//---------------------------------------------------------------------
// client.json

TEST( 'client.json: in the config folder; missing, the defaults with no Servers; nothing written by a read; nothing carried over from desktop.json', function ()
{
	let config = temporary_folder();
	ASSERT.equal( SETTINGS.Path( config ), PATH.join( config, 'client.json' ) );
	FS.writeFileSync( PATH.join( config, 'desktop.json' ), JSON.stringify( { Servers: [ { Name: 'Team', Url: 'http://team:3500' } ], Hosts: [ { Name: 'Old', Url: 'http://old:3500', Project: 'prj-1' } ], Theme: 'nord' } ) );
	let loaded = SETTINGS.Load( config );
	ASSERT.deepEqual( loaded.Settings, { Servers: [], Theme: 'system', Scale: 'normal', Remembered: {} } );
	ASSERT.equal( loaded.Path, SETTINGS.Path( config ) );
	ASSERT.deepEqual( loaded.Lines, [ 'client settings start with the defaults (' + loaded.Path + ' is written at the first change)' ] );
	ASSERT.equal( FS.existsSync( SETTINGS.Path( config ) ), false );
} );


TEST( 'client.json: written whole and read back; each Server with its last project and its title, a name taken twice kept once, what is not usable left out', function ()
{
	let config = temporary_folder();
	let path = SETTINGS.Write( config, {
		Servers: [
			{ Name: ' Team ', Url: 'https://consensus.example.com/ ', Project: ' prj-aaa-bbb-ccc ', Title: ' Test ' },
			{ Name: 'team', Url: 'http://other:3500', Project: 'prj-2' },
			{ Name: 'Home', Url: 'http://127.0.0.1:3500' },
			{ Name: 'Titled', Url: 'http://titled:3500', Title: 'no project, so no title' },
			{ Name: 'No address', Url: 'ftp://nowhere', Project: 'prj-3' },
			{ Url: 'http://nameless:3500' },
		],
		Theme: 'nord',
		Scale: 'large',
		Remembered: { 'consensus.host:cube4:3500/prj-1.open': 'pln-1', 'page-port': 51234 },
		Recent: [ { Path: 'W:/p' } ],
	} );
	ASSERT.equal( path, SETTINGS.Path( config ) );
	let written = JSON.parse( FS.readFileSync( path, 'utf8' ) );
	ASSERT.deepEqual( written, {
		Servers: [
			{ Name: 'Team', Url: 'https://consensus.example.com', Project: 'prj-aaa-bbb-ccc', Title: 'Test' },
			{ Name: 'Home', Url: 'http://127.0.0.1:3500' },
			{ Name: 'Titled', Url: 'http://titled:3500' },
		],
		Theme: 'nord',
		Scale: 'large',
		Remembered: { 'consensus.host:cube4:3500/prj-1.open': 'pln-1', 'page-port': 51234 },
	} );
	ASSERT.deepEqual( SETTINGS.Load( config ).Settings, written );
	ASSERT.deepEqual( SETTINGS.Load( config ).Lines, [ 'client settings from ' + path ] );
	ASSERT.equal( FS.readdirSync( config ).filter( function ( name ) { return name.endsWith( '.tmp' ); } ).length, 0 );
	ASSERT.deepEqual( SETTINGS.Fill( { Servers: 'x', Theme: 'purple', Scale: 'huge', Remembered: [ 1 ] } ), SETTINGS.Default() );
	ASSERT.deepEqual( Object.keys( SETTINGS.Fill( {} ) ).sort(), [ 'Remembered', 'Scale', 'Servers', 'Theme' ] );
} );


TEST( 'client.json: a file that cannot be read is the defaults, left as it is; a remembered value set, changed and removed', function ()
{
	let config = temporary_folder();
	FS.writeFileSync( SETTINGS.Path( config ), '{ not json' );
	let loaded = SETTINGS.Load( config );
	ASSERT.deepEqual( loaded.Settings, SETTINGS.Default() );
	ASSERT.match( loaded.Lines[ 0 ], /could not be read/ );
	ASSERT.equal( FS.readFileSync( SETTINGS.Path( config ), 'utf8' ), '{ not json' );
	let settings = SETTINGS.Default();
	ASSERT.equal( SETTINGS.Remember( settings, 'consensus.open', 'pln-1' ), true );
	ASSERT.equal( SETTINGS.Remember( settings, 'consensus.open', 'pln-1' ), false );
	ASSERT.equal( SETTINGS.Remember( settings, 'folds', { a: true } ), true );
	ASSERT.equal( SETTINGS.Remember( settings, 'consensus.open', null ), true );
	ASSERT.equal( SETTINGS.Remember( settings, 'consensus.open', undefined ), false );
	ASSERT.deepEqual( settings.Remembered, { folds: { a: true } } );
} );


TEST( 'the Servers\' last project: set on the entry, replaced, forgotten with null; AddServer carries one; an unknown Server is refused', function ()
{
	let settings = SETTINGS.Default();
	ASSERT.deepEqual( SERVERS.AddServer( settings, { Name: 'Team', Url: 'http://team:3500/', Project: 'prj-1', Title: 'Alpha' } ).Server, { Name: 'Team', Url: 'http://team:3500', Project: 'prj-1', Title: 'Alpha' } );
	ASSERT.deepEqual( SERVERS.SetProject( settings, 'team', 'prj-2', 'Beta' ).Server, { Name: 'Team', Url: 'http://team:3500', Project: 'prj-2', Title: 'Beta' } );
	ASSERT.deepEqual( SERVERS.SetProject( settings, 'Team', 'prj-3', null ).Server, { Name: 'Team', Url: 'http://team:3500', Project: 'prj-3' } );
	ASSERT.deepEqual( SERVERS.SetProject( settings, 'Team', null, 'ignored' ).Server, { Name: 'Team', Url: 'http://team:3500' } );
	ASSERT.match( SERVERS.SetProject( settings, 'Nobody', 'prj-1', null ).Error, /no Server named "Nobody"/ );
	ASSERT.deepEqual( SERVERS.Fill( settings.Servers ), [ { Name: 'Team', Url: 'http://team:3500' } ] );
} );


//---------------------------------------------------------------------
// The command line (electron/App.js, as client/main.js parses it)

TEST( 'the Client\'s line: --connect <server> [<project>] and --config; --port, a second project and an unknown flag are refused; a bare folder is the main process\'s to refuse', function ()
{
	ASSERT.deepEqual( APP.Arguments( EXE.concat( [ '--connect', 'Team' ] ), LINE ), { Options: { Connect: 'Team', Config: null, Help: false }, Positional: null, Rest: [] } );
	ASSERT.deepEqual( APP.Arguments( EXE.concat( [ '--connect', 'Team', 'Alpha', '--config', 'C:/cfg', '--remote-debugging-port=9222' ] ), LINE ), { Options: { Connect: 'Team', Config: 'C:/cfg', Help: false }, Positional: 'Alpha', Rest: [] } );
	ASSERT.deepEqual( APP.Arguments( EXE, LINE ), { Options: { Connect: null, Config: null, Help: false }, Positional: null, Rest: [] } );
	ASSERT.equal( APP.Arguments( EXE.concat( [ '-h' ] ), LINE ).Options.Help, true );
	ASSERT.throws( function () { APP.Arguments( EXE.concat( [ '--port', '0' ] ), LINE ); }, /not an argument the Client knows: --port/ );
	ASSERT.throws( function () { APP.Arguments( EXE.concat( [ '--connect', 'Team', 'Alpha', 'Beta' ] ), LINE ); }, /one project only: Beta/ );
	ASSERT.throws( function () { APP.Arguments( EXE.concat( [ '--connect' ] ), LINE ); }, /--connect needs the Name of a saved Server/ );
	ASSERT.throws( function () { APP.Arguments( EXE.concat( [ '--connect', '--config', 'x' ] ), LINE ); }, /--connect needs the Name of a saved Server/ );
	ASSERT.throws( function () { APP.Arguments( EXE.concat( [ '--headless' ] ), LINE ); }, /not an argument the Client knows: --headless/ );
	// a bare folder with no --connect parses as the positional, which main.js refuses with the same sentence
	ASSERT.equal( APP.Arguments( EXE.concat( [ 'W:/p' ] ), LINE ).Positional, 'W:/p' );
	let main = read( 'client/main.js' );
	ASSERT.match( main, /Positional: true, PositionalName: 'project'/ );
	ASSERT.match( main, /if \( parsed\.Positional !== null && !parsed\.Options\.Connect \)\s*\{\s*throw new Error\( 'not an argument the Client knows: ' \+ parsed\.Positional \);/ );
	ASSERT.equal( main.indexOf( '--port' ), -1, 'the Client has no port of its own' );
} );


//---------------------------------------------------------------------
// The chooser's work without Electron

TEST( 'projects: a Server\'s projects are listed from its API for the chooser to pick from; a Server that does not answer says so; the project found by id, else by name; the stored key', async function ()
{
	let data = temporary_folder( 'client-server-' );
	FS.writeFileSync( PATH.join( data, 'consensus.json' ), JSON.stringify( { Port: 0, Owner: { Name: 'user', Display: 'User' } } ) );
	let host = await SERVER.Start( { Data: data, Port: 0 } );
	try
	{
		let made = await host.Store.CreateProject( { Name: 'Second' } );
		let listed = await PROJECTS.ServerProjects( host.Url + '/' );
		ASSERT.deepEqual( listed.map( function ( project ) { return project.Name; } ), [ 'Default', 'Second' ] );
		ASSERT.equal( listed[ 1 ].Id, made.Id );
		ASSERT.deepEqual( Object.keys( listed[ 0 ] ).sort(), [ 'Id', 'Name' ] );
		ASSERT.deepEqual( PROJECTS.FindProject( listed, 'Second' ), { Id: made.Id, Name: 'Second' } );
	}
	finally
	{
		await host.Close();
	}
	await ASSERT.rejects( PROJECTS.ServerProjects( 'http://127.0.0.1:9', 2000 ), /does not answer/ );
	await ASSERT.rejects( PROJECTS.ServerProjects( 'cube4:3500' ), /must start with http/ );
	let list = [ { Id: 'prj-1', Name: 'Alpha' }, { Id: 'prj-2', Name: 'prj-1' } ];
	ASSERT.deepEqual( PROJECTS.FindProject( list, 'prj-1' ), { Id: 'prj-1', Name: 'Alpha' } );
	ASSERT.deepEqual( PROJECTS.FindProject( list, 'Alpha' ), { Id: 'prj-1', Name: 'Alpha' } );
	ASSERT.equal( PROJECTS.FindProject( list, 'Beta' ), null );
	ASSERT.equal( PROJECTS.FindProject( list, '' ), null );
	// the key: the Server's address and the project id, as the desktop code kept it, so the remembered state carries
	ASSERT.equal( PROJECTS.Key( { Name: 'cube4', Url: 'http://cube4:3500/' }, { Id: 'prj-aaa-bbb-ccc' } ), 'host:cube4:3500/prj-aaa-bbb-ccc' );
	ASSERT.equal( PROJECTS.Key( { Url: 'https://team.example.com' }, null ), 'host:team.example.com/' );
	ASSERT.equal( PROJECTS.Key( null ), null );
} );


//---------------------------------------------------------------------
// The page server

TEST( 'the page server serves the page, the Client\'s chooser and the vendor files, and forwards to each root\'s server', async function ()
{
	// the chooser is the Client's own folder, named to the shared page server (plan Sidecar Edition, Step 1)
	let served = await PAGE.Serve( { Folders: [ PATH.join( ROOT, 'client', 'page' ) ] } );
	try
	{
		ASSERT.match( served.Url, /^http:\/\/127\.0\.0\.1:\d+$/ );
		let index = await fetch( served.Url + '/' );
		ASSERT.equal( index.status, 200 );
		ASSERT.match( await index.text(), /ng-app="Consensus"/ );
		let connect = await fetch( served.Url + '/connect.html' );
		ASSERT.equal( connect.status, 200 );
		let chooser = await connect.text();
		ASSERT.match( chooser, /ng-app="Connect"/ );
		ASSERT.match( chooser, /<title>Consensus Client<\/title>/ );
		ASSERT.match( chooser, /id="add-server"/ );
		for ( let gone of [ 'open-folder', 'new-project', 'recent-block', 'hosts-block' ] )
		{
			ASSERT.equal( chooser.indexOf( 'id="' + gone + '"' ), -1, 'the chooser has no ' + gone );
		}
		ASSERT.equal( ( await fetch( served.Url + '/vendor/angular.min.js' ) ).status, 200 );
		ASSERT.equal( ( await fetch( served.Url + '/vendor/bootstrap.min.css' ) ).status, 200 );
		ASSERT.equal( ( await fetch( served.Url + '/js/client.js' ) ).status, 200 );
		ASSERT.match( await ( await fetch( served.Url + '/js/client.js' ) ).text(), /ConsensusDesktop/ );
		// no root: the API answers 503; with roots (plan Run Shapes, Step 5), /servers/<key>/api and /instructions are
		// forwarded to that root's server, bodies and the events stream too; a key the window has not is 503
		ASSERT.equal( ( await fetch( served.Url + '/api/me' ) ).status, 503 );
		ASSERT.equal( ( await fetch( served.Url + '/servers/a/api/me' ) ).status, 503 );
		ASSERT.deepEqual( served.Roots(), [] );
		let data = temporary_folder( 'client-page-target-' );
		FS.writeFileSync( PATH.join( data, 'consensus.json' ), JSON.stringify( { Port: 0, Owner: { Name: 'user', Display: 'User' } } ) );
		let target = await SERVER.Start( { Data: data, Port: 0 } );
		try
		{
			served.SetRoots( [ { Key: 'a', Url: target.Url + '/' }, { Key: 'b', Url: 'http://127.0.0.1:1' } ] );
			ASSERT.deepEqual( served.Roots(), [ { Key: 'a', Url: target.Url }, { Key: 'b', Url: 'http://127.0.0.1:1' } ] );
			let me = await fetch( served.Url + '/servers/a/api/me' );
			ASSERT.equal( me.status, 200 );
			ASSERT.equal( ( await me.json() ).Version, VERSION );
			let made = await fetch( served.Url + '/servers/a/api/plans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify( { Title: 'Through the client', Text: '# T\n' } ) } );
			ASSERT.equal( made.status, 201 );
			let id = ( await made.json() ).Plan.Id;
			ASSERT.equal( ( await ( await fetch( target.Url + '/api/plans/' + id ) ).json() ).Plan.Title, 'Through the client' );
			ASSERT.equal( ( await fetch( served.Url + '/servers/a/api/plans/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify( { Title: 'Renamed through the client' } ) } ) ).status, 200 );
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
	await ASSERT.rejects( PAGE.Serve( { Folder: temporary_folder( 'client-nopage-' ) } ), /the page is missing/ );
} );


//---------------------------------------------------------------------
// The app's files

TEST( 'the Client app: its own folder and npm script; the desktop code of before, narrowed: no folder, no server, no Start.js, no routing; the current user kept for the sign-in', function ()
{
	let scripts = JSON.parse( read( 'package.json' ) ).scripts;
	ASSERT.equal( scripts.client, 'electron client' );
	let own = JSON.parse( read( 'client/package.json' ) );
	ASSERT.equal( own.main, 'main.js' );
	ASSERT.equal( own.version, JSON.parse( read( 'package.json' ) ).version );
	let main = read( 'client/main.js' );
	for ( let module of [ 'Sidecar.js', 'Instructions.js', 'Start.js', 'Mcp.js', 'ServerStatus.js', 'Host.js', 'Store.js', 'License.js' ] )
	{
		ASSERT.equal( main.indexOf( module + "' )" ), -1, 'the Client\'s main requires no ' + module );
	}
	for ( let gone of [ 'SERVER.Start', 'open_folder_here', "'new-project'", "'open-folder'", "'open-path'", "'open-recent'", "'forget'", 'PickFolder', 'Routed' ] )
	{
		ASSERT.equal( main.indexOf( gone ), -1, 'the Client\'s main has no ' + gone );
	}
	ASSERT.match( main, /CURRENT_USER\.Make\( config_folder \)/ );
	ASSERT.match( main, /'connect-server'|'server-projects'|'remove-server'|'set-license'|'clear-license'/ );
	ASSERT.equal( FS.existsSync( PATH.join( ROOT, 'client', 'page', 'connect.html' ) ), true );
	ASSERT.equal( FS.existsSync( PATH.join( ROOT, 'client', 'Projects.js' ) ), true );
	ASSERT.equal( FS.existsSync( PATH.join( ROOT, 'desktop', 'ServerStatus.js' ) ), false, 'the routing to this machine\'s Server is gone' );
	ASSERT.equal( PROJECTS.NewFolder, undefined, 'no folder is made' );
	let preload = read( 'client/preload.js' );
	ASSERT.match( preload, /exposeInMainWorld\( 'ConsensusDesktop', \{\s*\/\/[^\n]*\n\s*Edition: 'client',/ );
	for ( let name of [ 'SetLicense', 'ClearLicense', 'Project', 'ConnectServer', 'ServerProjects', 'RemoveServer', 'Settings', 'NewWindow', 'Quit' ] )
	{
		ASSERT.ok( preload.indexOf( name + ':' ) >= 0, 'the Client\'s bridge has ' + name );
	}
	for ( let name of [ 'PickFolder', 'OpenFolder', 'OpenPath', 'NewProject', 'OpenFolderWindow', 'OpenRecent', 'Forget', 'HostProjects', 'ConnectHost', 'RemoveHost', 'Try', 'Client', 'AddServer', 'Clerk' ] )
	{
		ASSERT.equal( preload.indexOf( name + ':' ), -1, 'the Client\'s bridge has no ' + name );
	}
	// the product's name by the bridge's Edition (plan Review 2026-10-29, Step 3)
	ASSERT.match( read( 'public/js/roots.js' ), /client: 'Consensus Client'/ );
	// the chooser: the Servers alone
	let chooser = read( 'client/page/connect.js' );
	ASSERT.match( chooser, /window\.Desktop\.ConnectServer\(/ );
	ASSERT.match( chooser, /window\.Desktop\.ServerProjects\(/ );
	for ( let gone of [ 'OpenFolder', 'OpenPath', 'NewProject', 'PickFolder', 'Forget', 'Recent' ] )
	{
		ASSERT.equal( chooser.indexOf( gone ), -1, 'the chooser has no ' + gone );
	}
} );


//---------------------------------------------------------------------
// The installer

TEST( 'the installer: Consensus Client, its own appId and artifact, the Client\'s files, the fourth build of npm run dist', function ()
{
	let build = JSON.parse( read( 'build/client.json' ) );
	ASSERT.equal( build.productName, 'Consensus Client' );
	ASSERT.equal( build.appId, 'com.mchiver.consensus-client' );
	ASSERT.equal( build.artifactName, 'Consensus-Client-Setup-${version}.${ext}' );
	ASSERT.equal( build.extraMetadata.main, 'client/main.js' );
	for ( let needed of [ 'client/**', 'electron/**', 'src/**', 'public/**', 'desktop/icon.ico', 'package.json' ] )
	{
		ASSERT.ok( build.files.includes( needed ), 'the installer holds ' + needed );
	}
	ASSERT.equal( build.files.some( function ( file ) { return file.indexOf( '.guides' ) >= 0; } ), false, 'no LLM guide until Step 5.3' );
	let others = [ 'desktop', 'server', 'sidecar' ].map( function ( name ) { return JSON.parse( read( 'build/' + name + '.json' ) ).appId; } );
	ASSERT.equal( others.includes( build.appId ), false, 'it installs beside the others' );
	let dist = JSON.parse( read( 'package.json' ) ).scripts.dist;
	ASSERT.match( dist, /-c build\/desktop\.json .* -c build\/server\.json .* -c build\/sidecar\.json .* -c build\/client\.json$/ );
} );
