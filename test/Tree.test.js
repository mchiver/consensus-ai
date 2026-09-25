'use strict';

// A project's tree: find, insert, remove, the ids under it, containment and validation.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const TREE = require( '../src/Tree.js' );


function sample()
{
	return [
		{ Kind: 'plan', Id: 'p1' },
		{ Kind: 'folder', Id: 'f1', Name: 'Specs', Items: [
			{ Kind: 'document', Id: 'd1' },
			{ Kind: 'folder', Id: 'f2', Name: 'Old', Items: [ { Kind: 'plan', Id: 'p2' } ] },
		] },
		{ Kind: 'corpus', Id: 'c1' },
	];
}


//---------------------------------------------------------------------

TEST( 'find reaches any depth and says where the node sits', function ()
{
	let items = sample();
	let found = TREE.Find( items, 'p2' );
	ASSERT.equal( found.Node.Id, 'p2' );
	ASSERT.equal( found.Index, 0 );
	ASSERT.equal( found.Siblings, items[ 1 ].Items[ 1 ].Items );
	ASSERT.equal( TREE.Find( items, 'f1' ).Index, 1 );
	ASSERT.equal( TREE.Find( items, 'none' ), null );
} );


TEST( 'item ids leave folders out', function ()
{
	ASSERT.deepEqual( TREE.ItemIds( sample() ), [ 'p1', 'd1', 'p2', 'c1' ] );
	ASSERT.deepEqual( TREE.ItemIds( [] ), [] );
} );


TEST( 'insert goes to the root or into a folder, never into an item', function ()
{
	let items = sample();
	ASSERT.equal( TREE.Insert( items, null, { Kind: 'plan', Id: 'p3' } ), true );
	ASSERT.equal( items[ 3 ].Id, 'p3' );
	ASSERT.equal( TREE.Insert( items, 'f2', { Kind: 'plan', Id: 'p4' } ), true );
	ASSERT.deepEqual( TREE.ItemIds( items[ 1 ].Items[ 1 ].Items ), [ 'p2', 'p4' ] );
	ASSERT.equal( TREE.Insert( items, 'p1', { Kind: 'plan', Id: 'p5' } ), false );
	ASSERT.equal( TREE.Insert( items, 'none', { Kind: 'plan', Id: 'p5' } ), false );
	ASSERT.equal( TREE.Find( items, 'p5' ), null );
} );


TEST( 'remove takes a node out, folders with everything under them', function ()
{
	let items = sample();
	ASSERT.equal( TREE.Remove( items, 'd1' ).Id, 'd1' );
	ASSERT.deepEqual( TREE.ItemIds( items ), [ 'p1', 'p2', 'c1' ] );
	let folder = TREE.Remove( items, 'f1' );
	ASSERT.equal( folder.Items.length, 1 );
	ASSERT.deepEqual( TREE.ItemIds( items ), [ 'p1', 'c1' ] );
	ASSERT.equal( TREE.Remove( items, 'none' ), null );
} );


TEST( 'contains: a node itself and everything under a folder', function ()
{
	let items = sample();
	ASSERT.equal( TREE.Contains( items[ 1 ], 'p2' ), true );
	ASSERT.equal( TREE.Contains( items[ 1 ], 'f1' ), true );
	ASSERT.equal( TREE.Contains( items[ 1 ], 'p1' ), false );
	ASSERT.equal( TREE.Contains( items[ 0 ], 'p1' ), true );
	ASSERT.equal( TREE.Contains( items[ 0 ], 'p2' ), false );
} );


TEST( 'validation names the problems', function ()
{
	ASSERT.deepEqual( TREE.Validate( sample() ), [] );
	ASSERT.deepEqual( TREE.Validate( 'no' ), [ 'Items must be a list' ] );
	let bad = [
		{ Kind: 'plan', Id: 'p1' },
		{ Kind: 'plan', Id: 'p1' },
		{ Kind: 'thing', Id: 'x' },
		{ Kind: 'folder', Id: 'f1', Name: ' ', Items: [] },
		{ Kind: 'folder', Id: 'f2', Name: 'N' },
		{ Kind: 'plan' },
	];
	let problems = TREE.Validate( bad );
	ASSERT.equal( problems.length, 5 );
	ASSERT.match( problems.join( '; ' ), /p1 appears twice/ );
	ASSERT.match( problems.join( '; ' ), /kind "thing"/ );
	ASSERT.match( problems.join( '; ' ), /f1 has no Name/ );
	ASSERT.match( problems.join( '; ' ), /f2 has no Items/ );
	ASSERT.match( problems.join( '; ' ), /a node has no Id/ );
} );
