'use strict';

// revisions-view - the record (plan UI Components, Step 2): each revision's reason, who, when, the thread it
// applied, and its text in an html-view without anchors.
//
// Interface:
//   <revisions-view></revisions-view>
//   reads State.Open, State.View; listens to view-changed and plan-loaded

angular.module( 'Consensus' ).component( 'revisionsView', {
	templateUrl: '/components/revisions-view/revisions-view.html',
	controller: [ '$scope', 'State', 'Client', function ( $scope, State, Client )
	{
		let controller = this;
		controller.State = State;
		controller.Revisions = [];
		controller.Shown = null;
		controller.ShownText = '';


		async function load()
		{
			if ( !State.Open )
			{
				return;
			}
			let answer = await State.Act( function ()
			{
				return Client.Get( '/api/plans/' + encodeURIComponent( State.OpenId ) + '/revisions' );
			} );
			controller.Revisions = answer ? answer.Revisions.slice().reverse() : [];
			let current = controller.Revisions.find( function ( revision ) { return controller.Shown && revision.Revision === controller.Shown.Revision; } );
			controller.Show( current || controller.Revisions[ 0 ] );
			$scope.$applyAsync();
		}


		controller.Show = async function ( revision )
		{
			if ( !revision )
			{
				controller.Shown = null;
				controller.ShownText = '';
				return;
			}
			let answer = await State.Act( function ()
			{
				return Client.Get( '/api/plans/' + encodeURIComponent( State.OpenId ) + '/revisions/' + revision.Revision );
			} );
			if ( answer )
			{
				controller.Shown = answer.Revision;
				controller.ShownText = answer.Revision.Text;
			}
			$scope.$applyAsync();
		};


		function thread_of( thread_id )
		{
			if ( !State.Open )
			{
				return null;
			}
			return State.Open.Threads.find( function ( candidate ) { return candidate.Id === thread_id; } ) || null;
		}


		// The thread a revision applied, in words; a deleted thread is named as such.
		controller.ThreadLabel = function ( thread_id )
		{
			let thread = thread_of( thread_id );
			if ( !thread )
			{
				return '(deleted thread)';
			}
			return 'thread “' + ( thread.Anchor ? thread.Anchor.Text : 'the whole document' ) + '”';
		};


		controller.ThreadExists = function ( thread_id )
		{
			return !!thread_of( thread_id );
		};


		controller.OpenThread = function ( revision, event )
		{
			event.stopPropagation();
			if ( !thread_of( revision.Thread ) )
			{
				return;
			}
			State.SetView( 'read' );
			State.Select( revision.Thread );
		};


		$scope.$on( 'view-changed', function ( event, name )
		{
			if ( name === 'revisions' )
			{
				load();
			}
		} );

		$scope.$on( 'plan-loaded', function ()
		{
			if ( State.View === 'revisions' )
			{
				load();
			}
			else
			{
				// another plan's list is never shown, even for a moment, when the view comes back
				controller.Shown = null;
				controller.ShownText = '';
				controller.Revisions = [];
			}
		} );
	} ],
} );
