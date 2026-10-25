'use strict';

// Settings - the desktop's own file, desktop.json, beside the Server Host's consensus.json in the machine's user folder
// (plan Rearchitecturation, Step 1; the desktop's fields lived in consensus.json from plan Run Shapes, Step 1, until
// then). The Desktop reads and writes this file and nothing else: consensus.json is the Host's to write, and the
// Desktop reads it for the LLM connections and the tasks (Step 4) without writing it.
//
//   {
//     "Recent": [ { "Path": "W:/code/tic-tac-toe", "Opened": "2026-10-25T10:00:00.000Z" } ],
//     "Hosts": [ { "Name": "cube4", "Url": "http://cube4:3500", "Project": null } ],
//     "Theme": "system", "Scale": "normal",
//     "Remembered": {}
//   }
//   Recent: the project folders opened, newest first. Hosts: one entry per Host project the Desktop has opened (Step 2
//   fills Project), in place of the saved servers of before; no tokens: a Host with Scope Local is reached from its own
//   machine, where a request is the owner, and any other Host is Public and signs the person in through Clerk (Step 6).
//   Remembered holds the page's view state by key ("consensus.<server address>.<name>" per server, "consensus.<name>"
//   shared: the open project, the folds, the tabs, the sort, the hidden panes, the widths), since the page's origin
//   changes port at every start and its localStorage would not survive a restart.

const FS = require( 'fs' );
const PATH = require( 'path' );

const FILE = 'desktop.json';
// The palettes (plan UI Tweaks IV), as theme.js names them; the dark ones set the native bars dark.
const THEMES = [ 'system', 'light', 'sepia', 'paper', 'solarized-light', 'dark', 'slate', 'solarized-dark', 'nord', 'midnight' ];
const DARK_THEMES = [ 'dark', 'slate', 'solarized-dark', 'nord', 'midnight' ];
const SCALES = [ 'small', 'normal', 'large' ];
const DESKTOP_FIELDS = [ 'Recent', 'Hosts', 'Theme', 'Scale', 'Remembered' ];
const RECENT_LIMIT = 20;


//---------------------------------------------------------------------
// Path: the file's path in a config folder.

function Path( Folder )
{
	return PATH.join( Folder, FILE );
}


//---------------------------------------------------------------------
// Default: the settings a new desktop starts with.

function Default()
{
	return {
		Recent: [],
		Hosts: [],
		Theme: 'system',
		Scale: 'normal',
		Remembered: {},
	};
}


//---------------------------------------------------------------------
// Fill: a settings object with every field present, in the desktop's shape; anything else is left out.

function Fill( Settings )
{
	let settings = Default();
	let given = ( Settings && typeof Settings === 'object' ) ? Settings : {};
	if ( Array.isArray( given.Recent ) )
	{
		settings.Recent = given.Recent.filter( function ( entry ) { return entry && typeof entry.Path === 'string' && entry.Path.trim(); } ).map( function ( entry )
		{
			return { Path: entry.Path.trim(), Opened: ( typeof entry.Opened === 'string' ) ? entry.Opened : null };
		} );
	}
	if ( Array.isArray( given.Hosts ) )
	{
		settings.Hosts = given.Hosts.map( function ( host )
		{
			let one = ( host && typeof host === 'object' ) ? host : {};
			return {
				Name: String( one.Name || '' ).trim(),
				Url: String( one.Url || '' ).trim().replace( /\/+$/, '' ),
				Project: ( typeof one.Project === 'string' && one.Project.trim() ) ? one.Project.trim() : null,
			};
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
// Opened: a project folder opened now, first in Recent (once; the list keeps the newest RECENT_LIMIT).

function Opened( Settings, Folder, Now )
{
	let path = String( Folder || '' ).trim();
	if ( !path )
	{
		return false;
	}
	let recent = Array.isArray( Settings.Recent ) ? Settings.Recent : [];
	Settings.Recent = [ { Path: path, Opened: Now || new Date().toISOString() } ].concat( recent.filter( function ( entry ) { return entry && entry.Path !== path; } ) ).slice( 0, RECENT_LIMIT );
	return true;
}


//---------------------------------------------------------------------
// Apply: the fields of Filled (Fill's shape) onto Settings, in place.

function Apply( Settings, Filled )
{
	for ( let field of DESKTOP_FIELDS )
	{
		Settings[ field ] = Filled[ field ];
	}
	return Settings;
}


//---------------------------------------------------------------------
// Read: the file in the desktop's shape, filled in; the defaults when there is no file.

function Read( Path_ )
{
	let read = {};
	if ( FS.existsSync( Path_ ) )
	{
		read = JSON.parse( FS.readFileSync( Path_, 'utf8' ) );
	}
	return Fill( read );
}


//---------------------------------------------------------------------
// Load: the desktop's settings from a config folder: { Settings, Path, Lines }, the lines saying where they came from.

function Load( Folder )
{
	let path = Path( Folder );
	let there = FS.existsSync( path );
	return {
		Settings: Read( path ),
		Path: path,
		Lines: [ there ? ( 'desktop settings from ' + path ) : ( 'desktop settings start with the defaults (' + path + ' is written at the first change)' ) ],
	};
}


//---------------------------------------------------------------------
// Write: the file in the desktop's shape, whole and atomic.

function Write( Path_, Settings )
{
	FS.mkdirSync( PATH.dirname( Path_ ), { recursive: true } );
	let temporary = Path_ + '.' + process.pid + '.tmp';
	FS.writeFileSync( temporary, JSON.stringify( Settings, null, '\t' ) + '\n' );
	FS.renameSync( temporary, Path_ );
}


//---------------------------------------------------------------------
// Problems: what is wrong with the settings, as sentences; none when they are usable.

function Problems( Settings )
{
	let problems = [];
	let names = new Set();
	for ( let host of Settings.Hosts || [] )
	{
		if ( !host.Name )
		{
			problems.push( 'a host has no Name' );
		}
		else if ( names.has( host.Name ) )
		{
			problems.push( 'host "' + host.Name + '" is named twice' );
		}
		names.add( host.Name );
		if ( !/^https?:\/\/\S+$/.test( host.Url || '' ) )
		{
			problems.push( 'host "' + ( host.Name || '?' ) + '": the Url must start with http:// or https://' );
		}
	}
	return problems;
}


//---------------------------------------------------------------------
// HostNamed: the saved host with that name, or null.

function HostNamed( Settings, Name )
{
	return ( Settings.Hosts || [] ).find( function ( host ) { return host.Name === Name; } ) || null;
}


module.exports = {
	FILE: FILE,
	THEMES: THEMES,
	DARK_THEMES: DARK_THEMES,
	SCALES: SCALES,
	DESKTOP_FIELDS: DESKTOP_FIELDS,
	RECENT_LIMIT: RECENT_LIMIT,
	Path: Path,
	Default: Default,
	Fill: Fill,
	Remember: Remember,
	Opened: Opened,
	Apply: Apply,
	Read: Read,
	Load: Load,
	Write: Write,
	Problems: Problems,
	HostNamed: HostNamed,
};
