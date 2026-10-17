'use strict';

// thread-card - one thread in the pane (plan UI Components, Step 1): the card's edge and badge colours by state,
// selected, detached and mine; a click selects it. Inside: thread-header, thread-transcript and, while selected,
// thread-actions with its reply box.
//
// Interface:
//   <thread-card thread="..."></thread-card>
//   thread  the thread as the server lists it
//   reads State.Selected; selects through State.Select

angular.module( 'Consensus' ).component( 'threadCard', {
	templateUrl: '/components/thread-card/thread-card.html',
	bindings: { thread: '<' },
	controller: [ 'State', function ( State )
	{
		let controller = this;


		controller.Selected = function ()
		{
			return !!controller.thread && controller.thread.Id === State.Selected;
		};


		controller.Select = function ()
		{
			if ( !controller.Selected() )
			{
				State.Select( controller.thread.Id );
			}
		};
	} ],
} );
