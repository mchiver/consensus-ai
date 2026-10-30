'use strict';

// Projects - what the Client's chooser does without Electron (plan Rearchitecturation, Step 2, as desktop/Projects.js;
// plan Review 2026-10-29, Step 5.1, the editions cut, made it the Client's and took the folder parts out, since the
// Client opens no folder): a Server's projects listed from its API, the project an entry names found in that list, and
// the key the remembered state is kept under for a window's project (the Server's address and the project id), in
// place of a page address that changes port.
//
//   ServerProjects( Url, TimeoutMs ) -> [ { Id, Name } ] from GET <Url>/api/projects; throws when the Server does not
//                                     answer (the address checked as src/Probe.js does; the app probes the Server first)
//   FindProject( Projects, IdOrName ) -> the project with that id, else that name, else null
//   Key( Server, Project ) -> the stored key of { Url } and { Id }: "host:<address>/<id>"

const PROBE = require( '../src/Probe.js' );

const DEFAULT_TIMEOUT = 5000;


//---------------------------------------------------------------------

async function ServerProjects( Url, TimeoutMs )
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

function Key( Server, Project )
{
	if ( !Server )
	{
		return null;
	}
	let address = String( Server.Url || '' ).replace( /^https?:\/\//, '' ).replace( /\/+$/, '' );
	return 'host:' + address + '/' + ( ( Project && Project.Id ) || '' );
}


module.exports = {
	ServerProjects: ServerProjects,
	FindProject: FindProject,
	Key: Key,
};
