'use strict';

// Reading zips: plain, stored, data descriptors, UTF-8 names flagged and not, the old code page, macOS clutter,
// Zip64, only the wanted files read, and the zips refused whole.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const ZIP = require( '../src/Zip.js' );
const MAKER = require( './support/ZipMaker.js' );


function by_path( entries )
{
	let map = {};
	for ( let entry of entries )
	{
		map[ entry.Path ] = entry.Data ? entry.Data.toString( 'utf8' ) : null;
	}
	return map;
}


//---------------------------------------------------------------------

TEST( 'a plain zip: deflated and stored files, folders left out', async function ()
{
	let zip = MAKER.Make( [
		{ Name: 'readme.md', Data: '# Read me\n' },
		{ Name: 'src/', Data: '', Stored: true },
		{ Name: 'src/app.js', Data: 'let x = 1;\n', Stored: true },
	] );
	let entries = await ZIP.Entries( zip );
	ASSERT.deepEqual( by_path( entries ), { 'readme.md': '# Read me\n', 'src/app.js': 'let x = 1;\n' } );
	ASSERT.equal( entries[ 0 ].Size, 10 );
} );


TEST( 'data descriptors, with and without Zip64', async function ()
{
	let files = [ { Name: 'a.txt', Data: 'alpha '.repeat( 200 ) }, { Name: 'b.txt', Data: 'beta' } ];
	ASSERT.deepEqual( by_path( await ZIP.Entries( MAKER.Make( files, { DataDescriptor: true } ) ) ), { 'a.txt': 'alpha '.repeat( 200 ), 'b.txt': 'beta' } );
	ASSERT.deepEqual( by_path( await ZIP.Entries( MAKER.Make( files, { Zip64: true } ) ) ), { 'a.txt': 'alpha '.repeat( 200 ), 'b.txt': 'beta' } );
	ASSERT.deepEqual( by_path( await ZIP.Entries( MAKER.Make( files, { Zip64: true, DataDescriptor: true } ) ) ), { 'a.txt': 'alpha '.repeat( 200 ), 'b.txt': 'beta' } );
} );


TEST( 'names: UTF-8 flagged, UTF-8 unflagged, the old code page, and Windows backslashes', async function ()
{
	let zip = MAKER.Make( [
		{ Name: 'notes/café.md', Data: 'flagged', Utf8Flag: true },
		{ Name: 'notes/naïve.md', Data: 'unflagged' },
		{ Name: Buffer.from( [ 0x6d, 0x81, 0x6e, 0x2e, 0x74, 0x78, 0x74 ] ), Data: 'code page' },
		{ Name: 'win\\path.txt', Data: 'backslash' },
	] );
	ASSERT.deepEqual( Object.keys( by_path( await ZIP.Entries( zip ) ) ), [ 'notes/café.md', 'notes/naïve.md', 'mün.txt', 'win/path.txt' ] );
} );


TEST( 'macOS clutter is left out', async function ()
{
	let zip = MAKER.Make( [
		{ Name: 'project/readme.md', Data: 'kept' },
		{ Name: '__MACOSX/project/._readme.md', Data: 'resource fork' },
		{ Name: 'project/.DS_Store', Data: 'finder' },
	] );
	ASSERT.deepEqual( by_path( await ZIP.Entries( zip ) ), { 'project/readme.md': 'kept' } );
} );


TEST( 'only wanted files are read; the others come back with their size and no data', async function ()
{
	let zip = MAKER.Make( [ { Name: 'small.txt', Data: 'small' }, { Name: 'big.bin', Data: 'x'.repeat( 5000 ) } ] );
	let asked = [];
	let entries = await ZIP.Entries( zip, function ( path, size ) { asked.push( path + ':' + size ); return size < 1000; } );
	ASSERT.deepEqual( asked, [ 'small.txt:5', 'big.bin:5000' ] );
	ASSERT.deepEqual( by_path( entries ), { 'small.txt': 'small', 'big.bin': null } );
	ASSERT.equal( entries[ 1 ].Size, 5000 );
} );


TEST( 'refused whole: not a zip, a name that climbs out, a name at a root', async function ()
{
	await ASSERT.rejects( ZIP.Entries( Buffer.from( 'this is not a zip at all, just words' ) ), /not a zip/ );
	await ASSERT.rejects( ZIP.Entries( MAKER.Make( [ { Name: '../escape.txt', Data: 'x' } ] ) ), /unsafe name/ );
	await ASSERT.rejects( ZIP.Entries( MAKER.Make( [ { Name: '/etc/passwd', Data: 'x' } ] ) ), /unsafe name/ );
	await ASSERT.rejects( ZIP.Entries( MAKER.Make( [ { Name: 'C:/windows.txt', Data: 'x' } ] ) ), /unsafe name/ );
} );
