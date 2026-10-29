'use strict';

// Settings - the Server application's window settings (plan Review 2026-10-29, Step 3): <config>/server.json, beside
// desktop.json and client.json, read and written by the Server application's window alone: the look and the page's
// remembered state, and the page server's port (page-port). Nothing of it is read by the server itself, whose own file
// is consensus.json (src/Store.js); a headless Server never touches it. Over electron/Settings.js.
//
//   {
//     "Theme": "system", "Scale": "normal",
//     "Remembered": {}
//   }
//
//   FILE, THEMES, DARK_THEMES, SCALES
//   Path( Config )                  <config>/server.json
//   Default()                       the settings the window starts with
//   Fill( Settings )                every field present and usable; anything else left out
//   Remember( Settings, Key, Value ) a remembered value set (null or undefined removes it); whether it changed
//   Load( Config )                  { Settings, Path, Lines }: the file filled, or the defaults when missing or unreadable
//   Write( Config, Settings )       the file written whole (a temporary file renamed into place); the path

const BASE = require( '../electron/Settings.js' );

const FILE = 'server.json';


function Default()
{
	return {
		Theme: 'system',
		Scale: 'normal',
		Remembered: {},
	};
}


function Fill( Settings )
{
	return BASE.FillLook( Settings, Default() );
}


const FILE_BASE = BASE.Make( { File: FILE, Label: 'server settings', Default: Default, Fill: Fill } );


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
