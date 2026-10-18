'use strict';

// thread-transcript - a thread's replies (plan UI Components, Step 1): each with who and when, its markdown
// rendered, collapsed or expanded (every reply but the most recent collapsed by default, plan UI Tweaks VIII; a
// choice made by hand is kept in State.Collapsed), the collapse controls when there are several, and the resolved
// and applied records.
//
// Interface:
//   <thread-transcript thread="..."></thread-transcript>
//   thread  the thread as the server lists it
//   reads and writes State.Collapsed

angular.module( 'Consensus' ).component( 'threadTranscript', {
	templateUrl: '/components/thread-transcript/thread-transcript.html',
	bindings: { thread: '<' },
	controller: [ 'State', function ( State )
	{
		let controller = this;


		// A reply with no recorded choice follows the default, "collapse earlier" (plan UI Tweaks VIII): in a thread
		// with several replies every reply but the most recent is collapsed; a recorded true or false is the choice.
		controller.IsCollapsed = function ( reply )
		{
			let choice = State.Collapsed[ reply.Id ];
			if ( choice === true || choice === false )
			{
				return choice;
			}
			let replies = controller.thread.Replies;
			if ( replies.length < 2 )
			{
				return false;
			}
			return replies[ replies.length - 1 ].Id !== reply.Id;
		};


		controller.ToggleReply = function ( reply, event )
		{
			event.stopPropagation();
			State.Collapsed[ reply.Id ] = !controller.IsCollapsed( reply );
		};


		// Back to the default: every reply but the most recent one collapsed.
		controller.CollapseEarlier = function ( event )
		{
			event.stopPropagation();
			for ( let reply of controller.thread.Replies )
			{
				delete State.Collapsed[ reply.Id ];
			}
		};


		controller.ExpandAll = function ( event )
		{
			event.stopPropagation();
			for ( let reply of controller.thread.Replies )
			{
				State.Collapsed[ reply.Id ] = false;
			}
		};
	} ],
} );
