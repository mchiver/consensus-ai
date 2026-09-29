'use strict';

// Build - the Build button's dialog (plan Build): which of the worker's claude-cli items builds the plan, and with
// which model. Build queues the job; the plan goes to Working, and the review panel opens on its run log. When the
// owner sent the last build back, the build runs again with the reply.
//
//   Builds.Pending = { Id, Title, Destinations: [ { Name, Model } ], Destination, Model, SentBack }

angular.module( 'Consensus' ).factory( 'Builds', [ function ()
{
	let builds = { Pending: null, Busy: false };


	// The dialog for the open plan, from its Build view.
	builds.Open = function ( Open )
	{
		let view = Open.Build;
		let first = view.Destinations[ 0 ] || null;
		builds.Pending = {
			Id: Open.Proposal.Id,
			Title: Open.Proposal.Title,
			Destinations: view.Destinations,
			Destination: first ? first.Name : null,
			Model: ( first && first.Model ) || '',
			SentBack: view.SentBack,
		};
	};


	return builds;
} ] )


.controller( 'BuildController', [ '$scope', 'State', 'Client', 'Builds', 'Sessions', function ( $scope, State, Client, Builds, Sessions )
{
	$scope.Builds = Builds;


	// A destination picked: its model, when it names one, is the default.
	$scope.Picked = function ()
	{
		let pending = Builds.Pending;
		let destination = pending.Destinations.find( function ( candidate ) { return candidate.Name === pending.Destination; } );
		pending.Model = ( destination && destination.Model ) || '';
	};


	$scope.Start = async function ()
	{
		let pending = Builds.Pending;
		if ( !pending || !pending.Destination )
		{
			return;
		}
		Builds.Busy = true;
		let answer = await State.Act( function ()
		{
			return Client.Post( '/api/proposals/' + encodeURIComponent( pending.Id ) + '/build', { Destination: pending.Destination, Model: pending.Model } );
		} );
		Builds.Busy = false;
		if ( answer )
		{
			Builds.Pending = null;
			// the run log is in the review panel
			Sessions.Panel( pending.Id ).Open = true;
			await State.Reload();
		}
		$scope.$applyAsync();
	};


	$scope.Cancel = function ()
	{
		Builds.Pending = null;
	};


	$scope.Key = function ( event )
	{
		if ( event.key === 'Escape' )
		{
			$scope.Cancel();
		}
	};
} ] );
