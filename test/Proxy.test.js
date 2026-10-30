'use strict';

// Proxy.test - the local API, MCP and instructions of the Client and the Desktop (plan Review 2026-10-29, Step 5.3):
// electron/Proxy.js on the page server (electron/Page.js), over a stand-in upstream that records what reaches it (as
// test/Probe.test.js has one). A forwarded call carries the person's token; an agent's own token passes as it is; no
// token yet answers 401 "sign in"; X-Consensus-Service passes through; no upstream answers 503; the upstream's own
// refusals pass through; /instructions names the local address, the Server and the window's project over the common
// guide; an MCP tools/call becomes the upstream's REST request, and its refusal an error result; the upstream changes
// as the Desktop's current root does. App.Tokens keeps the latest token and its expiry.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const HTTP = require( 'http' );
const PAGE = require( '../electron/Page.js' );
const PROXY = require( '../electron/Proxy.js' );
const APP = require( '../electron/App.js' );
const INSTRUCTIONS = require( '../src/Instructions.js' );


// A stand-in Server: it records every request (method, path, the Authorization and X-Consensus-Service headers, the
// body) and answers /api/me, /api/plans (POST) and /api/plans/<id> (GET), 404 otherwise.
function stand_in()
{
	return new Promise( function ( Resolve )
	{
		let seen = [];
		let server = HTTP.createServer( function ( request, response )
		{
			let chunks = [];
			request.on( 'data', function ( chunk ) { chunks.push( chunk ); } );
			request.on( 'end', function ()
			{
				let body = Buffer.concat( chunks ).toString( 'utf8' );
				let path = request.url.split( '?' )[ 0 ];
				seen.push( { Method: request.method, Url: request.url, Authorization: request.headers.authorization || null, Service: request.headers[ 'x-consensus-service' ] || null, Body: body || null } );
				function answer( status, json )
				{
					response.writeHead( status, { 'Content-Type': 'application/json; charset=utf-8' } );
					response.end( JSON.stringify( json ) );
				}
				if ( request.url === '/api/me' )
				{
					answer( 200, { Me: { Name: 'ann', Role: 'Owners' }, Server: 'Team' } );
				}
				else if ( path === '/api/plans' && request.method === 'POST' )
				{
					let given = JSON.parse( body );
					answer( 201, { Plan: { Id: 'pln-new', Title: given.Title } } );
				}
				else if ( request.url === '/api/plans/pln-1' )
				{
					answer( 200, { Plan: { Id: 'pln-1', Title: 'The first' } } );
				}
				else if ( request.url.startsWith( '/api/plans/' ) )
				{
					answer( 404, { Error: 'no such plan', Id: request.url.slice( '/api/plans/'.length ) } );
				}
				else
				{
					answer( 404, { Error: 'not found' } );
				}
			} );
		} );
		server.listen( 0, '127.0.0.1', function ()
		{
			Resolve( { Url: 'http://127.0.0.1:' + server.address().port, Seen: seen, Close: function () { return new Promise( function ( Done ) { server.close( Done ); } ); } } );
		} );
	} );
}


// The page server with the proxy over a mutable upstream, token and about.
async function serve_with( state )
{
	let proxy = PROXY.Make( {
		Upstream: function () { return state.Upstream; },
		Token: function () { return state.Token; },
		About: function () { return state.About; },
	} );
	return await PAGE.Serve( { Proxy: proxy } );
}


async function json_of( response )
{
	return { Status: response.status, Body: await response.json() };
}


