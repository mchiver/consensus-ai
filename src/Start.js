'use strict';

// Start - the one start module both entry points share (plan Run Shapes, Step 1): the command line parsed, the
// server started from the config folder, and the lines that say what was started. bin/consensus.js is the headless
// form, for a plain node install and the Docker image; the desktop (desktop/main.js) runs the same and then opens
// its window, unless --headless. Step 4: a project folder on the command line (`consensus <path>`, or --project)
// opens an instance on that project alone, its .consensus made when missing; the lines name the projects loaded. Plan
// Rearchitecturation, Step 1: `consensus serve` is the Server Host, every registered project served, and the bare form
// with no path means the same, so the Docker image and npm start are unchanged; a folder is the one-project server.
// Step 3: that server is the sidecar (Sidecar.js): a folder already open in a running sidecar is not opened again;
// Run asks that sidecar to bring its window to the front and answers { Open } in place of a server, as VS Code
// activates the window that has the folder.
//
//   Parse( argv ) -> { Config?, Port?, Scope?, Project?, Headless, Help }   throws on an argument it does not know
//   Run( options, log ) -> running (src/Server.js's), after log( line ) for each line about it; for a folder already
//                          open, { Server: null, Open: <the sidecar's record>, Activated, Close }
//   Lines( running ) -> the lines a start prints
//   USAGE: the usage line

const SERVER = require( './Server.js' );
const PARTICIPANTS = require( './Participants.js' );
const SIDECAR = require( './Sidecar.js' );

const USAGE = 'usage: consensus [serve | <path> | --project <folder> | mcp <folder>] [--config <folder>] [--port <port>] [--scope none|local|public] [--headless]';
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
// Run: the server from the options, and what to say about it. A folder whose sidecar runs (its address file there
// and its process alive) is left to it: the sidecar is asked to bring its window to the front, and the answer carries
// Open, the sidecar's record, in place of a server. Options.Activate is the Desktop's function for its own window.

async function Run( Options, Log )
{
	let log = Log || function () {};
	if ( Options.Project )
	{
		let open = SIDECAR.Running( Options.Project );
		if ( open )
		{
			let activated = await SIDECAR.Activate( open.Url );
			let running = { Server: null, Open: open, Activated: activated.Ok, Url: open.Url, Close: async function () {} };
			for ( let line of await Lines( running ) )
			{
				log( line );
			}
			return running;
		}
	}
	let running = await SERVER.Start( { Config: Options.Config, Port: Options.Port, Scope: Options.Scope, Project: Options.Project, Activate: Options.Activate, ReadOnly: Options.ReadOnly, Tier: Options.Tier } );
	for ( let line of await Lines( running ) )
	{
		log( line );
	}
	return running;
}


// Lines: what a start prints: the address and the scope (the port taken instead of one in use, the Scope a project's
// server takes), a warning for Public, the config folder, the settings, and the projects loaded, each with its
// folder (the one project of an isolated instance says so, and where its address file is). A folder already open
// says so in one line.
async function Lines( Running )
{
	let lines = [];
	if ( Running.Open )
	{
		let project = Running.Open.Project ? Running.Open.Project.Name : 'the project';
		lines.push( project + ' is open in Consensus at ' + Running.Open.Url + '/' + ( Running.Activated ? ': its window brought to the front' : ' (no window to bring to the front)' ) );
		return lines;
	}
	if ( Running.Server )
	{
		lines.push( 'Consensus at ' + Running.Url + '/ (Scope ' + Running.Scope + ', listening on ' + Running.Address.Host + ')' );
		if ( Running.PortTaken !== null && Running.PortTaken !== undefined )
		{
			lines.push( 'port ' + Running.PortTaken + ' is in use: listening on ' + Running.Address.Port + ' instead' );
		}
		if ( Running.ScopeForced && Running.SidecarOff )
		{
			lines.push( 'Scope None: the server listens on this machine for the window alone; the sidecar is off, no address file written' );
		}
		else if ( Running.ScopeForced )
		{
			lines.push( 'Scope Public taken as Local: the sidecar never listens beyond this machine' );
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
		if ( Running.Sidecar )
		{
			lines.push( 'sidecar address in ' + Running.Sidecar.Path );
		}
		return lines;
	}
	let unmounted = 0;
	for ( let project of await Running.Store.ListProjects() )
	{
		lines.push( 'project ' + project.Name + ' at ' + project.Path + ( project.Mounted === true ? '' : ' (unmounted)' ) );
		unmounted += ( project.Mounted === true ) ? 0 : 1;
	}
	// The Host serves accounts the mounted projects alone (plan Rearchitecturation, Step 5); the Administrator mounts.
	if ( Running.Server && unmounted > 0 )
	{
		lines.push( unmounted + ( unmounted === 1 ? ' project is' : ' projects are' ) + ' unmounted: accounts see mounted projects alone; the Administrator mounts a project in its menu on the Host\'s page' );
	}
	if ( Running.HostFile )
	{
		lines.push( 'host address in ' + Running.HostFile );
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
