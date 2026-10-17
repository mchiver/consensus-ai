'use strict';

// thread-list - the cards of the threads pane (plan UI Components, Step 1): the compose card while a comment is
// being written, then the listed threads in the pane's order (detached first, then by position in the text,
// whole-document threads last), or a line saying there are none. After your own Reply, Reply and Contest, Reply
// and resolve or Resolve (the Threads service's thread-done), the selection passes to the next listed thread
// (plan UI Tweaks VI).
//
// Interface:
//   <thread-list></thread-list>
//   reads State.Open, State.Compose, State.Filter, State.Selected; listens to thread-done

angular.module( 'Consensus' ).component( 'threadList', {
	templateUrl: '/components/thread-list/thread-list.html',
	controller: [ '$scope', '$timeout', 'State', 'Threads', function ( $scope, $timeout, State, Threads )
	{
		let controller = this;
		controller.State = State;
		controller.Listed = Threads.Listed;


		// The selection passes to the next thread in line: the next listed one after it in the pane's order (the
		// thread itself is still listed while selected; one the filter has just dropped is skipped), or the previous
		// one when it was the last, or none. The card scrolls into view, its reply form open.
		function move_on( thread_id )
		{
			let listed = Threads.Listed();
			let at = listed.findIndex( function ( candidate ) { return candidate.Id === thread_id; } );
			let next = null;
			if ( at >= 0 )
			{
				next = listed[ at + 1 ] || listed[ at - 1 ] || null;
			}
			else
			{
				next = listed[ 0 ] || null;
			}
			State.Select( next ? next.Id : null );
			if ( next )
			{
				$timeout( function ()
				{
					let card = document.getElementById( 'thread-' + next.Id );
					if ( card )
					{
						card.scrollIntoView( { block: 'nearest', behavior: 'smooth' } );
					}
				}, 0, false );
			}
		}


		$scope.$on( 'thread-done', function ( event, thread_id )
		{
			move_on( thread_id );
		} );
	} ],
} );
