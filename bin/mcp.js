#!/usr/bin/env node
'use strict';

// mcp - the Model Context Protocol's stdio transport for Consensus (plan MCP Server, Step 2): a relay on the client's
// machine. One JSON-RPC message per line in on stdin, one per line out on stdout (stderr for anything else); each
// message goes to a running Consensus server's POST /api/mcp with the caller's header, and the server's reply comes
// back. The relay identifies nobody and holds no state: the server does, as for curl. It needs the server running;
// when the server does not answer, a request is answered with an error that says so, and the relay starts nothing.
//
//   node bin/mcp.js --server <url or saved name> [--service <name> | --token <token>] [--project <id or name>] [--config <folder>]
//
//   --server   the server's address (http://127.0.0.1:3500), or the Name of a saved Host in the desktop's own file
//              (<config>/desktop.json, its Hosts list; plan Rearchitecturation, Step 1), whose Url is taken; a Host's
//              entry carries no token, so a shared server takes --token
//   --service  how the relay says who it is, the X-Consensus-Service header ("MCP" when neither this nor a token
//              is given); a Claude Code configuration passes --service Claude-CLI to keep its byline
//   --token    an account's token, minted on the person's user page, for a shared server
//   --project  the project (an id or a name) filled in for the tools that take one when the client leaves it out:
//              sidecar mode's one-project rule, set for a client
//   --config   the config folder the saved Hosts are read from (~/.consensus)
//
// A client's configuration, for Claude Code: claude mcp add consensus -- node <checkout>/bin/mcp.js --server http://127.0.0.1:3500 --service Claude-CLI

const READLINE = require( 'readline' );
const FS = require( 'fs' );
const PATH = require( 'path' );
const OS = require( 'os' );

const MCP_PATH = '/api/mcp';
const DEFAULT_SERVICE = 'MCP';
const CONFIG_FOLDER = '.consensus';
const DESKTOP_FILE = 'desktop.json';
const FETCH_TIMEOUT = 10 * 60 * 1000;	// a tool call may run long (a report of a large plan)
const SERVER_ERROR = -32000;
const PARSE_ERROR = -32700;


function usage()
{
	return [
		'node bin/mcp.js --server <url or saved name> [--service <name> | --token <token>] [--project <id or name>] [--config <folder>]',
		'',
		'The MCP stdio transport for Consensus: a relay to a running server\'s POST /api/mcp. --server takes the server\'s address or',
		'the Name of a saved Host in <config>/desktop.json; --service names the relay (MCP by default) and --token carries an',
		'account\'s token instead; --project fills in the project for the tools that take one when the client leaves it out.',
	].join( '\n' );
}


function parse_arguments( argv )
{
	let options = { Server: null, Service: null, Token: null, Project: null, Config: null, Help: false };
	for ( let index = 0; index < argv.length; index++ )
	{
		let argument = argv[ index ];
		if ( argument === '--help' || argument === '-h' )
		{
			options.Help = true;
			continue;
		}
		let match = /^--(server|service|token|project|config)$/.exec( argument );
		if ( !match )
		{
			throw new Error( 'unknown argument ' + argument + '\n' + usage() );
		}
		let value = argv[ index + 1 ];
		if ( value === undefined || value.startsWith( '--' ) )
		{
			throw new Error( argument + ' takes a value\n' + usage() );
		}
		options[ match[ 1 ].charAt( 0 ).toUpperCase() + match[ 1 ].slice( 1 ) ] = value;
		index++;
	}
	return options;
}


// A saved Host by its Name, from the desktop's Hosts list: { Url, Token: null, Service: null }.
function saved_server( name, config_folder )
{
	let folder = config_folder || PATH.join( OS.homedir(), CONFIG_FOLDER );
	let file = PATH.join( folder, DESKTOP_FILE );
	let settings = null;
	try
	{
		settings = JSON.parse( FS.readFileSync( file, 'utf8' ) );
	}
	catch ( error )
	{
		throw new Error( 'no saved Hosts: ' + file + ' cannot be read (' + error.message + ')' );
	}
	let found = ( Array.isArray( settings.Hosts ) ? settings.Hosts : [] ).find( function ( host ) { return host && host.Name === name; } );
	if ( !found || typeof found.Url !== 'string' )
	{
		throw new Error( 'no saved server named ' + name + ' in ' + file );
	}
	return { Url: found.Url, Token: null, Service: null };
}


function error_line( id, code, message )
{
	return JSON.stringify( { jsonrpc: '2.0', id: ( id === undefined ) ? null : id, error: { code: code, message: message } } );
}


