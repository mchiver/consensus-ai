'use strict';

// llm-fold - the LLM connections of a server (plan UI Components, Step 4; plan Run Shapes, Step 3): the LLMs
// heading with its menu, the new-LLM form, and the list of connections, each with its badges, rename, inline delete
// and menu. New LLM, Rename and Delete are the owner's.
//
// Interface:
//   <llm-fold root="..." first="..."></llm-fold>
//   root   the root (roots.js); its connections through Llms.For( root )
//   first  true on the first root, which carries the ids the tests and the guide look for
//   the state and the actions through Tree

angular.module( 'Consensus' ).component( 'llmFold', {
	templateUrl: '/components/llm-fold/llm-fold.html',
	bindings: { root: '<', first: '<' },
	controller: [ 'Tree', 'Llms', function ( Tree, Llms )
	{
		let controller = this;
		controller.Tree = Tree;
		controller.Llms = Llms;


		// The new-LLM form shows at the top of the list while a connection is being made on this root.
		controller.CreatingHere = function ()
		{
			return !!Tree.Creating && Tree.Creating.Kind === 'llm' && Tree.Creating.Root === controller.root.Key;
		};
	} ],
} );
