'use strict';

// Start - the one start module both entry points share (plan Run Shapes, Step 1): the command line parsed, the
// server started from the config folder, and the lines that say what was started. bin/consensus.js is the headless
// form, for a plain node install and the Docker image; the desktop (desktop/main.js) runs the same and then opens
// its window, unless --headless.
//
//   Parse( argv ) -> { Config?, Port?, Scope?, Headless, Help }   throws on an argument it does not know
//   Run( options, log ) -> running (src/Server.js's), after log( line ) for each line about it
//   USAGE: the usage line

const SERVER = require( './Server.js' );
const PARTICIPANTS = require( './Participants.js' );

const USAGE = 'usage: consensus [--config <folder>] [--port <port>] [--scope none|local|public] [--headless]';
const SCOPE_NAMES = { none: 'None', local: 'Local', public: 'Public' };


//---------------------------------------------------------------------
// Parse: the arguments after the program's. --data is --config's older name, kept for one release; --host is gone,
// Scope took its place, and the message says so. --project and a bare path are Step 4's.

function Parse( argv )
{
	let options = { Headless: false, Help: false };
	for ( let index = 0; index < argv.length; index++ )
	{
		let argument = argv[ index ];
		if ( argument === '--config' || argument === '--data' )
		{
			options.Config = value_after( argv, index, argument );
			index++;
		}
		else if ( argument === '--port' )
		{
			let port = parseInt( value_after( argv, index, argument ), 10 );
			if ( !( Number.isInteger( port ) && port >= 0 && port <= 65535 ) )
			{
				throw new Error( '--port takes a whole number from 0 to 65535' );
			}
			options.Port = port;
			index++;
		}
		else if ( argument === '--scope' )
		{
			let scope = SCOPE_NAMES[ String( value_after( argv, index, argument ) ).toLowerCase() ];
			if ( !scope )
			{
				throw new Error( '--scope takes none, local or public' );
			}
			options.Scope = scope;
			index++;
		}
		else if ( argument === '--headless' )
		{
			options.Headless = true;
		}
		else if ( argument === '--help' || argument === '-h' )
		{
			options.Help = true;
		}
		else if ( argument === '--host' )
		{
			throw new Error( '--host is gone: --scope local listens on this machine, --scope public on every interface' );
		}
		else if ( argument === '--project' || !argument.startsWith( '-' ) )
		{
			throw new Error( 'a project folder on the command line is not supported yet' );
		}
		else
		{
			throw new Error( 'unknown argument "' + argument + '"' );
		}
	}
	return options;
}


function value_after( argv, index, argument )
{
	let value = argv[ index + 1 ];
	if ( value === undefined || value.startsWith( '--' ) )
	{
		throw new Error( argument + ' needs a value' );
	}
	return value;
}


//---------------------------------------------------------------------
// Run: the server from the options, and what to say about it.

async function Run( Options, Log )
{
	let log = Log || function () {};
	let running = await SERVER.Start( { Config: Options.Config, Port: Options.Port, Scope: Options.Scope } );
	for ( let line of Lines( running ) )
	{
		log( line );
	}
	return running;
}


// Lines: what a start prints: the address and the scope, a warning for Public, the config folder and the settings.
function Lines( Running )
{
	let lines = [];
	if ( Running.Server )
	{
		lines.push( 'Consensus at ' + Running.Url + '/ (Scope ' + Running.Scope + ', listening on ' + Running.Address.Host + ')' );
		if ( Running.Scope === 'Public' )
		{
			lines.push( 'warning: listening beyond this machine; anyone who can reach it acts as the owner, and reads the llm token at /instructions' );
		}
	}
	else
	{
		lines.push( 'Scope None: no server started' );
	}
	lines.push( 'config folder ' + Running.Store.Folder );
	lines.push( ( Running.SettingsWritten ? 'settings written to ' : 'settings from ' ) + Running.Store.SettingsPath() );
	return lines;
}


module.exports = {
	Parse: Parse,
	Run: Run,
	Lines: Lines,
	USAGE: USAGE,
	SCOPES: PARTICIPANTS.SCOPES,
};
