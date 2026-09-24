'use strict';

// Search view - the best chunks across proposals, plans and threads; a hit opens its proposal at the
// passage or the thread.

angular.module( 'Consensus' ).controller( 'SearchController', [ '$scope', 'State', 'Client', function ( $scope, State, Client )
{
	$scope.State = State;
	$scope.Query = '';
	$scope.Hits = [];
	$scope.Searched = false;


	async function search( query )
	{
		$scope.Query = query;
		$scope.Searched = false;
		let answer = await State.Act( function () { return Client.Get( '/api/search?q=' + encodeURIComponent( query ) + '&limit=20' ); } );
		$scope.Hits = answer ? answer.Hits : [];
		$scope.Searched = true;
		$scope.$applyAsync();
	}


	$scope.Open = function ( hit )
	{
		if ( hit.Thread )
		{
			State.Pend( { Select: hit.Thread } );
		}
		else
		{
			State.Pend( { Scroll: hit.Text } );
		}
	};


	$scope.$on( 'search-requested', function ( event, query )
	{
		search( query );
	} );
} ] );
