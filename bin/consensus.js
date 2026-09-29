#!/usr/bin/env node
'use strict';

// consensus - starts the server from the command line.
//   node bin/consensus.js [--data <folder>] [--port <port>] [--host <address>]
// --host overrides the settings' Host (127.0.0.1 by default); 0.0.0.0 listens on every interface.

const SERVER = require( '../src/Server.js' );


function parse_arguments( argv )
{
	let options = {};
	for ( let index = 0; index < argv.length; index++ )
	{
		let argument = argv[ index ];
		if ( argument === '--data' )
		{
			options.Data = argv[ ++index ];
		}
		else if ( argument === '--port' )
		{
			options.Port = parseInt( argv[ ++index ], 10 );
		}
		else if ( argument === '--host' )
		{
			options.Host = argv[ ++index ];
		}
		else if ( argument === '--help' || argument === '-h' )
		{
			options.Help = true;
		}
		else
		{
			throw new Error( 'unknown argument "' + argument + '"' );
		}
	}
	return options;
}


async function main()
{
	let options = parse_arguments( process.argv.slice( 2 ) );
	if ( options.Help )
	{
		console.log( 'usage: consensus [--data <folder>] [--port <port>] [--host <address>]' );
		return;
	}
	let running = await SERVER.Start( options );
	console.log( 'Consensus at ' + running.Url + '/ (listening on ' + running.Address.Host + ')' );
	if ( !running.Address.Local )
	{
		console.log( 'warning: listening beyond this machine; anyone who can reach it acts as the owner, and reads the llm token at /instructions' );
	}
	console.log( 'data folder ' + running.Store.Folder );
	console.log( ( running.SettingsWritten ? 'settings written to ' : 'settings from ' ) + running.Store.SettingsPath() );
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
