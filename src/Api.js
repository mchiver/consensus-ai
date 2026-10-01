'use strict';

// Api - the REST routes under /api, over Store, Rules, Anchors and Participants.
// Every rule lives here or in Rules.js, none in a client: the page and the LLM's curl see the same API.
// Errors are { Error } with a status. Writes to one proposal run through the store's queue.
// The server holds the core of Consensus only (plan Consensus Desktop, Step 1): projects and their trees, plans with
// their threads and revisions, documents, the turn (Waiting), export and import, and the settings. The LLM takes part
// through the API as a participant, from wherever it runs.
// Each project has a Context folder (project.ContextFolder), first in its tree, holding its Context document
// (project.Context) and any other document: a document goes nowhere else, and that folder holds nothing else. Neither
// the folder nor the Context document is renamed, moved, copied or deleted.

const EXPRESS = require( 'express' );
const RULES = require( './Rules.js' );
const ANCHORS = require( './Anchors.js' );
const PARTICIPANTS = require( './Participants.js' );
const STORE = require( './Store.js' );
const TREE = require( './Tree.js' );
const PORT = require( './ProjectPort.js' );
const IDS = require( './Ids.js' );
const VERSION = require( '../package.json' ).version;

const BODY_LIMIT = '64mb';	// a project import is one json body, every revision of every plan in it
const PARENT_REFUSED = 'Parent is not a folder of the project, or a plan (which holds plans only); a document goes in the Context folder, which holds documents only';
const CONTEXT_KEPT = 'the Context folder and the Context document stay as they are: never renamed, moved, copied or deleted';


