'use strict';

// Api - the REST routes under /api: the operations (Operations.js, plan MCP Server, Step 1) served over HTTP, each
// route one operation, the path's parameters, the query and the body folded into its arguments and its answer sent
// as JSON (a Refusal as { Error } with its status). Nothing is decided here: every rule lives in Operations.js or
// Rules.js, none in a client, so the page and the LLM's curl see the same API. What stays here is HTTP's own: the
// JSON body, who is calling (identify) and whether the route's action is theirs (authorize), Clerk's two routes before
// identify, the 404 and the error handler. POST /api/mcp (plan MCP Server, Step 2) is the Model Context Protocol's
// network transport: a JSON-RPC message (or a batch) in the body, handled by Mcp.js as the request's participant, each
// tool call checked against its own operation's action; a notification is answered 202 with nothing.
//
//   Attach( App, Context ) -> the operations (Operations.Operations( Context )), mounted under /api
//     Context = { Store, Settings, Events, Runs?, Runner?, Git?, Tokens?, Users?, Clerk? }
//
// Clerk (plan User Management, Step 4): the sign-in of a shared server; a Clerk session token is its user's account, a
// bare request on a Public server with Clerk keys is refused, and GET /clerk and POST /clerk/webhook serve the page and
// Clerk's events before identify.
// Users (plan User Management, Step 3): the registry; a user token is its account, every route is checked against
// the account's role in the project (authorize).

const EXPRESS = require( 'express' );
const PARTICIPANTS = require( './Participants.js' );
const ROLES = require( './Roles.js' );
const OPERATIONS = require( './Operations.js' );
const MCP = require( './Mcp.js' );

const BODY_LIMIT = '64mb';	// a project import is one json body, every revision of every plan in it
const LOOPBACK = [ '127.0.0.1', '::1', '::ffff:127.0.0.1' ];
const PARAM_NAMES = OPERATIONS.PARAM_NAMES;


//---------------------------------------------------------------------
// Attach: mounts the routes on an Express app.

