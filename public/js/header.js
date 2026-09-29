'use strict';

// Header - two lines. The first: the title, Read / Edit / Revisions and the threads toggle. The second: the
// state picker and the one-line state, then New Comment, New subplan, Review and Build (owner). Delete is in the
// item's menu in the tree. Ctrl+E switches the open item between Edit and Read.

angular.module( 'Consensus' ).controller( 'HeaderController', [ '$scope', '$window', 'State', 'Client', 'Sessions', 'Subplans', 'Builds', function ( $scope, $window, State, Client, Sessions, Subplans, Builds )
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


	// A plan has threads; a document or a context has none, so it has no toggle and nothing to send.
	$scope.HasThreads = function ()
	{
		return !!State.Open && State.Open.Proposal.Kind !== 'document' && State.Open.Proposal.Kind !== 'context';
	};


	// A plan (not a document or a context) takes Subplans.
	$scope.IsPlan = function ()
	{
		return !!State.Open && ( State.Open.Proposal.Kind || 'plan' ) === 'plan';
	};


	$scope.NewSubplan = function ()
	{
		Subplans.Start();
	};


	$scope.IsContext = function ()
	{
		return !!State.Open && State.Open.Proposal.Kind === 'context';
	};


	$scope.ToggleThreads = function ()
	{
		State.SetThreadsHidden( !State.ThreadsHidden );
	};


	// Initialize context: the LLM writes the open context from its project. The call runs in the background; the
	// new revision arrives live.
	$scope.InitializeContext = async function ()
	{
		if ( !State.Open || !State.Open.Project )
		{
			return;
		}
		$scope.Busy = true;
		let project_id = State.Open.Project.Id;
		let answer = await State.Act( function ()
		{
			return Client.Post( '/api/projects/' + encodeURIComponent( project_id ) + '/context/initialize' );
		} );
		$scope.Busy = false;
		if ( answer )
		{
			await State.Reload();
		}
		$scope.$applyAsync();
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


	$scope.SendHint = function ()
	{
		if ( !State.Open || !State.Open.Llm.Configured )
		{
			return '';
		}
		let llm = State.Open.Llm;
		if ( llm.Running )
		{
			return 'a session is running; its log is in the session panel';
		}
		return 'open the review panel: shape the prompt, pick where it goes, and follow the run log (' + llm.Waiting + ' thread' + ( llm.Waiting === 1 ? '' : 's' ) + ' waiting on the LLM)';
	};


	// Review opens (or closes) the plan's review panel for the whole plan; the session starts from there.
	$scope.Send = function ()
	{
		Sessions.ReviewPlan( State.OpenId );
	};


	// Build (plan Build): shown for the owner on a plan whose project has a workspace; enabled when it can go now.
	$scope.CanBuild = function ()
	{
		return !!State.Open && !!State.Open.Build && State.Me.Role === 'owner' && State.Open.Build.Reason !== 'the project names no workspace';
	};


	$scope.BuildHint = function ()
	{
		let view = State.Open && State.Open.Build;
		if ( !view )
		{
			return '';
		}
		if ( !view.Ready )
		{
			return 'not now: ' + view.Reason;
		}
		return view.SentBack ? 'build again, with your reply to the last build log' : 'the worker builds the plan in the project\'s workspace and posts a build log';
	};


	$scope.Build = function ()
	{
		Builds.Open( State.Open );
	};
} ] );
