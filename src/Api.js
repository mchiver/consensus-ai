'use strict';

// Api - the REST routes under /api, over Store, Rules, Anchors and Participants.
// Every rule lives here or in Rules.js, none in a client: the page and the LLM's curl see the same API.
// Errors are { Error } with a status. Writes to one proposal run through the store's queue.
// After a change, Context.Refresh( id ) re-indexes the proposal in the background; Context.Search answers /search.
// POST /proposals/:id/send calls the LLM (Llm.js); Context.Caller, when given, replaces Llm.Caller (the tests use it).
// Each project has a context (a proposal of Kind 'context'): every call to the LLM includes it and may change it;
// POST /projects/:pid/context/initialize asks the LLM to write it from the project.

const EXPRESS = require( 'express' );
const CRYPTO = require( 'crypto' );
const RULES = require( './Rules.js' );
const ANCHORS = require( './Anchors.js' );
const PARTICIPANTS = require( './Participants.js' );
const LLM = require( './Llm.js' );
const STORE = require( './Store.js' );
const TREE = require( './Tree.js' );
const CORPUS = require( './Corpus.js' );

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
		if ( Context.Refresh && kind !== 'trashed' && kind !== 'title' && kind !== 'state' )
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


	// One word for the page: contested | reopened | resolved (waiting to be applied) | applied
	function state_of( thread )
	{
		if ( thread.Status === 'contested' )
		{
			return thread.Reopened ? 'reopened' : 'contested';
		}
		return RULES.IsWaiting( thread ) ? 'resolved' : 'applied';
	}


	function summarize( proposal, threads, name )
	{
		let tally = RULES.Tally( proposal, threads, participants() );
		let line = is_context( proposal ) ? 'the project\'s context' : ( is_document( proposal ) ? 'a document' : RULES.StateLine( tally, name ) );
		return Object.assign( {}, proposal, { Tally: tally, StateLine: line } );
	}


	// A Document is edited and kept like a Plan, but has no threads and no state; the LLM reads it through search.
	// A project's Context is kept the same way, so it answers true here too.
	function is_document( proposal )
	{
		return proposal.Kind === 'document' || proposal.Kind === 'context';
	}


	// A project's Context: in every call to the LLM, which may rewrite it; never moved, copied or deleted.
	function is_context( proposal )
	{
		return proposal.Kind === 'context';
	}


	function states()
	{
		return PARTICIPANTS.States( settings );
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
		response.json( { Me: PARTICIPANTS.Public( request.Participant ), Participants: participants(), States: states() } );
	} );


	//-----------------------------------------------------------------
	// Proposals

	router.get( '/proposals', async function ( request, response )
	{
		let proposals = await store.ListProposals();
		let state = request.query.state;
		let list = [];
		for ( let proposal of proposals )
		{
			if ( state && proposal.State !== state )
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
		let kind = ( body.Kind === undefined ) ? 'plan' : body.Kind;
		if ( kind !== 'plan' && kind !== 'document' )
		{
			return fail( response, 400, 'Kind must be plan or document' );
		}
		let state = states()[ 0 ];
		if ( kind === 'document' && body.State !== undefined && body.State !== null )
		{
			return fail( response, 400, 'a Document has no State' );
		}
		if ( kind === 'plan' && body.State !== undefined )
		{
			let can = RULES.CanSetState( body.State, states() );
			if ( !can.Ok )
			{
				return fail( response, 400, can.Reason );
			}
			state = body.State;
		}
		// Where it goes: a project (Default when not named) and a folder in it (its root when not named).
		let project_id = ( body.Project === undefined || body.Project === null ) ? STORE.DEFAULT_PROJECT : body.Project;
		let parent = ( body.Parent === undefined ) ? null : body.Parent;
		let target = await store.ReadProject( project_id );
		if ( !target )
		{
			return fail( response, 404, 'no such project' );
		}
		if ( !TREE.Children( target.Items, parent ) )
		{
			return fail( response, 400, 'Parent is not a folder of the project' );
		}
		let proposal = await store.CreateProposal( { Title: title, Text: text_of( body.Text ), By: request.Participant.Name, Kind: kind, State: state } );
		let placed = await change_project( project_id, null, function ( project )
		{
			if ( !TREE.Insert( project.Items, parent, { Kind: kind, Id: proposal.Id } ) )
			{
				TREE.Insert( project.Items, null, { Kind: kind, Id: proposal.Id } );
			}
		} );
		if ( placed.Refused )
		{
			console.error( 'projects: ' + proposal.Id + ' was created but not placed: ' + placed.Refused.Error );
		}
		changed( proposal.Id, 'created' );
		response.status( 201 ).json( { Proposal: summarize( proposal, [], request.Participant.Name ), Project: project_id } );
	} );


	router.get( '/proposals/:id', async function ( request, response )
	{
		let read = await store.ReadProposal( request.params.id );
		if ( !read )
		{
			return fail( response, 404, 'no such proposal' );
		}
		let name = request.Participant.Name;
		let holder = await store.ProjectOf( request.params.id );
		response.json( {
			Me: PARTICIPANTS.Public( request.Participant ),
			Participants: participants(),
			Project: holder ? { Id: holder.Id, Name: holder.Name } : null,
			Proposal: summarize( read.Proposal, read.Threads, name ),
			Text: read.Text,
			Threads: present_threads( read.Threads, read.Text, name ),
			Llm: ( is_document( read.Proposal ) && !is_context( read.Proposal ) ) ? { Configured: false } : llm_view( request.params.id, read.Threads ),
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


	// A manual edit: a new revision; no thread's status changes. Refused when made from a stale revision.
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
			let proposal = await store.WriteText( id, { Text: body.Text, By: request.Participant.Name, Reason: 'edit' } );
			refind( read.Threads, body.Text );
			await store.WriteThreads( id, read.Threads );
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
		let read = await store.ReadProposal( id );
		if ( read && is_context( read.Proposal ) )
		{
			return fail( response, 409, 'a project\'s context is never deleted on its own' );
		}
		let moved = await store.Queue( id, async function ()
		{
			return await store.TrashProposal( id );
		} );
		if ( !moved )
		{
			return fail( response, 404, 'no such proposal' );
		}
		let holder = await store.ProjectOf( id );
		if ( holder )
		{
			await change_project( holder.Id, null, function ( project )
			{
				TREE.Remove( project.Items, id );
			} );
		}
		changed( id, 'trashed' );
		response.json( { Trashed: id } );
	} );


	router.get( '/trash', async function ( request, response )
	{
		response.json( { Proposals: await store.ListTrash() } );
	} );


	// A proposal's state: one of the settings' States, set by anyone at any time. { State }
	router.put( '/proposals/:id/state', async function ( request, response )
	{
		let wanted = ( request.body || {} ).State;
		let can = RULES.CanSetState( wanted, states() );
		if ( !can.Ok )
		{
			return fail( response, 400, can.Reason );
		}
		let id = request.params.id;
		let result = await store.Queue( id, async function ()
		{
			let read = await store.ReadProposal( id );
			if ( !read )
			{
				return fail( response, 404, 'no such proposal' );
			}
			if ( is_document( read.Proposal ) )
			{
				return fail( response, 409, 'a Document or a Context has no State' );
			}
			let proposal = await store.UpdateProposal( id, { State: wanted } );
			return summarize( proposal, read.Threads, request.Participant.Name );
		} );
		if ( !result )
		{
			return;
		}
		changed( id, 'state' );
		response.json( { Proposal: result } );
	} );


	//-----------------------------------------------------------------
	// Projects: each holds a tree of folders and items (Tree.js). Writes to one project run through its queue;
	// a write that names a Version is refused (409) when the project has moved on, as a stale revision is.

	function project_queue( id )
	{
		return 'project:' + id;
	}


	// Change( project ) edits the project in place, or returns a refusal to leave it as it was.
	// Returns { Project } or { Refused: { Status, Error, Extra } }.
	async function change_project( id, version, change )
	{
		let result = await store.Queue( project_queue( id ), async function ()
		{
			let project = await store.ReadProject( id );
			if ( !project )
			{
				return refused( 404, 'no such project' );
			}
			if ( version !== null && version !== undefined && version !== project.Version )
			{
				return refused( 409, 'the project changed since version ' + version + '; reload and try again', { Version: project.Version } );
			}
			let outcome = await change( project );
			if ( outcome && outcome.Refused )
			{
				return outcome;
			}
			return { Project: await store.WriteProject( project ) };
		} );
		if ( !result.Refused )
		{
			events.Send( { Project: id, Kind: 'project' } );
		}
		return result;
	}


	// The projects as the page shows them: each item with its title, state and tally.
	async function present_projects( projects, name )
	{
		let views = {};
		for ( let proposal of await store.ListProposals() )
		{
			let read = await store.ReadProposal( proposal.Id );
			let summary = summarize( proposal, read ? read.Threads : [], name );
			views[ proposal.Id ] = { Title: summary.Title, State: summary.State, Tally: summary.Tally, StateLine: summary.StateLine, Updated: summary.Updated };
		}
		for ( let corpus of await store.ListCorpora() )
		{
			let indexed = corpus.Files.filter( function ( file ) { return file.Indexed; } ).length;
			views[ corpus.Id ] = { Title: corpus.Name, Files: corpus.Files.length, Indexed: indexed, Updated: corpus.Updated };
		}
		let empty = {};
		for ( let project of projects )
		{
			let read = project.Context ? await store.ReadProposal( project.Context ) : null;
			empty[ project.Id ] = !read || !read.Text.trim();
		}
		return projects.map( function ( project )
		{
			let context = project.Context ? { Id: project.Context, Empty: empty[ project.Id ] } : null;
			return Object.assign( {}, project, { Items: present_items( project.Items, views ), Context: context } );
		} );
	}


	function present_items( items, views )
	{
		return items.map( function ( node )
		{
			if ( node.Kind === 'folder' )
			{
				return { Kind: 'folder', Id: node.Id, Name: node.Name, Items: present_items( node.Items, views ) };
			}
			let view = views[ node.Id ];
			if ( !view )
			{
				return { Kind: node.Kind, Id: node.Id, Missing: true };
			}
			return Object.assign( { Kind: node.Kind, Id: node.Id }, view );
		} );
	}


	function name_of_body( body )
	{
		return text_of( ( body || {} ).Name ).trim();
	}


	function send_result( response, result, status, value )
	{
		if ( result.Refused )
		{
			return fail( response, result.Refused.Status, result.Refused.Error, result.Refused.Extra );
		}
		response.status( status ).json( value );
	}


	router.get( '/projects', async function ( request, response )
	{
		let projects = await store.ListProjects();
		response.json( { Projects: await present_projects( projects, request.Participant.Name ) } );
	} );


	router.post( '/projects', async function ( request, response )
	{
		let name = name_of_body( request.body );
		if ( !name )
		{
			return fail( response, 400, 'Name is required' );
		}
		let project = await store.CreateProject( { Name: name } );
		events.Send( { Project: project.Id, Kind: 'project' } );
		response.status( 201 ).json( { Project: project } );
	} );


	router.put( '/projects/:pid', async function ( request, response )
	{
		let name = name_of_body( request.body );
		if ( !name )
		{
			return fail( response, 400, 'Name is required' );
		}
		let result = await change_project( request.params.pid, request.body.Version, function ( project )
		{
			project.Name = name;
		} );
		send_result( response, result, 200, { Project: result.Project } );
	} );


	// Only an empty project is deleted, and never the Default one.
	router.delete( '/projects/:pid', async function ( request, response )
	{
		let id = request.params.pid;
		if ( id === STORE.DEFAULT_PROJECT )
		{
			return fail( response, 409, 'the Default project is never deleted' );
		}
		let result = await store.Queue( project_queue( id ), async function ()
		{
			let project = await store.ReadProject( id );
			if ( !project )
			{
				return refused( 404, 'no such project' );
			}
			if ( project.Items.length )
			{
				return refused( 409, 'only an empty project is deleted: move or delete what it holds first' );
			}
			await store.DeleteProject( id );
			if ( project.Context )
			{
				await store.Queue( project.Context, function () { return store.TrashProposal( project.Context ); } );
			}
			return { Deleted: id };
		} );
		if ( !result.Refused )
		{
			events.Send( { Project: id, Kind: 'project' } );
		}
		send_result( response, result, 200, result );
	} );


	// A project moves in the display order: just before the project Before, or to the end when Before is null.
	router.post( '/projects/:pid/move', async function ( request, response )
	{
		let body = request.body || {};
		let before = ( typeof body.Before === 'string' && body.Before ) ? body.Before : null;
		if ( !await store.ReadProject( request.params.pid ) )
		{
			return fail( response, 404, 'no such project' );
		}
		if ( before !== null && !await store.ReadProject( before ) )
		{
			return fail( response, 400, 'Before is not a project' );
		}
		await store.MoveProject( request.params.pid, before );
		events.Send( { Project: request.params.pid, Kind: 'project' } );
		response.json( { Projects: await present_projects( await store.ListProjects(), request.Participant.Name ) } );
	} );


	router.post( '/projects/:pid/folders', async function ( request, response )
	{
		let body = request.body || {};
		let name = name_of_body( body );
		if ( !name )
		{
			return fail( response, 400, 'Name is required' );
		}
		let folder = { Kind: 'folder', Id: new_id( 'f' ), Name: name, Items: [] };
		let result = await change_project( request.params.pid, body.Version, function ( project )
		{
			if ( !TREE.Insert( project.Items, ( body.Parent === undefined ) ? null : body.Parent, folder ) )
			{
				return refused( 400, 'Parent is not a folder of the project' );
			}
		} );
		send_result( response, result, 201, { Folder: folder, Project: result.Project } );
	} );


	router.put( '/projects/:pid/folders/:fid', async function ( request, response )
	{
		let body = request.body || {};
		let name = name_of_body( body );
		if ( !name )
		{
			return fail( response, 400, 'Name is required' );
		}
		let result = await change_project( request.params.pid, body.Version, function ( project )
		{
			let found = TREE.Find( project.Items, request.params.fid );
			if ( !found || found.Node.Kind !== 'folder' )
			{
				return refused( 404, 'no such folder' );
			}
			found.Node.Name = name;
		} );
		send_result( response, result, 200, { Project: result.Project } );
	} );


	// Only an empty folder is deleted.
	router.delete( '/projects/:pid/folders/:fid', async function ( request, response )
	{
		let result = await change_project( request.params.pid, null, function ( project )
		{
			let found = TREE.Find( project.Items, request.params.fid );
			if ( !found || found.Node.Kind !== 'folder' )
			{
				return refused( 404, 'no such folder' );
			}
			if ( found.Node.Items.length )
			{
				return refused( 409, 'only an empty folder is deleted: move or delete what it holds first' );
			}
			TREE.Remove( project.Items, found.Node.Id );
		} );
		send_result( response, result, 200, { Project: result.Project } );
	} );


	//-----------------------------------------------------------------
	// Corpus: an uploaded zip whose text files are indexed with its project. The zip is the request's body
	// (Content-Type: application/zip), no larger than the settings' Corpus.MaxZipMegabytes.

	function corpus_queue( id )
	{
		return 'corpus:' + id;
	}


	function zip_body()
	{
		return EXPRESS.raw( { type: 'application/zip', limit: CORPUS.Limits( settings ).MaxZipMegabytes + 'mb' } );
	}


	// The files of an uploaded zip, or a refusal naming what is wrong with it.
	async function extract_upload( body )
	{
		if ( !Buffer.isBuffer( body ) || body.length === 0 )
		{
			return refused( 400, 'send the zip as the body, with Content-Type: application/zip' );
		}
		try
		{
			return await CORPUS.Extract( body, CORPUS.Limits( settings ) );
		}
		catch ( error )
		{
			return refused( 400, error.message );
		}
	}


	// Re-index a corpus in the background, through its queue; a new index is announced when done.
	function corpus_changed( id, kind )
	{
		events.Send( { Corpus: id, Kind: kind } );
		if ( Context.RefreshCorpus && kind !== 'trashed' )
		{
			store.Queue( corpus_queue( id ), function () { return Context.RefreshCorpus( id ); } ).catch( function ( error )
			{
				console.error( 'index: corpus ' + id + ': ' + error.message );
			} );
		}
	}


	router.post( '/projects/:pid/corpus', zip_body(), async function ( request, response )
	{
		let name = text_of( request.query.name ).trim().replace( /\.zip$/i, '' );
		if ( !name )
		{
			return fail( response, 400, 'name is required' );
		}
		let parent = text_of( request.query.parent ) || null;
		let target = await store.ReadProject( request.params.pid );
		if ( !target )
		{
			return fail( response, 404, 'no such project' );
		}
		if ( !TREE.Children( target.Items, parent ) )
		{
			return fail( response, 400, 'parent is not a folder of the project' );
		}
		let extracted = await extract_upload( request.body );
		if ( extracted.Refused )
		{
			return send_result( response, extracted );
		}
		let corpus = await store.CreateCorpus( { Name: name, Zip: request.body, Files: extracted.Files } );
		await change_project( target.Id, null, function ( project )
		{
			if ( !TREE.Insert( project.Items, parent, { Kind: 'corpus', Id: corpus.Id } ) )
			{
				TREE.Insert( project.Items, null, { Kind: 'corpus', Id: corpus.Id } );
			}
		} );
		corpus_changed( corpus.Id, 'created' );
		response.status( 201 ).json( { Corpus: corpus, Project: target.Id } );
	} );


	router.get( '/corpus/:cid', async function ( request, response )
	{
		let corpus = await store.ReadCorpus( request.params.cid );
		if ( !corpus )
		{
			return fail( response, 404, 'no such corpus' );
		}
		let holder = await store.ProjectOf( corpus.Id );
		response.json( { Corpus: corpus, Project: holder ? { Id: holder.Id, Name: holder.Name } : null } );
	} );


	router.get( '/corpus/:cid/file', async function ( request, response )
	{
		let path = text_of( request.query.path );
		let corpus = await store.ReadCorpus( request.params.cid );
		if ( !corpus )
		{
			return fail( response, 404, 'no such corpus' );
		}
		let file = corpus.Files.find( function ( candidate ) { return candidate.Path === path; } );
		if ( !file )
		{
			return fail( response, 404, 'no such file in the corpus' );
		}
		if ( !file.Indexed )
		{
			return fail( response, 409, 'this file was not taken in: ' + file.Reason );
		}
		let text = await CORPUS.ReadFile( await store.ReadCorpusZip( corpus.Id ), path );
		response.json( { Path: path, Text: text } );
	} );


	// A new zip over the corpus: its files are listed and indexed again.
	router.put( '/corpus/:cid', zip_body(), async function ( request, response )
	{
		let id = request.params.cid;
		let extracted = await extract_upload( request.body );
		if ( extracted.Refused )
		{
			return send_result( response, extracted );
		}
		let corpus = await store.Queue( corpus_queue( id ), function ()
		{
			return store.ReplaceCorpus( id, { Zip: request.body, Files: extracted.Files } );
		} );
		if ( !corpus )
		{
			return fail( response, 404, 'no such corpus' );
		}
		corpus_changed( id, 'replaced' );
		response.json( { Corpus: corpus } );
	} );


	router.put( '/corpus/:cid/name', async function ( request, response )
	{
		let name = name_of_body( request.body );
		if ( !name )
		{
			return fail( response, 400, 'Name is required' );
		}
		let id = request.params.cid;
		let corpus = await store.Queue( corpus_queue( id ), function () { return store.RenameCorpus( id, name ); } );
		if ( !corpus )
		{
			return fail( response, 404, 'no such corpus' );
		}
		events.Send( { Corpus: id, Kind: 'renamed' } );
		let holder = await store.ProjectOf( id );
		if ( holder )
		{
			events.Send( { Project: holder.Id, Kind: 'project' } );
		}
		response.json( { Corpus: corpus } );
	} );


	router.delete( '/corpus/:cid', async function ( request, response )
	{
		let id = request.params.cid;
		let moved = await store.Queue( corpus_queue( id ), function () { return store.TrashCorpus( id ); } );
		if ( !moved )
		{
			return fail( response, 404, 'no such corpus' );
		}
		let holder = await store.ProjectOf( id );
		if ( holder )
		{
			await change_project( holder.Id, null, function ( project )
			{
				TREE.Remove( project.Items, id );
			} );
		}
		corpus_changed( id, 'trashed' );
		response.json( { Trashed: id } );
	} );


	//-----------------------------------------------------------------
	// Items: any node of a tree (a folder, a plan, a document) moved or copied, within a project or into another.
	// Body = { Project, Parent? }  Parent is a folder of Project; without it, the project's root.

	// Where an item goes: { Project, Parent (a folder's id, or null for the root), Before (the id of the child it
	// goes just before, or null for the end) }.
	function where_of( body )
	{
		let where = body || {};
		let before = ( typeof where.Before === 'string' && where.Before ) ? where.Before : null;
		return { Project: where.Project, Parent: ( where.Parent === undefined ) ? null : where.Parent, Before: before };
	}


	// The target is a project, and Parent (when given) one of its folders. Returns null or a refusal.
	async function check_target( where )
	{
		if ( typeof where.Project !== 'string' || !where.Project )
		{
			return refused( 400, 'Project is required' );
		}
		let project = await store.ReadProject( where.Project );
		if ( !project )
		{
			return refused( 404, 'no such project' );
		}
		if ( !TREE.Children( project.Items, where.Parent ) )
		{
			return refused( 400, 'Parent is not a folder of the project' );
		}
		return null;
	}


	// Move: into a folder or a project's root, at the end or just before a child of it; within a project or
	// into another.
	router.post( '/items/:id/move', async function ( request, response )
	{
		let id = request.params.id;
		let where = where_of( request.body );
		if ( where.Before === id )
		{
			return fail( response, 400, 'an item cannot go just before itself' );
		}
		let problem = await check_target( where );
		if ( problem )
		{
			return send_result( response, problem );
		}
		let source = await store.ProjectOf( id );
		if ( !source )
		{
			return fail( response, 404, 'no such item in any project' );
		}
		let result = null;
		if ( source.Id === where.Project )
		{
			result = await change_project( source.Id, null, function ( project )
			{
				let found = TREE.Find( project.Items, id );
				if ( !found )
				{
					return refused( 404, 'no such item in the project' );
				}
				if ( where.Parent !== null && TREE.Contains( found.Node, where.Parent ) )
				{
					return refused( 400, 'a folder cannot go inside itself' );
				}
				TREE.Remove( project.Items, id );
				TREE.Insert( project.Items, where.Parent, found.Node, where.Before );
			} );
		}
		else
		{
			// Out of one project, into the other; if the second step is refused, the item goes back to its first project's root.
			let node = null;
			let taken = await change_project( source.Id, null, function ( project )
			{
				node = TREE.Remove( project.Items, id );
				if ( !node )
				{
					return refused( 404, 'no such item in the project' );
				}
			} );
			if ( taken.Refused )
			{
				return send_result( response, taken );
			}
			result = await change_project( where.Project, null, function ( project )
			{
				if ( !TREE.Insert( project.Items, where.Parent, node, where.Before ) )
				{
					return refused( 400, 'Parent is not a folder of the project' );
				}
			} );
			if ( result.Refused )
			{
				await change_project( source.Id, null, function ( project )
				{
					TREE.Insert( project.Items, null, node );
				} );
			}
		}
		send_result( response, result, 200, { Project: result.Project } );
	} );


	// A copy of a plan or document is whole (text, threads, revisions) under a new id; a folder's copy holds a
	// copy of everything in it, with new ids throughout.
	router.post( '/items/:id/copy', async function ( request, response )
	{
		let id = request.params.id;
		let where = where_of( request.body );
		let problem = await check_target( where );
		if ( problem )
		{
			return send_result( response, problem );
		}
		let source = await store.ProjectOf( id );
		let found = source ? TREE.Find( source.Items, id ) : null;
		if ( !found )
		{
			return fail( response, 404, 'no such item in any project' );
		}
		let copy = await copy_node( found.Node );
		if ( copy.Refused )
		{
			return send_result( response, copy );
		}
		let result = await change_project( where.Project, null, function ( project )
		{
			if ( !TREE.Insert( project.Items, where.Parent, copy ) )
			{
				return refused( 400, 'Parent is not a folder of the project' );
			}
		} );
		send_result( response, result, 201, { Node: copy, Project: result.Project } );
	} );


	// The copy of one node and everything under it, or a refusal.
	async function copy_node( node )
	{
		if ( node.Kind === 'folder' )
		{
			let folder = { Kind: 'folder', Id: new_id( 'f' ), Name: node.Name, Items: [] };
			for ( let child of node.Items )
			{
				let copied = await copy_node( child );
				if ( copied.Refused )
				{
					return copied;
				}
				folder.Items.push( copied );
			}
			return folder;
		}
		if ( node.Kind === 'plan' || node.Kind === 'document' )
		{
			let proposal = await store.Queue( node.Id, function () { return store.CopyProposal( node.Id ); } );
			if ( !proposal )
			{
				return refused( 404, 'no such proposal: ' + node.Id );
			}
			changed( proposal.Id, 'created' );
			return { Kind: node.Kind, Id: proposal.Id };
		}
		if ( node.Kind === 'corpus' )
		{
			let corpus = await store.Queue( corpus_queue( node.Id ), function () { return store.CopyCorpus( node.Id ); } );
			if ( !corpus )
			{
				return refused( 404, 'no such corpus: ' + node.Id );
			}
			corpus_changed( corpus.Id, 'created' );
			return { Kind: 'corpus', Id: corpus.Id };
		}
		return refused( 409, 'a ' + node.Kind + ' item cannot be copied' );
	}


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
			if ( is_document( read.Proposal ) )
			{
				return fail( response, 409, 'a Document or a Context has no threads' );
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
			await store.UpdateProposal( id, {} );
			return present_threads( [ thread ], read.Text, request.Participant.Name )[ 0 ];
		} );
		if ( !result )
		{
			return;
		}
		changed( id, 'thread', result.Id );
		response.status( 201 ).json( { Thread: result } );
	} );


	// A reply. To a resolved thread it reopens it; a change already applied stays applied. With Resolve (the owner's
	// Reply and resolve), the thread is resolved in the same write, the reply being its outcome.
	// Returns { Thread, Reopened, Resolved } or { Refused: { Status, Error } }; the route and the LLM's call share it.
	async function add_reply( id, thread_id, participant, text, resolve )
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
			if ( resolve )
			{
				let can = RULES.CanResolve( participant, thread );
				if ( !can.Ok )
				{
					return refused( ( participant.Role === 'owner' ) ? 409 : 403, can.Reason );
				}
				Object.assign( thread, RULES.ResolveEffect( participant, now() ) );
			}
			await store.WriteThreads( id, read.Threads );
			await store.UpdateProposal( id, {} );
			return { Thread: present_threads( [ thread ], read.Text, participant.Name )[ 0 ], Reopened: effect.Reopen, Resolved: !!resolve };
		} );
		if ( !result.Refused )
		{
			let kind = result.Resolved ? 'resolved' : ( result.Reopened ? 'reopened' : 'reply' );
			changed( id, kind, result.Thread.Id );
		}
		return result;
	}


	// Body = { Text, Resolve? }  Resolve: true is the owner's Reply and resolve.
	router.post( '/proposals/:id/threads/:tid/replies', async function ( request, response )
	{
		let body = request.body || {};
		let text = text_of( body.Text ).trim();
		if ( !text )
		{
			return fail( response, 400, 'Text is required' );
		}
		let result = await add_reply( request.params.id, request.params.tid, request.Participant, text, body.Resolve === true );
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


	// Delete: owner only, any thread. The revisions that applied it keep their text and their Thread id.
	router.delete( '/proposals/:id/threads/:tid', async function ( request, response )
	{
		let id = request.params.id;
		let result = await store.Queue( id, async function ()
		{
			let read = await store.ReadProposal( id );
			if ( !read )
			{
				return fail( response, 404, 'no such proposal' );
			}
			let can = RULES.CanDeleteThread( request.Participant );
			if ( !can.Ok )
			{
				return fail( response, 403, can.Reason );
			}
			let index = read.Threads.findIndex( function ( candidate ) { return candidate.Id === request.params.tid; } );
			if ( index < 0 )
			{
				return fail( response, 404, 'no such thread' );
			}
			read.Threads.splice( index, 1 );
			await store.WriteThreads( id, read.Threads );
			await store.UpdateProposal( id, {} );
			return { Id: request.params.tid };
		} );
		if ( !result )
		{
			return;
		}
		changed( id, 'thread-deleted', result.Id );
		response.json( { Deleted: result.Id } );
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
	// LLM sessions: the owner shapes a prompt (Options), picks where it goes (a Destination, or Manual copy / paste),
	// and the answer's actions are carried out as the llm participant. Each session's steps are its run log, kept with
	// the proposal in runs.json. Send to LLM is a session with the first destination and the default options.

	let calling = {};
	let recent_calls = [];
	const HOUR = 60 * 60 * 1000;
	const SEARCH_PER_THREAD = 3;
	const RUNS_KEPT = 20;
	const MANUAL = 'Manual';
	const THREAD_CHOICES = [ 'waiting', 'open', 'all' ];


	// The llm participant, called by Consensus or not.
	function llm_participant()
	{
		return ( settings.Participants || [] ).find( function ( participant ) { return participant.Role === 'llm'; } ) || null;
	}


	// The llm participant with somewhere to send a prompt (a Call or Destinations), or null.
	function called_llm()
	{
		let llm = llm_participant();
		return ( llm && LLM.Destinations( llm ).length ) ? llm : null;
	}


	function calls_in_last_hour()
	{
		let since = Date.now() - HOUR;
		recent_calls = recent_calls.filter( function ( at ) { return at > since; } );
		return recent_calls.length;
	}


	// What the page needs for the button: who, whether a session runs, how much is waiting.
	function llm_view( id, threads )
	{
		let llm = llm_participant();
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


	// A session's choices, each defaulted: { Context: true, Threads: 'waiting' | 'open' | 'all', Search: true }
	function options_of( given )
	{
		let options = given || {};
		return {
			Context: options.Context !== false,
			Threads: THREAD_CHOICES.includes( options.Threads ) ? options.Threads : 'open',
			Search: options.Search !== false,
		};
	}


	// The same from a query string: ?context=0&threads=waiting&search=0
	function options_of_query( query )
	{
		return options_of( {
			Context: query.context !== '0' && query.context !== 'false',
			Threads: query.threads,
			Search: query.search !== '0' && query.search !== 'false',
		} );
	}


	function tokens_of( text )
	{
		return Math.ceil( String( text ).length / 4 );
	}


	// Everything one session needs, for the llm participant: { Prompt, Parts, Read, Waiting, Context }. The threads
	// sent are those Options.Threads names; the waiting ones are always among them.
	async function package_for( id, llm, options )
	{
		let chosen = options_of( options );
		let read = await store.ReadProposal( id );
		let presented = present_threads( read.Threads, read.Text, llm.Name );
		let waiting = presented.filter( function ( thread ) { return thread.WaitingOnMe; } );
		let sent = presented.filter( function ( thread )
		{
			if ( chosen.Threads === 'waiting' )
			{
				return thread.WaitingOnMe;
			}
			if ( chosen.Threads === 'open' )
			{
				return thread.WaitingOnMe || thread.State !== 'applied';
			}
			return true;
		} );
		// The context comes from the proposal's own project: its context, and its plans, documents and corpus files.
		let holder = await store.ProjectOf( id );
		let context = chosen.Context ? await context_of( holder ) : null;
		let search = chosen.Search ? await search_for( waiting, holder ? TREE.ItemIds( holder.Items ) : null ) : {};
		let parts = LLM.PromptParts( {
			Project: holder ? holder.Name : null,
			Context: context,
			MaxCharacters: LLM.ContextSettings( settings ).MaxCharacters,
			Proposal: read.Proposal,
			Text: read.Text,
			Threads: sent,
			Me: llm.Name,
			Participants: participants(),
			Search: search,
		} );
		let prompt = parts.map( function ( part ) { return part.Text; } ).join( '\n' );
		return { Prompt: prompt, Parts: parts, Read: read, Waiting: waiting, Context: context };
	}


	// A prompt as the dialog shows it: its size, part by part, and the revisions it was made from.
	function prompt_view( packed )
	{
		return {
			Prompt: packed.Prompt,
			Parts: packed.Parts.map( function ( part ) { return { Name: part.Name, Characters: part.Text.length, Tokens: tokens_of( part.Text ) }; } ),
			Characters: packed.Prompt.length,
			Tokens: tokens_of( packed.Prompt ),
			Schema: LLM.SCHEMA,
			Revision: packed.Read.Proposal.Revision,
			Context: packed.Context ? { Id: packed.Context.Id, Revision: packed.Context.Revision } : null,
			Waiting: packed.Waiting.map( function ( thread ) { return thread.Id; } ),
		};
	}


	//-----------------------------------------------------------------
	// The run log: runs.json beside the proposal's threads, the last RUNS_KEPT sessions, written through its own queue.

	function runs_queue( id )
	{
		return 'runs:' + id;
	}


	async function start_run( id, destination, model, options )
	{
		let run = { Id: new_id( 's' ), Started: now(), Destination: destination, Model: model || null, Options: options, Steps: [], Finished: null };
		await store.Queue( runs_queue( id ), async function ()
		{
			let runs = await store.ReadRuns( id );
			runs.push( run );
			await store.WriteRuns( id, runs.slice( -RUNS_KEPT ) );
		} );
		events.Send( { Proposal: id, Kind: 'run', Run: run.Id } );
		return run.Id;
	}


	// A step of a run: { Text, Seconds?, Tokens? }; Finished ends the run.
	async function log_step( id, run_id, step, finished )
	{
		await store.Queue( runs_queue( id ), async function ()
		{
			let runs = await store.ReadRuns( id );
			let run = runs.find( function ( candidate ) { return candidate.Id === run_id; } );
			if ( !run )
			{
				return;
			}
			if ( step )
			{
				run.Steps.push( Object.assign( { At: now() }, step ) );
			}
			if ( finished )
			{
				run.Finished = now();
			}
			await store.WriteRuns( id, runs );
		} );
		events.Send( { Proposal: id, Kind: 'run', Run: run_id } );
	}


	function seconds_since( started )
	{
		return Math.round( ( Date.now() - started ) / 100 ) / 10;
	}


	// "2 replies, 1 apply, the context" for an answer's actions.
	function actions_words( actions )
	{
		let counts = { reply: 0, apply: 0, context: 0 };
		for ( let action of actions )
		{
			counts[ action.Kind ] = ( counts[ action.Kind ] || 0 ) + 1;
		}
		let words = [];
		if ( counts.reply )
		{
			words.push( counts.reply + ( counts.reply === 1 ? ' reply' : ' replies' ) );
		}
		if ( counts.apply )
		{
			words.push( counts.apply + ( counts.apply === 1 ? ' apply' : ' applies' ) );
		}
		if ( counts.context )
		{
			words.push( 'the context' );
		}
		return words.length ? words.join( ', ' ) : 'nothing to do';
	}


	// The answer's actions carried out, the results recorded on the threads, and the run log's last step.
	async function carry_out_answer( id, llm, run_id, actions, revision, context )
	{
		let read = await store.ReadProposal( id );
		let waiting = present_threads( read.Threads, read.Text, llm.Name ).filter( function ( thread ) { return thread.WaitingOnMe; } );
		let failures = await carry_out( id, llm, waiting, actions, revision, context );
		await record_call_results( id, failures, true );
		let refused = Object.keys( failures );
		let why = refused.map( function ( thread_id ) { return thread_id + ': ' + failures[ thread_id ]; } ).join( '; ' );
		await log_step( id, run_id, { Text: 'Consensus carried out ' + actions.length + ( actions.length === 1 ? ' action' : ' actions' ) + ', ' + refused.length + ' refused' + ( why ? ' (' + why + ')' : '' ) }, true );
		return failures;
	}


	//-----------------------------------------------------------------
	// The destinations, and the models an Ollama destination offers.

	router.get( '/llm/destinations', function ( request, response )
	{
		let llm = llm_participant();
		let destinations = llm ? LLM.Destinations( llm ) : [];
		response.json( {
			Destinations: destinations.map( function ( destination ) { return { Name: destination.Name, Kind: destination.Kind, Model: destination.Model || null }; } ),
			Manual: !!llm,
		} );
	} );


	router.get( '/llm/models', async function ( request, response )
	{
		let llm = llm_participant();
		let destination = llm ? LLM.Destinations( llm ).find( function ( candidate ) { return candidate.Name === request.query.destination; } ) : null;
		if ( !destination )
		{
			return fail( response, 404, 'no such destination' );
		}
		if ( destination.Kind !== 'ollama' )
		{
			return response.json( { Models: destination.Model ? [ destination.Model ] : [] } );
		}
		try
		{
			let answer = await fetch( String( destination.Url ).replace( /\/+$/, '' ) + '/api/tags', { signal: AbortSignal.timeout( 5000 ) } );
			let json = await answer.json();
			let names = ( json.models || [] ).map( function ( model ) { return model.name; } ).sort();
			response.json( { Models: names } );
		}
		catch ( error )
		{
			fail( response, 502, 'Ollama at ' + destination.Url + ' did not answer: ' + error.message );
		}
	} );


	//-----------------------------------------------------------------
	// The prompt, for the dialog's summary and preview (and for Manual copy): ?context=&threads=&search=

	router.get( '/proposals/:id/prompt', async function ( request, response )
	{
		if ( request.Participant.Role !== 'owner' )
		{
			return fail( response, 403, 'only the owner copies the prompt' );
		}
		let llm = llm_participant();
		if ( !llm )
		{
			return fail( response, 409, 'there is no llm participant in consensus.json' );
		}
		let read = await store.ReadProposal( request.params.id );
		if ( !read )
		{
			return fail( response, 404, 'no such proposal' );
		}
		if ( is_document( read.Proposal ) )
		{
			return fail( response, 409, 'a Document or a Context has no threads to send' );
		}
		response.json( prompt_view( await package_for( request.params.id, llm, options_of_query( request.query ) ) ) );
	} );


	router.get( '/proposals/:id/runs', async function ( request, response )
	{
		response.json( { Runs: await store.ReadRuns( request.params.id ) } );
	} );


	//-----------------------------------------------------------------
	// A session. Body = { Destination: a destination's Name or 'Manual', Model?, Options? }
	// Manual answers { Run, ...the prompt } at once; any other runs in the background and answers 202 { Run, Threads }.

	async function start_session( request, response, body )
	{
		if ( request.Participant.Role !== 'owner' )
		{
			return fail( response, 403, 'only the owner sends to the LLM' );
		}
		let llm = llm_participant();
		if ( !llm )
		{
			return fail( response, 409, 'no LLM is configured: give the llm participant a Call or Destinations in consensus.json' );
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
		if ( is_document( read.Proposal ) )
		{
			return fail( response, 409, 'a Document or a Context has no threads to send' );
		}
		let options = options_of( body.Options );
		if ( body.Destination === MANUAL )
		{
			let started = Date.now();
			let packed = await package_for( id, llm, options );
			let run_id = await start_run( id, MANUAL, null, options );
			await log_step( id, run_id, { Text: 'Consensus made the prompt for copying', Seconds: seconds_since( started ), Tokens: tokens_of( packed.Prompt ) } );
			return response.json( Object.assign( { Run: run_id }, prompt_view( packed ) ) );
		}
		let destinations = LLM.Destinations( llm );
		let destination = body.Destination ? destinations.find( function ( candidate ) { return candidate.Name === body.Destination; } ) : destinations[ 0 ];
		if ( !destination )
		{
			return fail( response, body.Destination ? 400 : 409, body.Destination ? 'no destination is named "' + body.Destination + '"' : 'no LLM is configured: give the llm participant a Call or Destinations in consensus.json' );
		}
		let call = Object.assign( {}, destination );
		if ( typeof body.Model === 'string' && body.Model.trim() )
		{
			call.Model = body.Model.trim();
		}
		if ( call.Kind === 'ollama' && !call.Model )
		{
			return fail( response, 400, 'pick an Ollama model' );
		}
		let waiting = RULES.WaitingOn( llm.Name, read.Threads, participants() );
		if ( waiting.length === 0 )
		{
			return fail( response, 409, 'nothing is waiting on the LLM' );
		}
		if ( calls_in_last_hour() >= call.CallsPerHour )
		{
			return fail( response, 409, 'the LLM is paused: ' + call.CallsPerHour + ' calls in the last hour' );
		}
		calling[ id ] = true;
		recent_calls.push( Date.now() );
		let run_id = await start_run( id, destination.Name, call.Model, options );
		events.Send( { Proposal: id, Kind: 'llm-started' } );
		response.status( 202 ).json( { Started: true, Run: run_id, Threads: waiting.map( function ( thread ) { return thread.Id; } ) } );

		run_session( id, llm, call, options, run_id ).catch( function ( error )
		{
			console.error( 'llm: ' + id + ': ' + error.message );
			return log_step( id, run_id, { Text: 'the session stopped: ' + error.message }, true );
		} ).finally( function ()
		{
			delete calling[ id ];
			events.Send( { Proposal: id, Kind: 'llm-finished' } );
		} );
	}


	router.post( '/proposals/:id/session', function ( request, response )
	{
		return start_session( request, response, request.body || {} );
	} );


	// Send to LLM, as it was before the dialog: the first destination, the default choices.
	router.post( '/proposals/:id/send', function ( request, response )
	{
		return start_session( request, response, {} );
	} );


	async function run_session( id, llm, call, options, run_id )
	{
		let started = Date.now();
		let packed = await package_for( id, llm, options );
		let model = call.Model || call.Kind;
		await log_step( id, run_id, { Text: 'Consensus sent the prompt to ' + model, Seconds: seconds_since( started ), Tokens: tokens_of( packed.Prompt ) } );
		let caller = ( Context.Caller || LLM.Caller )( call );
		let asked = Date.now();
		let answer = null;
		try
		{
			answer = await caller( packed.Prompt );
		}
		catch ( error )
		{
			let failures = {};
			for ( let thread of packed.Waiting )
			{
				failures[ thread.Id ] = error.message;
			}
			await record_call_results( id, failures, false );
			await log_step( id, run_id, { Text: model + ' failed: ' + error.message, Seconds: seconds_since( asked ) }, true );
			log_call( id, call, packed.Waiting, started, 'failed: ' + error.message );
			return;
		}
		await record_usage( call, answer.Usage );
		let answered_by = ( answer.Usage && answer.Usage.Model ) || model;
		await log_step( id, run_id, { Text: answered_by + ' answered: ' + actions_words( answer.Answer.Actions ), Seconds: seconds_since( asked ), Tokens: ( answer.Usage && answer.Usage.Output ) || tokens_of( JSON.stringify( answer.Answer ) ) } );
		let failures = await carry_out_answer( id, llm, run_id, answer.Answer.Actions, packed.Read.Proposal.Revision, packed.Context );
		let failed = Object.keys( failures ).length;
		log_call( id, call, packed.Waiting, started, answer.Answer.Actions.length + ' actions' + ( failed ? ', ' + failed + ' refused' : '' ) + ', ' + answer.Usage.Input + ' in, ' + answer.Usage.Output + ' out' );
	}


	// A pasted answer: Body = { Answer (the JSON object, or text holding it), Revision, ContextRevision?, Run? }
	// Returns { Actions, Refused }.
	router.post( '/proposals/:id/answer', async function ( request, response )
	{
		if ( request.Participant.Role !== 'owner' )
		{
			return fail( response, 403, 'only the owner pastes an answer' );
		}
		let llm = llm_participant();
		if ( !llm )
		{
			return fail( response, 409, 'there is no llm participant in consensus.json' );
		}
		let body = request.body || {};
		let id = request.params.id;
		if ( calling[ id ] )
		{
			return fail( response, 409, 'a call to the LLM is already running for this proposal' );
		}
		let answer = null;
		try
		{
			answer = LLM.Parse( body.Answer );
		}
		catch ( error )
		{
			return fail( response, 400, error.message );
		}
		if ( !await store.ReadProposal( id ) )
		{
			return fail( response, 404, 'no such proposal' );
		}
		if ( typeof body.Revision !== 'number' )
		{
			return fail( response, 400, 'Revision is required: the revision the prompt was made from' );
		}
		calling[ id ] = true;
		try
		{
			let run_id = ( typeof body.Run === 'string' && body.Run ) ? body.Run : await start_run( id, MANUAL, null, null );
			let pasted = ( typeof body.Answer === 'string' ) ? body.Answer : JSON.stringify( body.Answer );
			await log_step( id, run_id, { Text: 'The answer was pasted: ' + actions_words( answer.Actions ), Tokens: tokens_of( pasted ) } );
			let holder = await store.ProjectOf( id );
			let context = ( holder && holder.Context ) ? { Id: holder.Context, Revision: ( typeof body.ContextRevision === 'number' ) ? body.ContextRevision : null } : null;
			let failures = await carry_out_answer( id, llm, run_id, answer.Actions, body.Revision, context );
			console.log( 'llm: ' + id + ': a pasted answer, ' + answer.Actions.length + ' actions' + ( Object.keys( failures ).length ? ', ' + Object.keys( failures ).length + ' refused' : '' ) );
			response.json( { Actions: answer.Actions.length, Refused: failures, Run: run_id } );
		}
		finally
		{
			delete calling[ id ];
		}
	} );


	// For each waiting thread, the best passages elsewhere in Ids (the project's items; everything when null):
	// its anchor words and its last reply as the query.
	async function search_for( waiting, ids )
	{
		let found = {};
		if ( !Context.Search )
		{
			return found;
		}
		let titles = await source_titles();
		for ( let thread of waiting )
		{
			let last = thread.Replies[ thread.Replies.length - 1 ];
			let query = ( thread.Anchor ? thread.Anchor.Text + ' ' : '' ) + ( last ? last.Text : '' );
			let hits = [];
			try
			{
				hits = await Context.Search( query, SEARCH_PER_THREAD + 1, ids );
			}
			catch ( error )
			{
				console.error( 'llm: search for ' + thread.Id + ': ' + error.message );
			}
			found[ thread.Id ] = hits.filter( function ( hit ) { return hit.Thread !== thread.Id; } ).slice( 0, SEARCH_PER_THREAD ).map( function ( hit )
			{
				return Object.assign( {}, hit, { Title: title_of_hit( titles, hit ) } );
			} );
		}
		return found;
	}


	// The answer's actions, in order, each through the same rules as the API. Returns { threadId: reason } for refusals.
	// Context is the project's context as the call was given it ({ Id, Revision }), or null; one context action is
	// carried out, made from that revision.
	async function carry_out( id, llm, waiting, actions, revision, context )
	{
		let failures = {};
		let current_revision = revision;
		let context_written = false;
		for ( let action of actions )
		{
			if ( action.Kind === 'context' )
			{
				if ( !context || context_written )
				{
					console.error( 'llm: ' + id + ': ignored a context action' + ( context ? ', one is carried out per answer' : ', the proposal is in no project' ) );
					continue;
				}
				context_written = true;
				let written = await write_context( context.Id, llm, action.Text, text_of( action.Reason ).trim(), context.Revision );
				if ( written.Refused )
				{
					console.error( 'llm: ' + id + ': the context change was refused: ' + written.Refused.Error );
				}
				continue;
			}
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
				if ( thread.Status !== 'resolved' )
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


	//-----------------------------------------------------------------
	// The project's context: { Id, Text, Revision } for a project, or null.

	async function context_of( project )
	{
		if ( !project || !project.Context )
		{
			return null;
		}
		let read = await store.ReadProposal( project.Context );
		return read ? { Id: project.Context, Text: read.Text, Revision: read.Proposal.Revision } : null;
	}


	// A new revision of a context, made from Revision (refused when the context has moved on since).
	// Returns { Proposal } or { Refused }.
	async function write_context( id, who, text, reason, revision )
	{
		let result = await store.Queue( id, async function ()
		{
			let read = await store.ReadProposal( id );
			if ( !read || !is_context( read.Proposal ) )
			{
				return refused( 404, 'no such context' );
			}
			if ( read.Proposal.Revision !== revision )
			{
				return refused( 409, 'the context changed since revision ' + revision );
			}
			if ( read.Text === text )
			{
				return { Proposal: read.Proposal };
			}
			let proposal = await store.WriteText( id, { Text: text, By: who.Name, Reason: 'context', Note: reason || null } );
			return { Proposal: proposal };
		} );
		if ( !result.Refused )
		{
			changed( id, 'context' );
		}
		return result;
	}


	// Initialize context: the owner asks the LLM to write a project's context from the project: its plans and
	// documents by title, the files in its zips, and a few key files. The call runs in the background, as a send does.
	const KEY_FILE = /(^|\/)(readme(\.[a-z]+)?|claude\.md|agents\.md|package\.json|pyproject\.toml|cargo\.toml|go\.mod|pom\.xml|[^\/]+\.csproj)$/i;
	const KEY_FILE_COUNT = 6;

	router.post( '/projects/:pid/context/initialize', async function ( request, response )
	{
		if ( request.Participant.Role !== 'owner' )
		{
			return fail( response, 403, 'only the owner asks the LLM for a context' );
		}
		let llm = called_llm();
		if ( !llm )
		{
			return fail( response, 409, 'no LLM is configured: give the llm participant a Call in consensus.json' );
		}
		let project = await store.ReadProject( request.params.pid );
		if ( !project || !project.Context )
		{
			return fail( response, 404, 'no such project' );
		}
		let id = project.Context;
		if ( calling[ id ] )
		{
			return fail( response, 409, 'a call to the LLM is already running for this context' );
		}
		// the first destination writes it
		let call = LLM.Destinations( llm )[ 0 ];
		if ( !call.Model && call.Kind === 'ollama' )
		{
			return fail( response, 409, 'the first destination, ' + call.Name + ', names no model; give it a Model in consensus.json' );
		}
		if ( calls_in_last_hour() >= call.CallsPerHour )
		{
			return fail( response, 409, 'the LLM is paused: ' + call.CallsPerHour + ' calls in the last hour' );
		}
		calling[ id ] = true;
		recent_calls.push( Date.now() );
		events.Send( { Proposal: id, Kind: 'llm-started' } );
		response.status( 202 ).json( { Started: true, Context: id } );

		run_initialize( project, llm, call ).catch( function ( error )
		{
			console.error( 'llm: context ' + id + ': ' + error.message );
		} ).finally( function ()
		{
			delete calling[ id ];
			events.Send( { Proposal: id, Kind: 'llm-finished' } );
		} );
	} );


	async function run_initialize( project, llm, call )
	{
		let started = Date.now();
		let context = await context_of( project );
		let prompt = LLM.InitializePrompt( Object.assign( { Project: project.Name, Context: context, MaxCharacters: LLM.ContextSettings( settings ).MaxCharacters }, await project_contents( project ) ) );
		let caller = ( Context.Caller || LLM.Caller )( call );
		let answer = await caller( prompt );
		await record_usage( call, answer.Usage );
		let action = answer.Answer.Actions.find( function ( candidate ) { return candidate.Kind === 'context'; } );
		let what = 'no context in the answer';
		if ( action )
		{
			let written = await write_context( context.Id, llm, action.Text, text_of( action.Reason ).trim() || 'initialized from the project', context.Revision );
			what = written.Refused ? 'the context was refused: ' + written.Refused.Error : 'context revision ' + written.Proposal.Revision;
		}
		let seconds = ( ( Date.now() - started ) / 1000 ).toFixed( 1 );
		console.log( 'llm: context ' + context.Id + ' of ' + project.Id + ': ' + call.Kind + ( call.Model ? ' ' + call.Model : '' ) + ', ' + seconds + 's, ' + what + ', ' + answer.Usage.Input + ' in, ' + answer.Usage.Output + ' out' );
	}


	// What a project holds, for writing its context: { Items: [ { Kind, Title, State } ], Files: [ path ], KeyFiles: [ { Path, Text } ] }
	async function project_contents( project )
	{
		let items = [];
		let files = [];
		let key_files = [];
		for ( let id of TREE.ItemIds( project.Items ) )
		{
			let read = await store.ReadProposal( id );
			if ( read )
			{
				items.push( { Kind: read.Proposal.Kind || 'plan', Title: read.Proposal.Title, State: read.Proposal.State } );
				continue;
			}
			let corpus = await store.ReadCorpus( id );
			let zip = corpus ? await store.ReadCorpusZip( id ) : null;
			if ( !zip )
			{
				continue;
			}
			let extracted = await CORPUS.Extract( zip, CORPUS.Limits( settings ) );
			let paths = Object.keys( extracted.Texts );
			for ( let file of corpus.Files )
			{
				files.push( corpus.Name + '/' + file.Path );
			}
			let keys = paths.filter( function ( path ) { return KEY_FILE.test( path ); } ).sort( by_depth );
			for ( let path of keys )
			{
				if ( key_files.length < KEY_FILE_COUNT )
				{
					key_files.push( { Path: corpus.Name + '/' + path, Text: extracted.Texts[ path ] } );
				}
			}
		}
		return { Items: items, Files: files, KeyFiles: key_files };
	}


	// Shallow paths first: a readme at the top says more than one in a subfolder.
	function by_depth( a, b )
	{
		let depth_a = a.split( '/' ).length;
		let depth_b = b.split( '/' ).length;
		if ( depth_a !== depth_b )
		{
			return depth_a - depth_b;
		}
		return a.localeCompare( b );
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
				waiting.push( { Proposal: { Id: proposal.Id, Title: proposal.Title, State: proposal.State, Revision: proposal.Revision }, Thread: thread } );
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
		// ?project= keeps the search inside one project; without it, everything is searched.
		let ids = null;
		if ( request.query.project )
		{
			let project = await store.ReadProject( text_of( request.query.project ) );
			if ( !project )
			{
				return fail( response, 404, 'no such project' );
			}
			ids = TREE.ItemIds( project.Items );
		}
		let hits = await Context.Search( query, limit, ids );
		let titles = await source_titles();
		for ( let hit of hits )
		{
			hit.Title = title_of_hit( titles, hit );
		}
		response.json( { Query: query, Hits: hits } );
	} );


	// The title of everything a hit can come from: proposals by their Title, corpora by their Name.
	async function source_titles()
	{
		let titles = {};
		for ( let proposal of await store.ListProposals() )
		{
			titles[ proposal.Id ] = proposal.Title;
		}
		for ( let corpus of await store.ListCorpora() )
		{
			titles[ corpus.Id ] = corpus.Name;
		}
		return titles;
	}


	function title_of_hit( titles, hit )
	{
		let id = hit.Proposal || hit.Corpus;
		return titles[ id ] || id;
	}


	//-----------------------------------------------------------------

	router.use( function ( request, response )
	{
		fail( response, 404, 'no such route' );
	} );

	router.use( function ( error, request, response, next )
	{
		let status = error.status || error.statusCode || 500;
		if ( error.type === 'entity.too.large' && request.is( 'application/zip' ) )
		{
			return fail( response, 413, 'the zip is larger than ' + CORPUS.Limits( settings ).MaxZipMegabytes + ' MB (Corpus.MaxZipMegabytes in consensus.json)' );
		}
		fail( response, status, ( status === 500 ) ? 'internal error: ' + error.message : error.message );
	} );

	App.use( '/api', router );
}


module.exports = {
	Attach: Attach,
};
