'use strict';

// Settings - the Client's settings (plan Client Edition, Step 1): client.json in the global config folder
// (<user>/.consensus unless --config names another), beside desktop.json and consensus.json, read and written by the
// Client alone. A missing file is the defaults; nothing is carried over from desktop.json's saved Servers. The file is
// written when a value changes.
//
//   {
//     "Servers": [ { "Name": "Team", "Url": "https://consensus.example.com" } ],
//     "Theme": "system", "Scale": "normal",
//     "Remembered": {}
//   }
//   Servers: the Servers the person added, each under its own name (the root's key on the page) and its address.
//   Theme and Scale: the look. Remembered: the page's view state by key (the open item, the folds, the tabs, the sort,
//   the widths, the report folder) and the page server's port (page-port), so the window's origin, and with it
//   Clerk's session in the window's storage, stays the same between starts.
//
//   FILE, THEMES, DARK_THEMES, SCALES, NAME_LIMIT
//   Path( Config )                  <config>/client.json
//   Default()                       the settings the Client starts with
//   CleanName( Text )               a Server's name trimmed, or null when it is not a usable name
//   CleanUrl( Text )                a Server's address without its trailing slashes, or null when it is not http(s)
//   Fill( Settings )                every field present and usable; anything else left out (a Server twice by name: the first)
//   Remember( Settings, Key, Value ) a remembered value set (null or undefined removes it); whether it changed
//   Load( Config )                  { Settings, Path, Lines }: the file filled, or the defaults when missing or unreadable
//   Write( Config, Settings )       the file written whole (a temporary file renamed into place); the path

const FS = require( 'fs' );
const PATH = require( 'path' );

const FILE = 'client.json';
const DARK_THEMES = [ 'dark', 'slate', 'solarized-dark', 'nord', 'midnight' ];
const THEMES = [ 'system', 'light', 'sepia', 'paper', 'solarized-light' ].concat( DARK_THEMES );
const SCALES = [ 'small', 'normal', 'large' ];
const NAME_LIMIT = 60;


//---------------------------------------------------------------------

function Path( Config )
{
	return PATH.join( PATH.resolve( String( Config || '' ) ), FILE );
}


function Default()
{
	return {
		Servers: [],
		Theme: 'system',
		Scale: 'normal',
		Remembered: {},
	};
}


// A Server's name: trimmed, one to NAME_LIMIT characters, no control characters and no slashes (it keys the page's
// /servers/<name> route).
function CleanName( Text )
{
	if ( typeof Text !== 'string' )
	{
		return null;
	}
	let name = Text.trim();
	if ( !name || name.length > NAME_LIMIT || /[\u0000-\u001f\u007f\/\\]/.test( name ) )
	{
		return null;
	}
	return name;
}


// A Server's address: http:// or https://, a host, no spaces; its trailing slashes dropped.
function CleanUrl( Text )
{
	if ( typeof Text !== 'string' )
	{
		return null;
	}
	let url = Text.trim().replace( /\/+$/, '' );
	if ( !/^https?:\/\/[^\s\/]+(\/\S*)?$/i.test( url ) )
	{
		return null;
	}
	return url;
}


function Fill( Settings )
{
	let settings = Default();
	let given = ( Settings && typeof Settings === 'object' && !Array.isArray( Settings ) ) ? Settings : {};
	if ( Array.isArray( given.Servers ) )
	{
		for ( let entry of given.Servers )
		{
			let name = CleanName( entry && entry.Name );
			let url = CleanUrl( entry && entry.Url );
			let taken = settings.Servers.some( function ( one ) { return one.Name.toLowerCase() === ( name || '' ).toLowerCase(); } );
			if ( name && url && !taken )
			{
				settings.Servers.push( { Name: name, Url: url } );
			}
		}
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
		settings.Remembered = Object.assign( {}, given.Remembered );
	}
	return settings;
}


function Remember( Settings, Key, Value )
{
	if ( !Settings || typeof Key !== 'string' || !Key )
	{
		return false;
	}
	if ( !Settings.Remembered || typeof Settings.Remembered !== 'object' )
	{
		Settings.Remembered = {};
	}
	if ( Value === null || Value === undefined )
	{
		if ( !( Key in Settings.Remembered ) )
		{
			return false;
		}
		delete Settings.Remembered[ Key ];
		return true;
	}
	if ( JSON.stringify( Settings.Remembered[ Key ] ) === JSON.stringify( Value ) )
	{
		return false;
	}
	Settings.Remembered[ Key ] = Value;
	return true;
}