function write( line )
{
	process.stdout.write( line + '\n' );
}


//---------------------------------------------------------------------

async function main()
{
	let options = parse_arguments( process.argv.slice( 2 ) );
	if ( options.Help )
	{
		process.stderr.write( usage() + '\n' );
		return;
	}
	if ( !options.Server )
	{
		throw new Error( '--server is required\n' + usage() );
	}
	let url = options.Server;
	let token = options.Token;
	let service = options.Service;
	if ( !/^https?:\/\//i.test( url ) )
	{
		let saved = saved_server( url, options.Config );
		url = saved.Url;
		token = token || saved.Token;
		service = service || saved.Service;
	}
	url = url.replace( /\/+$/, '' );
	let headers = { 'Content-Type': 'application/json' };
	if ( token )
	{
		headers.Authorization = 'Bearer ' + token;
	}
	else
	{
		headers[ 'X-Consensus-Service' ] = service || DEFAULT_SERVICE;
	}
	let takes_project = null;		// the tools that take Project, asked of the server once


	// One message to the server; its reply as text, or null for a notification (202 or an empty body).
	async function post( body )
	{
		let response = await fetch( url + MCP_PATH, { method: 'POST', headers: headers, body: body, signal: AbortSignal.timeout( FETCH_TIMEOUT ) } );
		let text = await response.text();
		if ( !response.ok )
		{
			let said = '';
			try
			{
				said = JSON.parse( text ).Error || '';
			}
			catch ( error )
			{
				said = '';
			}
			throw new Error( 'answered ' + response.status + ( said ? ': ' + said : '' ) );
		}
		return ( response.status === 202 || !text.trim() ) ? null : text;
	}


	async function tools_taking_project()
	{
		if ( takes_project )
		{
			return takes_project;
		}
		let text = await post( JSON.stringify( { jsonrpc: '2.0', id: 'relay-tools', method: 'tools/list' } ) );
		let reply = JSON.parse( text || '{}' );
		let names = new Set();
		for ( let tool of ( reply.result && reply.result.tools ) || [] )
		{
			if ( tool.inputSchema && tool.inputSchema.properties && tool.inputSchema.properties.Project )
			{
				names.add( tool.name );
			}
		}
		takes_project = names;
		return names;
	}


	// One line in: forwarded as it is, the project filled in for a tool call that takes one and leaves it out; the
	// reply out. A line that is not JSON is answered the protocol's way here; a server that does not answer is an
	// error for a request, a note on stderr for a notification.
	async function relay( line )
	{
		if ( !line.trim() )
		{
			return;
		}
		let message = null;
		try
		{
			message = JSON.parse( line );
		}
		catch ( error )
		{
			write( error_line( null, PARSE_ERROR, 'not JSON' ) );
			return;
		}
		let out = line;
		if ( options.Project && message && typeof message === 'object' && message.method === 'tools/call' && message.params && typeof message.params.name === 'string' )
		{
			try
			{
				if ( ( await tools_taking_project() ).has( message.params.name ) )
				{
					let args = ( message.params.arguments && typeof message.params.arguments === 'object' ) ? message.params.arguments : {};
					if ( args.Project === undefined )
					{
						args.Project = options.Project;
						message.params.arguments = args;
						out = JSON.stringify( message );
					}
				}
			}
			catch ( error )
			{
				// the post below says what the server answers
			}
		}
		try
		{
			let answer = await post( out );
			if ( answer !== null )
			{
				write( answer );
			}
		}
		catch ( error )
		{
			let note = 'Consensus at ' + url + ': ' + error.message;
			if ( message && typeof message === 'object' && !Array.isArray( message ) && message.id !== undefined )
			{
				write( error_line( message.id, SERVER_ERROR, note ) );
			}
			else
			{
				process.stderr.write( note + '\n' );
			}
		}
	}


	let lines = READLINE.createInterface( { input: process.stdin, crlfDelay: Infinity } );
	let chain = Promise.resolve();
	lines.on( 'line', function ( line )
	{
		chain = chain.then( function () { return relay( line ); } );
	} );
	await new Promise( function ( resolve )
	{
		lines.on( 'close', resolve );
	} );
	await chain;
	// stdout is a pipe: it is flushed before the process ends
	await new Promise( function ( resolve )
	{
		process.stdout.write( '', resolve );
	} );
	process.exit( 0 );
}


main().catch( function ( error )
{
	process.stderr.write( error.message + '\n' );
	process.exit( 2 );
} );
