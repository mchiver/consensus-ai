'use strict';

// Page - serves the desktop's own copy of the Consensus page (desktop/page/: the Consensus page and the connect
// screen) and the vendor files on 127.0.0.1, for the window to load (plan Consensus Desktop, Step 2), and forwards
// the page's API calls (/api/*, the events stream included, and /instructions) to the connected server, so the page
// and the API share one origin. The server sends no CORS headers and is not changed for the desktop, and Electron
// runs no preload for a window whose web security is off, so the forwarding is what lets the page call another
// origin's API; the base URL the preload hands the page stays the page's own origin.
//
//   Serve( { Folder, Port? } ) -> { Url, Target(), SetTarget( url | null ), Close }

const FS = require( 'fs' );
const PATH = require( 'path' );
const HTTP = require( 'http' );
const HTTPS = require( 'https' );
const EXPRESS = require( 'express' );
const SERVER = require( '../src/Server.js' );

const HOST = '127.0.0.1';
const DEFAULT_FOLDER = PATH.join( __dirname, 'page' );
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
	let target = null;
	let app = EXPRESS();
	app.disable( 'x-powered-by' );
	SERVER.AttachVendor( app );
	for ( let prefix of FORWARDED )
	{
		app.use( prefix, forward );
	}
	app.use( EXPRESS.static( folder ) );


	// One request forwarded to the target as it is: method, path, headers (the host is the target's) and body, the
	// answer streamed back, which keeps the events stream open.
	function forward( request, response )
	{
		if ( !target )
		{
			response.status( 503 ).json( { Error: 'not connected to a Consensus server' } );
			return;
		}
		let url = new URL( request.originalUrl, target );
		let headers = {};
		for ( let name of Object.keys( request.headers ) )
		{
			if ( !HOP_BY_HOP.includes( name ) && name !== 'host' )
			{
				headers[ name ] = request.headers[ name ];
			}
		}
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


	// SetTarget: the connected server's address, or null when none; what /api and /instructions go to from now on.
	function SetTarget( Url )
	{
		target = Url ? String( Url ).replace( /\/+$/, '' ) : null;
	}


	function Target()
	{
		return target;
	}


	async function Close()
	{
		server.closeAllConnections();
		await new Promise( function ( resolve ) { server.close( resolve ); } );
	}


	return {
		Url: 'http://' + HOST + ':' + server.address().port,
		Folder: folder,
		Target: Target,
		SetTarget: SetTarget,
		Close: Close,
	};
}


module.exports = {
	Serve: Serve,
	DEFAULT_FOLDER: DEFAULT_FOLDER,
};
