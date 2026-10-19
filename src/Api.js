'use strict';

// Api - the REST routes under /api, over Store, Rules, Anchors and Participants.
// Every rule lives here or in Rules.js, none in a client: the page and the LLM's curl see the same API.
// Errors are { Error } with a status. Writes to one plan run through the store's queue.
// The server holds the core of Consensus only (plan Consensus Desktop, Step 1): projects and their trees, plans with
// their threads and revisions, documents, the turn (Waiting), export and import, and the settings. The LLM takes part
// through the API as a participant, from wherever it runs. Plan Run Shapes, Step 3: the server runs the LLMs too:
// the connections (/llms, each a participant of this server) and the runs (/runs) are routes here, over Llms.js,
// Runner.js and Runs.js.
// Each project has a Context folder (project.ContextFolder), first in its tree, holding its Readme
// (project.Context) and any other document: a document goes nowhere else, and that folder holds nothing else. Neither
// the folder nor the Readme is renamed, moved, copied or deleted.

const EXPRESS = require( 'express' );
const RULES = require( './Rules.js' );
const ANCHORS = require( './Anchors.js' );
const PARTICIPANTS = require( './Participants.js' );
const STORE = require( './Store.js' );
const TREE = require( './Tree.js' );
const PORT = require( './ProjectPort.js' );
const IDS = require( './Ids.js' );
const LLMS = require( './Llms.js' );
const TASKS = require( './Tasks.js' );
const LLM = require( './Llm.js' );
const REPORT = require( './Report.js' );
const VERSION = require( '../package.json' ).version;

const BODY_LIMIT = '64mb';	// a project import is one json body, every revision of every plan in it
const PARENT_REFUSED = 'Parent is not a folder of the project, or a plan (which holds plans only); a document goes in the Context folder, which holds documents only';
const CONTEXT_KEPT = 'the Context folder and its Readme stay as they are: never renamed, moved, copied or deleted';


//---------------------------------------------------------------------
// Attach: mounts the routes on an Express app. Context = { Store, Settings, Events, Runs?, Runner?, Git? }
// Git (plan LLM Tasks, Step 3: the Work options): the commit and push when the owner resolves a build log of a
// project whose AutoCommit is on, the thread keeping the record.

