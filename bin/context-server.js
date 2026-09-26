#!/usr/bin/env node
'use strict';

// context-server - starts a context server (src/ContextServer.js) from its settings file.
//   node bin/context-server.js [--settings <file>] [--port <port>]
// Without --settings, context-server.json in the current folder. A missing file is written with a new token and no
// items, to be filled in.

const FS = require( 'fs' );
const PATH = require( 'path' );
const CONTEXT_SERVER = require( '../src/ContextServer.js' );

const DEFAULT_SETTINGS = 'context-server.json';


function parse_arguments( argv )
{
	let options = {};
	for ( let index = 0; index < argv.length; index++ )
	{
		let argument = argv[ index ];
		if ( argument === '--settings' )
		{
			options.Settings = argv[ ++index ];
		}
		else if ( argument === '--port' )
		{
			options.Port = parseInt( argv[ ++index ], 10 );
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
		console.log( 'node bin/context-server.js [--settings <file>] [--port <port>]' );
		return;
	}
	let path = PATH.resolve( options.Settings || DEFAULT_SETTINGS );
	if ( !FS.existsSync( path ) )
	{
		FS.writeFileSync( path, JSON.stringify( CONTEXT_SERVER.DefaultSettings(), null, '\t' ) + '\n' );
		console.log( 'settings: wrote ' + path + ' with a new token and no items; add Corpus and Inference items there' );
	}
	let settings = JSON.parse( FS.readFileSync( path, 'utf8' ) );
	let started = await CONTEXT_SERVER.Start( { Settings: settings, Port: options.Port } );
	console.log( 'context server on ' + started.Url + ', settings ' + path );
	function stop()
	{
		started.Close().then( function () { process.exit( 0 ); } );
	}
	process.on( 'SIGINT', stop );
	process.on( 'SIGTERM', stop );
}


main().catch( function ( error )
{
	console.error( error.message );
	process.exit( 1 );
} );