//---------------------------------------------------------------------
// Attach: mounts the routes on an Express app. Context = { Store, Settings, Events }

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


	// A refusal from a function the routes share: the route turns it into fail().
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


	// A change happened: tell the listeners.
	function changed( id, kind, thread_id )
	{
		let event = { Proposal: id, Kind: kind };
		if ( thread_id )
		{
			event.Thread = thread_id;
		}
		events.Send( event );
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
		let line = is_document( proposal ) ? 'a document' : RULES.StateLine( tally, name );
		return Object.assign( {}, proposal, { Tally: tally, StateLine: line } );
	}


	// A Document is edited and kept like a Plan, but has no threads and no state.
	function is_document( proposal )
	{
		return proposal.Kind === 'document' || proposal.Kind === 'context';
	}


	function states()
	{
		return PARTICIPANTS.States( settings );
	}


	// The Context folder or the Context document of a project.
	function is_context_item( project, id )
	{
		return !!project && ( id === project.Context || id === project.ContextFolder );
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
		response.json( { Me: PARTICIPANTS.Public( request.Participant ), Participants: participants(), States: states(), Version: VERSION } );
	} );


	//-----------------------------------------------------------------
	// Settings: consensus.json, read and written whole by the owner (the settings modal). Everything applies at once
	// but Host and Port, which take effect at the next start; the answer says when a restart is needed.

	router.get( '/settings', function ( request, response )
	{
		if ( request.Participant.Role !== 'owner' )
		{
			return fail( response, 403, 'only the owner reads the settings' );
		}
		response.json( { Settings: settings, Path: store.SettingsPath() } );
	} );


	router.put( '/settings', async function ( request, response )
	{
		if ( request.Participant.Role !== 'owner' )
		{
			return fail( response, 403, 'only the owner writes the settings' );
		}
		let body = request.body || {};
		let clean = PARTICIPANTS.Clean( body.Settings || body );
		let problems = PARTICIPANTS.Validate( clean );
		if ( !problems.length && Array.isArray( clean.States ) )
		{
			for ( let proposal of await store.ListProposals() )
			{
				if ( proposal.Kind === 'plan' && proposal.State && !clean.States.includes( proposal.State ) )
				{
					problems.push( 'the state "' + proposal.State + '" is used by the plan "' + proposal.Title + '"' );
				}
			}
		}
		if ( problems.length )
		{
			return fail( response, 400, 'the settings have problems: ' + problems[ 0 ], { Problems: problems } );
		}
		let restart = ( clean.Host !== settings.Host ) || ( clean.Port !== settings.Port );
		await store.WriteSettings( clean );
		for ( let key of Object.keys( settings ) )
		{
			delete settings[ key ];
		}
		Object.assign( settings, clean );
		events.Send( { Settings: true, Kind: 'settings' } );
		response.json( { Settings: settings, Restart: restart } );
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
		// when not named). A document with no Parent goes in the project's Context folder.
		let project_id = ( body.Project === undefined || body.Project === null ) ? STORE.DEFAULT_PROJECT : body.Project;
		let parent = ( body.Parent === undefined ) ? null : body.Parent;
		let result = await create_proposal( request.Participant, { Title: title, Text: text_of( body.Text ), Kind: kind, State: state, Project: project_id, Parent: parent } );
		if ( result.Refused )
		{
			return send_result( response, result );
		}
		response.status( 201 ).json( { Proposal: summarize( result.Proposal, [], request.Participant.Name ), Project: result.Project } );
	} );


	// A new plan or document in a project, at Parent (a folder, or a plan for a Subplan), else at its root (a
	// document: in its Context folder). Fields = { Title, Text, Kind, State, Project, Parent }. Returns
	// { Proposal, Project } or a refusal.
	async function create_proposal( participant, fields )
	{
		let target = await store.ReadProject( fields.Project );
		if ( !target )
		{
			return refused( 404, 'no such project' );
		}
		let parent = fields.Parent;
		if ( fields.Kind === 'document' && ( parent === null || parent === undefined ) )
		{
			parent = target.ContextFolder || null;
		}
		if ( !TREE.CanHold( target.Items, parent, fields.Kind, target.ContextFolder ) )
		{
			return refused( 400, PARENT_REFUSED );
		}
		let proposal = await store.CreateProposal( { Title: fields.Title, Text: fields.Text, By: participant.Name, Kind: fields.Kind, State: fields.State } );
		let placed = await change_project( target.Id, null, function ( project )
		{
			let node = { Kind: fields.Kind, Id: proposal.Id };
			if ( !TREE.Insert( project.Items, parent, node, undefined, project.ContextFolder ) )
			{
				TREE.Insert( project.Items, ( fields.Kind === 'document' ) ? project.ContextFolder : null, node, undefined, project.ContextFolder );
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
			Context: !!( holder && holder.Context === request.params.id ),
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
		if ( is_context_item( await store.ProjectOf( id ), id ) )
		{
			return fail( response, 409, CONTEXT_KEPT );
		}
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
		let holder = await store.ProjectOf( id );
		if ( is_context_item( holder, id ) )
		{
			return fail( response, 409, CONTEXT_KEPT );
		}
		// A plan's Subplans go to the trash with it.
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
				return fail( response, 409, 'a Document has no State' );
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


	// The projects as the page shows them: each item with its title, state and tally; Context names the Context
	// document (and whether it is still empty) and ContextFolder the folder that holds it.
	async function present_projects( projects, name )
	{
		let views = {};
		for ( let proposal of await store.ListProposals() )
		{
			let read = await store.ReadProposal( proposal.Id );
			let summary = summarize( proposal, read ? read.Threads : [], name );
			views[ proposal.Id ] = { Title: summary.Title, State: summary.State, Tally: summary.Tally, StateLine: summary.StateLine, Created: summary.Created, Updated: summary.Updated };
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
			return Object.assign( {}, project, { Items: present_items( project.Items, views ), Context: context, ContextFolder: project.ContextFolder || null } );
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


	// A project is empty when its tree holds only the Context folder with only the Context document.
	function only_context( project )
	{
		if ( project.Items.length !== 1 )
		{
			return project.Items.length === 0;
		}
		let first = project.Items[ 0 ];
		if ( first.Id !== project.ContextFolder || !Array.isArray( first.Items ) )
		{
			return false;
		}
		return first.Items.every( function ( node ) { return node.Id === project.Context; } );
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


	// Only an empty project is deleted, and never the Default one. Its Context document goes to the trash with it.
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
			if ( !only_context( project ) )
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
		let exported = await PORT.Export( store, request.params.pid );
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
		events.Send( { Project: report.Project.Id, Kind: 'project' } );
		response.status( 201 ).json( { Report: report } );
	} );


	//-----------------------------------------------------------------
	// Folders

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
			if ( !TREE.Insert( project.Items, ( body.Parent === undefined ) ? null : body.Parent, folder, undefined, project.ContextFolder ) )
			{
				return refused( 400, 'Parent is not a folder of the project (the Context folder holds documents only)' );
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
			if ( request.params.fid === project.ContextFolder )
			{
				return refused( 409, CONTEXT_KEPT );
			}
			let found = TREE.Find( project.Items, request.params.fid );
			if ( !found || found.Node.Kind !== 'folder' )
			{
				return refused( 404, 'no such folder' );
			}
			found.Node.Name = name;
		} );
		send_result( response, result, 200, { Project: result.Project } );
	} );


	// Only an empty folder is deleted, and never the Context folder.
	router.delete( '/projects/:pid/folders/:fid', async function ( request, response )
	{
		let result = await change_project( request.params.pid, null, function ( project )
		{
			if ( request.params.fid === project.ContextFolder )
			{
				return refused( 409, CONTEXT_KEPT );
			}
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
		if ( !TREE.CanHold( project.Items, where.Parent, kind, project.ContextFolder ) )
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


	// Where a root move lands: the Context folder stays first, so "just before it" means just after it.
	function root_before( project, parent, before )
	{
		if ( parent !== null || !before || before !== project.ContextFolder )
		{
			return before;
		}
		let index = project.Items.findIndex( function ( node ) { return node.Id === before; } );
		let next = ( index >= 0 && index + 1 < project.Items.length ) ? project.Items[ index + 1 ] : null;
		return next ? next.Id : null;
	}


	// Move: into a folder or a project's root, at the end or just before a child of it; within a project or
	// into another. The Context folder and the Context document stay where they are.
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
		if ( is_context_item( source, id ) )
		{
			return fail( response, 409, CONTEXT_KEPT );
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
				if ( !TREE.CanHold( project.Items, where.Parent, found.Node.Kind, project.ContextFolder ) )
				{
					return refused( 400, PARENT_REFUSED );
				}
				TREE.Remove( project.Items, id );
				TREE.Insert( project.Items, where.Parent, found.Node, root_before( project, where.Parent, where.Before ), project.ContextFolder );
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
				if ( !TREE.Insert( project.Items, where.Parent, node, root_before( project, where.Parent, where.Before ), project.ContextFolder ) )
				{
					return refused( 400, PARENT_REFUSED );
				}
			} );
			if ( result.Refused )
			{
				await change_project( source.Id, null, function ( project )
				{
					TREE.Insert( project.Items, ( node.Kind === 'document' ) ? project.ContextFolder : null, node, undefined, project.ContextFolder );
				} );
			}
		}
		send_result( response, result, 200, { Project: result.Project } );
	} );


	// A copy of a plan or document is whole (text, threads, revisions) under a new id; a folder's copy holds a
	// copy of everything in it, and a plan's copy a copy of its Subplans, with new ids throughout. The Context
	// folder and the Context document are not copied.
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
		if ( is_context_item( source, id ) )
		{
			return fail( response, 409, CONTEXT_KEPT );
		}
		let problem = await check_target( where, found.Node.Kind );
		if ( problem )
		{
			return send_result( response, problem );
		}
		let copy = await copy_node( found.Node );
		if ( copy.Refused )
		{
			return send_result( response, copy );
		}
		let result = await change_project( where.Project, null, function ( project )
		{
			if ( !TREE.Insert( project.Items, where.Parent, copy, undefined, project.ContextFolder ) )
			{
				return refused( 400, PARENT_REFUSED );
			}
		} );
		send_result( response, result, 201, { Node: copy, Project: result.Project } );
	} );


	// The copy of one node and everything under it, or a refusal.
	async function copy_node( node )
	{
		if ( node.Kind === 'folder' )
		{
			let folder = { Kind: 'folder', Id: new_id( IDS.FOLDER ), Name: node.Name, Items: [] };
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
			let copied = { Kind: node.Kind, Id: proposal.Id };
			if ( Array.isArray( node.Items ) && node.Items.length )
			{
				copied.Items = [];
				for ( let child of node.Items )
				{
					let subplan = await copy_node( child );
					if ( subplan.Refused )
					{
						return subplan;
					}
					copied.Items.push( subplan );
				}
			}
			return copied;
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
	// With Resolve (the owner's Comment and resolve), resolved as it is posted. Returns { Thread } or a refusal.
	async function create_thread( id, participant, text, anchor_given, resolve )
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
				return refused( 409, 'a Document has no threads' );
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
	// Returns { Thread, Reopened, Resolved } or { Refused: { Status, Error } }.
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
	// Anchor, when given, points the thread at the passage the change produced. Returns { Thread, Proposal } or
	// { Refused: { Status, Error, Extra } }.
	async function apply_outcome( id, thread_id, participant, body )
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
			if ( body.Anchor && !anchor )
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
		let result = await apply_outcome( request.params.id, request.params.tid, request.Participant, request.body || {} );
		if ( result.Refused )
		{
			return fail( response, result.Refused.Status, result.Refused.Error, result.Refused.Extra );
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
