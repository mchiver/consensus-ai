#!/usr/bin/env node
'use strict';

// consensus - the headless entry point (plan Run Shapes, Step 1): starts the server from the command line, with no
// window. The desktop's executable is the other entry point; both go through src/Start.js.
//   node bin/consensus.js [serve | <path> | --project <folder>] [--config <folder>] [--port <port>] [--scope none|local|public] [--headless]
//   node bin/consensus.js mcp <folder> [--service <name>]
// --headless is accepted here and does nothing: this form never has a window. A path (plan Run Shapes, Step 4) serves
// that project alone, its .consensus made when missing; since plan Rearchitecturation, Step 3, that server is the
// sidecar on a port hashed from the folder, and a folder a window has open prints the running sidecar's address and
// exits. The word mcp hands the rest to bin/mcp.js, the MCP stdio shim over a folder's sidecar.

const START = require( '../src/Start.js' );
const MCP = require( './mcp.js' );

const MCP_WORD = 'mcp';


async function main()
{
	let argv = process.argv.slice( 2 );
	if ( argv[ 0 ] === MCP_WORD )
	{
		return await MCP.Main( argv.slice( 1 ) );
	}
	let options = START.Parse( argv );
	if ( options.Help )
	{
		console.log( START.USAGE );
		return;
	}
	let running = await START.Run( options, console.log );
	if ( running.Open )
	{
		// the folder is open in a running sidecar: its address is printed above, and there is nothing to run
		return;
	}
	if ( !running.Server )
	{
		await running.Close();
		console.log( 'nothing to run without a window: --scope local or public starts the server' );
		process.exit( 1 );
	}
	console.log( 'no window: this is the headless form; open the address in a browser, or run the desktop (npm run desktop); Ctrl+C stops the server' );
	// Ctrl+C, and SIGTERM from `docker stop` (in a container the server is the first process, which a signal with no
	// handler does not end): close the server, then exit.
	function stop()
	{
		running.Close().then( function () { process.exit( 0 ); } );
	}
	process.on( 'SIGINT', stop );
	process.on( 'SIGTERM', stop );
}


main().catch( function ( error )
{
	console.error( error.message );
	process.exit( 1 );
} );
