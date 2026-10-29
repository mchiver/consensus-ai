'use strict';

// App - what the applications' main processes share (plan Review 2026-10-29, Step 2: desktop, sidecar and client
// main.js grew by copying; the Server joins in Step 3): the command line, a start that fails, the settings saved a
// moment after a change, the bridge handlers every page needs, the page server on the port it had last time, and the
// shutdown when the last window closes. An app hands in what differs: its title, its flags, its settings object, its
// boot fields, its roots, and adds its own handlers after.
//
//   Arguments( argv, { Flags, Positional?, Rest?, Title?, Packaged? } )   -> { Options, Positional, Rest }
//       the Electron switches filtered out and the slice after the executable (and, from the checkout, the app folder)
//       taken; Flags a list of { Name: '--port', Takes: 'value' | 'number' | 'flag', Key: 'Port', Alias?, Needs? },
//       each landing in Options by its Key (null, or false for a flag, when absent); a value flag throws
//       "<Name> needs <Needs>" when nothing or another flag follows it, 'number' also when it is not a whole number;
//       Positional true allows one bare argument, answered as Positional, else a bare argument throws; Rest true keeps
//       the arguments the Flags do not name, in order, for src/Start.js, Rest false throwing on an unknown one. What is
//       thrown is the message the app prints with its usage. Packaged overrides Electron's isPackaged (the tests).
//   FailToStart( Title, Message, Quiet? )   the message on the console and, unless Quiet, in an error box; exit 1
//   Saver( { Write, Label } )               { Save(), SaveSoon(), Flush() }: Write called now, or SAVE_DELAY ms after
//                                           the last SaveSoon; a Write that throws is logged as "<Label> could not be
//                                           written"; Flush saves what a SaveSoon left pending
//   AttachHandlers( { Boot, Settings, Saver, Roots, NewWindow, Protected? } )
//       the bridge handlers boot, remember, theme, print-pdf, view-in-browser, quit and new-window, and the title bar's
//       chrome message (Windows.AttachChrome); Boot() the boot object, Settings() the live settings object (its Theme,
//       Scale and Remembered), Roots() the page's roots for View in Browser, NewWindow() another window; Protected the
//       remembered keys the page may not change (the page server's port)
//   ServePage( { Settings, Saver, Folders? } )   the page server on the remembered PAGE_PORT, a free one remembered instead
//   AttachShutdown( { Saver, Close } )      window-all-closed: the pending save flushed, Close() awaited, the app quit
//   ELECTRON_SWITCH, SAVE_DELAY, PAGE_PORT, REPORT_FOLDER

const PATH = require( 'path' );
const ELECTRON = require( 'electron' );
const WINDOWS = require( './Windows.js' );
const SETTINGS = require( './Settings.js' );
const PAGE = require( './Page.js' );

// Electron's own switches, which stay on the command line the app parses.
const ELECTRON_SWITCH = /^--(remote-debugging-port|user-data-dir|inspect|enable-logging|no-sandbox|disable-gpu|trace-warnings|allow-file-access)/;
const SAVE_DELAY = 300;			// the view state changes often (a fold, a tab): written a moment after the last change
const PAGE_PORT = 'page-port';		// the remembered key of the page server's port
const REPORT_FOLDER = 'report-folder';	// the remembered key of the folder Print to PDF saved in last


// Electron's app, or null when this module is loaded by plain node (the tests).
function electron_app()
{
	return ( ELECTRON && typeof ELECTRON === 'object' && ELECTRON.app ) ? ELECTRON.app : null;
}


//---------------------------------------------------------------------
// The command line

