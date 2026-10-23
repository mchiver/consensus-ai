'use strict';

// Operations - every operation of Consensus defined once and performed by one function (plan MCP Server, Step 1).
// The REST API (Api.js), the MCP server and the run's tools are faces of this one definition: none has an operation
// of its own. Every rule lives here or in Rules.js, none in a client. Writes to one plan run through the store's queue.
// The server holds the core of Consensus only (plan Consensus Desktop, Step 1): projects and their trees, plans with
// their threads and revisions, documents, the turn (waiting), export and import, and the settings. The LLM takes part
// through the operations as a participant, from wherever it runs. Plan Run Shapes, Step 3: the server runs the LLMs
// too: the connections (each a participant of this server) and the runs are operations here, over Llms.js, Runner.js
// and Runs.js. Each project has a Context folder (project.ContextFolder), first in its tree, holding its Readme
// (project.Context) and any other document: a document goes nowhere else, and that folder holds nothing else. Neither
// the folder nor the Readme is renamed, moved, copied or deleted.
//
//   Operations( Context ) -> { List, Get( Name ), Perform( Name, Participant, Arguments ), Shared }
//     Context = { Store, Settings, Events, Runs?, Runner?, Git?, Tokens?, Users?, Clerk? }, as Api.Attach takes it
//     List: the operations, each { Name, Method, Path, Description, Parameters, Action, Status, Perform }:
//       Name        the operation's name, lower_case (read_plan, reply, apply, set_state, create_project ...)
//       Method/Path the REST route it is served at (the path's :params are arguments too, by the names Api.js maps)
//       Description one or two sentences a model can read
//       Parameters  { Field: { Type, Required?, Description? } }: the arguments, by name
//       Action      what Roles.js checks it against (read, write, resolve, state, manage, roles, press, admin, self,
//                   list, open), from the route table, so the two cannot drift
//       Status      the status a plain answer is sent with (200 unless the operation creates something: 201)
//       Perform( Participant, Arguments ) -> the JSON the route answers, or an Answer (below); throws a Refusal
//     Perform( Name, Participant, Arguments ): the same, by name; an unknown name is a Refusal 404
//     Shared: { RolesOf, NeededPlan, ClearRoles }, what the API's identify and Clerk's webhook need of this module
//   Refusal( Status, Message, Extra? )   the error an operation throws: { Status, Error, Extra }; the route sends it
//   Answer( Status, Body, Type? )        an answer with its own status, or a text with a content type (the reports)
//   IsRefusal( error ), IsAnswer( value )

const RULES = require( './Rules.js' );
const ANCHORS = require( './Anchors.js' );
const PARTICIPANTS = require( './Participants.js' );
const TREE = require( './Tree.js' );
const PORT = require( './ProjectPort.js' );
const IDS = require( './Ids.js' );
const LLMS = require( './Llms.js' );
const TASKS = require( './Tasks.js' );
const ROLES = require( './Roles.js' );
const LLM = require( './Llm.js' );
const REPORT = require( './Report.js' );
const VERSION = require( '../package.json' ).version;

const ACTIVITY_LIMIT = 200;	// the entries an account's activity page lists
const PARENT_REFUSED = 'Parent is not a folder of the project, or a plan (which holds plans only); a document goes in the Context folder, which holds documents only';
const CONTEXT_KEPT = 'the Context folder and its Readme stay as they are: never renamed, moved, copied or deleted';
const RUN_ID = /^[a-z0-9-]+$/;


//---------------------------------------------------------------------
// Refusal: what an operation throws when it will not do what was asked. Status the HTTP status the route answers,
// Error the sentence, Extra more fields for the answer ({ Revision }, { Problems }, { Plan } ...).

class Refusal extends Error
{
	constructor( Status, Message, Extra )
	{
		super( Message );
		this.Status = Status;
		this.Error = Message;
		this.Extra = Extra || null;
	}
}


function IsRefusal( error )
{
	return error instanceof Refusal;
}


// Answer: a result that is not the plain JSON at the operation's Status: another status (a project opened rather
// than created), or a text with a content type (the reports).
function Answer( Status, Body, Type )
{
	return { Answer: true, Status: Status, Body: Body, Type: Type || null };
}


function IsAnswer( value )
{
	return !!value && value.Answer === true && typeof value.Status === 'number';
}


//---------------------------------------------------------------------
// Operations( Context ): the definition and the implementation over the store, the settings and the rest.

