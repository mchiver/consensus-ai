#!/usr/bin/env node
'use strict';

// consensus - starts the server from the command line, or runs a one-time command over the data folder.
//   node bin/consensus.js [--data <folder>] [--port <port>] [--host 127.0.0.1]
//   node bin/consensus.js migrate-ids [--data <folder>]    older slug ids become plain ids (see src/Ids.js)

const FS = require( 'fs' );
const PATH = require( 'path' );
const SERVER = require( '../src/Server.js' );
const IDS = require( '../src/Ids.js' );

const COMMANDS = [ 'migrate-ids' ];


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
		else if ( COMMANDS.includes( argument ) && !options.Command )
		{
			options.Command = argument;
		}
		else
		{
			throw new Error( 'unknown argument "' + argument + '"' );
		}
	}
	return options;
}


// Whether a Consensus server answers on the data folder's port; the migration refuses to run under one.
async function server_running( data )
{
	let settings = null;
	try
	{
		settings = JSON.parse( FS.readFileSync( PATH.join( data, 'consensus.json' ), 'utf8' ) );
	}
	catch ( error )
	{
		settings = null;
	}
	let port = ( settings && settings.Port ) || SERVER.DEFAULT_PORT;
	try
	{
		let response = await fetch( 'http://127.0.0.1:' + port + '/api/me', { signal: AbortSignal.timeout( 1500 ) } );
		return response.ok ? port : null;
	}
	catch ( error )
	{
		return null;
	}
}


async function migrate_ids( options )
{
	let data = options.Data || SERVER.DEFAULT_DATA;
	let port = await server_running( data );
	if ( port )
	{
		throw new Error( 'a Consensus server is running on port ' + port + '; stop it, then run migrate-ids again' );
	}
	let result = await IDS.MigrateIds( data );
	console.log( 'backup at ' + result.Backup );
	for ( let line of result.Lines )
	{
		console.log( line );
	}
	console.log( result.Lines.length ? 'migrate-ids: done' : 'migrate-ids: nothing to change' );
}


async function main()
{
	let options = parse_arguments( process.argv.slice( 2 ) );
	if ( options.Help )
	{
		console.log( 'usage: consensus [--data <folder>] [--port <port>] [--host 127.0.0.1]' );
		console.log( '       consensus migrate-ids [--data <folder>]' );
		return;
	}
	if ( options.Command === 'migrate-ids' )
	{
		await migrate_ids( options );
		return;
	}
	let running = await SERVER.Start( options );
	console.log( 'Consensus at ' + running.Url + '/' );
	console.log( 'data folder ' + running.Store.Folder );
	console.log( ( running.SettingsWritten ? 'settings written to ' : 'settings from ' ) + running.Store.SettingsPath() );
	process.on( 'SIGINT', function ()
	{
		running.Close().then( function () { process.exit( 0 ); } );
	} );
}


main().catch( function ( error )
{
	console.error( error.message );
	process.exit( 1 );
} );
