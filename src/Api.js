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
const ROLES = require( './Roles.js' );
const LLM = require( './Llm.js' );
const REPORT = require( './Report.js' );
const VERSION = require( '../package.json' ).version;

const ACTIVITY_LIMIT = 200;	// the entries an account's activity page lists
const BODY_LIMIT = '64mb';	// a project import is one json body, every revision of every plan in it
const PARENT_REFUSED = 'Parent is not a folder of the project, or a plan (which holds plans only); a document goes in the Context folder, which holds documents only';
const CONTEXT_KEPT = 'the Context folder and its Readme stay as they are: never renamed, moved, copied or deleted';


//---------------------------------------------------------------------
// Attach: mounts the routes on an Express app. Context = { Store, Settings, Events, Runs?, Runner?, Git?, Users?, Clerk? }
// Clerk (plan User Management, Step 4): the sign-in of a shared server; a Clerk session token is its user's account, a
// bare request on a Public server with Clerk keys is refused, and GET /clerk and POST /clerk/webhook serve the page and
// Clerk's events before identify.
// Users (plan User Management, Step 3): the registry; a user token is its account, every route is checked against
// the account's role in the project (authorize), and the users routes serve the Users folder and the user pages.
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
	let users = Context.Users || null;
	let clerk = Context.Clerk || null;
	const LOOPBACK = [ '127.0.0.1', '::1', '::ffff:127.0.0.1' ];
	let router = EXPRESS.Router();
	// Before identify (Step 4): what the page needs to sign in, and Clerk's events over the raw body.
	router.get( '/clerk', function ( request, response )
	{
		response.json( clerk ? clerk.Config() : { On: false, Required: false, PublishableKey: null, FrontendApi: null, Pricing: null } );
	} );
	router.post( '/clerk/webhook', EXPRESS.raw( { type: function () { return true; }, limit: '1mb' } ), clerk_webhook );
	router.use( EXPRESS.json( { limit: BODY_LIMIT } ) );
	router.use( identify );
	router.use( authorize );


	//-----------------------------------------------------------------
	// Identity (plan User Management, Step 2): every request is the owner account, saying who it is with the
	// X-Consensus-Service header, or a run on its run token; an unknown token is refused. request.Participant is the
	// account: { Name, Display, Role, Service, Token, Writes, Speaker }, Speaker the key the rules run over. A run
	// whose task writes nothing (plan LLM Tasks, Step 1: Writes none) is refused every request but a read.
	// Step 4: a Bearer value that is no token of ours is tried as a Clerk session token, its user the account; on a
	// Public server a bare request is refused with "sign in" (on Local it stays the owner, and a session is the owner's).
	// Plan Clerk, Step 5: a session whose license is below what the person's roles need is refused with "license" and
	// the plan wanted (Host for the Administrator, User for an Owner or a Member; a Watcher needs none).

	async function identify( request, response, next )
	{
		let authorization = ( request.get( 'Authorization' ) || '' ).trim();
		let service = request.get( PARTICIPANTS.SERVICE_HEADER );
		if ( !authorization && PARTICIPANTS.Trust( settings ) === 'clerk' )
		{
			return fail( response, 401, 'sign in' );
		}
		let participant = PARTICIPANTS.Identify( settings, { Authorization: authorization, Service: service }, tokens, users );
		let session = false;
		if ( !participant && clerk && clerk.On() )
		{
			let match = /^Bearer\s+(.+)$/i.exec( authorization );
			session = !!( match && clerk.Looks( match[ 1 ].trim() ) );
			if ( session )
			{
				participant = await clerk_participant( match[ 1 ].trim(), service, page_host( request ) );
			}
		}
		if ( participant && participant.Refused )
		{
			return fail( response, 401, 'license', { Plan: participant.Refused, Has: participant.Has || null } );
		}
		if ( !participant )
		{
			return fail( response, 401, session ? 'sign in' : 'unknown token' );
		}
		if ( participant.Writes === 'none' && request.method !== 'GET' && request.method !== 'HEAD' )
		{
			return fail( response, 403, 'this run reads only' );
		}
		request.Participant = participant;
		next();
	}


	// A Clerk session token (Step 4): the registry record of its subject as the account, written from the token's claims
	// when the registry lacks it (on a Local server the owner's record); null when the token is no live session of this
	// instance. Plan Clerk, Step 5: the account carries the session's Plan; the first sign-in with a Host license on a
	// Public server with no Administrator becomes it; a plan below what the person's roles need is a refusal
	// ({ Refused: the plan wanted, Has }) that identify answers with 401 "license".
	async function clerk_participant( value, service, host )
	{
		let found = null;
		try
		{
			found = await clerk.Session( value, host );
		}
		catch ( error )
		{
			found = null;
		}
		if ( !found )
		{
			return null;
		}
		let account = ( found.Record.Type === 'owner' ) ? PARTICIPANTS.Identify( settings, { Service: service }, tokens, users ) : PARTICIPANTS.UserAccount( settings, users, found.Record, PARTICIPANTS.ServiceOf( service ), null );
		account.Plan = found.License ? found.License.Plan : null;
		account.Session = true;
		if ( account.Type !== 'owner' && !admin_email() && found.Record.Email && ROLES.PlanRank( account.Plan ) >= ROLES.PlanRank( 'Host' ) )
		{
			settings.Clerk = Object.assign( {}, settings.Clerk || {}, { AdminEmail: found.Record.Email } );
			await store.WriteSettings( settings );
			console.log( 'the Administrator is ' + found.Record.Email + ': the first sign-in with a Host license' );
			events.Send( { Settings: true, Kind: 'settings' } );
			account.Admin = true;
		}
		let needed = await needed_plan( account );
		if ( needed && ROLES.PlanRank( account.Plan ) < ROLES.PlanRank( needed ) )
		{
			return { Refused: needed, Has: account.Plan };
		}
		return account;
	}


	// The host the page used (plan Clerk, Step 7): the desktop's page server forwards to its own server over the
	// loopback and says which host the window had, so a session's azp still matches; from anywhere else the Host header.
	function page_host( request )
	{
		let forwarded = request.get( 'x-forwarded-host' );
		let address = ( request.socket && request.socket.remoteAddress ) ? request.socket.remoteAddress : '';
		if ( forwarded && LOOPBACK.includes( address ) )
		{
			return forwarded;
		}
		return request.get( 'host' );
	}


	function admin_email()
	{
		return ( settings.Clerk && typeof settings.Clerk.AdminEmail === 'string' ) ? settings.Clerk.AdminEmail.trim() : '';
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


	// Clerk's events (Step 4), signed the Svix way over the raw body: the registry follows them (Clerk.Handle), and an
	// account Clerk removed goes out of every project's role folders too.
	async function clerk_webhook( request, response )
	{
		if ( !clerk || !users )
		{
			return fail( response, 404, 'no Clerk on this server' );
		}
		let body = Buffer.isBuffer( request.body ) ? request.body.toString( 'utf8' ) : '';
		if ( !clerk.VerifyWebhook( request.headers, body ) )
		{
			return fail( response, 401, 'bad webhook signature' );
		}
		let event = null;
		try
		{
			event = JSON.parse( body );
		}
		catch ( error )
		{
			return fail( response, 400, 'the body is not JSON' );
		}
		let handled = clerk.Handle( event );
		if ( handled.Removed )
		{
			await clear_roles( handled.Removed.Id );
		}
		if ( handled.Record || handled.Removed )
		{
			events.Send( { Kind: 'users' } );
		}
		console.log( 'clerk webhook ' + handled.Line );
		response.json( { Handled: handled.Type, Line: handled.Line } );
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


	// Authorization (plan User Management, Step 3): the owner account passes; anyone else is checked against the
	// route's action (Roles.js) and their role in the route's project, found before the route runs; the server's own
	// routes are the Administrator's; the list routes narrow themselves; an account's own page checks itself.
	// request.Role is the role found, and the account carries it as ProjectRole for the rules.
	async function authorize( request, response, next )
	{
		let account = request.Participant;
		request.Role = null;
		if ( account.Role === 'owner' )
		{
			request.Role = 'Owners';
			account.ProjectRole = 'Owners';
			return next();
		}
		let rule = ROLES.Rule( request.method, request.path );
		if ( rule.Action === 'open' || rule.Action === 'list' || rule.Action === 'self' )
		{
			return next();
		}
		if ( rule.Action === 'admin' )
		{
			if ( account.Admin )
			{
				return next();
			}
			return fail( response, 403, 'the Administrator\'s' );
		}
		let project = null;
		try
		{
			project = await project_for( rule, request );
		}
		catch ( error )
		{
			return fail( response, 500, 'internal error: ' + error.message );
		}
		if ( !project )
		{
			return fail( response, 404, ( rule.Source === 'body' || rule.Source === 'query' ) ? 'a Project is needed' : 'no such project' );
		}
		let role = ROLES.RoleOf( project, account.Id );
		if ( rule.Action === 'roles' && account.Admin )
		{
			request.Role = role;
			return next();
		}
		if ( !role || !ROLES.Allows( role, rule.Action ) )
		{
			return fail( response, 403, ROLES.Reason( role, rule.Action ) );
		}
		request.Role = role;
		request.ProjectId = project.Id;
		account.ProjectRole = role;
		next();
	}


	// The project a route is about: by its id, the plan's or the item's project, or the Project field of the body or the query.
	async function project_for( rule, request )
	{
		if ( rule.Source === 'param' )
		{
			return await store.ReadProject( rule.Id );
		}
		if ( rule.Source === 'plan' || rule.Source === 'item' )
		{
			return await store.ProjectOf( rule.Id );
		}
		let id = ( rule.Source === 'body' ) ? ( request.body || {} ).Project : request.query.Project;
		return id ? await store.ReadProject( String( id ) ) : null;
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


	// An account's roles by project id, for /api/me; empty for the owner, who needs none.
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


	// The speakers the rules run over (Participants.SeenSpeakers): the owner, one per LLM connection, the Owners of the
	// plan's project (plan Multiuser), and everyone seen in the threads given.
	async function speakers( plan_id, threads, account )
	{
		return PARTICIPANTS.SeenSpeakers( settings, threads || [], account || null, await owners_of( plan_id ) );
	}


	// The person an account acts for, when it acts through a connection or a service (plan Multiuser: a run serves the
	// resolved threads waiting on its presser); null for a person acting in their own name.
	function person_of( account )
	{
		return account.Service ? account.Name : null;
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
			view.WaitingOnMe = RULES.WaitingOn( name, [ thread ], all, person_of( account ) ).length > 0;
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

	router.get( '/me', async function ( request, response )
	{
		let account = ( users && request.Participant.Id ) ? users.Public( users.Get( request.Participant.Id ), false ) : null;
		response.json( { Me: PARTICIPANTS.Public( request.Participant ), Account: account, Admin: is_admin( request.Participant ), Roles: await roles_of( request.Participant ), Participants: await speakers( null, [], request.Participant ), States: states(), Version: VERSION, Server: settings.Name || null } );
	} );


	//-----------------------------------------------------------------
	// Settings: consensus.json, read whole and written by the Administrator (the settings modal; the owner on a Local
	// server): the server's fields (Name,
	// Port, Scope, States, Owner, Clerk, Tasks) replace what the file has, and any other field (the desktop's, plan Run Shapes)
	// stays as it is. Everything applies at once but Scope and Port, which take effect at the next start; the answer
	// says when a restart is needed.

	router.get( '/settings', function ( request, response )
	{
		if ( !is_admin( request.Participant ) )
		{
			return fail( response, 403, 'only the Administrator reads the settings' );
		}
		response.json( { Settings: settings, Path: store.SettingsPath() } );
	} );


	router.put( '/settings', async function ( request, response )
	{
		if ( !is_admin( request.Participant ) )
		{
			return fail( response, 403, 'only the Administrator writes the settings' );
		}
		let body = request.body || {};
		let clean = PARTICIPANTS.Clean( body.Settings || body );
		// The Clerk section is the file's since 2026-10-20 (it left the Settings popup): a body without one keeps it.
		if ( ( body.Settings || body ).Clerk === undefined && settings.Clerk !== undefined )
		{
			clean.Clerk = settings.Clerk;
		}
		let problems = PARTICIPANTS.Validate( clean );
		if ( problems.length )
		{
			return fail( response, 400, 'the settings have problems: ' + problems[ 0 ], { Problems: problems } );
		}
		let before = { Scope: PARTICIPANTS.Scope( settings ), Port: settings.Port };
		// Plan Clerk, Step 5: a server goes Public from a session with a Host license alone.
		if ( clean.Scope === 'Public' && before.Scope !== 'Public' && ROLES.PlanRank( request.Participant.Plan ) < ROLES.PlanRank( 'Host' ) )
		{
			return fail( response, 403, 'a Host license is required to run a Public server: sign in with one first', { Plan: 'Host' } );
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
		response.json( { Settings: settings, Restart: restart } );
	} );


	//-----------------------------------------------------------------
	// Plans

	router.get( '/plans', async function ( request, response )
	{
		let plans = await store.ListPlans();
		let state = request.query.state;
		let visible = await visible_plan_ids( request.Participant );
		let list = [];
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
			list.push( await summarize( plan, read ? read.Threads : [], request.Participant ) );
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
		response.status( 201 ).json( { Plan: await summarize( result.Plan, [], request.Participant ), Project: result.Project } );
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
			Participants: await speakers( request.params.id, read.Threads, request.Participant ),
			Project: holder ? { Id: holder.Id, Name: holder.Name } : null,
			Context: !!( holder && holder.Context === request.params.id ),
			Plan: await summarize( read.Plan, read.Threads, name ),
			Text: read.Text,
			Threads: await present_threads( request.params.id, read.Threads, read.Text, name ),
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


	// A plan's state: one of its project's States, set by an Owner at any time (plan Multiuser). { State }
	router.put( '/plans/:id/state', async function ( request, response )
	{
		let wanted = ( request.body || {} ).State;
		let id = request.params.id;
		let may = RULES.MaySetState( request.Participant );
		if ( !may.Ok )
		{
			return fail( response, 403, may.Reason );
		}
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
		let projects = await visible_projects( request.Participant );
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
	// its GitSync and AutoCommit (Step 3; false is dropped from the file) and its Llm (Step 6: the connection the plan
	// page's buttons run through; null drops it); a state still used by one of its plans cannot be removed.
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
		} );
		send_result( response, result, 200, { Project: result.Project } );
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
		let names = PARTICIPANTS.Speakers( settings ).map( function ( speaker ) { return speaker.Name; } );
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
		let filtered = RULES.Filter( read.Threads, request.query.status, await speakers( request.params.id, read.Threads, name ), name.Speaker, person_of( name ) );
		if ( !filtered )
		{
			return fail( response, 400, 'unknown status filter "' + request.query.status + '"' );
		}
		response.json( { Threads: await present_threads( request.params.id, filtered, read.Text, name ) } );
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
			return ( await present_threads( id, [ thread ], read.Text, request.Participant ) )[ 0 ];
		} );
		if ( !result )
		{
			return;
		}
		changed( id, 'anchored', result.Id );
		response.json( { Thread: result } );
	} );


	// Resolve: the starter or an Owner (plan Multiuser), contested threads only. Resolving accepts the outcome stated in
	// the last reply.
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
			return ( await present_threads( id, [ thread ], read.Text, request.Participant ) )[ 0 ];
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
		let visible = await visible_plan_ids( request.Participant );
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
			let threads = RULES.WaitingOn( name.Speaker, read.Threads, await speakers( plan.Id, read.Threads, name ), person_of( name ) );
			for ( let thread of await present_threads( plan.Id, threads, read.Text, name ) )
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
		response.json( { Tasks: project ? TASKS.Enabled( settings, project ) : ( settings.Tasks || [] ), Writes: TASKS.WRITES, Package: TASKS.PACKAGE_ITEMS, Off: TASKS.OFF_BY_DEFAULT, Defaults: TASKS.Defaults() } );
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
		let made = await runner.Package( body_of( request ), undefined, request.Participant );
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
		if ( request.Participant.Role !== 'owner' )
		{
			let task = TASKS.ById( settings, ( request.body || {} ).Task );
			if ( task && !ROLES.MayPress( request.Role, task.Writes ) )
			{
				return fail( response, 403, ROLES.Reason( request.Role, 'press' ) );
			}
		}
		let started = await runner.Start( body_of( request ), request.Participant );
		if ( started.Error )
		{
			return fail( response, started.Status || 400, started.Error );
		}
		response.status( 201 ).json( { Run: started.Run } );
	} );


	// The summaries, newest first; of one connection with ?Llm=, with its running one; of a project, a task or an asker
	// with ?Project=, ?Task= and ?By= (plan LLM Tasks, Step 4: a person's Explain runs of a project are the conversation).
	router.get( '/runs', function ( request, response )
	{
		if ( !runs )
		{
			return fail( response, 503, 'this server runs no LLMs' );
		}
		let llm_id = request.query.Llm || undefined;
		let filter = { Llm: llm_id, Project: request.query.Project || undefined, Task: request.query.Task || undefined, By: request.query.By || undefined };
		response.json( { Runs: runs.List( filter ), Running: llm_id ? runs.Running( llm_id ) : null } );
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
		if ( !own_run( request, response ) )
		{
			return;
		}
		if ( !runs.Stop( request.params.id ) )
		{
			return fail( response, 404, 'no running run with the id ' + request.params.id );
		}
		response.json( { Stopped: true } );
	} );


	// A record removed (plan LLM Tasks, Step 4: Clear in the Explain tab); not a running one.
	router.delete( '/runs/:id', function ( request, response )
	{
		if ( !may_run( request, response ) )
		{
			return;
		}
		if ( !/^[a-z0-9-]+$/.test( request.params.id ) )
		{
			return fail( response, 404, 'no run with the id ' + request.params.id );
		}
		if ( !own_run( request, response ) )
		{
			return;
		}
		try
		{
			if ( !runs.Delete( request.params.id ) )
			{
				return fail( response, 404, 'no run with the id ' + request.params.id );
			}
		}
		catch ( error )
		{
			return fail( response, 409, error.message );
		}
		response.json( { Deleted: request.params.id } );
	} );


	// A run is stopped or deleted by the one who asked for it, or the Administrator (plan User Management, Step 3).
	function own_run( request, response )
	{
		if ( is_admin( request.Participant ) )
		{
			return true;
		}
		let run = /^[a-z0-9-]+$/.test( request.params.id ) ? runs.Read( request.params.id ) : null;
		if ( run && run.By === request.Participant.Name )
		{
			return true;
		}
		fail( response, 403, 'another account\'s run' );
		return false;
	}


	//-----------------------------------------------------------------
	// Users and roles (plan User Management, Step 3): the registry (Users.js), every account seeing the list, an
	// account's own page or the Administrator's seeing a page; the tokens minted and revoked there, the value shown
	// once; the activity read from what the threads and revisions record; and a project's role folders (Roles.js).

	function is_admin( account )
	{
		return !!account && ( account.Role === 'owner' || account.Admin === true );
	}


	function may_see( account, id )
	{
		return is_admin( account ) || ( !!account && account.Id === id );
	}


	function needs_users( response )
	{
		if ( !users )
		{
			fail( response, 503, 'this server keeps no users' );
			return false;
		}
		return true;
	}


	router.get( '/users', function ( request, response )
	{
		if ( !needs_users( response ) )
		{
			return;
		}
		response.json( { Users: users.List().map( function ( record ) { return users.Public( record, false ); } ), Admin: is_admin( request.Participant ) } );
	} );


	// A user (Type user, with an email: the record Clerk completes at the first sign-in) or a Service account (Type service).
	router.post( '/users', function ( request, response )
	{
		if ( !needs_users( response ) )
		{
			return;
		}
		let body = request.body || {};
		try
		{
			let record = users.Create( { Type: body.Type, Login: body.Login, Display: body.Display, Email: body.Email } );
			events.Send( { Kind: 'users' } );
			response.status( 201 ).json( { User: users.Public( record, true ) } );
		}
		catch ( error )
		{
			fail( response, 400, error.message );
		}
	} );


	router.get( '/users/:id', function ( request, response )
	{
		if ( !needs_users( response ) )
		{
			return;
		}
		let record = users.Get( request.params.id );
		if ( !record )
		{
			return fail( response, 404, 'no account with the id ' + request.params.id );
		}
		if ( !may_see( request.Participant, record.Id ) )
		{
			return fail( response, 403, 'another account\'s page' );
		}
		response.json( { User: users.Public( record, true ), Admin: users.IsAdmin( settings, record ) } );
	} );


	// The Administrator changes a login, a display and an email; an account its own display.
	router.put( '/users/:id', function ( request, response )
	{
		if ( !needs_users( response ) )
		{
			return;
		}
		let record = users.Get( request.params.id );
		if ( !record )
		{
			return fail( response, 404, 'no account with the id ' + request.params.id );
		}
		if ( !may_see( request.Participant, record.Id ) )
		{
			return fail( response, 403, 'another account\'s page' );
		}
		let body = request.body || {};
		let fields = is_admin( request.Participant ) ? { Login: body.Login, Display: body.Display, Email: body.Email } : { Display: body.Display };
		try
		{
			let changed_record = users.Update( record.Id, fields );
			events.Send( { Kind: 'users' } );
			response.json( { User: users.Public( changed_record, true ) } );
		}
		catch ( error )
		{
			fail( response, 400, error.message );
		}
	} );


	// An account deleted: out of every project's role folders, its tokens gone with it; never the owner.
	router.delete( '/users/:id', async function ( request, response )
	{
		if ( !needs_users( response ) )
		{
			return;
		}
		let record = users.Get( request.params.id );
		if ( !record )
		{
			return fail( response, 404, 'no account with the id ' + request.params.id );
		}
		if ( record.Type === 'owner' )
		{
			return fail( response, 409, 'the owner is not deleted' );
		}
		await clear_roles( record.Id );
		users.Delete( record.Id );
		events.Send( { Kind: 'users' } );
		response.json( { Deleted: record.Id } );
	} );


	// A token minted: its value answered once. An account mints its own; the Administrator a Service account's.
	router.post( '/users/:id/tokens', function ( request, response )
	{
		if ( !needs_users( response ) )
		{
			return;
		}
		let record = users.Get( request.params.id );
		if ( !record )
		{
			return fail( response, 404, 'no account with the id ' + request.params.id );
		}
		if ( !may_see( request.Participant, record.Id ) || ( record.Type === 'service' && !is_admin( request.Participant ) ) )
		{
			return fail( response, 403, 'another account\'s tokens' );
		}
		let name = text_of( ( request.body || {} ).Name ).trim();
		try
		{
			let value = users.MintToken( record.Id, name );
			response.status( 201 ).json( { Token: value, Name: name } );
		}
		catch ( error )
		{
			fail( response, 400, error.message );
		}
	} );


	router.delete( '/users/:id/tokens/:name', function ( request, response )
	{
		if ( !needs_users( response ) )
		{
			return;
		}
		let record = users.Get( request.params.id );
		if ( !record )
		{
			return fail( response, 404, 'no account with the id ' + request.params.id );
		}
		if ( !may_see( request.Participant, record.Id ) )
		{
			return fail( response, 403, 'another account\'s tokens' );
		}
		if ( !users.RevokeToken( record.Id, request.params.name ) )
		{
			return fail( response, 404, 'no token named ' + request.params.name );
		}
		response.json( { Revoked: request.params.name } );
	} );


	// The activity of an account on the server: the threads it opened, its replies, resolves, applies and revisions,
	// newest first, as the plans record them (a state change leaves no record today).
	router.get( '/users/:id/activity', async function ( request, response )
	{
		if ( !needs_users( response ) )
		{
			return;
		}
		let record = users.Get( request.params.id );
		if ( !record )
		{
			return fail( response, 404, 'no account with the id ' + request.params.id );
		}
		if ( !may_see( request.Participant, record.Id ) )
		{
			return fail( response, 403, 'another account\'s page' );
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
		response.json( { User: users.Public( record, false ), Activity: entries.slice( 0, ACTIVITY_LIMIT ) } );
	} );


	// A project's role folders: { Owners, Members, Service, Watchers }, each a list of account ids, an account in one
	// at most; an id that is no account is refused; the owner's record is never in a folder.
	router.put( '/projects/:pid/roles', async function ( request, response )
	{
		if ( !needs_users( response ) )
		{
			return;
		}
		let roles = ROLES.Clean( request.body || {} );
		for ( let role of ROLES.ROLES )
		{
			for ( let id of roles[ role ] )
			{
				let record = users.Get( id );
				if ( !record )
				{
					return fail( response, 400, 'no account with the id ' + id );
				}
				if ( record.Type === 'owner' )
				{
					return fail( response, 400, 'the owner needs no role folder' );
				}
				if ( ( record.Type === 'service' ) !== ( role === 'Service' ) )
				{
					return fail( response, 400, ( record.Type === 'service' ) ? 'a Service account goes in the Service folder only' : 'the Service folder takes Service accounts only' );
				}
				// Plan Clerk, Step 5: a person seen without the plan the folder needs stays out of it.
				let needed = ROLES.PlanFor( role );
				if ( needed && record.Clerk && ROLES.PlanRank( record.Plan ) < ROLES.PlanRank( needed ) )
				{
					return fail( response, 400, record.Login + ' needs a ' + needed + ' license to be in ' + role, { Plan: needed } );
				}
			}
		}
		let result = await change_project( request.params.pid, ( request.body || {} ).Version, async function ( project )
		{
			project.Roles = roles;
		} );
		send_result( response, result, 200, { Project: result.Project } );
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
