'use strict';

// document-editor - the open plan or document (plan UI Components, Step 2): its editor-header, the re-anchor hint
// while a thread is being re-anchored (above whichever view is shown; plan Markdown Editor, Step 2), then the view
// State.View names: Read (an html-view with the anchors), Edit (edit-view) or Revisions (revisions-view). State.View stays the switch, so the tabs'
// RestoreView, the hotkeys and the links in the texts work as they did. The Read view's scroll is kept per tab (plan
// UI Tweaks IX): taken into the tab's record when the open item changes, put back once the next text is drawn.
//
// Interface:
//   <document-editor></document-editor>
//   reads State.Open, State.View, State.Reanchoring

angular.module( 'Consensus' ).component( 'documentEditor', {
	templateUrl: '/components/document-editor/document-editor.html',
	controller: [ '$scope', '$element', '$timeout', 'State', 'Tabs', function ( $scope, $element, $timeout, State, Tabs )
	{
		let controller = this;
		controller.State = State;


		function read_view()
		{
			return $element[ 0 ].querySelector( '.read' );
		}


		// The item changed: the Read view's scroll is still the last item's, so it goes into that tab.
		$scope.$watch( function () { return State.OpenId; }, function ( now, before )
		{
			let read = read_view();
			if ( before && before !== now && read )
			{
				Tabs.SetPlace( before, { Read: read.scrollTop } );
			}
		} );


		// The next item drawn: its scroll put back, or the top.
		$scope.$on( 'plan-loaded', function ()
		{
			if ( !State.Open || State.MirrorShown() )
			{
				return;
			}
			let id = State.OpenId;
			$timeout( function ()
			{
				let read = read_view();
				if ( read && State.OpenId === id )
				{
					let place = Tabs.PlaceOf( id );
					read.scrollTop = ( place && place.Read ) ? place.Read : 0;
				}
			}, 0, false );
		} );


		controller.CancelReanchor = function ()
		{
			State.CancelReanchor();
		};
	} ],
} );
