'use strict';

// project-tree - the tree of servers, projects and items (plan UI Components, Step 4): the sort select and the
// Show updated button, then a server-row per root. The state and the actions every row shares are the Tree
// service's (public/js/tree.js); this and the rows are views over it.
//
// Interface:
//   <project-tree></project-tree>
//   reads Roots.List; the sort and the stamps through Tree

angular.module( 'Consensus' ).component( 'projectTree', {
	templateUrl: '/components/project-tree/project-tree.html',
	controller: [ 'Tree', 'Roots', function ( Tree, Roots )
	{
		let controller = this;
		controller.Tree = Tree;
		controller.Roots = Roots;
	} ],
} );
