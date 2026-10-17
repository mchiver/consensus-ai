'use strict';

// thread-actions - the reply form of the selected thread (plan UI Components, Step 1): the comment-editor over
// the thread's draft (State.Drafts, kept per thread) and the buttons: Reply (Reply and Contest on a resolved
// thread), the owner's Reply and resolve and Resolve, Re-anchor, and Start a new Subplan on a plan. Ctrl+Enter
// in the box is Reply.
//
// Interface:
//   <thread-actions thread="..."></thread-actions>
//   thread  the thread as the server lists it
//   acts through the Threads service

angular.module( 'Consensus' ).component( 'threadActions', {
	templateUrl: '/components/thread-actions/thread-actions.html',
	bindings: { thread: '<' },
	controller: [ 'State', 'Threads', function ( State, Threads )
	{
		let controller = this;
		controller.State = State;
		controller.Threads = Threads;


		controller.Placeholder = function ()
		{
			return 'Reply' + ( controller.thread.Status === 'resolved' ? ' (reopens the thread)' : '' );
		};


		controller.HasDraft = function ()
		{
			return !!State.Drafts[ controller.thread.Id ];
		};


		controller.Reply = function ()
		{
			Threads.Reply( controller.thread );
		};


		controller.ReplyAndResolve = function ()
		{
			Threads.ReplyAndResolve( controller.thread );
		};


		controller.Resolve = function ()
		{
			Threads.Resolve( controller.thread );
		};


		controller.Reanchor = function ()
		{
			Threads.Reanchor( controller.thread );
		};


		controller.Subplan = function ()
		{
			Threads.SubplanFromThread( controller.thread );
		};


		controller.CanResolve = function ()
		{
			return Threads.CanResolve( controller.thread );
		};


		// The primary button, for Ctrl+Enter in the box.
		controller.Primary = function ()
		{
			if ( controller.HasDraft() && !Threads.Busy )
			{
				controller.Reply();
			}
		};
	} ],
} );
