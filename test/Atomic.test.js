'use strict';

// Atomic.test - a file written whole (plan Review 2026-10-29, Step 2): the folder made, the text landing whole, the
// temporary file gone, two processes' temporary names apart, the awaited forms the same.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const FS = require( 'fs' );
const OS = require( 'os' );
const PATH = require( 'path' );
const CHILD_PROCESS = require( 'child_process' );
const ATOMIC = require( '../src/Atomic.js' );


function temporary_folder()
{
	return FS.mkdtempSync( PATH.join( OS.tmpdir(), 'consensus-atomic-' ) );
}


TEST( 'WriteText and WriteJson: the folder made, the file whole, no temporary file left; JSON tab-indented with a final newline', function ()
{
	let folder = temporary_folder();
	let path = PATH.join( folder, 'deep', 'er', 'notes.txt' );
	ASSERT.equal( ATOMIC.WriteText( path, 'first' ), path );
	ASSERT.equal( FS.readFileSync( path, 'utf8' ), 'first' );
	ATOMIC.WriteText( path, 'second' );
	ASSERT.equal( FS.readFileSync( path, 'utf8' ), 'second' );
	let json = PATH.join( folder, 'record.json' );
	ATOMIC.WriteJson( json, { A: 1, B: [ 'x' ] } );
	ASSERT.equal( FS.readFileSync( json, 'utf8' ), '{\n\t"A": 1,\n\t"B": [\n\t\t"x"\n\t]\n}\n' );
	ASSERT.deepEqual( FS.readdirSync( PATH.join( folder, 'deep', 'er' ) ), [ 'notes.txt' ] );
	ASSERT.deepEqual( FS.readdirSync( folder ).sort(), [ 'deep', 'record.json' ] );
} );


TEST( 'WriteTextAsync and WriteJsonAsync: the same, awaited', async function ()
{
	let folder = temporary_folder();
	let path = PATH.join( folder, 'made', 'text.md' );
	ASSERT.equal( await ATOMIC.WriteTextAsync( path, '# title\n' ), path );
	ASSERT.equal( FS.readFileSync( path, 'utf8' ), '# title\n' );
	let json = PATH.join( folder, 'made', 'value.json' );
	await ATOMIC.WriteJsonAsync( json, [ 1, 2 ] );
	ASSERT.deepEqual( JSON.parse( FS.readFileSync( json, 'utf8' ) ), [ 1, 2 ] );
	ASSERT.deepEqual( FS.readdirSync( PATH.join( folder, 'made' ) ).sort(), [ 'text.md', 'value.json' ] );
} );


TEST( 'two processes writing the same file use temporary names of their own, and the file ends whole as one of them', function ()
{
	let folder = temporary_folder();
	let path = PATH.join( folder, 'shared.json' );
	// with -e, the arguments after the script start at process.argv[ 1 ]
	let script = 'const ATOMIC = require( process.argv[ 1 ] ); for ( let count = 0; count < 50; count++ ) { ATOMIC.WriteJson( process.argv[ 2 ], { By: process.pid, Count: count } ); }';
	let children = [ 1, 2 ].map( function ()
	{
		return CHILD_PROCESS.spawnSync( process.execPath, [ '-e', script, require.resolve( '../src/Atomic.js' ), path ], { encoding: 'utf8' } );
	} );
	for ( let child of children )
	{
		ASSERT.equal( child.status, 0, child.stderr );
	}
	let written = JSON.parse( FS.readFileSync( path, 'utf8' ) );
	ASSERT.equal( written.Count, 49 );
	ASSERT.deepEqual( FS.readdirSync( folder ), [ 'shared.json' ], 'no temporary file is left' );
} );


TEST( 'Rename and RenameSync: a missing source throws at once (not a held target), the attempts and the delay are told', async function ()
{
	let folder = temporary_folder();
	ASSERT.throws( function () { ATOMIC.RenameSync( PATH.join( folder, 'nope' ), PATH.join( folder, 'there' ) ); }, { code: 'ENOENT' } );
	await ASSERT.rejects( ATOMIC.Rename( PATH.join( folder, 'nope' ), PATH.join( folder, 'there' ) ), { code: 'ENOENT' } );
	ASSERT.ok( ATOMIC.RENAME_ATTEMPTS >= 2 );
	ASSERT.ok( ATOMIC.RENAME_DELAY_MS > 0 );
	FS.writeFileSync( PATH.join( folder, 'from' ), 'x' );
	ATOMIC.RenameSync( PATH.join( folder, 'from' ), PATH.join( folder, 'to' ) );
	ASSERT.equal( FS.readFileSync( PATH.join( folder, 'to' ), 'utf8' ), 'x' );
} );
