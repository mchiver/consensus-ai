'use strict';

// Api - the REST routes under /api, over Store, Rules, Anchors and Participants.
// Every rule lives here or in Rules.js, none in a client: the page and the LLM's curl see the same API.
// Errors are { Error } with a status. Writes to one proposal run through the store's queue.
// After a change, Context.Refresh( id ) re-indexes the proposal in the background; Context.Search answers /search.

const EXPRESS = require( 'express' );
const CRYPTO = require( 'crypto' );
const RULES = require( './Rules.js' );
const ANCHORS = require( './Anchors.js' );
const PARTICIPANTS = require( './Participants.js' );

const BODY_LIMIT = '8mb';
const SEARCH_LIMIT = 10;


//---------------------------------------------------------------------
// Attach: mounts the routes on an Express app. Context = { Store, Settings, Events, Refresh?, Search? }

function Attach( App, Context )
{
	let store = Context.Store;
	let settings = Context.Settings;
	let events = Context.Events;
	let router = EXPRESS.Router();
	router.use( EXPRESS.json( { limit: BODY_LIMIT } ) );
	router.use( identify );


	//-----------------------------------------------------------------
	// Identity

	function identify( request, response, next )
	{
		let participant = PARTICIPANTS.Identify( settings, request.get( 'Authorization' ) );
		if ( !participant )
		{
			return fail( response, 401, 'unknown token' );
		}
		request.Participant = participant;
		next();
	}


	function participants()
	{
		return PARTICIPANTS.PublicList( settings );
	}


	function fail( response, status, message, extra )
	{
		let body = { Error: message };
		if ( extra )
		{
			for ( let key of Object.keys( extra ) )
			{
				body[ key ] = extra[ key ];
			}
		}
		response.status( status ).json( body );
		return null;
	}


	function now()
	{
		return new Date().toISOString();
	}


	function new_id( prefix )
	{
		return prefix + CRYPTO.randomBytes( 4 ).toString( 'hex' );
	}


	function text_of( value )
	{
		return ( typeof value === 'string' ) ? value : '';
	}


	// A change happened: tell the listeners, and re-index in the background.
	function changed( id, kind, thread_id )
	{
		let event = { Proposal: id, Kind: kind };
		if ( thread_id )
		{
			event.Thread = thread_id;
		}
		events.Send( event );
		if ( Context.Refresh && kind !== 'trashed' && kind !== 'title' )
		{
			// Through the proposal's queue, so it never overlaps a write to, or a move of, that folder.
			store.Queue( id, function () { return Context.Refresh( id ); } ).catch( function ( error )
			{
				console.error( 'index: ' + id + ': ' + error.message );
			} );
		}
	}


	//-----------------------------------------------------------------
	// Views: what a proposal looks like to a participant.

	function present_threads( threads, text, name )
	{
		let plain = ANCHORS.PlainText( text );
		let all = participants();
		return threads.map( function ( thread )
		{
			let view = Object.assign( {}, thread );
			view.Found = thread.Anchor ? ANCHORS.Find( plain, thread.Anchor ) : null;
			view.Turn = RULES.Turn( thread, all );
			view.WaitingOnMe = view.Turn.includes( name );
			view.State = state_of( thread );
			return view;
		} );
	}


	// One word for the page: contested | reopened | waiting | applied
	function state_of( thread )
	{
		if ( thread.Status === 'contested' )
		{
			return thread.Reopened ? 'reopened' : 'contested';
		}
		return RULES.IsWaiting( thread ) ? 'waiting' : 'applied';
	}


	function summarize( proposal, threads, name )
	{
		let tally = RULES.Tally( proposal, threads, participants() );
		return Object.assign( {}, proposal, { Tally: tally, State: RULES.StateLine( proposal, tally, name ) } );
	}


	// After any text change: every anchor is re-found. A context match moves the anchor to the new words.
	function refind( threads, text )
	{
		let plain = ANCHORS.PlainText( text );
		for ( let thread of threads )
		{
			if ( !thread.Anchor )
			{
				continue;
			}
			let found = ANCHORS.Find( plain, thread.Anchor );
			if ( !found )
			{
				thread.Detached = true;
				continue;
			}
			thread.Detached = false;
			if ( found.Method === 'context' )
			{
				thread.Anchor = ANCHORS.Make( plain, found.Start, found.End );
			}
		}
	}


	// An anchor sent by a client: at least Text, found in the current text. Returns the stored anchor or null.
	function place_anchor( anchor, text )
	{
		if ( !anchor || !anchor.Text )
		{
			return null;
		}
		let plain = ANCHORS.PlainText( text );
		let found = ANCHORS.Find( plain, { Text: anchor.Text, Prefix: text_of( anchor.Prefix ), Suffix: text_of( anchor.Suffix ) } );
		if ( !found || found.Method !== 'exact' )
		{
			return null;
		}
		return ANCHORS.Make( plain, found.Start, found.End );
	}


	//-----------------------------------------------------------------
	// Me

	router.get( '/me', function ( request, response )
	{
		response.json( { Me: PARTICIPANTS.Public( request.Participant ), Participants: participants() } );
	} );


	//-----------------------------------------------------------------
	// Proposals

	router.get( '/proposals', async function ( request, response )
	{
		let proposals = await store.ListProposals();
		let status = request.query.status;
		let list = [];
		for ( let proposal of proposals )
		{
			if ( status && proposal.Status !== status )
			{
				continue;
			}
			let read = await store.ReadProposal( proposal.Id );
			list.push( summarize( proposal, read ? read.Threads : [], request.Participant.Name ) );
		}
		response.json( { Proposals: list } );
	} );


	router.post( '/proposals', async function ( request, response )
	{
		let body = request.body || {};
		let title = text_of( body.Title ).trim();
		if ( !title )
		{
			return fail( response, 400, 'Title is required' );
		}
		let proposal = await store.CreateProposal( { Title: title, Text: text_of( body.Text ), By: request.Participant.Name } );
		changed( proposal.Id, 'created' );
		response.status( 201 ).json( { Proposal: summarize( proposal, [], request.Participant.Name ) } );
	} );


	router.get( '/proposals/:id', async function ( request, response )
	{
		let read = await store.ReadProposal( request.params.id );
		if ( !read )
		{
			return fail( response, 404, 'no such proposal' );
		}
		let name = request.Participant.Name;
		response.json( {
			Me: PARTICIPANTS.Public( request.Participant ),
			Participants: participants(),
			Proposal: summarize( read.Proposal, read.Threads, name ),
			Text: read.Text,
			Threads: present_threads( read.Threads, read.Text, name ),
		} );
	} );


	router.put( '/proposals/:id', async function ( request, response )
	{
		let title = text_of( ( request.body || {} ).Title ).trim();
		if ( !title )
		{
			return fail( response, 400, 'Title is required' );
		}
		let id = request.params.id;
		let result = await store.Queue( id, async function ()
		{
			let read = await store.ReadProposal( id );
			if ( !read )
			{
				return fail( response, 404, 'no such proposal' );
			}
			let proposal = await store.UpdateProposal( id, { Title: title } );
			return summarize( proposal, read.Threads, request.Participant.Name );
		} );
		if ( !result )
		{
			return;
		}
		changed( id, 'title' );
		response.json( { Proposal: result } );
	} );


	// A manual edit: a new revision, and the proposal is contested again. Refused when made from a stale revision.
	router.put( '/proposals/:id/text', async function ( request, response )
	{
		let body = request.body || {};
		if ( typeof body.Text !== 'string' )
		{
			return fail( response, 400, 'Text is required' );
		}
		let id = request.params.id;
		let result = await store.Queue( id, async function ()
		{
			let read = await store.ReadProposal( id );
			if ( !read )
			{
				return fail( response, 404, 'no such proposal' );
			}
			if ( body.Revision !== read.Proposal.Revision )
			{
				return fail( response, 409, 'the text changed since revision ' + body.Revision + '; reload and edit again', { Revision: read.Proposal.Revision } );
			}
			await store.WriteText( id, { Text: body.Text, By: request.Participant.Name, Reason: 'edit' } );
			refind( read.Threads, body.Text );
			await store.WriteThreads( id, read.Threads );
			let proposal = await store.UpdateProposal( id, RULES.EditEffect( read.Proposal ) );
			return summarize( proposal, read.Threads, request.Participant.Name );
		} );
		if ( !result )
		{
			return;
		}
		changed( id, 'text' );
		response.json( { Proposal: result } );
	} );


	router.delete( '/proposals/:id', async function ( request, response )
	{
		let id = request.params.id;
		let moved = await store.Queue( id, async function ()
		{
			return await store.TrashProposal( id );
		} );
		if ( !moved )
		{
			return fail( response, 404, 'no such proposal' );
		}
		changed( id, 'trashed' );
		response.json( { Trashed: id } );
	} );


	router.get( '/trash', async function ( request, response )
	{
		response.json( { Proposals: await store.ListTrash() } );
	} );


	// Approval turns the proposal into a Plan: owner only, nothing contested, nothing waiting to be applied.
	router.post( '/proposals/:id/approve', async function ( request, response )
	{
		let id = request.params.id;
		let result = await store.Queue( id, async function ()
		{
			let read = await store.ReadProposal( id );
			if ( !read )
			{
				return fail( response, 404, 'no such proposal' );
			}
			let can = RULES.CanApprove( request.Participant, read.Proposal, read.Threads );
			if ( !can.Ok )
			{
				return fail( response, ( request.Participant.Role === 'owner' ) ? 409 : 403, can.Reason );
			}
			let proposal = await store.UpdateProposal( id, RULES.ApproveEffect( request.Participant, now(), read.Proposal ) );
			return summarize( proposal, read.Threads, request.Participant.Name );
		} );
		if ( !result )
		{
			return;
		}
		changed( id, 'approved' );
		response.json( { Proposal: result } );
	} );


	//-----------------------------------------------------------------
	// Revisions: the record.

	router.get( '/proposals/:id/revisions', async function ( request, response )
	{
		let read = await store.ReadProposal( request.params.id );
		if ( !read )
		{
			return fail( response, 404, 'no such proposal' );
		}
		response.json( { Revisions: await store.ListRevisions( request.params.id ) } );
	} );


	router.get( '/proposals/:id/revisions/:n', async function ( request, response )
	{
		let revision = await store.ReadRevision( request.params.id, parseInt( request.params.n, 10 ) );
		if ( !revision )
		{
			return fail( response, 404, 'no such revision' );
		}
		response.json( { Revision: revision } );
	} );


	//-----------------------------------------------------------------
	// Threads

	router.get( '/proposals/:id/threads', async function ( request, response )
	{
		let read = await store.ReadProposal( request.params.id );
		if ( !read )
		{
			return fail( response, 404, 'no such proposal' );
		}
		let name = request.Participant.Name;
		let filtered = RULES.Filter( read.Threads, request.query.status, participants(), name );
		if ( !filtered )
		{
			return fail( response, 400, 'unknown status filter "' + request.query.status + '"' );
		}
		response.json( { Threads: present_threads( filtered, read.Text, name ) } );
	} );


	// A new thread: the first reply is the comment. Anchor is { Text, Prefix?, Suffix? } or null for the whole document.
	router.post( '/proposals/:id/threads', async function ( request, response )
	{
		let body = request.body || {};
		let text = text_of( body.Text ).trim();
		if ( !text )
		{
			return fail( response, 400, 'Text is required' );
		}
		let id = request.params.id;
		let result = await store.Queue( id, async function ()
		{
			let read = await store.ReadProposal( id );
			if ( !read )
			{
				return fail( response, 404, 'no such proposal' );
			}
			let anchor = null;
			if ( body.Anchor )
			{
				anchor = place_anchor( body.Anchor, read.Text );
				if ( !anchor )
				{
					return fail( response, 400, 'the anchor text was not found in the proposal' );
				}
			}
			let at = now();
			let thread = {
				Id: new_id( 't' ),
				Anchor: anchor,
				Detached: false,
				Status: 'contested',
				Reopened: false,
				Resolved: null,
				Applied: null,
				Created: at,
				Replies: [ { Id: new_id( 'r' ), By: request.Participant.Name, At: at, Text: text } ],
			};
			read.Threads.push( thread );
			await store.WriteThreads( id, read.Threads );
			await store.UpdateProposal( id, RULES.CommentEffect( read.Proposal ) );
			return present_threads( [ thread ], read.Text, request.Participant.Name )[ 0 ];
		} );
		if ( !result )
		{
			return;
		}
		changed( id, 'thread', result.Id );
		response.status( 201 ).json( { Thread: result } );
	} );


	// A reply. To a resolved thread it reopens it; a change already applied stays applied.
	router.post( '/proposals/:id/threads/:tid/replies', async function ( request, response )
	{
		let text = text_of( ( request.body || {} ).Text ).trim();
		if ( !text )
		{
			return fail( response, 400, 'Text is required' );
		}
		let id = request.params.id;
		let result = await store.Queue( id, async function ()
		{
			let read = await store.ReadProposal( id );
			if ( !read )
			{
				return fail( response, 404, 'no such proposal' );
			}
			let thread = read.Threads.find( function ( candidate ) { return candidate.Id === request.params.tid; } );
			if ( !thread )
			{
				return fail( response, 404, 'no such thread' );
			}
			let effect = RULES.ReplyEffect( thread );
			if ( effect.Reopen )
			{
				thread.Status = effect.Status;
				thread.Reopened = effect.Reopened;
				thread.Resolved = effect.Resolved;
			}
			thread.Replies.push( { Id: new_id( 'r' ), By: request.Participant.Name, At: now(), Text: text } );
			await store.WriteThreads( id, read.Threads );
			await store.UpdateProposal( id, RULES.CommentEffect( read.Proposal ) );
			return { Thread: present_threads( [ thread ], read.Text, request.Participant.Name )[ 0 ], Reopened: effect.Reopen };
		} );
		if ( !result )
		{
			return;
		}
		changed( id, result.Reopened ? 'reopened' : 'reply', result.Thread.Id );
		response.status( 201 ).json( result );
	} );


	// Re-anchor a thread, detached or not, to a passage of the current text.
	router.post( '/proposals/:id/threads/:tid/anchor', async function ( request, response )
	{
		let body = request.body || {};
		let id = request.params.id;
		let result = await store.Queue( id, async function ()
		{
			let read = await store.ReadProposal( id );
			if ( !read )
			{
				return fail( response, 404, 'no such proposal' );
			}
			let thread = read.Threads.find( function ( candidate ) { return candidate.Id === request.params.tid; } );
			if ( !thread )
			{
				return fail( response, 404, 'no such thread' );
			}
			let anchor = place_anchor( body.Anchor, read.Text );
			if ( !anchor )
			{
				return fail( response, 400, 'the anchor text was not found in the proposal' );
			}
			thread.Anchor = anchor;
			thread.Detached = false;
			await store.WriteThreads( id, read.Threads );
			return present_threads( [ thread ], read.Text, request.Participant.Name )[ 0 ];
		} );
		if ( !result )
		{
			return;
		}
		changed( id, 'anchored', result.Id );
		response.json( { Thread: result } );
	} );


	// Resolve: owner only, contested threads only. Resolving accepts the outcome stated in the last reply.
	router.post( '/proposals/:id/threads/:tid/resolve', async function ( request, response )
	{
		let id = request.params.id;
		let result = await store.Queue( id, async function ()
		{
			let read = await store.ReadProposal( id );
			if ( !read )
			{
				return fail( response, 404, 'no such proposal' );
			}
			let thread = read.Threads.find( function ( candidate ) { return candidate.Id === request.params.tid; } );
			if ( !thread )
			{
				return fail( response, 404, 'no such thread' );
			}
			let can = RULES.CanResolve( request.Participant, thread );
			if ( !can.Ok )
			{
				return fail( response, ( request.Participant.Role === 'owner' ) ? 409 : 403, can.Reason );
			}
			Object.assign( thread, RULES.ResolveEffect( request.Participant, now() ) );
			await store.WriteThreads( id, read.Threads );
			return present_threads( [ thread ], read.Text, request.Participant.Name )[ 0 ];
		} );
		if ( !result )
		{
			return;
		}
		changed( id, 'resolved', result.Id );
		response.json( { Thread: result } );
	} );


	// Apply: a resolved thread's outcome goes into the text. { Text?, Outcome, Revision, Anchor? }
	// With Text: a new revision tied to the thread, made from Revision (409 when stale). Without: the outcome alone.
	// Anchor, when given, points the thread at the passage the change produced.
	router.post( '/proposals/:id/threads/:tid/apply', async function ( request, response )
	{
		let body = request.body || {};
		let outcome = text_of( body.Outcome ).trim();
		if ( !outcome )
		{
			return fail( response, 400, 'Outcome is required' );
		}
		let id = request.params.id;
		let result = await store.Queue( id, async function ()
		{
			let read = await store.ReadProposal( id );
			if ( !read )
			{
				return fail( response, 404, 'no such proposal' );
			}
			let thread = read.Threads.find( function ( candidate ) { return candidate.Id === request.params.tid; } );
			if ( !thread )
			{
				return fail( response, 404, 'no such thread' );
			}
			let can = RULES.CanApply( request.Participant, thread );
			if ( !can.Ok )
			{
				return fail( response, 409, can.Reason );
			}
			let proposal = read.Proposal;
			let text = read.Text;
			let changed_text = ( typeof body.Text === 'string' && body.Text !== read.Text );
			if ( changed_text )
			{
				if ( body.Revision !== proposal.Revision )
				{
					return fail( response, 409, 'the text changed since revision ' + body.Revision + '; reload and apply again', { Revision: proposal.Revision } );
				}
				proposal = await store.WriteText( id, { Text: body.Text, By: request.Participant.Name, Reason: 'apply', Thread: thread.Id } );
				text = body.Text;
				refind( read.Threads, text );
			}
			if ( body.Anchor )
			{
				let anchor = place_anchor( body.Anchor, text );
				if ( !anchor )
				{
					return fail( response, 400, 'the anchor text was not found in the proposal' );
				}
				thread.Anchor = anchor;
				thread.Detached = false;
			}
			Object.assign( thread, RULES.ApplyEffect( request.Participant, now(), proposal.Revision, outcome ) );
			await store.WriteThreads( id, read.Threads );
			if ( changed_text )
			{
				proposal = await store.UpdateProposal( id, RULES.EditEffect( proposal ) );
			}
			return { Thread: present_threads( [ thread ], text, request.Participant.Name )[ 0 ], Proposal: summarize( proposal, read.Threads, request.Participant.Name ) };
		} );
		if ( !result )
		{
			return;
		}
		changed( id, 'applied', result.Thread.Id );
		response.json( result );
	} );


	//-----------------------------------------------------------------
	// Waiting: everything waiting on the caller, across proposals.

	router.get( '/waiting', async function ( request, response )
	{
		let name = request.Participant.Name;
		let all = participants();
		let waiting = [];
		for ( let proposal of await store.ListProposals() )
		{
			let read = await store.ReadProposal( proposal.Id );
			if ( !read )
			{
				continue;
			}
			let threads = RULES.WaitingOn( name, read.Threads, all );
			for ( let thread of present_threads( threads, read.Text, name ) )
			{
				waiting.push( { Proposal: { Id: proposal.Id, Title: proposal.Title, Status: proposal.Status, Revision: proposal.Revision }, Thread: thread } );
			}
		}
		response.json( { Me: PARTICIPANTS.Public( request.Participant ), Waiting: waiting } );
	} );


	//-----------------------------------------------------------------
	// Search: the best chunks across proposals, plans and threads. ?q=&limit=

	router.get( '/search', async function ( request, response )
	{
		let query = text_of( request.query.q ).trim();
		if ( !query )
		{
			return fail( response, 400, 'q is required' );
		}
		if ( !Context.Search )
		{
			return fail( response, 503, 'search is not available' );
		}
		let limit = parseInt( request.query.limit, 10 );
		if ( !( limit > 0 ) )
		{
			limit = SEARCH_LIMIT;
		}
		let hits = await Context.Search( query, limit );
		let titles = {};
		for ( let proposal of await store.ListProposals() )
		{
			titles[ proposal.Id ] = proposal.Title;
		}
		for ( let hit of hits )
		{
			hit.Title = titles[ hit.Proposal ] || hit.Proposal;
		}
		response.json( { Query: query, Hits: hits } );
	} );


	//-----------------------------------------------------------------

	router.use( function ( request, response )
	{
		fail( response, 404, 'no such route' );
	} );

	router.use( function ( error, request, response, next )
	{
		let status = error.status || error.statusCode || 500;
		fail( response, status, ( status === 500 ) ? 'internal error: ' + error.message : error.message );
	} );

	App.use( '/api', router );
}


module.exports = {
	Attach: Attach,
};