TEST( 'the proxy forwards /api/* to the upstream with the person\'s token, passes an agent\'s own token and its service name as they are, and answers 401 "sign in" with no token and 503 with no Server', async function ()
{
	let upstream = await stand_in();
	let state = { Upstream: null, Token: null, About: { Edition: 'Client', Project: null, Others: [] } };
	let served = await serve_with( state );
	try
	{
		// no Server open: 503, nothing reaches the stand-in
		let none = await json_of( await fetch( served.Url + '/api/me' ) );
		ASSERT.deepEqual( none, { Status: 503, Body: { Error: PROXY.NO_UPSTREAM } } );
		state.Upstream = { Name: 'Team', Url: upstream.Url + '/' };
		// nobody signed in: 401 "sign in", as a Server answers a bare request
		let unsigned = await json_of( await fetch( served.Url + '/api/me' ) );
		ASSERT.deepEqual( unsigned, { Status: 401, Body: { Error: PROXY.SIGN_IN } } );
		ASSERT.equal( upstream.Seen.length, 0 );
		// an agent's own token passes as it is, with its service name
		let own = await json_of( await fetch( served.Url + '/api/me', { headers: { Authorization: 'Bearer agent-token', 'X-Consensus-Service': 'Claude-CLI' } } ) );
		ASSERT.equal( own.Status, 200 );
		ASSERT.equal( own.Body.Me.Name, 'ann' );
		ASSERT.deepEqual( upstream.Seen.pop(), { Method: 'GET', Url: '/api/me', Authorization: 'Bearer agent-token', Service: 'Claude-CLI', Body: null } );
		// the person signed in: their token on a request with none
		state.Token = 'person-token';
		let signed = await json_of( await fetch( served.Url + '/api/me', { headers: { 'X-Consensus-Service': 'Claude-CLI' } } ) );
		ASSERT.equal( signed.Status, 200 );
		ASSERT.deepEqual( upstream.Seen.pop(), { Method: 'GET', Url: '/api/me', Authorization: 'Bearer person-token', Service: 'Claude-CLI', Body: null } );
		// an agent's own token still wins
		await fetch( served.Url + '/api/me', { headers: { Authorization: 'Bearer agent-token' } } );
		ASSERT.equal( upstream.Seen.pop().Authorization, 'Bearer agent-token' );
		// a body and a query pass; the upstream's answers pass as they are, a refusal too
		let made = await json_of( await fetch( served.Url + '/api/plans?Project=prj-1', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify( { Title: 'Through the proxy' } ) } ) );
		ASSERT.deepEqual( made, { Status: 201, Body: { Plan: { Id: 'pln-new', Title: 'Through the proxy' } } } );
		ASSERT.deepEqual( upstream.Seen.pop(), { Method: 'POST', Url: '/api/plans?Project=prj-1', Authorization: 'Bearer person-token', Service: null, Body: JSON.stringify( { Title: 'Through the proxy' } ) } );
		let missing = await json_of( await fetch( served.Url + '/api/plans/pln-missing' ) );
		ASSERT.deepEqual( missing, { Status: 404, Body: { Error: 'no such plan', Id: 'pln-missing' } } );
		// the upstream changes (the Desktop's current root): the next call goes there; one that does not answer is 502
		state.Upstream = { Name: 'Gone', Url: 'http://127.0.0.1:1' };
		ASSERT.equal( ( await fetch( served.Url + '/api/me' ) ).status, 502 );
		state.Upstream = { Name: 'Team', Url: upstream.Url };
		ASSERT.equal( ( await fetch( served.Url + '/api/me' ) ).status, 200 );
		// the roots' forwarding stays beside it
		served.SetRoots( [ { Key: 'Team', Url: upstream.Url } ] );
		ASSERT.equal( ( await fetch( served.Url + '/servers/Team/api/me' ) ).status, 200 );
		ASSERT.equal( upstream.Seen.pop().Authorization, null, 'the roots\' forwarding adds no token: the page sends its own' );
		// the page itself is still served
		ASSERT.match( await ( await fetch( served.Url + '/' ) ).text(), /ng-app="Consensus"/ );
	}
	finally
	{
		await served.Close();
		await upstream.Close();
	}
} );


