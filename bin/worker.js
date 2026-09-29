#!/usr/bin/env node
'use strict';

// worker - starts a worker (src/Worker.js) from its settings file, or, with --mcp, serves the plan tools to claude
// for one job (src/Mcp.js; the worker starts that itself).
//   node bin/worker.js [--settings <file>] [--port <port>]
//   node bin/worker.js --mcp                       reads CONSENSUS_WORKER_URL, _TOKEN and _JOB from its env
//   node bin/worker.js --bash-guard                a build's PreToolUse hook: exits 2 for a Bash command not in
//                                                  CONSENSUS_WORKER_COMMANDS, which claude then refuses
// Without --settings, worker.json in the current folder. A missing file is written with a new token and no items,
// to be filled in. The jobs it keeps go in ~worker beside package.json.

const FS = require( 'fs' );
const PATH = require( 'path' );
const WORKER = require( '../src/Worker.js' );
const MCP = require( '../src/Mcp.js' );
const SERVER = require( '../src/Server.js' );

const DEFAULT_SETTINGS = 'worker.json';
const FOLDER = PATH.join( __dirname, '..', '~worker' );


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
		else if ( argument === '--mcp' )
		{
			options.Mcp = true;
		}
		else if ( argument === '--bash-guard' )
		{
			options.Guard = true;
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


async function serve_mcp()
{
	let url = process.env.CONSENSUS_WORKER_URL;
	let token = process.env.CONSENSUS_WORKER_TOKEN;
	let job = process.env.CONSENSUS_WORKER_JOB;
	if ( !url || !token || !job )
	{
		throw new Error( '--mcp needs CONSENSUS_WORKER_URL, CONSENSUS_WORKER_TOKEN and CONSENSUS_WORKER_JOB in its env' );
	}
	await MCP.Serve( { Url: url, Token: token, Job: job } );
}


// The hook's input is the tool call as JSON on stdin; exit 0 lets it run, exit 2 refuses it with the reason on stderr.
async function bash_guard()
{
	let input = '';
	for await ( let chunk of process.stdin )
	{
		input += chunk;
	}
	let call = {};
	try
	{
		call = JSON.parse( input );
	}
	catch ( error )
	{
		call = {};
	}
	let commands = [];
	try
	{
		commands = JSON.parse( process.env.CONSENSUS_WORKER_COMMANDS || '[]' );
	}
	catch ( error )
	{
		commands = [];
	}
	let command = ( call.tool_input && call.tool_input.command ) || '';
	if ( WORKER.BashAllowed( command, commands ) )
	{
		process.exit( 0 );
	}
	process.stderr.write( 'Refused: a build may run only these commands, one at a time, with nothing chained: ' + commands.join( ', ' ) + '. The owner handles git.\n' );
	process.exit( 2 );
}


async function main()
{
	let options = parse_arguments( process.argv.slice( 2 ) );
	if ( options.Help )
	{
		console.log( 'node bin/worker.js [--settings <file>] [--port <port>]' );
		return;
	}
	if ( options.Mcp )
	{
		await serve_mcp();
		return;
	}
	if ( options.Guard )
	{
		await bash_guard();
		return;
	}
	let path = PATH.resolve( options.Settings || DEFAULT_SETTINGS );
	if ( !FS.existsSync( path ) )
	{
		FS.writeFileSync( path, JSON.stringify( WORKER.DefaultSettings(), null, '\t' ) + '\n' );
		console.log( 'settings: wrote ' + path + ' with a new token and no items. Add Workspace and Inference items there,' );
		console.log( 'and add this worker to consensus.json: "Workers": [ { "Name": <its Name>, "Token": <its Consensus.Token> } ]' );
	}
	let settings = JSON.parse( FS.readFileSync( path, 'utf8' ) );
	let started = await WORKER.Start( { Settings: settings, SettingsPath: path, Folder: FOLDER, Port: options.Port, Vendor: SERVER.AttachVendor } );
	console.log( 'worker ' + settings.Name + ' for ' + settings.Consensus.Url + '; its page at ' + started.Url + '/, settings ' + path );
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
