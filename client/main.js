'use strict';

// main - the Client's main process (plan Client Edition, Step 1): a new app beside Sidecar, Desktop and the Server that
// connects to projects on one or more Consensus Servers. It has no Sidecar functionality (no local folder, no server
// of its own), no token-based service API (no API or MCP of its own, no LLM Instructions, no tokens) and no current
// user (no user.json, no license read); all configuration is the Servers' own. A window shows every added Server as a
// root of the page's tree; the window's page is served by the page server (electron/Page.js) on 127.0.0.1, which
// forwards each Server's API through /servers/<name>/api. New window opens another window of this process on the
// same list. The settings are client.json in the config folder (Settings.js). The window parts are shared with
// Desktop and Sidecar (electron/Windows.js).
// Step 2: the sign-in and the Servers. The page signs in through our Clerk instance (its publishable key and Frontend
// API host handed in the boot, from src/Clerk.js; the session kept in the window's own storage) and the session token
// goes with every call to every Server. Add server tries the address (GET /api/me, with the person's token) and saves
// it under the Server's own name; rename and remove change client.json alone. A change to the list is applied to the
// page server and every window is reloaded on it. Plan Review 2026-10-29, Step 2: the command line, the saving, the
// common bridge handlers, the page server on its remembered port and the shutdown are electron/App.js's, the probe
// src/Probe.js's and the Servers store electron/Servers.js's; this file keeps what is the Client's own.
//
//   npm run client -- [--config <folder>]

const PATH = require( 'path' );
const ELECTRON = require( 'electron' );
const SERVER = require( '../src/Server.js' );
const CLERK = require( '../src/Clerk.js' );
const PROBE = require( '../src/Probe.js' );
const WINDOWS = require( '../electron/Windows.js' );
const APP = require( '../electron/App.js' );
const SERVERS = require( '../electron/Servers.js' );
const SETTINGS = require( './Settings.js' );

const VERSION = require( '../package.json' ).version;
const TITLE = 'Consensus Client';
const ICON = PATH.join( __dirname, '..', 'desktop', 'icon.ico' );
const PRELOAD = PATH.join( __dirname, 'preload.js' );
const USAGE = 'usage: consensus-client [--config <folder>]';
const TRY_TIMEOUT = 5000;
const FLAGS = [
	{ Name: '--config', Takes: 'value', Key: 'Config', Needs: 'a folder' },
	{ Name: '--help', Alias: '-h', Takes: 'flag', Key: 'Help' },
];

let options = null;		// { Config, Help }
let client = null;		// client.json, filled: { Servers, Theme, Scale, Remembered }
let page = null;		// electron/Page.js's
let windows = [];		// the open windows, all on the same list of Servers

// The settings saved: now, or a moment after the last change (the view state changes often: a fold, a tab).
const SAVER = APP.Saver( { Write: function () { SETTINGS.Write( config_folder(), client ); }, Label: SETTINGS.FILE } );


//---------------------------------------------------------------------
// The settings: <config>/client.json

function config_folder()
{
	return options.Config || SERVER.DEFAULT_CONFIG;
}


//---------------------------------------------------------------------
// The arguments: --config (electron/App.js).

function parse_arguments( argv )
{
	let parsed = APP.Arguments( argv, { Title: 'the Client', Flags: FLAGS } );
	return { Config: parsed.Options.Config ? PATH.resolve( parsed.Options.Config ) : null, Help: parsed.Options.Help };
}


//---------------------------------------------------------------------
// The Servers: one root of the page each, keyed by its name.

function roots_now()
{
	return client.Servers.map( function ( server )
	{
		return { Key: server.Name, Name: server.Name, Url: server.Url, Kind: 'server' };
	} );
}


function apply_roots()
{
	page.SetRoots( roots_now().map( function ( root ) { return { Key: root.Key, Url: root.Url }; } ) );
}


// The list changed: written, the page server forwarding to the new list, and every window read again on it.
function servers_changed()
{
	SAVER.Save();
	apply_roots();
	for ( let window of windows )
	{
		if ( !window.isDestroyed() )
		{
			window.webContents.reload();
		}
	}
}


// A Server tried at its address (src/Probe.js): GET /api/me with the person's session token. A Consensus Server
// answers its own name when it lets the person in, or asks for a sign-in (still a Server, added: what a person may see
// is the Server's to say).
async function add_server( Fields )
{
	let fields = Fields || {};
	let url = SERVERS.CleanUrl( fields.Url );
	if ( !url )
	{
		return { Error: 'a Server\'s address starts with http:// or https://' };
	}
	let tried = await PROBE.Probe( url, { Token: ( typeof fields.Token === 'string' ) ? fields.Token : null, Timeout: TRY_TIMEOUT } );
	if ( !tried.Ok )
	{
		return { Error: tried.Error };
	}
	let added = SERVERS.AddServer( client, { Url: url, Name: tried.Name } );
	if ( added.Server )
	{
		console.log( 'Server added: ' + added.Server.Name + ' at ' + added.Server.Url );
		setImmediate( servers_changed );
	}
	return added;
}


