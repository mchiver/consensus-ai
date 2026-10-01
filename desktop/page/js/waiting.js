'use strict';

// Waiting view - everything waiting on you, across proposals, grouped by proposal.

angular.module( 'Consensus' ).controller( 'WaitingController', [ '$scope', 'State', 'Client', function ( $scope, State, Client )
{
	$scope.State = State;
	$scope.Items = [];
	$scope.Groups = [];


	async function load()
	{
		let answer = await State.Act( function () { return Client.Get( '/api/waiting' ); } );
		$scope.Items = answer ? answer.Waiting : [];
		let groups = [];
		let by_id = {};
		for ( let item of $scope.Items )
		{
			let group = by_id[ item.Proposal.Id ];
			if ( !group )
			{
				group = { Proposal: item.Proposal, Items: [] };
				by_id[ item.Proposal.Id ] = group;
				groups.push( group );
			}
			group.Items.push( item );
		}
		$scope.Groups = groups;
		$scope.$applyAsync();
	}


	$scope.Open = function ( item )
	{
		State.Pend( { Select: item.Thread.Id } );
	};


	$scope.$on( 'view-changed', function ( event, view )
	{
		if ( view === 'waiting' )
		{
			load();
		}
	} );

	$scope.$on( 'changed', function ()
	{
		if ( State.View === 'waiting' )
		{
			load();
		}
	} );
} ] );
