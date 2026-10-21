'use strict';

// Runs - the one-shots an LLM connection runs (plan Consensus Desktop, Step 3; in the server since plan Run Shapes,
// Step 3): one record per run, a file in the config folder's runs/<id>.json: when, which button, who asked, the plan,
// the project and its folder, the packaged prompt, the output, the exit status and the duration. One run at a time
// per connection and per plan (plan Multiuser, Step 3): a run asked while its connection or its plan has one on is
// queued behind it, in press order, its record saying so (Status queued, Queued when, Behind which run), and starts
// when both are free, packaged again then through Request.Prepare since the plan may have changed; Stop takes a queued
// run out of the line. A running one is stopped with Stop, and killed when it takes longer than the connection's
// Timeout. The
// command runs without a shell, in the project's folder, with the prompt on its standard input; its output (stdout,
// then stderr) is kept. An ollama connection runs through Ollama.js instead of a child process: the tool loop in
// this process, with the tools of Tools.js over the project's folder and this server; the Transcript (Ollama.js's
// entries) is kept whole and the Output is its markdown, both growing with every call, and every listener hears
// each call; Rounds and Usage are kept; Stop aborts the request in flight.
//
//   Runs( { Folder, Spawn?, Tokens? } ) -> { Start( Request ), Stop( Id ), List( Filter? ), Read( Id ), Delete( Id ), Running( LlmId ),
//                                           IsBlocked( { Llm, Plan } ), OnChange( Handler ), Close() }
//   IsBlocked: the summary of the run a press on that connection or that plan would wait for, or null.
//   Filter: a connection's id, or { Llm?, Project?, Task?, By? } (plan LLM Tasks, Step 4: a person's Explain runs of a project);
//   Delete removes a record that is not running (its file), true when there was one; a running one throws.
//   Tokens: the server's RunTokens (Participants.js); a run's token (Request.Token, minted by the Runner) is dropped when it ends.
//   Request = { Llm, Task: { Id, Name }, Writes, Text, By, Token: { Value, Name } | null, Project: { Id, Name, Path }, Plan: { Id, Title } | null,
//               Folder: { Path, Include, Exclude, Commands } | null (the project's folder, the run's working folder),
//               Prompt, Server?: { Url, Token, Project } (an ollama run's Consensus tools), Git?: { Pull } (the pull before the run, Step 3),
//               Prepare?: async () -> { Prompt, Folder?, Git? } | { Error } (a queued run's package and pull, made when it starts) }
//   record  = { Id, Llm: { Id, Name }, Task, Writes, Text, Git, By, Service, Token, Project, Plan, Queued, Behind, Started, Ended, Duration, Status, Exit, Error, Prompt, Output, Rounds, Usage, Transcript }
//             Queued the time of a press that waited (null for one that ran at once), Behind { Id, Task, Plan } the run it waited for.
//             By the presser's account, Service the connection's name, Token the run token's name: the three fields of the plan.
//             Task the button's task (plan LLM Tasks, Step 1; a record from before has Kind instead), Writes its level,
//             Text the person's instructions from the task's box (Step 2), null without; Git the pull's words (Step 3), null without.
//   Status  = 'queued' | 'running' | 'done' | 'failed' | 'stopped'

const FS = require( 'fs' );
const PATH = require( 'path' );
const CHILD_PROCESS = require( 'child_process' );
const IDS = require( './Ids.js' );
const LLMS = require( './Llms.js' );
const LLM = require( './Llm.js' );
const OLLAMA = require( './Ollama.js' );
const TOOLS = require( './Tools.js' );

const OUTPUT_LIMIT = 2 * 1024 * 1024;
const PROGRESS_DELAY = 250;


