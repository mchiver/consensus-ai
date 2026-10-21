'use strict';

// Threads - the service behind the threads pane (plan UI Components, Step 1): which threads the filter lists, in
// the pane's order, and every request on a thread: Comment (with the owner's Comment and resolve), Reply (Reply
// and Contest on a resolved thread), Reply and resolve, Resolve, Delete, Re-anchor, and the Subplan starts. The
// components (thread-filters, thread-list, thread-card and its parts, thread-compose) call it; nothing else holds
// thread requests. After your own Reply, Reply and Contest, Reply and resolve or Resolve, thread-done goes out
// with the thread's id, and thread-list passes the selection on (plan UI Tweaks VI).
//
//   Threads = { Busy, Listed(), Matches( thread ), Highlighted(), IsOwner(), CanResolve( thread ), CanStartResolved(),
//               CanSetState(), CanDelete(), IsPlan(),
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


	// The threads whose passages are highlighted in the text: every one, or only the open ones and the selected one, as
	// the Highlight picker says (plan UI Tweaks V); none without an open plan.
	function Highlighted()
	{
		if ( !State.Open )
		{
			return [];
		}
		if ( State.Highlight !== 'open' )
		{
			return State.Open.Threads;
		}
		return State.Open.Threads.filter( function ( thread )
		{
			return thread.Status === 'contested' || thread.Id === State.Selected;
		} );
	}


	//-----------------------------------------------------------------
	// Who may do what (plan Multiuser, Step 2): the page says before the server does what src/Rules.js has. An Owner
	// is the server's owner or an account in the open project's Owners folder (the root's Roles, by project); a Member
	// resolves the threads they started; the plan's State is an Owner's.

	// My role in the open item's project: Owners for the server's owner, else the root's role folder for it, or null.
	function role()
	{
		if ( !State.Me )
		{
			return null;
		}
		if ( State.Me.Role === 'owner' )
		{
			return 'Owners';
		}
		let project = ( State.Open && State.Open.Project ) ? State.Open.Project.Id : null;
		if ( !project || !State.Root || !State.Root.Roles )
		{
			return null;
		}
		return State.Root.Roles[ project ] || null;
	}


	function IsOwner()
	{
		return role() === 'Owners';
	}


	function CanResolve( thread )
	{
		if ( thread.Status !== 'contested' )
		{
			return false;
		}
		if ( IsOwner() )
		{
			return true;
		}
		let first = ( thread.Replies || [] )[ 0 ];
		return role() === 'Members' && !!first && first.By === State.Me.Name;
	}


	// Comment and resolve: a thread posted resolved is the poster's own, so an Owner's or a Member's.
	function CanStartResolved()
	{
		return IsOwner() || role() === 'Members';
	}


	function CanSetState()
	{
		return IsOwner();
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
	threads.Highlighted = Highlighted;
	threads.Matches = Matches;
	threads.IsOwner = IsOwner;
	threads.CanStartResolved = CanStartResolved;
	threads.CanSetState = CanSetState;
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
