'use strict';

// Settings - the base of the applications' settings modules (plan Review 2026-10-29, Step 2: desktop/Settings.js,
// sidecar/Settings.js and client/Settings.js grew by copying; what they share is here, each keeping its own Default,
// its Fill of its own fields and its own functions). A settings file is JSON in a folder, read filled in (every field
// present and usable, anything else left out), written whole and atomic (src/Atomic.js), and a missing or unreadable
// file is the defaults, said in a line the app prints. The look lists are defined here once, for every app; the page's
// theme.js names the same palettes, and a test keeps the two equal.
//
//   THEMES, DARK_THEMES, SCALES       the look: the palettes theme.js names, the dark ones, the three scales
//   FillLook( Given, Settings )       Theme, Scale and Remembered of Given taken into Settings when usable
//   Remember( Settings, Key, Value )  a value under Key in Remembered (a deep copy; null or undefined forgets it; the key
//                                     capped at KEY_LIMIT characters); whether anything changed
//   Make( { File, Label, Default, Fill } )   a settings module's base:
//     Path( Folder )                  <folder>/<File>
//     Load( Folder )                  { Settings, Path, Lines }: the file filled, or the defaults when missing or unreadable
//     Write( Folder, Settings )       the file written whole, filled; the path
//   File may hold a folder ('.consensus/sidecar.json'); Label names the settings in Load's lines ('desktop settings');
//   Default() answers the settings an app starts with; Fill( Given ) answers them filled from what was read.

const FS = require( 'fs' );
const PATH = require( 'path' );
const ATOMIC = require( '../src/Atomic.js' );

// The palettes (plan UI Tweaks IV), as public/js/theme.js names them; the dark ones set the native bars dark.
const DARK_THEMES = [ 'dark', 'slate', 'solarized-dark', 'nord', 'midnight' ];
const THEMES = [ 'system', 'light', 'sepia', 'paper', 'solarized-light' ].concat( DARK_THEMES );
const SCALES = [ 'small', 'normal', 'large' ];
const KEY_LIMIT = 512;


//---------------------------------------------------------------------

function FillLook( Given, Settings )
{
	let given = ( Given && typeof Given === 'object' && !Array.isArray( Given ) ) ? Given : {};
	if ( THEMES.includes( given.Theme ) )
	{
		Settings.Theme = given.Theme;
	}
	if ( SCALES.includes( given.Scale ) )
	{
		Settings.Scale = given.Scale;
	}
	if ( given.Remembered && typeof given.Remembered === 'object' && !Array.isArray( given.Remembered ) )
	{
		Settings.Remembered = JSON.parse( JSON.stringify( given.Remembered ) );
	}
	return Settings;
}


function Remember( Settings, Key, Value )
{
	if ( !Settings || typeof Key !== 'string' || !Key || Key.length > KEY_LIMIT )
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

function Make( Fields )
{
	let fields = Fields || {};
	let file = String( fields.File || 'settings.json' );
	let label = String( fields.Label || 'settings' );
	let name = PATH.basename( file );


	function Path( Folder )
	{
		return PATH.join( PATH.resolve( String( Folder || '' ) ), file );
	}


	function Load( Folder )
	{
		let path = Path( Folder );
		if ( !FS.existsSync( path ) )
		{
			return { Settings: fields.Default(), Path: path, Lines: [ label + ' start with the defaults (' + path + ' is written at the first change)' ] };
		}
		let read = null;
		try
		{
			read = JSON.parse( FS.readFileSync( path, 'utf8' ) );
		}
		catch ( error )
		{
			return { Settings: fields.Default(), Path: path, Lines: [ name + ' could not be read (' + error.message + '): the defaults, and the file is left as it is until a setting changes' ] };
		}
		return { Settings: fields.Fill( read ), Path: path, Lines: [ label + ' from ' + path ] };
	}


	function Write( Folder, Settings )
	{
		return ATOMIC.WriteJson( Path( Folder ), fields.Fill( Settings ) );
	}


	return { Path: Path, Load: Load, Write: Write };
}


module.exports = {
	THEMES: THEMES,
	DARK_THEMES: DARK_THEMES,
	SCALES: SCALES,
	KEY_LIMIT: KEY_LIMIT,
	FillLook: FillLook,
	Remember: Remember,
	Make: Make,
};
