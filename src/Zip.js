'use strict';

// Zip - the files in a zip held in memory, over yauzl (pure JavaScript, the same on Windows, macOS and Linux;
// Zip64, data descriptors and both name encodings). Nothing is written to disk.
//
//   Entries( Buffer, Want ) -> [ { Path, Size, Data } ]
//     Want( Path, Size ) says whether a file's bytes are read; Data is a Buffer, or null when not wanted.
//
// Folders, macOS's __MACOSX/ and .DS_Store entries are left out. A name that climbs out (".."), starts at a root,
// or names a drive refuses the whole zip, as does an encrypted entry.
// Names: UTF-8 when the zip says so; when it does not, UTF-8 if the bytes are valid UTF-8 (as macOS and many
// tools write them), otherwise the old IBM code page the format started with.

const YAUZL = require( 'yauzl' );

const UTF8 = new TextDecoder( 'utf-8', { fatal: true } );


async function Entries( Buffer_, Want )
{
	let zipfile = null;
	try
	{
		zipfile = await YAUZL.fromBufferPromise( Buffer_, { decodeStrings: false, validateEntrySizes: true } );
	}
	catch ( error )
	{
		throw new Error( 'not a zip file we can read: ' + error.message );
	}
	let entries = [];
	for await ( let entry of zipfile.eachEntry() )
	{
		let path = name_of( entry );
		let problem = YAUZL.validateFileName( path );
		if ( problem )
		{
			throw new Error( 'the zip holds an unsafe name "' + path + '": ' + problem );
		}
		if ( path.endsWith( '/' ) || is_clutter( path ) )
		{
			continue;
		}
		if ( entry.isEncrypted() )
		{
			throw new Error( 'the zip is encrypted ("' + path + '"); upload one without a password' );
		}
		let data = null;
		if ( !Want || Want( path, entry.uncompressedSize ) )
		{
			data = await read_entry( zipfile, entry );
		}
		entries.push( { Path: path, Size: entry.uncompressedSize, Data: data } );
	}
	return entries;
}


// The entry's name as text, with backslashes (from some Windows tools) turned into slashes.
function name_of( entry )
{
	let bytes = entry.fileName;
	let flagged_utf8 = ( entry.generalPurposeBitFlag & 0x800 ) !== 0;
	let name = null;
	if ( !flagged_utf8 && has_high_bytes( bytes ) && !has_unicode_path_field( entry ) )
	{
		try
		{
			name = UTF8.decode( bytes );
		}
		catch ( error )
		{
			name = null;
		}
	}
	if ( name === null )
	{
		name = YAUZL.getFileNameLowLevel( entry.generalPurposeBitFlag, bytes, entry.extraFields, false );
	}
	return name.replace( /\\/g, '/' );
}


function has_high_bytes( bytes )
{
	for ( let index = 0; index < bytes.length; index++ )
	{
		if ( bytes[ index ] > 0x7f )
		{
			return true;
		}
	}
	return false;
}


function has_unicode_path_field( entry )
{
	return ( entry.extraFields || [] ).some( function ( field ) { return field.id === 0x7075; } );
}


function is_clutter( path )
{
	let parts = path.split( '/' );
	return parts[ 0 ] === '__MACOSX' || parts[ parts.length - 1 ] === '.DS_Store';
}


async function read_entry( zipfile, entry )
{
	let stream = await zipfile.openReadStreamPromise( entry );
	let chunks = [];
	for await ( let chunk of stream )
	{
		chunks.push( chunk );
	}
	return Buffer.concat( chunks );
}


module.exports = {
	Entries: Entries,
};
