'use strict';

// Threads - the service behind the threads pane (plan UI Components, Step 1): which threads the filter lists, in
// the pane's order, and every request on a thread: Comment (with the owner's Comment and resolve), Reply (Reply
// and Contest on a resolved thread), Reply and resolve, Resolve, Delete, Re-anchor, and the Subplan starts. The
// components (thread-filters, thread-list, thread-card and its parts, thread-compose) call it; nothing else holds
// thread requests. After your own Reply, Reply and Contest, Reply and resolve or Resolve, thread-done goes out
// with the thread's id, and thread-list passes the selection on (plan UI Tweaks VI).
//
//   Threads = { Busy, Listed(), Matches( thread ), IsOwner(), CanResolve( thread ), CanDelete(), IsPlan(),
//               Post( Resolve ), Reply( thread ), ReplyAndResolve( thread ), Resolve( thread ), Delete( thread ),
//               Reanchor( thread ), SubplanFromCompose(), SubplanFromThread( thread ) }

angular.module( 'Consensus' ).factory( 'Threads', [ '$rootScope', 'State', 'Client', 'Subplans', function ( $rootScope, State, Client, Subplans )
{
	let threads = { Busy: false };


	function path( thread )
	{
		return '/api/plans/' + encodeURIComponent( State.OpenId ) + '/threads' + ( thread ? '/' + thread.Id : '' );
	}


	//-----------------------------------------------------------------
	// The list: the filter's matches plus the selected thread, whatever the filter says of it (plan UI Tweaks V):
	// a thread picked by a click on its anchored text stays listed until another is picked or the selection is
	// cleared. Detached threads first, then in the order of the text, whole-document threads last.

	function Matches( thread )
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


	function listed( thread )
	{
		return thread.Id === State.Selected || Matches( thread );
	}


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


	function Listed()
	{
		if ( !State.Open )
		{
			return [];
		}
		return State.Open.Threads.filter( listed ).sort( by_position );
	}


	//-----------------------------------------------------------------
	// Who may do what.

	function IsOwner()
	{
		return !!State.Me && State.Me.Role === 'owner';
	}


	function CanResolve( thread )
	{
		return IsOwner() && thread.Status === 'contested';
	}


	function CanDelete()
	{
		return IsOwner();
	}


	function IsPlan()
	{
		return !!State.Open && ( State.Open.Plan.Kind || 'plan' ) === 'plan';
	}


	//-----------------------------------------------------------------
	// The requests. Each runs through State.Act (errors land in the state) and reloads the plan when it worked.

	async function act( work )
	{
		threads.Busy = true;
		let result = await State.Act( work );
		threads.Busy = false;
		if ( result )
		{
			await State.Reload();
		}
		$rootScope.$applyAsync();
		return result;
	}


	function done( thread )
	{
		$rootScope.$broadcast( 'thread-done', thread.Id );
	}


	// Comment; with Resolve (the owner's Comment and resolve), the thread is posted resolved, the comment its outcome.
	async function Post( Resolve )
	{
		let compose = State.Compose;
		if ( !compose || !compose.Text )
		{
			return null;
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
			$rootScope.$applyAsync();
		}
		return answer;
	}


	// Reply; on a resolved thread, Reply and Contest: the thread reopens and stays contested.
	async function Reply( thread )
	{
		let text = State.Drafts[ thread.Id ];
		if ( !text )
		{
			return null;
		}
		let answer = await act( function ()
		{
			return Client.Post( path( thread ) + '/replies', { Text: text } );
		} );
		if ( answer )
		{
			delete State.Drafts[ thread.Id ];
			done( thread );
			$rootScope.$applyAsync();
		}
		return answer;
	}


	// Reply and resolve: the owner's reply is the outcome, and the thread is resolved with it, in one request.
	async function ReplyAndResolve( thread )
	{
		let text = State.Drafts[ thread.Id ];
		if ( !text )
		{
			return null;
		}
		let answer = await act( function ()
		{
			return Client.Post( path( thread ) + '/replies', { Text: text, Resolve: true } );
		} );
		if ( answer )
		{
			delete State.Drafts[ thread.Id ];
			done( thread );
			$rootScope.$applyAsync();
		}
		return answer;
	}


	async function Resolve( thread )
	{
		let answer = await act( function ()
		{
			return Client.Post( path( thread ) + '/resolve' );
		} );
		if ( answer )
		{
			done( thread );
			$rootScope.$applyAsync();
		}
		return answer;
	}


	// Delete: owner only, any thread; the selection is cleared when it was the one deleted.
	async function Delete( thread )
	{
		let answer = await act( function ()
		{
			return Client.Delete( path( thread ) );
		} );
		if ( answer && State.Selected === thread.Id )
		{
			State.Select( null );
		}
		$rootScope.$applyAsync();
		return answer;
	}


	function Reanchor( thread )
	{
		State.StartReanchor( thread.Id );
	}


	// Start a new Subplan from the thread being composed, or from a thread (with the draft reply, if any).
	function SubplanFromCompose()
	{
		if ( State.Compose )
		{
			Subplans.FromCompose( State.Compose );
		}
	}


	function SubplanFromThread( thread )
	{
		Subplans.FromThread( thread, State.Drafts[ thread.Id ] );
	}


	threads.Listed = Listed;
	threads.Matches = Matches;
	threads.IsOwner = IsOwner;
	threads.CanResolve = CanResolve;
	threads.CanDelete = CanDelete;
	threads.IsPlan = IsPlan;
	threads.Post = Post;
	threads.Reply = Reply;
	threads.ReplyAndResolve = ReplyAndResolve;
	threads.Resolve = Resolve;
	threads.Delete = Delete;
	threads.Reanchor = Reanchor;
	threads.SubplanFromCompose = SubplanFromCompose;
	threads.SubplanFromThread = SubplanFromThread;
	return threads;
} ] );
