'use strict';

// tree-node - one node of a project's tree (plan UI Components, Step 4), one component for the two templates that
// were: a folder (its head with chevron, icon, rename form or name, count, menu and inline delete; its new-plan
// form; its children), or a plan or document (the row with its chevron, icon, date, title, badges, stamp, delete
// and menu, and its Subplans beneath). With archived on, the row is the read-only archived one (plan Run Shapes,
// Step 2) with the Restore menu and no drag. It includes itself for its children, one level deeper.
//
// Interface:
//   <tree-node class="tree-node" node="..." project="..." root="..." depth="..." archived="..."></tree-node>
//   node      the node as the project lists it (Kind folder, plan or document)
//   project   its project; root its root
//   depth     the level: 1 at a project's root, one more in each folder or plan
//   archived  true in the Archive fold
//   the state and the actions through Tree; reads State.OpenId

angular.module( 'Consensus' ).component( 'treeNode', {
	templateUrl: '/components/tree-node/tree-node.html',
	bindings: { node: '<', project: '<', root: '<', depth: '<', archived: '<' },
	controller: [ 'Tree', 'State', function ( Tree, State )
	{
		let controller = this;
		controller.Tree = Tree;
		controller.State = State;


		// The children as the tree shows them: sorted in the tree, as they are in the Archive.
		controller.Children = function ()
		{
			let items = controller.node.Items || [];
			return controller.archived ? items : Tree.Sorted( items );
		};


		controller.IsContextFolder = function ()
		{
			return Tree.IsContextFolder( controller.project, controller.node );
		};


		controller.IsContextDocument = function ()
		{
			return Tree.IsContextDocument( controller.project, controller.node );
		};


		// The new-plan form shows under this folder while a plan or folder is being made in it.
		controller.CreatingHere = function ()
		{
			return !!Tree.Creating && Tree.Creating.Parent === controller.node.Id;
		};
	} ],
} );
