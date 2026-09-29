'use strict';

// Api - the REST routes under /api, over Store, Rules, Anchors and Participants.
// Every rule lives here or in Rules.js, none in a client: the page and the LLM's curl see the same API.
// Errors are { Error } with a status. Writes to one proposal run through the store's queue.
// After a change, Context.Refresh( id ) re-indexes the proposal in the background; Context.Search answers /search.
// POST /proposals/:id/send calls the LLM (Llm.js); Context.Caller, when given, replaces Llm.Caller (the tests use it).
// Each project has a context (a proposal of Kind 'context'): every call to the LLM includes it and may change it;
// POST /projects/:pid/context/initialize asks the LLM to write it from the project.
// Context.Workers (Workers.js), when given, holds the workers in the settings (plan Workers): their Inference items
// are destinations, a review sent to one is queued as a job, and the worker routes under /api/workers take its
// token instead of a participant's.

const EXPRESS = require( 'express' );
const RULES = require( './Rules.js' );
const ANCHORS = require( './Anchors.js' );
const PARTICIPANTS = require( './Participants.js' );
const LLM = require( './Llm.js' );
const STORE = require( './Store.js' );
const TREE = require( './Tree.js' );
const CORPUS = require( './Corpus.js' );
const FILTER = require( './Filter.js' );
const PORT = require( './ProjectPort.js' );
const IDS = require( './Ids.js' );

const BODY_LIMIT = '64mb';	// a project import is one json body, every revision of every plan in it
const SEARCH_LIMIT = 10;


//---------------------------------------------------------------------
// Attach: mounts the routes on an Express app. Context = { Store, Settings, Events, Refresh?, Search?, Caller?,
// Workers? }

