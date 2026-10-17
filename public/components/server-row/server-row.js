'use strict';

// server-row - a server in the tree (plan UI Components, Step 4; plan Run Shapes, Step 5): the root head with
// its chevron, icon, live dot, name, who you are, offline and its menu; the new-project form; and, open, the body:
// a project-row per project, the llm-fold, the Trash fold with its list.
//
// Interface:
//   <server-row class="root" server="..." first="..."></server-row>
//   server  the root (roots.js); named server, since the host's data-root attribute normalizes to root
//   first  true on the first row, which carries the ids the tests and the guide look for
//   the state and the actions through Tree

angular.module( 'Consensus' ).component( 'serverRow', {
	templateUrl: '/components/server-row/server-row.html',
	bindings: { server: '<', first: '<' },
	controller: [ 'Tree', 'Roots', function ( Tree, Roots )
	{
		let controller = this;
		controller.Tree = Tree;
		controller.Roots = Roots;


		// The new-project form shows under this row while a project is being made on this root.
		controller.CreatingProject = function ()
		{
			return !!Tree.Creating && Tree.Creating.Kind === 'project' && Tree.CreatingRoot() === controller.server;
		};


		controller.CreatingNote = function ()
		{
			let root = Tree.CreatingRoot();
			return ( Roots.Several() && root ) ? 'on ' + root.Name : '';
		};
	} ],
} );
