'use strict';

// thread-filters - the row above the thread list (plan UI Components, Step 1): the "Waiting on ..." filter, the
// count of listed threads, and the Highlight picker. Both choices are global and remembered in the browser; a
// change goes out as State's filter-changed or highlight-changed, which the views that show threads listen to.
//
// Interface:
//   <thread-filters></thread-filters>
//   reads State.Filter, State.Highlight, State.Participants; sets them through State.SetFilter and State.SetHighlight

angular.module( 'Consensus' ).component( 'threadFilters', {
	templateUrl: '/components/thread-filters/thread-filters.html',
	controller: [ '$scope', 'State', 'Threads', function ( $scope, State, Threads )
	{
		const BASE_FILTERS = [
			{ Value: 'all', Label: 'All threads' },
			{ Value: 'contested', Label: 'Contested' },
			{ Value: 'mine', Label: 'Waiting on me' },
		];
		const TAIL_FILTERS = [
			{ Value: 'resolved', Label: 'Resolved (waiting to be applied)' },
			{ Value: 'applied', Label: 'Applied' },
			{ Value: 'reopened', Label: 'Reopened' },
			{ Value: 'detached', Label: 'Detached' },
		];
		let controller = this;
		controller.State = State;
		controller.Filters = BASE_FILTERS.concat( TAIL_FILTERS );
		controller.Highlights = [
			{ Value: 'all', Label: 'Highlight all threads' },
			{ Value: 'open', Label: 'Highlight open threads' },
		];


		// One "Waiting on <participant>" filter per participant, from the settings.
		function build_filters()
		{
			let per_participant = State.Participants.map( function ( participant )
			{
				return { Value: 'turn:' + participant.Name, Label: 'Waiting on ' + participant.Display };
			} );
			controller.Filters = BASE_FILTERS.concat( per_participant, TAIL_FILTERS );
		}


		controller.Count = function ()
		{
			return Threads.Listed().length;
		};


		controller.SetFilter = function ()
		{
			State.SetFilter( State.Filter );
		};


		controller.SetHighlight = function ()
		{
			State.SetHighlight( State.Highlight );
		};


		$scope.$watch( function () { return State.Participants; }, build_filters );
	} ],
} );
