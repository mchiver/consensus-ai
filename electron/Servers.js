'use strict';

// Servers - the saved Servers an application connects to (plan Client Edition, Step 2; taken out of client/Settings.js
// by plan Review 2026-10-29, Step 2; since Step 5.1, the editions cut, the Desktop's list and the Client's, which
// keeps each Server's last project). Each is a name, the root's key on the page and the /servers/<name> route of the
// page server, and an address; the Client's entries carry Project (the last project's id) and Title (its name as
// last seen) as well; no token is kept here. The functions work on a settings object's Servers list in place and
// answer { Server } or { Error }; nothing here asks a Server anything (the app probes it first, src/Probe.js).
//
//   NAME_LIMIT                        60 characters
//   CleanName( Text )                 a Server's name trimmed, or null when it is not a usable name
//   CleanUrl( Text )                  a Server's address without its trailing slashes, or null when it is not http(s)
//   Fill( List )                      the usable entries of a list, { Name, Url } each, with Project and Title when the
//                                     entry carries them; a name taken twice kept once
//   Named( Settings, Name )           the Server of that name, whatever its case, or null
//   UniqueName( Settings, Name )      the name, or the name with " 2", " 3" and on when it is taken
//   AddServer( Settings, { Url, Name?, Project?, Title? } )   added under its name (the address's host when none), once per address
//   RenameServer( Settings, Name, To )
//   RemoveServer( Settings, Name )
//   SetProject( Settings, Name, Project, Title )   the Server's last project (null forgets it); { Server } or { Error }

const NAME_LIMIT = 60;


// A Server's name: trimmed, one to NAME_LIMIT characters, no control characters and no slashes (it keys the page's
// /servers/<name> route).
function CleanName( Text )
{
	if ( typeof Text !== 'string' )
	{
		return null;
	}
	let name = Text.trim();
	if ( !name || name.length > NAME_LIMIT || /[\u0000-\u001f\u007f\/\\]/.test( name ) )
	{
		return null;
	}
	return name;
}


// A Server's address: http:// or https://, a host, no spaces; its trailing slashes dropped.
function CleanUrl( Text )
{
	if ( typeof Text !== 'string' )
	{
		return null;
	}
	let url = Text.trim().replace( /\/+$/, '' );
	if ( !/^https?:\/\/[^\s\/]+(\/\S*)?$/i.test( url ) )
	{
		return null;
	}
	return url;
}


// A text field kept when it is a non-empty string, trimmed; null otherwise.
function clean_text( Text )
{
	return ( typeof Text === 'string' && Text.trim() ) ? Text.trim() : null;
}


// One entry in the list's shape: Project and Title present only when given.
function entry_of( Name, Url, Project, Title )
{
	let server = { Name: Name, Url: Url };
	let project = clean_text( Project );
	if ( project )
	{
		server.Project = project;
		let title = clean_text( Title );
		if ( title )
		{
			server.Title = title;
		}
	}
	return server;
}


function Fill( List )
{
	let servers = [];
	for ( let entry of ( Array.isArray( List ) ? List : [] ) )
	{
		let name = CleanName( entry && entry.Name );
		let url = CleanUrl( entry && entry.Url );
		let taken = servers.some( function ( one ) { return one.Name.toLowerCase() === ( name || '' ).toLowerCase(); } );
		if ( name && url && !taken )
		{
			servers.push( entry_of( name, url, entry.Project, entry.Title ) );
		}
	}
	return servers;
}


function Named( Settings, Name )
{
	let wanted = String( Name || '' ).toLowerCase();
	return ( ( Settings && Settings.Servers ) || [] ).find( function ( one ) { return one.Name.toLowerCase() === wanted; } ) || null;
}


function UniqueName( Settings, Name )
{
	let base = CleanName( Name ) || 'Server';
	if ( !Named( Settings, base ) )
	{
		return base;
	}
	for ( let count = 2; ; count++ )
	{
		let suffix = ' ' + count;
		let candidate = base.slice( 0, NAME_LIMIT - suffix.length ) + suffix;
		if ( !Named( Settings, candidate ) )
		{
			return candidate;
		}
	}
}


function AddServer( Settings, Fields )
{
	let fields = Fields || {};
	let url = CleanUrl( fields.Url );
	if ( !url )
	{
		return { Error: 'a Server\'s address starts with http:// or https://' };
	}
	let same = ( Settings.Servers || [] ).find( function ( one ) { return one.Url.toLowerCase() === url.toLowerCase(); } );
	if ( same )
	{
		return { Error: url + ' is in the list already, as ' + same.Name };
	}
	let server = entry_of( UniqueName( Settings, fields.Name || new URL( url ).host ), url, fields.Project, fields.Title );
	Settings.Servers = ( Settings.Servers || [] ).concat( [ server ] );
	return { Server: server };
}


function RenameServer( Settings, Name, To )
{
	let server = Named( Settings, Name );
	if ( !server )
	{
		return { Error: 'no Server named "' + Name + '"' };
	}
	let name = CleanName( To );
	if ( !name )
	{
		return { Error: 'a Server\'s name is one to ' + NAME_LIMIT + ' characters, with no slash' };
	}
	let other = Named( Settings, name );
	if ( other && other !== server )
	{
		return { Error: 'another Server is named "' + other.Name + '"' };
	}
	server.Name = name;
	return { Server: server };
}


function RemoveServer( Settings, Name )
{
	let server = Named( Settings, Name );
	if ( !server )
	{
		return { Error: 'no Server named "' + Name + '"' };
	}
	Settings.Servers = Settings.Servers.filter( function ( one ) { return one !== server; } );
	return { Server: server };
}


// The Client's last project on a Server (plan Review 2026-10-29, Step 5.1): set in place, or forgotten with null.
function SetProject( Settings, Name, Project, Title )
{
	let server = Named( Settings, Name );
	if ( !server )
	{
		return { Error: 'no Server named "' + Name + '"' };
	}
	let project = clean_text( Project );
	let title = clean_text( Title );
	delete server.Project;
	delete server.Title;
	if ( project )
	{
		server.Project = project;
		if ( title )
		{
			server.Title = title;
		}
	}
	return { Server: server };
}


module.exports = {
	NAME_LIMIT: NAME_LIMIT,
	CleanName: CleanName,
	CleanUrl: CleanUrl,
	Fill: Fill,
	Named: Named,
	UniqueName: UniqueName,
	AddServer: AddServer,
	RenameServer: RenameServer,
	RemoveServer: RemoveServer,
	SetProject: SetProject,
};