function Attach( App, Context )
{
	let store = Context.Store;
	let settings = Context.Settings;
	let events = Context.Events;
	let workers = Context.Workers || null;
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


	// A new global id of Kind (Ids.js).
	function new_id( Kind )
	{
		return IDS.New( Kind );
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
		// Where it goes: a project (Default when not named) and a folder in it, or a plan for a Subplan (its root
		// when not named).
		let project_id = ( body.Project === undefined || body.Project === null ) ? STORE.DEFAULT_PROJECT : body.Project;
		let parent = ( body.Parent === undefined ) ? null : body.Parent;
		let result = await create_proposal( request.Participant, { Title: title, Text: text_of( body.Text ), Kind: kind, State: state, Project: project_id, Parent: parent } );
		if ( result.Refused )
		{
			return send_result( response, result );
		}
		response.status( 201 ).json( { Proposal: summarize( result.Proposal, [], request.Participant.Name ), Project: result.Project } );
	} );


	// A new plan or document in a project, at Parent (a folder, or a plan for a Subplan), else at its root.
	// Fields = { Title, Text, Kind, State, Project, Parent }. Returns { Proposal, Project } or a refusal; the route
	// and the LLM's plan action share it.
	async function create_proposal( participant, fields )
	{
		let target = await store.ReadProject( fields.Project );
		if ( !target )
		{
			return refused( 404, 'no such project' );
		}
		if ( !TREE.CanHold( target.Items, fields.Parent, fields.Kind ) )
		{
			return refused( 400, PARENT_REFUSED );
		}
		let proposal = await store.CreateProposal( { Title: fields.Title, Text: fields.Text, By: participant.Name, Kind: fields.Kind, State: fields.State } );
		let placed = await change_project( target.Id, null, function ( project )
		{
			if ( !TREE.Insert( project.Items, fields.Parent, { Kind: fields.Kind, Id: proposal.Id } ) )
			{
				TREE.Insert( project.Items, null, { Kind: fields.Kind, Id: proposal.Id } );
			}
		} );
		if ( placed.Refused )
		{
			console.error( 'projects: ' + proposal.Id + ' was created but not placed: ' + placed.Refused.Error );
		}
		changed( proposal.Id, 'created' );
		return { Proposal: proposal, Project: target.Id };
	}


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
			Build: is_document( read.Proposal ) ? null : await build_view( request.params.id, read ),
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
		// A plan's Subplans go to the trash with it.
		let holder = await store.ProjectOf( id );
		let found = holder ? TREE.Find( holder.Items, id ) : null;
		let subplans = ( found && Array.isArray( found.Node.Items ) ) ? TREE.ItemIds( found.Node.Items ) : [];
		let moved = await store.Queue( id, async function ()
		{
			return await store.TrashProposal( id );
		} );
		if ( !moved )
		{
			return fail( response, 404, 'no such proposal' );
		}
		let trashed = [ id ];
		for ( let subplan of subplans )
		{
			if ( await store.Queue( subplan, function () { return store.TrashProposal( subplan ); } ) )
			{
				trashed.push( subplan );
			}
		}
		if ( holder )
		{
			await change_project( holder.Id, null, function ( project )
			{
				TREE.Remove( project.Items, id );
			} );
		}
		for ( let gone of trashed )
		{
			changed( gone, 'trashed' );
		}
		response.json( { Trashed: id, Subplans: trashed.slice( 1 ) } );
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
			views[ proposal.Id ] = { Title: summary.Title, State: summary.State, Tally: summary.Tally, StateLine: summary.StateLine, Created: summary.Created, Updated: summary.Updated };
		}
		for ( let corpus of await store.ListCorpora() )
		{
			let indexed = corpus.Files.filter( function ( file ) { return file.Indexed; } ).length;
			views[ corpus.Id ] = { Title: corpus.Name, Files: corpus.Files.length, Indexed: indexed, Created: corpus.Created, Updated: corpus.Updated, Source: 'attached', Waiting: !!corpus.Waiting };
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
			return Object.assign( {}, project, { Items: present_items( project.Items, views ), Context: context, Workspace: workspace_view( project ) } );
		} );
	}


	// A project's workspace as the page shows it: { Worker, Name, Online, Offered, Build }, or null when it names none.
	function workspace_view( project )
	{
		if ( !project.Workspace )
		{
			return null;
		}
		let offered = workers ? workers.Has( project.Workspace.Worker, project.Workspace.Name ) : null;
		return {
			Worker: project.Workspace.Worker,
			Name: project.Workspace.Name,
			Online: !!workers && workers.Online( project.Workspace.Worker ),
			Offered: !!offered,
			Build: !!( offered && offered.Build ),
		};
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
			let presented = view ? Object.assign( { Kind: node.Kind, Id: node.Id }, view ) : { Kind: node.Kind, Id: node.Id, Missing: true };
			if ( node.Kind === 'plan' && Array.isArray( node.Items ) && node.Items.length )
			{
				presented.Items = present_items( node.Items, views );
			}
			return presented;
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


	// The project's workspace (plan Workers): { Worker, Name }, one a worker offers now; { Worker: null } clears it.
	router.put( '/projects/:pid/workspace', async function ( request, response )
	{
		if ( request.Participant.Role !== 'owner' )
		{
			return fail( response, 403, 'only the owner chooses a project\'s workspace' );
		}
		let body = request.body || {};
		let workspace = null;
		if ( body.Worker )
		{
			let worker = text_of( body.Worker );
			let name = text_of( body.Name );
			if ( !workers || !workers.Has( worker, name ) )
			{
				return fail( response, 400, 'no worker "' + worker + '" offers a workspace "' + name + '"' );
			}
			workspace = { Worker: worker, Name: name };
		}
		let result = await change_project( request.params.pid, null, function ( project )
		{
			if ( workspace )
			{
				project.Workspace = workspace;
			}
			else
			{
				delete project.Workspace;
			}
		} );
		send_result( response, result, 200, { Project: result.Project, Workspace: workspace } );
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


	//-----------------------------------------------------------------
	// Export and import: a whole project as one json object (ProjectPort.js). The owner, or the llm participant (an
	// agent session carrying projects from one Consensus server to another).

	function may_port( participant )
	{
		return participant.Role === 'owner' || participant.Role === 'llm';
	}


	router.get( '/projects/:pid/export', async function ( request, response )
	{
		if ( !may_port( request.Participant ) )
		{
			return fail( response, 403, 'only the owner or the llm exports a project' );
		}
		let exported = await PORT.Export( store, request.params.pid, workers );
		if ( !exported )
		{
			return fail( response, 404, 'no such project' );
		}
		response.json( exported );
	} );


	// Body = { Export, Mode?, Preview? }  Preview: true writes nothing and answers whether the project is here. A
	// project that is here needs Mode: 'copy' or 'merge'. Without Preview the import is written and answered with
	// its report.
	router.post( '/projects/import', async function ( request, response )
	{
		if ( !may_port( request.Participant ) )
		{
			return fail( response, 403, 'only the owner or the llm imports a project' );
		}
		let body = request.body || {};
		let options = { Mode: body.Mode, Preview: !!body.Preview };
		let names = participants().map( function ( participant ) { return participant.Name; } );
		let result = await PORT.Import( store, body.Export, options, {
			Workers: workers,
			Participants: names,
			ChangeProject: function ( id, change ) { return change_project( id, null, change ); },
		} );
		if ( result.Problems )
		{
			return fail( response, 400, 'the file cannot be imported: ' + result.Problems[ 0 ], { Problems: result.Problems } );
		}
		if ( result.Preview )
		{
			return response.json( { Preview: result.Preview } );
		}
		let report = result.Report;
		for ( let id of report.Written )
		{
			changed( id, 'imported' );
		}
		for ( let id of report.WrittenCorpora )
		{
			events.Send( { Corpus: id, Kind: 'created' } );
		}
		events.Send( { Project: report.Project.Id, Kind: 'project' } );
		response.status( 201 ).json( { Report: report } );
	} );


	router.post( '/projects/:pid/folders', async function ( request, response )
	{
		let body = request.body || {};
		let name = name_of_body( body );
		if ( !name )
		{
			return fail( response, 400, 'Name is required' );
		}
		let folder = { Kind: 'folder', Id: new_id( IDS.FOLDER ), Name: name, Items: [] };
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


	// The files of an uploaded zip, under a corpus entry's Include and Exclude (Rules), or a refusal naming what is
	// wrong with it.
	async function extract_upload( body, rules )
	{
		if ( !Buffer.isBuffer( body ) || body.length === 0 )
		{
			return refused( 400, 'send the zip as the body, with Content-Type: application/zip' );
		}
		try
		{
			return await CORPUS.Extract( body, CORPUS.Limits( settings ), rules );
		}
		catch ( error )
		{
			return refused( 400, error.message );
		}
	}


	// Whether a Reason says the file was left out by the corpus's rules (rather than not read).
	function left_out( reason )
	{
		return !!reason && ( reason.startsWith( 'left out by' ) || reason === 'not in Include' );
	}


	// A corpus's files as its project sees them: every file listed, with Indexed and, for one not read, its Reason.
	async function corpus_files( corpus )
	{
		return corpus.Files;
	}


	// One file's text, or null when the corpus does not read it (left out, too large, binary, or not there).
	async function corpus_read( corpus, path )
	{
		let file = corpus.Files.find( function ( candidate ) { return candidate.Path === path; } );
		if ( !file || !file.Indexed )
		{
			return null;
		}
		return await CORPUS.ReadFile( await store.ReadCorpusZip( corpus.Id ), path );
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
		if ( !TREE.CanHold( target.Items, parent, 'corpus' ) )
		{
			return fail( response, 400, 'parent is not a folder of the project' );
		}
		let extracted = await extract_upload( request.body, null );
		if ( extracted.Refused )
		{
			return send_result( response, extracted );
		}
		let corpus = await store.CreateCorpus( { Project: target.Id, Name: name, Zip: request.body, Files: extracted.Files } );
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


	//-----------------------------------------------------------------
	// Workers: what each one offers, as last heard (plan Workers).

	router.get( '/workers', function ( request, response )
	{
		response.json( { Workers: workers ? workers.List() : [] } );
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
		let extracted = await extract_upload( request.body, await store.ReadCorpus( id ) );
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


	// The corpus entry's Include and Exclude: { Include, Exclude }, each a list of patterns or one pattern per line.
	// The zip's files are listed and indexed again under them.
	router.put( '/corpus/:cid/filter', async function ( request, response )
	{
		let body = request.body || {};
		function patterns( value )
		{
			return FILTER.Patterns( Array.isArray( value ) ? value : String( value || '' ).split( /\r?\n/ ) );
		}
		let include = patterns( body.Include );
		let exclude = patterns( body.Exclude );
		let id = request.params.cid;
		let result = await store.Queue( corpus_queue( id ), async function ()
		{
			let corpus = await store.ReadCorpus( id );
			if ( !corpus )
			{
				return refused( 404, 'no such corpus' );
			}
			let changes = { Include: include, Exclude: exclude };
			let extracted = await extract_upload( await store.ReadCorpusZip( id ), changes );
			if ( extracted.Refused )
			{
				return extracted;
			}
			changes.Files = extracted.Files;
			return { Corpus: await store.UpdateCorpus( id, changes ) };
		} );
		if ( result.Refused )
		{
			return send_result( response, result );
		}
		corpus_changed( id, 'replaced' );
		let holder = await store.ProjectOf( id );
		if ( holder )
		{
			events.Send( { Project: holder.Id, Kind: 'project' } );
		}
		response.json( { Corpus: result.Corpus } );
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


	// The target is a project, and Parent (when given) one of its folders, or one of its plans for a plan. Returns
	// null or a refusal.
	async function check_target( where, kind )
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
		if ( !TREE.CanHold( project.Items, where.Parent, kind ) )
		{
			return refused( 400, PARENT_REFUSED );
		}
		return null;
	}


	// The kind of the node Id in the project, or null.
	function kind_in( project, id )
	{
		let found = project ? TREE.Find( project.Items, id ) : null;
		return found ? found.Node.Kind : null;
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
		let source = await store.ProjectOf( id );
		if ( !source )
		{
			return fail( response, 404, 'no such item in any project' );
		}
		let problem = await check_target( where, kind_in( source, id ) );
		if ( problem )
		{
			return send_result( response, problem );
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
					return refused( 400, 'an item cannot go inside itself' );
				}
				if ( !TREE.CanHold( project.Items, where.Parent, found.Node.Kind ) )
				{
					return refused( 400, PARENT_REFUSED );
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
					return refused( 400, PARENT_REFUSED );
				}
			} );
			if ( result.Refused )
			{
				await change_project( source.Id, null, function ( project )
				{
					TREE.Insert( project.Items, null, node );
				} );
			}
			else
			{
				await move_corpora( node, where.Project );
			}
		}
		send_result( response, result, 200, { Project: result.Project } );
	} );


	// The corpora at or under Node move their folders to Project's, which now holds them.
	async function move_corpora( node, project )
	{
		let ids = [ node.Id ].concat( Array.isArray( node.Items ) ? TREE.ItemIds( node.Items ) : [] );
		for ( let id of ids )
		{
			if ( await store.ReadCorpus( id ) )
			{
				await store.Queue( corpus_queue( id ), function () { return store.MoveCorpus( id, project ); } );
			}
		}
	}


	// A copy of a plan or document is whole (text, threads, revisions) under a new id; a folder's copy holds a
	// copy of everything in it, and a plan's copy a copy of its Subplans, with new ids throughout.
	router.post( '/items/:id/copy', async function ( request, response )
	{
		let id = request.params.id;
		let where = where_of( request.body );
		let source = await store.ProjectOf( id );
		let found = source ? TREE.Find( source.Items, id ) : null;
		if ( !found )
		{
			return fail( response, 404, 'no such item in any project' );
		}
		let problem = await check_target( where, found.Node.Kind );
		if ( problem )
		{
			return send_result( response, problem );
		}
		let copy = await copy_node( found.Node, where.Project );
		if ( copy.Refused )
		{
			return send_result( response, copy );
		}
		let result = await change_project( where.Project, null, function ( project )
		{
			if ( !TREE.Insert( project.Items, where.Parent, copy ) )
			{
				return refused( 400, PARENT_REFUSED );
			}
		} );
		send_result( response, result, 201, { Node: copy, Project: result.Project } );
	} );


	// The copy of one node and everything under it, for Project (whose folder keeps a corpus's copy), or a refusal.
	async function copy_node( node, project )
	{
		if ( node.Kind === 'folder' )
		{
			let folder = { Kind: 'folder', Id: new_id( IDS.FOLDER ), Name: node.Name, Items: [] };
			for ( let child of node.Items )
			{
				let copied = await copy_node( child, project );
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
			let copied = { Kind: node.Kind, Id: proposal.Id };
			if ( Array.isArray( node.Items ) && node.Items.length )
			{
				copied.Items = [];
				for ( let child of node.Items )
				{
					let subplan = await copy_node( child, project );
					if ( subplan.Refused )
					{
						return subplan;
					}
					copied.Items.push( subplan );
				}
			}
			return copied;
		}
		if ( node.Kind === 'corpus' )
		{
			let corpus = await store.Queue( corpus_queue( node.Id ), function () { return store.CopyCorpus( node.Id, project ); } );
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
	// With Resolve (the owner's Comment and resolve), it is posted resolved, the comment being its outcome.
	router.post( '/proposals/:id/threads', async function ( request, response )
	{
		let body = request.body || {};
		let text = text_of( body.Text ).trim();
		if ( !text )
		{
			return fail( response, 400, 'Text is required' );
		}
		let result = await create_thread( request.params.id, request.Participant, text, body.Anchor || null, !!body.Resolve );
		if ( result.Refused )
		{
			return send_result( response, result );
		}
		response.status( 201 ).json( { Thread: result.Thread } );
	} );


	// A new thread on a proposal, on Anchor ({ Text, Prefix?, Suffix? }, found in the text) or the whole document.
	// With Resolve (the owner's Comment and resolve), resolved as it is posted. Extra fields go on the thread (a
	// build's threads carry Build). Returns { Thread } or a refusal; the route and the LLM's actions share it.
	async function create_thread( id, participant, text, anchor_given, resolve, extra )
	{
		let result = await store.Queue( id, async function ()
		{
			let read = await store.ReadProposal( id );
			if ( !read )
			{
				return refused( 404, 'no such proposal' );
			}
			if ( is_document( read.Proposal ) )
			{
				return refused( 409, 'a Document or a Context has no threads' );
			}
			let anchor = null;
			if ( anchor_given )
			{
				anchor = place_anchor( anchor_given, read.Text );
				if ( !anchor )
				{
					return refused( 400, 'the anchor text was not found in the proposal' );
				}
			}
			let at = now();
			let thread = {
				Id: new_id( IDS.THREAD ),
				Anchor: anchor,
				Detached: false,
				Status: 'contested',
				Reopened: false,
				Resolved: null,
				Applied: null,
				Created: at,
				Replies: [ { Id: new_id( IDS.REPLY ), By: participant.Name, At: at, Text: text } ],
			};
			if ( extra )
			{
				Object.assign( thread, extra );
			}
			if ( resolve )
			{
				let can = RULES.CanResolve( participant, thread );
				if ( !can.Ok )
				{
					return refused( ( participant.Role === 'owner' ) ? 409 : 403, can.Reason );
				}
				Object.assign( thread, RULES.ResolveEffect( participant, at ) );
			}
			read.Threads.push( thread );
			await store.WriteThreads( id, read.Threads );
			await store.UpdateProposal( id, {} );
			return { Thread: present_threads( [ thread ], read.Text, participant.Name )[ 0 ] };
		} );
		if ( !result.Refused )
		{
			changed( id, ( result.Thread.Status === 'resolved' ) ? 'resolved' : 'thread', result.Thread.Id );
		}
		return result;
	}


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
			thread.Replies.push( { Id: new_id( IDS.REPLY ), By: participant.Name, At: now(), Text: text } );
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
		if ( is_build_log( result.Thread ) && request.Participant.Role === 'owner' )
		{
			if ( result.Resolved )
			{
				await build_accepted( request.params.id, result.Thread.Id );
			}
			else
			{
				build_sent_back( result.Thread );
			}
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
		if ( is_build_log( result ) )
		{
			await build_accepted( id, result.Id );
		}
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
			let changed_text = ( typeof body.Text === 'string' && body.Text !== read.Text );
			let text = changed_text ? body.Text : read.Text;
			if ( changed_text && body.Revision !== proposal.Revision )
			{
				return refused( 409, 'the text changed since revision ' + body.Revision + '; reload and apply again', { Revision: proposal.Revision } );
			}
			// The anchor is placed in the text it will point into before anything is written, so a refusal leaves
			// the proposal as it was.
			let anchor = body.Anchor ? place_anchor( body.Anchor, text ) : null;
			if ( body.Anchor && !anchor && !loose )
			{
				return refused( 400, 'the anchor text was not found in the proposal' );
			}
			if ( changed_text )
			{
				proposal = await store.WriteText( id, { Text: body.Text, By: participant.Name, Reason: 'apply', Thread: thread.Id } );
				refind( read.Threads, text );
			}
			if ( anchor )
			{
				thread.Anchor = anchor;
				thread.Detached = false;
			}
			Object.assign( thread, RULES.ApplyEffect( participant, now(), proposal.Revision, proposal.Head || null, outcome ) );
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
	// the proposal in runs.json. The /send route is a session with the first destination and the default options.

	let calling = {};
	let recent_calls = [];
	const HOUR = 60 * 60 * 1000;
	const SEARCH_PER_THREAD = 3;
	const RUNS_KEPT = 20;
	const MANUAL = 'Manual';
	const THREAD_CHOICES = [ 'waiting', 'open', 'all' ];
	const PARENT_REFUSED = 'Parent is not a folder of the project, or a plan (which holds plans only)';


	// The llm participant, called by Consensus or not.
	function llm_participant()
	{
		return ( settings.Participants || [] ).find( function ( participant ) { return participant.Role === 'llm'; } ) || null;
	}


	// The llm participant with somewhere to send a prompt (a Call or Destinations), or null.
	function called_llm()
	{
		let llm = llm_participant();
		return ( llm && destinations_of( llm ).length ) ? llm : null;
	}


	// Where a session can send its prompt: the llm participant's own destinations, then each worker's Inference items,
	// named "<worker> / <item>" (Offline when the worker has not been heard from lately).
	function destinations_of( llm )
	{
		let local = llm ? LLM.Destinations( llm ) : [];
		if ( !llm || !workers )
		{
			return local;
		}
		let remote = [];
		for ( let worker of workers.List() )
		{
			for ( let item of worker.Inference )
			{
				let call = LLM.CallSettings( { Call: { Kind: item.Type, Model: item.Model || undefined } } );
				call.Name = worker.Name + ' / ' + item.Name;
				call.Worker = { Name: worker.Name, Inference: item.Name };
				call.Offline = !worker.Online;
				remote.push( call );
			}
		}
		return local.concat( remote );
	}


	// The function that sends a prompt for a call from here.
	function caller_for( call )
	{
		return ( Context.Caller || LLM.Caller )( call );
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
			Waiting: RULES.WaitingOn( llm.Name, threads, participants() ).filter( function ( thread ) { return !is_build_log( thread ); } ).length,
		};
	}


	// A session's choices, each defaulted: { Context: true, Parents: true, Threads: 'waiting' | 'open' | 'all', Search: true,
	// Thread: null }. Thread: a review of that one thread (plan Review), which alone is sent and acted on.
	function options_of( given )
	{
		let options = given || {};
		return {
			Context: options.Context !== false,
			Parents: options.Parents !== false,
			Threads: THREAD_CHOICES.includes( options.Threads ) ? options.Threads : 'open',
			Search: options.Search !== false,
			Thread: ( typeof options.Thread === 'string' && options.Thread ) ? options.Thread : null,
		};
	}


	// The same from a query string: ?context=0&parents=0&threads=waiting&search=0&thread=<id>
	function options_of_query( query )
	{
		return options_of( {
			Context: query.context !== '0' && query.context !== 'false',
			Parents: query.parents !== '0' && query.parents !== 'false',
			Threads: query.threads,
			Search: query.search !== '0' && query.search !== 'false',
			Thread: query.thread,
		} );
	}


	// A thread a review may act on: contested, or resolved and waiting to be applied.
	function actable( thread )
	{
		return thread.Status === 'contested' || RULES.IsWaiting( thread );
	}


	// The threads an answer may act on: the one in focus when it is actable, else those waiting on the llm.
	function acting_on( presented, focus )
	{
		if ( focus )
		{
			return presented.filter( function ( thread ) { return thread.Id === focus && actable( thread ); } );
		}
		return presented.filter( function ( thread ) { return thread.WaitingOnMe && !is_build_log( thread ); } );
	}


	function tokens_of( text )
	{
		return Math.ceil( String( text ).length / 4 );
	}


	// Everything one session needs, for the llm participant: { Prompt, Parts, Read, Waiting, Context }. The threads
	// sent are those Options.Threads names; the waiting ones are always among them. With Options.Thread only that
	// thread is sent, marked as waiting on the llm when it is actable. Tools: the prompt is a worker's (plan Review).
	async function package_for( id, llm, options, turns, tools )
	{
		let chosen = options_of( options );
		let read = await store.ReadProposal( id );
		let presented = present_threads( read.Threads, read.Text, llm.Name );
		if ( chosen.Thread )
		{
			presented = presented.filter( function ( thread ) { return thread.Id === chosen.Thread; } ).map( function ( thread )
			{
				if ( !actable( thread ) || thread.WaitingOnMe )
				{
					return thread;
				}
				return Object.assign( {}, thread, { WaitingOnMe: true, Turn: [ llm.Name ] } );
			} );
		}
		let waiting = acting_on( presented, chosen.Thread );
		let sent = presented.filter( function ( thread )
		{
			if ( chosen.Thread )
			{
				return true;
			}
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
		let parents = chosen.Parents ? await plans_of( holder ? TREE.Parents( holder.Items, id ) : [], true ) : [];
		let subplans = await plans_of( holder ? TREE.Subplans( holder.Items, id ) : [], false );
		let parts = LLM.PromptParts( {
			Project: holder ? holder.Name : null,
			Context: context,
			Parents: parents,
			Subplans: subplans,
			MaxCharacters: LLM.ContextSettings( settings ).MaxCharacters,
			Proposal: read.Proposal,
			Text: read.Text,
			Threads: sent,
			Me: llm.Name,
			Participants: participants(),
			Search: search,
			Turns: turns || [],
			Tools: !!tools,
			Focus: chosen.Thread,
		} );
		let prompt = parts.map( function ( part ) { return part.Text; } ).join( '\n' );
		return { Prompt: prompt, Parts: parts, Read: read, Waiting: waiting, Context: context };
	}


	// The plans of Nodes as { Id, Title, State, Text? }, with their text when With_text; a plan that cannot be read
	// is left out.
	async function plans_of( nodes, with_text )
	{
		let plans = [];
		for ( let node of nodes )
		{
			let read = await store.ReadProposal( node.Id );
			if ( !read )
			{
				continue;
			}
			let plan = { Id: node.Id, Title: read.Proposal.Title, State: read.Proposal.State };
			if ( with_text )
			{
				plan.Text = read.Text;
			}
			plans.push( plan );
		}
		return plans;
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
		let run = { Id: new_id( IDS.RUN ), Started: now(), Destination: destination, Model: model || null, Options: options, Turns: [], Steps: [], Finished: null };
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


	// "2 replies, 1 apply, 1 new thread, the context" for an answer's actions.
	function actions_words( actions )
	{
		let counts = { reply: 0, apply: 0, context: 0, thread: 0, plan: 0 };
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
		if ( counts.thread )
		{
			words.push( counts.thread + ( counts.thread === 1 ? ' new thread' : ' new threads' ) );
		}
		if ( counts.plan )
		{
			words.push( counts.plan + ( counts.plan === 1 ? ' new plan' : ' new plans' ) );
		}
		if ( counts.context )
		{
			words.push( 'the context' );
		}
		return words.length ? words.join( ', ' ) : 'nothing to do';
	}


	// The answer's actions carried out, the results recorded on the threads, and the run log's last step. Focus: the
	// one thread a review of a thread may act on.
	async function carry_out_answer( id, llm, run_id, actions, revision, context, focus )
	{
		let read = await store.ReadProposal( id );
		let waiting = acting_on( present_threads( read.Threads, read.Text, llm.Name ), focus );
		let made = { Made: [], Refused: [] };
		let failures = await carry_out( id, llm, waiting, actions, revision, context, made );
		await record_call_results( id, failures, true );
		let refused = Object.keys( failures ).map( function ( thread_id ) { return thread_id + ': ' + failures[ thread_id ]; } ).concat( made.Refused );
		let why = refused.join( '; ' );
		let created = made.Made.length ? ', made ' + made.Made.join( ', ' ) : '';
		await log_step( id, run_id, { Text: 'Consensus carried out ' + actions.length + ( actions.length === 1 ? ' action' : ' actions' ) + created + ', ' + refused.length + ' refused' + ( why ? ' (' + why + ')' : '' ) }, true );
		return failures;
	}


	//-----------------------------------------------------------------
	// The destinations, and the models an Ollama destination offers.

	router.get( '/llm/destinations', function ( request, response )
	{
		let llm = llm_participant();
		let destinations = llm ? destinations_of( llm ) : [];
		response.json( {
			Destinations: destinations.map( function ( destination ) { return { Name: destination.Name, Kind: destination.Kind, Model: destination.Model || null, Worker: destination.Worker ? destination.Worker.Name : null, Offline: !!destination.Offline }; } ),
			Manual: !!llm,
		} );
	} );


	router.get( '/llm/models', async function ( request, response )
	{
		let llm = llm_participant();
		let destination = llm ? destinations_of( llm ).find( function ( candidate ) { return candidate.Name === request.query.destination; } ) : null;
		if ( !destination )
		{
			return fail( response, 404, 'no such destination' );
		}
		if ( destination.Worker )
		{
			let item = workers.Inference( destination.Worker.Name, destination.Worker.Inference );
			let models = ( item && item.Models.length ) ? item.Models : ( destination.Model ? [ destination.Model ] : [] );
			return response.json( { Models: models } );
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
		let destinations = destinations_of( llm );
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
		// A review of the plan runs even with nothing waiting: it may open threads and plans (plan Review). A build log
		// waits for its build, not for a review.
		let waiting = RULES.WaitingOn( llm.Name, read.Threads, participants() ).filter( function ( thread ) { return !is_build_log( thread ); } );
		if ( options.Thread )
		{
			let focus = find_thread( read, options.Thread );
			if ( !focus )
			{
				return fail( response, 404, 'no such thread' );
			}
			if ( !actable( focus ) )
			{
				return fail( response, 409, 'the thread is applied: there is nothing to review' );
			}
			waiting = [ focus ];
		}
		let workspace = null;
		if ( call.Worker )
		{
			if ( call.Offline )
			{
				return fail( response, 409, 'the worker "' + call.Worker.Name + '" is offline' );
			}
			let holder = await store.ProjectOf( id );
			workspace = holder ? holder.Workspace : null;
			if ( !workspace || workspace.Worker !== call.Worker.Name )
			{
				return fail( response, 409, 'the project names no workspace on the worker "' + call.Worker.Name + '": choose one for the project' );
			}
			if ( !workers.Has( workspace.Worker, workspace.Name ) )
			{
				return fail( response, 409, 'the worker "' + workspace.Worker + '" does not offer the workspace "' + workspace.Name + '" now' );
			}
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

		if ( call.Worker )
		{
			queue_review( id, llm, call, options, run_id, workspace ).catch( function ( error )
			{
				console.error( 'llm: ' + id + ': ' + error.message );
				end_session( id, run_id, 'the review was not queued: ' + error.message );
			} );
			return;
		}
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


	// A session with the first destination and the default choices, as Send to LLM was before the dialog.
	router.post( '/proposals/:id/send', function ( request, response )
	{
		return start_session( request, response, {} );
	} );


	//-----------------------------------------------------------------
	// Turns: an answer may ask for more (Requests) instead of acting. Consensus answers each request, read-only and
	// within the plan's project, and the next prompt of the same session carries what it found. A session has at most
	// LLM.MAX_TURNS answers; the last one's actions are carried out even if it asks again.

	const RESULT_LENGTH = 20000;
	const SEARCH_RESULTS = 5;


	function clip_result( text )
	{
		let value = String( text );
		return ( value.length > RESULT_LENGTH ) ? value.slice( 0, RESULT_LENGTH ) + '\n… (cut at ' + RESULT_LENGTH + ' characters)' : value;
	}


	// The project's plans, documents and zips, with their ids, as { Kind, Id, Title, State, Folder, Parent?, Corpus? };
	// a Subplan's Parent is its parent plan's title.
	async function project_items( project )
	{
		let items = [];
		async function walk( nodes, folder, parent )
		{
			for ( let node of nodes )
			{
				if ( node.Kind === 'folder' )
				{
					await walk( node.Items, ( folder ? folder + '/' : '' ) + node.Name );
					continue;
				}
				if ( node.Kind === 'corpus' )
				{
					let corpus = await store.ReadCorpus( node.Id );
					if ( corpus )
					{
						items.push( { Kind: 'corpus', Id: node.Id, Title: corpus.Name, Folder: folder, Corpus: corpus } );
					}
					continue;
				}
				let read = await store.ReadProposal( node.Id );
				if ( read )
				{
					let item = { Kind: read.Proposal.Kind || 'plan', Id: node.Id, Title: read.Proposal.Title, State: read.Proposal.State, Folder: folder };
					if ( parent )
					{
						item.Parent = parent;
					}
					items.push( item );
				}
				if ( read && Array.isArray( node.Items ) )
				{
					await walk( node.Items, folder, read.Proposal.Title );
				}
			}
		}
		await walk( project.Items, '', null );
		if ( project.Context )
		{
			items.push( { Kind: 'context', Id: project.Context, Title: 'Context', Folder: '' } );
		}
		return items;
	}


	// " (attached, 12 files read)" for a zip.
	function corpus_words( corpus )
	{
		let read = corpus.Files.filter( function ( file ) { return file.Indexed; } ).length;
		return ' (attached, ' + read + ' files read)';
	}


	// list_files' answer: the corpus's files that its Include and Exclude let in, under Folder when given; each one
	// not read says why.
	function list_of_files( item, files, folder )
	{
		let prefix = String( folder || '' ).replace( /^\/+|\/+$/g, '' );
		let shown = files.filter( function ( file )
		{
			return !left_out( file.Reason ) && ( !prefix || file.Path.startsWith( prefix + '/' ) );
		} );
		let lines = [ 'The corpus "' + item.Title + '"' + corpus_words( item.Corpus ) + ( prefix ? ', folder ' + prefix : '' ) + ': ' + shown.length + ' files' ];
		for ( let file of shown )
		{
			lines.push( '- ' + file.Path + ( file.Indexed ? '' : ' (not read: ' + file.Reason + ')' ) );
		}
		return lines.join( '\n' );
	}


	// An item of the project named by id or title (any case), of one of Kinds, or null.
	function item_named( items, name, kinds )
	{
		let wanted = String( name || '' ).trim().toLowerCase();
		return items.find( function ( item ) { return kinds.includes( item.Kind ) && ( item.Id === name || item.Title.toLowerCase() === wanted ); } ) || null;
	}


	// What a request finds, as text; a request that cannot be answered says why.
	async function answer_request( project, request )
	{
		if ( !project )
		{
			return 'refused: the plan is in no project';
		}
		let items = await project_items( project );
		let tool = request.Tool;
		if ( tool === 'list_project' )
		{
			let lines = [ 'The project "' + project.Name + '":' ];
			for ( let item of items )
			{
				let where = item.Parent ? ' under "' + item.Parent + '"' : ( item.Folder ? ' in ' + item.Folder : '' );
				let extra = item.State ? ' (' + item.State + ')' : ( item.Corpus ? corpus_words( item.Corpus ) : '' );
				lines.push( '- ' + item.Kind + ' "' + item.Title + '"' + extra + where + ', id ' + item.Id );
			}
			return lines.join( '\n' );
		}
		if ( tool === 'read_plan' || tool === 'read_revision' )
		{
			let item = item_named( items, request.Plan, [ 'plan', 'document', 'context' ] );
			if ( !item )
			{
				return 'refused: no plan or document "' + ( request.Plan || '' ) + '" in the project';
			}
			if ( tool === 'read_plan' )
			{
				let read = await store.ReadProposal( item.Id );
				return clip_result( read.Text );
			}
			let revision = await store.ReadRevision( item.Id, parseInt( request.Revision, 10 ) );
			return revision ? clip_result( revision.Text ) : 'refused: "' + item.Title + '" has no revision ' + request.Revision;
		}
		if ( tool === 'list_files' || tool === 'read_file' )
		{
			let name = request.Corpus || request.Zip;
			let item = item_named( items, name, [ 'corpus' ] );
			if ( !item )
			{
				return 'refused: no corpus "' + ( name || '' ) + '" in the project';
			}
			try
			{
				if ( tool === 'list_files' )
				{
					return clip_result( list_of_files( item, await corpus_files( item.Corpus ), request.Folder ) );
				}
				let path = String( request.Path || '' ).replace( /^\/+/, '' );
				let text = await corpus_read( item.Corpus, path );
				return ( text === null ) ? 'refused: "' + item.Title + '" does not read a file ' + path : clip_result( text );
			}
			catch ( error )
			{
				return 'refused: ' + error.message;
			}
		}
		if ( tool === 'search' )
		{
			if ( !Context.Search || !String( request.Query || '' ).trim() )
			{
				return 'refused: nothing to search for';
			}
			let hits = await Context.Search( String( request.Query ), SEARCH_RESULTS, TREE.ItemIds( project.Items ) );
			if ( !hits.length )
			{
				return 'nothing found';
			}
			let titles = await source_titles();
			return hits.map( function ( hit )
			{
				let title = title_of_hit( titles, hit );
				let where = hit.Path ? 'the file ' + hit.Path + ' in "' + title + '"' : ( hit.Thread ? 'a thread in "' + title + '"' : '"' + title + '"' );
				return '- From ' + where + ':\n  ' + String( hit.Text ).replace( /\n/g, '\n  ' );
			} ).join( '\n' );
		}
		return 'refused: there is no tool "' + tool + '"';
	}


	// Each request answered, each a step of the run log. Returns the results, in the requests' order.
	async function answer_requests( id, run_id, project, requests )
	{
		let results = [];
		for ( let request of requests )
		{
			let started = Date.now();
			let result = null;
			try
			{
				result = await answer_request( project, request );
			}
			catch ( error )
			{
				result = 'refused: ' + error.message;
			}
			results.push( result );
			await log_step( id, run_id, { Text: 'Consensus answered ' + LLM.DescribeRequest( request ), Seconds: seconds_since( started ), Tokens: tokens_of( result ) } );
		}
		return results;
	}


	// The run's turns so far, kept with it, so a Manual session can carry on across pastes.
	async function update_run( id, run_id, change )
	{
		let changed_run = null;
		await store.Queue( runs_queue( id ), async function ()
		{
			let runs = await store.ReadRuns( id );
			let run = runs.find( function ( candidate ) { return candidate.Id === run_id; } );
			if ( run )
			{
				change( run );
				changed_run = run;
				await store.WriteRuns( id, runs );
			}
		} );
		return changed_run;
	}


	async function read_run( id, run_id )
	{
		let runs = await store.ReadRuns( id );
		return runs.find( function ( candidate ) { return candidate.Id === run_id; } ) || null;
	}


	async function run_session( id, llm, call, options, run_id )
	{
		let started = Date.now();
		let model = call.Model || call.Kind;
		let caller = caller_for( call );
		let holder = await store.ProjectOf( id );
		let turns = [];
		for ( let turn = 1; ; turn++ )
		{
			let made = Date.now();
			let packed = await package_for( id, llm, options, turns );
			let sent = ( turn === 1 ) ? 'Consensus sent the prompt to ' + model : 'Consensus sent answer ' + turn + '\'s prompt to ' + model;
			await log_step( id, run_id, { Text: sent, Seconds: seconds_since( made ), Tokens: tokens_of( packed.Prompt ) } );
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
			let output = ( answer.Usage && answer.Usage.Output ) || tokens_of( JSON.stringify( answer.Answer ) );
			let requests = answer.Answer.Requests || [];
			if ( requests.length && turn < LLM.MAX_TURNS )
			{
				await log_step( id, run_id, { Text: answered_by + ' asked for ' + requests.map( LLM.DescribeRequest ).join( ', ' ), Seconds: seconds_since( asked ), Tokens: output } );
				let results = await answer_requests( id, run_id, holder, requests );
				turns.push( { Requests: requests, Results: results } );
				continue;
			}
			let ignored = requests.length ? ' (its requests go unanswered: it was the last answer)' : '';
			await log_step( id, run_id, { Text: answered_by + ' answered: ' + actions_words( answer.Answer.Actions ) + ignored, Seconds: seconds_since( asked ), Tokens: output } );
			let failures = await carry_out_answer( id, llm, run_id, answer.Answer.Actions, packed.Read.Proposal.Revision, packed.Context, options.Thread );
			let failed = Object.keys( failures ).length;
			log_call( id, call, packed.Waiting, started, turn + ( turn === 1 ? ' answer, ' : ' answers, ' ) + answer.Answer.Actions.length + ' actions' + ( failed ? ', ' + failed + ' refused' : '' ) + ', ' + answer.Usage.Input + ' in, ' + answer.Usage.Output + ' out' );
			return;
		}
	}


	// A session is over: its last step, and the proposal free for the next one.
	function end_session( id, run_id, text )
	{
		log_step( id, run_id, text ? { Text: text } : null, true ).catch( function ( error )
		{
			console.error( 'llm: ' + id + ': ' + error.message );
		} ).finally( function ()
		{
			delete calling[ id ];
			events.Send( { Proposal: id, Kind: 'llm-finished' } );
		} );
	}


	//-----------------------------------------------------------------
	// Review jobs (plans Workers and Review): a session sent to a worker is queued as a job. The worker runs the
	// model beside the code with read-only tools, asks the plan tools here, logs its steps, and posts the answer,
	// which is carried out as a session's is. What the answer needs here is kept in job_state, by job id.

	const WORKER_TOOLS = [ 'list_project', 'read_plan', 'read_revision', 'search' ];
	let job_state = {};


	async function queue_review( id, llm, call, options, run_id, workspace )
	{
		let started = Date.now();
		let packed = await package_for( id, llm, options, [], true );
		let holder = await store.ProjectOf( id );
		let job = workers.Queue( call.Worker.Name, {
			Kind: 'Review',
			Proposal: id,
			Title: packed.Read.Proposal.Title,
			Project: holder ? { Id: holder.Id, Name: holder.Name } : null,
			Workspace: workspace.Name,
			Inference: call.Worker.Inference,
			Model: call.Model || null,
			Run: run_id,
			Prompt: packed.Prompt,
			Schema: LLM.SCHEMA,
		} );
		job_state[ job.Id ] = {
			Llm: llm,
			Call: call,
			Revision: packed.Read.Proposal.Revision,
			Context: packed.Context,
			Waiting: packed.Waiting,
			Focus: options.Thread,
			Started: started,
		};
		events.Send( { Kind: 'workers' } );
		await log_step( id, run_id, { Text: 'Consensus queued the review for ' + call.Name + ', job ' + job.Id, Seconds: seconds_since( started ), Tokens: tokens_of( packed.Prompt ) } );
	}


	// A review's answer, or its error, carried out; the session ends either way.
	async function finish_review( job, body )
	{
		let state = job_state[ job.Id ];
		delete job_state[ job.Id ];
		let id = job.Proposal;
		if ( !state )
		{
			return { Error: 'the job is not known here any more' };
		}
		let model = ( body.Usage && body.Usage.Model ) || state.Call.Model || state.Call.Kind;
		let answer = null;
		let problem = body.Error ? String( body.Error ) : null;
		if ( !problem )
		{
			try
			{
				answer = LLM.Parse( body.Answer );
			}
			catch ( error )
			{
				problem = error.message;
			}
		}
		try
		{
			if ( problem )
			{
				let failures = {};
				for ( let thread of state.Waiting )
				{
					failures[ thread.Id ] = problem;
				}
				await record_call_results( id, failures, false );
				await log_step( id, job.Run, { Text: model + ' failed on ' + job.Worker + ': ' + problem, Seconds: seconds_since( state.Started ) } );
				log_call( id, state.Call, state.Waiting, state.Started, 'failed: ' + problem );
				return { Error: problem };
			}
			await record_usage( state.Call, body.Usage );
			let output = ( body.Usage && body.Usage.Output ) || tokens_of( JSON.stringify( answer ) );
			await log_step( id, job.Run, { Text: model + ' answered on ' + job.Worker + ': ' + actions_words( answer.Actions ), Seconds: seconds_since( state.Started ), Tokens: output } );
			let failures = await carry_out_answer( id, state.Llm, job.Run, answer.Actions, state.Revision, state.Context, state.Focus );
			log_call( id, state.Call, state.Waiting, state.Started, 'a worker\'s answer, ' + answer.Actions.length + ' actions' + ( Object.keys( failures ).length ? ', ' + Object.keys( failures ).length + ' refused' : '' ) );
			return { Actions: answer.Actions.length, Refused: failures };
		}
		finally
		{
			end_session( id, job.Run, null );
			events.Send( { Kind: 'workers' } );
		}
	}


	if ( workers )
	{
		workers.OnOffline( function ( job )
		{
			let finish = ( job.Kind === 'Build' ) ? finish_build : finish_review;
			finish( job, { Error: 'the worker "' + job.Worker + '" went offline' } ).catch( function ( error )
			{
				console.error( 'workers: ' + job.Id + ': ' + error.message );
			} );
		} );
	}


	// The routes a worker calls, with its own token (Workers.Identify), mounted before the participants' routes.
	let worker_router = EXPRESS.Router();
	worker_router.use( EXPRESS.json( { limit: BODY_LIMIT } ) );


	function identify_worker( request, response, next )
	{
		let name = workers ? workers.Identify( request.get( 'Authorization' ) ) : null;
		if ( !name )
		{
			return fail( response, 401, 'unknown worker token' );
		}
		request.Worker = name;
		next();
	}


	// The worker's own job, taken and not yet over (or over, with Over); or null, with the refusal sent.
	function own_job( request, response, over )
	{
		let job = workers.Job( request.params.jid );
		if ( !job || job.Worker !== request.Worker )
		{
			fail( response, 404, 'no such job for this worker' );
			return null;
		}
		if ( job.Status !== 'taken' && !( over && job.Status === 'done' ) )
		{
			fail( response, 409, 'the job is ' + job.Status );
			return null;
		}
		return job;
	}


	// Body = { Workspaces: [ { Name, Build? } ], Inference: [ { Name, Type, Model?, Models? } ] }
	worker_router.post( '/hello', identify_worker, function ( request, response )
	{
		workers.Hello( request.Worker, request.body || {} );
		events.Send( { Kind: 'workers' } );
		response.json( { Name: request.Worker } );
	} );


	// Held open up to 30 seconds: { Job }, { Change }, or {}. ?busy=1: the worker is running a job, changes only.
	// A worker that has not said hello since Consensus started is asked to, at once: { Hello: true }.
	worker_router.get( '/jobs', identify_worker, async function ( request, response )
	{
		if ( !workers.Said( request.Worker ) )
		{
			workers.Heard( request.Worker );
			return response.json( { Hello: true } );
		}
		let was_online = workers.Online( request.Worker );
		let next = await workers.Next( request.Worker, request.query.busy === '1' );
		if ( !was_online )
		{
			events.Send( { Kind: 'workers' } );
		}
		if ( next && next.Job && ( response.destroyed || request.destroyed ) )
		{
			workers.Requeue( next.Job.Id );
			return;
		}
		if ( next && next.Job )
		{
			log_step( next.Job.Proposal, next.Job.Run, { Text: request.Worker + ' took job ' + next.Job.Id } ).catch( function () {} );
		}
		response.json( next || {} );
	} );


	// Body = { Tool, Plan?, Revision?, Query? }: a plan tool, answered as a request is, within the job's project.
	worker_router.post( '/jobs/:jid/tool', identify_worker, async function ( request, response )
	{
		let job = own_job( request, response );
		if ( !job )
		{
			return;
		}
		let body = request.body || {};
		if ( !WORKER_TOOLS.includes( body.Tool ) )
		{
			return fail( response, 400, 'Tool must be one of ' + WORKER_TOOLS.join( ', ' ) );
		}
		let holder = await store.ProjectOf( job.Proposal );
		let result = null;
		try
		{
			result = await answer_request( holder, body );
		}
		catch ( error )
		{
			result = 'refused: ' + error.message;
		}
		response.json( { Result: result } );
	} );


	// Body = { Text, Seconds?, Tokens? }: a step of the job's run log; after a build, its Commit and Push too.
	worker_router.post( '/jobs/:jid/step', identify_worker, async function ( request, response )
	{
		let job = own_job( request, response, true );
		if ( !job )
		{
			return;
		}
		let body = request.body || {};
		let step = { Text: text_of( body.Text ).slice( 0, 500 ) || '(a step)' };
		if ( typeof body.Seconds === 'number' )
		{
			step.Seconds = body.Seconds;
		}
		if ( typeof body.Tokens === 'number' )
		{
			step.Tokens = body.Tokens;
		}
		await log_step( job.Proposal, job.Run, step );
		response.json( { Logged: true } );
	} );


	// Body = { Answer, Usage: { Model, Input, Output } } or { Error }: the job's answer, carried out as its kind says.
	worker_router.post( '/jobs/:jid/answer', identify_worker, async function ( request, response )
	{
		let job = own_job( request, response );
		if ( !job )
		{
			return;
		}
		let body = request.body || {};
		workers.Finish( job.Id, body.Error ? 'failed' : 'done' );
		let result = ( job.Kind === 'Build' ) ? await finish_build( job, body ) : await finish_review( job, body );
		response.json( result );
	} );


	//-----------------------------------------------------------------
	// Build jobs (plan Build): the owner's Build queues one for the worker that holds the project's workspace. The
	// worker builds the plan in the workspace, as it is, and its answer comes back as the build log: a contested
	// whole-document thread, the job's receipt, with the threads the build opened. Resolving the build log accepts the
	// build: it is applied, the context the build wrote is carried out, and the plan is Finished. A reply sends it back:
	// Build runs again with the reply, and the new log is a reply on the same thread. Consensus does nothing with git.

	const WORKING = 'Working';
	const FINISHED = 'Finished';


	function is_build_log( thread )
	{
		return !!( thread && thread.Build && thread.Build.Log );
	}


	// Where a build of the plan can go and whether it can go now: { Ready, Reason, Destinations, Running, SentBack }.
	// Destinations are the claude-cli items of the worker holding the project's workspace; SentBack is the build log
	// the owner replied to last, when there is one.
	async function build_view( id, read )
	{
		let view = { Ready: false, Reason: null, Destinations: [], Running: !!calling[ id ], SentBack: null };
		let holder = await store.ProjectOf( id );
		let workspace = holder ? holder.Workspace : null;
		let reason = null;
		if ( !workers || !workspace )
		{
			reason = 'the project names no workspace';
		}
		else if ( !workers.Online( workspace.Worker ) )
		{
			reason = 'the worker "' + workspace.Worker + '" is offline';
		}
		else
		{
			let offered = workers.Has( workspace.Worker, workspace.Name );
			if ( !offered )
			{
				reason = 'the worker "' + workspace.Worker + '" does not offer the workspace "' + workspace.Name + '" now';
			}
			else if ( !offered.Build )
			{
				reason = 'the workspace "' + workspace.Name + '" has no Build settings on its worker';
			}
			let worker = workers.List().find( function ( candidate ) { return candidate.Name === workspace.Worker; } );
			view.Destinations = worker.Inference.filter( function ( item ) { return item.Type === 'claude-cli'; } ).map( function ( item )
			{
				return { Name: worker.Name + ' / ' + item.Name, Model: item.Model || null };
			} );
			if ( !reason && !view.Destinations.length )
			{
				reason = 'the worker "' + workspace.Worker + '" has no claude-cli inference item';
			}
		}
		let open = read.Threads.filter( function ( thread ) { return !thread.Build && actable( thread ); } );
		if ( !reason && open.length )
		{
			reason = open.length + ( open.length === 1 ? ' thread is' : ' threads are' ) + ' not applied yet';
		}
		if ( !reason && view.Running )
		{
			reason = 'a review or build of this plan is running';
		}
		let log = last_build_log( read.Threads );
		if ( log && log.Status === 'contested' && log.Replies[ log.Replies.length - 1 ].By !== ( llm_participant() || {} ).Name )
		{
			view.SentBack = log.Id;
		}
		view.Reason = reason;
		view.Ready = !reason;
		return view;
	}


	function last_build_log( threads )
	{
		let logs = threads.filter( is_build_log );
		return logs.length ? logs[ logs.length - 1 ] : null;
	}


	async function set_state( id, state )
	{
		if ( !states().includes( state ) )
		{
			return;
		}
		await store.Queue( id, function () { return store.UpdateProposal( id, { State: state } ); } );
		changed( id, 'state' );
	}


	// Body = { Destination?, Model? }: one of the build's destinations (the first when none is named).
	router.post( '/proposals/:id/build', async function ( request, response )
	{
		if ( request.Participant.Role !== 'owner' )
		{
			return fail( response, 403, 'only the owner builds a plan' );
		}
		let llm = llm_participant();
		if ( !llm )
		{
			return fail( response, 409, 'there is no llm participant in consensus.json' );
		}
		let id = request.params.id;
		let read = await store.ReadProposal( id );
		if ( !read )
		{
			return fail( response, 404, 'no such proposal' );
		}
		if ( is_document( read.Proposal ) )
		{
			return fail( response, 409, 'only a plan is built' );
		}
		let view = await build_view( id, read );
		if ( !view.Ready )
		{
			return fail( response, 409, 'the plan cannot be built now: ' + view.Reason );
		}
		let body = request.body || {};
		let named = view.Destinations.find( function ( candidate ) { return candidate.Name === body.Destination; } );
		if ( body.Destination && !named )
		{
			return fail( response, 400, 'no build destination is named "' + body.Destination + '"' );
		}
		let destination = destinations_of( llm ).find( function ( candidate ) { return candidate.Name === ( named || view.Destinations[ 0 ] ).Name; } );
		let call = Object.assign( {}, destination );
		if ( typeof body.Model === 'string' && body.Model.trim() )
		{
			call.Model = body.Model.trim();
		}
		if ( calls_in_last_hour() >= call.CallsPerHour )
		{
			return fail( response, 409, 'the LLM is paused: ' + call.CallsPerHour + ' calls in the last hour' );
		}
		calling[ id ] = true;
		recent_calls.push( Date.now() );
		await set_state( id, WORKING );
		let run_id = await start_run( id, destination.Name + ' (build)', call.Model, { Build: true } );
		events.Send( { Proposal: id, Kind: 'llm-started' } );
		response.status( 202 ).json( { Started: true, Run: run_id, SentBack: view.SentBack } );

		queue_build( id, llm, call, run_id, view.SentBack ).catch( function ( error )
		{
			console.error( 'build: ' + id + ': ' + error.message );
			end_session( id, run_id, 'the build was not queued: ' + error.message );
		} );
	} );


	async function queue_build( id, llm, call, run_id, sent_back )
	{
		let started = Date.now();
		let read = await store.ReadProposal( id );
		let holder = await store.ProjectOf( id );
		let back = null;
		if ( sent_back )
		{
			let log = find_thread( read, sent_back );
			let last_own = -1;
			log.Replies.forEach( function ( reply, index )
			{
				if ( reply.By === llm.Name )
				{
					last_own = index;
				}
			} );
			back = {
				Log: log.Replies[ last_own ].Text,
				Replies: log.Replies.slice( last_own + 1 ).map( function ( reply ) { return reply.Text; } ),
			};
		}
		let prompt = LLM.BuildPrompt( {
			Project: holder.Name,
			Context: await context_of( holder ),
			MaxCharacters: LLM.ContextSettings( settings ).MaxCharacters,
			Parents: await plans_of( TREE.Parents( holder.Items, id ), true ),
			Proposal: read.Proposal,
			Text: read.Text,
			SentBack: back,
		} );
		let job = workers.Queue( call.Worker.Name, {
			Kind: 'Build',
			Proposal: id,
			Title: read.Proposal.Title,
			Project: { Id: holder.Id, Name: holder.Name },
			Workspace: holder.Workspace.Name,
			Inference: call.Worker.Inference,
			Model: call.Model || null,
			Run: run_id,
			Prompt: prompt,
			Schema: LLM.BUILD_SCHEMA,
			SentBack: sent_back || null,
		} );
		job_state[ job.Id ] = { Llm: llm, Call: call, Started: started, SentBack: sent_back || null };
		events.Send( { Kind: 'workers' } );
		await log_step( id, run_id, { Text: 'Consensus queued the build for ' + call.Name + ', job ' + job.Id + ( sent_back ? ', sent back on ' + sent_back : '' ), Seconds: seconds_since( started ), Tokens: tokens_of( prompt ) } );
	}


	// A build's answer: its threads opened, and its log posted as the receipt (a reply on the log sent back). An error
	// is logged in the run and, for a build sent back, replied on its log. The session ends either way.
	async function finish_build( job, body )
	{
		let state = job_state[ job.Id ];
		delete job_state[ job.Id ];
		let id = job.Proposal;
		if ( !state )
		{
			return { Error: 'the job is not known here any more' };
		}
		let model = ( body.Usage && body.Usage.Model ) || state.Call.Model || state.Call.Kind;
		let answer = null;
		let problem = body.Error ? String( body.Error ) : null;
		if ( !problem )
		{
			try
			{
				answer = LLM.ParseBuild( body.Answer );
			}
			catch ( error )
			{
				problem = error.message;
			}
		}
		try
		{
			if ( problem )
			{
				await log_step( id, job.Run, { Text: 'the build failed on ' + job.Worker + ': ' + problem, Seconds: seconds_since( state.Started ) } );
				if ( state.SentBack )
				{
					await add_reply( id, state.SentBack, state.Llm, 'The build failed on ' + job.Worker + ' (job ' + job.Id + '): ' + problem );
				}
				return { Error: problem };
			}
			await record_usage( state.Call, body.Usage );
			let opened = [];
			for ( let question of answer.Threads )
			{
				let anchor = question.Anchor ? { Text: question.Anchor } : null;
				let made = await create_thread( id, state.Llm, question.Text, anchor, false, { Build: { Job: job.Id } } );
				if ( made.Refused && anchor )
				{
					made = await create_thread( id, state.Llm, question.Text + '\n\n(Its anchor, "' + question.Anchor + '", was not found in the plan.)', null, false, { Build: { Job: job.Id } } );
				}
				if ( !made.Refused )
				{
					opened.push( made.Thread.Id );
				}
			}
			let receipt = build_receipt( job, answer, body.Usage, model, opened );
			// A round that gives no context keeps the one an earlier round of the same log gave.
			let fields = { Job: job.Id, Worker: job.Worker, Log: true };
			if ( answer.Context.trim() )
			{
				fields.Context = answer.Context;
			}
			let log_id = null;
			if ( state.SentBack )
			{
				let replied = await add_reply( id, state.SentBack, state.Llm, receipt );
				if ( !replied.Refused )
				{
					await set_build_fields( id, state.SentBack, fields );
					log_id = state.SentBack;
				}
			}
			if ( !log_id )
			{
				let made = await create_thread( id, state.Llm, receipt, null, false, { Build: fields } );
				log_id = made.Refused ? null : made.Thread.Id;
			}
			let output = ( body.Usage && body.Usage.Output ) || tokens_of( JSON.stringify( answer ) );
			await log_step( id, job.Run, { Text: model + ' built on ' + job.Worker + ': the build log ' + ( log_id || '(not posted)' ) + ( opened.length ? ', ' + opened.length + ( opened.length === 1 ? ' thread' : ' threads' ) + ' opened' : '' ), Seconds: seconds_since( state.Started ), Tokens: output } );
			console.log( 'build: ' + id + ': ' + model + ' on ' + job.Worker + ', ' + seconds_since( state.Started ) + 's, log ' + log_id + ', ' + opened.length + ' threads' );
			return { Log: log_id, Threads: opened };
		}
		finally
		{
			end_session( id, job.Run, null );
			events.Send( { Kind: 'workers' } );
		}
	}


	// The build log as the owner reads it: the receipt's facts, then the log the model wrote.
	function build_receipt( job, answer, usage, model, opened )
	{
		let tokens = ( usage && ( usage.Input || usage.Output ) ) ? ', ' + ( usage.Input || 0 ).toLocaleString( 'en-US' ) + ' in, ' + ( usage.Output || 0 ).toLocaleString( 'en-US' ) + ' out' : '';
		let lines = [
			'**Build log**: job ' + job.Id + ', worker ' + job.Worker + ', workspace ' + job.Workspace + ', ' + model + tokens + '.',
			'',
			answer.BuildLog,
			'',
		];
		if ( opened.length )
		{
			lines.push( 'Threads this build opened: ' + opened.join( ', ' ) + '.' );
			lines.push( '' );
		}
		lines.push( '_Resolve this thread to accept the build; reply to send it back._' );
		return lines.join( '\n' );
	}


	async function set_build_fields( id, thread_id, fields )
	{
		await store.Queue( id, async function ()
		{
			let read = await store.ReadProposal( id );
			let thread = read ? find_thread( read, thread_id ) : null;
			if ( thread )
			{
				thread.Build = Object.assign( {}, thread.Build || {}, fields );
				await store.WriteThreads( id, read.Threads );
			}
		} );
		changed( id, 'thread', thread_id );
	}


	// The owner resolved a build log: it is applied (outcome only), the context the build wrote is carried out, the
	// plan is Finished, and the worker is told, so its page offers Commit.
	async function build_accepted( id, thread_id )
	{
		let llm = llm_participant();
		let read = await store.ReadProposal( id );
		let thread = read ? find_thread( read, thread_id ) : null;
		if ( !llm || !is_build_log( thread ) )
		{
			return;
		}
		let applied = await apply_outcome( id, thread_id, llm, { Outcome: 'the build is accepted', Revision: read.Proposal.Revision }, true );
		if ( applied.Refused )
		{
			console.error( 'build: ' + id + ': the build log was not applied: ' + applied.Refused.Error );
		}
		if ( thread.Build.Context )
		{
			let context = await context_of( await store.ProjectOf( id ) );
			if ( context )
			{
				let written = await write_context( context.Id, llm, thread.Build.Context, 'the build of "' + read.Proposal.Title + '" was accepted', context.Revision );
				if ( written.Refused )
				{
					console.error( 'build: ' + id + ': the context was not written: ' + written.Refused.Error );
				}
			}
		}
		await set_state( id, FINISHED );
		if ( workers && thread.Build.Worker )
		{
			workers.Notify( thread.Build.Worker, { Job: thread.Build.Job, Change: 'accepted', Proposal: id, Title: read.Proposal.Title } );
		}
	}


	// The owner replied to a build log: the worker is told the build was sent back.
	function build_sent_back( thread )
	{
		if ( workers && thread.Build.Worker )
		{
			workers.Notify( thread.Build.Worker, { Job: thread.Build.Job, Change: 'sent back' } );
		}
	}


	// A pasted answer: Body = { Answer (the JSON object, or text holding it), Revision, ContextRevision?, Run? }
	// An answer that asks for more (with a Run, before its last turn) is answered, and the next prompt comes back to
	// copy: { Continue: true, Run, Turn, ...the prompt }. Any other is carried out: { Actions, Refused, Run }.
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
			let run = ( typeof body.Run === 'string' && body.Run ) ? await read_run( id, body.Run ) : null;
			let run_id = run ? run.Id : await start_run( id, MANUAL, null, null );
			let pasted = ( typeof body.Answer === 'string' ) ? body.Answer : JSON.stringify( body.Answer );
			let turns = ( run && run.Turns ) || [];
			let holder = await store.ProjectOf( id );
			if ( run && answer.Requests.length && turns.length + 1 < LLM.MAX_TURNS )
			{
				await log_step( id, run_id, { Text: 'The pasted answer asked for ' + answer.Requests.map( LLM.DescribeRequest ).join( ', ' ), Tokens: tokens_of( pasted ) } );
				let results = await answer_requests( id, run_id, holder, answer.Requests );
				turns = turns.concat( [ { Requests: answer.Requests, Results: results } ] );
				await update_run( id, run_id, function ( changed ) { changed.Turns = turns; } );
				let started = Date.now();
				let packed = await package_for( id, llm, run.Options, turns );
				await log_step( id, run_id, { Text: 'Consensus made answer ' + ( turns.length + 1 ) + '\'s prompt for copying', Seconds: seconds_since( started ), Tokens: tokens_of( packed.Prompt ) } );
				return response.json( Object.assign( { Continue: true, Run: run_id, Turn: turns.length + 1 }, prompt_view( packed ) ) );
			}
			let ignored = answer.Requests.length ? ' (its requests go unanswered)' : '';
			await log_step( id, run_id, { Text: 'The answer was pasted: ' + actions_words( answer.Actions ) + ignored, Tokens: tokens_of( pasted ) } );
			let context = ( holder && holder.Context ) ? { Id: holder.Context, Revision: ( typeof body.ContextRevision === 'number' ) ? body.ContextRevision : null } : null;
			let failures = await carry_out_answer( id, llm, run_id, answer.Actions, body.Revision, context, ( run && run.Options ) ? run.Options.Thread : null );
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
	// carried out, made from that revision. Made, when given, collects what thread and plan actions made and refused.
	async function carry_out( id, llm, waiting, actions, revision, context, made )
	{
		let failures = {};
		let current_revision = revision;
		let context_written = false;
		let record = made || { Made: [], Refused: [] };
		for ( let action of actions )
		{
			if ( action.Kind === 'thread' )
			{
				let anchor = text_of( action.Anchor ).trim() ? { Text: text_of( action.Anchor ).trim() } : null;
				let opened = await create_thread( id, llm, text_of( action.Text ).trim(), anchor, false );
				if ( opened.Refused )
				{
					record.Refused.push( 'a new thread: ' + opened.Refused.Error );
				}
				else
				{
					record.Made.push( 'thread ' + opened.Thread.Id );
				}
				continue;
			}
			if ( action.Kind === 'plan' )
			{
				let planned = await plan_from_answer( id, llm, action );
				if ( planned.Refused )
				{
					record.Refused.push( 'the plan "' + text_of( action.Title ).trim() + '": ' + planned.Refused.Error );
				}
				else
				{
					record.Made.push( 'plan "' + planned.Proposal.Title + '" (' + planned.Proposal.Id + ')' );
				}
				continue;
			}
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


	// A plan action: a new plan in the reviewed proposal's project, in the first state. Parent names a folder, or a
	// plan by title or id (a Subplan); none puts it in the reviewed proposal's folder. Returns { Proposal } or a refusal.
	async function plan_from_answer( id, llm, action )
	{
		let holder = await store.ProjectOf( id );
		if ( !holder )
		{
			return refused( 409, 'the proposal is in no project' );
		}
		let parent = null;
		let named = text_of( action.Parent ).trim();
		if ( named )
		{
			parent = await parent_named( holder, named );
			if ( !parent )
			{
				return refused( 400, 'no folder or plan "' + named + '" in the project' );
			}
		}
		else
		{
			parent = folder_of( holder.Items, id, null );
		}
		return await create_proposal( llm, { Title: text_of( action.Title ).trim(), Text: text_of( action.Text ), Kind: 'plan', State: states()[ 0 ], Project: holder.Id, Parent: parent } );
	}


	// The id of a folder named Name (any case), or of a plan with that id or title, in the project; or null.
	async function parent_named( project, name )
	{
		let wanted = name.toLowerCase();
		let folder = null;
		( function walk( nodes )
		{
			for ( let node of nodes )
			{
				if ( !folder && node.Kind === 'folder' && String( node.Name ).toLowerCase() === wanted )
				{
					folder = node.Id;
				}
				if ( Array.isArray( node.Items ) )
				{
					walk( node.Items );
				}
			}
		} )( project.Items );
		if ( folder )
		{
			return folder;
		}
		let plan = item_named( await project_items( project ), name, [ 'plan' ] );
		return plan ? plan.Id : null;
	}


	// The id of the folder that holds the item Id, however deep in plans; null at the project's root.
	function folder_of( nodes, id, folder )
	{
		for ( let node of nodes )
		{
			if ( node.Id === id )
			{
				return folder;
			}
			if ( Array.isArray( node.Items ) )
			{
				let found = folder_of( node.Items, id, ( node.Kind === 'folder' ) ? node.Id : folder );
				if ( found !== undefined )
				{
					return found;
				}
			}
		}
		return undefined;
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
		let caller = caller_for( call );
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
			let texts = corpus ? await corpus_texts( corpus ) : null;
			if ( !texts )
			{
				continue;
			}
			for ( let file of texts.Files )
			{
				files.push( corpus.Name + '/' + file.Path );
			}
			let keys = texts.Paths.filter( function ( path ) { return KEY_FILE.test( path ); } ).sort( by_depth );
			for ( let path of keys )
			{
				if ( key_files.length < KEY_FILE_COUNT )
				{
					key_files.push( { Path: corpus.Name + '/' + path, Text: await texts.Text( path ) } );
				}
			}
		}
		return { Items: items, Files: files, KeyFiles: key_files };
	}


	// A corpus's files, the paths of its text files and a way to read one, from its zip.
	// Null when neither can be read.
	async function corpus_texts( corpus )
	{
		let listed = null;
		try
		{
			listed = await corpus_files( corpus );
		}
		catch ( error )
		{
			return null;
		}
		let kept = listed.filter( function ( file ) { return !left_out( file.Reason ); } );
		return {
			Files: kept,
			Paths: kept.filter( function ( file ) { return file.Indexed; } ).map( function ( file ) { return file.Path; } ),
			Text: function ( path ) { return corpus_read( corpus, path ); },
		};
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

	App.use( '/api/workers', worker_router );
	App.use( '/api', router );
}


module.exports = {
	Attach: Attach,
};
