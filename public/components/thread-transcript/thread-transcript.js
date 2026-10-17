'use strict';

// thread-transcript - a thread's replies (plan UI Components, Step 1): each with who and when, its markdown
// rendered, collapsed or expanded (the choice kept in State.Collapsed, so a reload keeps it), the collapse
// controls when there are several, and the resolved and applied records.
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


		controller.IsCollapsed = function ( reply )
		{
			return State.Collapsed[ reply.Id ] === true;
		};


		controller.ToggleReply = function ( reply, event )
		{
			event.stopPropagation();
			if ( State.Collapsed[ reply.Id ] )
			{
				delete State.Collapsed[ reply.Id ];
			}
			else
			{
				State.Collapsed[ reply.Id ] = true;
			}
		};


		// Collapse every reply but the most recent one.
		controller.CollapseEarlier = function ( event )
		{
			event.stopPropagation();
			let replies = controller.thread.Replies;
			let last_index = replies.length - 1;
			for ( let index = 0; index < last_index; index++ )
			{
				State.Collapsed[ replies[ index ].Id ] = true;
			}
			delete State.Collapsed[ replies[ last_index ].Id ];
		};


		controller.ExpandAll = function ( event )
		{
			event.stopPropagation();
			for ( let reply of controller.thread.Replies )
			{
				delete State.Collapsed[ reply.Id ];
			}
		};
	} ],
} );
