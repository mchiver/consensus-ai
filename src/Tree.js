'use strict';

// Tree - pure functions over a project's Items. Nothing here touches a file or a request.
//
//   node = { Kind: 'folder', Id, Name, Items: [ node ] }
//        | { Kind: 'plan', Id, Items?: [ plan node ] }
//        | { Kind: 'document' | 'corpus', Id }
//
// A folder's Id is a global fld-… id; every other node's Id is the id of the thing it points to.
// A plan may hold Subplans: plans only, in its Items. A Parent of null is the project's root.

const KINDS = [ 'folder', 'plan', 'document', 'corpus' ];


//---------------------------------------------------------------------
// Holds: whether a node has children to walk (a folder, or a plan with Subplans).

function holds( node )
{
	return ( node.Kind === 'folder' || node.Kind === 'plan' ) && Array.isArray( node.Items );
}


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
		if ( holds( node ) )
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
// ItemIds: the ids of every node that is not a folder, under Items, Subplans included.

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
		if ( holds( node ) )
		{
			walk( node.Items, visit );
		}
	}
}


//---------------------------------------------------------------------
// Parents: the plans a node sits under, the top one first; empty for a node that is not a Subplan (or not found).

function Parents( Items, Id )
{
	let chain = [];
	function search( items )
	{
		for ( let node of items )
		{
			if ( node.Id === Id )
			{
				return true;
			}
			if ( holds( node ) )
			{
				chain.push( node );
				if ( search( node.Items ) )
				{
					return true;
				}
				chain.pop();
			}
		}
		return false;
	}
	if ( !search( Items ) )
	{
		return [];
	}
	let plans = [];
	for ( let index = chain.length - 1; index >= 0; index-- )
	{
		if ( chain[ index ].Kind !== 'plan' )
		{
			break;
		}
		plans.unshift( chain[ index ] );
	}
	return plans;
}


//---------------------------------------------------------------------
// Subplans: the plan nodes directly under the plan Id, or none.

function Subplans( Items, Id )
{
	let found = Find( Items, Id );
	if ( !found || found.Node.Kind !== 'plan' || !Array.isArray( found.Node.Items ) )
	{
		return [];
	}
	return found.Node.Items;
}


//---------------------------------------------------------------------
// Children: the list a new node goes into, for a Parent of null (the root), a folder's Id or a plan's Id; null
// when there is none. A plan's list is made when it has none yet.

function Children( Items, Parent )
{
	if ( Parent === null || Parent === undefined )
	{
		return Items;
	}
	let found = Find( Items, Parent );
	if ( !found )
	{
		return null;
	}
	if ( found.Node.Kind === 'folder' )
	{
		return found.Node.Items;
	}
	if ( found.Node.Kind === 'plan' )
	{
		if ( !Array.isArray( found.Node.Items ) )
		{
			found.Node.Items = [];
		}
		return found.Node.Items;
	}
	return null;
}


//---------------------------------------------------------------------
// CanHold: whether Parent (null for the root, a folder's or a plan's Id) takes a node of Kind. A plan takes plans only.

function CanHold( Items, Parent, Kind )
{
	if ( Parent === null || Parent === undefined )
	{
		return true;
	}
	let found = Find( Items, Parent );
	if ( !found )
	{
		return false;
	}
	if ( found.Node.Kind === 'folder' )
	{
		return true;
	}
	if ( found.Node.Kind === 'plan' )
	{
		return Kind === 'plan';
	}
	return false;
}


//---------------------------------------------------------------------
// Insert: puts Node among Parent's children, just before the child Before, or at the end when Before is not
// given or is not one of them. Returns false when Parent does not take a node of its kind.

function Insert( Items, Parent, Node, Before )
{
	if ( !CanHold( Items, Parent, Node.Kind ) )
	{
		return false;
	}
	let children = Children( Items, Parent );
	let index = Before ? children.findIndex( function ( child ) { return child.Id === Before; } ) : -1;
	if ( index < 0 )
	{
		children.push( Node );
	}
	else
	{
		children.splice( index, 0, Node );
	}
	return true;
}


//---------------------------------------------------------------------
// Remove: takes the node with Id out of the tree and returns it, or null. A plan left with no Subplans loses its
// empty list.

function Remove( Items, Id )
{
	let found = Find( Items, Id );
	if ( !found )
	{
		return null;
	}
	found.Siblings.splice( found.Index, 1 );
	if ( found.Siblings.length === 0 )
	{
		walk( Items, function ( node )
		{
			if ( node.Kind === 'plan' && node.Items === found.Siblings )
			{
				delete node.Items;
			}
		} );
	}
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
	if ( !holds( Node ) )
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
		if ( node.Kind === 'plan' && node.Items !== undefined )
		{
			if ( !Array.isArray( node.Items ) )
			{
				problems.push( 'plan ' + node.Id + ' has Items that are not a list' );
				continue;
			}
			for ( let child of node.Items )
			{
				if ( child && child.Kind !== 'plan' )
				{
					problems.push( 'plan ' + node.Id + ' holds a ' + child.Kind + ', not a plan' );
				}
			}
			walk_checked( node.Items, problems, seen );
		}
	}
}


module.exports = {
	KINDS: KINDS,
	Find: Find,
	ItemIds: ItemIds,
	Parents: Parents,
	Subplans: Subplans,
	Children: Children,
	CanHold: CanHold,
	Insert: Insert,
	Remove: Remove,
	Contains: Contains,
	Validate: Validate,
};