function rename_server( Fields )
{
	let fields = Fields || {};
	let renamed = SERVERS.RenameServer( client, fields.Name, fields.To );
	if ( renamed.Server )
	{
		setImmediate( servers_changed );
	}
	return renamed;
}


function remove_server( Name )
{
	let removed = SERVERS.RemoveServer( client, Name );
	if ( removed.Server )
	{
		console.log( 'Server removed: ' + removed.Server.Name );
		setImmediate( servers_changed );
	}
	return removed;
}


// Our Clerk instance, as the page needs it to sign in: the publishable key and its Frontend API host, never a secret.
function clerk_config()
{
	let clerk = CLERK.Clerk( { Settings: {} } );
	return { On: !!clerk.FrontendApi(), Required: true, PublishableKey: clerk.PublishableKey(), FrontendApi: clerk.FrontendApi(), Pricing: CLERK.PRICING };
}


//---------------------------------------------------------------------
// The windows

function boot_info()
{
	return {
		Base: '',		// the page's own origin: Page.js forwards /servers/<name>/api to each Server
		Version: VERSION,
		Theme: client.Theme,
		Scale: client.Scale,
		Remembered: client.Remembered,
		Roots: roots_now(),
		License: null,
		Project: null,
		Recent: [],
		Reason: null,
		Client: true,
		Clerk: clerk_config(),
	};
}


function window_options( Width, Height )
{
	return WINDOWS.Options( { Width: Width, Height: Height, Title: TITLE, Icon: ICON, Theme: client.Theme, DarkThemes: SETTINGS.DARK_THEMES, Preload: PRELOAD } );
}


// A window on the list of Servers: its detached tabs, its report windows and its close (electron/Windows.js).
function open_window()
{
	let window = new ELECTRON.BrowserWindow( window_options( 1400, 900 ) );
	windows.push( window );
	WINDOWS.Attach( window, {
		PageUrl: function () { return page ? page.Url : null; },
		Icon: ICON,
		Preload: PRELOAD,
		Options: window_options,
		OnClosed: function () { windows = windows.filter( function ( one ) { return one !== window; } ); },
	} );
	window.loadURL( page.Url + '/' );
	return window;
}


// The menu (not shown; its accelerators are): New window opens another window here; there is no folder to open, so
// no OpenFolderWindow is given and the item and its accelerator are left out (plan Review 2026-10-29, Step 1).
function build_menu()
{
	WINDOWS.BuildMenu( {
		NewWindow: function () { open_window(); },
		Reload: function ()
		{
			let focused = ELECTRON.BrowserWindow.getFocusedWindow();
			if ( focused )
			{
				focused.webContents.reload();
			}
		},
	} );
}


//---------------------------------------------------------------------
// The bridge's handlers: the common ones (electron/App.js), then the Client's own.

function attach_handlers()
{
	APP.AttachHandlers( {
		Boot: boot_info,
		Settings: function () { return client; },
		Saver: SAVER,
		Roots: roots_now,
		NewWindow: function () { open_window(); },
		Protected: [ APP.PAGE_PORT ],
	} );

	// The Servers (Step 2): the list, Add server, rename and remove.
	ELECTRON.ipcMain.handle( 'servers', function ()
	{
		return { Servers: client.Servers.map( function ( server ) { return { Name: server.Name, Url: server.Url }; } ) };
	} );

	ELECTRON.ipcMain.handle( 'add-server', function ( event, fields )
	{
		return add_server( fields );
	} );

	ELECTRON.ipcMain.handle( 'rename-server', function ( event, fields )
	{
		return rename_server( fields );
	} );

	ELECTRON.ipcMain.handle( 'remove-server', function ( event, name )
	{
		return remove_server( name );
	} );
}


//---------------------------------------------------------------------

async function main()
{
	try
	{
		options = parse_arguments( process.argv );
	}
	catch ( error )
	{
		APP.FailToStart( TITLE, error.message + '\n\n' + USAGE );
		return;
	}
	if ( options.Help )
	{
		console.log( USAGE );
		ELECTRON.app.exit( 0 );
		return;
	}
	await ELECTRON.app.whenReady();
	let loaded = SETTINGS.Load( config_folder() );
	client = loaded.Settings;
	loaded.Lines.forEach( function ( line ) { console.log( line ); } );
	WINDOWS.ApplyNativeTheme( client.Theme, SETTINGS.DARK_THEMES );
	page = await APP.ServePage( { Settings: client, Saver: SAVER } );
	apply_roots();
	console.log( TITLE + ': the page on ' + page.Url + ', ' + client.Servers.length + ' Server' + ( client.Servers.length === 1 ? '' : 's' ) );
	attach_handlers();
	build_menu();
	open_window();
	APP.AttachShutdown( {
		Saver: SAVER,
		Close: function () { return page.Close(); },
	} );
}


main().catch( function ( error )
{
	APP.FailToStart( TITLE, error.message );
} );
