'use strict';

// Header - two lines. The first: the title and Read / Edit / Revisions (the threads toggle is in the tabs row,
// tabs.js, since plan UI Tweaks V). The second: the state picker and the one-line state, then New Comment and New
// subplan. Delete is in the item's menu in the tree. Ctrl+E switches the open item between Edit and Read.

angular.module( 'Consensus' ).controller( 'HeaderController', [ '$scope', '$window', 'State', 'Client', 'Subplans', 'DesktopItems', function ( $scope, $window, State, Client, Subplans, DesktopItems )
{
	$scope.State = State;
	$scope.Busy = false;


	// The title when no proposal is open: the waiting view, or the desktop's LLM connection or workspace (Step 3).
	$scope.EmptyTitle = function ()
	{
		if ( State.View === 'waiting' )
		{
			return 'Waiting on you';
		}
		if ( State.View === 'llm' && State.OpenItem )
		{
			let llm = DesktopItems.LlmById( State.OpenItem.Id );
			let project = State.Projects.find( function ( candidate ) { return candidate.Id === State.OpenItem.Project; } );
			return 'LLM connection ' + ( llm ? llm.Name : State.OpenItem.Id ) + ( project ? ' in ' + project.Name : '' );
		}
		if ( State.View === 'workspace' && State.OpenItem )
		{
			let workspace = DesktopItems.WorkspaceById( State.OpenItem.Id );
			return 'Workspace ' + ( workspace ? workspace.Name : State.OpenItem.Id );
		}
		return 'Consensus';
	};


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
		if ( !State.Open || !State.OpenId || [ 'read', 'edit', 'revisions' ].indexOf( State.View ) < 0 || $scope.IsArchived() )
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


	// The project's States (the settings' when it has none; plan Run Shapes, Step 2), plus the proposal's own when
	// the list no longer names it.
	$scope.StateOptions = function ()
	{
		let states = State.States;
		let project = ( State.Open && State.Open.Project ) ? State.Projects.find( function ( candidate ) { return candidate.Id === State.Open.Project.Id; } ) : null;
		if ( project && Array.isArray( project.States ) && project.States.length )
		{
			states = project.States;
		}
		if ( !State.Open || states.includes( State.Open.Proposal.State ) )
		{
			return states;
		}
		return states.concat( [ State.Open.Proposal.State ] );
	};


	// An archived plan (plan Run Shapes, Step 2) is read and never written until it is restored from the tree.
	$scope.IsArchived = function ()
	{
		return !!( State.Open && State.Open.Proposal && State.Open.Proposal.Archived );
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
