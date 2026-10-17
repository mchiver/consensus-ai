'use strict';

// thread-compose - the card of a comment being written (plan UI Components, Step 1): the anchor words or "the
// whole document", the comment-editor over State.Compose.Text, and Comment, the owner's Comment and resolve,
// Start a new Subplan on a plan, and Cancel. Ctrl+Enter in the box is Comment. The card exists while
// State.Compose does (thread-list shows it with ng-if), so its box takes the focus as it appears.
//
// Interface:
//   <thread-compose></thread-compose>
//   reads State.Compose; acts through the Threads service

angular.module( 'Consensus' ).component( 'threadCompose', {
	templateUrl: '/components/thread-compose/thread-compose.html',
	controller: [ 'State', 'Threads', function ( State, Threads )
	{
		let controller = this;
		controller.State = State;
		controller.Threads = Threads;


		controller.HasText = function ()
		{
			return !!State.Compose && !!State.Compose.Text;
		};


		controller.Post = function ( Resolve )
		{
			Threads.Post( Resolve );
		};


		controller.Subplan = function ()
		{
			Threads.SubplanFromCompose();
		};


		controller.Cancel = function ()
		{
			State.CancelCompose();
		};


		// The primary button, for Ctrl+Enter in the box.
		controller.Primary = function ()
		{
			if ( controller.HasText() && !Threads.Busy )
			{
				controller.Post( false );
			}
		};
	} ],
} );
