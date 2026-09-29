'use strict';

// Worker - runs beside the code (plan Workers) and takes jobs from Consensus: it says what it offers (hello), asks for
// jobs with a request Consensus holds open, runs each one in its workspace, and posts the answer. It connects out to
// Consensus; Consensus never connects to it. One job at a time.
//
//   worker.json:
//   {
//     "Name": "Workstation",
//     "Consensus": { "Url": "http://cube4:3500", "Token": "<this worker's token, as in consensus.json's Workers>" },
//     "Web": { "Host": "127.0.0.1", "Port": 3700 },
//     "Items": [
//       { "Kind": "Workspace", "Name": "Consensus", "Root": "W:/code/consensus.git", "Include": [], "Exclude": [ "~data/**" ],
//         "Build": { "Remote": "origin", "Commands": [ "npm test", "node --test" ] } },
//       { "Kind": "Inference", "Name": "Claude CLI", "Type": "claude-cli", "Command": "claude", "Model": "sonnet" },
//       { "Kind": "Inference", "Name": "Ollama", "Type": "ollama", "Url": "http://127.0.0.1:11434", "Model": "glm-5.3:cloud" }
//     ],
//     "MaxRounds": 20,
//     "TimeoutSeconds": 600
//   }
//
// A review (plan Review) runs the model in the workspace with read-only tools, until it answers or reaches MaxRounds
// or TimeoutSeconds:
//   claude-cli   claude -p in the workspace's Root, restricted to Read, Grep and Glob there (Exclude denied too), the
//                plan tools through the MCP server in Mcp.js, stream-json so each tool call is seen as it happens.
//   ollama       the loop runs here, through /api/chat with tools: glob, grep, read (Workspace.js) and the plan tools;
//                then once more with the answer's schema as the format.
// A build (plan Build) runs claude -p in the workspace's Root as it is, with Edit and Write too, and Bash for the
// workspace's Build.Commands only: allowed by permission rules, and held to them by a PreToolUse hook (bin/worker.js
// --bash-guard, BashAllowed below), since claude lets some read-only commands, git status among them, through on
// its own. The worker does nothing with git on its own: the owner's Commit and Push, on an
// accepted build on the worker's page, are the only git it runs, one at a time, in the order pressed.
// The worker's page (Web.Host:Port, public/worker) shows the connection, the current job, its tool calls and its
// answer, and the last jobs (kept in <Folder>/jobs.json); it pauses, resumes, cancels and reloads the settings.

const FS = require( 'fs' );
const PATH = require( 'path' );
const OS = require( 'os' );
const CRYPTO = require( 'crypto' );
const CHILD_PROCESS = require( 'child_process' );
const UTIL = require( 'util' );
const EXPRESS = require( 'express' );
const EVENTS = require( './Events.js' );
const WORKSPACE = require( './Workspace.js' );
const MCP = require( './Mcp.js' );

const TYPES = [ 'claude-cli', 'ollama' ];
const DEFAULT_WEB_HOST = '127.0.0.1';
const DEFAULT_WEB_PORT = 3700;
const DEFAULT_MAX_ROUNDS = 20;
const DEFAULT_TIMEOUT_SECONDS = 600;
const JOBS_KEPT = 50;
const POLL_TIMEOUT = 45000;
const REQUEST_TIMEOUT = 30000;
const ANSWER_TIMEOUT = 120000;
const RETRY_MILLISECONDS = 5000;
const RESULT_SHOWN = 300;
const PLAN_TOOLS = MCP.TOOLS.map( function ( tool ) { return tool.name; } );
const PUBLIC_FOLDER = PATH.join( __dirname, '..', 'public', 'worker' );
const EXEC_FILE = UTIL.promisify( CHILD_PROCESS.execFile );
const GIT_TIMEOUT = 120000;
const COMMIT_SUMMARY_LENGTH = 2000;

// The file tools, as Ollama is given them; the plan tools come from Mcp.js.
const FILE_TOOLS = [
	{
		name: 'glob',
		description: 'The workspace\'s file paths that match a gitignore-style pattern, such as **/*.js or src/*.md.',
		parameters: { type: 'object', properties: { Pattern: { type: 'string' } }, required: [ 'Pattern' ] },
	},
	{
		name: 'grep',
		description: 'The lines of the workspace\'s files that match a regular expression, as path:line: text. Glob narrows the files.',
		parameters: { type: 'object', properties: { Pattern: { type: 'string' }, Glob: { type: 'string' }, IgnoreCase: { type: 'boolean' } }, required: [ 'Pattern' ] },
	},
	{
		name: 'read',
		description: 'A file of the workspace, its lines numbered; Offset is the first line to show and Limit how many.',
		parameters: { type: 'object', properties: { Path: { type: 'string' }, Offset: { type: 'integer' }, Limit: { type: 'integer' } }, required: [ 'Path' ] },
	},
];


//---------------------------------------------------------------------
// DefaultSettings: a settings file to start from, with a new token and no items.

function DefaultSettings()
{
	return {
		Name: 'Workstation',
		Consensus: { Url: 'http://127.0.0.1:3500', Token: CRYPTO.randomBytes( 24 ).toString( 'hex' ) },
		Web: { Host: DEFAULT_WEB_HOST, Port: DEFAULT_WEB_PORT },
		Items: [],
		MaxRounds: DEFAULT_MAX_ROUNDS,
		TimeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
	};
}


//---------------------------------------------------------------------
// Validate: the problems with the settings, as sentences; none when they are usable.

