'use strict';

// Threads pane - filter, each thread with its anchor words and replies, reply, resolve, and the compose card.

angular.module( 'Consensus' ).controller( 'ThreadsController', [ '$scope', '$timeout', 'State', 'Client', 'Subplans', function ( $scope, $timeout, State, Client, Subplans )
{
	$scope.State = State;
	$scope.Busy = false;
	const BASE_FILTERS = [
		{ Value: 'all', Label: 'All threads' },
		{ Value: 'contested', Label: 'Contested' },
		{ Value: 'mine', Label: 'Waiting on me' },
	];
	const TAIL_FILTERS = [
		{ Value: 'resolved', Label: 'Resolved (waiting to be applied)' },
		{ Value: 'applied', Label: 'Applied' },
		{ Value: 'reopened', Label: 'Reopened' },
		{ Value: 'detached', Label: 'Detached' },
	];
	$scope.Filters = BASE_FILTERS.concat( TAIL_FILTERS );


	// One "Waiting on <participant>" filter per participant, from the settings.
	function build_filters()
	{
		let per_participant = State.Participants.map( function ( participant )
		{
			return { Value: 'turn:' + participant.Name, Label: 'Waiting on ' + participant.Display };
		} );
		$scope.Filters = BASE_FILTERS.concat( per_participant, TAIL_FILTERS );
	}


	function path( thread )
	{
		return '/api/proposals/' + encodeURIComponent( State.OpenId ) + '/threads' + ( thread ? '/' + thread.Id : '' );
	}


	function matches( thread )
	{
		if ( State.Filter.startsWith( 'turn:' ) )
		{
			return thread.Turn.includes( State.Filter.slice( 5 ) );
		}
		switch ( State.Filter )
		{
			case 'contested': return thread.Status === 'contested';
			case 'mine': return thread.WaitingOnMe;
			case 'resolved': return thread.State === 'resolved';
			case 'applied': return thread.State === 'applied';
			case 'reopened': return thread.State === 'reopened';
			case 'detached': return thread.Detached;
			default: return true;
		}
	}


	$scope.$watch( function () { return State.Participants; }, build_filters );


	// Detached threads first, then in the order of the text, whole-document threads last.
	function by_position( a, b )
	{
		if ( a.Detached !== b.Detached )
		{
			return a.Detached ? -1 : 1;
		}
		let a_start = a.Found ? a.Found.Start : Number.MAX_SAFE_INTEGER;
		let b_start = b.Found ? b.Found.Start : Number.MAX_SAFE_INTEGER;
		if ( a_start !== b_start )
		{
			return a_start - b_start;
		}
		return ( a.Created < b.Created ) ? -1 : 1;
	}


	$scope.Threads = function ()
	{
		if ( !State.Open )
		{
			return [];
		}
		return State.Open.Threads.filter( matches ).sort( by_position );
	};


	$scope.Select = function ( thread )
	{
		if ( State.Selected !== thread.Id )
		{
			State.Select( thread.Id );
		}
	};


	$scope.ScrollToAnchor = function ( thread, event )
	{
		event.stopPropagation();
		State.Select( thread.Id );
	};


	//-----------------------------------------------------------------
	// Collapsed replies, by reply id, kept in State so a reload keeps them.

	$scope.IsCollapsed = function ( reply )
	{
		return State.Collapsed[ reply.Id ] === true;
	};


	$scope.ToggleReply = function ( reply, event )
	{
		event.stopPropagation();
		if ( State.Collapsed[ reply.Id ] )
		{
			delete State.Collapsed[ reply.Id ];
		}
		else
		{
			State.Collapsed[ reply.Id ] = true;
		}
	};


	// Collapse every reply but the most recent one.
	$scope.CollapseEarlier = function ( thread, event )
	{
		event.stopPropagation();
		let last_index = thread.Replies.length - 1;
		for ( let index = 0; index < last_index; index++ )
		{
			State.Collapsed[ thread.Replies[ index ].Id ] = true;
		}
		delete State.Collapsed[ thread.Replies[ last_index ].Id ];
	};


	$scope.ExpandAll = function ( thread, event )
	{
		event.stopPropagation();
		for ( let reply of thread.Replies )
		{
			delete State.Collapsed[ reply.Id ];
		}
	};


	$scope.CanResolve = function ( thread )
	{
		return State.Me && State.Me.Role === 'owner' && thread.Status === 'contested';
	};


	async function act( work )
	{
		$scope.Busy = true;
		let result = await State.Act( work );
		$scope.Busy = false;
		if ( result )
		{
			await State.Reload();
		}
		$scope.$applyAsync();
		return result;
	}


	$scope.Post = async function ()
	{
		let compose = State.Compose;
		if ( !compose || !compose.Text )
		{
			return;
		}
		let answer = await act( function ()
		{
			return Client.Post( path( null ), { Anchor: compose.Anchor, Text: compose.Text } );
		} );
		if ( answer )
		{
			State.CancelCompose();
			State.Select( answer.Thread.Id );
			$scope.$applyAsync();
		}
	};


	$scope.CancelCompose = function ()
	{
		State.CancelCompose();
	};


	$scope.Reply = async function ( thread )
	{
		let text = State.Drafts[ thread.Id ];
		if ( !text )
		{
			return;
		}
		let answer = await act( function ()
		{
			return Client.Post( path( thread ) + '/replies', { Text: text } );
		} );
		if ( answer )
		{
			delete State.Drafts[ thread.Id ];
			$scope.$applyAsync();
		}
	};


	$scope.Resolve = async function ( thread )
	{
		await act( function ()
		{
			return Client.Post( path( thread ) + '/resolve' );
		} );
	};


	// Reply and resolve: the owner's reply is the outcome, and the thread is resolved with it, in one request.
	$scope.ReplyAndResolve = async function ( thread )
	{
		let text = State.Drafts[ thread.Id ];
		if ( !text )
		{
			return;
		}
		let answer = await act( function ()
		{
			return Client.Post( path( thread ) + '/replies', { Text: text, Resolve: true } );
		} );
		if ( answer )
		{
			delete State.Drafts[ thread.Id ];
			$scope.$applyAsync();
		}
	};


	$scope.Reanchor = function ( thread )
	{
		State.StartReanchor( thread.Id );
	};


	//-----------------------------------------------------------------
	// Start a new Subplan from the thread being composed, or from a thread (with the draft reply, if any).

	$scope.IsPlan = function ()
	{
		return !!State.Open && ( State.Open.Proposal.Kind || 'plan' ) === 'plan';
	};


	$scope.SubplanFromCompose = function ()
	{
		if ( State.Compose )
		{
			Subplans.FromCompose( State.Compose );
		}
	};


	$scope.SubplanFromThread = function ( thread )
	{
		Subplans.FromThread( thread, State.Drafts[ thread.Id ] );
	};


	//-----------------------------------------------------------------
	// Delete: owner only, any thread, confirmed inline.

	$scope.Deleting = null;

	$scope.CanDelete = function ()
	{
		return !!State.Me && State.Me.Role === 'owner';
	};


	$scope.StartDelete = function ( thread, event )
	{
		event.stopPropagation();
		$scope.Deleting = thread.Id;
	};


	$scope.CancelDelete = function ( event )
	{
		event.stopPropagation();
		$scope.Deleting = null;
	};


	$scope.Delete = async function ( thread, event )
	{
		event.stopPropagation();
		let answer = await act( function ()
		{
			return Client.Delete( path( thread ) );
		} );
		$scope.Deleting = null;
		if ( answer && State.Selected === thread.Id )
		{
			State.Select( null );
		}
		$scope.$applyAsync();
	};


	$scope.$on( 'compose-started', function ()
	{
		$timeout( function ()
		{
			let box = document.getElementById( 'compose-text' );
			if ( box )
			{
				box.focus();
			}
		}, 0 );
	} );
} ] );
