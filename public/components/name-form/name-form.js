'use strict';

// name-form - the inline form that names a new thing in the tree (plan UI Components, Step 4): a project, a plan
// or document, a folder, an LLM connection. One input, Create and Cancel; for a new project in the desktop, the
// folder picker beneath (Tree.Creating.Path and Tree.PickProjectFolder).
//
// Interface:
//   <name-form model="..." placeholder="..." note="..." folder="..." depth="..." ids="..." submit="..." cancel="..."></name-form>
//   model        two-way: the name being typed
//   placeholder  the input's
//   note         a line under the input (the server a project is made on), when any
//   folder       true: the project's folder picker shows
//   depth        in a folder: the level the form is indented to
//   ids          the prefix of the input's and the button's ids: create (the default) or create-llm
//   submit       called on Enter or Create; cancel on Cancel

angular.module( 'Consensus' ).component( 'nameForm', {
	templateUrl: '/components/name-form/name-form.html',
	bindings: { model: '=', placeholder: '@', note: '@', folder: '<', depth: '<', ids: '@', submit: '&', cancel: '&' },
	controller: [ 'Tree', function ( Tree )
	{
		let controller = this;
		controller.Tree = Tree;


		controller.Prefix = function ()
		{
			return controller.ids || 'create';
		};
	} ],
} );