//---------------------------------------------------------------------

function Load( Config )
{
	let path = Path( Config );
	let lines = [];
	if ( !FS.existsSync( path ) )
	{
		return { Settings: Default(), Path: path, Lines: [ 'no ' + FILE + ' yet: the defaults' ] };
	}
	let read = null;
	try
	{
		read = JSON.parse( FS.readFileSync( path, 'utf8' ) );
	}
	catch ( error )
	{
		lines.push( FILE + ' could not be read (' + error.message + '): the defaults, and the file is left as it is until a setting changes' );
		return { Settings: Default(), Path: path, Lines: lines };
	}
	lines.push( 'settings from ' + path );
	return { Settings: Fill( read ), Path: path, Lines: lines };
}


function Write( Config, Settings )
{
	let path = Path( Config );
	FS.mkdirSync( PATH.dirname( path ), { recursive: true } );
	let temporary = path + '.' + process.pid + '.tmp';
	FS.writeFileSync( temporary, JSON.stringify( Fill( Settings ), null, '\t' ) + '\n' );
	FS.renameSync( temporary, path );
	return path;
}


//---------------------------------------------------------------------
// The Servers (Step 2): added by address under the Server's own name, renamed, removed. Each answers { Server } or
// { Error } and changes Settings in place; nothing here asks the Server anything (main.js tries it first).

function named( Settings, Name )
{
	let wanted = String( Name || '' ).toLowerCase();
	return ( Settings.Servers || [] ).find( function ( one ) { return one.Name.toLowerCase() === wanted; } ) || null;
}


// A name not taken yet: the name, else the name with " 2", " 3" and on.
function UniqueName( Settings, Name )
{
	let base = CleanName( Name ) || 'Server';
	if ( !named( Settings, base ) )
	{
		return base;
	}
	for ( let count = 2; ; count++ )
	{
		let suffix = ' ' + count;
		let candidate = base.slice( 0, NAME_LIMIT - suffix.length ) + suffix;
		if ( !named( Settings, candidate ) )
		{
			return candidate;
		}
	}
}


function AddServer( Settings, Fields )
{
	let fields = Fields || {};
	let url = CleanUrl( fields.Url );
	if ( !url )
	{
		return { Error: 'a Server\'s address starts with http:// or https://' };
	}
	let same = ( Settings.Servers || [] ).find( function ( one ) { return one.Url.toLowerCase() === url.toLowerCase(); } );
	if ( same )
	{
		return { Error: url + ' is in the list already, as ' + same.Name };
	}
	let server = { Name: UniqueName( Settings, fields.Name || new URL( url ).host ), Url: url };
	Settings.Servers = ( Settings.Servers || [] ).concat( [ server ] );
	return { Server: server };
}


function RenameServer( Settings, Name, To )
{
	let server = named( Settings, Name );
	if ( !server )
	{
		return { Error: 'no Server named "' + Name + '"' };
	}
	let name = CleanName( To );
	if ( !name )
	{
		return { Error: 'a Server\'s name is one to ' + NAME_LIMIT + ' characters, with no slash' };
	}
	let other = named( Settings, name );
	if ( other && other !== server )
	{
		return { Error: 'another Server is named "' + other.Name + '"' };
	}
	server.Name = name;
	return { Server: server };
}


function RemoveServer( Settings, Name )
{
	let server = named( Settings, Name );
	if ( !server )
	{
		return { Error: 'no Server named "' + Name + '"' };
	}
	Settings.Servers = Settings.Servers.filter( function ( one ) { return one !== server; } );
	return { Server: server };
}


module.exports = {
	FILE: FILE,
	THEMES: THEMES,
	DARK_THEMES: DARK_THEMES,
	SCALES: SCALES,
	NAME_LIMIT: NAME_LIMIT,
	Path: Path,
	Default: Default,
	CleanName: CleanName,
	CleanUrl: CleanUrl,
	Fill: Fill,
	Remember: Remember,
	UniqueName: UniqueName,
	AddServer: AddServer,
	RenameServer: RenameServer,
	RemoveServer: RemoveServer,
	Load: Load,
	Write: Write,
};
