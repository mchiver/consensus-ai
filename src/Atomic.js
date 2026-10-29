'use strict';

// Atomic - a file written whole (plan Review 2026-10-29, Step 2): the folder made, the text written to a temporary
// file named with the process id beside the target, then renamed into place, so a reader never sees a half-written
// file and two processes writing the same file never share a temporary one. On Windows the rename fails with EPERM,
// EBUSY or EACCES while another process has the target open for reading; the reader is done within milliseconds, so
// the rename is tried again a few times (src/Store.js's retry, here for every writer). The nine writers of before
// (Host, License, Runs, Sidecar, Store, Users and the three Settings) call this.
//
//   WriteText( Path, Text )           the text written whole; the path
//   WriteJson( Path, Value )          the value as tab-indented JSON with a final newline; the path
//   WriteTextAsync( Path, Text )      the same, awaited
//   WriteJsonAsync( Path, Value )     the same, awaited
//   RenameSync( Source, Target )      a rename tried again while the target is held
//   Rename( Source, Target )          the same, awaited
//   RENAME_ATTEMPTS, RENAME_DELAY_MS  the retry: the attempts and the delay, which grows with each attempt

const FS = require( 'fs' );
const PATH = require( 'path' );

const RENAME_ATTEMPTS = 10;
const RENAME_DELAY_MS = 20;


//---------------------------------------------------------------------

// The temporary file's name: the target's, the process id and a count, so two writes of one file, in two processes
// or awaited side by side in one (two requests saving the settings at once), never share a temporary file; each
// rename then lands whole and the last one stands.
let count = 0;

function temporary_name( Path )
{
	count += 1;
	return Path + '.' + process.pid + '.' + count + '.tmp';
}


function json_text( Value )
{
	return JSON.stringify( Value, null, '\t' ) + '\n';
}


function locked( error )
{
	return ( error.code === 'EPERM' ) || ( error.code === 'EBUSY' ) || ( error.code === 'EACCES' );
}


// A synchronous pause, for the synchronous writers: the thread waits on a buffer nobody signals.
function pause( milliseconds )
{
	Atomics.wait( new Int32Array( new SharedArrayBuffer( 4 ) ), 0, 0, milliseconds );
}


function wait( milliseconds )
{
	return new Promise( function ( resolve ) { setTimeout( resolve, milliseconds ); } );
}


//---------------------------------------------------------------------

function RenameSync( Source, Target )
{
	for ( let attempt = 1; ; attempt++ )
	{
		try
		{
			FS.renameSync( Source, Target );
			return;
		}
		catch ( error )
		{
			if ( !locked( error ) || attempt >= RENAME_ATTEMPTS )
			{
				throw error;
			}
			pause( RENAME_DELAY_MS * attempt );
		}
	}
}


async function Rename( Source, Target )
{
	for ( let attempt = 1; ; attempt++ )
	{
		try
		{
			await FS.promises.rename( Source, Target );
			return;
		}
		catch ( error )
		{
			if ( !locked( error ) || attempt >= RENAME_ATTEMPTS )
			{
				throw error;
			}
			await wait( RENAME_DELAY_MS * attempt );
		}
	}
}


//---------------------------------------------------------------------

function WriteText( Path, Text )
{
	let path = PATH.resolve( String( Path || '' ) );
	FS.mkdirSync( PATH.dirname( path ), { recursive: true } );
	let temporary = temporary_name( path );
	FS.writeFileSync( temporary, String( Text ), 'utf8' );
	RenameSync( temporary, path );
	return path;
}


function WriteJson( Path, Value )
{
	return WriteText( Path, json_text( Value ) );
}


async function WriteTextAsync( Path, Text )
{
	let path = PATH.resolve( String( Path || '' ) );
	await FS.promises.mkdir( PATH.dirname( path ), { recursive: true } );
	let temporary = temporary_name( path );
	await FS.promises.writeFile( temporary, String( Text ), 'utf8' );
	await Rename( temporary, path );
	return path;
}


async function WriteJsonAsync( Path, Value )
{
	return await WriteTextAsync( Path, json_text( Value ) );
}


module.exports = {
	RENAME_ATTEMPTS: RENAME_ATTEMPTS,
	RENAME_DELAY_MS: RENAME_DELAY_MS,
	RenameSync: RenameSync,
	Rename: Rename,
	WriteText: WriteText,
	WriteJson: WriteJson,
	WriteTextAsync: WriteTextAsync,
	WriteJsonAsync: WriteJsonAsync,
};
