'use strict';

// Settings - the desktop's own file, desktop.json, beside the Server's consensus.json in the machine's user folder
// (plan Rearchitecturation, Step 1; the desktop's fields lived in consensus.json from plan Run Shapes, Step 1, until
// then). The Desktop reads and writes this file and nothing else: consensus.json is the Host's to write, and the
// Desktop reads it for the LLM connections and the tasks (Step 4) without writing it. Since plan Review 2026-10-29,
// Step 2, the file's reading, writing and look lists are electron/Settings.js's; this module keeps what is the
// Desktop's own.
//
//   {
//     "Recent": [ { "Path": "W:/code/tic-tac-toe", "Opened": "2026-10-25T10:00:00.000Z" } ],
//     "Hosts": [ { "Name": "cube4", "Url": "http://cube4:3500", "Project": "prj-aaa-bbb-ccc", "Title": "Test" } ],
//     "Theme": "system", "Scale": "normal",
//     "Remembered": {}
//   }
//   The sign-in is not here (plan The Server, Step 1): it is the machine's current user, <config>/user.json
//   (src/License.js), shared with the Server; a License field of an older file is dropped at the next save.
//   Recent: the project folders opened, newest first. Hosts: one entry per Host project the Desktop has opened (Step 2:
//   Project the project's id and Title its name as last seen; an entry with no Project is a Host saved before a project
//   was picked), in place of the saved servers of before; no tokens: a Host with Scope Local is reached from its own
//   machine, where a request is the owner, and any other Host is Public and signs the person in through Clerk (Step 6).
//   Remembered holds the page's view state by key ("consensus.<key>.<name>" per project, the key being the folder or the
//   Host's address and the project id, "consensus.<name>" shared: the open item, the folds, the tabs, the sort, the
//   hidden panes, the widths), since the page's origin changes port at every start and its localStorage would not
//   survive a restart.
//
//   FILE, THEMES, DARK_THEMES, SCALES, DESKTOP_FIELDS, RECENT_LIMIT
//   Path( Folder )                  <folder>/desktop.json
//   Default()                       the settings a new desktop starts with
//   Fill( Settings )                every field present in the desktop's shape; anything else left out
//   Remember( Settings, Key, Value ) a remembered value set (null or undefined removes it); whether it changed
//   Opened( Settings, Folder, Now ) a project folder opened now, first in Recent
//   Apply( Settings, Filled )       the fields of Filled onto Settings, in place
//   Read( Path )                    the file at that path filled, the defaults when there is none; throws when unreadable
//   Load( Folder )                  { Settings, Path, Lines }: the file filled, or the defaults when missing or unreadable
//   Write( Path, Settings )         the file at that path written whole and atomic
//   Problems( Settings )            what is wrong with the settings, as sentences
//   HostNamed( Settings, Name )     the first saved Host entry with that name, or null
//   HostEntry( Settings, Name, Project )   the entry of that name and project, or null

const FS = require( 'fs' );
const BASE = require( '../electron/Settings.js' );
const ATOMIC = require( '../src/Atomic.js' );

const FILE = 'desktop.json';
const DESKTOP_FIELDS = [ 'Recent', 'Hosts', 'Theme', 'Scale', 'Remembered' ];
const RECENT_LIMIT = 20;


//---------------------------------------------------------------------

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
				Title: ( typeof one.Title === 'string' && one.Title.trim() ) ? one.Title.trim() : null,
			};
		} );
	}
	return BASE.FillLook( given, settings );
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
// The file: Read and Write take the file's path (the Desktop keeps it from Load); Path, Load over the folder are the base's.

const FILE_BASE = BASE.Make( { File: FILE, Label: 'desktop settings', Default: Default, Fill: Fill } );


function Read( Path_ )
{
	let read = {};
	if ( FS.existsSync( Path_ ) )
	{
		read = JSON.parse( FS.readFileSync( Path_, 'utf8' ) );
	}
	return Fill( read );
}


function Write( Path_, Settings )
{
	ATOMIC.WriteJson( Path_, Settings );
}


//---------------------------------------------------------------------
// Problems: what is wrong with the settings, as sentences; none when they are usable. A Host project is named once:
// the Name and the Project together.

function Problems( Settings )
{
	let problems = [];
	let seen = new Set();
	for ( let host of Settings.Hosts || [] )
	{
		let pair = host.Name + '/' + ( host.Project || '' );
		if ( !host.Name )
		{
			problems.push( 'a host has no Name' );
		}
		else if ( seen.has( pair ) )
		{
			problems.push( 'host "' + host.Name + '"' + ( host.Project ? ' with the project ' + host.Project : '' ) + ' is listed twice' );
		}
		seen.add( pair );
		if ( !/^https?:\/\/\S+$/.test( host.Url || '' ) )
		{
			problems.push( 'host "' + ( host.Name || '?' ) + '": the Url must start with http:// or https://' );
		}
	}
	return problems;
}


//---------------------------------------------------------------------
// HostNamed: the first saved Host entry with that name, or null; HostEntry: the entry of that name and project.

function HostNamed( Settings, Name )
{
	return ( Settings.Hosts || [] ).find( function ( host ) { return host.Name === Name; } ) || null;
}


function HostEntry( Settings, Name, Project )
{
	return ( Settings.Hosts || [] ).find( function ( host ) { return host.Name === Name && ( host.Project || null ) === ( Project || null ); } ) || null;
}


module.exports = {
	FILE: FILE,
	THEMES: BASE.THEMES,
	DARK_THEMES: BASE.DARK_THEMES,
	SCALES: BASE.SCALES,
	DESKTOP_FIELDS: DESKTOP_FIELDS,
	RECENT_LIMIT: RECENT_LIMIT,
	Path: FILE_BASE.Path,
	Default: Default,
	Fill: Fill,
	Remember: BASE.Remember,
	Opened: Opened,
	Apply: Apply,
	Read: Read,
	Load: FILE_BASE.Load,
	Write: Write,
	Problems: Problems,
	HostNamed: HostNamed,
	HostEntry: HostEntry,
};
