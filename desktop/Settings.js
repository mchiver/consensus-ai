'use strict';

// Settings - the desktop's desktop.json (plan Consensus Desktop, Step 2): the saved servers, the local server's data
// folder and port, what was open last, the theme and scale the desktop applies to the page it hosts, and (Step 3)
// the LLM connections, kept once per desktop, and the workspaces, each with the project it is attached to.
//
//   {
//     "Servers": [ { "Name": "cube4", "Url": "http://cube4:3500", "Theme": null } ],
//     "Local": { "Data": "W:/code/consensus.git/~data", "Port": 3500, "Theme": null },
//     "Last": { "Kind": "server", "Name": "cube4" } | { "Kind": "local" } | null,
//     "Theme": "system", "Scale": "normal",
//     "Llms": [ { "Id": "llm-…", "Name": "Claude", "Kind": "claude-cli", "Command": "claude", "Arguments": [ "-p", … ],
//                "Url": "", "Model": "sonnet", "Timeout": 300, "Context": 32768, "Rounds": 30,
//                "Checks": { "Instructions": true, "Readme": true, "Documents": true, "Threads": true },
//                "Unchecked": { "Documents": [ "doc-…" ], "Threads": [ "thr-…" ] },
//                "Prompts": { "Review": "…", "Build": "…", "Session": "" } } ],
//     "Workspaces": [ { "Id": "wks-…", "Name": "consensus", "Project": "default", "Path": "W:/code/consensus.git",
//                       "Include": [], "Exclude": [ "~*/**", "node_modules/**", ".git/**" ], "Commands": [ "npm test" ] } ]
//   }
//   Step 4: Context (the model's window, Ollama's num_ctx) and Rounds (the most tool rounds a run takes) on an ollama
//   connection; Commands (the command lines a run may execute, none by default) on a workspace.
//   Plan UI Tweaks V: Theme is the default; a server (or Local) with a Theme of its own shows in it (ThemeFor), set by
//   the page's picker while connected; the connect screen's picker sets the default. Remembered holds the page's
//   view state by key ("consensus.<server address>.<name>" per server, "consensus.<name>" shared: the open project,
//   the folds, the tabs, the sort, the hidden panes, the widths), since the page's origin changes port at every
//   start and its localStorage would not survive a restart.

const FS = require( 'fs' );
const PATH = require( 'path' );
const CRYPTO = require( 'crypto' );
const PACKAGE = require( './Package.js' );

