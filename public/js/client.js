'use strict';

// Client - fetch over the API, and the Server-Sent Events stream. The browser is the owner: no token.

angular.module( 'Consensus.Client', [] ).factory( 'Client', [ '$q', '$rootScope', function ( $q, $rootScope )
{

	// A body is JSON, or a file (a Blob) sent as it is: the only files sent are zips.
	async function call( method, path, body )
	{
		let options = { method: method, headers: {} };
		if ( body instanceof Blob )
		{
			options.headers[ 'Content-Type' ] = 'application/zip';
			options.body = body;
		}
		else if ( body !== undefined )
		{
			options.headers[ 'Content-Type' ] = 'application/json';
			options.body = JSON.stringify( body );
		}
		let response = await fetch( path, options );
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
			let failure = new Error( json.Error || ( 'request failed: ' + response.status ) );
			failure.Status = response.status;
			failure.Body = json;
			throw failure;
		}
		return json;
	}


	function Get( Path )
	{
		return $q.when( call( 'GET', Path ) );
	}


	function Post( Path, Body )
	{
		return $q.when( call( 'POST', Path, Body || {} ) );
	}


	function Put( Path, Body )
	{
		return $q.when( call( 'PUT', Path, Body || {} ) );
	}


	function Delete( Path )
	{
		return $q.when( call( 'DELETE', Path ) );
	}


	// Upload( 'POST' | 'PUT', Path, File ): a zip as the request's body.
	function Upload( Method, Path, File )
	{
		return $q.when( call( Method, Path, File ) );
	}


	// Listen: Handler( { Proposal, Kind, Thread? } ) inside a digest; Status( live ) on connect and drop.
	function Listen( Handler, Status )
	{
		let source = new EventSource( '/api/events' );
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
		Upload: Upload,
		Listen: Listen,
	};
} ] );
