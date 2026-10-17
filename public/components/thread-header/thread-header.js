'use strict';

// thread-header - the first lines of a thread card (plan UI Components, Step 1): the state badge, detached,
// who it waits on, the owner's delete with its inline confirmation, and the anchor words (a click shows the
// passage in the text) or "the whole document".
//
// Interface:
//   <thread-header thread="..."></thread-header>
//   thread  the thread as the server lists it
//   deletes through the Threads service; selects through State.Select

angular.module( 'Consensus' ).component( 'threadHeader', {
	templateUrl: '/components/thread-header/thread-header.html',
	bindings: { thread: '<' },
	controller: [ 'State', 'Threads', function ( State, Threads )
	{
		let controller = this;
		controller.Threads = Threads;
		controller.Deleting = false;


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