function Validate( Settings )
{
	let problems = [];
	if ( !Settings || typeof Settings !== 'object' )
	{
		return [ 'the settings are not an object' ];
	}
	if ( typeof Settings.Name !== 'string' || !Settings.Name.trim() || Settings.Name.includes( '/' ) )
	{
		problems.push( 'Name must be a name without "/"' );
	}
	let consensus = Settings.Consensus || {};
	if ( typeof consensus.Url !== 'string' || !/^https?:\/\//.test( consensus.Url ) )
	{
		problems.push( 'Consensus.Url must start with http:// or https://' );
	}
	if ( typeof consensus.Token !== 'string' || consensus.Token.length < 16 )
	{
		problems.push( 'Consensus.Token must be a string of 16 characters or more' );
	}
	for ( let field of [ 'MaxRounds', 'TimeoutSeconds' ] )
	{
		if ( Settings[ field ] !== undefined && !( Settings[ field ] > 0 ) )
		{
			problems.push( field + ' must be a number above 0' );
		}
	}
	if ( Settings.Items !== undefined && !Array.isArray( Settings.Items ) )
	{
		problems.push( 'Items must be a list' );
		return problems;
	}
	let names = { Workspace: new Set(), Inference: new Set() };
	for ( let item of Settings.Items || [] )
	{
		if ( !item || ( item.Kind !== 'Workspace' && item.Kind !== 'Inference' ) )
		{
			problems.push( 'an item\'s Kind must be Workspace or Inference' );
			continue;
		}
		if ( typeof item.Name !== 'string' || !item.Name.trim() )
		{
			problems.push( 'a ' + item.Kind + ' item has no Name' );
			continue;
		}
		if ( names[ item.Kind ].has( item.Name ) )
		{
			problems.push( item.Kind + ' "' + item.Name + '" is named twice' );
		}
		names[ item.Kind ].add( item.Name );
		if ( item.Kind === 'Workspace' )
		{
			problems = problems.concat( workspace_problems( item ) );
		}
		else
		{
			if ( !TYPES.includes( item.Type ) )
			{
				problems.push( 'Inference "' + item.Name + '": Type must be one of ' + TYPES.join( ', ' ) );
			}
			if ( item.Type === 'ollama' && !item.Url )
			{
				problems.push( 'Inference "' + item.Name + '" of type ollama needs a Url' );
			}
		}
	}
	return problems;
}


function workspace_problems( item )
{
	let problems = [];
	if ( typeof item.Root !== 'string' || !PATH.isAbsolute( item.Root ) )
	{
		problems.push( 'Workspace "' + item.Name + '" needs an absolute Root' );
	}
	else if ( !FS.existsSync( item.Root ) || !FS.statSync( item.Root ).isDirectory() )
	{
		problems.push( 'Workspace "' + item.Name + '": Root ' + item.Root + ' is not a folder' );
	}
	for ( let field of [ 'Include', 'Exclude' ] )
	{
		if ( item[ field ] !== undefined && !Array.isArray( item[ field ] ) )
		{
			problems.push( 'Workspace "' + item.Name + '": ' + field + ' must be a list of patterns' );
		}
	}
	if ( item.Build !== undefined )
	{
		let build = item.Build || {};
		let commands = build.Commands;
		if ( !Array.isArray( commands ) || !commands.length || commands.some( function ( command ) { return typeof command !== 'string' || !command.trim() || /[()]/.test( command ); } ) )
		{
			problems.push( 'Workspace "' + item.Name + '": Build.Commands must be a list of commands, such as "npm test", without parentheses' );
		}
		if ( build.Remote !== undefined && ( typeof build.Remote !== 'string' || !build.Remote.trim() ) )
		{
			problems.push( 'Workspace "' + item.Name + '": Build.Remote must be a remote\'s name' );
		}
	}
	return problems;
}


//---------------------------------------------------------------------
// Start( Options ) -> { Url, State, Reload, Close }. Options = { Settings, SettingsPath?, Folder, Port?, Runner?,
// ClaudeCommand? }. Folder keeps jobs.json. SettingsPath is read again on Reload. For tests: Port overrides Web.Port;
// Runner( Job, Tools, Context ) replaces the model; ClaudeCommand ([ command, ...arguments ]) replaces claude.

async function Start( Options )
{
	let settings = Options.Settings;
	let problems = Validate( settings );
	if ( problems.length )
	{
		throw new Error( 'worker settings: ' + problems.join( '; ' ) );
	}
	let folder = Options.Folder;
	FS.mkdirSync( folder, { recursive: true } );
	let jobs_file = PATH.join( folder, 'jobs.json' );
	let workspaces = {};
	let inference = {};
	let closed = false;
	let said_hello = false;
	let poll_abort = null;
	let reasking = false;
	let wake_retry = null;
	let running_job = null;
	let events = EVENTS.Hub();
	let state = {
		Name: settings.Name,
		Consensus: { Url: settings.Consensus.Url, Connected: false, Heard: null, Error: null },
		Paused: false,
		Current: null,
		Jobs: read_jobs(),
	};
	open_items();


	//-----------------------------------------------------------------
	// Items

	function open_items()
	{
		workspaces = {};
		inference = {};
		for ( let item of settings.Items || [] )
		{
			if ( item.Kind === 'Workspace' )
			{
				workspaces[ item.Name ] = { Item: item, Files: WORKSPACE.Open( item ) };
			}
			if ( item.Kind === 'Inference' )
			{
				inference[ item.Name ] = item;
			}
		}
	}


	function max_rounds()
	{
		return settings.MaxRounds || DEFAULT_MAX_ROUNDS;
	}


	function timeout_seconds()
	{
		return settings.TimeoutSeconds || DEFAULT_TIMEOUT_SECONDS;
	}


	//-----------------------------------------------------------------
	// Consensus: one request with the worker's token; its JSON answer, or an error.

	async function ask( method, path, body, timeout, signal )
	{
		let url = String( settings.Consensus.Url ).replace( /\/+$/, '' ) + path;
		let signals = [ AbortSignal.timeout( timeout || REQUEST_TIMEOUT ) ];
		if ( signal )
		{
			signals.push( signal );
		}
		let response = await fetch( url, {
			method: method,
			headers: { 'Authorization': 'Bearer ' + settings.Consensus.Token, 'Content-Type': 'application/json' },
			body: body ? JSON.stringify( body ) : undefined,
			signal: AbortSignal.any( signals ),
		} );
		let json = await response.json().catch( function () { return {}; } );
		if ( !response.ok )
		{
			throw new Error( 'Consensus answered ' + response.status + ': ' + ( json.Error || 'no reason given' ) );
		}
		return json;
	}


	async function hello()
	{
		let offer = { Workspaces: [], Inference: [] };
		for ( let name of Object.keys( workspaces ) )
		{
			offer.Workspaces.push( { Name: name, Build: !!workspaces[ name ].Item.Build } );
		}
		for ( let name of Object.keys( inference ) )
		{
			let item = inference[ name ];
			offer.Inference.push( { Name: name, Type: item.Type, Model: item.Model || null, Models: await models_of( item ) } );
		}
		await ask( 'POST', '/api/workers/hello', offer );
		said_hello = true;
		// Consensus answered: connected now, not only once the first ask for jobs, held open, comes back.
		connected( true );
	}


	// An Ollama item's models, as its server lists them; none when it does not answer.
	async function models_of( item )
	{
		if ( item.Type !== 'ollama' )
		{
			return item.Model ? [ item.Model ] : [];
		}
		try
		{
			let answer = await fetch( String( item.Url ).replace( /\/+$/, '' ) + '/api/tags', { signal: AbortSignal.timeout( 5000 ) } );
			let json = await answer.json();
			return ( json.models || [] ).map( function ( model ) { return model.name; } ).sort();
		}
		catch ( error )
		{
			return item.Model ? [ item.Model ] : [];
		}
	}


	function connected( online, error )
	{
		let changed_now = state.Consensus.Connected !== online || state.Consensus.Error !== ( error || null );
		state.Consensus.Connected = online;
		state.Consensus.Error = error || null;
		if ( online )
		{
			state.Consensus.Heard = new Date().toISOString();
		}
		if ( changed_now )
		{
			notify();
		}
	}


	// Asks for jobs until closed: a job is run (not awaited), a change noted. While a job runs, or while paused, it
	// asks for changes only, which keeps it heard.
	async function loop()
	{
		while ( !closed )
		{
			try
			{
				if ( !said_hello )
				{
					await hello();
				}
				let busy = state.Paused || !!running_job;
				poll_abort = new AbortController();
				let answer = await ask( 'GET', '/api/workers/jobs' + ( busy ? '?busy=1' : '' ), null, POLL_TIMEOUT, poll_abort.signal );
				poll_abort = null;
				connected( true );
				if ( answer.Hello )
				{
					said_hello = false;
				}
				if ( answer.Job )
				{
					running_job = run( answer.Job ).finally( function () { running_job = null; } );
				}
				if ( answer.Change )
				{
					on_change( answer.Change );
				}
			}
			catch ( error )
			{
				poll_abort = null;
				if ( closed )
				{
					break;
				}
				if ( reasking )
				{
					reasking = false;
					continue;
				}
				said_hello = false;
				connected( false, error.message );
				await new Promise( function ( resolve )
				{
					let timer = setTimeout( resolve, RETRY_MILLISECONDS );
					wake_retry = function () { clearTimeout( timer ); resolve(); };
				} );
				wake_retry = null;
			}
		}
	}


	// A change to one of this worker's jobs, as Consensus passes it on; kept on the job's record.
	function on_change( change )
	{
		let record = state.Jobs.find( function ( job ) { return job.Id === change.Job; } );
		if ( record )
		{
			record.Changes = ( record.Changes || [] ).concat( [ Object.assign( { At: new Date().toISOString() }, change ) ] );
			if ( change.Change === 'accepted' )
			{
				record.Accepted = true;
			}
			write_jobs();
			notify();
		}
	}


	//-----------------------------------------------------------------
	// Jobs

	async function run( job )
	{
		let abort = new AbortController();
		let record = {
			Id: job.Id,
			Kind: job.Kind,
			Proposal: job.Proposal,
			Title: job.Title,
			Project: job.Project,
			Workspace: job.Workspace,
			Inference: job.Inference,
			Model: job.Model,
			Started: new Date().toISOString(),
			Finished: null,
			Status: 'running',
			Calls: [],
			Answer: null,
			Usage: null,
			Error: null,
			Carried: null,
		};
		state.Current = record;
		state.Current.Abort = abort;
		notify();
		let body = null;
		try
		{
			let workspace = workspaces[ job.Workspace ];
			let item = inference[ job.Inference ];
			if ( job.Kind !== 'Review' && job.Kind !== 'Build' )
			{
				throw new Error( 'this worker does not run ' + job.Kind + ' jobs' );
			}
			if ( !workspace )
			{
				throw new Error( 'this worker has no workspace "' + job.Workspace + '"' );
			}
			if ( !item )
			{
				throw new Error( 'this worker has no inference item "' + job.Inference + '"' );
			}
			if ( job.Kind === 'Build' && !workspace.Item.Build )
			{
				throw new Error( 'the workspace "' + job.Workspace + '" has no Build settings' );
			}
			if ( job.Kind === 'Build' && item.Type !== 'claude-cli' )
			{
				throw new Error( 'only claude-cli builds' );
			}
			let tools = tools_for( job, workspace, record );
			let context = { Kind: job.Kind, Item: item, Workspace: workspace, Model: job.Model || item.Model || null, Signal: abort.signal, MaxRounds: max_rounds(), TimeoutSeconds: timeout_seconds() };
			let runner = Options.Runner;
			if ( !runner )
			{
				runner = ( job.Kind === 'Build' ) ? claude_build : ( ( item.Type === 'claude-cli' ) ? claude_review : ollama_review );
			}
			let answered = await runner( job, tools, context );
			record.Answer = answered.Answer;
			record.Usage = answered.Usage || null;
			body = { Answer: answered.Answer, Usage: answered.Usage || null };
		}
		catch ( error )
		{
			record.Error = abort.signal.aborted ? 'cancelled on the worker' : error.message;
			body = { Error: record.Error };
		}
		try
		{
			record.Carried = await ask( 'POST', '/api/workers/jobs/' + encodeURIComponent( job.Id ) + '/answer', body, ANSWER_TIMEOUT );
		}
		catch ( error )
		{
			record.Error = record.Error || 'the answer did not reach Consensus: ' + error.message;
		}
		record.Status = abort.signal.aborted ? 'cancelled' : ( record.Error ? 'failed' : 'done' );
		record.Finished = new Date().toISOString();
		delete record.Abort;
		state.Current = null;
		state.Jobs.push( record );
		state.Jobs = state.Jobs.slice( -JOBS_KEPT );
		write_jobs();
		notify();
		// The next job may be waiting already: ask again at once.
		reask();
	}


	// The ask held open now is dropped, and a new one made at once (after a job, a resume, a reload).
	function reask()
	{
		if ( poll_abort )
		{
			reasking = true;
			poll_abort.abort();
		}
	}


	// What a runner calls: Call( name, input ) runs a tool here and gives its text; Note( name, input ) records a
	// call made elsewhere (claude's own tools) and gives its record, whose Result the runner sets; Step( text ) is a
	// line for the run log.
	function tools_for( job, workspace, record )
	{
		function note( name, input )
		{
			let call = { At: new Date().toISOString(), Tool: name, Input: input || {}, Text: describe_call( name, input || {}, workspace.Files.Root ), Result: null };
			record.Calls.push( call );
			notify();
			step( call.Text );
			return call;
		}

		function step( text )
		{
			ask( 'POST', '/api/workers/jobs/' + encodeURIComponent( job.Id ) + '/step', { Text: text } ).catch( function () {} );
		}

		async function call_tool( name, input )
		{
			let given = input || {};
			let call = note( name, given );
			let result = null;
			try
			{
				if ( name === 'glob' )
				{
					result = workspace.Files.Glob( given.Pattern );
				}
				else if ( name === 'grep' )
				{
					result = workspace.Files.Grep( given.Pattern, given.Glob, given.IgnoreCase );
				}
				else if ( name === 'read' )
				{
					result = workspace.Files.Read( given.Path, given.Offset, given.Limit );
				}
				else if ( PLAN_TOOLS.includes( name ) )
				{
					result = ( await ask( 'POST', '/api/workers/jobs/' + encodeURIComponent( job.Id ) + '/tool', Object.assign( {}, given, { Tool: name } ) ) ).Result;
				}
				else
				{
					result = 'refused: there is no tool ' + name;
				}
			}
			catch ( error )
			{
				result = 'refused: ' + error.message;
			}
			call.Result = shown( result );
			notify();
			return String( result );
		}

		return { Call: call_tool, Note: note, Step: step, Shown: shown, Changed: notify };
	}


	//-----------------------------------------------------------------
	// claude -p, restricted to the workspace and its read-only tools, the plan tools through Mcp.js.

	async function claude_review( job, tools, context )
	{
		let workspace = context.Workspace;
		let config_file = write_mcp_config( job );
		let args = [
			'-p',
			'--output-format', 'stream-json',
			'--verbose',
			'--json-schema', JSON.stringify( job.Schema ),
			'--tools', 'Read,Grep,Glob',
			'--allowedTools', 'Read,Grep,Glob,mcp__consensus',
			'--permission-mode', 'dontAsk',
			'--restricted',
			'--strict-mcp-config',
			'--mcp-config', config_file,
			'--disable-slash-commands',
			'--no-session-persistence',
			'--max-turns', String( context.MaxRounds ),
		];
		let denied = ( workspace.Item.Exclude || [] ).map( function ( pattern ) { return 'Read(' + pattern + ')'; } );
		if ( denied.length )
		{
			args.push( '--disallowedTools' );
			args = args.concat( denied );
		}
		if ( context.Model )
		{
			args.push( '--model', context.Model );
		}
		try
		{
			return await run_claude( args, job.Prompt, workspace.Files.Root, tools, context );
		}
		finally
		{
			FS.rmSync( config_file, { force: true } );
		}
	}


	// A build: claude -p in the workspace's Root with the file tools that write, and Bash for Build.Commands only. The
	// commands it may run go at the end of its prompt.
	async function claude_build( job, tools, context )
	{
		let workspace = context.Workspace;
		let commands = workspace.Item.Build.Commands;
		let config_file = write_mcp_config( job );
		let allowed = [ 'Read', 'Grep', 'Glob', 'Edit', 'Write', 'mcp__consensus' ].concat( commands.map( function ( command ) { return 'Bash(' + command.trim() + ':*)'; } ) );
		let args = [
			'-p',
			'--output-format', 'stream-json',
			'--verbose',
			'--json-schema', JSON.stringify( job.Schema ),
			'--tools', 'Read,Grep,Glob,Edit,Write,Bash',
			'--allowedTools', allowed.join( ',' ),
			'--permission-mode', 'dontAsk',
			'--restricted',
			'--strict-mcp-config',
			'--mcp-config', config_file,
			'--disable-slash-commands',
			'--no-session-persistence',
			'--max-turns', String( context.MaxRounds ),
		];
		let denied = [];
		for ( let pattern of workspace.Item.Exclude || [] )
		{
			denied.push( 'Read(' + pattern + ')', 'Edit(' + pattern + ')' );
		}
		if ( denied.length )
		{
			args.push( '--disallowedTools' );
			args = args.concat( denied );
		}
		if ( context.Model )
		{
			args.push( '--model', context.Model );
		}
		args.push( '--settings', JSON.stringify( guard_settings() ) );
		let prompt = job.Prompt + '\n# The commands you may run\n\n' + commands.map( function ( command ) { return '- ' + command.trim(); } ).join( '\n' ) + '\n';
		let env = Object.assign( {}, process.env, { CONSENSUS_WORKER_COMMANDS: JSON.stringify( commands ) } );
		try
		{
			return await run_claude( args, prompt, workspace.Files.Root, tools, Object.assign( {}, context, { Env: env } ) );
		}
		finally
		{
			FS.rmSync( config_file, { force: true } );
		}
	}


	// The hook that holds Bash to the build's commands: every Bash call is asked of bin/worker.js --bash-guard first,
	// which reads the commands from CONSENSUS_WORKER_COMMANDS and refuses the rest.
	function guard_settings()
	{
		let node = process.execPath.split( '\\' ).join( '/' );
		let bin = PATH.join( __dirname, '..', 'bin', 'worker.js' ).split( '\\' ).join( '/' );
		return {
			hooks: {
				PreToolUse: [ { matcher: 'Bash', hooks: [ { type: 'command', command: '"' + node + '" "' + bin + '" --bash-guard' } ] } ],
			},
		};
	}


	// The MCP config claude starts the plan tools with: this worker's bin in --mcp mode, the token in its env. Written
	// to a file only this user reads, and removed after the job.
	function write_mcp_config( job )
	{
		let config = {
			mcpServers: {
				consensus: {
					command: process.execPath,
					args: [ PATH.join( __dirname, '..', 'bin', 'worker.js' ), '--mcp' ],
					env: {
						CONSENSUS_WORKER_URL: settings.Consensus.Url,
						CONSENSUS_WORKER_TOKEN: settings.Consensus.Token,
						CONSENSUS_WORKER_JOB: job.Id,
					},
				},
			},
		};
		let file = PATH.join( OS.tmpdir(), 'consensus-mcp-' + job.Id + '-' + CRYPTO.randomBytes( 4 ).toString( 'hex' ) + '.json' );
		FS.writeFileSync( file, JSON.stringify( config ), { mode: 0o600 } );
		return file;
	}


	function run_claude( args, prompt, cwd, tools, context )
	{
		let command = Options.ClaudeCommand ? Options.ClaudeCommand[ 0 ] : ( context.Item.Command || 'claude' );
		let all_args = Options.ClaudeCommand ? Options.ClaudeCommand.slice( 1 ).concat( args ) : args;
		return new Promise( function ( resolve, reject )
		{
			let child = null;
			try
			{
				child = CHILD_PROCESS.spawn( command, all_args, { cwd: cwd, windowsHide: true, env: context.Env || process.env } );
			}
			catch ( error )
			{
				return reject( new Error( 'could not start ' + command + ': ' + error.message ) );
			}
			let buffer = '';
			let stderr = '';
			let final = null;
			let pending = {};
			let settled = false;
			function finish( error, value )
			{
				if ( settled )
				{
					return;
				}
				settled = true;
				clearTimeout( timer );
				context.Signal.removeEventListener( 'abort', on_abort );
				if ( error )
				{
					reject( error );
				}
				else
				{
					resolve( value );
				}
			}
			function on_abort()
			{
				child.kill();
				finish( new Error( 'cancelled' ) );
			}
			let timer = setTimeout( function ()
			{
				child.kill();
				finish( new Error( command + ' took longer than ' + context.TimeoutSeconds + ' seconds' ) );
			}, context.TimeoutSeconds * 1000 );
			context.Signal.addEventListener( 'abort', on_abort );
			child.stdout.on( 'data', function ( chunk )
			{
				buffer += chunk;
				let lines = buffer.split( '\n' );
				buffer = lines.pop();
				for ( let line of lines )
				{
					let event = parse_line( line );
					if ( event )
					{
						final = on_stream_event( event, pending, tools ) || final;
					}
				}
			} );
			child.stderr.on( 'data', function ( chunk ) { stderr += chunk; } );
			child.on( 'error', function ( error )
			{
				finish( new Error( 'could not start ' + command + ': ' + error.message ) );
			} );
			child.on( 'close', function ( code )
			{
				let event = parse_line( buffer );
				if ( event )
				{
					final = on_stream_event( event, pending, tools ) || final;
				}
				if ( !final )
				{
					let said = stderr.trim().slice( 0, 300 );
					return finish( new Error( command + ' exited ' + code + ' with no result' + ( said ? ': ' + said : '' ) ) );
				}
				try
				{
					finish( null, claude_answer( final, context ) );
				}
				catch ( error )
				{
					finish( error );
				}
			} );
			child.stdin.on( 'error', function () {} );
			child.stdin.end( prompt, 'utf8' );
		} );
	}


	//-----------------------------------------------------------------
	// Ollama: the tool loop runs here.

	async function ollama_review( job, tools, context )
	{
		let item = context.Item;
		let model = context.Model;
		if ( !model )
		{
			throw new Error( 'pick an Ollama model' );
		}
		let deadline = Date.now() + context.TimeoutSeconds * 1000;
		let definitions = FILE_TOOLS.concat( MCP.TOOLS.map( function ( tool ) { return { name: tool.name, description: tool.description, parameters: tool.inputSchema }; } ) );
		let offered = definitions.map( function ( definition ) { return { type: 'function', function: definition }; } );
		let messages = [ { role: 'user', content: job.Prompt } ];
		let usage = { Model: model, Input: 0, Output: 0 };
		for ( let round = 0; round < context.MaxRounds; round++ )
		{
			let reply = await ollama_chat( item, { model: model, messages: messages, tools: offered, stream: false }, deadline, context.Signal );
			add_usage( usage, reply );
			let message = reply.message || { role: 'assistant', content: '' };
			messages.push( message );
			let calls = message.tool_calls || [];
			if ( !calls.length )
			{
				break;
			}
			for ( let call of calls )
			{
				let name = call.function ? call.function.name : '';
				let input = call.function ? call.function.arguments : {};
				if ( typeof input === 'string' )
				{
					try
					{
						input = JSON.parse( input );
					}
					catch ( error )
					{
						input = {};
					}
				}
				let result = await tools.Call( name, input || {} );
				messages.push( { role: 'tool', content: result, tool_name: name } );
			}
		}
		messages.push( { role: 'user', content: 'Give your answer now: the one JSON object the rules describe, and nothing else.' } );
		let final = await ollama_chat( item, { model: model, messages: messages, format: job.Schema, stream: false }, deadline, context.Signal );
		add_usage( usage, final );
		let content = ( final.message && final.message.content ) || '';
		let answer = null;
		try
		{
			answer = JSON.parse( content );
		}
		catch ( error )
		{
			answer = content;
		}
		return { Answer: answer, Usage: usage };
	}


	async function ollama_chat( item, body, deadline, signal )
	{
		let left = deadline - Date.now();
		if ( left <= 0 )
		{
			throw new Error( 'Ollama took longer than ' + timeout_seconds() + ' seconds' );
		}
		let url = String( item.Url ).replace( /\/+$/, '' ) + '/api/chat';
		let response = null;
		try
		{
			response = await fetch( url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify( body ),
				signal: AbortSignal.any( [ signal, AbortSignal.timeout( left ) ] ),
			} );
		}
		catch ( error )
		{
			throw new Error( 'Ollama at ' + item.Url + ' did not answer: ' + error.message );
		}
		if ( !response.ok )
		{
			throw new Error( 'Ollama refused: ' + response.status + ' ' + ( await response.text() ).slice( 0, 200 ) );
		}
		return await response.json();
	}


	//-----------------------------------------------------------------
	// Commit and Push: the owner's buttons on an accepted build, the only git the worker runs. Each is queued and run
	// in the order pressed, in the build's workspace, on whatever is checked out; its result goes on the job's record
	// and into the plan's run log.

	let git_queue = Promise.resolve();


	function Git( JobId, Kind )
	{
		let record = state.Jobs.find( function ( job ) { return job.Id === JobId; } );
		if ( !record || record.Kind !== 'Build' )
		{
			return 'no build ' + JobId + ' on this worker';
		}
		if ( !record.Accepted )
		{
			return 'the build is not accepted yet';
		}
		let workspace = workspaces[ record.Workspace ];
		if ( !workspace || !workspace.Item.Build )
		{
			return 'this worker has no workspace "' + record.Workspace + '" that builds';
		}
		let step = { Kind: Kind, Status: 'queued', At: new Date().toISOString(), Result: null };
		record.Git = ( record.Git || [] ).concat( [ step ] );
		notify();
		git_queue = git_queue.then( function () { return run_git( record, step, workspace ); } );
		return null;
	}


	async function run_git( record, step, workspace )
	{
		step.Status = 'running';
		notify();
		let root = workspace.Files.Root;
		try
		{
			if ( step.Kind === 'commit' )
			{
				await git( root, [ 'add', '-A' ] );
				await git( root, [ 'commit', '-m', commit_message( record ) ] );
				let hash = ( await git( root, [ 'rev-parse', '--short', 'HEAD' ] ) ).trim();
				step.Result = 'Committed ' + hash;
			}
			else
			{
				let remote = workspace.Item.Build.Remote || 'origin';
				let branch = ( await git( root, [ 'rev-parse', '--abbrev-ref', 'HEAD' ] ) ).trim();
				await git( root, [ 'push', remote, branch ] );
				step.Result = 'Pushed ' + branch + ' to ' + remote;
			}
			step.Status = 'done';
		}
		catch ( error )
		{
			step.Status = 'failed';
			step.Result = ( step.Kind === 'commit' ? 'Commit' : 'Push' ) + ' failed: ' + git_error( error );
		}
		write_jobs();
		notify();
		ask( 'POST', '/api/workers/jobs/' + encodeURIComponent( record.Id ) + '/step', { Text: step.Result } ).catch( function () {} );
	}


	// The commit: titled after the plan, a summary of the build log below, no attribution trailers.
	function commit_message( record )
	{
		let log = ( record.Answer && typeof record.Answer.BuildLog === 'string' ) ? record.Answer.BuildLog.trim() : '';
		if ( log.length > COMMIT_SUMMARY_LENGTH )
		{
			log = log.slice( 0, COMMIT_SUMMARY_LENGTH ) + '…';
		}
		return log ? record.Title + '\n\n' + log : record.Title;
	}


	async function git( root, args )
	{
		let result = await EXEC_FILE( 'git', args, { cwd: root, timeout: GIT_TIMEOUT, windowsHide: true, maxBuffer: 10 * 1024 * 1024 } );
		return result.stdout;
	}


	function git_error( error )
	{
		let said = String( error.stderr || error.stdout || error.message || '' ).trim().split( /\r?\n/ ).filter( Boolean );
		return said.length ? said.slice( -3 ).join( ' ' ) : 'git exited ' + error.code;
	}


	//-----------------------------------------------------------------
	// Jobs kept: the last JOBS_KEPT, in jobs.json.

	function read_jobs()
	{
		try
		{
			let kept = JSON.parse( FS.readFileSync( jobs_file, 'utf8' ) );
			return Array.isArray( kept ) ? kept : [];
		}
		catch ( error )
		{
			return [];
		}
	}


	function write_jobs()
	{
		try
		{
			FS.writeFileSync( jobs_file, JSON.stringify( state.Jobs, null, '\t' ) );
		}
		catch ( error )
		{
			console.error( 'worker: jobs.json: ' + error.message );
		}
	}


	//-----------------------------------------------------------------
	// The page: its state, live events, and what the owner does there.

	function notify()
	{
		events.Send( { Kind: 'state' } );
	}


	function State()
	{
		let current = state.Current ? Object.assign( {}, state.Current ) : null;
		if ( current )
		{
			delete current.Abort;
		}
		return {
			Name: state.Name,
			Consensus: Object.assign( {}, state.Consensus ),
			Paused: state.Paused,
			Current: current,
			Jobs: state.Jobs.slice().reverse(),
			Workspaces: Object.keys( workspaces ).map( function ( name ) { return { Name: name, Root: workspaces[ name ].Item.Root, Build: !!workspaces[ name ].Item.Build }; } ),
			Inference: Object.keys( inference ).map( function ( name ) { return { Name: name, Type: inference[ name ].Type, Model: inference[ name ].Model || null }; } ),
		};
	}


	// The settings read again from SettingsPath: new items are offered at once. Returns the problems, if any.
	function Reload()
	{
		if ( !Options.SettingsPath )
		{
			return [ 'there is no settings file to read' ];
		}
		let fresh = null;
		try
		{
			fresh = JSON.parse( FS.readFileSync( Options.SettingsPath, 'utf8' ) );
		}
		catch ( error )
		{
			return [ 'the settings file: ' + error.message ];
		}
		let found = Validate( fresh );
		if ( found.length )
		{
			return found;
		}
		settings = fresh;
		state.Name = settings.Name;
		state.Consensus.Url = settings.Consensus.Url;
		open_items();
		said_hello = false;
		reask();
		if ( wake_retry )
		{
			wake_retry();
		}
		notify();
		return [];
	}


	let app = EXPRESS();
	app.disable( 'x-powered-by' );
	app.use( EXPRESS.json() );
	events.Attach( app, '/api/events' );

	app.get( '/api/state', function ( request, response )
	{
		response.json( State() );
	} );

	app.post( '/api/pause', function ( request, response )
	{
		state.Paused = true;
		notify();
		response.json( State() );
	} );

	app.post( '/api/resume', function ( request, response )
	{
		state.Paused = false;
		reask();
		notify();
		response.json( State() );
	} );

	app.post( '/api/cancel', function ( request, response )
	{
		if ( !state.Current )
		{
			return response.status( 409 ).json( { Error: 'no job is running' } );
		}
		state.Current.Abort.abort();
		response.json( { Cancelled: state.Current.Id } );
	} );

	// Commit and Push, on an accepted build.
	for ( let kind of [ 'commit', 'push' ] )
	{
		app.post( '/api/jobs/:id/' + kind, function ( request, response )
		{
			let problem = Git( request.params.id, kind );
			if ( problem )
			{
				return response.status( 409 ).json( { Error: problem } );
			}
			response.json( State() );
		} );
	}

	app.post( '/api/reload', function ( request, response )
	{
		let found = Reload();
		if ( found.length )
		{
			return response.status( 400 ).json( { Error: found.join( '; ' ) } );
		}
		response.json( State() );
	} );

	if ( Options.Vendor )
	{
		Options.Vendor( app );
	}
	// Light, dark and the size, as Consensus's page keeps them.
	app.get( '/theme.js', function ( request, response )
	{
		response.sendFile( PATH.join( __dirname, '..', 'public', 'js', 'theme.js' ) );
	} );
	if ( FS.existsSync( PUBLIC_FOLDER ) )
	{
		app.use( EXPRESS.static( PUBLIC_FOLDER ) );
	}

	let web = settings.Web || {};
	let host = web.Host || DEFAULT_WEB_HOST;
	let port = ( Options.Port !== undefined ) ? Options.Port : ( web.Port || DEFAULT_WEB_PORT );
	let server = await new Promise( function ( resolve, reject )
	{
		let listening = app.listen( port, host );
		listening.once( 'listening', function () { resolve( listening ); } );
		listening.once( 'error', reject );
	} );
	let looping = loop();

	async function Close()
	{
		closed = true;
		if ( state.Current && state.Current.Abort )
		{
			state.Current.Abort.abort();
		}
		if ( poll_abort )
		{
			poll_abort.abort();
		}
		if ( wake_retry )
		{
			wake_retry();
		}
		await looping;
		if ( running_job )
		{
			await running_job;
		}
		events.Close();
		server.closeAllConnections();
		await new Promise( function ( resolve ) { server.close( resolve ); } );
	}

	return {
		Url: 'http://' + ( host.includes( ':' ) ? '[' + host + ']' : host ) + ':' + server.address().port,
		State: State,
		Reload: Reload,
		Git: Git,
		Settled: function () { return git_queue; },
		Close: Close,
	};
}