function Operations( Context )
{
	let store = Context.Store;
	let settings = Context.Settings;
	let events = Context.Events;
	let runs = Context.Runs || null;
	let runner = Context.Runner || null;
	let git = Context.Git || null;
	let users = Context.Users || null;
	let list = [];
	let by_name = {};


	// define: one operation into the list, its Action read from the route table over a sample of its path (every
	// :param an id that matches each pattern, run-x), so the action is the one the API checks.
	function define( operation )
	{
		if ( by_name[ operation.Name ] )
		{
			throw new Error( 'the operation ' + operation.Name + ' is defined twice' );
		}
		let sample = operation.Path.replace( /:[a-z]+/g, 'run-x' );
		operation.Action = ROLES.Rule( operation.Method, sample ).Action;
		operation.Status = operation.Status || 200;
		operation.Parameters = operation.Parameters || {};
		list.push( operation );
		by_name[ operation.Name ] = operation;
	}


	function Get( Name )
	{
		return by_name[ Name ] || null;
	}


	async function Perform( Name, Participant, Arguments )
	{
		let operation = Get( Name );
		if ( !operation )
		{
			throw new Refusal( 404, 'no such operation: ' + Name );
		}
		return await operation.Perform( Participant, Arguments || {} );
	}


	//-----------------------------------------------------------------
	// Helpers

	// refuse: the operation stops here with a Refusal.
	function refuse( status, message, extra )
	{
		throw new Refusal( status, message, extra );
	}


	// A refusal from a function the operations share, as a value: sent() turns it into a Refusal.
	function refused( status, message, extra )
	{
		return { Refused: { Status: status, Error: message, Extra: extra } };
	}


	function sent( result )
	{
		if ( result && result.Refused )
		{
			throw new Refusal( result.Refused.Status, result.Refused.Error, result.Refused.Extra );
		}
		return result;
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


	function string_of( value )
	{
		return ( value === undefined || value === null ) ? '' : String( value );
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


	function is_admin( account )
	{
		return !!account && ( account.Role === 'owner' || account.Admin === true );
	}


	function may_see( account, id )
	{
		return is_admin( account ) || ( !!account && account.Id === id );
	}


	// The projects an account sees: every one for the owner and the Administrator, else those with a role; and the
	// ids of the plans in them (null when every plan).
	async function visible_projects( account )
	{
		let projects = await store.ListProjects();
		if ( is_admin( account ) )
		{
			return projects;
		}
		return projects.filter( function ( project ) { return !!ROLES.RoleOf( project, account.Id ); } );
	}


	async function visible_plan_ids( account )
	{
		if ( is_admin( account ) )
		{
			return null;
		}
		let ids = new Set();
		for ( let project of await visible_projects( account ) )
		{
			for ( let id of TREE.ItemIds( project.Items || [] ).concat( TREE.ItemIds( project.Archive || [] ) ) )
			{
				ids.add( id );
			}
			if ( project.Context )
			{
				ids.add( project.Context );
			}
		}
		return ids;
	}


	// An account's roles by project id, for me; empty for the owner, who needs none.
	async function roles_of( account )
	{
		let roles = {};
		if ( account.Role === 'owner' )
		{
			return roles;
		}
		for ( let project of await store.ListProjects() )
		{
			let role = ROLES.RoleOf( project, account.Id );
			if ( role )
			{
				roles[ project.Id ] = role;
			}
		}
		return roles;
	}


	// The plan a person's roles need (plan Clerk, Step 5): Host for the Administrator, User for an Owner or a Member
	// of any project, none for a Watcher or someone placed nowhere; the owner of a Local server needs none.
	async function needed_plan( account )
	{
		if ( account.Type === 'owner' )
		{
			return null;
		}
		if ( account.Admin )
		{
			return 'Host';
		}
		let roles = await roles_of( account );
		for ( let project_id of Object.keys( roles ) )
		{
			if ( ROLES.PlanFor( roles[ project_id ] ) )
			{
				return ROLES.PlanFor( roles[ project_id ] );
			}
		}
		return null;
	}


	// An account out of every project's role folders (an account deleted, or removed by Clerk).
	async function clear_roles( account_id )
	{
		for ( let project of await store.ListProjects() )
		{
			if ( ROLES.RoleOf( project, account_id ) )
			{
				await change_project( project.Id, undefined, async function ( held )
				{
					let roles = ROLES.Clean( held.Roles );
					for ( let role of ROLES.ROLES )
					{
						roles[ role ] = roles[ role ].filter( function ( id ) { return id !== account_id; } );
					}
					held.Roles = roles;
				} );
			}
		}
	}


	// The speakers the rules run over (Participants.SeenSpeakers): the owner, one per LLM connection, the Owners of the
	// plan's project (plan Multiuser), and everyone seen in the threads given.
	async function speakers( plan_id, threads, account )
	{
		return PARTICIPANTS.SeenSpeakers( settings, threads || [], account || null, await owners_of( plan_id ) );
	}


	// The accounts in the Owners folder of the project holding a plan, each { Name, Display }; none without a registry.
	async function owners_of( plan_id )
	{
		let project = plan_id ? await store.ProjectOf( plan_id ) : null;
		if ( !project || !users )
		{
			return [];
		}
		let owners = [];
		for ( let id of ROLES.Clean( project.Roles ).Owners )
		{
			let record = users.Get( id );
			if ( record )
			{
				owners.push( { Name: record.Login, Display: record.Display || record.Login } );
			}
		}
		return owners;
	}


	//-----------------------------------------------------------------
	// Views: what a plan looks like to the account asking.

	async function present_threads( plan_id, threads, text, account )
	{
		let plain = ANCHORS.PlainText( text );
		let name = account.Speaker;
		let all = await speakers( plan_id, threads, account );
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


	async function summarize( plan, threads, account )
	{
		let tally = RULES.Tally( plan, threads, await speakers( plan.Id, threads, account ) );
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

	define( {
		Name: 'me',
		Method: 'GET',
		Path: '/me',
		Description: 'Who you are to this server: your account, your roles by project, the speakers the rules run over, the default states and the server\'s version and name.',
		Parameters: {},
		Perform: async function ( participant )
		{
			let account = ( users && participant.Id ) ? users.Public( users.Get( participant.Id ), false ) : null;
			return { Me: PARTICIPANTS.Public( participant ), Account: account, Admin: is_admin( participant ), Roles: await roles_of( participant ), Participants: await speakers( null, [], participant ), States: states(), Version: VERSION, Server: settings.Name || null };
		},
	} );


	//-----------------------------------------------------------------
	// Settings: consensus.json, read whole and written by the Administrator (the settings modal; the owner on a Local
	// server): the server's fields (Name, Port, Scope, States, Owner, Clerk, Tasks) replace what the file has, and any
	// other field (the desktop's, plan Run Shapes) stays as it is. Everything applies at once but Scope and Port, which
	// take effect at the next start; the answer says when a restart is needed.

	define( {
		Name: 'read_settings',
		Method: 'GET',
		Path: '/settings',
		Description: 'The server\'s settings file, whole, and its path; the Administrator\'s.',
		Parameters: {},
		Perform: async function ( participant )
		{
			if ( !is_admin( participant ) )
			{
				refuse( 403, 'only the Administrator reads the settings' );
			}
			return { Settings: settings, Path: store.SettingsPath() };
		},
	} );


	define( {
		Name: 'write_settings',
		Method: 'PUT',
		Path: '/settings',
		Description: 'Writes the server\'s settings (Name, Port, Scope, States, Owner, Tasks, Llms; the Administrator\'s): the fields given replace the file\'s, any other field stays. Answers whether a restart is needed (Scope and Port take effect at the next start).',
		Parameters: {
			Settings: { Type: 'object', Description: 'the settings to write; the fields may also be given at the top level' },
		},
		Perform: async function ( participant, args )
		{
			if ( !is_admin( participant ) )
			{
				refuse( 403, 'only the Administrator writes the settings' );
			}
			let body = args || {};
			let clean = PARTICIPANTS.Clean( body.Settings || body );
			// The Clerk section is the file's since 2026-10-20 (it left the Settings popup): a body without one keeps it.
			if ( ( body.Settings || body ).Clerk === undefined && settings.Clerk !== undefined )
			{
				clean.Clerk = settings.Clerk;
			}
			let problems = PARTICIPANTS.Validate( clean );
			if ( problems.length )
			{
				refuse( 400, 'the settings have problems: ' + problems[ 0 ], { Problems: problems } );
			}
			let before = { Scope: PARTICIPANTS.Scope( settings ), Port: settings.Port };
			// Plan Clerk, Step 5: a server goes Public from a session with a Host license alone.
			if ( clean.Scope === 'Public' && before.Scope !== 'Public' && ROLES.PlanRank( participant.Plan ) < ROLES.PlanRank( 'Host' ) )
			{
				refuse( 403, 'a Host license is required to run a Public server: sign in with one first', { Plan: 'Host' } );
			}
			for ( let field of PARTICIPANTS.SETTINGS_FIELDS )
			{
				delete settings[ field ];
			}
			Object.assign( settings, clean );
			PARTICIPANTS.Migrate( settings );
			let restart = ( settings.Scope !== before.Scope ) || ( settings.Port !== before.Port );
			await store.WriteSettings( settings );
			events.Send( { Settings: true, Kind: 'settings' } );
			return { Settings: settings, Restart: restart };
		},
	} );


	//-----------------------------------------------------------------
	// Plans

	define( {
		Name: 'list_plans',
		Method: 'GET',
		Path: '/plans',
		Description: 'Every plan and document you may see, across projects, each with its state and the tally of its threads; State keeps the plans in that state.',
		Parameters: {
			State: { Type: 'string', Description: 'only the plans in this state' },
		},
		Perform: async function ( participant, args )
		{
			let plans = await store.ListPlans();
			let state = args.State;
			let visible = await visible_plan_ids( participant );
			let result = [];
			for ( let plan of plans )
			{
				if ( state && plan.State !== state )
				{
					continue;
				}
				if ( visible && !visible.has( plan.Id ) )
				{
					continue;
				}
				let read = await store.ReadPlan( plan.Id );
				result.push( await summarize( plan, read ? read.Threads : [], participant ) );
			}
			return { Plans: result };
		},
	} );


	define( {
		Name: 'create_plan',
		Method: 'POST',
		Path: '/plans',
		Status: 201,
		Description: 'A new plan, or a document (Kind document), in a project: at Parent (a folder, or a plan for a Subplan), else at the project\'s root (a document: in its Context folder). A plan starts in the project\'s first state unless State says otherwise.',
		Parameters: {
			Title: { Type: 'string', Required: true },
			Text: { Type: 'string', Description: 'the markdown; empty when not given' },
			Project: { Type: 'string', Description: 'the project\'s id; the first project when not given' },
			Parent: { Type: 'string', Description: 'a folder\'s id, or a plan\'s id for a Subplan' },
			Kind: { Type: 'string', Description: 'plan (the default) or document' },
			State: { Type: 'string', Description: 'one of the project\'s states; an Owner\'s to give' },
		},
		Perform: async function ( participant, args )
		{
			let body = args || {};
			let title = text_of( body.Title ).trim();
			if ( !title )
			{
				refuse( 400, 'Title is required' );
			}
			let kind = ( body.Kind === undefined ) ? 'plan' : body.Kind;
			if ( kind !== 'plan' && kind !== 'document' )
			{
				refuse( 400, 'Kind must be plan or document' );
			}
			if ( kind === 'document' && body.State !== undefined && body.State !== null )
			{
				refuse( 400, 'a Document has no State' );
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
			let result = sent( await create_plan( participant, { Title: title, Text: text_of( body.Text ), Kind: kind, State: body.State, Project: project_id, Parent: parent } ) );
			return { Plan: await summarize( result.Plan, [], participant ), Project: result.Project };
		},
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
			let may = RULES.MaySetState( participant );
			if ( !may.Ok )
			{
				return refused( 403, may.Reason );
			}
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


	define( {
		Name: 'read_plan',
		Method: 'GET',
		Path: '/plans/:id',
		Description: 'A plan or document whole: its text at its current revision, its summary with the tally of its threads, its threads with their status, anchor and replies, its project, and whether it is the project\'s Readme (Context).',
		Parameters: {
			Id: { Type: 'string', Required: true, Description: 'the plan\'s or document\'s id' },
		},
		Perform: async function ( participant, args )
		{
			let id = string_of( args.Id );
			let read = await store.ReadPlan( id );
			if ( !read )
			{
				refuse( 404, 'no such plan' );
			}
			let holder = await store.ProjectOf( id );
			return {
				Me: PARTICIPANTS.Public( participant ),
				Participants: await speakers( id, read.Threads, participant ),
				Project: holder ? { Id: holder.Id, Name: holder.Name } : null,
				Context: !!( holder && holder.Context === id ),
				Plan: await summarize( read.Plan, read.Threads, participant ),
				Text: read.Text,
				Threads: await present_threads( id, read.Threads, read.Text, participant ),
			};
		},
	} );


	// The report (plan Printing and Reporting): the plan, its Subplans and all their threads as one page made for
	// printing, or the same as markdown; any participant reads it, as they read the plan.
	define( {
		Name: 'report',
		Method: 'GET',
		Path: '/plans/:id/report',
		Description: 'The plan, its Subplans and all their threads as one HTML page made for printing: the passages marked and numbered, every reply with who and when.',
		Parameters: {
			Id: { Type: 'string', Required: true, Description: 'the plan\'s id' },
		},
		Perform: async function ( participant, args )
		{
			return await make_report( string_of( args.Id ), 'html' );
		},
	} );


	define( {
		Name: 'report_markdown',
		Method: 'GET',
		Path: '/plans/:id/report.md',
		Description: 'The same report as markdown.',
		Parameters: {
			Id: { Type: 'string', Required: true, Description: 'the plan\'s id' },
		},
		Perform: async function ( participant, args )
		{
			return await make_report( string_of( args.Id ), 'markdown' );
		},
	} );


	async function make_report( id, form )
	{
		let composed = await REPORT.Compose( store, settings, id );
		if ( composed.Error )
		{
			refuse( composed.Status, composed.Error );
		}
		if ( form === 'markdown' )
		{
			return Answer( 200, REPORT.Markdown( composed.Report ), 'text/markdown; charset=utf-8' );
		}
		return Answer( 200, REPORT.Html( composed.Report ), 'html' );
	}


	define( {
		Name: 'rename_plan',
		Method: 'PUT',
		Path: '/plans/:id',
		Description: 'A plan\'s or document\'s new Title; never the Readme\'s.',
		Parameters: {
			Id: { Type: 'string', Required: true },
			Title: { Type: 'string', Required: true },
		},
		Perform: async function ( participant, args )
		{
			let title = text_of( args.Title ).trim();
			if ( !title )
			{
				refuse( 400, 'Title is required' );
			}
			let id = string_of( args.Id );
			if ( is_context_item( await store.ProjectOf( id ), id ) )
			{
				refuse( 409, CONTEXT_KEPT );
			}
			let result = await store.Queue( id, async function ()
			{
				let read = await store.ReadPlan( id );
				if ( !read )
				{
					refuse( 404, 'no such plan' );
				}
				let plan = await store.UpdatePlan( id, { Title: title } );
				return summarize( plan, read.Threads, participant );
			} );
			changed( id, 'title' );
			return { Plan: result };
		},
	} );


	// A manual edit: a new revision; no thread's status changes. Refused when made from a stale revision.
	define( {
		Name: 'write_text',
		Method: 'PUT',
		Path: '/plans/:id/text',
		Description: 'The plan\'s or document\'s whole new text as a new revision, made from Revision (refused with the current revision when the text changed since); the threads stay where they were, an anchor no longer found marking its thread detached.',
		Parameters: {
			Id: { Type: 'string', Required: true },
			Text: { Type: 'string', Required: true, Description: 'the whole markdown' },
			Revision: { Type: 'integer', Required: true, Description: 'the revision the text was made from' },
		},
		Perform: async function ( participant, args )
		{
			let body = args || {};
			if ( typeof body.Text !== 'string' )
			{
				refuse( 400, 'Text is required' );
			}
			let id = string_of( args.Id );
			let result = await store.Queue( id, async function ()
			{
				let read = await store.ReadPlan( id );
				if ( !read )
				{
					refuse( 404, 'no such plan' );
				}
				if ( body.Revision !== read.Plan.Revision )
				{
					refuse( 409, 'the text changed since revision ' + body.Revision + '; reload and edit again', { Revision: read.Plan.Revision } );
				}
				let plan = await store.WriteText( id, { Text: body.Text, By: participant.Name, Service: participant.Service, Token: participant.Token, Reason: 'edit' } );
				refind( read.Threads, body.Text );
				await store.WriteThreads( id, read.Threads );
				return summarize( plan, read.Threads, participant );
			} );
			changed( id, 'text' );
			return { Plan: result };
		},
	} );


	define( {
		Name: 'delete_plan',
		Method: 'DELETE',
		Path: '/plans/:id',
		Description: 'A plan or document to the trash, its Subplans with it; never the Readme.',
		Parameters: {
			Id: { Type: 'string', Required: true },
		},
		Perform: async function ( participant, args )
		{
			let id = string_of( args.Id );
			let holder = await store.ProjectOf( id );
			if ( is_context_item( holder, id ) )
			{
				refuse( 409, CONTEXT_KEPT );
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
				refuse( 404, 'no such plan' );
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
			return { Trashed: id, Subplans: trashed.slice( 1 ) };
		},
	} );


	define( {
		Name: 'list_trash',
		Method: 'GET',
		Path: '/trash',
		Description: 'The trashed plans and documents of every project.',
		Parameters: {},
		Perform: async function ()
		{
			return { Plans: await store.ListTrash() };
		},
	} );


	// Empty Trash (the owner's): every trashed item of every project removed for good; the pages hear { Kind: "trash" }.
	define( {
		Name: 'empty_trash',
		Method: 'DELETE',
		Path: '/trash',
		Description: 'Removes every trashed item of every project for good; the owner\'s.',
		Parameters: {},
		Perform: async function ( participant )
		{
			if ( participant.Role !== 'owner' )
			{
				refuse( 403, 'only the owner empties the trash' );
			}
			let emptied = await store.EmptyTrash();
			events.Send( { Kind: 'trash' } );
			return { Emptied: emptied };
		},
	} );


	// A plan's state: one of its project's States, set by an Owner at any time (plan Multiuser).
	define( {
		Name: 'set_state',
		Method: 'PUT',
		Path: '/plans/:id/state',
		Description: 'Sets a plan\'s state to one of its project\'s (Draft, Plan, Working, Finished by default); an Owner\'s.',
		Parameters: {
			Id: { Type: 'string', Required: true },
			State: { Type: 'string', Required: true },
		},
		Perform: async function ( participant, args )
		{
			let wanted = args.State;
			let id = string_of( args.Id );
			let may = RULES.MaySetState( participant );
			if ( !may.Ok )
			{
				refuse( 403, may.Reason );
			}
			let can = RULES.CanSetState( wanted, project_states( await store.ProjectOf( id ) ) );
			if ( !can.Ok )
			{
				refuse( 400, can.Reason );
			}
			let result = await store.Queue( id, async function ()
			{
				let read = await store.ReadPlan( id );
				if ( !read )
				{
					refuse( 404, 'no such plan' );
				}
				if ( is_document( read.Plan ) )
				{
					refuse( 409, 'a Document has no State' );
				}
				let plan = await store.UpdatePlan( id, { State: wanted } );
				return summarize( plan, read.Threads, participant );
			} );
			changed( id, 'state' );
			return { Plan: result };
		},
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
			let summary = await summarize( plan, read ? read.Threads : [], name );
			views[ plan.Id ] = { Title: summary.Title, State: summary.State, Tally: summary.Tally, StateLine: summary.StateLine, Created: summary.Created, Updated: summary.Updated };
		}
		for ( let project of projects )
		{
			for ( let id of TREE.ItemIds( project.Archive || [] ) )
			{
				let read = await store.ReadPlan( id );
				if ( read )
				{
					let summary = await summarize( read.Plan, read.Threads, name );
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


	define( {
		Name: 'list_projects',
		Method: 'GET',
		Path: '/projects',
		Description: 'Every project you may see with its tree: the folders, the plans with their states and the tally of their threads, the documents of its Context folder, the archive; the id of its Readme (Context) and of its Context folder.',
		Parameters: {},
		Perform: async function ( participant )
		{
			let projects = await visible_projects( participant );
			return { Projects: await present_projects( projects, participant ) };
		},
	} );


	// A new project: { Name, Path? }. Path is the project's folder, <config>/projects/<name>/ when not given; a folder
	// that holds a project already (its .consensus) is opened instead, under its own name (plan Run Shapes, Step 2).
	define( {
		Name: 'create_project',
		Method: 'POST',
		Path: '/projects',
		Status: 201,
		Description: 'A new project named Name, its folder at Path (<config>/projects/<name>/ when not given); a Path that holds a project already is opened instead, under its own name.',
		Parameters: {
			Name: { Type: 'string', Description: 'required unless Path holds a project' },
			Path: { Type: 'string', Description: 'the project\'s folder' },
		},
		Perform: async function ( participant, args )
		{
			let body = args || {};
			let name = name_of_body( body );
			let path = ( typeof body.Path === 'string' ) ? body.Path.trim() : '';
			if ( path )
			{
				let opened = await store.OpenProject( path );
				if ( opened )
				{
					events.Send( { Project: opened.Id, Kind: 'project' } );
					return Answer( 200, { Project: opened, Opened: true } );
				}
			}
			if ( !name )
			{
				refuse( 400, 'Name is required' );
			}
			let project = await store.CreateProject( { Name: name, Path: path || undefined } );
			events.Send( { Project: project.Id, Kind: 'project' } );
			return { Project: project };
		},
	} );


	// A project's Name, its own States, Include, Exclude and Commands (each a list, or lines of text), its Tasks, and
	// its GitSync and AutoCommit (Step 3; false is dropped from the file) and its Llm (Step 6: the connection the plan
	// page's buttons run through; null drops it); a state still used by one of its plans cannot be removed.
	define( {
		Name: 'update_project',
		Method: 'PUT',
		Path: '/projects/:pid',
		Description: 'A project\'s settings: its Name, its States, the Include, Exclude and Commands lists a run works within, the Tasks it enables, the Work options GitSync and AutoCommit, and the Llm connection its buttons run through; a state still used by a plan cannot be removed.',
		Parameters: {
			Project: { Type: 'string', Required: true, Description: 'the project\'s id' },
			Name: { Type: 'string' },
			States: { Type: 'array', Description: 'the state names, or lines of text' },
			Include: { Type: 'array' },
			Exclude: { Type: 'array' },
			Commands: { Type: 'array' },
			Tasks: { Type: 'array', Description: 'the enabled task ids; null enables them all' },
			GitSync: { Type: 'boolean' },
			AutoCommit: { Type: 'boolean' },
			Llm: { Type: 'string', Description: 'a connection\'s id, or null' },
			Version: { Type: 'integer', Description: 'the project version the change was made from; refused when it moved on' },
		},
		Perform: async function ( participant, args )
		{
			let body = args || {};
			let name = name_of_body( body );
			let fields = project_fields( body );
			if ( fields.Problems.length )
			{
				refuse( 400, fields.Problems[ 0 ], { Problems: fields.Problems } );
			}
			if ( !name && !Object.keys( fields.Values ).length )
			{
				refuse( 400, 'Name is required' );
			}
			let result = sent( await change_project( string_of( body.Project ), body.Version, async function ( project )
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
				if ( project.Llm === null )
				{
					delete project.Llm;
				}
				for ( let flag of [ 'GitSync', 'AutoCommit' ] )
				{
					if ( project[ flag ] === false )
					{
						delete project[ flag ];
					}
				}
			} ) );
			return { Project: result.Project };
		},
	} );


	// The project's lists as a body gives them: States (one or more names, none twice), Include, Exclude and Commands
	// (any lines), Tasks (plan LLM Tasks, Step 1: the enabled ids; null enables them all, the list dropped), and the
	// Work options GitSync and AutoCommit (Step 3: true or false), and Llm (Step 6: a connection's id, or null). Returns
	// { Values, Problems }.
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
		// The project's LLM connection (plan LLM Tasks, Step 6): one of the server's, by id; null clears it.
		if ( body.Llm === null )
		{
			values.Llm = null;
		}
		else if ( body.Llm !== undefined )
		{
			let id = ( typeof body.Llm === 'string' ) ? body.Llm.trim() : '';
			if ( !id || !LLMS.ById( settings, id ) )
			{
				problems.push( 'Llm names no connection of this server' );
			}
			values.Llm = id;
		}
		return { Values: values, Problems: problems };
	}


	// Only an empty project is deleted, and never the last one. Its Readme goes to the trash with it.
	define( {
		Name: 'delete_project',
		Method: 'DELETE',
		Path: '/projects/:pid',
		Description: 'Deletes an empty project (its Readme goes to the trash with it); never the last project, and never one that still holds items.',
		Parameters: {
			Project: { Type: 'string', Required: true, Description: 'the project\'s id' },
		},
		Perform: async function ( participant, args )
		{
			let id = string_of( args.Project );
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
			sent( result );
			events.Send( { Project: id, Kind: 'project' } );
			return result;
		},
	} );


	// A project moves in the display order: just before the project Before, or to the end when Before is null.
	define( {
		Name: 'move_project',
		Method: 'POST',
		Path: '/projects/:pid/move',
		Description: 'Moves a project in the display order: just before the project Before, or to the end without it. Answers every project as list_projects does.',
		Parameters: {
			Project: { Type: 'string', Required: true, Description: 'the project\'s id' },
			Before: { Type: 'string', Description: 'the id of the project it goes just before' },
		},
		Perform: async function ( participant, args )
		{
			let body = args || {};
			let id = string_of( body.Project );
			let before = ( typeof body.Before === 'string' && body.Before ) ? body.Before : null;
			if ( !await store.ReadProject( id ) )
			{
				refuse( 404, 'no such project' );
			}
			if ( before !== null && !await store.ReadProject( before ) )
			{
				refuse( 400, 'Before is not a project' );
			}
			await store.MoveProject( id, before );
			events.Send( { Project: id, Kind: 'project' } );
			return { Projects: await present_projects( await store.ListProjects(), participant ) };
		},
	} );


	//-----------------------------------------------------------------
	// Export and import: a whole project as one json object (ProjectPort.js). The owner, or the llm participant (an
	// agent session carrying projects from one Consensus server to another).

	function may_port( participant )
	{
		return !!participant && participant.Role === 'owner';
	}


	define( {
		Name: 'export_project',
		Method: 'GET',
		Path: '/projects/:pid/export',
		Description: 'A whole project as one JSON object: its tree, every plan and document with its threads and every revision (the export format); the owner\'s.',
		Parameters: {
			Project: { Type: 'string', Required: true, Description: 'the project\'s id' },
		},
		Perform: async function ( participant, args )
		{
			if ( !may_port( participant ) )
			{
				refuse( 403, 'only the owner or the llm exports a project' );
			}
			let exported = await PORT.Export( store, string_of( args.Project ) );
			if ( !exported )
			{
				refuse( 404, 'no such project' );
			}
			return exported;
		},
	} );


	// A folder, a plan or a document as one file of the same format (plan UI Tweaks V); the Readme and the Context
	// folder are not exported on their own.
	define( {
		Name: 'export_item',
		Method: 'GET',
		Path: '/items/:id/export',
		Description: 'A folder, a plan or a document as one JSON object of the export format, with everything under it; never the Readme or the Context folder on their own; the owner\'s.',
		Parameters: {
			Id: { Type: 'string', Required: true, Description: 'the item\'s id' },
		},
		Perform: async function ( participant, args )
		{
			if ( !may_port( participant ) )
			{
				refuse( 403, 'only the owner or the llm exports an item' );
			}
			let exported = await PORT.ExportItem( store, string_of( args.Id ) );
			if ( !exported )
			{
				refuse( 404, 'no such item in any project' );
			}
			if ( exported.Context )
			{
				refuse( 409, CONTEXT_KEPT );
			}
			return exported;
		},
	} );


	// Body = { Export, Mode?, Preview?, Into? }  Preview: true writes nothing and answers whether the project is
	// here. A project that is here needs Mode: 'copy' or 'merge'. Into: { Project, Parent? } writes the file's items
	// into that project's root or folder instead, every id new (plan UI Tweaks V). Without Preview the import is
	// written and answered with its report.
	define( {
		Name: 'import_project',
		Method: 'POST',
		Path: '/projects/import',
		Status: 201,
		Description: 'Imports an export file: as a project (one that is here already needs Mode copy or merge), or with Into its items into a project\'s root or folder with every id new; Preview writes nothing and says what would happen; the owner\'s.',
		Parameters: {
			Export: { Type: 'object', Required: true, Description: 'the export file\'s content' },
			Mode: { Type: 'string', Description: 'copy or merge, for a project that is here already' },
			Preview: { Type: 'boolean' },
			Into: { Type: 'object', Description: '{ Project, Parent? }: the project and folder the items go into' },
		},
		Perform: async function ( participant, args )
		{
			if ( !may_port( participant ) )
			{
				refuse( 403, 'only the owner or the llm imports a project' );
			}
			let body = args || {};
			let options = { Mode: body.Mode, Preview: !!body.Preview, Into: body.Into };
			let names = PARTICIPANTS.Speakers( settings ).map( function ( speaker ) { return speaker.Name; } );
			let result = await PORT.Import( store, body.Export, options, {
				Participants: names,
				ChangeProject: function ( id, change ) { return change_project( id, null, change ); },
			} );
			if ( result.Problems )
			{
				refuse( 400, 'the file cannot be imported: ' + result.Problems[ 0 ], { Problems: result.Problems } );
			}
			if ( result.Preview )
			{
				return Answer( 200, { Preview: result.Preview } );
			}
			let report = result.Report;
			for ( let id of report.Written )
			{
				changed( id, 'imported' );
			}
			events.Send( { Project: report.Project.Id, Kind: 'project' } );
			return { Report: report };
		},
	} );


	//-----------------------------------------------------------------
	// Folders

	define( {
		Name: 'create_folder',
		Method: 'POST',
		Path: '/projects/:pid/folders',
		Status: 201,
		Description: 'A new folder in a project, at Parent (a folder) or at the root; never in the Context folder.',
		Parameters: {
			Project: { Type: 'string', Required: true, Description: 'the project\'s id' },
			Name: { Type: 'string', Required: true },
			Parent: { Type: 'string', Description: 'a folder\'s id; the root when not given' },
			Version: { Type: 'integer', Description: 'the project version the change was made from' },
		},
		Perform: async function ( participant, args )
		{
			let body = args || {};
			let name = name_of_body( body );
			if ( !name )
			{
				refuse( 400, 'Name is required' );
			}
			let folder = { Kind: 'folder', Id: new_id( IDS.FOLDER ), Name: name, Items: [] };
			let result = sent( await change_project( string_of( body.Project ), body.Version, function ( project )
			{
				if ( !TREE.Insert( project.Items, ( body.Parent === undefined ) ? null : body.Parent, folder, undefined, project.ContextFolder ) )
				{
					return refused( 400, 'Parent is not a folder of the project (the Context folder holds documents only)' );
				}
			} ) );
			return { Folder: folder, Project: result.Project };
		},
	} );


	define( {
		Name: 'rename_folder',
		Method: 'PUT',
		Path: '/projects/:pid/folders/:fid',
		Description: 'A folder\'s new Name; never the Context folder\'s.',
		Parameters: {
			Project: { Type: 'string', Required: true, Description: 'the project\'s id' },
			Folder: { Type: 'string', Required: true, Description: 'the folder\'s id' },
			Name: { Type: 'string', Required: true },
			Version: { Type: 'integer', Description: 'the project version the change was made from' },
		},
		Perform: async function ( participant, args )
		{
			let body = args || {};
			let name = name_of_body( body );
			if ( !name )
			{
				refuse( 400, 'Name is required' );
			}
			let folder_id = string_of( body.Folder );
			let result = sent( await change_project( string_of( body.Project ), body.Version, function ( project )
			{
				if ( folder_id === project.ContextFolder )
				{
					return refused( 409, CONTEXT_KEPT );
				}
				let found = TREE.Find( project.Items, folder_id );
				if ( !found || found.Node.Kind !== 'folder' )
				{
					return refused( 404, 'no such folder' );
				}
				found.Node.Name = name;
			} ) );
			return { Project: result.Project };
		},
	} );


	// Only an empty folder is deleted, and never the Context folder.
	define( {
		Name: 'delete_folder',
		Method: 'DELETE',
		Path: '/projects/:pid/folders/:fid',
		Description: 'Deletes an empty folder; never the Context folder, and never one that still holds items.',
		Parameters: {
			Project: { Type: 'string', Required: true, Description: 'the project\'s id' },
			Folder: { Type: 'string', Required: true, Description: 'the folder\'s id' },
		},
		Perform: async function ( participant, args )
		{
			let folder_id = string_of( args.Folder );
			let result = sent( await change_project( string_of( args.Project ), null, function ( project )
			{
				if ( folder_id === project.ContextFolder )
				{
					return refused( 409, CONTEXT_KEPT );
				}
				let found = TREE.Find( project.Items, folder_id );
				if ( !found || found.Node.Kind !== 'folder' )
				{
					return refused( 404, 'no such folder' );
				}
				if ( found.Node.Items.length )
				{
					return refused( 409, 'only an empty folder is deleted: move or delete what it holds first' );
				}
				TREE.Remove( project.Items, found.Node.Id );
			} ) );
			return { Project: result.Project };
		},
	} );


	//-----------------------------------------------------------------
	// Items: any node of a tree (a folder, a plan, a document) moved or copied, within a project or into another.
	// Arguments = { Project, Parent? }  Parent is a folder of Project; without it, the project's root.

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
	define( {
		Name: 'move_item',
		Method: 'POST',
		Path: '/items/:id/move',
		Description: 'Moves a folder, plan or document into a project\'s root or one of its folders (a plan into a plan as a Subplan), at the end or just before a child of it, within its project or into another; never the Readme or the Context folder.',
		Parameters: {
			Id: { Type: 'string', Required: true, Description: 'the item\'s id' },
			Project: { Type: 'string', Required: true, Description: 'the project it goes into' },
			Parent: { Type: 'string', Description: 'a folder\'s id (or a plan\'s, for a Subplan); the root when not given' },
			Before: { Type: 'string', Description: 'the id of the child it goes just before; the end when not given' },
		},
		Perform: async function ( participant, args )
		{
			let id = string_of( args.Id );
			let where = where_of( args );
			if ( where.Before === id )
			{
				refuse( 400, 'an item cannot go just before itself' );
			}
			let source = await store.ProjectOf( id );
			if ( !source )
			{
				refuse( 404, 'no such item in any project' );
			}
			if ( is_context_item( source, id ) )
			{
				refuse( 409, CONTEXT_KEPT );
			}
			sent( await check_target( where, kind_in( source, id ) ) );
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
				sent( await change_project( source.Id, null, function ( project )
				{
					node = TREE.Remove( project.Items, id );
					if ( !node )
					{
						return refused( 404, 'no such item in the project' );
					}
				} ) );
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
			sent( result );
			return { Project: result.Project };
		},
	} );


	// A copy of a plan or document is whole (text, threads, revisions) under a new id; a folder's copy holds a
	// copy of everything in it, and a plan's copy a copy of its Subplans, with new ids throughout. The Context
	// folder and the Readme are not copied.
	define( {
		Name: 'copy_item',
		Method: 'POST',
		Path: '/items/:id/copy',
		Status: 201,
		Description: 'Copies a folder, plan or document into a project\'s root or one of its folders, whole (text, threads, revisions, Subplans, everything under a folder) with every id new; never the Readme or the Context folder.',
		Parameters: {
			Id: { Type: 'string', Required: true, Description: 'the item\'s id' },
			Project: { Type: 'string', Required: true, Description: 'the project the copy goes into' },
			Parent: { Type: 'string', Description: 'a folder\'s id; the root when not given' },
		},
		Perform: async function ( participant, args )
		{
			let id = string_of( args.Id );
			let where = where_of( args );
			let source = await store.ProjectOf( id );
			let found = source ? TREE.Find( source.Items, id ) : null;
			if ( !found )
			{
				refuse( 404, 'no such item in any project' );
			}
			if ( is_context_item( source, id ) )
			{
				refuse( 409, CONTEXT_KEPT );
			}
			sent( await check_target( where, found.Node.Kind ) );
			let copy = sent( await copy_node( found.Node, where.Project ) );
			let result = sent( await change_project( where.Project, null, function ( project )
			{
				if ( !TREE.Insert( project.Items, where.Parent, copy, undefined, project.ContextFolder ) )
				{
					return refused( 400, PARENT_REFUSED );
				}
			} ) );
			return { Node: copy, Project: result.Project };
		},
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

	define( {
		Name: 'archive_item',
		Method: 'POST',
		Path: '/items/:id/archive',
		Description: 'Archives a plan with its Subplans: out of the tree into the project\'s archive, where it is read and never written.',
		Parameters: {
			Id: { Type: 'string', Required: true, Description: 'the plan\'s id' },
		},
		Perform: async function ( participant, args )
		{
			let id = string_of( args.Id );
			let holder = await store.ProjectOf( id );
			if ( !holder )
			{
				refuse( 404, 'no such item in any project' );
			}
			if ( is_context_item( holder, id ) )
			{
				refuse( 409, CONTEXT_KEPT );
			}
			let node = null;
			let result = sent( await change_project( holder.Id, null, function ( project )
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
			} ) );
			for ( let archived of plan_ids_of( node ) )
			{
				await store.Queue( archived, function () { return store.ArchivePlan( archived ); } );
				changed( archived, 'archived' );
			}
			return { Project: result.Project, Node: node };
		},
	} );


	define( {
		Name: 'restore_item',
		Method: 'POST',
		Path: '/items/:id/restore',
		Description: 'Restores an archived plan, with its Subplans, to the root of its project\'s tree.',
		Parameters: {
			Id: { Type: 'string', Required: true, Description: 'the plan\'s id' },
		},
		Perform: async function ( participant, args )
		{
			let id = string_of( args.Id );
			let holder = await store.ProjectOf( id );
			if ( !holder )
			{
				refuse( 404, 'no such item in any project' );
			}
			let node = null;
			let result = sent( await change_project( holder.Id, null, function ( project )
			{
				let index = project.Archive.findIndex( function ( candidate ) { return candidate.Id === id; } );
				if ( index < 0 )
				{
					return refused( TREE.Find( project.Archive, id ) ? 409 : 404, TREE.Find( project.Archive, id ) ? 'a Subplan is restored with its plan' : 'the item is not archived' );
				}
				node = project.Archive.splice( index, 1 )[ 0 ];
				TREE.Insert( project.Items, null, node, undefined, project.ContextFolder );
			} ) );
			for ( let restored of plan_ids_of( node ) )
			{
				await store.Queue( restored, function () { return store.RestorePlan( restored ); } );
				changed( restored, 'restored' );
			}
			return { Project: result.Project, Node: node };
		},
	} );


	//-----------------------------------------------------------------
	// Revisions: the record.

	define( {
		Name: 'list_revisions',
		Method: 'GET',
		Path: '/plans/:id/revisions',
		Description: 'The revisions of a plan or document: each with its number, who made it, when and why (an edit, an apply with its thread, an import).',
		Parameters: {
			Id: { Type: 'string', Required: true },
		},
		Perform: async function ( participant, args )
		{
			let id = string_of( args.Id );
			let read = await store.ReadPlan( id );
			if ( !read )
			{
				refuse( 404, 'no such plan' );
			}
			return { Revisions: await store.ListRevisions( id ) };
		},
	} );


	define( {
		Name: 'read_revision',
		Method: 'GET',
		Path: '/plans/:id/revisions/:n',
		Description: 'One revision of a plan or document, with its text as it was.',
		Parameters: {
			Id: { Type: 'string', Required: true },
			Revision: { Type: 'integer', Required: true, Description: 'the revision\'s number' },
		},
		Perform: async function ( participant, args )
		{
			let revision = await store.ReadRevision( string_of( args.Id ), parseInt( args.Revision, 10 ) );
			if ( !revision )
			{
				refuse( 404, 'no such revision' );
			}
			return { Revision: revision };
		},
	} );


	//-----------------------------------------------------------------
	// Threads

	define( {
		Name: 'list_threads',
		Method: 'GET',
		Path: '/plans/:id/threads',
		Description: 'The threads of a plan, each with its status, its anchor and where it is found, its replies, whom it waits on and whether it waits on you; Status keeps one state (contested, resolved, applied, mine ...).',
		Parameters: {
			Id: { Type: 'string', Required: true },
			Status: { Type: 'string', Description: 'a status filter, as Rules.Filter knows them' },
		},
		Perform: async function ( participant, args )
		{
			let id = string_of( args.Id );
			let read = await store.ReadPlan( id );
			if ( !read )
			{
				refuse( 404, 'no such plan' );
			}
			let filtered = RULES.Filter( read.Threads, args.Status, await speakers( id, read.Threads, participant ), participant.Speaker );
			if ( !filtered )
			{
				refuse( 400, 'unknown status filter "' + args.Status + '"' );
			}
			return { Threads: await present_threads( id, filtered, read.Text, participant ) };
		},
	} );


	// A new thread: the first reply is the comment. Anchor is { Text, Prefix?, Suffix? } or null for the whole document.
	// With Resolve (the owner's Comment and resolve), it is posted resolved, the comment being its outcome.
	define( {
		Name: 'thread',
		Method: 'POST',
		Path: '/plans/:id/threads',
		Status: 201,
		Description: 'A new thread of yours on a plan: on the passage Anchor ({ Text, Prefix?, Suffix? }, plain words of the text, no markdown marks), or on the whole document without it; Resolve posts it resolved, the comment its outcome (Comment and resolve).',
		Parameters: {
			Id: { Type: 'string', Required: true, Description: 'the plan\'s id' },
			Text: { Type: 'string', Required: true, Description: 'the comment, markdown' },
			Anchor: { Type: 'object', Description: '{ Text, Prefix?, Suffix? }: the passage; the whole document without it' },
			Resolve: { Type: 'boolean', Description: 'post it resolved' },
		},
		Perform: async function ( participant, args )
		{
			let body = args || {};
			let text = text_of( body.Text ).trim();
			if ( !text )
			{
				refuse( 400, 'Text is required' );
			}
			let result = sent( await create_thread( string_of( args.Id ), participant, text, body.Anchor || null, !!body.Resolve ) );
			return { Thread: result.Thread };
		},
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
			return { Thread: ( await present_threads( id, [ thread ], read.Text, participant ) )[ 0 ] };
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
			return { Thread: ( await present_threads( id, [ thread ], read.Text, participant ) )[ 0 ], Reopened: effect.Reopen, Resolved: !!resolve };
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


	// Arguments = { Text, Resolve? }  Resolve: true is the owner's Reply and resolve.
	define( {
		Name: 'reply',
		Method: 'POST',
		Path: '/plans/:id/threads/:tid/replies',
		Status: 201,
		Description: 'A reply of yours on a thread; a reply to a settled thread reopens it. Resolve resolves it in the same write, the reply being its outcome (Reply and resolve).',
		Parameters: {
			Id: { Type: 'string', Required: true, Description: 'the plan\'s id' },
			Thread: { Type: 'string', Required: true, Description: 'the thread\'s id' },
			Text: { Type: 'string', Required: true, Description: 'the reply, markdown' },
			Resolve: { Type: 'boolean' },
		},
		Perform: async function ( participant, args )
		{
			let body = args || {};
			let text = text_of( body.Text ).trim();
			if ( !text )
			{
				refuse( 400, 'Text is required' );
			}
			let result = await add_reply( string_of( args.Id ), string_of( args.Thread ), participant, text, body.Resolve === true );
			if ( result.Refused )
			{
				refuse( result.Refused.Status, result.Refused.Error );
			}
			return result;
		},
	} );


	// Re-anchor a thread, detached or not, to a passage of the current text.
	define( {
		Name: 'reanchor',
		Method: 'POST',
		Path: '/plans/:id/threads/:tid/anchor',
		Description: 'Moves a thread, detached or not, onto a passage of the current text: Anchor { Text, Prefix?, Suffix? }, plain words found exactly once.',
		Parameters: {
			Id: { Type: 'string', Required: true, Description: 'the plan\'s id' },
			Thread: { Type: 'string', Required: true, Description: 'the thread\'s id' },
			Anchor: { Type: 'object', Required: true, Description: '{ Text, Prefix?, Suffix? }' },
		},
		Perform: async function ( participant, args )
		{
			let body = args || {};
			let id = string_of( args.Id );
			let thread_id = string_of( args.Thread );
			let result = await store.Queue( id, async function ()
			{
				let read = await store.ReadPlan( id );
				if ( !read )
				{
					refuse( 404, 'no such plan' );
				}
				let thread = find_thread( read, thread_id );
				if ( !thread )
				{
					refuse( 404, 'no such thread' );
				}
				let anchor = place_anchor( body.Anchor, read.Text );
				if ( !anchor )
				{
					refuse( 400, 'the anchor text was not found in the plan' );
				}
				thread.Anchor = anchor;
				thread.Detached = false;
				await store.WriteThreads( id, read.Threads );
				return ( await present_threads( id, [ thread ], read.Text, participant ) )[ 0 ];
			} );
			changed( id, 'anchored', result.Id );
			return { Thread: result };
		},
	} );


	// Resolve: the starter or an Owner (plan Multiuser), contested threads only. Resolving accepts the outcome stated in
	// the last reply.
	define( {
		Name: 'resolve',
		Method: 'POST',
		Path: '/plans/:id/threads/:tid/resolve',
		Description: 'Resolves a contested thread, accepting the outcome stated in its last reply; the starter\'s or an Owner\'s. A build log resolved with the project\'s Work options on is committed.',
		Parameters: {
			Id: { Type: 'string', Required: true, Description: 'the plan\'s id' },
			Thread: { Type: 'string', Required: true, Description: 'the thread\'s id' },
		},
		Perform: async function ( participant, args )
		{
			let id = string_of( args.Id );
			let thread_id = string_of( args.Thread );
			let result = await store.Queue( id, async function ()
			{
				let read = await store.ReadPlan( id );
				if ( !read )
				{
					refuse( 404, 'no such plan' );
				}
				let thread = find_thread( read, thread_id );
				if ( !thread )
				{
					refuse( 404, 'no such thread' );
				}
				let can = RULES.CanResolve( participant, thread );
				if ( !can.Ok )
				{
					refuse( ( participant.Role === 'owner' ) ? 409 : 403, can.Reason );
				}
				Object.assign( thread, RULES.ResolveEffect( participant, now() ) );
				await store.WriteThreads( id, read.Threads );
				return ( await present_threads( id, [ thread ], read.Text, participant ) )[ 0 ];
			} );
			changed( id, 'resolved', result.Id );
			let record = await after_resolve( id, result );
			if ( record )
			{
				result.Git = record;
			}
			return { Thread: result };
		},
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
	define( {
		Name: 'delete_thread',
		Method: 'DELETE',
		Path: '/plans/:id/threads/:tid',
		Description: 'Deletes a thread; the owner\'s. The revisions that applied it keep their text.',
		Parameters: {
			Id: { Type: 'string', Required: true, Description: 'the plan\'s id' },
			Thread: { Type: 'string', Required: true, Description: 'the thread\'s id' },
		},
		Perform: async function ( participant, args )
		{
			let id = string_of( args.Id );
			let thread_id = string_of( args.Thread );
			let result = await store.Queue( id, async function ()
			{
				let read = await store.ReadPlan( id );
				if ( !read )
				{
					refuse( 404, 'no such plan' );
				}
				let can = RULES.CanDeleteThread( participant );
				if ( !can.Ok )
				{
					refuse( 403, can.Reason );
				}
				let index = read.Threads.findIndex( function ( candidate ) { return candidate.Id === thread_id; } );
				if ( index < 0 )
				{
					refuse( 404, 'no such thread' );
				}
				read.Threads.splice( index, 1 );
				await store.WriteThreads( id, read.Threads );
				await store.UpdatePlan( id, {} );
				return { Id: thread_id };
			} );
			changed( id, 'thread-deleted', result.Id );
			return { Deleted: result.Id };
		},
	} );


	// Apply: a resolved thread's outcome goes into the text. Arguments = { Text?, Outcome, Revision, Anchor? }
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
			let may = RULES.MayApply( participant );
			if ( !may.Ok )
			{
				return refused( 403, may.Reason );
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
			return { Thread: ( await present_threads( id, [ thread ], text, participant ) )[ 0 ], Plan: await summarize( plan, read.Threads, participant ) };
		} );
		if ( !result.Refused )
		{
			changed( id, 'applied', result.Thread.Id );
		}
		return result;
	}


	define( {
		Name: 'apply',
		Method: 'POST',
		Path: '/plans/:id/threads/:tid/apply',
		Description: 'Applies a resolved thread: Outcome says what was decided; Text is the plan\'s whole new text when it changes, made from Revision (refused when stale); Anchor moves the thread onto the passage the change produced. Answers the thread and the plan.',
		Parameters: {
			Id: { Type: 'string', Required: true, Description: 'the plan\'s id' },
			Thread: { Type: 'string', Required: true, Description: 'the thread\'s id' },
			Outcome: { Type: 'string', Required: true, Description: 'what was decided and done, recorded on the thread' },
			Text: { Type: 'string', Description: 'the whole new text; the outcome alone without it' },
			Revision: { Type: 'integer', Description: 'the revision Text was made from; required with Text' },
			Anchor: { Type: 'object', Description: '{ Text, Prefix?, Suffix? }: the passage the thread points at after' },
		},
		Perform: async function ( participant, args )
		{
			return sent( await apply_outcome( string_of( args.Id ), string_of( args.Thread ), participant, args || {} ) );
		},
	} );


	//-----------------------------------------------------------------
	// Waiting: everything waiting on the caller, across plans.

	define( {
		Name: 'waiting',
		Method: 'GET',
		Path: '/waiting',
		Description: 'Every thread waiting on you, across every plan and project you may see: the contested threads whose last word is not yours, and the resolved ones to apply; each with its plan.',
		Parameters: {},
		Perform: async function ( participant )
		{
			let waiting = [];
			let visible = await visible_plan_ids( participant );
			for ( let plan of await store.ListPlans() )
			{
				if ( visible && !visible.has( plan.Id ) )
				{
					continue;
				}
				let read = await store.ReadPlan( plan.Id );
				if ( !read )
				{
					continue;
				}
				let threads = RULES.WaitingOn( participant.Speaker, read.Threads, await speakers( plan.Id, read.Threads, participant ) );
				for ( let thread of await present_threads( plan.Id, threads, read.Text, participant ) )
				{
					waiting.push( { Plan: { Id: plan.Id, Title: plan.Title, State: plan.State, Revision: plan.Revision }, Thread: thread } );
				}
			}
			return { Me: PARTICIPANTS.Public( participant ), Waiting: waiting };
		},
	} );


	//-----------------------------------------------------------------
	// The LLM connections (plan Run Shapes, Step 3): the settings' Llms, each a tool a run goes through, its posts
	// reading "<Name> by <owner>" (plan User Management, Step 2). Everyone sees the list (its public part); the owner
	// writes it and sees the whole records. A connection's Check runs its command or asks its Ollama, saved or not.

	function llm_running( llm )
	{
		return runs ? runs.Running( llm.Id ) : null;
	}


	function present_llm( llm, participant )
	{
		let shown = LLMS.Public( llm, settings, participant.Role === 'owner' );
		shown.Running = llm_running( llm );
		return shown;
	}


	function owner_only( participant )
	{
		if ( participant.Role !== 'owner' )
		{
			refuse( 403, 'only the owner changes the LLM connections' );
		}
	}


	function llm_of( id )
	{
		let llm = LLMS.ById( settings, id );
		if ( !llm )
		{
			refuse( 404, 'no LLM connection with the id ' + id );
		}
		return llm;
	}


	function object_of( args )
	{
		return ( args && typeof args === 'object' ) ? args : {};
	}


	// A connection saved: the given fields over the record (a new one: over the defaults, with a new id),
	// filled and checked with the rest; a new one goes to the end of the list.
	async function save_llm( participant, given, existing )
	{
		let filled = existing ? LLMS.Fill( Object.assign( {}, existing, given, { Id: existing.Id } ) ) : LLMS.Fill( Object.assign( {}, given, { Id: undefined } ) );
		let kept = ( settings.Llms || [] ).filter( function ( one ) { return one.Id !== filled.Id; } );
		let index = ( settings.Llms || [] ).findIndex( function ( one ) { return one.Id === filled.Id; } );
		kept.splice( ( index < 0 ) ? kept.length : index, 0, filled );
		let problems = LLMS.Problems( Object.assign( {}, settings, { Llms: kept } ) );
		if ( problems.length )
		{
			refuse( 400, problems.join( '; ' ), { Problems: problems } );
		}
		settings.Llms = kept;
		await store.WriteSettings( settings );
		events.Send( { Kind: 'llms', Llm: filled.Id } );
		return Answer( existing ? 200 : 201, { Llm: present_llm( filled, participant ) } );
	}


	// The tasks (plan LLM Tasks, Step 1): the server's list in the buttons' order, or those a project enables with
	// Project; the levels, the switches and the shipped defaults for the Settings popup.
	define( {
		Name: 'list_tasks',
		Method: 'GET',
		Path: '/tasks',
		Description: 'The tasks a run can be asked for (Answer, Enhance, Work, Explain, Session and any of your own): the server\'s list, or the ones a project enables with Project; with the Writes levels, the package switches and the shipped defaults.',
		Parameters: {
			Project: { Type: 'string', Description: 'a project\'s id: its enabled tasks only' },
		},
		Perform: async function ( participant, args )
		{
			let project = args.Project ? await store.ReadProject( args.Project ) : null;
			if ( args.Project && !project )
			{
				refuse( 404, 'no project with the id ' + args.Project );
			}
			return { Tasks: project ? TASKS.Enabled( settings, project ) : ( settings.Tasks || [] ), Writes: TASKS.WRITES, Package: TASKS.PACKAGE_ITEMS, Off: TASKS.OFF_BY_DEFAULT, Defaults: TASKS.Defaults() };
		},
	} );


	define( {
		Name: 'list_llms',
		Method: 'GET',
		Path: '/llms',
		Description: 'The server\'s LLM connections (their public part; the whole records for the owner), each with its running run; the kinds and the default prompts; whether this server runs LLMs at all.',
		Parameters: {},
		Perform: async function ( participant )
		{
			let llms = ( settings.Llms || [] ).map( function ( llm ) { return present_llm( llm, participant ); } );
			return { Llms: llms, Kinds: LLMS.KINDS, DefaultPrompts: LLMS.DEFAULT_PROMPTS, Runs: !!runner };
		},
	} );


	define( {
		Name: 'create_llm',
		Method: 'POST',
		Path: '/llms',
		Status: 201,
		Description: 'A new LLM connection from the fields given (Name, Kind, Command or Model and Url, the prompts), filled with the defaults and checked; the owner\'s.',
		Parameters: {
			Name: { Type: 'string' },
			Kind: { Type: 'string', Description: 'one of the kinds list_llms names' },
		},
		Perform: async function ( participant, args )
		{
			owner_only( participant );
			return await save_llm( participant, object_of( args ), null );
		},
	} );


	// Check of a connection as typed, saved or not: { Ok, Result } or { Ok: false, Error }.
	define( {
		Name: 'check_llm',
		Method: 'POST',
		Path: '/llms/check',
		Description: 'Checks a connection as given, saved or not: runs its command or asks its Ollama once; the owner\'s.',
		Parameters: {
			Kind: { Type: 'string' },
		},
		Perform: async function ( participant, args )
		{
			owner_only( participant );
			return await LLM.Check( LLMS.Fill( object_of( args ) ) );
		},
	} );


	define( {
		Name: 'update_llm',
		Method: 'PUT',
		Path: '/llms/:id',
		Description: 'A saved LLM connection changed: the fields given over its record, filled and checked; the owner\'s.',
		Parameters: {
			Id: { Type: 'string', Required: true, Description: 'the connection\'s id' },
		},
		Perform: async function ( participant, args )
		{
			owner_only( participant );
			let llm = llm_of( string_of( args.Id ) );
			return await save_llm( participant, object_of( args ), llm );
		},
	} );


	define( {
		Name: 'check_saved_llm',
		Method: 'POST',
		Path: '/llms/:id/check',
		Description: 'Checks a saved connection, the fields given over its record (the popup\'s unsaved ones); the owner\'s.',
		Parameters: {
			Id: { Type: 'string', Required: true, Description: 'the connection\'s id' },
		},
		Perform: async function ( participant, args )
		{
			owner_only( participant );
			let llm = llm_of( string_of( args.Id ) );
			return await LLM.Check( LLMS.Fill( Object.assign( {}, llm, object_of( args ), { Id: llm.Id } ) ) );
		},
	} );


	define( {
		Name: 'delete_llm',
		Method: 'DELETE',
		Path: '/llms/:id',
		Description: 'Deletes a saved LLM connection; not while it is running; the owner\'s.',
		Parameters: {
			Id: { Type: 'string', Required: true, Description: 'the connection\'s id' },
		},
		Perform: async function ( participant, args )
		{
			owner_only( participant );
			let llm = llm_of( string_of( args.Id ) );
			if ( llm_running( llm ) )
			{
				refuse( 409, 'the connection "' + llm.Name + '" is running; stop it first' );
			}
			settings.Llms = settings.Llms.filter( function ( one ) { return one.Id !== llm.Id; } );
			await store.WriteSettings( settings );
			events.Send( { Kind: 'llms', Llm: llm.Id } );
			return { Deleted: llm.Id };
		},
	} );


	//-----------------------------------------------------------------
	// The runs (plan Run Shapes, Step 3): a one-shot asked of a connection by the presser, run by this server in the
	// project's folder as the presser through the connection (Runner.js, Runs.js); the records are read by everyone.
	// A run's start, progress and end go out as { Kind: run } events.

	function may_run()
	{
		if ( !runner || !runs )
		{
			refuse( 503, 'this server runs no LLMs' );
		}
	}


	// The packaging popup's lists: the other Context documents of the project, the plan's threads waiting on the
	// connection.
	define( {
		Name: 'run_lists',
		Method: 'GET',
		Path: '/runs/lists',
		Description: 'What a run of a connection on a plan could package: the project\'s other Context documents and the plan\'s threads waiting on the connection, for the packaging popup.',
		Parameters: {
			Project: { Type: 'string', Required: true },
			Plan: { Type: 'string' },
			Llm: { Type: 'string', Description: 'the connection\'s id' },
		},
		Perform: async function ( participant, args )
		{
			if ( !runner )
			{
				refuse( 503, 'this server runs no LLMs' );
			}
			let made = await runner.Lists( { Project: args.Project, Plan: args.Plan, Llm: args.Llm } );
			if ( made.Error )
			{
				refuse( 400, made.Error );
			}
			return made;
		},
	} );


	// The prompt a run would get: { Llm, Task, Project, Plan?, Text?, Overrides? } (Text the person's instructions for a
	// task with a Box; Overrides the popup's unsaved fields of the connection).
	define( {
		Name: 'package_run',
		Method: 'POST',
		Path: '/runs/package',
		Description: 'The prompt a run would get, without running it: the task\'s package over the project and the plan, with the person\'s instructions (Text) and the connection\'s unsaved fields (Overrides).',
		Parameters: {
			Llm: { Type: 'string', Required: true, Description: 'the connection\'s id' },
			Task: { Type: 'string', Required: true, Description: 'the task\'s id' },
			Project: { Type: 'string', Required: true },
			Plan: { Type: 'string' },
			Text: { Type: 'string', Description: 'the instructions for a task with a box' },
			Overrides: { Type: 'object' },
		},
		Perform: async function ( participant, args )
		{
			may_run();
			let made = await runner.Package( object_of( args ), undefined, participant );
			if ( made.Error )
			{
				refuse( 400, made.Error );
			}
			return { Prompt: made.Prompt, Speaker: made.Speaker, Task: made.Task, Text: made.Text, Project: made.Project, Plan: made.Plan, Folder: made.Folder ? made.Folder.Path : null };
		},
	} );


	// A run started: { Llm, Task, Project, Plan?, Text? }; its record, with Status running, comes back at once.
	define( {
		Name: 'start_run',
		Method: 'POST',
		Path: '/runs',
		Status: 201,
		Description: 'Starts a run: the task pressed on a plan (or the project) through a connection, as you, in the project\'s folder; its record comes back at once, queued behind a run of the same plan or connection when there is one.',
		Parameters: {
			Llm: { Type: 'string', Required: true, Description: 'the connection\'s id' },
			Task: { Type: 'string', Required: true, Description: 'the task\'s id' },
			Project: { Type: 'string', Required: true },
			Plan: { Type: 'string' },
			Text: { Type: 'string', Description: 'the instructions for a task with a box' },
		},
		Perform: async function ( participant, args )
		{
			may_run();
			if ( participant.Role !== 'owner' )
			{
				let task = TASKS.ById( settings, object_of( args ).Task );
				if ( task && !ROLES.MayPress( participant.ProjectRole, task.Writes ) )
				{
					refuse( 403, ROLES.Reason( participant.ProjectRole, 'press' ) );
				}
			}
			let started = await runner.Start( object_of( args ), participant );
			if ( started.Error )
			{
				refuse( started.Status || 400, started.Error );
			}
			return { Run: started.Run };
		},
	} );


	// The summaries, newest first; of one connection with Llm, with its running one; of a project, a task or an asker
	// with Project, Task and By (plan LLM Tasks, Step 4: a person's Explain runs of a project are the conversation).
	define( {
		Name: 'list_runs',
		Method: 'GET',
		Path: '/runs',
		Description: 'The run records, newest first: of one connection (Llm, with its running one), of a project, a task or an asker (Project, Task, By).',
		Parameters: {
			Llm: { Type: 'string' },
			Project: { Type: 'string' },
			Task: { Type: 'string' },
			By: { Type: 'string', Description: 'the account that pressed' },
		},
		Perform: async function ( participant, args )
		{
			if ( !runs )
			{
				refuse( 503, 'this server runs no LLMs' );
			}
			let llm_id = args.Llm || undefined;
			let filter = { Llm: llm_id, Project: args.Project || undefined, Task: args.Task || undefined, By: args.By || undefined };
			return { Runs: runs.List( filter ), Running: llm_id ? runs.Running( llm_id ) : null };
		},
	} );


	define( {
		Name: 'read_run',
		Method: 'GET',
		Path: '/runs/:id',
		Description: 'One run\'s whole record: what it was given, what it answered, its status.',
		Parameters: {
			Id: { Type: 'string', Required: true, Description: 'the run\'s id' },
		},
		Perform: async function ( participant, args )
		{
			let id = string_of( args.Id );
			let run = ( runs && RUN_ID.test( id ) ) ? runs.Read( id ) : null;
			if ( !run )
			{
				refuse( 404, 'no run with the id ' + id );
			}
			return { Run: run };
		},
	} );


	define( {
		Name: 'stop_run',
		Method: 'POST',
		Path: '/runs/:id/stop',
		Description: 'Stops a running or queued run; the one who pressed it, or the Administrator.',
		Parameters: {
			Id: { Type: 'string', Required: true, Description: 'the run\'s id' },
		},
		Perform: async function ( participant, args )
		{
			may_run();
			let id = string_of( args.Id );
			own_run( participant, id );
			if ( !runs.Stop( id ) )
			{
				refuse( 404, 'no running run with the id ' + id );
			}
			return { Stopped: true };
		},
	} );


	// A record removed (plan LLM Tasks, Step 4: Clear in the Explain tab); not a running one.
	define( {
		Name: 'delete_run',
		Method: 'DELETE',
		Path: '/runs/:id',
		Description: 'Removes a run\'s record; not a running one; the one who pressed it, or the Administrator.',
		Parameters: {
			Id: { Type: 'string', Required: true, Description: 'the run\'s id' },
		},
		Perform: async function ( participant, args )
		{
			may_run();
			let id = string_of( args.Id );
			if ( !RUN_ID.test( id ) )
			{
				refuse( 404, 'no run with the id ' + id );
			}
			own_run( participant, id );
			try
			{
				if ( !runs.Delete( id ) )
				{
					refuse( 404, 'no run with the id ' + id );
				}
			}
			catch ( error )
			{
				if ( IsRefusal( error ) )
				{
					throw error;
				}
				refuse( 409, error.message );
			}
			return { Deleted: id };
		},
	} );


	// A run is stopped or deleted by the one who asked for it, or the Administrator (plan User Management, Step 3).
	function own_run( participant, id )
	{
		if ( is_admin( participant ) )
		{
			return;
		}
		let run = RUN_ID.test( id ) ? runs.Read( id ) : null;
		if ( run && run.By === participant.Name )
		{
			return;
		}
		refuse( 403, 'another account\'s run' );
	}


	//-----------------------------------------------------------------
	// Users and roles (plan User Management, Step 3): the registry (Users.js), every account seeing the list, an
	// account's own page or the Administrator's seeing a page; the tokens minted and revoked there, the value shown
	// once; the activity read from what the threads and revisions record; and a project's role folders (Roles.js).

	function needs_users()
	{
		if ( !users )
		{
			refuse( 503, 'this server keeps no users' );
		}
	}


	function user_of( id )
	{
		let record = users.Get( id );
		if ( !record )
		{
			refuse( 404, 'no account with the id ' + id );
		}
		return record;
	}


	define( {
		Name: 'list_users',
		Method: 'GET',
		Path: '/users',
		Description: 'The server\'s accounts (the owner, the users, the Service accounts), their public part; whether you are the Administrator.',
		Parameters: {},
		Perform: async function ( participant )
		{
			needs_users();
			return { Users: users.List().map( function ( record ) { return users.Public( record, false ); } ), Admin: is_admin( participant ) };
		},
	} );


	// A user (Type user, with an email: the record Clerk completes at the first sign-in) or a Service account (Type service).
	define( {
		Name: 'create_user',
		Method: 'POST',
		Path: '/users',
		Status: 201,
		Description: 'A new account: a user (Type user, with the email Clerk will match at the first sign-in) or a Service account (Type service); the Administrator\'s.',
		Parameters: {
			Type: { Type: 'string', Required: true, Description: 'user or service' },
			Login: { Type: 'string', Required: true },
			Display: { Type: 'string' },
			Email: { Type: 'string' },
		},
		Perform: async function ( participant, args )
		{
			needs_users();
			let body = object_of( args );
			let record = null;
			try
			{
				record = users.Create( { Type: body.Type, Login: body.Login, Display: body.Display, Email: body.Email } );
			}
			catch ( error )
			{
				refuse( 400, error.message );
			}
			events.Send( { Kind: 'users' } );
			return { User: users.Public( record, true ) };
		},
	} );


	define( {
		Name: 'read_user',
		Method: 'GET',
		Path: '/users/:id',
		Description: 'An account\'s page: its record with its token names; your own, or any for the Administrator.',
		Parameters: {
			Id: { Type: 'string', Required: true, Description: 'the account\'s id' },
		},
		Perform: async function ( participant, args )
		{
			needs_users();
			let record = user_of( string_of( args.Id ) );
			if ( !may_see( participant, record.Id ) )
			{
				refuse( 403, 'another account\'s page' );
			}
			return { User: users.Public( record, true ), Admin: users.IsAdmin( settings, record ) };
		},
	} );


	// The Administrator changes a login, a display and an email; an account its own display.
	define( {
		Name: 'update_user',
		Method: 'PUT',
		Path: '/users/:id',
		Description: 'Changes an account: the Administrator its Login, Display and Email, an account its own Display.',
		Parameters: {
			Id: { Type: 'string', Required: true, Description: 'the account\'s id' },
			Login: { Type: 'string' },
			Display: { Type: 'string' },
			Email: { Type: 'string' },
		},
		Perform: async function ( participant, args )
		{
			needs_users();
			let record = user_of( string_of( args.Id ) );
			if ( !may_see( participant, record.Id ) )
			{
				refuse( 403, 'another account\'s page' );
			}
			let body = object_of( args );
			let fields = is_admin( participant ) ? { Login: body.Login, Display: body.Display, Email: body.Email } : { Display: body.Display };
			let changed_record = null;
			try
			{
				changed_record = users.Update( record.Id, fields );
			}
			catch ( error )
			{
				refuse( 400, error.message );
			}
			events.Send( { Kind: 'users' } );
			return { User: users.Public( changed_record, true ) };
		},
	} );


	// An account deleted: out of every project's role folders, its tokens gone with it; never the owner.
	define( {
		Name: 'delete_user',
		Method: 'DELETE',
		Path: '/users/:id',
		Description: 'Deletes an account, out of every project\'s role folders and its tokens with it; never the owner; the Administrator\'s.',
		Parameters: {
			Id: { Type: 'string', Required: true, Description: 'the account\'s id' },
		},
		Perform: async function ( participant, args )
		{
			needs_users();
			let record = user_of( string_of( args.Id ) );
			if ( record.Type === 'owner' )
			{
				refuse( 409, 'the owner is not deleted' );
			}
			await clear_roles( record.Id );
			users.Delete( record.Id );
			events.Send( { Kind: 'users' } );
			return { Deleted: record.Id };
		},
	} );


	// A token minted: its value answered once. An account mints its own; the Administrator a Service account's.
	define( {
		Name: 'mint_token',
		Method: 'POST',
		Path: '/users/:id/tokens',
		Status: 201,
		Description: 'Mints a token named Name for an account, its value answered this once; an account mints its own, the Administrator a Service account\'s.',
		Parameters: {
			Id: { Type: 'string', Required: true, Description: 'the account\'s id' },
			Name: { Type: 'string', Required: true, Description: 'the token\'s name, unique for the account' },
		},
		Perform: async function ( participant, args )
		{
			needs_users();
			let record = user_of( string_of( args.Id ) );
			if ( !may_see( participant, record.Id ) || ( record.Type === 'service' && !is_admin( participant ) ) )
			{
				refuse( 403, 'another account\'s tokens' );
			}
			let name = text_of( object_of( args ).Name ).trim();
			let value = null;
			try
			{
				value = users.MintToken( record.Id, name );
			}
			catch ( error )
			{
				refuse( 400, error.message );
			}
			return { Token: value, Name: name };
		},
	} );


	define( {
		Name: 'revoke_token',
		Method: 'DELETE',
		Path: '/users/:id/tokens/:name',
		Description: 'Revokes an account\'s token by its name; your own, or any for the Administrator.',
		Parameters: {
			Id: { Type: 'string', Required: true, Description: 'the account\'s id' },
			Name: { Type: 'string', Required: true, Description: 'the token\'s name' },
		},
		Perform: async function ( participant, args )
		{
			needs_users();
			let record = user_of( string_of( args.Id ) );
			if ( !may_see( participant, record.Id ) )
			{
				refuse( 403, 'another account\'s tokens' );
			}
			let name = string_of( args.Name );
			if ( !users.RevokeToken( record.Id, name ) )
			{
				refuse( 404, 'no token named ' + name );
			}
			return { Revoked: name };
		},
	} );


	// The activity of an account on the server: the threads it opened, its replies, resolves, applies and revisions,
	// newest first, as the plans record them (a state change leaves no record today).
	define( {
		Name: 'activity',
		Method: 'GET',
		Path: '/users/:id/activity',
		Description: 'An account\'s activity on the server, newest first: the threads it opened, its replies, resolves, applies and revisions, each with its project and plan; your own, or any for the Administrator.',
		Parameters: {
			Id: { Type: 'string', Required: true, Description: 'the account\'s id' },
		},
		Perform: async function ( participant, args )
		{
			needs_users();
			let record = user_of( string_of( args.Id ) );
			if ( !may_see( participant, record.Id ) )
			{
				refuse( 403, 'another account\'s page' );
			}
			let entries = [];
			function note( kind, at, project, plan, more )
			{
				entries.push( Object.assign( { Kind: kind, At: at, Project: { Id: project.Id, Name: project.Name }, Plan: { Id: plan.Id, Title: plan.Title } }, more || {} ) );
			}
			for ( let project of await store.ListProjects() )
			{
				let ids = TREE.ItemIds( project.Items || [] ).concat( TREE.ItemIds( project.Archive || [] ) );
				for ( let id of ids )
				{
					let read = await store.ReadPlan( id );
					if ( !read )
					{
						continue;
					}
					for ( let thread of read.Threads || [] )
					{
						( thread.Replies || [] ).forEach( function ( reply, index )
						{
							if ( reply.By === record.Login )
							{
								note( index ? 'reply' : 'thread', reply.At, project, read.Plan, { Thread: thread.Id, Text: String( reply.Text || '' ).slice( 0, 160 ) } );
							}
						} );
						if ( thread.Resolved && thread.Resolved.By === record.Login )
						{
							note( 'resolved', thread.Resolved.At, project, read.Plan, { Thread: thread.Id } );
						}
						if ( thread.Applied && thread.Applied.By === record.Login )
						{
							note( 'applied', thread.Applied.At, project, read.Plan, { Thread: thread.Id, Text: String( thread.Applied.Outcome || '' ).slice( 0, 160 ) } );
						}
					}
					for ( let revision of await store.ListRevisions( id ) )
					{
						if ( revision.By === record.Login )
						{
							note( 'revision', revision.At, project, read.Plan, { Revision: revision.Revision, Reason: revision.Reason || null } );
						}
					}
				}
			}
			entries.sort( function ( a, b ) { return ( a.At < b.At ) ? 1 : ( ( a.At > b.At ) ? -1 : 0 ); } );
			return { User: users.Public( record, false ), Activity: entries.slice( 0, ACTIVITY_LIMIT ) };
		},
	} );


	// A project's role folders: { Owners, Members, Service, Watchers }, each a list of account ids, an account in one
	// at most; an id that is no account is refused; the owner's record is never in a folder.
	define( {
		Name: 'set_roles',
		Method: 'PUT',
		Path: '/projects/:pid/roles',
		Description: 'A project\'s role folders, whole: Owners, Members, Service and Watchers, each a list of account ids, an account in one at most; a person needs the license the folder asks for; an Owner\'s or the Administrator\'s.',
		Parameters: {
			Project: { Type: 'string', Required: true, Description: 'the project\'s id' },
			Owners: { Type: 'array' },
			Members: { Type: 'array' },
			Service: { Type: 'array' },
			Watchers: { Type: 'array' },
			Version: { Type: 'integer', Description: 'the project version the change was made from' },
		},
		Perform: async function ( participant, args )
		{
			needs_users();
			let body = object_of( args );
			let roles = ROLES.Clean( body );
			for ( let role of ROLES.ROLES )
			{
				for ( let id of roles[ role ] )
				{
					let record = users.Get( id );
					if ( !record )
					{
						refuse( 400, 'no account with the id ' + id );
					}
					if ( record.Type === 'owner' )
					{
						refuse( 400, 'the owner needs no role folder' );
					}
					if ( ( record.Type === 'service' ) !== ( role === 'Service' ) )
					{
						refuse( 400, ( record.Type === 'service' ) ? 'a Service account goes in the Service folder only' : 'the Service folder takes Service accounts only' );
					}
					// Plan Clerk, Step 5: a person seen without the plan the folder needs stays out of it.
					let needed = ROLES.PlanFor( role );
					if ( needed && record.Clerk && ROLES.PlanRank( record.Plan ) < ROLES.PlanRank( needed ) )
					{
						refuse( 400, record.Login + ' needs a ' + needed + ' license to be in ' + role, { Plan: needed } );
					}
				}
			}
			let result = sent( await change_project( string_of( body.Project ), body.Version, async function ( project )
			{
				project.Roles = roles;
			} ) );
			return { Project: result.Project };
		},
	} );


	//-----------------------------------------------------------------

	return {
		List: list,
		Get: Get,
		Perform: Perform,
		Shared: {
			RolesOf: roles_of,
			NeededPlan: needed_plan,
			ClearRoles: clear_roles,
		},
	};
}


module.exports = {
	Operations: Operations,
	Refusal: Refusal,
	Answer: Answer,
	IsRefusal: IsRefusal,
	IsAnswer: IsAnswer,
};
