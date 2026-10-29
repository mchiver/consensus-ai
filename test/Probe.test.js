'use strict';

// Probe.test - a Consensus server tried at its address (plan Review 2026-10-29, Step 2): a Server that lets the caller
// in, one that asks for a sign-in, one behind its closed gate, something that is not a Consensus server, no answer, a
// bad address; the token sent as a Bearer.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const HTTP = require( 'http' );
const PROBE = require( '../src/Probe.js' );


// A stand-in server: what it answers on /api/me depends on the path's first part.
function stand_in()
{
	return new Promise( function ( Resolve )
	{
		let seen = [];
		let server = HTTP.createServer( function ( request, response )
		{
			seen.push( { Url: request.url, Authorization: request.headers.authorization || null } );
			let kind = request.url.split( '/' )[ 1 ];
			function answer( status, body )
			{
				response.writeHead( status, { 'Content-Type': 'application/json' } );
				response.end( JSON.stringify( body ) );
			}
			if ( kind === 'open' )
			{
				answer( 200, { Server: 'Team', Version: '0.5.1', Me: { Name: 'ann', Role: 'owner' }, Participants: [ 'ann' ], States: [ 'Draft' ] } );
			}
			else if ( kind === 'signin' )
			{
				answer( 401, { Error: 'sign in', Server: 'Team' } );
			}
			else if ( kind === 'closed' )
			{
				answer( 401, { Error: 'the Server waits for its first sign-in', Closed: true, Reason: 'first sign-in' } );
			}
			else if ( kind === 'forbidden' )
			{
				answer( 403, { Error: 'not a member' } );
			}
			else if ( kind === 'nome' )
			{
				answer( 200, { Hello: 'world' } );
			}
			else if ( kind === 'html' )
			{
				response.writeHead( 200, { 'Content-Type': 'text/html' } );
				response.end( '<html>not json</html>' );
			}
			else
			{
				answer( 404, { Error: 'not found' } );
			}
		} );
		server.listen( 0, '127.0.0.1', function ()
		{
			let base = 'http://127.0.0.1:' + server.address().port;
			Resolve( { Base: base, Seen: seen, Close: function () { return new Promise( function ( Done ) { server.close( Done ); } ); } } );
		} );
	} );
}


TEST( 'Base: the address trimmed, its trailing slashes dropped; not http(s) is null', function ()
{
	ASSERT.equal( PROBE.Base( ' http://cube4:3500/// ' ), 'http://cube4:3500' );
	ASSERT.equal( PROBE.Base( 'https://consensus.example.com/path/' ), 'https://consensus.example.com/path' );
	ASSERT.equal( PROBE.Base( 'cube4:3500' ), null );
	ASSERT.equal( PROBE.Base( 'http://with space' ), null );
	ASSERT.equal( PROBE.Base( '' ), null );
	ASSERT.equal( PROBE.Base( null ), null );
} );


TEST( 'Probe: a Server that lets the caller in, one that asks for a sign-in, one behind its gate; the token as a Bearer', async function ()
{
	let server = await stand_in();
	try
	{
		let open = await PROBE.Probe( server.Base + '/open/' );
		ASSERT.deepEqual( open, { Ok: true, SignIn: false, Closed: false, Version: '0.5.1', Name: 'Team', Me: { Name: 'ann', Role: 'owner' }, Participants: [ 'ann' ], States: [ 'Draft' ], Url: server.Base + '/open' } );
		let signin = await PROBE.Probe( server.Base + '/signin', { Token: 'sess_123' } );
		ASSERT.deepEqual( signin, { Ok: true, SignIn: true, Closed: false, Version: null, Name: 'Team', Me: null, Participants: null, States: null, Url: server.Base + '/signin' } );
		let closed = await PROBE.Probe( server.Base + '/closed' );
		ASSERT.deepEqual( [ closed.Ok, closed.SignIn, closed.Closed, closed.Name ], [ true, false, true, null ] );
		ASSERT.deepEqual( server.Seen.map( function ( one ) { return one.Url; } ), [ '/open/api/me', '/signin/api/me', '/closed/api/me' ] );
		ASSERT.deepEqual( server.Seen.map( function ( one ) { return one.Authorization; } ), [ null, 'Bearer sess_123', null ] );
	}
	finally
	{
		await server.Close();
	}
} );


TEST( 'Probe: what is not a Consensus server, a refusal, no answer, a bad address', async function ()
{
	let server = await stand_in();
	try
	{
		let nome = await PROBE.Probe( server.Base + '/nome' );
		ASSERT.deepEqual( nome, { Ok: false, Error: server.Base + '/nome answered, but not as a Consensus Server does' } );
		let html = await PROBE.Probe( server.Base + '/html' );
		ASSERT.deepEqual( html, { Ok: false, Error: server.Base + '/html answered 200, and not as a Consensus Server does' } );
		let forbidden = await PROBE.Probe( server.Base + '/forbidden' );
		ASSERT.deepEqual( forbidden, { Ok: false, Error: server.Base + '/forbidden answered 403: not a member' } );
		let missing = await PROBE.Probe( server.Base + '/elsewhere' );
		ASSERT.deepEqual( missing, { Ok: false, Error: server.Base + '/elsewhere answered 404: not found' } );
	}
	finally
	{
		await server.Close();
	}
	let gone = await PROBE.Probe( server.Base, { Timeout: 2000 } );
	ASSERT.equal( gone.Ok, false );
	ASSERT.match( gone.Error, new RegExp( '^' + server.Base.replace( /[.]/g, '[.]' ) + ' does not answer: ' ) );
	ASSERT.deepEqual( await PROBE.Probe( 'cube4:3500' ), { Ok: false, Error: 'the Url must start with http:// or https://' } );
	ASSERT.equal( PROBE.TIMEOUT, 5000 );
} );