//---------------------------------------------------------------------
// BashAllowed: whether a build may run Command, one of Commands or one of them with arguments after it. Nothing that
// chains, pipes, redirects or substitutes is allowed, so an allowed command cannot carry another one in.

function BashAllowed( Command, Commands )
{
	let command = String( Command || '' ).trim();
	if ( !command || /[;&|<>`\n\r]|\$\(/.test( command ) )
	{
		return false;
	}
	return ( Commands || [] ).some( function ( allowed )
	{
		let prefix = String( allowed ).trim();
		return !!prefix && ( command === prefix || command.startsWith( prefix + ' ' ) );
	} );
}


//---------------------------------------------------------------------
// The claude stream

function parse_line( line )
{
	let text = String( line || '' ).trim();
	if ( !text )
	{
		return null;
	}
	try
	{
		return JSON.parse( text );
	}
	catch ( error )
	{
		return null;
	}
}


// One stream-json event: a tool call is noted, a tool result set on its call; the result event is returned.
function on_stream_event( event, pending, tools )
{
	let content = ( event.message && Array.isArray( event.message.content ) ) ? event.message.content : [];
	if ( event.type === 'assistant' )
	{
		for ( let part of content )
		{
			// StructuredOutput is how claude gives the answer under --json-schema, not a tool it uses.
			if ( part.type === 'tool_use' && part.name !== 'StructuredOutput' )
			{
				pending[ part.id ] = tools.Note( String( part.name ).replace( /^mcp__consensus__/, '' ), part.input || {} );
			}
		}
	}
	if ( event.type === 'user' )
	{
		for ( let part of content )
		{
			if ( part.type === 'tool_result' && pending[ part.tool_use_id ] )
			{
				pending[ part.tool_use_id ].Result = tools.Shown( result_text( part.content ) );
				tools.Changed();
			}
		}
	}
	return ( event.type === 'result' ) ? event : null;
}


function result_text( content )
{
	if ( typeof content === 'string' )
	{
		return content;
	}
	if ( Array.isArray( content ) )
	{
		return content.map( function ( part ) { return part.text || ''; } ).join( '\n' );
	}
	return '';
}


// The result event as { Answer, Usage }.
function claude_answer( result, context )
{
	if ( result.is_error )
	{
		throw new Error( 'claude: ' + String( result.result || result.subtype || 'an error' ).slice( 0, 300 ) );
	}
	let usage = result.usage || {};
	let input = ( usage.input_tokens || 0 ) + ( usage.cache_creation_input_tokens || 0 ) + ( usage.cache_read_input_tokens || 0 );
	let models = Object.keys( result.modelUsage || {} );
	let answer = ( result.structured_output !== undefined && result.structured_output !== null ) ? result.structured_output : result.result;
	return { Answer: answer, Usage: { Model: models[ 0 ] || context.Model || 'claude', Input: input, Output: usage.output_tokens || 0 } };
}


function add_usage( usage, reply )
{
	usage.Input += reply.prompt_eval_count || 0;
	usage.Output += reply.eval_count || 0;
}


// A tool call in a few words: Read src/Api.js lines 1 to 200; Grep "caller_for"; read_plan "Tabs".
function describe_call( name, input, root )
{
	function relative( path )
	{
		let text = String( path || '' );
		if ( PATH.isAbsolute( text ) )
		{
			let inside = PATH.relative( root, text );
			if ( !inside.startsWith( '..' ) )
			{
				return inside.split( PATH.sep ).join( '/' );
			}
		}
		return text;
	}
	let tool = String( name );
	if ( tool === 'Read' || tool === 'read' )
	{
		let path = relative( input.file_path || input.Path );
		let offset = input.offset || input.Offset;
		let limit = input.limit || input.Limit;
		return 'Read ' + path + ( offset || limit ? ' lines ' + ( offset || 1 ) + ( limit ? ' to ' + ( ( offset || 1 ) + limit - 1 ) : ' on' ) : '' );
	}
	if ( tool === 'Grep' || tool === 'grep' )
	{
		let glob = input.glob || input.Glob;
		let where = input.path ? ' in ' + relative( input.path ) : '';
		return 'Grep "' + ( input.pattern || input.Pattern || '' ) + '"' + ( glob ? ' in ' + glob : where );
	}
	if ( tool === 'Glob' || tool === 'glob' )
	{
		return 'Glob ' + ( input.pattern || input.Pattern || '' );
	}
	if ( tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit' )
	{
		return tool + ' ' + relative( input.file_path );
	}
	if ( tool === 'Bash' )
	{
		return 'Bash ' + String( input.command || '' ).slice( 0, 120 );
	}
	if ( tool === 'read_plan' )
	{
		return 'read_plan "' + ( input.Plan || '' ) + '"';
	}
	if ( tool === 'read_revision' )
	{
		return 'read_revision "' + ( input.Plan || '' ) + '" ' + ( input.Revision || '' );
	}
	if ( tool === 'search' )
	{
		return 'search "' + ( input.Query || '' ) + '"';
	}
	return tool;
}


// A tool's result, shortened for the page.
function shown( text )
{
	let value = String( text === undefined || text === null ? '' : text );
	return ( value.length > RESULT_SHOWN ) ? value.slice( 0, RESULT_SHOWN ) + '…' : value;
}


module.exports = {
	DEFAULT_WEB_PORT: DEFAULT_WEB_PORT,
	DefaultSettings: DefaultSettings,
	Validate: Validate,
	BashAllowed: BashAllowed,
	Start: Start,
};
