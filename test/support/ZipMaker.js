'use strict';

// ZipMaker - builds zip files byte by byte for the tests, so each feature a real archiver may use can be tried:
// deflated or stored entries, UTF-8 names with or without the UTF-8 flag, data descriptors (sizes after the data),
// and Zip64 records. No dependency: zlib deflates and computes the CRC.
//
//   Make( [ { Name, Data, Stored?, Utf8Flag? } ], { DataDescriptor?, Zip64? } ) -> Buffer
//     Name is a string (written as UTF-8) or a Buffer (written as is); Data is a string or a Buffer.

const ZLIB = require( 'zlib' );

const MAX32 = 0xffffffff;
const MAX16 = 0xffff;


function Make( Files, Options )
{
	let options = Options || {};
	let parts = [];
	let central = [];
	let offset = 0;
	for ( let file of Files )
	{
		let name = Buffer.isBuffer( file.Name ) ? file.Name : Buffer.from( file.Name, 'utf8' );
		let data = Buffer.isBuffer( file.Data ) ? file.Data : Buffer.from( file.Data, 'utf8' );
		let method = file.Stored ? 0 : 8;
		let body = file.Stored ? data : ZLIB.deflateRawSync( data );
		let crc = ZLIB.crc32( data );
		let flags = ( file.Utf8Flag ? 0x800 : 0 ) | ( options.DataDescriptor ? 0x8 : 0 );
		let version = options.Zip64 ? 45 : 20;

		let local_extra = options.Zip64 ? zip64_extra( [ data.length, body.length ] ) : Buffer.alloc( 0 );
		let local = Buffer.alloc( 30 );
		local.writeUInt32LE( 0x04034b50, 0 );
		local.writeUInt16LE( version, 4 );
		local.writeUInt16LE( flags, 6 );
		local.writeUInt16LE( method, 8 );
		local.writeUInt16LE( 0, 10 );
		local.writeUInt16LE( 0x21, 12 );
		local.writeUInt32LE( options.DataDescriptor ? 0 : crc, 14 );
		local.writeUInt32LE( options.Zip64 ? MAX32 : ( options.DataDescriptor ? 0 : body.length ), 18 );
		local.writeUInt32LE( options.Zip64 ? MAX32 : ( options.DataDescriptor ? 0 : data.length ), 22 );
		local.writeUInt16LE( name.length, 26 );
		local.writeUInt16LE( local_extra.length, 28 );
		let pieces = [ local, name, local_extra, body ];
		if ( options.DataDescriptor )
		{
			let descriptor = Buffer.alloc( options.Zip64 ? 24 : 16 );
			descriptor.writeUInt32LE( 0x08074b50, 0 );
			descriptor.writeUInt32LE( crc, 4 );
			if ( options.Zip64 )
			{
				descriptor.writeBigUInt64LE( BigInt( body.length ), 8 );
				descriptor.writeBigUInt64LE( BigInt( data.length ), 16 );
			}
			else
			{
				descriptor.writeUInt32LE( body.length, 8 );
				descriptor.writeUInt32LE( data.length, 12 );
			}
			pieces.push( descriptor );
		}
		let record = Buffer.concat( pieces );
		parts.push( record );

		let central_extra = options.Zip64 ? zip64_extra( [ data.length, body.length, offset ] ) : Buffer.alloc( 0 );
		let entry = Buffer.alloc( 46 );
		entry.writeUInt32LE( 0x02014b50, 0 );
		entry.writeUInt16LE( version, 4 );
		entry.writeUInt16LE( version, 6 );
		entry.writeUInt16LE( flags, 8 );
		entry.writeUInt16LE( method, 10 );
		entry.writeUInt16LE( 0, 12 );
		entry.writeUInt16LE( 0x21, 14 );
		entry.writeUInt32LE( crc, 16 );
		entry.writeUInt32LE( options.Zip64 ? MAX32 : body.length, 20 );
		entry.writeUInt32LE( options.Zip64 ? MAX32 : data.length, 24 );
		entry.writeUInt16LE( name.length, 28 );
		entry.writeUInt16LE( central_extra.length, 30 );
		entry.writeUInt16LE( 0, 32 );
		entry.writeUInt16LE( 0, 34 );
		entry.writeUInt16LE( 0, 36 );
		entry.writeUInt32LE( 0, 38 );
		entry.writeUInt32LE( options.Zip64 ? MAX32 : offset, 42 );
		central.push( Buffer.concat( [ entry, name, central_extra ] ) );
		offset += record.length;
	}

	let directory = Buffer.concat( central );
	let tail = [];
	if ( options.Zip64 )
	{
		let record = Buffer.alloc( 56 );
		record.writeUInt32LE( 0x06064b50, 0 );
		record.writeBigUInt64LE( 44n, 4 );
		record.writeUInt16LE( 45, 12 );
		record.writeUInt16LE( 45, 14 );
		record.writeUInt32LE( 0, 16 );
		record.writeUInt32LE( 0, 20 );
		record.writeBigUInt64LE( BigInt( Files.length ), 24 );
		record.writeBigUInt64LE( BigInt( Files.length ), 32 );
		record.writeBigUInt64LE( BigInt( directory.length ), 40 );
		record.writeBigUInt64LE( BigInt( offset ), 48 );
		let locator = Buffer.alloc( 20 );
		locator.writeUInt32LE( 0x07064b50, 0 );
		locator.writeUInt32LE( 0, 4 );
		locator.writeBigUInt64LE( BigInt( offset + directory.length ), 8 );
		locator.writeUInt32LE( 1, 16 );
		tail.push( record, locator );
	}
	let end = Buffer.alloc( 22 );
	end.writeUInt32LE( 0x06054b50, 0 );
	end.writeUInt16LE( 0, 4 );
	end.writeUInt16LE( 0, 6 );
	end.writeUInt16LE( options.Zip64 ? MAX16 : Files.length, 8 );
	end.writeUInt16LE( options.Zip64 ? MAX16 : Files.length, 10 );
	end.writeUInt32LE( options.Zip64 ? MAX32 : directory.length, 12 );
	end.writeUInt32LE( options.Zip64 ? MAX32 : offset, 16 );
	end.writeUInt16LE( 0, 20 );
	tail.push( end );
	return Buffer.concat( parts.concat( [ directory ], tail ) );
}


// The Zip64 extended information field: id 0x0001, then each value as eight bytes.
function zip64_extra( values )
{
	let field = Buffer.alloc( 4 + values.length * 8 );
	field.writeUInt16LE( 0x0001, 0 );
	field.writeUInt16LE( values.length * 8, 2 );
	values.forEach( function ( value, index ) { field.writeBigUInt64LE( BigInt( value ), 4 + index * 8 ); } );
	return field;
}


module.exports = {
	Make: Make,
};
