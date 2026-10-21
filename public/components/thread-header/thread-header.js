'use strict';

// thread-header - the first lines of a thread card (plan UI Components, Step 1): the state badge, detached,
// who it waits on, on the selected thread Re-anchor and Start a new Subplan as icon buttons (plan UI Tweaks IX;
// the reply row had them), the owner's delete with its inline confirmation, and the anchor words (a click shows
// the passage in the text) or "the whole document".
//
// Interface:
//   <thread-header thread="..."></thread-header>
//   thread  the thread as the server lists it
//   deletes, re-anchors and starts a Subplan through the Threads service; selects through State.Select

angular.module( 'Consensus' ).component( 'threadHeader', {
	templateUrl: '/components/thread-header/thread-header.html',
	bindings: { thread: '<' },
	controller: [ 'State', 'Threads', function ( State, Threads )
	{
		let controller = this;
		controller.Threads = Threads;
		controller.Deleting = false;


		controller.Selected = function ()
		{
			return State.Selected === controller.thread.Id;
		};


		controller.Reanchor = function ( event )
		{
			event.stopPropagation();
			Threads.Reanchor( controller.thread );
		};


		controller.Subplan = function ( event )
		{
			event.stopPropagation();
			Threads.SubplanFromThread( controller.thread );
		};


		controller.CanDelete = function ()
		{
			return Threads.CanDelete();
		};


		controller.ScrollToAnchor = function ( event )
		{
			event.stopPropagation();
			State.Select( controller.thread.Id );
		};


		controller.StartDelete = function ( event )
		{
			event.stopPropagation();
			controller.Deleting = true;
		};


		controller.CancelDelete = function ( event )
		{
			event.stopPropagation();
			controller.Deleting = false;
		};


		controller.Delete = async function ( event )
		{
			event.stopPropagation();
			await Threads.Delete( controller.thread );
			controller.Deleting = false;
		};
	} ],
} );
