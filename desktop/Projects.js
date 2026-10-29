'use strict';

// Projects - what the Desktop's chooser does without Electron (plan Rearchitecturation, Step 2): a new project's
// folder made under a parent, a Host's projects listed from its API, the project an entry names found in that list,
// and the key the remembered state is kept under for a window's project (the folder, or the Host's address and the
// project id), in place of a server address that changes port at every start.
//
//   Normalize( Folder ) -> the absolute path with forward slashes
//   NewFolder( Parent, Name ) -> the new folder's path; throws when the parent is not a folder, the name is not a folder
//                                name, or the folder is there already and holds anything
//   HostProjects( Url, TimeoutMs ) -> [ { Id, Name } ] from GET <Url>/api/projects; throws when the Host does not answer
//                                   (the address checked as src/Probe.js does; the app probes the Server first)
//   FindProject( Projects, IdOrName ) -> the project with that id, else that name, else null
//   Key( Opened ) -> the stored key of { Kind: 'folder', Path } or { Kind: 'host', Host: { Url }, Project: { Id } }

const FS = require( 'fs' );
const PATH = require( 'path' );
const PROBE = require( '../src/Probe.js' );

const BAD_NAME = /[\\/:*?"<>|\u0000-\u001f]/;
const DEFAULT_TIMEOUT = 5000;


//---------------------------------------------------------------------

function Normalize( Folder )
{
	return PATH.resolve( String( Folder || '' ) ).replace( /\\/g, '/' );
}


//---------------------------------------------------------------------

function NewFolder( Parent, Name )
{
	let parent = Normalize( Parent );
	let name = String( Name || '' ).trim();
	if ( !FS.existsSync( parent ) || !FS.statSync( parent ).isDirectory() )
	{
		throw new Error( 'the parent folder is not there: ' + parent );
	}
	if ( !name || name === '.' || name === '..' || BAD_NAME.test( name ) )
	{
		throw new Error( 'a project needs a folder name: letters, digits, spaces, dots and dashes' );
	}
	let folder = Normalize( PATH.join( parent, name ) );
	if ( FS.existsSync( folder ) )
	{
		if ( !FS.statSync( folder ).isDirectory() )
		{
			throw new Error( 'a file is there already: ' + folder );
		}
		if ( FS.readdirSync( folder ).length )
		{
			throw new Error( 'the folder is there already and holds something: open it instead of making it' );
		}
		return folder;
	}
	FS.mkdirSync( folder );
	return folder;
}


//---------------------------------------------------------------------

async function HostProjects( Url, TimeoutMs )
{
	let base = PROBE.Base( Url );
	if ( !base )
	{
		throw new Error( 'the Url must start with http:// or https://' );
	}
	let response = null;
	try
	{
		response = await fetch( base + '/api/projects', { signal: AbortSignal.timeout( TimeoutMs || DEFAULT_TIMEOUT ) } );
	}
	catch ( error )
	{
		throw new Error( base + ' does not answer: ' + ( error.name === 'TimeoutError' ? 'no answer within ' + Math.round( ( TimeoutMs || DEFAULT_TIMEOUT ) / 1000 ) + ' seconds' : error.message ) );
	}
	let json = await response.json().catch( function () { return {}; } );
	if ( !response.ok )
	{
		throw new Error( base + ' answered ' + response.status + ( json.Error ? ': ' + json.Error : '' ) );
	}
	return ( Array.isArray( json.Projects ) ? json.Projects : [] ).map( function ( project ) { return { Id: project.Id, Name: project.Name }; } );
}


//---------------------------------------------------------------------

function FindProject( Projects, IdOrName )
{
	let wanted = String( IdOrName || '' ).trim();
	let list = Array.isArray( Projects ) ? Projects : [];
	if ( !wanted )
	{
		return null;
	}
	return list.find( function ( project ) { return project.Id === wanted; } ) || list.find( function ( project ) { return project.Name === wanted; } ) || null;
}


//---------------------------------------------------------------------

function Key( Opened )
{
	if ( !Opened )
	{
		return null;
	}
	if ( Opened.Kind === 'host' )
	{
		let address = String( ( Opened.Host && Opened.Host.Url ) || '' ).replace( /^https?:\/\//, '' ).replace( /\/+$/, '' );
		return 'host:' + address + '/' + ( ( Opened.Project && Opened.Project.Id ) || '' );
	}
	return Normalize( Opened.Path );
}


module.exports = {
	Normalize: Normalize,
	NewFolder: NewFolder,
	HostProjects: HostProjects,
	FindProject: FindProject,
	Key: Key,
};
