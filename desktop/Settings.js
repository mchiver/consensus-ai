'use strict';

// Settings - the desktop's desktop.json (plan Consensus Desktop, Step 2): the saved servers, the local server's data
// folder and port, what was open last, and the theme and scale the desktop applies to the page it hosts.
//
//   {
//     "Servers": [ { "Name": "cube4", "Url": "http://cube4:3500" } ],
//     "Local": { "Data": "W:/code/consensus.git/~data", "Port": 3500 },
//     "Last": { "Kind": "server", "Name": "cube4" } | { "Kind": "local" } | null,
//     "Theme": "system", "Scale": "normal"
//   }

const FS = require( 'fs' );
const PATH = require( 'path' );

const THEMES = [ 'light', 'dark', 'system' ];
const SCALES = [ 'small', 'normal', 'large' ];


//---------------------------------------------------------------------
// Default: the settings a new desktop starts with.

function Default()
{
	return {
		Servers: [],
		Local: { Data: '', Port: null },
		Last: null,
		Theme: 'system',
		Scale: 'normal',
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
			return { Name: String( one.Name || '' ).trim(), Url: String( one.Url || '' ).trim().replace( /\/+$/, '' ) };
		} );
	}
	if ( given.Local && typeof given.Local === 'object' )
	{
		settings.Local = { Data: String( given.Local.Data || '' ), Port: Number.isInteger( given.Local.Port ) ? given.Local.Port : null };
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
	return settings;
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
	SCALES: SCALES,
	Default: Default,
	Fill: Fill,
	Read: Read,
	Write: Write,
	Problems: Problems,
	ServerNamed: ServerNamed,
};
