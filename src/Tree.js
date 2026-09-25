'use strict';

// Tree - pure functions over a project's Items. Nothing here touches a file or a request.
//
//   node = { Kind: 'folder', Id, Name, Items: [ node ] }
//        | { Kind: 'plan' | 'document' | 'corpus', Id }
//
// A folder's Id starts with 'f'; every other node's Id is the id of the thing it points to.
// A Parent of null is the project's root.

const KINDS = [ 'folder', 'plan', 'document', 'corpus' ];


//---------------------------------------------------------------------
// Find: { Node, Siblings, Index } for the node with Id anywhere under Items, or null.

function Find( Items, Id )
{
	for ( let index = 0; index < Items.length; index++ )
	{
		let node = Items[ index ];
		if ( node.Id === Id )
		{
			return { Node: node, Siblings: Items, Index: index };
		}
		if ( node.Kind === 'folder' )
		{
			let found = Find( node.Items, Id );
			if ( found )
			{
				return found;
			}
		}
	}
	return null;
}


//---------------------------------------------------------------------
// ItemIds: the ids of every node that is not a folder, under Items.

function ItemIds( Items )
{
	let ids = [];
	walk( Items, function ( node )
	{
		if ( node.Kind !== 'folder' )
		{
			ids.push( node.Id );
		}
	} );
	return ids;
}


function walk( items, visit )
{
	for ( let node of items )
	{
		visit( node );
		if ( node.Kind === 'folder' )
		{
			walk( node.Items, visit );
		}
	}
}


//---------------------------------------------------------------------
// Children: the list a new node goes into, for a Parent of null (the root) or a folder's Id; null when there is none.

function Children( Items, Parent )
{
	if ( Parent === null || Parent === undefined )
	{
		return Items;
	}
	let found = Find( Items, Parent );
	if ( !found || found.Node.Kind !== 'folder' )
	{
		return null;
	}
	return found.Node.Items;
}


//---------------------------------------------------------------------
// Insert: puts Node at the end of Parent's children. Returns false when Parent is not the root or a folder.

function Insert( Items, Parent, Node )
{
	let children = Children( Items, Parent );
	if ( !children )
	{
		return false;
	}
	children.push( Node );
	return true;
}


//---------------------------------------------------------------------
// Remove: takes the node with Id out of the tree and returns it, or null.

function Remove( Items, Id )
{
	let found = Find( Items, Id );
	if ( !found )
	{
		return null;
	}
	found.Siblings.splice( found.Index, 1 );
	return found.Node;
}


//---------------------------------------------------------------------
// Contains: whether Id is Node itself or anywhere under it.

function Contains( Node, Id )
{
	if ( Node.Id === Id )
	{
		return true;
	}
	if ( Node.Kind !== 'folder' )
	{
		return false;
	}
	return !!Find( Node.Items, Id );
}


//---------------------------------------------------------------------
// Validate: the problems with a tree, or none.

function Validate( Items )
{
	let problems = [];
	let seen = new Set();
	if ( !Array.isArray( Items ) )
	{
		return [ 'Items must be a list' ];
	}
	walk_checked( Items, problems, seen );
	return problems;
}


function walk_checked( items, problems, seen )
{
	for ( let node of items )
	{
		if ( !node || typeof node.Id !== 'string' || !node.Id )
		{
			problems.push( 'a node has no Id' );
			continue;
		}
		if ( seen.has( node.Id ) )
		{
			problems.push( 'node ' + node.Id + ' appears twice' );
		}
		seen.add( node.Id );
		if ( !KINDS.includes( node.Kind ) )
		{
			problems.push( 'node ' + node.Id + ' has kind "' + node.Kind + '", not one of ' + KINDS.join( ', ' ) );
			continue;
		}
		if ( node.Kind === 'folder' )
		{
			if ( typeof node.Name !== 'string' || !node.Name.trim() )
			{
				problems.push( 'folder ' + node.Id + ' has no Name' );
			}
			if ( !Array.isArray( node.Items ) )
			{
				problems.push( 'folder ' + node.Id + ' has no Items' );
				continue;
			}
			walk_checked( node.Items, problems, seen );
		}
	}
}


module.exports = {
	KINDS: KINDS,
	Find: Find,
	ItemIds: ItemIds,
	Children: Children,
	Insert: Insert,
	Remove: Remove,
	Contains: Contains,
	Validate: Validate,
};
