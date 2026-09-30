'use strict';

// main - the worker app's main process (plan Worker Electron App): one window with the app's page, the workers run
// in this process through the worker's Start (Manager.js), each worker's own page shown in a WebContentsView over
// the tab's area when its tab is open, and the bridge the page calls (preload.js). Closing the window stops every
// worker and quits. Settings: app.json in Electron's user-data folder (Settings.js).
//
//   npm run app          (electron worker-app, from the checkout)

const PATH = require( 'path' );
const CHILD_PROCESS = require( 'child_process' );
const ELECTRON = require( 'electron' );
const SETTINGS = require( './Settings.js' );
const MANAGER = require( './Manager.js' );
const WORKER = require( '../src/Worker.js' );
const SERVER = require( '../src/Server.js' );

const SNAPSHOT_MILLISECONDS = 2000;
const CHECK_TIMEOUT = 20000;
const PAGE = PATH.join( __dirname, 'page', 'index.html' );

let settings_path = null;
let settings = null;
let manager = null;
let window = null;
let views = {};
let shown = { Name: null, Bounds: null };
let last_snapshot = '';
let closing = false;


//---------------------------------------------------------------------
// The views: one per running worker, its page loaded from the worker's port; only the open tab's is visible.

function open_view( name, url )
{
	if ( views[ name ] )
	{
		return;
	}
	let view = new ELECTRON.WebContentsView();
	views[ name ] = view;
	window.contentView.addChildView( view );
	view.setVisible( false );
	view.webContents.loadURL( url );
	place_views();
}


function close_view( name )
{
	let view = views[ name ];
	if ( !view )
	{
		return;
	}
	delete views[ name ];
	if ( window && !window.isDestroyed() )
	{
		window.contentView.removeChildView( view );
	}
	view.webContents.close();
}


function place_views()
{
	for ( let name of Object.keys( views ) )
	{
		let view = views[ name ];
		let visible = ( name === shown.Name ) && !!shown.Bounds;
		if ( visible )
		{
			let bounds = shown.Bounds;
			view.setBounds( { x: Math.round( bounds.x ), y: Math.round( bounds.y ), width: Math.max( 0, Math.round( bounds.width ) ), height: Math.max( 0, Math.round( bounds.height ) ) } );
		}
		view.setVisible( visible );
	}
}


//---------------------------------------------------------------------
// The snapshot, pushed to the page when it changes, and after every action.

function push_snapshot()
{
	if ( !window || window.isDestroyed() )
	{
		return;
	}
	let snapshot = manager.Snapshot();
	for ( let entry of snapshot )
	{
		if ( entry.Url && !views[ entry.Name ] )
		{
			open_view( entry.Name, entry.Url );
		}
		if ( !entry.Url && views[ entry.Name ] )
		{
			close_view( entry.Name );
		}
	}
	for ( let name of Object.keys( views ) )
	{
		if ( !snapshot.some( function ( entry ) { return entry.Name === name; } ) )
		{
			close_view( name );
		}
	}
	let text = JSON.stringify( snapshot );
	if ( text !== last_snapshot )
	{
		last_snapshot = text;
		window.webContents.send( 'workers', snapshot );
	}
}


//---------------------------------------------------------------------
// Check: an LLM item answers. claude-cli: the command with --version; ollama: the models its server lists.

function check_inference( item )
{
	if ( item.Type === 'ollama' )
	{
		return ollama_models( item.Url ).then( function ( models )
		{
			return { Result: models.length ? ( models.length + ' models: ' + models.join( ', ' ) ) : 'answered, with no models' };
		} );
	}
	return new Promise( function ( resolve )
	{
		let command = item.Command || 'claude';
		CHILD_PROCESS.execFile( command, [ '--version' ], { shell: process.platform === 'win32', timeout: CHECK_TIMEOUT, windowsHide: true }, function ( error, stdout, stderr )
		{
			if ( error )
			{
				return resolve( { Error: ( stderr || error.message ).trim() } );
			}
			resolve( { Result: ( stdout || stderr ).trim() } );
		} );
	} );
}


async function ollama_models( url )
{
	let answer = await fetch( String( url || '' ).replace( /\/+$/, '' ) + '/api/tags', { signal: AbortSignal.timeout( 5000 ) } );
	let json = await answer.json();
	return ( json.models || [] ).map( function ( model ) { return model.name; } ).sort();
}


//---------------------------------------------------------------------
// The bridge's handlers.

