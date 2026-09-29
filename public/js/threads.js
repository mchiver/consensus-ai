'use strict';

// Threads pane - filter, highlight, each thread with its anchor words and replies, reply, resolve, and the compose
// card (Comment, or the owner's Comment and resolve).

angular.module( 'Consensus' ).controller( 'ThreadsController', [ '$scope', '$timeout', 'State', 'Client', 'Subplans', 'Sessions', function ( $scope, $timeout, State, Client, Subplans, Sessions )
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
	$scope.Highlights = [
		{ Value: 'all', Label: 'Highlight all threads' },
		{ Value: 'open', Label: 'Highlight open threads' },
	];


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


	// A selected thread the filter leaves out is deselected: by a change of filter, a change to the thread (a post, a
	// reply, a resolve), or a selection in the text.
	function selected_hidden()
	{
		if ( !State.Selected || !State.Open )
		{
			return false;
		}
		let thread = State.Open.Threads.find( function ( candidate ) { return candidate.Id === State.Selected; } );
		return !!thread && !matches( thread );
	}


	$scope.$watch( selected_hidden, function ( hidden )
	{
		if ( hidden )
		{
			State.Select( null );
		}
	} );


	$scope.SetHighlight = function ()
	{
		State.SetHighlight( State.Highlight );
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


	$scope.IsOwner = function ()
	{
		return !!State.Me && State.Me.Role === 'owner';
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


	// Comment; with Resolve (the owner's Comment and resolve), the thread is posted resolved, the comment its outcome.
	$scope.Post = async function ( Resolve )
	{
		let compose = State.Compose;
		if ( !compose || !compose.Text )
		{
			return;
		}
		let body = { Anchor: compose.Anchor, Text: compose.Text };
		if ( Resolve )
		{
			body.Resolve = true;
		}
		let answer = await act( function ()
		{
			return Client.Post( path( null ), body );
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


	// Review on a thread (plan Review): the owner has the LLM review it alone. An applied thread has nothing to review.
	$scope.CanReview = function ( thread )
	{
		return $scope.IsPlan() && $scope.IsOwner() && !!State.Open.Llm && State.Open.Llm.Configured && thread.State !== 'applied';
	};


	$scope.ReviewThread = function ( thread )
	{
		Sessions.ReviewThread( State.OpenId, thread );
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