function Attach( App, Context )
{
	let store = Context.Store;
	let settings = Context.Settings;
	let events = Context.Events;
	let runs = Context.Runs || null;
	let runner = Context.Runner || null;
	let git = Context.Git || null;
	let tokens = Context.Tokens || null;
	let router = EXPRESS.Router();
	router.use( EXPRESS.json( { limit: BODY_LIMIT } ) );
	router.use( identify );


	//-----------------------------------------------------------------
	// Identity (plan User Management, Step 2): every request is the owner account, saying who it is with the
	// X-Consensus-Service header, or a run on its run token; an unknown token is refused. request.Participant is the
	// account: { Name, Display, Role, Service, Token, Writes, Speaker }, Speaker the key the rules run over. A run
	// whose task writes nothing (plan LLM Tasks, Step 1: Writes none) is refused every request but a read.

	function identify( request, response, next )
	{
		let participant = PARTICIPANTS.Identify( settings, { Authorization: request.get( 'Authorization' ), Service: request.get( PARTICIPANTS.SERVICE_HEADER ) }, tokens );
		if ( !participant )
		{
			return fail( response, 401, 'unknown token' );
		}
		if ( participant.Writes === 'none' && request.method !== 'GET' && request.method !== 'HEAD' )
		{
			return fail( response, 403, 'this run reads only' );
		}
		request.Participant = participant;
		next();
	}


	// The speakers the rules run over: the owner, one per LLM connection, and everyone seen in the threads given.
	function speakers( threads, account )
	{
		return PARTICIPANTS.SeenSpeakers( settings, threads || [], account || null );
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
		let event = { Plan: id, Kind: kind };
		if ( thread_id )
		{
			event.Thread = thread_id;
		}
		events.Send( event );
	}


	//-----------------------------------------------------------------
	// Views: what a plan looks like to the account asking (request.Participant).

	function present_threads( threads, text, account )
	{
		let plain = ANCHORS.PlainText( text );
		let name = account.Speaker;
		let all = speakers( threads, account );
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


	function summarize( plan, threads, account )
	{
		let tally = RULES.Tally( plan, threads, speakers( threads, account ) );
		let line = is_document( plan ) ? 'a document' : RULES.StateLine( tally, account.Speaker );
		return Object.assign( {}, plan, { Tally: tally, StateLine: line } );
	}


	// A Document is edited and kept like a Plan, but has no threads and no state.
	function is_document( plan )
	{
		return plan.Kind === 'document' || plan.Kind === 'context';
	}


	// The settings' States: the default list for a new project (plan Run Shapes, Step 2: each project keeps its own).
	function states()
	{
		return PARTICIPANTS.States( settings );
	}


	function project_states( project )
	{
		if ( project && Array.isArray( project.States ) && project.States.length )
		{
			return project.States;
		}
		return states();
	}


	// The ids of the plans a node holds: itself when it is one, and everything under it.
	function plan_ids_of( node )
	{
		let ids = ( node.Kind === 'folder' ) ? [] : [ node.Id ];
		return ids.concat( TREE.ItemIds( node.Items || [] ) );
	}


	// The Context folder or the Readme of a project.
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
		response.json( { Me: PARTICIPANTS.Public( request.Participant ), Participants: speakers( [], request.Participant ), States: states(), Version: VERSION, Server: settings.Name || null } );
	} );


	//-----------------------------------------------------------------
	// Settings: consensus.json, read whole and written by the owner (the settings modal): the server's fields (Name,
	// Port, Scope, States, Owner, Clerk, Tasks) replace what the file has, and any other field (the desktop's, plan Run Shapes)
	// stays as it is. Everything applies at once but Scope and Port, which take effect at the next start; the answer
	// says when a restart is needed.

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
		if ( problems.length )
		{
			return fail( response, 400, 'the settings have problems: ' + problems[ 0 ], { Problems: problems } );
		}
		let before = { Scope: PARTICIPANTS.Scope( settings ), Port: settings.Port };
		for ( let field of PARTICIPANTS.SETTINGS_FIELDS )
		{
			delete settings[ field ];
		}
		Object.assign( settings, clean );
		PARTICIPANTS.Migrate( settings );
		let restart = ( settings.Scope !== before.Scope ) || ( settings.Port !== before.Port );
		await store.WriteSettings( settings );
		events.Send( { Settings: true, Kind: 'settings' } );
		response.json( { Settings: settings, Restart: restart } );
	} );


	//-----------------------------------------------------------------
	// Plans

	router.get( '/plans', async function ( request, response )
	{
		let plans = await store.ListPlans();
		let state = request.query.state;
		let list = [];
		for ( let plan of plans )
		{
			if ( state && plan.State !== state )
			{
				continue;
			}
			let read = await store.ReadPlan( plan.Id );
			list.push( summarize( plan, read ? read.Threads : [], request.Participant ) );
		}
		response.json( { Plans: list } );
	} );


	router.post( '/plans', async function ( request, response )
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
		if ( kind === 'document' && body.State !== undefined && body.State !== null )
		{
			return fail( response, 400, 'a Document has no State' );
		}
		// Where it goes: a project (the first when not named) and a folder in it, or a plan for a Subplan (its root
		// when not named). A document with no Parent goes in the project's Context folder.
		let project_id = body.Project;
		if ( project_id === undefined || project_id === null )
		{
			let first = ( await store.ListProjects() )[ 0 ];
			project_id = first ? first.Id : null;
		}
		let parent = ( body.Parent === undefined ) ? null : body.Parent;
		let result = await create_plan( request.Participant, { Title: title, Text: text_of( body.Text ), Kind: kind, State: body.State, Project: project_id, Parent: parent } );
		if ( result.Refused )
		{
			return send_result( response, result );
		}
		response.status( 201 ).json( { Plan: summarize( result.Plan, [], request.Participant ), Project: result.Project } );
	} );


	// A new plan or document in a project, at Parent (a folder, or a plan for a Subplan), else at its root (a
	// document: in its Context folder). Fields = { Title, Text, Kind, State, Project, Parent }; a plan's State is one
	// of the project's, the first when not given. Returns { Plan, Project } or a refusal.
	async function create_plan( participant, fields )
	{
		let target = await store.ReadProject( fields.Project );
		if ( !target )
		{
			return refused( 404, 'no such project' );
		}
		let state = project_states( target )[ 0 ];
		if ( fields.Kind === 'plan' && fields.State !== undefined )
		{
			let can = RULES.CanSetState( fields.State, project_states( target ) );
			if ( !can.Ok )
			{
				return refused( 400, can.Reason );
			}
			state = fields.State;
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
		let plan = await store.CreatePlan( { Project: target.Id, Title: fields.Title, Text: fields.Text, By: participant.Name, Service: participant.Service, Token: participant.Token, Kind: fields.Kind, State: state } );
		let placed = await change_project( target.Id, null, function ( project )
		{
			let node = { Kind: fields.Kind, Id: plan.Id };
			if ( !TREE.Insert( project.Items, parent, node, undefined, project.ContextFolder ) )
			{
				TREE.Insert( project.Items, ( fields.Kind === 'document' ) ? project.ContextFolder : null, node, undefined, project.ContextFolder );
			}
		} );
		if ( placed.Refused )
		{
			console.error( 'projects: ' + plan.Id + ' was created but not placed: ' + placed.Refused.Error );
		}
		changed( plan.Id, 'created' );
		return { Plan: plan, Project: target.Id };
	}


	router.get( '/plans/:id', async function ( request, response )
	{
		let read = await store.ReadPlan( request.params.id );
		if ( !read )
		{
			return fail( response, 404, 'no such plan' );
		}
		let name = request.Participant;
		let holder = await store.ProjectOf( request.params.id );
		response.json( {
			Me: PARTICIPANTS.Public( request.Participant ),
			Participants: speakers( read.Threads, request.Participant ),
			Project: holder ? { Id: holder.Id, Name: holder.Name } : null,
			Context: !!( holder && holder.Context === request.params.id ),
			Plan: summarize( read.Plan, read.Threads, name ),
			Text: read.Text,
			Threads: present_threads( read.Threads, read.Text, name ),
		} );
	} );


	// The report (plan Printing and Reporting): the plan, its Subplans and all their threads as one page made for
	// printing, or the same as markdown; any participant reads it, as they read the plan.
	router.get( '/plans/:id/report', async function ( request, response )
	{
		await send_report( request, response, 'html' );
	} );


	router.get( '/plans/:id/report.md', async function ( request, response )
	{
		await send_report( request, response, 'markdown' );
	} );


	async function send_report( request, response, form )
	{
		let composed = await REPORT.Compose( store, settings, request.params.id );
		if ( composed.Error )
		{
			return fail( response, composed.Status, composed.Error );
		}
		if ( form === 'markdown' )
		{
			response.type( 'text/markdown; charset=utf-8' ).send( REPORT.Markdown( composed.Report ) );
			return;
		}
		response.type( 'html' ).send( REPORT.Html( composed.Report ) );
	}


	router.put( '/plans/:id', async function ( request, response )
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
			let read = await store.ReadPlan( id );
			if ( !read )
			{
				return fail( response, 404, 'no such plan' );
			}
			let plan = await store.UpdatePlan( id, { Title: title } );
			return summarize( plan, read.Threads, request.Participant );
		} );
		if ( !result )
		{
			return;
		}
		changed( id, 'title' );
		response.json( { Plan: result } );
	} );


	// A manual edit: a new revision; no thread's status changes. Refused when made from a stale revision.
	router.put( '/plans/:id/text', async function ( request, response )
	{
		let body = request.body || {};
		if ( typeof body.Text !== 'string' )
		{
			return fail( response, 400, 'Text is required' );
		}
		let id = request.params.id;
		let result = await store.Queue( id, async function ()
		{
			let read = await store.ReadPlan( id );
			if ( !read )
			{
				return fail( response, 404, 'no such plan' );
			}
			if ( body.Revision !== read.Plan.Revision )
			{
				return fail( response, 409, 'the text changed since revision ' + body.Revision + '; reload and edit again', { Revision: read.Plan.Revision } );
			}
			let plan = await store.WriteText( id, { Text: body.Text, By: request.Participant.Name, Service: request.Participant.Service, Token: request.Participant.Token, Reason: 'edit' } );
			refind( read.Threads, body.Text );
			await store.WriteThreads( id, read.Threads );
			return summarize( plan, read.Threads, request.Participant );
		} );
		if ( !result )
		{
			return;
		}
		changed( id, 'text' );
		response.json( { Plan: result } );
	} );


	router.delete( '/plans/:id', async function ( request, response )
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
			return await store.TrashPlan( id );
		} );
		if ( !moved )
		{
			return fail( response, 404, 'no such plan' );
		}
		let trashed = [ id ];
		for ( let subplan of subplans )
		{
			if ( await store.Queue( subplan, function () { return store.TrashPlan( subplan ); } ) )
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
		response.json( { Plans: await store.ListTrash() } );
	} );


	// Empty Trash (the owner's): every trashed item of every project removed for good; the pages hear { Kind: "trash" }.
	router.delete( '/trash', async function ( request, response )
	{
		if ( request.Participant.Role !== 'owner' )
		{
			return fail( response, 403, 'only the owner empties the trash' );
		}
		let emptied = await store.EmptyTrash();
		events.Send( { Kind: 'trash' } );
		response.json( { Emptied: emptied } );
	} );


	// A plan's state: one of its project's States, set by anyone at any time. { State }
	router.put( '/plans/:id/state', async function ( request, response )
	{
		let wanted = ( request.body || {} ).State;
		let id = request.params.id;
		let can = RULES.CanSetState( wanted, project_states( await store.ProjectOf( id ) ) );
		if ( !can.Ok )
		{
			return fail( response, 400, can.Reason );
		}
		let result = await store.Queue( id, async function ()
		{
			let read = await store.ReadPlan( id );
			if ( !read )
			{
				return fail( response, 404, 'no such plan' );
			}
			if ( is_document( read.Plan ) )
			{
				return fail( response, 409, 'a Document has no State' );
			}
			let plan = await store.UpdatePlan( id, { State: wanted } );
			return summarize( plan, read.Threads, request.Participant );
		} );
		if ( !result )
		{
			return;
		}
		changed( id, 'state' );
		response.json( { Plan: result } );
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


	// The projects as the page shows them: each item with its title, state and tally, the archived ones too (plan Run
	// Shapes, Step 2: Archive, read-only); Context names the Context document (and whether it is still empty) and
	// ContextFolder the folder that holds it; States the project's own; Path its folder.
	async function present_projects( projects, name )
	{
		let views = {};
		for ( let plan of await store.ListPlans() )
		{
			let read = await store.ReadPlan( plan.Id );
			let summary = summarize( plan, read ? read.Threads : [], name );
			views[ plan.Id ] = { Title: summary.Title, State: summary.State, Tally: summary.Tally, StateLine: summary.StateLine, Created: summary.Created, Updated: summary.Updated };
		}
		for ( let project of projects )
		{
			for ( let id of TREE.ItemIds( project.Archive || [] ) )
			{
				let read = await store.ReadPlan( id );
				if ( read )
				{
					let summary = summarize( read.Plan, read.Threads, name );
					views[ id ] = { Title: summary.Title, State: summary.State, Tally: summary.Tally, StateLine: summary.StateLine, Created: summary.Created, Updated: summary.Updated, Archived: true };
				}
			}
		}
		let empty = {};
		for ( let project of projects )
		{
			let read = project.Context ? await store.ReadPlan( project.Context ) : null;
			empty[ project.Id ] = !read || !read.Text.trim();
		}
		return projects.map( function ( project )
		{
			let context = project.Context ? { Id: project.Context, Empty: empty[ project.Id ] } : null;
			return Object.assign( {}, project, { Items: present_items( project.Items, views ), Archive: present_items( project.Archive || [], views ), Context: context, ContextFolder: project.ContextFolder || null, States: project_states( project ) } );
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


	// A project is empty when its tree holds only the Context folder with only the Readme.
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
		response.json( { Projects: await present_projects( projects, request.Participant ) } );
	} );


	// A new project: { Name, Path? }. Path is the project's folder, <config>/projects/<name>/ when not given; a folder
	// that holds a project already (its .consensus) is opened instead, under its own name (plan Run Shapes, Step 2).
	router.post( '/projects', async function ( request, response )
	{
		let body = request.body || {};
		let name = name_of_body( body );
		let path = ( typeof body.Path === 'string' ) ? body.Path.trim() : '';
		if ( path )
		{
			let opened = await store.OpenProject( path );
			if ( opened )
			{
				events.Send( { Project: opened.Id, Kind: 'project' } );
				return response.status( 200 ).json( { Project: opened, Opened: true } );
			}
		}
		if ( !name )
		{
			return fail( response, 400, 'Name is required' );
		}
		let project = await store.CreateProject( { Name: name, Path: path || undefined } );
		events.Send( { Project: project.Id, Kind: 'project' } );
		response.status( 201 ).json( { Project: project } );
	} );


	// A project's Name, its own States, Include, Exclude and Commands (each a list, or lines of text), its Tasks, and
	// its GitSync and AutoCommit (Step 3; false is dropped from the file); a state still used by one of its plans cannot
	// be removed.
	router.put( '/projects/:pid', async function ( request, response )
	{
		let body = request.body || {};
		let name = name_of_body( body );
		let fields = project_fields( body );
		if ( fields.Problems.length )
		{
			return fail( response, 400, fields.Problems[ 0 ], { Problems: fields.Problems } );
		}
		if ( !name && !Object.keys( fields.Values ).length )
		{
			return fail( response, 400, 'Name is required' );
		}
		let result = await change_project( request.params.pid, body.Version, async function ( project )
		{
			if ( name )
			{
				project.Name = name;
			}
			if ( fields.Values.States )
			{
				for ( let id of TREE.ItemIds( project.Items ) )
				{
					let read = await store.ReadPlan( id );
					if ( read && read.Plan.Kind === 'plan' && read.Plan.State && !fields.Values.States.includes( read.Plan.State ) )
					{
						return refused( 400, 'the state "' + read.Plan.State + '" is used by the plan "' + read.Plan.Title + '"' );
					}
				}
			}
			Object.assign( project, fields.Values );
			if ( project.Tasks === null )
			{
				delete project.Tasks;
			}
			for ( let flag of [ 'GitSync', 'AutoCommit' ] )
			{
				if ( project[ flag ] === false )
				{
					delete project[ flag ];
				}
			}
		} );
		send_result( response, result, 200, { Project: result.Project } );
	} );


	// The project's lists as a body gives them: States (one or more names, none twice), Include, Exclude and Commands
	// (any lines), Tasks (plan LLM Tasks, Step 1: the enabled ids; null enables them all, the list dropped), and the
	// Work options GitSync and AutoCommit (Step 3: true or false). Returns { Values, Problems }.
	function project_fields( body )
	{
		let values = {};
		let problems = [];
		for ( let field of [ 'States', 'Include', 'Exclude', 'Commands' ] )
		{
			if ( body[ field ] === undefined )
			{
				continue;
			}
			let lines = Array.isArray( body[ field ] ) ? body[ field ] : String( body[ field ] || '' ).split( /\r?\n/ );
			lines = lines.map( function ( line ) { return String( line ).trim(); } ).filter( function ( line ) { return line; } );
			if ( field === 'States' && !lines.length )
			{
				problems.push( 'States must be a list of one or more names' );
			}
			if ( field === 'States' && new Set( lines ).size !== lines.length )
			{
				problems.push( 'States names a state twice' );
			}
			values[ field ] = lines;
		}
		if ( body.Tasks === null )
		{
			values.Tasks = null;
		}
		else if ( body.Tasks !== undefined )
		{
			let ids = ( Array.isArray( body.Tasks ) ? body.Tasks : [] ).map( function ( id ) { return String( id ).trim(); } );
			values.Tasks = ids.filter( function ( id, index ) { return id && ids.indexOf( id ) === index; } );
		}
		for ( let flag of [ 'GitSync', 'AutoCommit' ] )
		{
			if ( body[ flag ] !== undefined )
			{
				values[ flag ] = ( body[ flag ] === true );
			}
		}
		return { Values: values, Problems: problems };
	}


	// Only an empty project is deleted, and never the last one. Its Readme goes to the trash with it.
	router.delete( '/projects/:pid', async function ( request, response )
	{
		let id = request.params.pid;
		let result = await store.Queue( project_queue( id ), async function ()
		{
			let project = await store.ReadProject( id );
			if ( !project )
			{
				return refused( 404, 'no such project' );
			}
			if ( ( await store.ListProjects() ).length <= 1 )
			{
				return refused( 409, 'the last project is never deleted' );
			}
			if ( !only_context( project ) || ( project.Archive || [] ).length )
			{
				return refused( 409, 'only an empty project is deleted: move or delete what it holds first' );
			}
			await store.DeleteProject( id );
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
		response.json( { Projects: await present_projects( await store.ListProjects(), request.Participant ) } );
	} );


	//-----------------------------------------------------------------
	// Export and import: a whole project as one json object (ProjectPort.js). The owner, or the llm participant (an
	// agent session carrying projects from one Consensus server to another).

	function may_port( participant )
	{
		return !!participant && participant.Role === 'owner';
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


	// A folder, a plan or a document as one file of the same format (plan UI Tweaks V); the Readme and the Context
	// folder are not exported on their own.
	router.get( '/items/:id/export', async function ( request, response )
	{
		if ( !may_port( request.Participant ) )
		{
			return fail( response, 403, 'only the owner or the llm exports an item' );
		}
		let exported = await PORT.ExportItem( store, request.params.id );
		if ( !exported )
		{
			return fail( response, 404, 'no such item in any project' );
		}
		if ( exported.Context )
		{
			return fail( response, 409, CONTEXT_KEPT );
		}
		response.json( exported );
	} );


	// Body = { Export, Mode?, Preview?, Into? }  Preview: true writes nothing and answers whether the project is
	// here. A project that is here needs Mode: 'copy' or 'merge'. Into: { Project, Parent? } writes the file's items
	// into that project's root or folder instead, every id new (plan UI Tweaks V). Without Preview the import is
	// written and answered with its report.
	router.post( '/projects/import', async function ( request, response )
	{
		if ( !may_port( request.Participant ) )
		{
			return fail( response, 403, 'only the owner or the llm imports a project' );
		}
		let body = request.body || {};
		let options = { Mode: body.Mode, Preview: !!body.Preview, Into: body.Into };
		let names = speakers().map( function ( speaker ) { return speaker.Name; } );
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
	// into another. The Context folder and the Readme stay where they are.
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
			else
			{
				// The items' folders follow into the other project's .consensus (plan Run Shapes, Step 2).
				for ( let moved of plan_ids_of( node ) )
				{
					await store.Queue( moved, function () { return store.MovePlan( moved, where.Project ); } );
				}
			}
		}
		send_result( response, result, 200, { Project: result.Project } );
	} );


	// A copy of a plan or document is whole (text, threads, revisions) under a new id; a folder's copy holds a
	// copy of everything in it, and a plan's copy a copy of its Subplans, with new ids throughout. The Context
	// folder and the Readme are not copied.
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
		let copy = await copy_node( found.Node, where.Project );
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


	// The copy of one node and everything under it, into the project (its folder), or a refusal.
	async function copy_node( node, project_id )
	{
		if ( node.Kind === 'folder' )
		{
			let folder = { Kind: 'folder', Id: new_id( IDS.FOLDER ), Name: node.Name, Items: [] };
			for ( let child of node.Items )
			{
				let copied = await copy_node( child, project_id );
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
			let plan = await store.Queue( node.Id, function () { return store.CopyPlan( node.Id, project_id ); } );
			if ( !plan )
			{
				return refused( 404, 'no such plan: ' + node.Id );
			}
			changed( plan.Id, 'created' );
			let copied = { Kind: node.Kind, Id: plan.Id };
			if ( Array.isArray( node.Items ) && node.Items.length )
			{
				copied.Items = [];
				for ( let child of node.Items )
				{
					let subplan = await copy_node( child, project_id );
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
	// Archive (plan Run Shapes, Step 2): a plan, with its Subplans, leaves the tree for the project's Archive, where it
	// is read and never written, until Restore puts it back at the root.

	router.post( '/items/:id/archive', async function ( request, response )
	{
		let id = request.params.id;
		let holder = await store.ProjectOf( id );
		if ( !holder )
		{
			return fail( response, 404, 'no such item in any project' );
		}
		if ( is_context_item( holder, id ) )
		{
			return fail( response, 409, CONTEXT_KEPT );
		}
		let node = null;
		let result = await change_project( holder.Id, null, function ( project )
		{
			let found = TREE.Find( project.Items, id );
			if ( !found )
			{
				return refused( TREE.Find( project.Archive, id ) ? 409 : 404, TREE.Find( project.Archive, id ) ? 'the item is archived already' : 'no such item in the project' );
			}
			if ( found.Node.Kind !== 'plan' )
			{
				return refused( 409, 'only a plan is archived' );
			}
			node = TREE.Remove( project.Items, id );
			project.Archive.push( node );
		} );
		if ( result.Refused )
		{
			return send_result( response, result );
		}
		for ( let archived of plan_ids_of( node ) )
		{
			await store.Queue( archived, function () { return store.ArchivePlan( archived ); } );
			changed( archived, 'archived' );
		}
		response.json( { Project: result.Project, Node: node } );
	} );


	router.post( '/items/:id/restore', async function ( request, response )
	{
		let id = request.params.id;
		let holder = await store.ProjectOf( id );
		if ( !holder )
		{
			return fail( response, 404, 'no such item in any project' );
		}
		let node = null;
		let result = await change_project( holder.Id, null, function ( project )
		{
			let index = project.Archive.findIndex( function ( candidate ) { return candidate.Id === id; } );
			if ( index < 0 )
			{
				return refused( TREE.Find( project.Archive, id ) ? 409 : 404, TREE.Find( project.Archive, id ) ? 'a Subplan is restored with its plan' : 'the item is not archived' );
			}
			node = project.Archive.splice( index, 1 )[ 0 ];
			TREE.Insert( project.Items, null, node, undefined, project.ContextFolder );
		} );
		if ( result.Refused )
		{
			return send_result( response, result );
		}
		for ( let restored of plan_ids_of( node ) )
		{
			await store.Queue( restored, function () { return store.RestorePlan( restored ); } );
			changed( restored, 'restored' );
		}
		response.json( { Project: result.Project, Node: node } );
	} );


	//-----------------------------------------------------------------
	// Revisions: the record.

	router.get( '/plans/:id/revisions', async function ( request, response )
	{
		let read = await store.ReadPlan( request.params.id );
		if ( !read )
		{
			return fail( response, 404, 'no such plan' );
		}
		response.json( { Revisions: await store.ListRevisions( request.params.id ) } );
	} );


	router.get( '/plans/:id/revisions/:n', async function ( request, response )
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

	router.get( '/plans/:id/threads', async function ( request, response )
	{
		let read = await store.ReadPlan( request.params.id );
		if ( !read )
		{
			return fail( response, 404, 'no such plan' );
		}
		let name = request.Participant;
		let filtered = RULES.Filter( read.Threads, request.query.status, speakers( read.Threads, name ), name.Speaker );
		if ( !filtered )
		{
			return fail( response, 400, 'unknown status filter "' + request.query.status + '"' );
		}
		response.json( { Threads: present_threads( filtered, read.Text, name ) } );
	} );


	// A new thread: the first reply is the comment. Anchor is { Text, Prefix?, Suffix? } or null for the whole document.
	// With Resolve (the owner's Comment and resolve), it is posted resolved, the comment being its outcome.
	router.post( '/plans/:id/threads', async function ( request, response )
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


	// A new thread on a plan, on Anchor ({ Text, Prefix?, Suffix? }, found in the text) or the whole document.
	// With Resolve (the owner's Comment and resolve), resolved as it is posted. Returns { Thread } or a refusal.
	async function create_thread( id, participant, text, anchor_given, resolve )
	{
		let result = await store.Queue( id, async function ()
		{
			let read = await store.ReadPlan( id );
			if ( !read )
			{
				return refused( 404, 'no such plan' );
			}
			if ( is_document( read.Plan ) )
			{
				return refused( 409, 'a Document has no threads' );
			}
			let anchor = null;
			if ( anchor_given )
			{
				anchor = place_anchor( anchor_given, read.Text );
				if ( !anchor )
				{
					return refused( 400, 'the anchor text was not found in the plan' );
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
				Replies: [ Object.assign( { Id: new_id( IDS.REPLY ) }, RULES.Stamp( participant, at ), { Text: text } ) ],
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
			await store.UpdatePlan( id, {} );
			return { Thread: present_threads( [ thread ], read.Text, participant )[ 0 ] };
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
			let read = await store.ReadPlan( id );
			if ( !read )
			{
				return refused( 404, 'no such plan' );
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
			thread.Replies.push( Object.assign( { Id: new_id( IDS.REPLY ) }, RULES.Stamp( participant, now() ), { Text: text } ) );
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
			await store.UpdatePlan( id, {} );
			return { Thread: present_threads( [ thread ], read.Text, participant )[ 0 ], Reopened: effect.Reopen, Resolved: !!resolve };
		} );
		if ( !result.Refused )
		{
			let kind = result.Resolved ? 'resolved' : ( result.Reopened ? 'reopened' : 'reply' );
			changed( id, kind, result.Thread.Id );
			if ( result.Resolved )
			{
				let record = await after_resolve( id, result.Thread );
				if ( record )
				{
					result.Thread.Git = record;
				}
			}
		}
		return result;
	}


	// Body = { Text, Resolve? }  Resolve: true is the owner's Reply and resolve.
	router.post( '/plans/:id/threads/:tid/replies', async function ( request, response )
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
	router.post( '/plans/:id/threads/:tid/anchor', async function ( request, response )
	{
		let body = request.body || {};
		let id = request.params.id;
		let result = await store.Queue( id, async function ()
		{
			let read = await store.ReadPlan( id );
			if ( !read )
			{
				return fail( response, 404, 'no such plan' );
			}
			let thread = read.Threads.find( function ( candidate ) { return candidate.Id === request.params.tid; } );
			if ( !thread )
			{
				return fail( response, 404, 'no such thread' );
			}
			let anchor = place_anchor( body.Anchor, read.Text );
			if ( !anchor )
			{
				return fail( response, 400, 'the anchor text was not found in the plan' );
			}
			thread.Anchor = anchor;
			thread.Detached = false;
			await store.WriteThreads( id, read.Threads );
			return present_threads( [ thread ], read.Text, request.Participant )[ 0 ];
		} );
		if ( !result )
		{
			return;
		}
		changed( id, 'anchored', result.Id );
		response.json( { Thread: result } );
	} );


	// Resolve: owner only, contested threads only. Resolving accepts the outcome stated in the last reply.
	router.post( '/plans/:id/threads/:tid/resolve', async function ( request, response )
	{
		let id = request.params.id;
		let result = await store.Queue( id, async function ()
		{
			let read = await store.ReadPlan( id );
			if ( !read )
			{
				return fail( response, 404, 'no such plan' );
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
			return present_threads( [ thread ], read.Text, request.Participant )[ 0 ];
		} );
		if ( !result )
		{
			return;
		}
		changed( id, 'resolved', result.Id );
		let record = await after_resolve( id, result );
		if ( record )
		{
			result.Git = record;
		}
		response.json( { Thread: result } );
	} );


	// The Work options (plan LLM Tasks, Step 3): a build log the owner resolves is committed when the project's
	// AutoCommit is on (git add -A, git commit: the plan's title the subject, the log's opening reply the body) and
	// pushed after when its GitSync is on; the thread keeps the record as Git. A build log is a whole-document thread
	// opened by a run of a task with Writes files on this plan: the opening reply's Service and Token name match a
	// run record of the plan. A failure leaves the resolve standing. Returns the record, or null when nothing applies.
	async function after_resolve( id, thread )
	{
		if ( !git || !runs || thread.Anchor || !thread.Replies.length )
		{
			return null;
		}
		let opener = thread.Replies[ 0 ];
		if ( !opener.Service || !opener.Token )
		{
			return null;
		}
		let run = runs.List().find( function ( record )
		{
			return record.Plan && record.Plan.Id === id && record.Writes === 'files' && record.Service === opener.Service && record.Token === opener.Token;
		} );
		if ( !run )
		{
			return null;
		}
		let project = await store.ProjectOf( id );
		if ( !project || !project.AutoCommit || !project.Path )
		{
			return null;
		}
		let read = await store.ReadPlan( id );
		let message = read.Plan.Title + '\n\n' + String( opener.Text || '' ).trim() + '\n';
		let committed = await git.Commit( project.Path, message );
		let record = { Commit: committed.Commit, Branch: committed.Branch, Pushed: null, Error: committed.Ok ? null : last_lines( committed.Output ), At: now() };
		if ( committed.Ok && committed.Commit && project.GitSync )
		{
			let pushed = await git.Push( project.Path );
			record.Pushed = pushed.Ok;
			if ( !pushed.Ok )
			{
				record.Error = 'push failed: ' + last_lines( pushed.Output );
			}
		}
		await store.Queue( id, async function ()
		{
			let again = await store.ReadPlan( id );
			let kept = again ? find_thread( again, thread.Id ) : null;
			if ( kept )
			{
				kept.Git = record;
				await store.WriteThreads( id, again.Threads );
			}
		} );
		changed( id, 'committed', thread.Id );
		return record;
	}


	// The last lines of git's words, for the record.
	function last_lines( text )
	{
		let lines = String( text || '' ).trim().split( /\r?\n/ );
		return lines.slice( -3 ).join( ' ' ) || 'no output';
	}


	// Delete: owner only, any thread. The revisions that applied it keep their text and their Thread id.
	router.delete( '/plans/:id/threads/:tid', async function ( request, response )
	{
		let id = request.params.id;
		let result = await store.Queue( id, async function ()
		{
			let read = await store.ReadPlan( id );
			if ( !read )
			{
				return fail( response, 404, 'no such plan' );
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
			await store.UpdatePlan( id, {} );
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
	// Anchor, when given, points the thread at the passage the change produced. Returns { Thread, Plan } or
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
			let read = await store.ReadPlan( id );
			if ( !read )
			{
				return refused( 404, 'no such plan' );
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
			let plan = read.Plan;
			let changed_text = ( typeof body.Text === 'string' && body.Text !== read.Text );
			let text = changed_text ? body.Text : read.Text;
			if ( changed_text && body.Revision !== plan.Revision )
			{
				return refused( 409, 'the text changed since revision ' + body.Revision + '; reload and apply again', { Revision: plan.Revision } );
			}
			// The anchor is placed in the text it will point into before anything is written, so a refusal leaves
			// the plan as it was.
			let anchor = body.Anchor ? place_anchor( body.Anchor, text ) : null;
			if ( body.Anchor && !anchor )
			{
				return refused( 400, 'the anchor text was not found in the plan' );
			}
			if ( changed_text )
			{
				plan = await store.WriteText( id, { Text: body.Text, By: participant.Name, Service: participant.Service, Token: participant.Token, Reason: 'apply', Thread: thread.Id } );
				refind( read.Threads, text );
			}
			if ( anchor )
			{
				thread.Anchor = anchor;
				thread.Detached = false;
			}
			Object.assign( thread, RULES.ApplyEffect( participant, now(), plan.Revision, plan.Head || null, outcome ) );
			await store.WriteThreads( id, read.Threads );
			return { Thread: present_threads( [ thread ], text, participant )[ 0 ], Plan: summarize( plan, read.Threads, participant ) };
		} );
		if ( !result.Refused )
		{
			changed( id, 'applied', result.Thread.Id );
		}
		return result;
	}


	router.post( '/plans/:id/threads/:tid/apply', async function ( request, response )
	{
		let result = await apply_outcome( request.params.id, request.params.tid, request.Participant, request.body || {} );
		if ( result.Refused )
		{
			return fail( response, result.Refused.Status, result.Refused.Error, result.Refused.Extra );
		}
		response.json( result );
	} );


	//-----------------------------------------------------------------
	// Waiting: everything waiting on the caller, across plans.

	router.get( '/waiting', async function ( request, response )
	{
		let name = request.Participant;
		let waiting = [];
		for ( let plan of await store.ListPlans() )
		{
			let read = await store.ReadPlan( plan.Id );
			if ( !read )
			{
				continue;
			}
			let threads = RULES.WaitingOn( name.Speaker, read.Threads, speakers( read.Threads, name ) );
			for ( let thread of present_threads( threads, read.Text, name ) )
			{
				waiting.push( { Plan: { Id: plan.Id, Title: plan.Title, State: plan.State, Revision: plan.Revision }, Thread: thread } );
			}
		}
		response.json( { Me: PARTICIPANTS.Public( request.Participant ), Waiting: waiting } );
	} );


	//-----------------------------------------------------------------
	// The LLM connections (plan Run Shapes, Step 3): the settings' Llms, each a tool a run goes through, its posts
	// reading "<Name> by <owner>" (plan User Management, Step 2). Everyone sees the list (its public part); the owner
	// writes it and sees the whole records. A connection's Check runs its command or asks its Ollama, saved or not.

	function llm_running( llm )
	{
		return runs ? runs.Running( llm.Id ) : null;
	}


	function present_llm( llm, request )
	{
		let shown = LLMS.Public( llm, settings, request.Participant.Role === 'owner' );
		shown.Running = llm_running( llm );
		return shown;
	}


	function owner_only( request, response )
	{
		if ( request.Participant.Role !== 'owner' )
		{
			fail( response, 403, 'only the owner changes the LLM connections' );
			return false;
		}
		return true;
	}


	function llm_of( request, response )
	{
		let llm = LLMS.ById( settings, request.params.id );
		if ( !llm )
		{
			fail( response, 404, 'no LLM connection with the id ' + request.params.id );
		}
		return llm;
	}


	function body_of( request )
	{
		return ( request.body && typeof request.body === 'object' ) ? request.body : {};
	}


	// A connection saved: the body's fields over the record (a new one: over the defaults, with a new id),
	// filled and checked with the rest; a new one goes to the end of the list.
	async function save_llm( request, response, existing )
	{
		let given = body_of( request );
		let filled = existing ? LLMS.Fill( Object.assign( {}, existing, given, { Id: existing.Id } ) ) : LLMS.Fill( Object.assign( {}, given, { Id: undefined } ) );
		let list = ( settings.Llms || [] ).filter( function ( one ) { return one.Id !== filled.Id; } );
		let index = ( settings.Llms || [] ).findIndex( function ( one ) { return one.Id === filled.Id; } );
		list.splice( ( index < 0 ) ? list.length : index, 0, filled );
		let problems = LLMS.Problems( Object.assign( {}, settings, { Llms: list } ) );
		if ( problems.length )
		{
			return fail( response, 400, problems.join( '; ' ), { Problems: problems } );
		}
		settings.Llms = list;
		await store.WriteSettings( settings );
		events.Send( { Kind: 'llms', Llm: filled.Id } );
		response.status( existing ? 200 : 201 ).json( { Llm: present_llm( filled, request ) } );
	}


	// The tasks (plan LLM Tasks, Step 1): the server's list in the buttons' order, or those a project enables with
	// ?Project=; the levels, the switches and the shipped defaults for the Settings popup.
	router.get( '/tasks', async function ( request, response )
	{
		let project = request.query.Project ? await store.ReadProject( request.query.Project ) : null;
		if ( request.query.Project && !project )
		{
			return fail( response, 404, 'no project with the id ' + request.query.Project );
		}
		response.json( { Tasks: project ? TASKS.Enabled( settings, project ) : ( settings.Tasks || [] ), Writes: TASKS.WRITES, Package: TASKS.PACKAGE_ITEMS, Defaults: TASKS.Defaults() } );
	} );


	router.get( '/llms', function ( request, response )
	{
		let llms = ( settings.Llms || [] ).map( function ( llm ) { return present_llm( llm, request ); } );
		response.json( { Llms: llms, Kinds: LLMS.KINDS, DefaultPrompts: LLMS.DEFAULT_PROMPTS, Runs: !!runner } );
	} );


	router.post( '/llms', async function ( request, response )
	{
		if ( !owner_only( request, response ) )
		{
			return;
		}
		await save_llm( request, response, null );
	} );


	// Check of a connection as typed, saved or not: { Ok, Result } or { Ok: false, Error }.
	router.post( '/llms/check', async function ( request, response )
	{
		if ( !owner_only( request, response ) )
		{
			return;
		}
		response.json( await LLM.Check( LLMS.Fill( body_of( request ) ) ) );
	} );


	router.put( '/llms/:id', async function ( request, response )
	{
		if ( !owner_only( request, response ) )
		{
			return;
		}
		let llm = llm_of( request, response );
		if ( llm )
		{
			await save_llm( request, response, llm );
		}
	} );


	router.post( '/llms/:id/check', async function ( request, response )
	{
		if ( !owner_only( request, response ) )
		{
			return;
		}
		let llm = llm_of( request, response );
		if ( llm )
		{
			response.json( await LLM.Check( LLMS.Fill( Object.assign( {}, llm, body_of( request ), { Id: llm.Id } ) ) ) );
		}
	} );


	router.delete( '/llms/:id', async function ( request, response )
	{
		if ( !owner_only( request, response ) )
		{
			return;
		}
		let llm = llm_of( request, response );
		if ( !llm )
		{
			return;
		}
		if ( llm_running( llm ) )
		{
			return fail( response, 409, 'the connection "' + llm.Name + '" is running; stop it first' );
		}
		settings.Llms = settings.Llms.filter( function ( one ) { return one.Id !== llm.Id; } );
		await store.WriteSettings( settings );
		events.Send( { Kind: 'llms', Llm: llm.Id } );
		response.json( { Deleted: llm.Id } );
	} );


	//-----------------------------------------------------------------
	// The runs (plan Run Shapes, Step 3): a one-shot asked of a connection by the presser, run by this server in the
	// project's folder as the presser through the connection (Runner.js, Runs.js); the records are read by everyone.
	// A run's start, progress and end go out as { Kind: run } events.

	function may_run( request, response )
	{
		if ( !runner || !runs )
		{
			fail( response, 503, 'this server runs no LLMs' );
			return false;
		}
		return true;
	}


	// The packaging popup's lists: the other Context documents of the project, the plan's threads waiting on the
	// connection (query Project, Plan, Llm).
	router.get( '/runs/lists', async function ( request, response )
	{
		if ( !runner )
		{
			return fail( response, 503, 'this server runs no LLMs' );
		}
		let made = await runner.Lists( { Project: request.query.Project, Plan: request.query.Plan, Llm: request.query.Llm } );
		if ( made.Error )
		{
			return fail( response, 400, made.Error );
		}
		response.json( made );
	} );


	// The prompt a run would get: { Llm, Task, Project, Plan?, Text?, Overrides? } (Text the person's instructions for a
	// task with a Box; Overrides the popup's unsaved fields of the connection).
	router.post( '/runs/package', async function ( request, response )
	{
		if ( !may_run( request, response ) )
		{
			return;
		}
		let made = await runner.Package( body_of( request ) );
		if ( made.Error )
		{
			return fail( response, 400, made.Error );
		}
		response.json( { Prompt: made.Prompt, Speaker: made.Speaker, Task: made.Task, Text: made.Text, Project: made.Project, Plan: made.Plan, Folder: made.Folder ? made.Folder.Path : null } );
	} );


	// A run started: { Llm, Task, Project, Plan?, Text? }; its record, with Status running, comes back at once.
	router.post( '/runs', async function ( request, response )
	{
		if ( !may_run( request, response ) )
		{
			return;
		}
		let started = await runner.Start( body_of( request ), request.Participant.Name );
		if ( started.Error )
		{
			return fail( response, started.Status || 400, started.Error );
		}
		response.status( 201 ).json( { Run: started.Run } );
	} );


	// The summaries, newest first; of one connection with ?Llm=, with its running one.
	router.get( '/runs', function ( request, response )
	{
		if ( !runs )
		{
			return fail( response, 503, 'this server runs no LLMs' );
		}
		let llm_id = request.query.Llm || undefined;
		response.json( { Runs: runs.List( llm_id ), Running: llm_id ? runs.Running( llm_id ) : null } );
	} );


	router.get( '/runs/:id', function ( request, response )
	{
		let run = ( runs && /^[a-z0-9-]+$/.test( request.params.id ) ) ? runs.Read( request.params.id ) : null;
		if ( !run )
		{
			return fail( response, 404, 'no run with the id ' + request.params.id );
		}
		response.json( { Run: run } );
	} );


	router.post( '/runs/:id/stop', function ( request, response )
	{
		if ( !may_run( request, response ) )
		{
			return;
		}
		if ( !runs.Stop( request.params.id ) )
		{
			return fail( response, 404, 'no running run with the id ' + request.params.id );
		}
		response.json( { Stopped: true } );
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
