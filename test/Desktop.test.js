'use strict';

// The Desktop (plan Review 2026-10-29, Step 5.1: the editions cut), without Electron: several remote projects at a time
// from one or more Servers, never a local folder. Its settings (desktop.json: the Servers, the look and the remembered
// state, over the base Settings), the app's files (the Client's code base of before: no folder, no server, no Start.js;
// no license or user until Step 5.2), the page's switch for the thin page (Edition desktop in place of the Client flag),
// the installer, and the hidden menu's template (electron/Windows.js).

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const FS = require( 'fs' );
const OS = require( 'os' );
const PATH = require( 'path' );
const SETTINGS = require( '../desktop/Settings.js' );
const SERVERS = require( '../electron/Servers.js' );
const WINDOWS = require( '../electron/Windows.js' );

const ROOT = PATH.join( __dirname, '..' );

let folders = [];


function temporary_folder( prefix )
{
	let folder = FS.mkdtempSync( PATH.join( OS.tmpdir(), prefix ) );
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
// desktop.json

TEST( 'desktop.json: in the config folder; missing, the defaults with no Servers; nothing written by a read; nothing read from client.json', function ()
{
	let config = temporary_folder( 'desktop-settings-' );
	ASSERT.equal( SETTINGS.Path( config ), PATH.join( config, 'desktop.json' ) );
	FS.writeFileSync( PATH.join( config, 'client.json' ), JSON.stringify( { Servers: [ { Name: 'Team', Url: 'http://team:3500', Project: 'prj-1' } ], Theme: 'nord' } ) );
	let loaded = SETTINGS.Load( config );
	ASSERT.deepEqual( loaded.Settings, { Servers: [], Theme: 'system', Scale: 'normal', Remembered: {} } );
	ASSERT.equal( loaded.Path, SETTINGS.Path( config ) );
	ASSERT.deepEqual( loaded.Lines, [ 'desktop settings start with the defaults (' + loaded.Path + ' is written at the first change)' ] );
	ASSERT.equal( FS.existsSync( SETTINGS.Path( config ) ), false );
} );


TEST( 'desktop.json: an older file with Recent and Hosts is read for its look and remembered state alone; no migration of the Hosts', function ()
{
	let config = temporary_folder( 'desktop-older-' );
	FS.writeFileSync( SETTINGS.Path( config ), JSON.stringify( {
		Recent: [ { Path: 'W:/code/tic-tac-toe', Opened: '2026-10-25T10:00:00.000Z' } ],
		Hosts: [ { Name: 'cube4', Url: 'http://cube4:3500', Project: 'prj-aaa-bbb-ccc', Title: 'Test' } ],
		Theme: 'nord',
		Scale: 'large',
		Remembered: { 'consensus.open': 'pln-1', 'page-port': 51234 },
		License: { Plan: 'personal' },
	} ) );
	let loaded = SETTINGS.Load( config );
	ASSERT.deepEqual( loaded.Settings, { Servers: [], Theme: 'nord', Scale: 'large', Remembered: { 'consensus.open': 'pln-1', 'page-port': 51234 } } );
	ASSERT.deepEqual( loaded.Lines, [ 'desktop settings from ' + loaded.Path ] );
	// the next save drops what the shape has not
	SETTINGS.Write( config, loaded.Settings );
	ASSERT.deepEqual( Object.keys( JSON.parse( FS.readFileSync( loaded.Path, 'utf8' ) ) ).sort(), [ 'Remembered', 'Scale', 'Servers', 'Theme' ] );
} );


TEST( 'desktop.json: written whole and read back; Servers kept by name and address, trimmed; what is not usable is left out', function ()
{
	let config = temporary_folder( 'desktop-written-' );
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
	// the palettes (plan UI Tweaks IV): any of them is a Theme; the dark ones are named
	ASSERT.equal( SETTINGS.Fill( { Theme: 'nord' } ).Theme, 'nord' );
	ASSERT.equal( SETTINGS.Fill( { Theme: 'neon' } ).Theme, 'system' );
	ASSERT.equal( SETTINGS.DARK_THEMES.includes( 'nord' ), true );
	ASSERT.equal( SETTINGS.DARK_THEMES.includes( 'sepia' ), false );
	ASSERT.equal( SETTINGS.DARK_THEMES.every( function ( theme ) { return SETTINGS.THEMES.includes( theme ); } ), true );
} );


TEST( 'desktop.json: a file that cannot be read is the defaults, left as it is; a remembered value set, changed and removed', function ()
{
	let config = temporary_folder( 'desktop-unreadable-' );
	FS.writeFileSync( SETTINGS.Path( config ), '{ not json' );
	let loaded = SETTINGS.Load( config );
	ASSERT.deepEqual( loaded.Settings, SETTINGS.Default() );
	ASSERT.match( loaded.Lines[ 0 ], /could not be read/ );
	ASSERT.equal( FS.readFileSync( SETTINGS.Path( config ), 'utf8' ), '{ not json' );
	let settings = SETTINGS.Default();
	ASSERT.equal( SETTINGS.Remember( settings, 'consensus.open', 'pln-1' ), true );
	ASSERT.equal( SETTINGS.Remember( settings, 'consensus.open', 'pln-1' ), false );
	ASSERT.equal( SETTINGS.Remember( settings, 'consensus.open', null ), true );
	ASSERT.equal( SETTINGS.Remember( settings, '', 1 ), false );
	ASSERT.deepEqual( settings.Remembered, {} );
} );


//---------------------------------------------------------------------
// The Servers: added by address under the Server's own name, renamed, removed (electron/Servers.js)

TEST( 'the Servers: added under the Server\'s name, a name taken numbered on, an address twice refused, renamed, removed', function ()
{
	let settings = SETTINGS.Default();
	ASSERT.deepEqual( SERVERS.AddServer( settings, { Url: 'https://team.example.com/', Name: 'Team' } ), { Server: { Name: 'Team', Url: 'https://team.example.com' } } );
	ASSERT.deepEqual( SERVERS.AddServer( settings, { Url: 'http://other:3500', Name: 'team' } ).Server, { Name: 'team 2', Url: 'http://other:3500' } );
	ASSERT.equal( SERVERS.AddServer( settings, { Url: 'http://nameless:3500' } ).Server.Name, 'nameless:3500' );
	ASSERT.match( SERVERS.AddServer( settings, { Url: 'HTTPS://team.example.com' } ).Error, /in the list already, as Team/ );
	ASSERT.match( SERVERS.AddServer( settings, { Url: 'team.example.com' } ).Error, /http:\/\/ or https:\/\// );
	ASSERT.equal( settings.Servers.length, 3 );
	ASSERT.equal( SERVERS.UniqueName( settings, 'x'.repeat( SERVERS.NAME_LIMIT ) ), 'x'.repeat( SERVERS.NAME_LIMIT ) );
	settings.Servers.push( { Name: 'x'.repeat( SERVERS.NAME_LIMIT ), Url: 'http://long:1' } );
	ASSERT.equal( SERVERS.UniqueName( settings, 'x'.repeat( SERVERS.NAME_LIMIT ) ), 'x'.repeat( SERVERS.NAME_LIMIT - 2 ) + ' 2' );
	settings.Servers.pop();
	ASSERT.deepEqual( SERVERS.RenameServer( settings, 'team 2', ' Other ' ).Server, { Name: 'Other', Url: 'http://other:3500' } );
	ASSERT.match( SERVERS.RenameServer( settings, 'Other', 'TEAM' ).Error, /another Server is named "Team"/ );
	ASSERT.match( SERVERS.RenameServer( settings, 'Nobody', 'x' ).Error, /no Server named/ );
	ASSERT.deepEqual( SERVERS.RemoveServer( settings, 'OTHER' ).Server, { Name: 'Other', Url: 'http://other:3500' } );
	ASSERT.match( SERVERS.RemoveServer( settings, 'Other' ).Error, /no Server named/ );
	ASSERT.deepEqual( settings.Servers.map( function ( one ) { return one.Name; } ), [ 'Team', 'nameless:3500' ] );
} );


//---------------------------------------------------------------------
// The app's files

TEST( 'the Desktop app: its own folder and npm script; the Client\'s code base: no folder, no server, no Start.js; the sign-in written as the machine\'s current user for the Server beside it and read for nothing (Step 5.2)', function ()
{
	let scripts = JSON.parse( read( 'package.json' ) ).scripts;
	ASSERT.equal( scripts.desktop, 'electron desktop' );
	let own = JSON.parse( read( 'desktop/package.json' ) );
	ASSERT.equal( own.main, 'main.js' );
	ASSERT.equal( own.version, JSON.parse( read( 'package.json' ) ).version );
	let main = read( 'desktop/main.js' );
	for ( let module of [ 'Sidecar.js', 'License.js', 'Instructions.js', 'Start.js', 'Mcp.js', 'ServerStatus.js', 'Projects.js' ] )
	{
		ASSERT.equal( main.indexOf( module + "' )" ), -1, 'the Desktop\'s main requires no ' + module );
	}
	// the Personal check (Step 5.2): the sign-in goes to electron/CurrentUser.js for the Server beside the Desktop; the boot hands no license, the gate being the page's
	ASSERT.ok( main.indexOf( "CurrentUser.js' )" ) >= 0, 'the Desktop\'s main requires CurrentUser.js' );
	ASSERT.match( main, /const USER = CURRENT_USER\.Make\( config_folder \)/ );
	ASSERT.match( main, /ipcMain\.handle\( 'set-license', function \( event, token \)\s*\{\s*return set_license\( String\( token \|\| '' \) \);/ );
	ASSERT.match( main, /await USER\.SetLicense\( Token, \{\} \)/ );
	ASSERT.match( main, /ipcMain\.handle\( 'clear-license', function \(\)\s*\{\s*return clear_license\(\);/ );
	ASSERT.match( main, /return USER\.Clear\(\);/ );
	ASSERT.match( main, /\n\t\tLicense: null,/, 'the boot hands no license' );
	ASSERT.equal( main.indexOf( 'USER.Tier' ), -1, 'the Desktop reads the current user for nothing of its own' );
	ASSERT.equal( main.indexOf( 'USER.Read' ), -1, 'the Desktop reads the current user for nothing of its own' );
	// the local API (Step 5.3): electron/Proxy.js on the page server, over the current root and the token the page hands in
	ASSERT.ok( main.indexOf( "Proxy.js' )" ) >= 0, 'the Desktop\'s main requires Proxy.js' );
	ASSERT.match( main, /const TOKENS = APP\.Tokens\(\)/ );
	ASSERT.match( main, /Tokens: TOKENS,/ );
	ASSERT.match( main, /const CURRENT_ROOT = 'consensus\.current-root'/ );
	ASSERT.match( main, /Proxy: PROXY\.Make\( \{ Upstream: upstream_now, Token: TOKENS\.Token, About: about_now \} \)/ );
	ASSERT.match( main, /Edition: 'Desktop', Project: null, Others: desktop/ );
	ASSERT.equal( main.indexOf( 'SERVER.Start' ), -1, 'the Desktop starts no server' );
	ASSERT.equal( main.indexOf( 'SecretKey' ), -1, 'no secret goes to the page' );
	ASSERT.match( main, /Title: 'the Desktop', Flags: FLAGS \}/, 'the command line is --config alone: no Positional, no Rest' );
	ASSERT.match( main, /'servers'|'add-server'|'rename-server'|'remove-server'/ );
	ASSERT.deepEqual( FS.existsSync( PATH.join( ROOT, 'desktop', 'page' ) ), false, 'the chooser is the Client\'s' );
	let preload = read( 'desktop/preload.js' );
	ASSERT.match( preload, /exposeInMainWorld\( 'ConsensusDesktop', \{\s*Edition: 'desktop',/ );
	for ( let name of [ 'SetUser', 'PickFolder', 'OpenFolderWindow', 'OpenRecent', 'Client' ] )
	{
		ASSERT.doesNotMatch( preload, new RegExp( '^\\t' + name + ':', 'm' ), 'the Desktop\'s bridge has no ' + name );
	}
	ASSERT.match( preload, /^\tLicense: null,/m, 'the bridge hands no license' );
	for ( let name of [ 'Servers', 'AddServer', 'RenameServer', 'RemoveServer', 'Clerk', 'SetLicense', 'ClearLicense', 'SetToken' ] )
	{
		ASSERT.ok( preload.indexOf( name + ':' ) >= 0, 'the Desktop\'s bridge has ' + name );
	}
} );


TEST( 'the Desktop\'s page: the thin page by Edition desktop (the Client flag of before gone): one sign-in for every Server at Personal (Step 5.2), no configuration of a Server\'s, the runs and the Servers popup', function ()
{
	let session = read( 'public/js/session.js' );
	ASSERT.match( session, /const DESKTOP = !!\( window\.ConsensusDesktop && window\.ConsensusDesktop\.Edition === 'desktop' \)/ );
	ASSERT.match( session, /config = window\.ConsensusDesktop\.Clerk/ );
	ASSERT.match( session, /Every: DESKTOP/ );
	ASSERT.match( read( 'public/js/client.js' ), /Session\.Every === true \|\|/ );
	let roots = read( 'public/js/roots.js' );
	ASSERT.match( roots, /roots\.Desktop = roots\.Edition === 'desktop'/ );
	ASSERT.match( roots, /desktop: 'Consensus Desktop'/ );
	ASSERT.match( read( 'public/components/server-row/server-row.html' ), /<llm-fold ng-if="[^"]*!\$ctrl\.Roots\.Desktop"/ );
	ASSERT.match( read( 'public/components/server-row/server-row.html' ), /<users-fold ng-if="[^"]*!\$ctrl\.Roots\.Desktop"/ );
	ASSERT.match( read( 'public/components/project-view/project-view.html' ), /<roles-folder ng-if="[^"]*!\$ctrl\.Roots\.Desktop"/ );
	let tree = read( 'public/js/tree.js' );
	ASSERT.match( tree, /const DESKTOP_APP = !!\( window\.ConsensusDesktop && window\.ConsensusDesktop\.Edition === 'desktop' \)/ );
	let desktop_menu = /if \( DESKTOP_APP \)\s*\{\s*return \[([\s\S]*?)\];/.exec( tree.slice( tree.indexOf( 'function project_actions' ) ) )[ 1 ];
	for ( let left_out of [ 'Rename', 'Project settings', 'LLM Instructions', 'Delete', 'mount' ] )
	{
		ASSERT.equal( desktop_menu.indexOf( left_out ), -1, 'the Desktop\'s project menu has no ' + left_out );
	}
	// the Personal check (Step 5.2): the session's gate on its plan; the page, the Servers popup and the Servers menu item wait on it
	ASSERT.match( session, /function check_tier\(\)\s*\{\s*if \( DESKTOP && clerk && clerk\.user && !Licensed\( 'personal' \) \)\s*\{\s*session\.Refusal = \{ Error: 'license', Plan: 'personal' \};/ );
	ASSERT.match( session, /function Admitted\(\)\s*\{\s*if \( !DESKTOP \)\s*\{\s*return true;\s*\}\s*return SignedIn\(\) && !session\.Refusal && Licensed\( 'personal' \);/ );
	ASSERT.match( session, /session\.Admitted = Admitted;/ );
	ASSERT.match( read( 'public/js/app.js' ), /\$scope\.DesktopSignedOut = function \(\)\s*\{\s*return Session\.Every === true && !\( Session\.Loaded && Session\.Admitted\(\) \);/ );
	ASSERT.match( read( 'public/js/app.js' ), /if \( !Session\.Admitted\(\) \)\s*\{\s*return;\s*\}\s*State\.LoadMe\(\)\.then\( route \);\s*listen_all\(\);/, 'no root is read or listened to below Personal' );
	ASSERT.match( read( 'public/components/client-servers/client-servers.js' ), /if \( Session\.Admitted\(\) && Roots\.List\.length === 0 \)/ );
	ASSERT.match( read( 'public/js/llm.js' ), /Session\.Ready\.then\( function \(\)\s*\{\s*if \( Session\.Admitted\(\) \)\s*\{\s*read_all\(\);/, 'the LLM connections are read at start only for a person admitted' );
	// the local API (Step 5.3): every token to the app, the current root remembered for the upstream
	ASSERT.match( session, /function hand_token\( token \)/ );
	ASSERT.match( session, /bridge\.SetToken\( token \)/ );
	ASSERT.match( session, /setInterval\( refresh_token, TOKEN_REFRESH \)/ );
	ASSERT.match( read( 'public/js/app.js' ), /\$scope\.\$on\( 'root-changed', function \( event, root \)\s*\{\s*if \( Roots\.Desktop && root && root\.Key && \$window\.ConsensusStored \)\s*\{\s*\$window\.ConsensusStored\.Write\( 'current-root', String\( root\.Key \), false \);/ );
	ASSERT.match( read( 'public/components/title-bar/title-bar.js' ), /if \( ClientServers\.Available && Session\.Admitted\(\) \)/ );
	ASSERT.match( read( 'public/components/sign-in-box/sign-in-box.html' ), /&& \$ctrl\.Session\.Every">This account has no Consensus-AI <b>Personal<\/b> license, which the Desktop needs\./ );
	ASSERT.match( read( 'public/index.html' ), /ng-hide="DesktopSignedOut\(\)"/ );
	ASSERT.match( read( 'public/components/client-servers/client-servers.js' ), /bridge\.Edition === 'desktop' && typeof bridge\.AddServer === 'function'/ );
	ASSERT.match( read( 'public/components/client-runs/client-runs.js' ), /\$window\.ConsensusDesktop\.Edition === 'desktop'/ );
	// no page file reads the flag of before
	for ( let file of [ 'public/js/session.js', 'public/js/roots.js', 'public/js/tree.js', 'public/js/app.js', 'public/components/title-bar/title-bar.js' ] )
	{
		ASSERT.equal( read( file ).indexOf( '.Client === true' ), -1, file + ' reads no Client flag' );
	}
} );


//---------------------------------------------------------------------
// The installer

TEST( 'the installer: Consensus Desktop, its files with the common guide (Step 5.3), no folder command (the Desktop opens no folder)', function ()
{
	let build = JSON.parse( read( 'build/desktop.json' ) );
	ASSERT.equal( build.productName, 'Consensus Desktop' );
	ASSERT.equal( build.appId, 'com.mchiver.consensus' );
	ASSERT.equal( build.extraMetadata.main, 'desktop/main.js' );
	for ( let needed of [ 'desktop/**', 'electron/**', 'src/**', 'public/**', 'package.json' ] )
	{
		ASSERT.ok( build.files.includes( needed ), 'the installer holds ' + needed );
	}
	ASSERT.ok( build.files.includes( '.guides/build-with-consensus.md' ), 'the common guide ships, for the local /instructions' );
	ASSERT.equal( build.files.some( function ( file ) { return file.indexOf( 'build-with-sidecar' ) >= 0; } ), false, 'the Sidecar\'s guide is not the Desktop\'s' );
	ASSERT.equal( build.nsis.include, undefined, 'no Open in Consensus Desktop on a folder' );
	ASSERT.equal( FS.existsSync( PATH.join( ROOT, 'build', 'installer.nsh' ) ), false );
} );


//---------------------------------------------------------------------
// The shared window parts without Electron (electron/Windows.js; plan Review 2026-10-29, Steps 1 and 5.1)

TEST( 'the hidden menu: an item whose action is not given is left out with its accelerator (the Desktop and the Client have no folder to open); the Sidecar keeps all three', function ()
{
	function labels( template )
	{
		return template[ 0 ].submenu.filter( function ( item ) { return item.label; } ).map( function ( item ) { return item.label + ' ' + item.accelerator; } );
	}
	let noop = function () {};
	let all = WINDOWS.MenuTemplate( { NewWindow: noop, OpenFolderWindow: noop, Reload: noop } );
	ASSERT.deepEqual( labels( all ), [ 'New window CmdOrCtrl+N', 'Open folder in new window… CmdOrCtrl+Shift+O', 'Reload CmdOrCtrl+R' ] );
	let no_folder = WINDOWS.MenuTemplate( { NewWindow: noop, Reload: noop } );
	ASSERT.deepEqual( labels( no_folder ), [ 'New window CmdOrCtrl+N', 'Reload CmdOrCtrl+R' ] );
	ASSERT.equal( no_folder[ 0 ].submenu.some( function ( item ) { return item.accelerator === 'CmdOrCtrl+Shift+O'; } ), false, 'the accelerator goes with the item' );
	ASSERT.deepEqual( all[ 0 ].submenu.filter( function ( item ) { return item.role; } ), [ { role: 'quit' } ] );
	ASSERT.equal( all[ 1 ].label, 'View' );
	// the Sidecar alone passes the folder action
	ASSERT.match( read( 'sidecar/main.js' ), /OpenFolderWindow: function/ );
	ASSERT.equal( read( 'desktop/main.js' ).indexOf( 'OpenFolderWindow: function' ), -1 );
	ASSERT.equal( read( 'client/main.js' ).indexOf( 'OpenFolderWindow: function' ), -1 );
} );
