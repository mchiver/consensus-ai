'use strict';

// Api - the REST routes under /api, over Store, Rules, Anchors and Participants.
// Every rule lives here or in Rules.js, none in a client: the page and the LLM's curl see the same API.
// Errors are { Error } with a status. Writes to one proposal run through the store's queue.
// After a change, Context.Refresh( id ) re-indexes the proposal in the background; Context.Search answers /search.
// POST /proposals/:id/send calls the LLM (Llm.js); Context.Caller, when given, replaces Llm.Caller (the tests use it).

const EXPRESS = require( 'express' );
const CRYPTO = require( 'crypto' );
const RULES = require( './Rules.js' );
const ANCHORS = require( './Anchors.js' );
const PARTICIPANTS = require( './Participants.js' );
const LLM = require( './Llm.js' );

const BODY_LIMIT = '8mb';
const SEARCH_LIMIT = 10;


//---------------------------------------------------------------------
// Attach: mounts the routes on an Express app. Context = { Store, Settings, Events, Refresh?, Search?, Caller? }

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


	// A refusal from a function the routes and the LLM's call share: the route turns it into fail().
	function refused( status, message, extra )
	{
		return { Refused: { Status: status, Error: message, Extra: extra } };
	}


	function find_thread( read, thread_id )
	{
		return read.Threads.find( function ( candidate ) { return candidate.Id === thread_id; } ) || null;
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
			Llm: llm_view( request.params.id, read.Threads ),
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
	// Returns { Thread, Reopened } or { Refused: { Status, Error } }; the route and the LLM's call share it.
	async function add_reply( id, thread_id, participant, text )
	{
		let result = await store.Queue( id, async function ()
		{
			let read = await store.ReadProposal( id );
			if ( !read )
			{
				return refused( 404, 'no such proposal' );
			}
			let thread = find_thread( read, thread_id );
			if ( !thread )
			{
				return refused( 404, 'no such thread' );
			}
			let effect = RULES.ReplyEffect( thread );
			if ( effect.Reopen )
			{
				thread.Status = effect.Status;
				thread.Reopened = effect.Reopened;
				thread.Resolved = effect.Resolved;
			}
			thread.Replies.push( { Id: new_id( 'r' ), By: participant.Name, At: now(), Text: text } );
			await store.WriteThreads( id, read.Threads );
			await store.UpdateProposal( id, RULES.CommentEffect( read.Proposal ) );
			return { Thread: present_threads( [ thread ], read.Text, participant.Name )[ 0 ], Reopened: effect.Reopen };
		} );
		if ( !result.Refused )
		{
			changed( id, result.Reopened ? 'reopened' : 'reply', result.Thread.Id );
		}
		return result;
	}


	router.post( '/proposals/:id/threads/:tid/replies', async function ( request, response )
	{
		let text = text_of( ( request.body || {} ).Text ).trim();
		if ( !text )
		{
			return fail( response, 400, 'Text is required' );
		}
		let result = await add_reply( request.params.id, request.params.tid, request.Participant, text );
		if ( result.Refused )
		{
			return fail( response, result.Refused.Status, result.Refused.Error );
		}
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


	// Apply: a resolved thread's outcome goes into the text. Body = { Text?, Outcome, Revision, Anchor? }
	// With Text: a new revision tied to the thread, made from Revision (409 when stale). Without: the outcome alone.
	// Anchor, when given, points the thread at the passage the change produced; with Loose, an anchor that is
	// not found is left out instead of refused. Returns { Thread, Proposal } or { Refused: { Status, Error, Extra } }.
	async function apply_outcome( id, thread_id, participant, body, loose )
	{
		let outcome = text_of( body.Outcome ).trim();
		if ( !outcome )
		{
			return refused( 400, 'Outcome is required' );
		}
		let result = await store.Queue( id, async function ()
		{
			let read = await store.ReadProposal( id );
			if ( !read )
			{
				return refused( 404, 'no such proposal' );
			}
			let thread = find_thread( read, thread_id );
			if ( !thread )
			{
				return refused( 404, 'no such thread' );
			}
			let can = RULES.CanApply( participant, thread );
			if ( !can.Ok )
			{
				return refused( 409, can.Reason );
			}
			let proposal = read.Proposal;
			let text = read.Text;
			let changed_text = ( typeof body.Text === 'string' && body.Text !== read.Text );
			if ( changed_text )
			{
				if ( body.Revision !== proposal.Revision )
				{
					return refused( 409, 'the text changed since revision ' + body.Revision + '; reload and apply again', { Revision: proposal.Revision } );
				}
				proposal = await store.WriteText( id, { Text: body.Text, By: participant.Name, Reason: 'apply', Thread: thread.Id } );
				text = body.Text;
				refind( read.Threads, text );
			}
			if ( body.Anchor )
			{
				let anchor = place_anchor( body.Anchor, text );
				if ( anchor )
				{
					thread.Anchor = anchor;
					thread.Detached = false;
				}
				else if ( !loose )
				{
					return refused( 400, 'the anchor text was not found in the proposal' );
				}
			}
			Object.assign( thread, RULES.ApplyEffect( participant, now(), proposal.Revision, outcome ) );
			await store.WriteThreads( id, read.Threads );
			if ( changed_text )
			{
				proposal = await store.UpdateProposal( id, RULES.EditEffect( proposal ) );
			}
			return { Thread: present_threads( [ thread ], text, participant.Name )[ 0 ], Proposal: summarize( proposal, read.Threads, participant.Name ) };
		} );
		if ( !result.Refused )
		{
			changed( id, 'applied', result.Thread.Id );
		}
		return result;
	}


	router.post( '/proposals/:id/threads/:tid/apply', async function ( request, response )
	{
		let result = await apply_outcome( request.params.id, request.params.tid, request.Participant, request.body || {}, false );
		if ( result.Refused )
		{
			return fail( response, result.Refused.Status, result.Refused.Error, result.Refused.Extra );
		}
		response.json( result );
	} );


	//-----------------------------------------------------------------
	// Send to LLM: the owner hands everything waiting on the llm participant in one proposal to the LLM.
	// The call runs in the background; the answer's replies and applies are carried out as the llm participant.

	let calling = {};
	let recent_calls = [];
	const HOUR = 60 * 60 * 1000;
	const SEARCH_PER_THREAD = 3;


	// The llm participant that Consensus calls, or null.
	function called_llm()
	{
		return ( settings.Participants || [] ).find( function ( participant ) { return participant.Role === 'llm' && !!participant.Call; } ) || null;
	}


	function calls_in_last_hour()
	{
		let since = Date.now() - HOUR;
		recent_calls = recent_calls.filter( function ( at ) { return at > since; } );
		return recent_calls.length;
	}


	// What the page needs for the button: who, whether a call runs, how much is waiting.
	function llm_view( id, threads )
	{
		let llm = called_llm();
		if ( !llm )
		{
			return { Configured: false };
		}
		return {
			Configured: true,
			Name: llm.Name,
			Running: !!calling[ id ],
			Waiting: RULES.WaitingOn( llm.Name, threads, participants() ).length,
		};
	}


	router.post( '/proposals/:id/send', async function ( request, response )
	{
		if ( request.Participant.Role !== 'owner' )
		{
			return fail( response, 403, 'only the owner sends to the LLM' );
		}
		let llm = called_llm();
		if ( !llm )
		{
			return fail( response, 409, 'no LLM is configured: give the llm participant a Call in consensus.json' );
		}
		let id = request.params.id;
		if ( calling[ id ] )
		{
			return fail( response, 409, 'a call to the LLM is already running for this proposal' );
		}
		let read = await store.ReadProposal( id );
		if ( !read )
		{
			return fail( response, 404, 'no such proposal' );
		}
		let waiting = RULES.WaitingOn( llm.Name, read.Threads, participants() );
		if ( waiting.length === 0 )
		{
			return fail( response, 409, 'nothing is waiting on the LLM' );
		}
		let call = LLM.CallSettings( llm );
		if ( calls_in_last_hour() >= call.CallsPerHour )
		{
			return fail( response, 409, 'the LLM is paused: ' + call.CallsPerHour + ' calls in the last hour' );
		}
		calling[ id ] = true;
		recent_calls.push( Date.now() );
		events.Send( { Proposal: id, Kind: 'llm-started' } );
		response.status( 202 ).json( { Started: true, Threads: waiting.map( function ( thread ) { return thread.Id; } ) } );

		run_call( id, llm, call ).catch( function ( error )
		{
			console.error( 'llm: ' + id + ': ' + error.message );
		} ).finally( function ()
		{
			delete calling[ id ];
			events.Send( { Proposal: id, Kind: 'llm-finished' } );
		} );
	} );


	async function run_call( id, llm, call )
	{
		let started = Date.now();
		let read = await store.ReadProposal( id );
		let presented = present_threads( read.Threads, read.Text, llm.Name );
		let waiting = presented.filter( function ( thread ) { return thread.WaitingOnMe; } );
		let prompt = LLM.Prompt( {
			Proposal: read.Proposal,
			Text: read.Text,
			Threads: presented,
			Me: llm.Name,
			Participants: participants(),
			Search: await search_for( waiting ),
		} );
		let caller = ( Context.Caller || LLM.Caller )( call );
		let answer = null;
		try
		{
			answer = await caller( prompt );
		}
		catch ( error )
		{
			let failures = {};
			for ( let thread of waiting )
			{
				failures[ thread.Id ] = error.message;
			}
			await record_call_results( id, failures, false );
			log_call( id, call, waiting, started, 'failed: ' + error.message );
			return;
		}
		await record_usage( call, answer.Usage );
		let failures = await carry_out( id, llm, waiting, answer.Answer.Actions, read.Proposal.Revision );
		await record_call_results( id, failures, true );
		let failed = Object.keys( failures ).length;
		log_call( id, call, waiting, started, answer.Answer.Actions.length + ' actions' + ( failed ? ', ' + failed + ' refused' : '' ) + ', ' + answer.Usage.Input + ' in, ' + answer.Usage.Output + ' out' );
	}


	// For each waiting thread, the best passages elsewhere: its anchor words and its last reply as the query.
	async function search_for( waiting )
	{
		let found = {};
		if ( !Context.Search )
		{
			return found;
		}
		let titles = {};
		for ( let proposal of await store.ListProposals() )
		{
			titles[ proposal.Id ] = proposal.Title;
		}
		for ( let thread of waiting )
		{
			let last = thread.Replies[ thread.Replies.length - 1 ];
			let query = ( thread.Anchor ? thread.Anchor.Text + ' ' : '' ) + ( last ? last.Text : '' );
			let hits = [];
			try
			{
				hits = await Context.Search( query, SEARCH_PER_THREAD + 1 );
			}
			catch ( error )
			{
				console.error( 'llm: search for ' + thread.Id + ': ' + error.message );
			}
			found[ thread.Id ] = hits.filter( function ( hit ) { return hit.Thread !== thread.Id; } ).slice( 0, SEARCH_PER_THREAD ).map( function ( hit )
			{
				return Object.assign( {}, hit, { Title: titles[ hit.Proposal ] || hit.Proposal } );
			} );
		}
		return found;
	}


	// The answer's actions, in order, each through the same rules as the API. Returns { threadId: reason } for refusals.
	async function carry_out( id, llm, waiting, actions, revision )
	{
		let failures = {};
		let current_revision = revision;
		for ( let action of actions )
		{
			let thread = waiting.find( function ( candidate ) { return candidate.Id === action.Thread; } );
			if ( !thread )
			{
				console.error( 'llm: ' + id + ': ignored an action for thread ' + action.Thread + ', which was not waiting on the LLM' );
				continue;
			}
			let result = null;
			if ( action.Kind === 'reply' )
			{
				let text = text_of( action.Reply ).trim();
				if ( thread.Status !== 'contested' )
				{
					result = refused( 409, 'the LLM replied to a thread waiting to be applied' );
				}
				else if ( !text )
				{
					result = refused( 400, 'the LLM gave an empty reply' );
				}
				else
				{
					result = await add_reply( id, thread.Id, llm, text );
				}
			}
			else
			{
				if ( thread.Status !== 'consensus' )
				{
					result = refused( 409, 'the LLM applied a thread that is still contested' );
				}
				else
				{
					let body = { Outcome: action.Outcome, Revision: current_revision };
					if ( typeof action.Text === 'string' && action.Text.trim() )
					{
						body.Text = action.Text;
					}
					if ( action.Anchor )
					{
						body.Anchor = { Text: text_of( action.Anchor ) };
					}
					result = await apply_outcome( id, thread.Id, llm, body, true );
					if ( !result.Refused )
					{
						current_revision = result.Proposal.Revision;
					}
				}
			}
			if ( result.Refused )
			{
				failures[ thread.Id ] = result.Refused.Error;
			}
		}
		return failures;
	}


	// A failure line on each thread in Failures; with Succeeded, every other thread's failure line is cleared.
	async function record_call_results( id, failures, succeeded )
	{
		let at = now();
		await store.Queue( id, async function ()
		{
			let read = await store.ReadProposal( id );
			if ( !read )
			{
				return;
			}
			for ( let thread of read.Threads )
			{
				if ( failures[ thread.Id ] )
				{
					thread.CallFailed = { At: at, Reason: failures[ thread.Id ] };
				}
				else if ( succeeded )
				{
					delete thread.CallFailed;
				}
			}
			await store.WriteThreads( id, read.Threads );
		} );
		changed( id, 'llm' );
	}


	function log_call( id, call, waiting, started, what )
	{
		let seconds = ( ( Date.now() - started ) / 1000 ).toFixed( 1 );
		console.log( 'llm: ' + id + ': ' + call.Kind + ( call.Model ? ' ' + call.Model : '' ) + ', ' + waiting.length + ' threads, ' + seconds + 's, ' + what );
	}


	//-----------------------------------------------------------------
	// Usage: the LLM's tokens per day and model, kept in usage.json.

	function today()
	{
		return new Date().toLocaleDateString( 'en-CA' );
	}


	async function record_usage( call, usage )
	{
		let model = ( usage && usage.Model ) || call.Model || call.Kind;
		await store.Queue( '~usage', async function ()
		{
			let all = await store.ReadUsage();
			let day = all.Days[ today() ] || ( all.Days[ today() ] = {} );
			let entry = day[ model ] || ( day[ model ] = { Calls: 0, Input: 0, Output: 0 } );
			entry.Calls += 1;
			entry.Input += ( usage && usage.Input ) || 0;
			entry.Output += ( usage && usage.Output ) || 0;
			await store.WriteUsage( all );
		} );
	}


	function add_into( total, entry )
	{
		total.Calls += entry.Calls;
		total.Input += entry.Input;
		total.Output += entry.Output;
	}


	router.get( '/usage', async function ( request, response )
	{
		let all = await store.ReadUsage();
		let result = {
			Day: today(),
			Today: { Calls: 0, Input: 0, Output: 0 },
			Total: { Calls: 0, Input: 0, Output: 0 },
			Models: {},
		};
		for ( let day of Object.keys( all.Days ) )
		{
			for ( let model of Object.keys( all.Days[ day ] ) )
			{
				let entry = all.Days[ day ][ model ];
				add_into( result.Total, entry );
				if ( day === result.Day )
				{
					add_into( result.Today, entry );
				}
				let by_model = result.Models[ model ] || ( result.Models[ model ] = { Calls: 0, Input: 0, Output: 0 } );
				add_into( by_model, entry );
			}
		}
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
