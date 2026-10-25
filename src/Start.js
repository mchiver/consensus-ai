'use strict';

// Start - the one start module both entry points share (plan Run Shapes, Step 1): the command line parsed, the
// server started from the config folder, and the lines that say what was started. bin/consensus.js is the headless
// form, for a plain node install and the Docker image; the desktop (desktop/main.js) runs the same and then opens
// its window, unless --headless. Step 4: a project folder on the command line (`consensus <path>`, or --project)
// opens an instance on that project alone, its .consensus made when missing; the lines name the projects loaded. Plan
// Rearchitecturation, Step 1: `consensus serve` is the Server Host, every registered project served, and the bare form
// with no path means the same, so the Docker image and npm start are unchanged; a folder is the one-project server.
//
//   Parse( argv ) -> { Config?, Port?, Scope?, Project?, Headless, Help }   throws on an argument it does not know
//   Run( options, log ) -> running (src/Server.js's), after log( line ) for each line about it
//   Lines( running ) -> the lines a start prints
//   USAGE: the usage line

const SERVER = require( './Server.js' );
const PARTICIPANTS = require( './Participants.js' );

const USAGE = 'usage: consensus [serve | <path> | --project <folder>] [--config <folder>] [--port <port>] [--scope none|local|public] [--headless]';
const SERVE = 'serve';
const SCOPE_NAMES = { none: 'None', local: 'Local', public: 'Public' };


//---------------------------------------------------------------------
// Parse: the arguments after the program's. --data is --config's older name, kept for one release; --host is gone,
// Scope took its place, and the message says so. A bare path is --project's folder; one at a time. The word serve is
// the Host's form, the same as no path at all, and takes no folder.

function Parse( argv )
{
	let options = { Headless: false, Help: false };
	let serve = false;
	for ( let index = 0; index < argv.length; index++ )
	{
		let argument = argv[ index ];
		if ( argument === SERVE )
		{
			serve = true;
		}
		else if ( argument === '--config' || argument === '--data' )
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
			let project = ( argument === '--project' ) ? value_after( argv, index, argument ) : argument;
			if ( options.Project !== undefined )
			{
				throw new Error( 'one project folder at a time: "' + options.Project + '" and "' + project + '"' );
			}
			options.Project = project;
			if ( argument === '--project' )
			{
				index++;
			}
		}
		else
		{
			throw new Error( 'unknown argument "' + argument + '"' );
		}
	}
	if ( serve && options.Project !== undefined )
	{
		throw new Error( 'serve takes no project folder: consensus serve serves every registered project, consensus <path> one' );
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
	let running = await SERVER.Start( { Config: Options.Config, Port: Options.Port, Scope: Options.Scope, Project: Options.Project } );
	for ( let line of await Lines( running ) )
	{
		log( line );
	}
	return running;
}


// Lines: what a start prints: the address and the scope (the port taken instead of one in use, Scope None taken as
// Local for a project on the command line), a warning for Public, the config folder, the settings, and the projects
// loaded, each with its folder (the one project of an isolated instance says so).
async function Lines( Running )
{
	let lines = [];
	if ( Running.Server )
	{
		lines.push( 'Consensus at ' + Running.Url + '/ (Scope ' + Running.Scope + ', listening on ' + Running.Address.Host + ')' );
		if ( Running.PortTaken !== null && Running.PortTaken !== undefined )
		{
			lines.push( 'port ' + Running.PortTaken + ' is in use: listening on ' + Running.Address.Port + ' instead' );
		}
		if ( Running.ScopeForced )
		{
			lines.push( 'Scope None taken as Local: a project on the command line needs this machine\'s server' );
		}
		if ( Running.Scope === 'Public' )
		{
			lines.push( 'warning: listening beyond this machine; people sign in through Clerk with a license, and a bare request is refused' );
		}
	}
	else
	{
		lines.push( 'Scope None: no server started' );
	}
	lines.push( 'config folder ' + Running.Store.Folder );
	lines.push( ( Running.SettingsWritten ? 'settings written to ' : 'settings from ' ) + Running.Store.SettingsPath() );
	if ( Running.Project )
	{
		lines.push( 'project ' + Running.Project.Name + ' at ' + Running.Project.Path + ' (this project only)' );
		return lines;
	}
	for ( let project of await Running.Store.ListProjects() )
	{
		lines.push( 'project ' + project.Name + ' at ' + project.Path );
	}
	return lines;
}


module.exports = {
	Parse: Parse,
	Run: Run,
	Lines: Lines,
	USAGE: USAGE,
	SCOPES: PARTICIPANTS.SCOPES,
};