function Arguments( argv, Options )
{
	let options = Options || {};
	let flags = Array.isArray( options.Flags ) ? options.Flags : [];
	let title = options.Title || 'the app';
	let app = electron_app();
	let packaged = ( options.Packaged !== undefined ) ? !!options.Packaged : !!( app && app.isPackaged );
	let list = ( argv || [] ).slice( packaged ? 1 : 2 ).filter( function ( argument ) { return !ELECTRON_SWITCH.test( argument ); } );
	let answer = { Options: {}, Positional: null, Rest: [] };
	for ( let flag of flags )
	{
		answer.Options[ flag.Key ] = ( flag.Takes === 'flag' ) ? false : null;
	}
	for ( let index = 0; index < list.length; index++ )
	{
		let argument = list[ index ];
		let flag = flags.find( function ( one ) { return one.Name === argument || ( one.Alias && one.Alias === argument ); } );
		if ( flag && flag.Takes === 'flag' )
		{
			answer.Options[ flag.Key ] = true;
			continue;
		}
		if ( flag )
		{
			let needs = flag.Needs || ( ( flag.Takes === 'number' ) ? 'a number' : 'a value' );
			let value = list[ index + 1 ];
			if ( value === undefined || value.startsWith( '--' ) )
			{
				throw new Error( flag.Name + ' needs ' + needs );
			}
			if ( flag.Takes === 'number' )
			{
				let number = Number( value );
				if ( !Number.isInteger( number ) || number < 0 )
				{
					throw new Error( flag.Name + ' needs ' + needs );
				}
				answer.Options[ flag.Key ] = number;
			}
			else
			{
				answer.Options[ flag.Key ] = value;
			}
			index++;
			continue;
		}
		if ( argument.startsWith( '-' ) )
		{
			if ( options.Rest )
			{
				answer.Rest.push( argument );
				continue;
			}
			throw new Error( 'not an argument ' + title + ' knows: ' + argument );
		}
		if ( options.Positional && answer.Positional === null )
		{
			answer.Positional = argument;
			continue;
		}
		if ( options.Rest )
		{
			answer.Rest.push( argument );
			continue;
		}
		if ( options.Positional )
		{
			throw new Error( 'one ' + ( options.PositionalName || 'folder' ) + ' only: ' + argument );
		}
		throw new Error( 'not an argument ' + title + ' knows: ' + argument );
	}
	return answer;
}


//---------------------------------------------------------------------
// A start that fails: the message on the console and, since an icon has no console, in a dialog unless Quiet.

function FailToStart( Title, Message, Quiet )
{
	console.error( Message );
	if ( !Quiet )
	{
		ELECTRON.dialog.showErrorBox( Title + ' could not start', Message );
	}
	ELECTRON.app.exit( 1 );
}


//---------------------------------------------------------------------
// The settings saved: now, or a moment after the last change.

function Saver( Fields )
{
	let fields = Fields || {};
	let label = fields.Label || 'the settings';
	let timer = null;


	function Save()
	{
		if ( timer )
		{
			clearTimeout( timer );
			timer = null;
		}
		try
		{
			fields.Write();
		}
		catch ( error )
		{
			console.error( label + ' could not be written: ' + error.message );
		}
	}


	function SaveSoon()
	{
		if ( timer )
		{
			clearTimeout( timer );
		}
		timer = setTimeout( Save, SAVE_DELAY );
	}


	function Flush()
	{
		if ( timer )
		{
			Save();
		}
	}


	return { Save: Save, SaveSoon: SaveSoon, Flush: Flush };
}


//---------------------------------------------------------------------
// The bridge handlers every page needs.

