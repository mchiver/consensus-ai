'use strict';

// Client - fetch over the API, and the Server-Sent Events stream. The browser is the owner, no token, until the page's
// own server signs people in through Clerk (plan User Management, Step 4: session.js): then every call to that server
// carries the session token, and a 401 from it asks for a sign-in.
// The desktop (plan Consensus Desktop, Step 2) sets the API's base URL before the page starts
// (window.ConsensusDesktop.Base, from preload.js); empty means the page's own origin, as in the browser. Since plan
// Run Shapes, Step 5, every call may name its root (roots.js): Get( root, path ) goes to that server through the
// root's Base (the desktop's forwarding at /servers/<key>); Get( path ) goes to the current root, the one State names
// (SetCurrent). In a browser every base is the page's own origin.

angular.module( 'Consensus.Client', [] ).factory( 'Client', [ '$q', '$rootScope', 'Session', function ( $q, $rootScope, Session )
{
	const BASE = ( window.ConsensusDesktop && window.ConsensusDesktop.Base ) || '';
	let current = '';		// the current root's Base (State.SetRoot)


	// The base of a call: the root given (an object with a Base), else the current root's.
	function base_of( root )
	{
		if ( root && typeof root === 'object' )
		{
			return BASE + ( root.Base || '' );
		}
		return BASE + current;
	}


	// The arguments of Get( root, path ) or Get( path ): a root is an object, a path a string.
	function split( first, second, third )
	{
		if ( typeof first === 'string' )
		{
			return { Root: null, Path: first, Body: second };
		}
		return { Root: first, Path: second, Body: third };
	}


	// A body is JSON.
	async function call( method, root, path, body )
	{
		let options = { method: method, headers: {} };
		if ( body !== undefined )
		{
			options.headers[ 'Content-Type' ] = 'application/json';
			options.body = JSON.stringify( body );
		}
		let own = ( base_of( root ) === '' );
		if ( own )
		{
			let token = await Session.Token();
			if ( token )
			{
				options.headers.Authorization = 'Bearer ' + token;
			}
		}
		let response = await fetch( base_of( root ) + path, options );
		let json = null;
		try
		{
			json = await response.json();
		}
		catch ( error )
		{
			json = { Error: response.statusText };
		}
		if ( !response.ok )
		{
			if ( response.status === 401 && own )
			{
				Session.Needed( json );
			}
			let failure = new Error( json.Error || ( 'request failed: ' + response.status ) );
			failure.Status = response.status;
			failure.Body = json;
			throw failure;
		}
		return json;
	}


	function Get( RootOrPath, Path )
	{
		let given = split( RootOrPath, Path );
		return $q.when( call( 'GET', given.Root, given.Path ) );
	}


	function Post( RootOrPath, PathOrBody, Body )
	{
		let given = split( RootOrPath, PathOrBody, Body );
		return $q.when( call( 'POST', given.Root, given.Path, given.Body || {} ) );
	}


	function Put( RootOrPath, PathOrBody, Body )
	{
		let given = split( RootOrPath, PathOrBody, Body );
		return $q.when( call( 'PUT', given.Root, given.Path, given.Body || {} ) );
	}


	function Delete( RootOrPath, Path )
	{
		let given = split( RootOrPath, Path );
		return $q.when( call( 'DELETE', given.Root, given.Path ) );
	}


	// SetCurrent: the Base of the root the calls without a root go to.
	function SetCurrent( Base )
	{
		current = Base || '';
	}


	// Listen: the root's events stream; Handler( { Plan, Kind, Thread? } ) inside a digest; Status( live ) on
	// connect and drop.
	function Listen( Root, Handler, Status )
	{
		let source = new EventSource( base_of( Root ) + '/api/events' );
		source.addEventListener( 'change', function ( message )
		{
			let event = JSON.parse( message.data );
			$rootScope.$applyAsync( function () { Handler( event ); } );
		} );
		source.onopen = function ()
		{
			$rootScope.$applyAsync( function () { Status( true ); } );
		};
		source.onerror = function ()
		{
			$rootScope.$applyAsync( function () { Status( false ); } );
		};
		return source;
	}


	return {
		Get: Get,
		Post: Post,
		Put: Put,
		Delete: Delete,
		SetCurrent: SetCurrent,
		Listen: Listen,
		Base: base_of,		// the base a root's own pages are fetched from (plan UI Tweaks VII: /instructions)
	};
} ] );
