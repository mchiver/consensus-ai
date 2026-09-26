'use strict';

// Header - two lines. The first: the title, Read / Edit / Revisions and the threads toggle. The second: the
// state picker and the one-line state, then Comment on the whole document, Send to LLM (owner), and Delete
// (to the trash, confirmed inline).

angular.module( 'Consensus' ).controller( 'HeaderController', [ '$scope', '$window', 'State', 'Client', 'Tabs', function ( $scope, $window, State, Client, Tabs )
{
	$scope.State = State;
	$scope.Busy = false;
	$scope.ConfirmingDelete = false;


	$scope.SetView = function ( view )
	{
		State.SetView( view );
	};


	// A plan has threads; a document or a context has none, so it has no toggle and nothing to send.
	$scope.HasThreads = function ()
	{
		return !!State.Open && State.Open.Proposal.Kind !== 'document' && State.Open.Proposal.Kind !== 'context';
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
			return 'the LLM is answering; its replies appear when it is done';
		}
		if ( !llm.Waiting )
		{
			return 'nothing is waiting on the LLM';
		}
		return 'hand the LLM the ' + llm.Waiting + ' thread' + ( llm.Waiting === 1 ? '' : 's' ) + ' waiting on it';
	};


	$scope.Send = async function ()
	{
		$scope.Busy = true;
		let answer = await State.Act( function ()
		{
			return Client.Post( '/api/proposals/' + encodeURIComponent( State.OpenId ) + '/send' );
		} );
		$scope.Busy = false;
		if ( answer )
		{
			await State.Reload();
		}
		$scope.$applyAsync();
	};


	$scope.Delete = async function ()
	{
		let id = State.OpenId;
		$scope.Busy = true;
		let answer = await State.Act( function ()
		{
			return Client.Delete( '/api/proposals/' + encodeURIComponent( id ) );
		} );
		$scope.Busy = false;
		$scope.ConfirmingDelete = false;
		if ( answer )
		{
			// its tab closes, and the one beside it is shown
			Tabs.CloseItem( id );
			State.LoadList();
		}
		$scope.$applyAsync();
	};


	$scope.$on( 'proposal-loaded', function ()
	{
		$scope.ConfirmingDelete = false;
	} );
} ] );
