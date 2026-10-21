'use strict';

// thread-actions - the reply form of the selected thread (plan UI Components, Step 1): the comment-editor over
// the thread's draft (State.Drafts, kept per thread) and the buttons: Reply (Reply and Contest on a resolved
// thread) and the owner's Resolve, which posts the draft as the outcome when there is one (plan UI Tweaks IX: one
// button; Reply and resolve went) and accepts the last reply's otherwise. Re-anchor and Start a new Subplan are in
// thread-header since the same plan. Ctrl+Enter in the box is Reply.
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


		// A draft in the box goes up as the outcome; none, the last reply's outcome or recommendation is accepted.
		controller.Resolve = function ()
		{
			if ( controller.HasDraft() )
			{
				Threads.ReplyAndResolve( controller.thread );
				return;
			}
			Threads.Resolve( controller.thread );
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
