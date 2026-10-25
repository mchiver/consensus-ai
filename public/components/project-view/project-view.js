'use strict';

// project-view - a project's tree (plan Rearchitecturation, Step 2; project-row, plan UI Components, Step 4, until
// then): the project head with its chevron, icon, rename form or name, count, stamp, menu and inline delete; and,
// open, the body: the new-plan form, the clipboard notice, the empty line, the tree of tree-nodes, the Archive fold
// with its archived tree-nodes (plan Run Shapes, Step 2) and the Users folder (roles-folder). A server-row shows one
// per project of its server; the Desktop's page shows one, single, always open and with no chevron.
//
// Interface:
//   <project-view class="project" entry="..." root="..." single="..."></project-view>
//   entry    the project as the root lists it; named entry, since the host's data-project attribute normalizes to project
//   root     its root
//   single   true when this is the window's one project (the Desktop): open, not foldable
//   the state and the actions through Tree

angular.module( 'Consensus' ).component( 'projectView', {
	templateUrl: '/components/project-view/project-view.html',
	bindings: { entry: '<', root: '<', single: '<' },
	controller: [ 'Tree', 'State', function ( Tree, State )
	{
		let controller = this;
		controller.Tree = Tree;
		controller.State = State;


		// Open: the window's one project is always open; the others as the Tree remembers.
		controller.Open = function ()
		{
			return !!controller.single || Tree.IsOpen( controller.entry );
		};


		// The head's click folds the project, except the window's one.
		controller.Toggle = function ()
		{
			if ( !controller.single )
			{
				Tree.ToggleProject( controller.entry );
			}
		};


		// The new-plan form shows at the top of this project's body while a plan, document or folder is being made at
		// its root.
		controller.CreatingHere = function ()
		{
			return !!Tree.Creating && Tree.Creating.Project === controller.entry.Id && !Tree.Creating.Parent;
		};
	} ],
} );
