'use strict';

// Search view - the best chunks in one project, or everywhere: plans, documents, threads and corpus files.
// A hit opens its proposal at the passage or the thread, or its corpus.

angular.module( 'Consensus' ).controller( 'SearchController', [ '$scope', 'State', 'Client', function ( $scope, State, Client )
{
	$scope.State = State;
	$scope.Query = '';
	$scope.Hits = [];
	$scope.Searched = false;


	// Within one project when Project is given, otherwise across everything.
	async function search( query, project )
	{
		$scope.Query = query;
		$scope.Searched = false;
		let path = '/api/search?q=' + encodeURIComponent( query ) + '&limit=20';
		if ( project )
		{
			path += '&project=' + encodeURIComponent( project );
		}
		let answer = await State.Act( function () { return Client.Get( path ); } );
		$scope.Hits = answer ? answer.Hits : [];
		$scope.Searched = true;
		$scope.$applyAsync();
	}


	$scope.Open = function ( hit )
	{
		if ( hit.Corpus )
		{
			State.PendingFile = hit.Path;
		}
		else if ( hit.Thread )
		{
			State.Pend( { Select: hit.Thread } );
		}
		else
		{
			State.Pend( { Scroll: hit.Text } );
		}
	};


	$scope.ProjectName = function ()
	{
		let project = State.Projects.find( function ( candidate ) { return candidate.Id === State.SearchProject; } );
		return project ? project.Name : ( State.SearchProject || '' );
	};


	$scope.$on( 'search-requested', function ( event, query, project )
	{
		search( query, project );
	} );
} ] );
