'use strict';

// Waiting view - everything waiting on you, across plans and across every root (plan Run Shapes, Step 5),
// grouped by plan; each group names its server when the page shows more than one.

angular.module( 'Consensus' ).controller( 'WaitingController', [ '$scope', 'State', 'Client', 'Roots', function ( $scope, State, Client, Roots )
{
	$scope.State = State;
	$scope.Roots = Roots;
	$scope.Items = [];
	$scope.Groups = [];
	$scope.HashFor = Roots.HashFor;


	async function load()
	{
		let items = [];
		for ( let root of Roots.List )
		{
			let answer = null;
			try
			{
				answer = await Client.Get( root, '/api/waiting' );
			}
			catch ( error )
			{
				continue;
			}
			for ( let item of answer.Waiting || [] )
			{
				item.Root = root;
				items.push( item );
			}
		}
		$scope.Items = items;
		let groups = [];
		let by_key = {};
		for ( let item of items )
		{
			let key = item.Root.Key + '|' + item.Plan.Id;
			let group = by_key[ key ];
			if ( !group )
			{
				group = { Plan: item.Plan, Root: item.Root, Items: [] };
				by_key[ key ] = group;
				groups.push( group );
			}
			group.Items.push( item );
		}
		$scope.Groups = groups;
		$scope.$applyAsync();
	}


	// The display name of who replied, on the item's own server.
	$scope.DisplayOn = function ( item, name )
	{
		let participant = ( item.Root.Participants || [] ).find( function ( candidate ) { return candidate.Name === name; } );
		return participant ? participant.Display : name;
	};


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
