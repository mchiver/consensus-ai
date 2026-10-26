#!/usr/bin/env node
'use strict';

// consensus-server - the Server on the command line (plan The Server, Step 3). With --headless it is `consensus serve`
// (bin/consensus.js, run here in this process: no window, the headless gate); without, it starts the Server
// application (server/main.js) in Electron, which a plain node install may not have: then it says so.
//   consensus-server [--open <folder>] [--config <folder>] [--port <port>] [--scope none|local|public] [--headless]

const PATH = require( 'path' );
const CHILD_PROCESS = require( 'child_process' );

const SERVER_FOLDER = PATH.join( __dirname, '..', 'server' );


function electron_path()
{
	try
	{
		return require( 'electron' );
	}
	catch ( error )
	{
		return null;
	}
}


function main()
{
	let argv = process.argv.slice( 2 );
	if ( argv.includes( '--headless' ) )
	{
		if ( argv.includes( '--open' ) )
		{
			console.error( '--open needs the Server application\'s window: run consensus-server without --headless, or register the folder on the page' );
			process.exit( 1 );
		}
		// the headless form: the same as consensus serve
		process.argv = [ process.argv[ 0 ], process.argv[ 1 ], 'serve' ].concat( argv );
		require( './consensus.js' );
		return;
	}
	let electron = electron_path();
	if ( !electron || typeof electron !== 'string' )
	{
		console.error( 'the Server\'s window needs Electron, which this install does not have: install Consensus Server, or run consensus-server --headless' );
		process.exit( 1 );
	}
	let child = CHILD_PROCESS.spawn( electron, [ SERVER_FOLDER ].concat( argv ), { stdio: 'inherit' } );
	child.on( 'exit', function ( code ) { process.exit( code === null ? 1 : code ); } );
}


main();