TEST( '/instructions is composed locally: the local address, the Server behind it, the window\'s project or the Desktop\'s other Servers, the token rule, the MCP, then the common guide', async function ()
{
	let state = { Upstream: null, Token: null, About: { Edition: 'Client', Project: null, Others: [] } };
	let served = await serve_with( state );
	try
	{
		let guide = await INSTRUCTIONS.Guide();
		ASSERT.match( guide, /^# Build with Consensus/ );
		// the Client with no Server open yet, nobody signed in
		let text = await ( await fetch( served.Url + '/instructions' ) ).text();
		ASSERT.match( text, /^# This server\n\n- API: http:\/\/127\.0\.0\.1:\d+\/api, the local address of this Consensus Client: no Server is open in this window yet/ );
		ASSERT.match( text, /- No token: a request with none acts for the person signed in to this window, once someone is: until then it is answered 401 "sign in"\./ );
		ASSERT.match( text, /- MCP: POST http:\/\/127\.0\.0\.1:\d+\/api\/mcp, the same tools as on a Server; the stdio shim is node <checkout>\/bin\/mcp\.js --server http:\/\/127\.0\.0\.1:\d+ --service <your name>\./ );
		ASSERT.ok( text.endsWith( guide ), 'the common guide follows' );
		// the Client on a Server's project, signed in
		state.Upstream = { Name: 'Team', Url: 'http://team.example:3500' };
		state.Token = 'person-token';
		state.About = { Edition: 'Client', Project: { Id: 'prj-1', Name: 'Recipes' }, Others: [] };
		text = await ( await fetch( served.Url + '/instructions' ) ).text();
		ASSERT.match( text, /- API: http:\/\/127\.0\.0\.1:\d+\/api, the local address of this Consensus Client: every call is forwarded to the Server Team at http:\/\/team\.example:3500, which answers it as its own\./ );
		ASSERT.match( text, /- The project: Recipes \(prj-1\), the one open in this window\. Work in it alone, and give it where an operation takes a Project\./ );
		ASSERT.match( text, /- No token: a request with none acts for the person signed in to this window: this address adds their session token\. A request carrying its own "Authorization: Bearer <token>" is passed as it is\./ );
		ASSERT.match( text, /- Say who you are: send the header "X-Consensus-Service: <your name>"/ );
		ASSERT.match( text, /- These instructions: http:\/\/127\.0\.0\.1:\d+\/instructions\n\n# Build with Consensus/ );
		// the Desktop: the current Server, the others under /servers/<name>
		state.About = { Edition: 'Desktop', Project: null, Others: [ 'Team', 'Home' ] };
		text = await ( await fetch( served.Url + '/instructions' ) ).text();
		ASSERT.match( text, /the local address of this Consensus Desktop: every call is forwarded to the Server Team/ );
		ASSERT.match( text, /- The current Server: the one whose project is open in the window now; .* when a call answers an unknown project, read these instructions again before going on\./ );
		ASSERT.match( text, /- The Desktop's other Servers are reached under http:\/\/127\.0\.0\.1:\d+\/servers\/<name>\/api \(and \/servers\/<name>\/instructions\): Home\./ );
		ASSERT.equal( text.indexOf( 'The project:' ), -1 );
		// Local on its own: a window on a whole Server
		let whole = INSTRUCTIONS.Local( 'http://127.0.0.1:5', 'GUIDE', { Edition: 'Client', Upstream: { Name: 'Team', Url: 'http://t:1' }, Project: null, Others: [], SignedIn: true } );
		ASSERT.match( whole, /- The projects: those of the Server the person's roles allow \(list_projects, GET http:\/\/127\.0\.0\.1:5\/api\/projects\)\./ );
		ASSERT.ok( whole.endsWith( '\n\nGUIDE' ) );
	}
	finally
	{
		await served.Close();
	}
} );


TEST( '/api/mcp: initialize, tools/list and a tools/call that becomes the upstream\'s REST request as the person (or the agent\'s token), its refusal an error result; no token is 401, not JSON is -32700, GET is 405', async function ()
{
	let upstream = await stand_in();
	let state = { Upstream: { Name: 'Team', Url: upstream.Url }, Token: null, About: { Edition: 'Client', Project: null, Others: [] } };
	let served = await serve_with( state );
	async function mcp( message, headers )
	{
		let response = await fetch( served.Url + '/api/mcp', { method: 'POST', headers: Object.assign( { 'Content-Type': 'application/json' }, headers || {} ), body: ( typeof message === 'string' ) ? message : JSON.stringify( message ) } );
		return { Status: response.status, Body: ( response.status === 202 ) ? null : await response.json() };
	}
	try
	{
		// nobody signed in and no token of its own: 401
		ASSERT.deepEqual( await mcp( { jsonrpc: '2.0', id: 1, method: 'ping' } ), { Status: 401, Body: { Error: PROXY.SIGN_IN } } );
		state.Token = 'person-token';
		let started = await mcp( { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {} } } );
		ASSERT.equal( started.Status, 200 );
		ASSERT.equal( started.Body.result.protocolVersion, '2025-03-26' );
		ASSERT.equal( started.Body.result.serverInfo.name, 'Consensus' );
		ASSERT.deepEqual( await mcp( { jsonrpc: '2.0', method: 'notifications/initialized' } ), { Status: 202, Body: null } );
		let listed = await mcp( { jsonrpc: '2.0', id: 2, method: 'tools/list' } );
		let names = listed.Body.result.tools.map( function ( tool ) { return tool.name; } );
		for ( let expected of [ 'read_plan', 'create_plan', 'reply', 'apply', 'waiting', 'list_projects' ] )
		{
			ASSERT.ok( names.includes( expected ), 'the tools include ' + expected );
		}
		ASSERT.equal( upstream.Seen.length, 0, 'the definition needs no Server' );
		// a call: the upstream's GET as the person, with the agent's service name; the answer's JSON as text
		let read = await mcp( { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'read_plan', arguments: { Id: 'pln-1' } } }, { 'X-Consensus-Service': 'Claude-CLI' } );
		ASSERT.equal( read.Status, 200 );
		ASSERT.equal( read.Body.result.isError, undefined );
		ASSERT.deepEqual( JSON.parse( read.Body.result.content[ 0 ].text ), { Plan: { Id: 'pln-1', Title: 'The first' } } );
		ASSERT.deepEqual( upstream.Seen.pop(), { Method: 'GET', Url: '/api/plans/pln-1', Authorization: 'Bearer person-token', Service: 'Claude-CLI', Body: null } );
		// a write: the upstream's POST with the body
		let made = await mcp( { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'create_plan', arguments: { Title: 'Over MCP', Project: 'prj-1' } } } );
		ASSERT.deepEqual( JSON.parse( made.Body.result.content[ 0 ].text ), { Plan: { Id: 'pln-new', Title: 'Over MCP' } } );
		let posted = upstream.Seen.pop();
		ASSERT.equal( posted.Method + ' ' + posted.Url, 'POST /api/plans' );
		ASSERT.deepEqual( JSON.parse( posted.Body ), { Title: 'Over MCP', Project: 'prj-1' } );
		// the agent's own token wins over the person's
		await mcp( { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'read_plan', arguments: { Id: 'pln-1' } } }, { Authorization: 'Bearer agent-token' } );
		ASSERT.equal( upstream.Seen.pop().Authorization, 'Bearer agent-token' );
		// the upstream's refusal: an error result with its sentence and extra
		let missing = await mcp( { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'read_plan', arguments: { Id: 'pln-missing' } } } );
		ASSERT.equal( missing.Body.result.isError, true );
		ASSERT.equal( missing.Body.result.content[ 0 ].text, 'no such plan {"Id":"pln-missing"}' );
		// an unknown tool, a Server that does not answer, no Server open
		ASSERT.equal( ( await mcp( { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'nothing' } } ) ).Body.error.code, -32602 );
		state.Upstream = { Name: 'Gone', Url: 'http://127.0.0.1:1' };
		let gone = await mcp( { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'read_plan', arguments: { Id: 'pln-1' } } } );
		ASSERT.equal( gone.Body.result.isError, true );
		ASSERT.match( gone.Body.result.content[ 0 ].text, /^the Server at http:\/\/127\.0\.0\.1:1 does not answer/ );
		state.Upstream = null;
		let none = await mcp( { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'read_plan', arguments: { Id: 'pln-1' } } } );
		ASSERT.deepEqual( none.Body.result, { content: [ { type: 'text', text: PROXY.NO_UPSTREAM } ], isError: true } );
		// not JSON, and the wrong method
		ASSERT.equal( ( await mcp( '{ not json' ) ).Body.error.code, -32700 );
		let got = await fetch( served.Url + '/api/mcp' );
		ASSERT.equal( got.status, 405 );
		ASSERT.equal( got.headers.get( 'allow' ), 'POST' );
	}
	finally
	{
		await served.Close();
		await upstream.Close();
	}
} );


