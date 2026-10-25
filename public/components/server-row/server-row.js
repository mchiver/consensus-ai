'use strict';

// server-row - a server in the tree (plan UI Components, Step 4; plan Run Shapes, Step 5): the root head with
// its chevron, icon, live dot, name, who you are, offline and its menu; the new-project form; and, open, the body:
// a project-view per project, the llm-fold, the users-fold, the Trash fold with its list. Single (plan
// Rearchitecturation, Step 2: the Desktop, one project per window) shows no root head and the window's one project
// alone, always open, with the folds beneath it.
//
// Interface:
//   <server-row class="root" server="..." first="..." single="..."></server-row>
//   server  the root (roots.js); named server, since the host's data-root attribute normalizes to root
//   first   true on the first row, which carries the ids the tests and the guide look for
//   single  true when the window shows one project (Roots.Project): that project alone, no root head
//   the state and the actions through Tree

angular.module( 'Consensus' ).component( 'serverRow', {
	templateUrl: '/components/server-row/server-row.html',
	bindings: { server: '<', first: '<', single: '<' },
	controller: [ 'Tree', 'Roots', function ( Tree, Roots )
	{
		let controller = this;
		controller.Tree = Tree;
		controller.Roots = Roots;


		// The projects shown: the window's one when single, else the server's.
		controller.Projects = function ()
		{
			if ( controller.single && Roots.Project )
			{
				return controller.server.Projects.filter( function ( project ) { return project.Id === Roots.Project.Id; } );
			}
			return controller.server.Projects;
		};


		// The body shows when single, or when the root is not closed.
		controller.BodyShown = function ()
		{
			return !!controller.single || !Tree.IsRootClosed( controller.server );
		};


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
