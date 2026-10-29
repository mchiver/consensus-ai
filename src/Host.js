'use strict';

// Host - the Server's address on this machine (plan Rearchitecturation, Step 5). `consensus serve` (the bare
// form, the Docker image, the Server application) writes <config>/~host.json while it runs, so the
// Desktop finds the Host it started, or one started any other way, and can stop the one it started; a Host is also
// found by its port (src/Probe.js), whoever started it.
//
//   FilePath( Config )          <config>/~host.json (the tilde keeps it out of source control)
//   Read( Config )              { Url, Port, Pid, Started } or null
//   Running( Config )           the record when the file is there and its Pid alive, else null
//   Write( Config, Record )     the file written whole
//   Remove( Config, Pid? )      the file removed; with Pid, only when the file is that process's
//   Status( Config, Port )      { Running, Url, Pid, Started, Ours }: the file's Host when alive, else the port probed
//                               (GET <Url>/api/me; a Server that answers 401 with an Error, its gate closed or a sign-in
//                               asked, is running: plan The Server, Step 3)

const FS = require( 'fs' );
const PATH = require( 'path' );
const SIDECAR = require( './Sidecar.js' );
const ATOMIC = require( './Atomic.js' );
const PROBE = require( './Probe.js' );

const FILE = '~host.json';
const PROBE_TIMEOUT = 2000;


function FilePath( Config )
{
	return PATH.join( PATH.resolve( String( Config || '' ) ), FILE );
}


function Read( Config )
{
	let record = null;
	try
	{
		record = JSON.parse( FS.readFileSync( FilePath( Config ), 'utf8' ) );
	}
	catch ( error )
	{
		return null;
	}
	if ( !record || typeof record !== 'object' || typeof record.Url !== 'string' || !Number.isInteger( record.Pid ) )
	{
		return null;
	}
	return record;
}


function Running( Config )
{
	let record = Read( Config );
	if ( !record || !SIDECAR.Alive( record.Pid ) )
	{
		return null;
	}
	return record;
}


function Write( Config, Record )
{
	return ATOMIC.WriteJson( FilePath( Config ), Record );
}


function Remove( Config, Pid )
{
	if ( Pid !== undefined )
	{
		let record = Read( Config );
		if ( record && record.Pid !== Pid )
		{
			return false;
		}
	}
	try
	{
		FS.unlinkSync( FilePath( Config ) );
		return true;
	}
	catch ( error )
	{
		return false;
	}
}


// Status: the Host this machine runs, if any: the file's when its process is alive (Ours: it can be stopped by its
// Pid), else the configured port probed (a Host started any other way, shown as running, not stoppable from here).
async function Status( Config, Port )
{
	let record = Running( Config );
	if ( record )
	{
		return { Running: true, Url: record.Url, Pid: record.Pid, Started: record.Started || null, Ours: true };
	}
	let url = 'http://127.0.0.1:' + ( Port || 3500 );
	let probed = await PROBE.Probe( url, { Timeout: PROBE_TIMEOUT } );
	if ( probed.Ok )
	{
		return { Running: true, Url: url, Pid: null, Started: null, Ours: false };
	}
	return { Running: false, Url: url, Pid: null, Started: null, Ours: false };
}


module.exports = {
	FilePath: FilePath,
	Read: Read,
	Running: Running,
	Write: Write,
	Remove: Remove,
	Status: Status,
};
