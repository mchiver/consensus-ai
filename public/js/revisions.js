'use strict';

// Revisions view - the record: each revision's reason, who, when, the thread it applied, and its text.

angular.module( 'Consensus' ).controller( 'RevisionsController', [ '$scope', 'State', 'Client', 'Render', function ( $scope, State, Client, Render )
{
	$scope.State = State;
	$scope.Revisions = [];
	$scope.Shown = null;
	let view = document.getElementById( 'revision-view' );


	async function load()
	{
		if ( !State.Open )
		{
			return;
		}
		let answer = await State.Act( function ()
		{
			return Client.Get( '/api/proposals/' + encodeURIComponent( State.OpenId ) + '/revisions' );
		} );
		$scope.Revisions = answer ? answer.Revisions.slice().reverse() : [];
		let current = $scope.Revisions.find( function ( revision ) { return $scope.Shown && revision.Revision === $scope.Shown.Revision; } );
		$scope.Show( current || $scope.Revisions[ 0 ] );
		$scope.$applyAsync();
	}


	$scope.Show = async function ( revision )
	{
		if ( !revision )
		{
			$scope.Shown = null;
			view.innerHTML = '';
			return;
		}
		let answer = await State.Act( function ()
		{
			return Client.Get( '/api/proposals/' + encodeURIComponent( State.OpenId ) + '/revisions/' + revision.Revision );
		} );
		if ( answer )
		{
			$scope.Shown = answer.Revision;
			view.innerHTML = Render.Html( answer.Revision.Text );
		}
		$scope.$applyAsync();
	};


	$scope.ThreadWords = function ( thread_id )
	{
		if ( !State.Open )
		{
			return thread_id;
		}
		let thread = State.Open.Threads.find( function ( candidate ) { return candidate.Id === thread_id; } );
		if ( !thread )
		{
			return thread_id;
		}
		return thread.Anchor ? thread.Anchor.Text : 'the whole document';
	};


	$scope.OpenThread = function ( revision, event )
	{
		event.stopPropagation();
		State.SetView( 'read' );
		State.Select( revision.Thread );
	};


	$scope.$on( 'view-changed', function ( event, name )
	{
		if ( name === 'revisions' )
		{
			load();
		}
	} );

	$scope.$on( 'proposal-loaded', function ()
	{
		if ( State.View === 'revisions' )
		{
			load();
		}
		else
		{
			$scope.Shown = null;
		}
	} );
} ] );