function Attach( App, Context )
{
	let store = Context.Store;
	let settings = Context.Settings;
	let events = Context.Events;
	let tokens = Context.Tokens || null;
	let users = Context.Users || null;
	let clerk = Context.Clerk || null;
	let operations = OPERATIONS.Operations( Context );
	let mcp = MCP.Mcp( { Operations: operations, Store: store, Authorize: authorize_operation } );
	let router = EXPRESS.Router();
	// Before identify (Step 4): what the page needs to sign in, and Clerk's events over the raw body.
	router.get( '/clerk', function ( request, response )
	{
		response.json( clerk ? clerk.Config() : { On: false, Required: false, PublishableKey: null, FrontendApi: null, Pricing: null } );
	} );
	router.post( '/clerk/webhook', EXPRESS.raw( { type: function () { return true; }, limit: '1mb' } ), clerk_webhook );
	// The MCP transport reads its body as text, so that a body that is not JSON is answered the protocol's way.
	router.post( '/mcp', EXPRESS.text( { type: function () { return true; }, limit: BODY_LIMIT } ), identify, authorize, mcp_route );
	router.all( '/mcp', function ( request, response )
	{
		response.set( 'Allow', 'POST' );
		fail( response, 405, 'POST a JSON-RPC message' );
	} );
	router.use( EXPRESS.json( { limit: BODY_LIMIT } ) );
	router.use( identify );
	router.use( authorize );
	for ( let operation of operations.List )
	{
		router[ operation.Method.toLowerCase() ]( operation.Path, serve( operation ) );
	}


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
	// instance. Plan Clerk, Step 5: the account carries the session's Plan; the first sign-in with a Personal or
	// Professional license (plan The Server, Step 2; Professional alone before) on a server with no Administrator becomes it; a plan below what the person's roles need is a refusal
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
		if ( account.Type !== 'owner' && !admin_email() && found.Record.Email && ROLES.PlanRank( account.Plan ) >= ROLES.PlanRank( 'personal' ) )
		{
			settings.Clerk = Object.assign( {}, settings.Clerk || {}, { AdminEmail: found.Record.Email } );
			await store.WriteSettings( settings );
			console.log( 'the Administrator is ' + found.Record.Email + ': the first sign-in with a Personal or Professional license' );
			events.Send( { Settings: true, Kind: 'settings' } );
			account.Admin = true;
			account.Manager = false;
		}
		let needed = await operations.Shared.NeededPlan( account );
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
			await operations.Shared.ClearRoles( handled.Removed.Id );
		}
		if ( handled.Record || handled.Removed )
		{
			events.Send( { Kind: 'users' } );
		}
		console.log( 'clerk webhook ' + handled.Line );
		response.json( { Handled: handled.Type, Line: handled.Line } );
	}


	//-----------------------------------------------------------------
	// Authorization (plan User Management, Step 3): the owner account passes; anyone else is checked against the
	// route's action (Roles.js) and their role in the route's project, found before the route runs; the server's own
	// routes are the Administrator's and the Managers' (plan The Server, Step 2: a Manager manages as the Administrator
	// does; assigning Managers is checked in the operation); the list routes narrow themselves; an account's own page
	// checks itself.
	// request.Role is the role found, and the account carries it as ProjectRole for the rules and the operations.
	// check() is the rule itself, over a method, a path and the arguments, so that the MCP transport asks it for each
	// tool call (authorize_operation) as the middleware asks it for each request.

	async function authorize( request, response, next )
	{
		let found = null;
		try
		{
			found = await check( request.Participant, request.method, request.path, request.body, request.query );
		}
		catch ( error )
		{
			if ( OPERATIONS.IsRefusal( error ) )
			{
				return fail( response, error.Status, error.Error, error.Extra );
			}
			return fail( response, 500, 'internal error: ' + error.message );
		}
		request.Role = found.Role;
		if ( found.ProjectId )
		{
			request.ProjectId = found.ProjectId;
		}
		next();
	}


	// { Role, ProjectId } when the account may, else a Refusal thrown; the account's ProjectRole set for the rules.
	async function check( account, method, path, body, query )
	{
		if ( account.Role === 'owner' )
		{
			account.ProjectRole = 'Owners';
			return { Role: 'Owners', ProjectId: null };
		}
		let rule = ROLES.Rule( method, path );
		if ( rule.Action === 'open' || rule.Action === 'list' || rule.Action === 'self' )
		{
			return { Role: null, ProjectId: null };
		}
		let manages = !!( account.Admin || account.Manager );
		if ( rule.Action === 'admin' )
		{
			if ( manages )
			{
				return { Role: null, ProjectId: null };
			}
			throw new OPERATIONS.Refusal( 403, 'the Administrator\'s and the Managers\'' );
		}
		let project = await project_for( rule, body, query );
		if ( !project )
		{
			throw new OPERATIONS.Refusal( 404, ( rule.Source === 'body' || rule.Source === 'query' ) ? 'a Project is needed' : 'no such project' );
		}
		// An unmounted project (plan Rearchitecturation, Step 5) is the Administrator's and the Managers' alone: to anyone
		// else it is not there.
		if ( project.Mounted !== true && !manages )
		{
			throw new OPERATIONS.Refusal( 404, 'no such project' );
		}
		let role = ROLES.RoleOf( project, account.Id );
		if ( rule.Action === 'roles' && manages )
		{
			return { Role: role, ProjectId: null };
		}
		if ( !role || !ROLES.Allows( role, rule.Action ) )
		{
			throw new OPERATIONS.Refusal( 403, ROLES.Reason( role, rule.Action ) );
		}
		account.ProjectRole = role;
		return { Role: role, ProjectId: project.Id };
	}


	// The project a route is about: by its id, the plan's or the item's project, or the Project field of the body or the query.
	async function project_for( rule, body, query )
	{
		if ( rule.Source === 'param' )
		{
			return await store.ReadProject( rule.Id );
		}
		if ( rule.Source === 'plan' || rule.Source === 'item' )
		{
			return await store.ProjectOf( rule.Id );
		}
		let id = ( rule.Source === 'body' ) ? ( body || {} ).Project : ( query || {} ).Project;
		return id ? await store.ReadProject( String( id ) ) : null;
	}


	// The MCP transport's check of one tool call: the operation's route with the arguments, as the API would see it.
	async function authorize_operation( participant, operation, args )
	{
		let route = OPERATIONS.Route( operation, args );
		await check( participant, route.Method, route.Path, args, args );
	}


	//-----------------------------------------------------------------
	// Serving an operation: the query (its keys capitalized: state to State), the body and the path's parameters (by
	// PARAM_NAMES) folded into one Arguments object, the path's winning; the answer sent at the operation's status, an
	// Answer at its own (with its content type when it is a text); a Refusal as { Error } with its status.

	function serve( operation )
	{
		return async function ( request, response, next )
		{
			let args = {};
			for ( let key of Object.keys( request.query || {} ) )
			{
				args[ capitalized( key ) ] = request.query[ key ];
			}
			if ( request.body && typeof request.body === 'object' && !Array.isArray( request.body ) )
			{
				Object.assign( args, request.body );
			}
			for ( let key of Object.keys( request.params || {} ) )
			{
				args[ PARAM_NAMES[ key ] || capitalized( key ) ] = request.params[ key ];
			}
			try
			{
				let answer = await operations.Perform( operation.Name, request.Participant, args );
				send( response, operation, answer );
			}
			catch ( error )
			{
				if ( OPERATIONS.IsRefusal( error ) )
				{
					return fail( response, error.Status, error.Error, error.Extra );
				}
				next( error );
			}
		};
	}


	function send( response, operation, answer )
	{
		if ( OPERATIONS.IsAnswer( answer ) )
		{
			if ( answer.Type )
			{
				response.status( answer.Status ).type( answer.Type ).send( answer.Body );
				return;
			}
			response.status( answer.Status ).json( answer.Body );
			return;
		}
		response.status( operation.Status ).json( answer );
	}


	function capitalized( key )
	{
		return key ? key.charAt( 0 ).toUpperCase() + key.slice( 1 ) : key;
	}


	// The MCP transport: the body a JSON-RPC message or a batch, the reply as JSON; a notification 202 with nothing;
	// a body that is not JSON the protocol's parse error.
	async function mcp_route( request, response, next )
	{
		let text = ( typeof request.body === 'string' ) ? request.body : ( Buffer.isBuffer( request.body ) ? request.body.toString( 'utf8' ) : '' );
		let message = null;
		try
		{
			message = JSON.parse( text );
		}
		catch ( error )
		{
			return response.json( { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'the body is not JSON' } } );
		}
		try
		{
			let answer = await mcp.Handle( message, request.Participant );
			if ( answer === null || ( Array.isArray( answer ) && !answer.length ) )
			{
				return response.status( 202 ).end();
			}
			response.json( answer );
		}
		catch ( error )
		{
			next( error );
		}
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
	return operations;
}


module.exports = {
	Attach: Attach,
};
