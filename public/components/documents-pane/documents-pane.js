'use strict';

// documents-pane - the main column (plan UI Components, Step 2): the tab-bar, the error line, then what the
// active tab holds, picked by State.View and State.Open: document-editor for an open plan or document,
// llm-session for an LLM connection, waiting-list for Waiting on you, start-page with nothing open. The four stay
// in the page (shown or hidden), so the open document's editor, drafts and scroll positions survive a switch to
// another kind of tab and back.
//
// Interface:
//   <documents-pane></documents-pane>
//   reads State.View, State.Open, State.Error

angular.module( 'Consensus' ).component( 'documentsPane', {
	templateUrl: '/components/documents-pane/documents-pane.html',
	controller: [ 'State', function ( State )
	{
		const DOCUMENT_VIEWS = [ 'read', 'edit', 'revisions' ];
		let controller = this;
		controller.State = State;


		controller.ShowsDocument = function ()
		{
			return !!State.Open && DOCUMENT_VIEWS.includes( State.View );
		};


		controller.ShowsStart = function ()
		{
			return !State.Open && State.View !== 'llm' && State.View !== 'waiting' && State.View !== 'x' && State.View !== 'u';
		};
	} ],
} );