function attach_handlers()
{
	ELECTRON.ipcMain.handle( 'settings', function ()
	{
		return { Settings: settings, Path: settings_path, UserData: ELECTRON.app.getPath( 'userData' ) };
	} );

	ELECTRON.ipcMain.handle( 'save', async function ( event, fresh )
	{
		let filled = SETTINGS.Fill( fresh );
		let problems = SETTINGS.Problems( filled );
		if ( problems.length )
		{
			return { Problems: problems };
		}
		SETTINGS.Write( settings_path, filled );
		settings = filled;
		await manager.Settings( settings );
		push_snapshot();
		return { Settings: settings };
	} );

	ELECTRON.ipcMain.handle( 'workers', function ()
	{
		return manager.Snapshot();
	} );

	ELECTRON.ipcMain.handle( 'start', async function ( event, name )
	{
		try
		{
			await manager.Start( name );
		}
		catch ( error )
		{
			push_snapshot();
			return { Error: error.message };
		}
		push_snapshot();
		return {};
	} );

	ELECTRON.ipcMain.handle( 'stop', async function ( event, name )
	{
		await manager.Stop( name );
		push_snapshot();
		return {};
	} );

	ELECTRON.ipcMain.handle( 'token', function ()
	{
		return SETTINGS.NewToken();
	} );

	ELECTRON.ipcMain.handle( 'check', async function ( event, item )
	{
		try
		{
			return await check_inference( item || {} );
		}
		catch ( error )
		{
			return { Error: error.message };
		}
	} );

	ELECTRON.ipcMain.handle( 'models', async function ( event, url )
	{
		try
		{
			return { Models: await ollama_models( url ) };
		}
		catch ( error )
		{
			return { Error: error.message, Models: [] };
		}
	} );

	ELECTRON.ipcMain.handle( 'folder', async function ( event, current )
	{
		let options = { properties: [ 'openDirectory' ] };
		if ( current )
		{
			options.defaultPath = current;
		}
		let picked = await ELECTRON.dialog.showOpenDialog( window, options );
		if ( picked.canceled || !picked.filePaths.length )
		{
			return null;
		}
		return picked.filePaths[ 0 ].replace( /\\/g, '/' );
	} );

	ELECTRON.ipcMain.handle( 'browser', function ( event, url )
	{
		if ( /^http:\/\/127\.0\.0\.1:\d+\/?$/.test( String( url ) ) )
		{
			ELECTRON.shell.openExternal( url );
		}
		return {};
	} );

	ELECTRON.ipcMain.handle( 'copy', function ( event, text )
	{
		ELECTRON.clipboard.writeText( String( text ) );
		return {};
	} );

	ELECTRON.ipcMain.handle( 'view', function ( event, request )
	{
		shown = { Name: ( request && request.Name ) || null, Bounds: ( request && request.Bounds ) || null };
		place_views();
		return {};
	} );
}


//---------------------------------------------------------------------
// The window.

function create_window()
{
	window = new ELECTRON.BrowserWindow( {
		width: 1200,
		height: 800,
		title: 'Consensus Worker',
		autoHideMenuBar: true,
		webPreferences: {
			preload: PATH.join( __dirname, 'preload.js' ),
			contextIsolation: true,
			nodeIntegration: false,
		},
	} );
	window.loadFile( PAGE );
	window.on( 'close', function ( event )
	{
		if ( closing )
		{
			return;
		}
		event.preventDefault();
		closing = true;
		manager.Close().catch( function () {} ).then( function ()
		{
			for ( let name of Object.keys( views ) )
			{
				close_view( name );
			}
			window.destroy();
		} );
	} );
	window.on( 'closed', function ()
	{
		window = null;
	} );
}


async function main()
{
	await ELECTRON.app.whenReady();
	settings_path = PATH.join( ELECTRON.app.getPath( 'userData' ), 'app.json' );
	settings = SETTINGS.Read( settings_path );
	if ( !require( 'fs' ).existsSync( settings_path ) )
	{
		SETTINGS.Write( settings_path, settings );
	}
	manager = MANAGER.Manager( { UserData: ELECTRON.app.getPath( 'userData' ), Settings: settings, Start: WORKER.Start, Vendor: SERVER.AttachVendor } );
	attach_handlers();
	create_window();
	let ticking = setInterval( push_snapshot, SNAPSHOT_MILLISECONDS );
	ELECTRON.app.on( 'window-all-closed', function ()
	{
		clearInterval( ticking );
		ELECTRON.app.quit();
	} );
	await manager.StartAutomatic();
	push_snapshot();
}


main().catch( function ( error )
{
	console.error( error.message );
	ELECTRON.app.exit( 1 );
} );
