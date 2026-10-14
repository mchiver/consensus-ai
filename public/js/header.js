'use strict';

// Header - two lines. The first: the title and Read / Edit / Revisions (the threads toggle is in the tabs row,
// tabs.js, since plan UI Tweaks V). The second: the state picker and the one-line state, then New Comment and New
// subplan. Delete is in the item's menu in the tree. Ctrl+E (hotkeys.js, plan UI Tweaks VI) switches the open item
// between Edit and Read.

angular.module( 'Consensus' ).controller( 'HeaderController', [ '$scope', '$window', 'State', 'Client', 'Subplans', 'Llms', 'Roots', function ( $scope, $window, State, Client, Subplans, Llms, Roots )
{
	$scope.State = State;
	$scope.Busy = false;


	// The open item's server, named beside the title when the page shows several (plan Run Shapes, Step 5).
	$scope.RootName = function ()
	{
		return ( Roots.Several() && State.Root ) ? State.Root.Name : '';
	};


	// The title when no plan is open: the waiting view, or an LLM connection of the server (plan Run Shapes, Step 3).
	$scope.EmptyTitle = function ()
	{
		if ( State.View === 'waiting' )
		{
			return 'Waiting on you';
		}
		if ( State.View === 'llm' && State.OpenItem )
		{
			let llm = Llms.LlmById( State.OpenItem.Id );
			return 'LLM connection ' + ( llm ? llm.Name : State.OpenItem.Id ) + ( llm && llm.Participant ? ' (' + llm.Participant + ')' : '' );
		}
		return 'Consensus';
	};


	$scope.SetView = function ( view )
	{
		State.SetView( view );
	};


	// A plan has threads; a document has none, so it has no toggle.
	$scope.HasThreads = function ()
	{
		return !!State.Open && State.Open.Plan.Kind !== 'document';
	};


	// A plan (not a document) takes Subplans.
	$scope.IsPlan = function ()
	{
		return !!State.Open && ( State.Open.Plan.Kind || 'plan' ) === 'plan';
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

	$scope.$watch( function () { return State.Open ? State.Open.Plan.State : null; }, function ( current )
	{
		$scope.PickedState = current;
	} );


	// The project's States (the settings' when it has none; plan Run Shapes, Step 2), plus the plan's own when
	// the list no longer names it.
	$scope.StateOptions = function ()
	{
		let states = State.States;
		let project = ( State.Open && State.Open.Project ) ? State.Projects.find( function ( candidate ) { return candidate.Id === State.Open.Project.Id; } ) : null;
		if ( project && Array.isArray( project.States ) && project.States.length )
		{
			states = project.States;
		}
		if ( !State.Open || states.includes( State.Open.Plan.State ) )
		{
			return states;
		}
		return states.concat( [ State.Open.Plan.State ] );
	};


	// An archived plan (plan Run Shapes, Step 2) is read and never written until it is restored from the tree.
	$scope.IsArchived = function ()
	{
		return !!( State.Open && State.Open.Plan && State.Open.Plan.Archived );
	};


	$scope.SetState = async function ()
	{
		let wanted = $scope.PickedState;
		if ( !State.Open || wanted === State.Open.Plan.State )
		{
			return;
		}
		$scope.Busy = true;
		let answer = await State.Act( function ()
		{
			return Client.Put( '/api/plans/' + encodeURIComponent( State.OpenId ) + '/state', { State: wanted } );
		} );
		$scope.Busy = false;
		if ( answer )
		{
			await State.Reload();
			State.LoadList();
		}
		else
		{
			$scope.PickedState = State.Open ? State.Open.Plan.State : null;
		}
		$scope.$applyAsync();
	};


} ] );
