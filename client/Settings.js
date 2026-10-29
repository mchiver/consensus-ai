'use strict';

// Settings - the Client's settings (plan Client Edition, Step 1): client.json in the global config folder
// (<user>/.consensus unless --config names another), beside desktop.json and consensus.json, read and written by the
// Client alone. A missing file is the defaults; nothing is carried over from desktop.json's saved Servers. The file is
// written when a value changes. Since plan Review 2026-10-29, Step 2, the file's reading, writing and look lists are
// electron/Settings.js's and the Servers functions electron/Servers.js's; this module keeps what is the Client's own.
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
//   FILE, THEMES, DARK_THEMES, SCALES
//   Path( Config )                  <config>/client.json
//   Default()                       the settings the Client starts with
//   Fill( Settings )                every field present and usable; anything else left out (a Server twice by name: the first)
//   Remember( Settings, Key, Value ) a remembered value set (null or undefined removes it); whether it changed
//   Load( Config )                  { Settings, Path, Lines }: the file filled, or the defaults when missing or unreadable
//   Write( Config, Settings )       the file written whole (a temporary file renamed into place); the path

const BASE = require( '../electron/Settings.js' );
const SERVERS = require( '../electron/Servers.js' );

const FILE = 'client.json';


//---------------------------------------------------------------------

function Default()
{
	return {
		Servers: [],
		Theme: 'system',
		Scale: 'normal',
		Remembered: {},
	};
}


function Fill( Settings )
{
	let settings = Default();
	let given = ( Settings && typeof Settings === 'object' && !Array.isArray( Settings ) ) ? Settings : {};
	settings.Servers = SERVERS.Fill( given.Servers );
	return BASE.FillLook( given, settings );
}


//---------------------------------------------------------------------

const FILE_BASE = BASE.Make( { File: FILE, Label: 'settings', Default: Default, Fill: Fill } );


module.exports = {
	FILE: FILE,
	THEMES: BASE.THEMES,
	DARK_THEMES: BASE.DARK_THEMES,
	SCALES: BASE.SCALES,
	Path: FILE_BASE.Path,
	Default: Default,
	Fill: Fill,
	Remember: BASE.Remember,
	Load: FILE_BASE.Load,
	Write: FILE_BASE.Write,
};
