'use strict';

// Host - the Server Host from the Desktop (plan Rearchitecturation, Step 5), without Electron: Start the Server Host
// runs `consensus serve` detached over the same config folder, its log in <config>/~logs/, outliving the window; a
// Host already running on the machine, started any other way, is found by its port and shown as running; Stop ends
// the one this machine's file names. A folder the Host's registry lists as mounted, while the Host runs, is routed
// through the Host rather than opened as a plain project.
//
//   Status( Config, Port )                     src/Host.js's Status: { Running, Url, Pid, Started, Ours }
//   Start( { Config, Command, Arguments, Scope? } )  the Host spawned detached: Command with Arguments then serve --headless
//                                              --config <Config> and --scope <Scope> (local unless given; null leaves the
//                                              file's Scope: plan Rearchitecturation, Step 6, the Professional tier), the
//                                              log file made; answers { Log, Pid }
//   Stop( Config )                             the file's Host ended when its process is alive; answers { Stopped, Error? }
//   WaitFor( Config, Port, TimeoutMs )         Status polled until the Host answers, or the time is up
//   Routed( Config, Folder, Port )             { Url, Project: { Id, Name } } when the registry lists the folder as
//                                              mounted and the Host runs, else null
//   HostPort( Config )                         the Port of the Host's consensus.json, or the default

const FS = require( 'fs' );
const PATH = require( 'path' );
const CHILD_PROCESS = require( 'child_process' );
const HOST = require( '../src/Host.js' );
const STORE = require( '../src/Store.js' );
const SIDECAR = require( '../src/Sidecar.js' );
const SERVER = require( '../src/Server.js' );

const LOGS_FOLDER = '~logs';
const HOME_FOLDER = '.consensus';
const PROJECT_FILE = 'project.json';
const POLL = 250;


async function Status( Config, Port )
{
	return await HOST.Status( Config, Port || await HostPort( Config ) );
}


// The Host's own port, from its settings file read without writing it.
async function HostPort( Config )
{
	let settings = await STORE.Open( Config, { ReadOnly: true } ).ReadSettings();
	return ( settings && Number.isInteger( settings.Port ) && settings.Port > 0 ) ? settings.Port : SERVER.DEFAULT_PORT;
}


function Start( Options )
{
	let config = PATH.resolve( String( Options.Config || '' ) );
	let logs = PATH.join( config, LOGS_FOLDER );
	FS.mkdirSync( logs, { recursive: true } );
	let log = PATH.join( logs, 'host-' + new Date().toISOString().replace( /[:.]/g, '-' ) + '.log' );
	let out = FS.openSync( log, 'a' );
	let scope = ( Options.Scope === undefined ) ? 'local' : Options.Scope;
	let arguments_ = ( Options.Arguments || [] ).concat( [ 'serve', '--headless', '--config', config ], scope ? [ '--scope', scope ] : [] );
	let child = CHILD_PROCESS.spawn( Options.Command || process.execPath, arguments_, { detached: true, stdio: [ 'ignore', out, out ], windowsHide: true } );
	child.unref();
	FS.closeSync( out );
	return { Log: log, Pid: child.pid };
}


function Stop( Config )
{
	let record = HOST.Running( Config );
	if ( !record )
	{
		return { Stopped: false, Error: 'no Server Host of this machine\'s is running' };
	}
	try
	{
		process.kill( record.Pid );
	}
	catch ( error )
	{
		return { Stopped: false, Error: 'the Server Host could not be stopped: ' + error.message };
	}
	return { Stopped: true, Pid: record.Pid };
}


async function WaitFor( Config, Port, TimeoutMs )
{
	let waited = 0;
	while ( waited <= ( TimeoutMs || 10000 ) )
	{
		let status = await Status( Config, Port );
		if ( status.Running )
		{
			return status;
		}
		await new Promise( function ( resolve ) { setTimeout( resolve, POLL ); } );
		waited += POLL;
	}
	return await Status( Config, Port );
}


// A folder the Host serves: listed in the registry as mounted, holding a project, the Host running.
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
	Start: Start,
	Stop: Stop,
	WaitFor: WaitFor,
	Routed: Routed,
};
