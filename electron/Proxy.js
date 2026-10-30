'use strict';

// Proxy - the local API, MCP and instructions of the Client and the Desktop (plan Review 2026-10-29, Step 5.3: every
// edition serves them on its localhost address). Neither app has a server of its own: on their page server
// (electron/Page.js, its Proxy option), beside /servers/<key>/api, this router forwards /api/* to the window's upstream,
// the Server the window is on now (the Client's one Server; in the Desktop the current root, the Server whose project is
// open), composes /instructions locally, and answers /api/mcp as a server does, each tool call becoming the upstream's
// REST request. A request with no Authorization gets the person's session token, which the page hands the app at every
// load and refresh (session.js, ConsensusDesktop.SetToken); with no token yet (nobody signed in) the proxy answers 401
// "sign in", as a Server would; a request carrying its own token is passed as it is. X-Consensus-Service passes
// through, so an agent beside the window posts as "<service> by <person>". The upstream does the authorizing: the proxy
// refuses nothing of its own. The stdio shim (bin/mcp.js) reaches the MCP as it reaches any server, with --server
// http://127.0.0.1:<page port>.
//
//   Make( { Upstream, Token, About, Guide? } ) -> an Express router for Page.Serve( { Proxy } )
//     Upstream()   -> { Name, Url } the Server the window's calls go to now, or null (503 "no Server open in this window")
//     Token()      -> the person's session token, or null (electron/App.js Tokens)
//     About()      -> { Edition, Project?, Others? } for the composed instructions (src/Instructions.js Local): the
//                     edition's name, the window's project { Id, Name } when it has one, the Desktop's other Servers' names
//     Guide        the guide's path; the common one, .guides/build-with-consensus.md, when none
//   NO_UPSTREAM, SIGN_IN   the two sentences the proxy answers on its own

const EXPRESS = require( 'express' );
const PAGE = require( './Page.js' );
const MCP = require( '../src/Mcp.js' );
const OPERATIONS = require( '../src/Operations.js' );
const INSTRUCTIONS = require( '../src/Instructions.js' );
const PARTICIPANTS = require( '../src/Participants.js' );

const BODY_LIMIT = '20mb';
const NO_UPSTREAM = 'no Server open in this window';
const SIGN_IN = 'sign in';
const PARSE_ERROR = -32700;


