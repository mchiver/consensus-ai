'use strict';

// project-row - a project in the tree (plan UI Components, Step 4): the project head with its chevron, icon,
// rename form or name, count, stamp, menu and inline delete; and, open, the body: the new-plan form, the clipboard
// notice, the empty line, the tree of tree-nodes, and the Archive fold with its archived tree-nodes (plan Run
// Shapes, Step 2).
//
// Interface:
//   <project-row class="project" entry="..." root="..."></project-row>
//   entry    the project as the root lists it; named entry, since the host's data-project attribute normalizes to project
//   root     its root
//   the state and the actions through Tree

angular.module( 'Consensus' ).component( 'projectRow', {
	templateUrl: '/components/project-row/project-row.html',
	bindings: { entry: '<', root: '<' },
	controller: [ 'Tree', 'State', function ( Tree, State )
	{
		let controller = this;
		controller.Tree = Tree;
		controller.State = State;


		// The new-plan form shows at the top of this project's body while a plan, document or folder is being made at
		// its root.
		controller.CreatingHere = function ()
		{
			return !!Tree.Creating && Tree.Creating.Project === controller.entry.Id && !Tree.Creating.Parent;
		};
	} ],
} );
