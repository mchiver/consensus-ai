'use strict';

// Header - two lines. The first: the title, Read / Edit / Revisions and the threads toggle. The second: the
// state picker and the one-line state, then New Comment and New subplan. Delete is in the item's menu in the
// tree. Ctrl+E switches the open item between Edit and Read.

angular.module( 'Consensus' ).controller( 'HeaderController', [ '$scope', '$window', 'State', 'Client', 'Subplans', function ( $scope, $window, State, Client, Subplans )
{
	$scope.State = State;
	$scope.Busy = false;


	$scope.SetView = function ( view )
	{
		State.SetView( view );
	};


	// Ctrl+E: Edit from Read or Revisions, and back to Read from Edit (an unsaved edit is kept, as the Read button
	// keeps it). Heard before the editor or the browser act on it, so it works in the editor too.
	function on_key( event )
	{
		let ctrl = event.ctrlKey || event.metaKey;
		if ( !ctrl || event.shiftKey || event.altKey || ( event.key !== 'e' && event.key !== 'E' ) )
		{
			return;
		}
		if ( !State.Open || !State.OpenId || [ 'read', 'edit', 'revisions' ].indexOf( State.View ) < 0 )
		{
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		$scope.$applyAsync( function ()
		{
			State.SetView( ( State.View === 'edit' ) ? 'read' : 'edit' );
		} );
	}

	window.addEventListener( 'keydown', on_key, true );
	$scope.$on( '$destroy', function () { window.removeEventListener( 'keydown', on_key, true ); } );


	// A plan has threads; a document has none, so it has no toggle.
	$scope.HasThreads = function ()
	{
		return !!State.Open && State.Open.Proposal.Kind !== 'document';
	};


	// A plan (not a document) takes Subplans.
	$scope.IsPlan = function ()
	{
		return !!State.Open && ( State.Open.Proposal.Kind || 'plan' ) === 'plan';
	};


	$scope.NewSubplan = function ()
	{
		Subplans.Start();
	};


	// The open document is its project's Readme.
	$scope.IsContext = function ()
	{
		return !!State.Open && !!State.Open.Context;
	};


	$scope.ToggleThreads = function ()
	{
		State.SetThreadsHidden( !State.ThreadsHidden );
	};


	$scope.CommentOnWhole = function ()
	{
		State.StartCompose( null );
	};


	// The state picker: any of the settings' States, by anyone, at any time.
	$scope.PickedState = null;

	$scope.$watch( function () { return State.Open ? State.Open.Proposal.State : null; }, function ( current )
	{
		$scope.PickedState = current;
	} );


	// The settings' States, plus the proposal's own when the settings no longer name it.
	$scope.StateOptions = function ()
	{
		if ( !State.Open || State.States.includes( State.Open.Proposal.State ) )
		{
			return State.States;
		}
		return State.States.concat( [ State.Open.Proposal.State ] );
	};


	$scope.SetState = async function ()
	{
		let wanted = $scope.PickedState;
		if ( !State.Open || wanted === State.Open.Proposal.State )
		{
			return;
		}
		$scope.Busy = true;
		let answer = await State.Act( function ()
		{
			return Client.Put( '/api/proposals/' + encodeURIComponent( State.OpenId ) + '/state', { State: wanted } );
		} );
		$scope.Busy = false;
		if ( answer )
		{
			await State.Reload();
			State.LoadList();
		}
		else
		{
			$scope.PickedState = State.Open ? State.Open.Proposal.State : null;
		}
		$scope.$applyAsync();
	};


} ] );
