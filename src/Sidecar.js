'use strict';

// Sidecar - the one-project server's known address on localhost (plan Rearchitecturation, Step 3). The Desktop runs
// one server per window over the window's folder, and the headless `consensus <folder>` the same; an LLM session
// finds it without a copy and paste: the port is hashed from the folder into a range, and the address is written
// to the project's own folder while the project is open.
//
//   RANGE_START, RANGE_COUNT   3600 and 100: the ports 3600 to 3699
//   Normalize( Folder )        the folder's absolute path with forward slashes, lower-cased on Windows: what is hashed
//   Port( Folder )             the folder's port: the range's start plus the hash modulo the count
//   Ports( Folder )            the hundred ports in the order they are tried: the folder's first, then up by one, wrapping
//   FilePath( Folder )         <folder>/.consensus/~sidecar.json (the tilde keeps it out of source control)
//   Read( Folder )             the file's record { Url, Port, Pid, Started, Project }, or null when missing or unreadable
//   Alive( Pid )               whether a process with that id runs
//   Running( Folder )          the record when the file is there and its Pid alive, else null (a dead Pid is a stale file)
//   Write( Folder, Record )    the file written whole (a temporary file renamed into place)
//   Remove( Folder, Pid? )     the file removed; with Pid, only when the file is that process's
//   Activate( Url, TimeoutMs? ) POST <Url>/api/desktop/activate: { Ok } when a Desktop's sidecar answered, else { Ok: false, Error }
//   ACTIVATE_PATH              '/api/desktop/activate', answered by a Desktop's sidecar alone

const FS = require( 'fs' );
const PATH = require( 'path' );

const RANGE_START = 3600;
const RANGE_COUNT = 100;
const HOME_FOLDER = '.consensus';
const FILE = '~sidecar.json';
const ACTIVATE_PATH = '/api/desktop/activate';
const ACTIVATE_TIMEOUT = 3000;


//---------------------------------------------------------------------
// The port

function Normalize( Folder )
{
	let resolved = PATH.resolve( String( Folder || '' ) ).replace( /\\/g, '/' ).replace( /\/+$/, '' );
	return ( process.platform === 'win32' ) ? resolved.toLowerCase() : resolved;
}


// FNV-1a over the normalized path, 32 bits.
function hash( Text )
{
	let value = 0x811c9dc5;
	for ( let index = 0; index < Text.length; index++ )
	{
		value ^= Text.charCodeAt( index );
		value = Math.imul( value, 0x01000193 ) >>> 0;
	}
	return value;
}


function Port( Folder )
{
	return RANGE_START + ( hash( Normalize( Folder ) ) % RANGE_COUNT );
}


function Ports( Folder )
{
	let first = Port( Folder ) - RANGE_START;
	let ports = [];
	for ( let step = 0; step < RANGE_COUNT; step++ )
	{
		ports.push( RANGE_START + ( ( first + step ) % RANGE_COUNT ) );
	}
	return ports;
}


//---------------------------------------------------------------------
// The address file

function FilePath( Folder )
{
	return PATH.join( PATH.resolve( String( Folder || '' ) ), HOME_FOLDER, FILE );
}


function Read( Folder )
{
	let record = null;
	try
	{
		record = JSON.parse( FS.readFileSync( FilePath( Folder ), 'utf8' ) );
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


function Alive( Pid )
{
	if ( !Number.isInteger( Pid ) || Pid <= 0 )
	{
		return false;
	}
	try
	{
		process.kill( Pid, 0 );
		return true;
	}
	catch ( error )
	{
		return error.code === 'EPERM';
	}
}


function Running( Folder )
{
	let record = Read( Folder );
	if ( !record || !Alive( record.Pid ) )
	{
		return null;
	}
	return record;
}


function Write( Folder, Record )
{
	let file = FilePath( Folder );
	FS.mkdirSync( PATH.dirname( file ), { recursive: true } );
	let temporary = file + '.' + process.pid + '.tmp';
	FS.writeFileSync( temporary, JSON.stringify( Record, null, '\t' ) + '\n' );
	FS.renameSync( temporary, file );
	return file;
}


function Remove( Folder, Pid )
{
	if ( Pid !== undefined )
	{
		let record = Read( Folder );
		if ( record && record.Pid !== Pid )
		{
			return false;
		}
	}
	try
	{
		FS.unlinkSync( FilePath( Folder ) );
		return true;
	}
	catch ( error )
	{
		return false;
	}
}


//---------------------------------------------------------------------
// Activate: the running sidecar asked to bring its window to the front. A headless sidecar has no window and answers
// 404; a sidecar that does not answer at all is reported the same way, with the reason.

async function Activate( Url, TimeoutMs )
{
	let base = String( Url || '' ).replace( /\/+$/, '' );
	try
	{
		let response = await fetch( base + ACTIVATE_PATH, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout( TimeoutMs || ACTIVATE_TIMEOUT ) } );
		if ( response.ok )
		{
			return { Ok: true };
		}
		return { Ok: false, Error: ( response.status === 404 ) ? 'no window to bring to the front' : 'answered ' + response.status };
	}
	catch ( error )
	{
		return { Ok: false, Error: error.message };
	}
}


module.exports = {
	RANGE_START: RANGE_START,
	RANGE_COUNT: RANGE_COUNT,
	ACTIVATE_PATH: ACTIVATE_PATH,
	Normalize: Normalize,
	Port: Port,
	Ports: Ports,
	FilePath: FilePath,
	Read: Read,
	Alive: Alive,
	Running: Running,
	Write: Write,
	Remove: Remove,
	Activate: Activate,
};
