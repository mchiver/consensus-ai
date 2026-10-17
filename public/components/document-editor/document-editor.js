'use strict';

// document-editor - the open plan or document (plan UI Components, Step 2): its editor-header, then the view
// State.View names: Read (an html-view with the anchors, under the re-anchor hint while a thread is being
// re-anchored), Edit (edit-view) or Revisions (revisions-view). State.View stays the switch, so the tabs'
// RestoreView, the hotkeys and the links in the texts work as they did.
//
// Interface:
//   <document-editor></document-editor>
//   reads State.Open, State.View, State.Reanchoring

angular.module( 'Consensus' ).component( 'documentEditor', {
	templateUrl: '/components/document-editor/document-editor.html',
	controller: [ 'State', function ( State )
	{
		let controller = this;
		controller.State = State;


		controller.CancelReanchor = function ()
		{
			State.CancelReanchor();
		};
	} ],
} );