function Runs( Options )
{
	let options = Options || {};
	let folder = options.Folder;
	let spawn = options.Spawn || CHILD_PROCESS.spawn;
	let tokens = options.Tokens || null;
	let running = {};		// Llm id -> { Record, Child, Timer }
	let queued = [];		// [ { Request, Record, Starting } ] waiting for their connection or plan, in press order
	let handlers = [];


	function path_of( id )
	{
		return PATH.join( folder, id + '.json' );
	}


	function write( record )
	{
		FS.mkdirSync( folder, { recursive: true } );
		let temporary = path_of( record.Id ) + '.' + process.pid + '.tmp';
		FS.writeFileSync( temporary, JSON.stringify( record, null, '\t' ) + '\n' );
		FS.renameSync( temporary, path_of( record.Id ) );
	}


	function changed( record )
	{
		for ( let handler of handlers )
		{
			try
			{
				handler( summary_of( record ) );
			}
			catch ( error )
			{
				// a handler's failure is its own
			}
		}
	}


	// The record without its prompt and output, for the list.
	function summary_of( record )
	{
		let summary = Object.assign( {}, record );
		delete summary.Prompt;
		delete summary.Output;
		delete summary.Transcript;
		summary.OutputLength = ( record.Output || '' ).length;
		return summary;
	}


	// The run's token leaves the server's memory with the run.
	function drop_token( request )
	{
		if ( tokens && request.Token && request.Token.Value )
		{
			tokens.Drop( request.Token.Value );
		}
	}


	//-----------------------------------------------------------------
	// Start: the run begins, or waits its turn (plan Multiuser, Step 3); its record is returned at once, with Status
	// running or queued, and the command runs on.

	function Start( Request )
	{
		let llm = Request.Llm;
		if ( !llm || !llm.Id )
		{
			throw new Error( 'an LLM connection is needed' );
		}
		if ( Request.Folder && !FS.existsSync( Request.Folder.Path ) )
		{
			throw new Error( 'the project\'s folder does not exist: ' + Request.Folder.Path );
		}
		let behind = IsBlocked( { Llm: llm.Id, Plan: Request.Plan ? Request.Plan.Id : null } );
		let record = make_record( llm, Request, behind );
		if ( behind )
		{
			queued.push( { Request: Request, Record: record, Starting: false } );
			write( record );
			changed( record );
			return summary_of( record );
		}
		return launch( llm, Request, record );
	}


	// The record of a press, running at once or queued behind another run.
	function make_record( llm, Request, behind )
	{
		let is_ollama = ( llm.Kind === 'ollama' );
		let line = is_ollama ? { Command: 'ollama', Arguments: [ llm.Model, 'at', llm.Url ] } : LLM.CommandLine( llm );
		let now = new Date().toISOString();
		return {
			Id: IDS.New( IDS.RUN ),
			Llm: { Id: llm.Id, Name: llm.Name },
			Task: Request.Task ? { Id: Request.Task.Id, Name: Request.Task.Name } : null,
			Writes: Request.Writes || null,
			Text: Request.Text || null,
			Git: Request.Git || null,
			By: Request.By || null,
			Service: llm.Name,
			Token: Request.Token ? Request.Token.Name : null,
			Project: Request.Project ? { Id: Request.Project.Id, Name: Request.Project.Name, Path: Request.Project.Path || null } : null,
			Plan: Request.Plan ? { Id: Request.Plan.Id, Title: Request.Plan.Title } : null,
			Command: [ line.Command ].concat( line.Arguments ).join( ' ' ),
			Queued: behind ? now : null,
			Behind: behind ? { Id: behind.Id, Task: behind.Task, Plan: behind.Plan } : null,
			Started: behind ? null : now,
			Ended: null,
			Duration: null,
			Status: behind ? 'queued' : 'running',
			Exit: null,
			Error: null,
			Prompt: Request.Prompt || '',
			Output: '',
			Rounds: null,
			Usage: null,
			Transcript: is_ollama ? [] : null,
		};
	}


	// The run itself: the command spawned, or the local model's loop; the record says running from here.
	function launch( llm, Request, record )
	{
		let is_ollama = ( llm.Kind === 'ollama' );
		let line = is_ollama ? { Command: 'ollama', Arguments: [ llm.Model, 'at', llm.Url ] } : LLM.CommandLine( llm );
		record.Started = record.Started || new Date().toISOString();
		record.Status = 'running';
		if ( is_ollama )
		{
			return start_ollama( llm, Request, record );
		}
		let child = null;
		try
		{
			child = spawn( line.Command, line.Arguments, { cwd: Request.Folder ? Request.Folder.Path : undefined, windowsHide: true, stdio: [ 'pipe', 'pipe', 'pipe' ] } );
		}
		catch ( error )
		{
			throw new Error( 'could not start ' + line.Command + ': ' + error.message );
		}
		let state = { Record: record, Child: child, Timer: null, Stderr: '', Stopped: false };
		running[ llm.Id ] = state;
		write( record );
		changed( record );

		function take( chunk, which )
		{
			if ( which === 'stderr' )
			{
				state.Stderr += chunk;
				return;
			}
			if ( record.Output.length < OUTPUT_LIMIT )
			{
				record.Output += chunk;
			}
		}

		function end( status, exit, error )
		{
			if ( record.Status !== 'running' )
			{
				return;
			}
			clearTimeout( state.Timer );
			delete running[ llm.Id ];
			drop_token( Request );
			if ( state.Stderr.trim() )
			{
				record.Output += ( record.Output ? '\n' : '' ) + '--- stderr ---\n' + state.Stderr;
			}
			record.Ended = new Date().toISOString();
			record.Duration = Math.round( ( new Date( record.Ended ) - new Date( record.Started ) ) / 1000 );
			record.Status = status;
			record.Exit = ( exit === undefined ) ? null : exit;
			record.Error = error || null;
			write( record );
			changed( record );
			drain();
		}

		state.Timer = setTimeout( function ()
		{
			state.Stopped = true;
			child.kill();
			end( 'failed', null, line.Command + ' took longer than ' + llm.Timeout + ' seconds' );
		}, ( llm.Timeout || LLMS.DEFAULT_TIMEOUT ) * 1000 );
		child.stdout.on( 'data', function ( chunk ) { take( String( chunk ), 'stdout' ); } );
		child.stderr.on( 'data', function ( chunk ) { take( String( chunk ), 'stderr' ); } );
		child.on( 'error', function ( error )
		{
			end( 'failed', null, 'could not run ' + line.Command + ': ' + error.message );
		} );
		child.on( 'close', function ( code, signal )
		{
			if ( state.Stopped )
			{
				end( 'stopped', code, 'stopped' );
				return;
			}
			if ( code === 0 )
			{
				end( 'done', 0, null );
				return;
			}
			end( 'failed', code, line.Command + ' exited ' + ( code === null ? 'on signal ' + signal : code ) );
		} );
		child.stdin.on( 'error', function () {} );
		child.stdin.end( record.Prompt, 'utf8' );
		return summary_of( record );
	}


	//-----------------------------------------------------------------
	// An ollama run: the loop of Ollama.js with the tools of Tools.js; the transcript is the Output as it grows.

	function start_ollama( llm, Request, record )
	{
		let abort = new AbortController();
		let state = { Record: record, Child: null, Abort: abort, Timer: null, Stopped: false, Timed: false, Progress: null };
		let tools = TOOLS.Tools( { Writes: Request.Writes, Folder: Request.Folder || null, Server: Request.Server || null } );
		running[ llm.Id ] = state;
		write( record );
		changed( record );

		function end( status, error )
		{
			if ( record.Status !== 'running' )
			{
				return;
			}
			clearTimeout( state.Timer );
			clearTimeout( state.Progress );
			delete running[ llm.Id ];
			drop_token( Request );
			record.Ended = new Date().toISOString();
			record.Duration = Math.round( ( new Date( record.Ended ) - new Date( record.Started ) ) / 1000 );
			record.Status = status;
			record.Exit = ( status === 'done' ) ? 0 : null;
			record.Error = error || null;
			write( record );
			changed( record );
			drain();
		}

		// An entry of the transcript: kept, rendered, written, and told to every window (a few times a second at most).
		function progress( entry )
		{
			if ( record.Output.length >= OUTPUT_LIMIT )
			{
				return;
			}
			record.Transcript.push( entry );
			record.Output = OLLAMA.Render( record.Transcript );
			write( record );
			if ( !state.Progress )
			{
				state.Progress = setTimeout( function ()
				{
					state.Progress = null;
					if ( record.Status === 'running' )
					{
						changed( record );
					}
				}, PROGRESS_DELAY );
			}
		}

		state.Timer = setTimeout( function ()
		{
			state.Timed = true;
			abort.abort();
		}, ( llm.Timeout || LLMS.DEFAULT_TIMEOUT ) * 1000 );

		OLLAMA.Run( { Llm: llm, Prompt: record.Prompt, Tools: tools, Signal: abort.signal, OnProgress: progress } ).then( function ( result )
		{
			record.Rounds = result.Rounds;
			record.Usage = result.Usage;
			end( 'done', null );
		} ).catch( function ( error )
		{
			if ( state.Timed )
			{
				end( 'failed', 'Ollama took longer than ' + ( llm.Timeout || LLMS.DEFAULT_TIMEOUT ) + ' seconds' );
				return;
			}
			if ( state.Stopped )
			{
				end( 'stopped', 'stopped' );
				return;
			}
			end( 'failed', error.message );
		} );
		return summary_of( record );
	}


	//-----------------------------------------------------------------
	// The queue (plan Multiuser, Step 3): one run per connection and per plan at a time; the others wait in press order.

	// IsBlocked( { Llm, Plan } ): the run a press would wait for, running or queued ahead; null when it may start now.
	function IsBlocked( Fields )
	{
		return blocked_by( Fields.Llm || null, Fields.Plan || null, queued.length );
	}


	// What holds a run on that connection or that plan: a running one, or one of the first `before` queued entries.
	function blocked_by( llm_id, plan_id, before )
	{
		if ( llm_id && running[ llm_id ] )
		{
			return summary_of( running[ llm_id ].Record );
		}
		for ( let id of Object.keys( running ) )
		{
			let record = running[ id ].Record;
			if ( plan_id && record.Plan && record.Plan.Id === plan_id )
			{
				return summary_of( record );
			}
		}
		for ( let index = 0; index < before && index < queued.length; index++ )
		{
			let record = queued[ index ].Record;
			if ( ( llm_id && record.Llm.Id === llm_id ) || ( plan_id && record.Plan && record.Plan.Id === plan_id ) )
			{
				return summary_of( record );
			}
		}
		return null;
	}


	// A run ended: every queued run whose connection and plan are free, with none ahead of it on either, starts.
	function drain()
	{
		for ( let index = 0; index < queued.length; index++ )
		{
			let entry = queued[ index ];
			if ( entry.Starting )
			{
				continue;
			}
			let plan_id = entry.Record.Plan ? entry.Record.Plan.Id : null;
			if ( blocked_by( entry.Record.Llm.Id, plan_id, index ) )
			{
				continue;
			}
			entry.Starting = true;
			start_queued( entry );
		}
	}


	// A queued run's turn: packaged again through Prepare when the request has one, then launched; a failure before the
	// start, or a Stop meanwhile, ends it without running.
	async function start_queued( entry )
	{
		let request = entry.Request;
		let record = entry.Record;
		if ( request.Prepare )
		{
			let prepared = null;
			try
			{
				prepared = await request.Prepare();
			}
			catch ( error )
			{
				prepared = { Error: error.message };
			}
			if ( record.Status !== 'queued' )
			{
				return;
			}
			if ( prepared && prepared.Error )
			{
				unqueue( entry );
				never_started( record, request, 'failed', prepared.Error );
				return;
			}
			Object.assign( request, prepared || {} );
			record.Prompt = request.Prompt || record.Prompt;
			record.Git = request.Git || null;
		}
		unqueue( entry );
		try
		{
			launch( request.Llm, request, record );
		}
		catch ( error )
		{
			never_started( record, request, 'failed', error.message );
		}
	}


	function unqueue( entry )
	{
		let index = queued.indexOf( entry );
		if ( index >= 0 )
		{
			queued.splice( index, 1 );
		}
	}


	// A queued run that ends without having run: stopped, or failed to start.
	function never_started( record, request, status, error )
	{
		drop_token( request );
		record.Ended = new Date().toISOString();
		record.Duration = 0;
		record.Status = status;
		record.Error = error || null;
		write( record );
		changed( record );
		drain();
	}


	// At start, a run left queued by a server that stopped is closed: nothing holds its request any more.
	function sweep_queued()
	{
		if ( !FS.existsSync( folder ) )
		{
			return;
		}
		for ( let name of FS.readdirSync( folder ) )
		{
			let record = name.endsWith( '.json' ) ? read_file( PATH.join( folder, name ) ) : null;
			if ( record && record.Status === 'queued' )
			{
				record.Ended = new Date().toISOString();
				record.Duration = 0;
				record.Status = 'stopped';
				record.Error = 'the server stopped before the run started';
				write( record );
			}
		}
	}


	//-----------------------------------------------------------------
	// Stop( Id ): the run is killed (a command) or aborted (a local model), or taken out of the queue; its record says
	// stopped.

	function Stop( Id )
	{
		let waiting = queued.find( function ( entry ) { return entry.Record.Id === Id; } );
		if ( waiting )
		{
			unqueue( waiting );
			never_started( waiting.Record, waiting.Request, 'stopped', 'stopped before it started' );
			return true;
		}
		for ( let llm_id of Object.keys( running ) )
		{
			let state = running[ llm_id ];
			if ( state.Record.Id === Id )
			{
				state.Stopped = true;
				if ( state.Child )
				{
					state.Child.kill();
				}
				else
				{
					state.Abort.abort();
				}
				return true;
			}
		}
		return false;
	}


	// Running( LlmId ): the running record's summary of that connection, or null.
	function Running( LlmId )
	{
		return running[ LlmId ] ? summary_of( running[ LlmId ].Record ) : null;
	}


	//-----------------------------------------------------------------
	// List( Filter? ): the summaries, newest first; of one connection, project, task or asker when the filter says.

	function List( Filter )
	{
		let filter = ( typeof Filter === 'string' ) ? { Llm: Filter } : ( Filter || {} );
		let summaries = [];
		if ( !FS.existsSync( folder ) )
		{
			return summaries;
		}
		for ( let name of FS.readdirSync( folder ) )
		{
			if ( !name.endsWith( '.json' ) )
			{
				continue;
			}
			let record = read_file( PATH.join( folder, name ) );
			if ( !record || !matches( record, filter ) )
			{
				continue;
			}
			let live = record.Llm && running[ record.Llm.Id ];
			if ( live && live.Record.Id === record.Id )
			{
				record = live.Record;
			}
			summaries.push( summary_of( record ) );
		}
		summaries.sort( function ( a, b ) { return ( when( a ) < when( b ) ) ? 1 : ( ( when( a ) > when( b ) ) ? -1 : 0 ); } );
		return summaries;
	}


	// When a run was pressed: the queue time of one that waited, else its start.
	function when( record )
	{
		return record.Queued || record.Started || '';
	}


	function matches( record, filter )
	{
		if ( filter.Llm && ( !record.Llm || record.Llm.Id !== filter.Llm ) )
		{
			return false;
		}
		if ( filter.Project && ( !record.Project || record.Project.Id !== filter.Project ) )
		{
			return false;
		}
		if ( filter.Task && ( !record.Task || record.Task.Id !== filter.Task ) )
		{
			return false;
		}
		if ( filter.By && record.By !== filter.By )
		{
			return false;
		}
		return true;
	}


	function read_file( path )
	{
		try
		{
			return JSON.parse( FS.readFileSync( path, 'utf8' ) );
		}
		catch ( error )
		{
			return null;
		}
	}


	// Read( Id ): the whole record, the output as it stands for a running one; null when there is none.
	function Read( Id )
	{
		for ( let entry of queued )
		{
			if ( entry.Record.Id === Id )
			{
				return Object.assign( {}, entry.Record );
			}
		}
		for ( let llm_id of Object.keys( running ) )
		{
			if ( running[ llm_id ].Record.Id === Id )
			{
				return Object.assign( {}, running[ llm_id ].Record );
			}
		}
		return read_file( path_of( Id ) );
	}


	// Delete( Id ): the record's file removed; a running or queued one is refused.
	function Delete( Id )
	{
		if ( queued.some( function ( entry ) { return entry.Record.Id === Id; } ) )
		{
			throw new Error( 'the run ' + Id + ' is still queued; stop it first' );
		}
		for ( let llm_id of Object.keys( running ) )
		{
			if ( running[ llm_id ].Record.Id === Id )
			{
				throw new Error( 'the run ' + Id + ' is still running; stop it first' );
			}
		}
		if ( !FS.existsSync( path_of( Id ) ) )
		{
			return false;
		}
		FS.unlinkSync( path_of( Id ) );
		return true;
	}


	// OnChange( Handler ): Handler( summary ) when a run starts or ends.
	function OnChange( Handler )
	{
		handlers.push( Handler );
	}


	// Close: every queued one is taken out of the line and every running one stopped.
	async function Close()
	{
		for ( let entry of queued.slice() )
		{
			Stop( entry.Record.Id );
		}
		for ( let llm_id of Object.keys( running ) )
		{
			Stop( running[ llm_id ].Record.Id );
		}
	}


	sweep_queued();

	return {
		Start: Start,
		Stop: Stop,
		Running: Running,
		IsBlocked: IsBlocked,
		List: List,
		Read: Read,
		Delete: Delete,
		OnChange: OnChange,
		Close: Close,
	};
}


module.exports = {
	Runs: Runs,
};
