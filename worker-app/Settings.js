'use strict';

// Settings - the worker app's app.json (plan Worker Electron App): the one Consensus server, the LLMs every worker
// carries, and the workers, each one workspace with its own token. A worker's settings in the worker's own format
// (worker.json, as bin/worker.js reads it) are built from here when it starts, and validated the same way.
//
//   {
//     "Consensus": { "Url": "http://cube4:3500" },
//     "Inference": [ { "Name": "Claude CLI", "Type": "claude-cli", "Command": "claude", "Model": "sonnet" } ],
//     "Workers": [
//       { "Name": "Consensus", "Token": "…", "Root": "W:/code/consensus.git", "Include": [], "Exclude": [ "~data/**" ],
//         "Build": { "Remote": "origin", "Commands": [ "npm test" ] }, "AutoStart": true }
//     ],
//     "MaxRounds": 20,
//     "TimeoutSeconds": 600
//   }

const FS = require( 'fs' );
const PATH = require( 'path' );
const CRYPTO = require( 'crypto' );
const WORKER = require( '../src/Worker.js' );

const DEFAULT_URL = 'http://127.0.0.1:3500';
const DEFAULT_MAX_ROUNDS = 20;
const DEFAULT_TIMEOUT_SECONDS = 600;
const WEB_HOST = '127.0.0.1';
const FOLDER_NAME_FORBIDDEN = /[\\/:*?"<>|]/;


//---------------------------------------------------------------------
// Default: the settings a new app starts with.

function Default()
{
	return {
		Consensus: { Url: DEFAULT_URL },
		Inference: [],
		Workers: [],
		MaxRounds: DEFAULT_MAX_ROUNDS,
		TimeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
	};
}


//---------------------------------------------------------------------
// NewToken: a worker's token, as bin/worker.js makes one.

function NewToken()
{
	return CRYPTO.randomBytes( 24 ).toString( 'hex' );
}


//---------------------------------------------------------------------
// Read: app.json, filled in with what it lacks; the defaults when there is no file.

function Read( Path )
{
	let read = {};
	if ( FS.existsSync( Path ) )
	{
		read = JSON.parse( FS.readFileSync( Path, 'utf8' ) );
	}
	return Fill( read );
}


// Fill: a settings object with every field present, in the app's shape.
function Fill( Settings )
{
	let settings = Default();
	let given = ( Settings && typeof Settings === 'object' ) ? Settings : {};
	if ( given.Consensus && typeof given.Consensus.Url === 'string' )
	{
		settings.Consensus.Url = given.Consensus.Url;
	}
	if ( Array.isArray( given.Inference ) )
	{
		settings.Inference = given.Inference.map( fill_inference );
	}
	if ( Array.isArray( given.Workers ) )
	{
		settings.Workers = given.Workers.map( fill_worker );
	}
	if ( given.MaxRounds !== undefined )
	{
		settings.MaxRounds = given.MaxRounds;
	}
	if ( given.TimeoutSeconds !== undefined )
	{
		settings.TimeoutSeconds = given.TimeoutSeconds;
	}
	return settings;
}


function fill_inference( item )
{
	let given = item || {};
	let filled = {
		Name: given.Name || '',
		Type: given.Type || 'claude-cli',
	};
	if ( given.Command !== undefined )
	{
		filled.Command = given.Command;
	}
	if ( given.Url !== undefined )
	{
		filled.Url = given.Url;
	}
	if ( given.Model !== undefined && given.Model !== null && given.Model !== '' )
	{
		filled.Model = given.Model;
	}
	return filled;
}


function fill_worker( item )
{
	let given = item || {};
	let filled = {
		Name: given.Name || '',
		Token: given.Token || NewToken(),
		Root: given.Root || '',
		Include: Array.isArray( given.Include ) ? given.Include.slice() : [],
		Exclude: Array.isArray( given.Exclude ) ? given.Exclude.slice() : [],
		Build: null,
		AutoStart: !!given.AutoStart,
	};
	if ( given.Build && typeof given.Build === 'object' )
	{
		filled.Build = { Remote: given.Build.Remote || 'origin', Commands: Array.isArray( given.Build.Commands ) ? given.Build.Commands.slice() : [] };
	}
	return filled;
}


//---------------------------------------------------------------------
// Write: app.json, whole and atomic.

function Write( Path, Settings )
{
	FS.mkdirSync( PATH.dirname( Path ), { recursive: true } );
	let temporary = Path + '.' + process.pid + '.tmp';
	FS.writeFileSync( temporary, JSON.stringify( Settings, null, '\t' ) + '\n' );
	FS.renameSync( temporary, Path );
}


//---------------------------------------------------------------------
// WorkerSettings: a worker's settings in the worker's format, from the app's settings and one of its workers, for
// the given port. Every Inference item goes with it; its one workspace is named after the worker.

function WorkerSettings( Settings, Worker, Port )
{
	let workspace = {
		Kind: 'Workspace',
		Name: Worker.Name,
		Root: Worker.Root,
		Include: ( Worker.Include || [] ).slice(),
		Exclude: ( Worker.Exclude || [] ).slice(),
	};
	if ( Worker.Build )
	{
		workspace.Build = { Remote: Worker.Build.Remote || 'origin', Commands: ( Worker.Build.Commands || [] ).slice() };
	}
	let items = [ workspace ];
	for ( let item of Settings.Inference || [] )
	{
		items.push( Object.assign( { Kind: 'Inference' }, item ) );
	}
	return {
		Name: Worker.Name,
		Consensus: { Url: Settings.Consensus.Url, Token: Worker.Token },
		Web: { Host: WEB_HOST, Port: Port },
		Items: items,
		MaxRounds: Settings.MaxRounds,
		TimeoutSeconds: Settings.TimeoutSeconds,
	};
}


//---------------------------------------------------------------------
// Problems: what is wrong with the app's settings, as sentences; none when they are usable. Each worker is checked as
// the worker itself would check its settings (Worker.Validate on what WorkerSettings builds).

function Problems( Settings )
{
	let problems = [];
	if ( !Settings || typeof Settings !== 'object' )
	{
		return [ 'the settings are not an object' ];
	}
	let url = Settings.Consensus && Settings.Consensus.Url;
	if ( typeof url !== 'string' || !/^https?:\/\//.test( url ) )
	{
		problems.push( 'Consensus Url must start with http:// or https://' );
	}
	for ( let field of [ 'MaxRounds', 'TimeoutSeconds' ] )
	{
		if ( !( Settings[ field ] > 0 ) )
		{
			problems.push( field + ' must be a number above 0' );
		}
	}
	let names = new Set();
	for ( let item of Settings.Inference || [] )
	{
		if ( !item.Name || !String( item.Name ).trim() )
		{
			problems.push( 'an LLM has no Name' );
		}
		else if ( names.has( item.Name ) )
		{
			problems.push( 'LLM "' + item.Name + '" is named twice' );
		}
		names.add( item.Name );
	}
	names = new Set();
	for ( let worker of Settings.Workers || [] )
	{
		let name = String( worker.Name || '' ).trim();
		if ( !name )
		{
			problems.push( 'a worker has no Name' );
			continue;
		}
		if ( names.has( name ) )
		{
			problems.push( 'worker "' + name + '" is named twice' );
		}
		names.add( name );
		if ( FOLDER_NAME_FORBIDDEN.test( name ) )
		{
			problems.push( 'worker "' + name + '": the Name must be usable as a folder name (no \\ / : * ? " < > |)' );
		}
		// The Url, MaxRounds, TimeoutSeconds, the LLMs and the Name are the app's, reported once above, not once per worker.
		let found = WORKER.Validate( WorkerSettings( Settings, worker, 0 ) );
		for ( let problem of found )
		{
			if ( /^(Consensus\.Url |MaxRounds |TimeoutSeconds |Inference "|Name must be)/.test( problem ) )
			{
				continue;
			}
			problems.push( 'worker "' + name + '": ' + problem );
		}
	}
	return problems;
}


//---------------------------------------------------------------------
// WorkerFolder: where a worker's worker.json and jobs.json live, under the app's user-data folder.

function WorkerFolder( UserData, Name )
{
	return PATH.join( UserData, 'workers', Name );
}


module.exports = {
	Default: Default,
	Fill: Fill,
	NewToken: NewToken,
	Read: Read,
	Write: Write,
	WorkerSettings: WorkerSettings,
	Problems: Problems,
	WorkerFolder: WorkerFolder,
};
