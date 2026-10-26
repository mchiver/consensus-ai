'use strict';

// Host - the Server on this machine as the Desktop sees it, without Electron (plan Rearchitecturation, Step 5; since
// plan The Server, Step 4, the Desktop no longer starts, opens or stops it: the Server is an application of its own).
// A Server running on the machine is found by its address file (<config>/~host.json) or its port; a folder its
// registry lists as mounted, while it runs, is routed through it rather than opened as a sidecar, so one folder never
// has two writers.
//
//   Status( Config, Port )                     src/Host.js's Status: { Running, Url, Pid, Started, Ours }
//   Routed( Config, Folder, Port )             { Url, Project: { Id, Name } } when the registry lists the folder as
//                                              mounted and the Server runs, else null
//   HostPort( Config )                         the Port of the Server's consensus.json, or the default

const FS = require( 'fs' );
const PATH = require( 'path' );
const HOST = require( '../src/Host.js' );
const STORE = require( '../src/Store.js' );
const SIDECAR = require( '../src/Sidecar.js' );
const SERVER = require( '../src/Server.js' );

const HOME_FOLDER = '.consensus';
const PROJECT_FILE = 'project.json';


async function Status( Config, Port )
{
	return await HOST.Status( Config, Port || await HostPort( Config ) );
}


// The Server's own port, from its settings file read without writing it.
async function HostPort( Config )
{
	let settings = await STORE.Open( Config, { ReadOnly: true } ).ReadSettings();
	return ( settings && Number.isInteger( settings.Port ) && settings.Port > 0 ) ? settings.Port : SERVER.DEFAULT_PORT;
}


// A folder the Server serves: listed in the registry as mounted, holding a project, the Server running.
async function Routed( Config, Folder, Port )
{
	let settings = await STORE.Open( Config, { ReadOnly: true } ).ReadSettings();
	let wanted = SIDECAR.Normalize( Folder );
	let entry = ( settings && Array.isArray( settings.Projects ) ? settings.Projects : [] ).find( function ( one )
	{
		return one && one.Mounted === true && typeof one.Path === 'string' && SIDECAR.Normalize( one.Path ) === wanted;
	} );
	if ( !entry )
	{
		return null;
	}
	let project = null;
	try
	{
		project = JSON.parse( FS.readFileSync( PATH.join( PATH.resolve( Folder ), HOME_FOLDER, PROJECT_FILE ), 'utf8' ) );
	}
	catch ( error )
	{
		return null;
	}
	if ( !project || typeof project.Id !== 'string' )
	{
		return null;
	}
	let status = await Status( Config, Port );
	if ( !status.Running )
	{
		return null;
	}
	return { Url: status.Url, Project: { Id: project.Id, Name: project.Name || PATH.basename( PATH.resolve( Folder ) ) } };
}


module.exports = {
	Status: Status,
	HostPort: HostPort,
	Routed: Routed,
};