function Make( Fields )
{
	let fields = Fields || {};
	let router = EXPRESS.Router();
	let mcp = MCP.Mcp( { Operations: remote_operations() } );

	router.post( '/api/mcp', EXPRESS.text( { type: function () { return true; }, limit: BODY_LIMIT } ), mcp_route );
	router.all( '/api/mcp', function ( request, response )
	{
		response.set( 'Allow', 'POST' );
		response.status( 405 ).json( { Error: 'POST a JSON-RPC message' } );
	} );
	router.get( '/instructions', instructions_route );
	router.use( '/api', forward_route );


	//-----------------------------------------------------------------
	// The token a request goes upstream with: its own Bearer, else the person's; null when there is neither.

	function own_token( request )
	{
		let match = /^Bearer\s+(.+)$/i.exec( ( request.get( 'Authorization' ) || '' ).trim() );
		return match ? match[ 1 ].trim() : null;
	}


	function token_for( request )
	{
		return own_token( request ) || ( fields.Token ? fields.Token() : null ) || null;
	}


	function upstream_now()
	{
		let upstream = fields.Upstream ? fields.Upstream() : null;
		if ( !upstream || typeof upstream.Url !== 'string' || !upstream.Url )
		{
			return null;
		}
		return { Name: upstream.Name || '', Url: upstream.Url.replace( /\/+$/, '' ) };
	}


	//-----------------------------------------------------------------
	// /api/*: forwarded to the upstream as it is, the person's token added when the request carries none.

	function forward_route( request, response )
	{
		let upstream = upstream_now();
		if ( !upstream )
		{
			response.status( 503 ).json( { Error: NO_UPSTREAM } );
			return;
		}
		let headers = {};
		if ( !own_token( request ) )
		{
			let token = fields.Token ? fields.Token() : null;
			if ( !token )
			{
				response.status( 401 ).json( { Error: SIGN_IN } );
				return;
			}
			headers.authorization = 'Bearer ' + token;
		}
		PAGE.Forward( upstream.Url, request, response, { Path: request.originalUrl, Headers: headers } );
	}


	//-----------------------------------------------------------------
	// /instructions: This server composed here, then the common guide.

	async function instructions_route( request, response )
	{
		let guide = null;
		try
		{
			guide = await INSTRUCTIONS.Guide( fields.Guide || null );
		}
		catch ( error )
		{
			response.status( 500 ).type( 'text/plain' ).send( 'the guide is missing: ' + error.message + '\n' );
			return;
		}
		let about = fields.About ? ( fields.About() || {} ) : {};
		let base = request.protocol + '://' + request.get( 'host' );
		let text = INSTRUCTIONS.Local( base, guide, {
			Edition: about.Edition || 'application',
			Upstream: upstream_now(),
			Project: about.Project || null,
			Others: about.Others || [],
			SignedIn: !!( fields.Token && fields.Token() ),
		} );
		response.type( 'text/plain; charset=utf-8' ).send( text );
	}


	//-----------------------------------------------------------------
	// /api/mcp: the protocol over the definition (src/Mcp.js), each tool call the upstream's REST request as the
	// participant the request's headers make: its token (or the person's) and its service name.

	async function mcp_route( request, response )
	{
		let token = token_for( request );
		if ( !token )
		{
			response.status( 401 ).json( { Error: SIGN_IN } );
			return;
		}
		let text = ( typeof request.body === 'string' ) ? request.body : ( Buffer.isBuffer( request.body ) ? request.body.toString( 'utf8' ) : '' );
		let message = null;
		try
		{
			message = JSON.parse( text );
		}
		catch ( error )
		{
			response.json( { jsonrpc: '2.0', id: null, error: { code: PARSE_ERROR, message: 'the body is not JSON' } } );
			return;
		}
		let participant = { Token: token, Service: request.get( PARTICIPANTS.SERVICE_HEADER ) || null };
		try
		{
			let answer = await mcp.Handle( message, participant );
			if ( answer === null || ( Array.isArray( answer ) && !answer.length ) )
			{
				response.status( 202 ).end();
				return;
			}
			response.json( answer );
		}
		catch ( error )
		{
			response.status( 500 ).json( { Error: error.message } );
		}
	}


	// The operations as Mcp.js wants them: the definition alone (no store behind it), and Perform as the upstream's
	// request through Operations.Route; a refused request is a Refusal with the upstream's status and sentence.
	function remote_operations()
	{
		let definition = OPERATIONS.Definition();
		return {
			List: definition,
			Get: function ( Name )
			{
				return definition.find( function ( operation ) { return operation.Name === Name; } ) || null;
			},
			Perform: perform_upstream,
		};
	}


	async function perform_upstream( Name, Participant, Arguments )
	{
		let operation = remote_operations().Get( Name );
		if ( !operation )
		{
			throw new OPERATIONS.Refusal( 404, 'unknown operation: ' + Name );
		}
		let upstream = upstream_now();
		if ( !upstream )
		{
			throw new OPERATIONS.Refusal( 503, NO_UPSTREAM );
		}
		let route = OPERATIONS.Route( operation, Arguments );
		let url = new URL( upstream.Url + '/api' + route.Path );
		for ( let key of Object.keys( route.Query || {} ) )
		{
			url.searchParams.set( key, route.Query[ key ] );
		}
		let headers = { Authorization: 'Bearer ' + Participant.Token };
		if ( Participant.Service )
		{
			headers[ PARTICIPANTS.SERVICE_HEADER ] = Participant.Service;
		}
		let options = { method: route.Method, headers: headers };
		if ( route.Body )
		{
			headers[ 'Content-Type' ] = 'application/json';
			options.body = JSON.stringify( route.Body );
		}
		let response = null;
		try
		{
			response = await fetch( url, options );
		}
		catch ( error )
		{
			throw new OPERATIONS.Refusal( 502, 'the Server at ' + upstream.Url + ' does not answer: ' + error.message );
		}
		let type = response.headers.get( 'content-type' ) || '';
		let text = await response.text();
		let body = text;
		if ( /json/i.test( type ) )
		{
			try
			{
				body = JSON.parse( text );
			}
			catch ( error )
			{
				body = text;
			}
		}
		if ( !response.ok )
		{
			let sentence = ( body && typeof body === 'object' && body.Error ) ? body.Error : ( text || response.statusText );
			let extra = null;
			if ( body && typeof body === 'object' )
			{
				extra = Object.assign( {}, body );
				delete extra.Error;
				if ( !Object.keys( extra ).length )
				{
					extra = null;
				}
			}
			throw new OPERATIONS.Refusal( response.status, sentence, extra );
		}
		return OPERATIONS.Answer( response.status, body, type );
	}


	return router;
}


module.exports = {
	Make: Make,
	NO_UPSTREAM: NO_UPSTREAM,
	SIGN_IN: SIGN_IN,
};
