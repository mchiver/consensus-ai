'use strict';

// Events - the Server-Sent Events hub. The page listens on one stream; every change is one event
// { Proposal, Kind }, and the page reloads what it shows. Express serves this with nothing added.

const HEARTBEAT_MILLISECONDS = 25000;


function Hub()
{
	let clients = new Set();
	let heartbeat = null;


	//-----------------------------------------------------------------
	// Attach: the GET route that holds a response open as a stream.

	function Attach( App, Path )
	{
		App.get( Path, handle );
		heartbeat = setInterval( send_heartbeat, HEARTBEAT_MILLISECONDS );
		heartbeat.unref();
	}


	function handle( request, response )
	{
		response.writeHead( 200, {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			'Connection': 'keep-alive',
		} );
		response.write( ': connected\n\n' );
		clients.add( response );
		request.on( 'close', function ()
		{
			clients.delete( response );
		} );
	}


	function send_heartbeat()
	{
		for ( let client of clients )
		{
			client.write( ': heartbeat\n\n' );
		}
	}


	//-----------------------------------------------------------------
	// Send: one event to every listener.

	function Send( Event )
	{
		let message = 'event: change\ndata: ' + JSON.stringify( Event ) + '\n\n';
		for ( let client of clients )
		{
			client.write( message );
		}
	}


	function Count()
	{
		return clients.size;
	}


	function Close()
	{
		if ( heartbeat )
		{
			clearInterval( heartbeat );
			heartbeat = null;
		}
		for ( let client of clients )
		{
			client.end();
		}
		clients.clear();
	}


	return {
		Attach: Attach,
		Send: Send,
		Count: Count,
		Close: Close,
	};
}


module.exports = {
	Hub: Hub,
};