TEST( 'App.Tokens: the latest token kept with its expiry from a JWT\'s exp claim, none for another shape; null or an empty string forgets it', function ()
{
	let tokens = APP.Tokens();
	ASSERT.deepEqual( [ tokens.Token(), tokens.Expiry() ], [ null, null ] );
	tokens.Set( ' plain-token ' );
	ASSERT.deepEqual( [ tokens.Token(), tokens.Expiry() ], [ 'plain-token', null ] );
	let header = Buffer.from( JSON.stringify( { alg: 'RS256' } ) ).toString( 'base64url' );
	let payload = Buffer.from( JSON.stringify( { exp: 1800000000, sub: 'user_1' } ) ).toString( 'base64url' );
	tokens.Set( header + '.' + payload + '.signature' );
	ASSERT.deepEqual( [ tokens.Token(), tokens.Expiry() ], [ header + '.' + payload + '.signature', 1800000000000 ] );
	tokens.Set( header + '.' + Buffer.from( '{ no exp' ).toString( 'base64url' ) + '.signature' );
	ASSERT.equal( tokens.Expiry(), null );
	tokens.Set( null );
	ASSERT.deepEqual( [ tokens.Token(), tokens.Expiry() ], [ null, null ] );
	tokens.Set( 'again' );
	tokens.Set( '' );
	ASSERT.equal( tokens.Token(), null );
} );
