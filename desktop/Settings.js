'use strict';

// Settings - the desktop's fields of the global config (plan Run Shapes, Step 1: consensus.json in the config folder,
// shared with the server's Name, Port, Scope, States, Owner and Clerk): the saved servers, the theme and scale the
// desktop applies to the page it hosts. The LLM connections are the server's (src/Llms.js). Since plan Run Shapes,
// Step 5, the page shows every server at once, in one theme.
//
//   {
//     "Servers": [ { "Name": "cube4", "Url": "http://cube4:3500" } ],
//     "Theme": "system", "Scale": "normal",
//   }
//   Remembered holds the page's view state by key ("consensus.<server address>.<name>" per server, "consensus.<name>"
//   shared: the open project, the folds, the tabs, the sort, the hidden panes, the widths), since the page's origin
//   changes port at every start and its localStorage would not survive a restart.

const FS = require( 'fs' );
const PATH = require( 'path' );

// The palettes (plan UI Tweaks IV), as theme.js names them; the dark ones set the native bars dark.
const THEMES = [ 'system', 'light', 'sepia', 'paper', 'solarized-light', 'dark', 'slate', 'solarized-dark', 'nord', 'midnight' ];
const DARK_THEMES = [ 'dark', 'slate', 'solarized-dark', 'nord', 'midnight' ];
const SCALES = [ 'small', 'normal', 'large' ];
const DESKTOP_FIELDS = [ 'Servers', 'Theme', 'Scale', 'Remembered' ];


//---------------------------------------------------------------------
// Default: the settings a new desktop starts with.

function Default()
{
	return {
		Servers: [],
		Theme: 'system',
		Scale: 'normal',
		Remembered: {},
	};
}


//---------------------------------------------------------------------
// Fill: a settings object with every field present, in the desktop's shape.

function Fill( Settings )
{
	let settings = Default();
	let given = ( Settings && typeof Settings === 'object' ) ? Settings : {};
	if ( Array.isArray( given.Servers ) )
	{
		settings.Servers = given.Servers.map( function ( server )
		{
			let one = ( server && typeof server === 'object' ) ? server : {};
			return { Name: String( one.Name || '' ).trim(), Url: String( one.Url || '' ).trim().replace( /\/+$/, '' ) };
		} );
	}
	if ( THEMES.includes( given.Theme ) )
	{
		settings.Theme = given.Theme;
	}
	if ( SCALES.includes( given.Scale ) )
	{
		settings.Scale = given.Scale;
	}
	if ( given.Remembered && typeof given.Remembered === 'object' && !Array.isArray( given.Remembered ) )
	{
		settings.Remembered = JSON.parse( JSON.stringify( given.Remembered ) );
	}
	return settings;
}


//---------------------------------------------------------------------
// Remember: a value under Key in Remembered (a json value), or forgotten when Value is null or undefined. Returns
// whether anything changed.

function Remember( Settings, Key, Value )
{
	if ( typeof Key !== 'string' || !Key || Key.length > 512 )
	{
		return false;
	}
	if ( !Settings.Remembered || typeof Settings.Remembered !== 'object' )
	{
		Settings.Remembered = {};
	}
	if ( Value === null || Value === undefined )
	{
		if ( Settings.Remembered[ Key ] === undefined )
		{
			return false;
		}
		delete Settings.Remembered[ Key ];
		return true;
	}
	let text = JSON.stringify( Value );
	if ( text === undefined || text === JSON.stringify( Settings.Remembered[ Key ] ) )
	{
		return false;
	}
	Settings.Remembered[ Key ] = JSON.parse( text );
	return true;
}


//---------------------------------------------------------------------
// Apply: the desktop's fields of Filled (Fill's shape) onto Settings, in place, the server's fields untouched.

function Apply( Settings, Filled )
{
	for ( let field of DESKTOP_FIELDS )
	{
		Settings[ field ] = Filled[ field ];
	}
	return Settings;
}


//---------------------------------------------------------------------
// Prepare: the desktop's fields filled in on the global config, in place: a config with none yet starts with the
// defaults, one written by hand gets the fields it lacks. Returns the lines to log.

function Prepare( Settings )
{
	let missing = DESKTOP_FIELDS.filter( function ( field ) { return Settings[ field ] === undefined; } );
	Apply( Settings, Fill( Settings ) );
	let lines = [];
	if ( missing.length === DESKTOP_FIELDS.length )
	{
		lines.push( 'the desktop\'s settings start with the defaults' );
	}
	else if ( missing.length )
	{
		lines.push( 'the desktop\'s settings filled in: ' + missing.join( ', ' ) );
	}
	return lines;
}


//---------------------------------------------------------------------
// Read: a file in the desktop's shape, filled in; the defaults when there is no file.

function Read( Path )
{
	let read = {};
	if ( FS.existsSync( Path ) )
	{
		read = JSON.parse( FS.readFileSync( Path, 'utf8' ) );
	}
	return Fill( read );
}


//---------------------------------------------------------------------
// Write: a file in the desktop's shape, whole and atomic.

function Write( Path, Settings )
{
	FS.mkdirSync( PATH.dirname( Path ), { recursive: true } );
	let temporary = Path + '.' + process.pid + '.tmp';
	FS.writeFileSync( temporary, JSON.stringify( Settings, null, '\t' ) + '\n' );
	FS.renameSync( temporary, Path );
}


//---------------------------------------------------------------------
// Problems: what is wrong with the settings, as sentences; none when they are usable.

function Problems( Settings )
{
	let problems = [];
	let names = new Set();
	for ( let server of Settings.Servers || [] )
	{
		if ( !server.Name )
		{
			problems.push( 'a server has no Name' );
		}
		else if ( names.has( server.Name ) )
		{
			problems.push( 'server "' + server.Name + '" is named twice' );
		}
		names.add( server.Name );
		if ( !/^https?:\/\/\S+$/.test( server.Url || '' ) )
		{
			problems.push( 'server "' + ( server.Name || '?' ) + '": the Url must start with http:// or https://' );
		}
	}
	return problems;
}


//---------------------------------------------------------------------
// ServerNamed: the saved server with that name, or null.

function ServerNamed( Settings, Name )
{
	return ( Settings.Servers || [] ).find( function ( server ) { return server.Name === Name; } ) || null;
}


module.exports = {
	THEMES: THEMES,
	DARK_THEMES: DARK_THEMES,
	Remember: Remember,
	SCALES: SCALES,
	DESKTOP_FIELDS: DESKTOP_FIELDS,
	Default: Default,
	Fill: Fill,
	Apply: Apply,
	Prepare: Prepare,
	Read: Read,
	Write: Write,
	Problems: Problems,
	ServerNamed: ServerNamed,
};
