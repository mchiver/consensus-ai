#!/usr/bin/env node
'use strict';

// consensus - the headless entry point (plan Run Shapes, Step 1): starts the server from the command line, with no
// window. The desktop's executable is the other entry point; both go through src/Start.js.
//   node bin/consensus.js [<path> | --project <folder>] [--config <folder>] [--port <port>] [--scope none|local|public] [--headless]
// --headless is accepted here and does nothing: this form never has a window. A path (plan Run Shapes, Step 4) serves
// that project alone, its .consensus made when missing.

const START = require( '../src/Start.js' );


async function main()
{
	let options = START.Parse( process.argv.slice( 2 ) );
	if ( options.Help )
	{
		console.log( START.USAGE );
		return;
	}
	let running = await START.Run( options, console.log );
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
