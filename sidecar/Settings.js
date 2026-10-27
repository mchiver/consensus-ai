'use strict';

// Settings - Sidecar's settings for a project (plan Sidecar Edition, Step 2): <project>/.consensus/sidecar.json, read
// and written by Sidecar alone. Sidecar has nothing to do with the Server or the global config folder: a missing file
// is the defaults, and nothing is carried over from Desktop's or the Server's files. The file is written when a value
// changes; the page remembers the open project as it loads, so the file appears soon after a project is first opened.
//
//   {
//     "User": "andre@cube1",
//     "Theme": "system", "Scale": "normal",
//     "Remembered": {}
//   }
//   User: the name the user goes by, whatever they type; by default <os user>@<machine>. It is the name on everything
//   the user writes and in the LLM's byline. Theme and Scale: the look. Remembered: the page's view state by key (the
//   open item, the folds, the tabs, the sort, the hidden panes, the widths, the report folder).
//
//   FILE, THEMES, DARK_THEMES, SCALES, USER_LIMIT
//   Path( Folder )                  <folder>/.consensus/sidecar.json
//   DefaultUser()                   <os user>@<machine>, lower-cased
//   Default()                       the settings a project starts with
//   Fill( Settings )                every field present and usable; anything else left out
//   CleanUser( Text )               the name trimmed, or null when it is not a usable name
//   Load( Folder )                  { Settings, Path, Lines }: the file filled, or the defaults when missing or unreadable
//   Write( Folder, Settings )       the file written whole (a temporary file renamed into place); the path

const FS = require( 'fs' );
const OS = require( 'os' );
const PATH = require( 'path' );

const FILE = 'sidecar.json';
const HOME_FOLDER = '.consensus';
const DARK_THEMES = [ 'dark', 'slate', 'solarized-dark', 'nord', 'midnight' ];
const THEMES = [ 'system', 'light', 'sepia', 'paper', 'solarized-light' ].concat( DARK_THEMES );
const SCALES = [ 'small', 'normal', 'large' ];
const USER_LIMIT = 60;


//---------------------------------------------------------------------

function Path( Folder )
{
	return PATH.join( PATH.resolve( String( Folder || '' ) ), HOME_FOLDER, FILE );
}


function DefaultUser()
{
	let user = 'user';
	try
	{
		user = OS.userInfo().username || user;
	}
	catch ( error )
	{
		user = 'user';
	}
	return ( user + '@' + OS.hostname() ).toLowerCase();
}


function Default()
{
	return {
		User: DefaultUser(),
		Theme: 'system',
		Scale: 'normal',
		Remembered: {},
	};
}


// A name: trimmed, one to USER_LIMIT characters, no control characters.
function CleanUser( Text )
{
	if ( typeof Text !== 'string' )
	{
		return null;
	}
	let name = Text.trim();
	if ( !name || name.length > USER_LIMIT || /[\u0000-\u001f\u007f]/.test( name ) )
	{
		return null;
	}
	return name;
}


function Fill( Settings )
{
	let settings = Default();
	let given = ( Settings && typeof Settings === 'object' && !Array.isArray( Settings ) ) ? Settings : {};
	let user = CleanUser( given.User );
	if ( user )
	{
		settings.User = user;
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


//---------------------------------------------------------------------

function Load( Folder )
{
	let path = Path( Folder );
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


function Write( Folder, Settings )
{
	let path = Path( Folder );
	FS.mkdirSync( PATH.dirname( path ), { recursive: true } );
	let temporary = path + '.' + process.pid + '.tmp';
	FS.writeFileSync( temporary, JSON.stringify( Fill( Settings ), null, '\t' ) + '\n' );
	FS.renameSync( temporary, path );
	return path;
}


module.exports = {
	FILE: FILE,
	THEMES: THEMES,
	DARK_THEMES: DARK_THEMES,
	SCALES: SCALES,
	USER_LIMIT: USER_LIMIT,
	Path: Path,
	DefaultUser: DefaultUser,
	Default: Default,
	Fill: Fill,
	CleanUser: CleanUser,
	Load: Load,
	Write: Write,
};
