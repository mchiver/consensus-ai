'use strict';

// Page - serves the Consensus page (public/, the one page since plan Run Shapes, Step 3), the app's own pages (Folders:
// the Client's chooser, client/page/) and the vendor files on 127.0.0.1, for the window to load (plan Consensus Desktop, Step 2), and forwards
// the page's API calls to the servers the window shows: since plan Run Shapes, Step 5, one root per server,
// /servers/<key>/api/* (the events stream included) and /servers/<key>/instructions going to that root's server, so
// the page and every API share one origin. The server sends no CORS headers and is not changed for the desktop, and
// Electron runs no preload for a window whose web security is off, so the forwarding is what lets the page call
// another origin's API; the base URL the preload hands the page stays the page's own origin. Plan Sidecar Edition,
// Step 1: shared by Desktop and Sidecar (moved from desktop/Page.js); the app names its own pages' folders.
//
//   Serve( { Folder?, Folders?, Port? } ) -> { Url, Roots(), SetRoots( [ { Key, Url } ] ), Close }

const FS = require( 'fs' );
const PATH = require( 'path' );
const HTTP = require( 'http' );
const HTTPS = require( 'https' );
const EXPRESS = require( 'express' );
const SERVER = require( '../src/Server.js' );

const HOST = '127.0.0.1';
const DEFAULT_FOLDER = PATH.join( __dirname, '..', 'public' );
const FORWARDED = [ '/api', '/instructions' ];
const HOP_BY_HOP = [ 'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade' ];


async function Serve( Options )
{
	let options = Options || {};
	let folder = options.Folder || DEFAULT_FOLDER;
	if ( !FS.existsSync( PATH.join( folder, 'index.html' ) ) )
	{
		throw new Error( 'the page is missing: ' + PATH.join( folder, 'index.html' ) );
	}
	let roots = {};		// key -> the server's url
	let app = EXPRESS();
	app.disable( 'x-powered-by' );
	SERVER.AttachVendor( app );
	app.use( '/servers/:key', forward );
	for ( let prefix of FORWARDED )
	{
		app.use( prefix, not_here );
	}
	app.use( EXPRESS.static( folder ) );
	for ( let extra of ( options.Folders || [] ) )
	{
		app.use( EXPRESS.static( extra ) );
	}


	// The page reaches a server through its root only.
	function not_here( request, response )
	{
		response.status( 503 ).json( { Error: 'the page reaches a server through /servers/<key>' } );
	}


	// One request forwarded to the root's server as it is: method, path (the rest after /servers/<key>), headers (the
	// host is the target's, the window's host kept as X-Forwarded-Host so a Clerk session's azp still matches, plan
	// Clerk Step 7) and body, the answer streamed back, which keeps the events stream open.
	function forward( request, response )
	{
		let target = roots[ request.params.key ];
		if ( !target )
		{
			response.status( 503 ).json( { Error: 'no server "' + request.params.key + '" in this window' } );
			return;
		}
		let rest = request.url;
		if ( !FORWARDED.some( function ( prefix ) { return rest === prefix || rest.startsWith( prefix + '/' ) || rest.startsWith( prefix + '?' ); } ) )
		{
			response.status( 404 ).json( { Error: 'not forwarded' } );
			return;
		}
		let url = new URL( rest, target );
		let headers = {};
		for ( let name of Object.keys( request.headers ) )
		{
			if ( !HOP_BY_HOP.includes( name ) && name !== 'host' )
			{
				headers[ name ] = request.headers[ name ];
			}
		}
		headers[ 'x-forwarded-host' ] = request.headers.host || '';
		headers.host = url.host;
		let client = ( url.protocol === 'https:' ) ? HTTPS : HTTP;
		let upstream = client.request( url, { method: request.method, headers: headers }, function ( answer )
		{
			let sent = {};
			for ( let name of Object.keys( answer.headers ) )
			{
				if ( !HOP_BY_HOP.includes( name ) )
				{
					sent[ name ] = answer.headers[ name ];
				}
			}
			response.writeHead( answer.statusCode, sent );
			answer.pipe( response );
		} );
		upstream.on( 'error', function ( error )
		{
			if ( !response.headersSent )
			{
				response.status( 502 ).json( { Error: 'the server at ' + target + ' does not answer: ' + error.message } );
			}
			else
			{
				response.end();
			}
		} );
		response.on( 'close', function () { upstream.destroy(); } );
		request.pipe( upstream );
	}


	let server = await new Promise( function ( resolve, reject )
	{
		let listening = app.listen( options.Port || 0, HOST );
		listening.once( 'listening', function () { resolve( listening ); } );
		listening.once( 'error', reject );
	} );


	// SetRoots: the servers the window shows, each by its key and address; what /servers/<key> goes to from now on.
	function SetRoots( List )
	{
		roots = {};
		for ( let root of List || [] )
		{
			if ( root && root.Key && root.Url )
			{
				roots[ String( root.Key ) ] = String( root.Url ).replace( /\/+$/, '' );
			}
		}
	}


	function Roots()
	{
		return Object.keys( roots ).map( function ( key ) { return { Key: key, Url: roots[ key ] }; } );
	}


	async function Close()
	{
		server.closeAllConnections();
		await new Promise( function ( resolve ) { server.close( resolve ); } );
	}


	return {
		Url: 'http://' + HOST + ':' + server.address().port,
		Roots: Roots,
		SetRoots: SetRoots,
		Close: Close,
	};
}


module.exports = {
	Serve: Serve,
};