function AttachHandlers( Fields )
{
	let fields = Fields || {};
	let protected_keys = Array.isArray( fields.Protected ) ? fields.Protected : [];

	ELECTRON.ipcMain.on( 'boot', function ( event )
	{
		event.returnValue = fields.Boot();
	} );

	// The page's remembered state (stored.js): a value by key, into the settings.
	ELECTRON.ipcMain.on( 'remember', function ( event, change )
	{
		if ( !change || typeof change.Key !== 'string' || protected_keys.includes( change.Key ) )
		{
			return;
		}
		if ( SETTINGS.Remember( fields.Settings(), change.Key, change.Value ) )
		{
			fields.Saver.SaveSoon();
		}
	} );

	// The page's picker sets the window's theme and scale.
	ELECTRON.ipcMain.on( 'theme', function ( event, change )
	{
		let settings = fields.Settings();
		if ( change && SETTINGS.THEMES.includes( change.Theme ) )
		{
			settings.Theme = change.Theme;
		}
		if ( change && SETTINGS.SCALES.includes( change.Scale ) )
		{
			settings.Scale = change.Scale;
		}
		fields.Saver.Save();
		WINDOWS.ApplyNativeTheme( settings.Theme, SETTINGS.DARK_THEMES );
	} );

	ELECTRON.ipcMain.handle( 'new-window', function ()
	{
		fields.NewWindow();
		return {};
	} );

	// The report window's Print to PDF (plan Printing and Reporting): the save dialog in the folder last used.
	ELECTRON.ipcMain.handle( 'print-pdf', async function ( event, name )
	{
		let settings = fields.Settings();
		let remembered = settings.Remembered ? settings.Remembered[ REPORT_FOLDER ] : null;
		let answer = await WINDOWS.PrintToPdf( event.sender, name, ( typeof remembered === 'string' ) ? remembered : null );
		if ( answer.Path && SETTINGS.Remember( settings, REPORT_FOLDER, PATH.dirname( answer.Path ) ) )
		{
			fields.Saver.SaveSoon();
		}
		return answer;
	} );

	// The report window's View in Browser: the same report at its root's own address, in the system browser.
	ELECTRON.ipcMain.handle( 'view-in-browser', function ( event )
	{
		return WINDOWS.ViewInBrowser( event.sender.getURL(), fields.Roots() );
	} );

	ELECTRON.ipcMain.handle( 'quit', function ()
	{
		ELECTRON.app.quit();
		return {};
	} );

	// The title bar's colours and height, from the page (plan UI Components, Step 5): the window buttons follow the palette.
	WINDOWS.AttachChrome();
}


//---------------------------------------------------------------------
// The page server on the port it had last time, so the window's origin stays the same between starts and a sign-in
// through Clerk in the window's storage survives a restart; a port in use gives way to a free one, remembered instead.

async function ServePage( Fields )
{
	let fields = Fields || {};
	let settings = fields.Settings;
	let remembered = ( settings.Remembered && Number.isInteger( settings.Remembered[ PAGE_PORT ] ) ) ? settings.Remembered[ PAGE_PORT ] : 0;
	if ( remembered > 0 )
	{
		try
		{
			return await PAGE.Serve( { Port: remembered, Folders: fields.Folders } );
		}
		catch ( error )
		{
			console.log( 'the page port ' + remembered + ' is in use: another one' );
		}
	}
	let served = await PAGE.Serve( { Folders: fields.Folders } );
	if ( SETTINGS.Remember( settings, PAGE_PORT, Number( new URL( served.Url ).port ) ) )
	{
		fields.Saver.Save();
	}
	return served;
}


//---------------------------------------------------------------------
// The last window closed: a pending save written, the app's servers closed, the app quit.

function AttachShutdown( Fields )
{
	let fields = Fields || {};
	ELECTRON.app.on( 'window-all-closed', function ()
	{
		if ( fields.Saver )
		{
			fields.Saver.Flush();
		}
		Promise.resolve().then( function () { return fields.Close ? fields.Close() : null; } ).catch( function () {} ).then( function () { ELECTRON.app.quit(); } );
	} );
}


module.exports = {
	ELECTRON_SWITCH: ELECTRON_SWITCH,
	SAVE_DELAY: SAVE_DELAY,
	PAGE_PORT: PAGE_PORT,
	REPORT_FOLDER: REPORT_FOLDER,
	Arguments: Arguments,
	FailToStart: FailToStart,
	Saver: Saver,
	AttachHandlers: AttachHandlers,
	ServePage: ServePage,
	AttachShutdown: AttachShutdown,
};