// The palettes (plan UI Tweaks IV), as theme.js names them; the dark ones set the native bars dark.
const THEMES = [ 'system', 'light', 'sepia', 'paper', 'solarized-light', 'dark', 'slate', 'solarized-dark', 'nord', 'midnight' ];
const DARK_THEMES = [ 'dark', 'slate', 'solarized-dark', 'nord', 'midnight' ];
const SCALES = [ 'small', 'normal', 'large' ];
const KINDS = [ 'claude-cli', 'ollama' ];
const DEFAULT_COMMAND = 'claude';
const DEFAULT_ARGUMENTS = [ '-p', '--output-format', 'text', '--allowedTools', 'Bash,Read,Edit,Write,Glob,Grep,MultiEdit,WebFetch' ];
const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
const DEFAULT_TIMEOUT = 300;
const DEFAULT_CONTEXT = 32768;
const DEFAULT_ROUNDS = 30;
const SHELL_OPERATORS = /[|&;<>$`()]/;
const DEFAULT_EXCLUDE = [ '~*/**', 'node_modules/**', '.git/**' ];
const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';


//---------------------------------------------------------------------
// Default: the settings a new desktop starts with.

function Default()
{
	return {
		Servers: [],
		Local: { Data: '', Port: null, Theme: null },
		Last: null,
		Theme: 'system',
		Scale: 'normal',
		Llms: [],
		Workspaces: [],
		Remembered: {},
	};
}


//---------------------------------------------------------------------
// NewId( 'llm' | 'wks' ): an id in the server's shape, "<prefix>-xxx-xxx-xxx", from the crypto source.

function NewId( Prefix )
{
	let bytes = CRYPTO.randomBytes( 9 );
	let letters = '';
	for ( let byte of bytes )
	{
		letters += ID_ALPHABET[ byte % ID_ALPHABET.length ];
	}
	return Prefix + '-' + letters.slice( 0, 3 ) + '-' + letters.slice( 3, 6 ) + '-' + letters.slice( 6, 9 );
}


function text_of( value, fallback )
{
	return ( value === undefined || value === null ) ? ( fallback || '' ) : String( value ).trim();
}


function lines_of( value, fallback )
{
	if ( Array.isArray( value ) )
	{
		return value.map( function ( line ) { return String( line ).trim(); } ).filter( function ( line ) { return line; } );
	}
	if ( typeof value === 'string' )
	{
		return lines_of( value.split( /\r?\n/ ) );
	}
	return ( fallback || [] ).slice();
}


//---------------------------------------------------------------------
// FillLlm: one LLM connection with every field present.

function FillLlm( Llm )
{
	let given = ( Llm && typeof Llm === 'object' ) ? Llm : {};
	let kind = KINDS.includes( given.Kind ) ? given.Kind : KINDS[ 0 ];
	let checks = {};
	for ( let item of PACKAGE.CHECK_ITEMS )
	{
		checks[ item ] = ( given.Checks && given.Checks[ item ] !== undefined ) ? !!given.Checks[ item ] : PACKAGE.DEFAULT_CHECKS[ item ];
	}
	let prompts = {};
	for ( let name of Object.keys( PACKAGE.DEFAULT_PROMPTS ) )
	{
		prompts[ name ] = ( given.Prompts && typeof given.Prompts[ name ] === 'string' ) ? given.Prompts[ name ] : PACKAGE.DEFAULT_PROMPTS[ name ];
	}
	let timeout = Number( given.Timeout );
	let context = Number( given.Context );
	let rounds = Number( given.Rounds );
	let unchecked = ( given.Unchecked && typeof given.Unchecked === 'object' ) ? given.Unchecked : {};
	return {
		Id: text_of( given.Id ) || NewId( 'llm' ),
		Name: text_of( given.Name ),
		Kind: kind,
		Command: text_of( given.Command ) || DEFAULT_COMMAND,
		Arguments: Array.isArray( given.Arguments ) ? given.Arguments.map( function ( argument ) { return String( argument ); } ) : DEFAULT_ARGUMENTS.slice(),
		Url: text_of( given.Url ) || ( ( kind === 'ollama' ) ? DEFAULT_OLLAMA_URL : '' ),
		Model: text_of( given.Model ),
		Timeout: ( Number.isFinite( timeout ) && timeout > 0 ) ? Math.round( timeout ) : DEFAULT_TIMEOUT,
		Context: ( Number.isFinite( context ) && context > 0 ) ? Math.round( context ) : DEFAULT_CONTEXT,
		Rounds: ( Number.isFinite( rounds ) && rounds > 0 ) ? Math.round( rounds ) : DEFAULT_ROUNDS,
		Checks: checks,
		Prompts: prompts,
		Unchecked: { Documents: lines_of( unchecked.Documents, [] ), Threads: lines_of( unchecked.Threads, [] ) },
	};
}


//---------------------------------------------------------------------
// FillWorkspace: one workspace with every field present.

function FillWorkspace( Workspace )
{
	let given = ( Workspace && typeof Workspace === 'object' ) ? Workspace : {};
	return {
		Id: text_of( given.Id ) || NewId( 'wks' ),
		Name: text_of( given.Name ),
		Project: text_of( given.Project ),
		Path: text_of( given.Path ).replace( /\\/g, '/' ).replace( /\/+$/, '' ),
		Include: lines_of( given.Include, [] ),
		Exclude: lines_of( given.Exclude, ( given.Exclude === undefined ) ? DEFAULT_EXCLUDE : [] ),
		Commands: lines_of( given.Commands, [] ),
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
		settings.Local = { Data: String( given.Local.Data || '' ), Port: Number.isInteger( given.Local.Port ) ? given.Local.Port : null, Theme: theme_or_null( given.Local.Theme ) };
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
	if ( Array.isArray( given.Llms ) )
	{
		settings.Llms = given.Llms.map( FillLlm );
	}
	if ( Array.isArray( given.Workspaces ) )
	{
		settings.Workspaces = given.Workspaces.map( FillWorkspace );
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
// Read: desktop.json, filled in; the defaults when there is no file.

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
	let llm_names = new Set();
	for ( let llm of Settings.Llms || [] )
	{
		let what = 'LLM connection "' + ( llm.Name || '?' ) + '"';
		if ( !llm.Name )
		{
			problems.push( 'an LLM connection has no Name' );
		}
		else if ( llm_names.has( llm.Name ) )
		{
			problems.push( what + ' is named twice' );
		}
		llm_names.add( llm.Name );
		if ( !KINDS.includes( llm.Kind ) )
		{
			problems.push( what + ': the Kind is "' + llm.Kind + '", not one of ' + KINDS.join( ', ' ) );
		}
		if ( llm.Kind === 'claude-cli' && !llm.Command )
		{
			problems.push( what + ': a Command is needed' );
		}
		if ( llm.Kind === 'ollama' && !/^https?:\/\/\S+$/.test( llm.Url || '' ) )
		{
			problems.push( what + ': the Url must start with http:// or https://' );
		}
		if ( llm.Kind === 'ollama' && !llm.Model )
		{
			problems.push( what + ': a Model is needed' );
		}
	}
	let workspace_names = new Set();
	for ( let workspace of Settings.Workspaces || [] )
	{
		let what = 'workspace "' + ( workspace.Name || '?' ) + '"';
		let key = workspace.Project + '/' + workspace.Name;
		if ( !workspace.Name )
		{
			problems.push( 'a workspace has no Name' );
		}
		else if ( workspace_names.has( key ) )
		{
			problems.push( what + ' is named twice in its project' );
		}
		workspace_names.add( key );
		if ( !workspace.Project )
		{
			problems.push( what + ' is attached to no project' );
		}
		if ( !workspace.Path )
		{
			problems.push( what + ' has no Path' );
		}
		for ( let command of workspace.Commands || [] )
		{
			if ( SHELL_OPERATORS.test( command ) )
			{
				problems.push( what + ': the command "' + command + '" chains, pipes, redirects or substitutes; one plain command per line' );
			}
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


// LlmById, WorkspaceById: the item with that id, or null.
function LlmById( Settings, Id )
{
	return ( Settings.Llms || [] ).find( function ( llm ) { return llm.Id === Id; } ) || null;
}


function WorkspaceById( Settings, Id )
{
	return ( Settings.Workspaces || [] ).find( function ( workspace ) { return workspace.Id === Id; } ) || null;
}


module.exports = {
	THEMES: THEMES,
	DARK_THEMES: DARK_THEMES,
	ThemeFor: ThemeFor,
	SetThemeFor: SetThemeFor,
	Remember: Remember,
	SCALES: SCALES,
	KINDS: KINDS,
	DEFAULT_COMMAND: DEFAULT_COMMAND,
	DEFAULT_ARGUMENTS: DEFAULT_ARGUMENTS,
	DEFAULT_OLLAMA_URL: DEFAULT_OLLAMA_URL,
	DEFAULT_TIMEOUT: DEFAULT_TIMEOUT,
	DEFAULT_CONTEXT: DEFAULT_CONTEXT,
	DEFAULT_ROUNDS: DEFAULT_ROUNDS,
	DEFAULT_EXCLUDE: DEFAULT_EXCLUDE,
	Default: Default,
	NewId: NewId,
	FillLlm: FillLlm,
	FillWorkspace: FillWorkspace,
	Fill: Fill,
	Read: Read,
	Write: Write,
	Problems: Problems,
	ServerNamed: ServerNamed,
	LlmById: LlmById,
	WorkspaceById: WorkspaceById,
};
