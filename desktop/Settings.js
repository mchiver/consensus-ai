'use strict';

// Settings - the desktop's fields of the global config (plan Run Shapes, Step 1: consensus.json in the config folder,
// shared with the server's Name, Port, Scope, States and Participants; desktop.json before, moved in once by MoveIn):
// the saved servers, what was open last, the theme and scale the desktop applies to the page it hosts. The LLM
// connections and the workspaces the desktop kept (plan Consensus Desktop, Step 3) are the server's since plan Run
// Shapes, Step 3 (src/Llms.js; a workspace's lists went into its project): MoveIn carries them from desktop.json once.
//
//   {
//     "Servers": [ { "Name": "cube4", "Url": "http://cube4:3500", "Theme": null } ],
//     "Local": { "Theme": null },                 this machine's server (the config's own) and its theme
//     "Last": { "Kind": "server", "Name": "cube4" } | { "Kind": "local" } | null,
//     "Theme": "system", "Scale": "normal",
//   }
//   Plan UI Tweaks V: Theme is the default; a server (or Local) with a Theme of its own shows in it (ThemeFor), set by
//   the page's picker while connected; the connect screen's picker sets the default. Remembered holds the page's
//   view state by key ("consensus.<server address>.<name>" per server, "consensus.<name>" shared: the open project,
//   the folds, the tabs, the sort, the hidden panes, the widths), since the page's origin changes port at every
//   start and its localStorage would not survive a restart.

const FS = require( 'fs' );
const PATH = require( 'path' );
const LLMS = require( '../src/Llms.js' );

// The palettes (plan UI Tweaks IV), as theme.js names them; the dark ones set the native bars dark.
const THEMES = [ 'system', 'light', 'sepia', 'paper', 'solarized-light', 'dark', 'slate', 'solarized-dark', 'nord', 'midnight' ];
const DARK_THEMES = [ 'dark', 'slate', 'solarized-dark', 'nord', 'midnight' ];
const SCALES = [ 'small', 'normal', 'large' ];
const DESKTOP_FIELDS = [ 'Servers', 'Local', 'Last', 'Theme', 'Scale', 'Remembered' ];


//---------------------------------------------------------------------
// Default: the settings a new desktop starts with.

function Default()
{
	return {
		Servers: [],
		Local: { Theme: null },
		Last: null,
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
			return { Name: String( one.Name || '' ).trim(), Url: String( one.Url || '' ).trim().replace( /\/+$/, '' ), Theme: theme_or_null( one.Theme ) };
		} );
	}
	if ( given.Local && typeof given.Local === 'object' )
	{
		settings.Local = { Theme: theme_or_null( given.Local.Theme ) };
	}
	if ( given.Last && typeof given.Last === 'object' && ( given.Last.Kind === 'server' || given.Last.Kind === 'local' ) )
	{
		settings.Last = { Kind: given.Last.Kind };
		if ( given.Last.Kind === 'server' )
		{
			settings.Last.Name = String( given.Last.Name || '' );
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


// A server's own theme: one of the palettes, or null for the default.
function theme_or_null( Theme )
{
	return THEMES.includes( Theme ) ? Theme : null;
}


//---------------------------------------------------------------------
// ThemeFor: the theme the page shows for what is connected (Current: { Kind: 'server', Name } | { Kind: 'local' } |
// null): the server's own when it has one, else the default. SetThemeFor: sets that server's own theme (or the
// default when nothing is connected).

function ThemeFor( Settings, Current )
{
	let own = null;
	if ( Current && Current.Kind === 'local' )
	{
		own = Settings.Local ? Settings.Local.Theme : null;
	}
	else if ( Current && Current.Kind === 'server' )
	{
		let server = ServerNamed( Settings, Current.Name );
		own = server ? server.Theme : null;
	}
	return own || Settings.Theme;
}


function SetThemeFor( Settings, Current, Theme )
{
	if ( !THEMES.includes( Theme ) )
	{
		return;
	}
	if ( Current && Current.Kind === 'local' )
	{
		Settings.Local.Theme = Theme;
		return;
	}
	if ( Current && Current.Kind === 'server' )
	{
		let server = ServerNamed( Settings, Current.Name );
		if ( server )
		{
			server.Theme = Theme;
			return;
		}
	}
	Settings.Theme = Theme;
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
// MoveIn: the desktop's fields into the global config, once: a config with no Servers yet takes them from desktop.json
// at Path when the file exists (renamed .moved afterwards), else from the defaults. Returns the lines to log. A
// config that has its Servers already keeps them, and any of the desktop's fields it lacks (a file written by hand)
// is filled in with its default. The LLM connections desktop.json held become the server's (its Llms, when it has
// none yet), and its workspaces are handed to the server's migration (Settings.Workspaces, into their projects).

function MoveIn( Settings, Path )
{
	if ( Array.isArray( Settings.Servers ) )
	{
		let missing = DESKTOP_FIELDS.filter( function ( field ) { return Settings[ field ] === undefined; } );
		Apply( Settings, Fill( Settings ) );
		return missing.length ? [ 'the desktop\'s settings filled in: ' + missing.join( ', ' ) ] : [];
	}
	let lines = [];
	let from = {};
	if ( Path && FS.existsSync( Path ) )
	{
		from = JSON.parse( FS.readFileSync( Path, 'utf8' ) );
		FS.renameSync( Path, Path + '.moved' );
		lines.push( 'desktop.json moved into the config: ' + Path );
		if ( Array.isArray( from.Llms ) && from.Llms.length && !( Array.isArray( Settings.Llms ) && Settings.Llms.length ) )
		{
			Settings.Llms = from.Llms.map( LLMS.Fill );
			lines.push( Settings.Llms.length + ' LLM connection(s) moved in from desktop.json, each a participant of this server now' );
		}
		if ( Array.isArray( from.Workspaces ) && from.Workspaces.length )
		{
			Settings.Workspaces = ( Array.isArray( Settings.Workspaces ) ? Settings.Workspaces : [] ).concat( from.Workspaces );
			lines.push( from.Workspaces.length + ' workspace(s) moved in from desktop.json, to go into their projects' );
		}
	}
	else
	{
		lines.push( 'the desktop\'s settings start with the defaults' );
	}
	Apply( Settings, Fill( from ) );
	return lines;
}


//---------------------------------------------------------------------
// Read: a file in the desktop's shape (desktop.json), filled in; the defaults when there is no file.

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
// Write: desktop.json, whole and atomic.

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
	ThemeFor: ThemeFor,
	SetThemeFor: SetThemeFor,
	Remember: Remember,
	SCALES: SCALES,
	DESKTOP_FIELDS: DESKTOP_FIELDS,
	Default: Default,
	Fill: Fill,
	Apply: Apply,
	MoveIn: MoveIn,
	Read: Read,
	Write: Write,
	Problems: Problems,
	ServerNamed: ServerNamed,
};
