'use strict';

// Settings - Sidecar's settings for a project (plan Sidecar Edition, Step 2): <project>/.consensus/sidecar.json, read
// and written by Sidecar alone. Sidecar has nothing to do with the Server or the global config folder: a missing file
// is the defaults, and nothing is carried over from Desktop's or the Server's files. The file is written when a value
// changes; the page remembers the open project as it loads, so the file appears soon after a project is first opened.
// Since plan Review 2026-10-29, Step 2, the file's reading, writing and look lists are electron/Settings.js's; this
// module keeps what is Sidecar's own.
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
//   Remember( Settings, Key, Value ) a remembered value set (null or undefined removes it); whether it changed
//   Load( Folder )                  { Settings, Path, Lines }: the file filled, or the defaults when missing or unreadable
//   Write( Folder, Settings )       the file written whole (a temporary file renamed into place); the path

const OS = require( 'os' );
const BASE = require( '../electron/Settings.js' );

const FILE = 'sidecar.json';
const HOME_FOLDER = '.consensus';
const USER_LIMIT = 60;


//---------------------------------------------------------------------

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
	return BASE.FillLook( given, settings );
}


//---------------------------------------------------------------------

const FILE_BASE = BASE.Make( { File: HOME_FOLDER + '/' + FILE, Label: 'settings', Default: Default, Fill: Fill } );


module.exports = {
	FILE: FILE,
	THEMES: BASE.THEMES,
	DARK_THEMES: BASE.DARK_THEMES,
	SCALES: BASE.SCALES,
	USER_LIMIT: USER_LIMIT,
	Path: FILE_BASE.Path,
	DefaultUser: DefaultUser,
	Default: Default,
	Fill: Fill,
	CleanUser: CleanUser,
	Remember: BASE.Remember,
	Load: FILE_BASE.Load,
	Write: FILE_BASE.Write,
};
