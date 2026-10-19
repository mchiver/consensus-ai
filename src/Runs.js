'use strict';

// Runs - the one-shots an LLM connection runs (plan Consensus Desktop, Step 3; in the server since plan Run Shapes,
// Step 3): one record per run, a file in the config folder's runs/<id>.json: when, which button, who asked, the plan,
// the project and its folder, the packaged prompt, the output, the exit status and the duration. One run at a time
// per connection; a run is stopped with Stop, and killed when it takes longer than the connection's Timeout. The
// command runs without a shell, in the project's folder, with the prompt on its standard input; its output (stdout,
// then stderr) is kept. An ollama connection runs through Ollama.js instead of a child process: the tool loop in
// this process, with the tools of Tools.js over the project's folder and this server; the Transcript (Ollama.js's
// entries) is kept whole and the Output is its markdown, both growing with every call, and every listener hears
// each call; Rounds and Usage are kept; Stop aborts the request in flight.
//
//   Runs( { Folder, Spawn?, Tokens? } ) -> { Start( Request ), Stop( Id ), List( LlmId? ), Read( Id ), Running( LlmId ), OnChange( Handler ), Close() }
//   Tokens: the server's RunTokens (Participants.js); a run's token (Request.Token, minted by the Runner) is dropped when it ends.
//   Request = { Llm, Task: { Id, Name }, Writes, Text, By, Token: { Value, Name } | null, Project: { Id, Name, Path }, Plan: { Id, Title } | null,
//               Folder: { Path, Include, Exclude, Commands } | null (the project's folder, the run's working folder),
//               Prompt, Server?: { Url, Token, Project } (an ollama run's Consensus tools) }
//   record  = { Id, Llm: { Id, Name }, Task, Writes, Text, By, Service, Token, Project, Plan, Started, Ended, Duration, Status, Exit, Error, Prompt, Output, Rounds, Usage, Transcript }
//             By the presser's account, Service the connection's name, Token the run token's name: the three fields of the plan.
//             Task the button's task (plan LLM Tasks, Step 1; a record from before has Kind instead), Writes its level,
//             Text the person's instructions from the task's box (Step 2), null without.
//   Status  = 'running' | 'done' | 'failed' | 'stopped'

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
	// Start: the run begins; its record is returned at once, with Status running, and the command runs on.

	function Start( Request )
	{
		let llm = Request.Llm;
		if ( !llm || !llm.Id )
		{
			throw new Error( 'an LLM connection is needed' );
		}
		if ( running[ llm.Id ] )
		{
			throw new Error( 'the connection "' + llm.Name + '" is already running "' + running[ llm.Id ].Record.Id + '"; stop it or wait for it' );
		}
		if ( Request.Folder && !FS.existsSync( Request.Folder.Path ) )
		{
			throw new Error( 'the project\'s folder does not exist: ' + Request.Folder.Path );
		}
		let is_ollama = ( llm.Kind === 'ollama' );
		let line = is_ollama ? { Command: 'ollama', Arguments: [ llm.Model, 'at', llm.Url ] } : LLM.CommandLine( llm );
		let record = {
			Id: IDS.New( IDS.RUN ),
			Llm: { Id: llm.Id, Name: llm.Name },
			Task: Request.Task ? { Id: Request.Task.Id, Name: Request.Task.Name } : null,
			Writes: Request.Writes || null,
			Text: Request.Text || null,
			By: Request.By || null,
			Service: llm.Name,
			Token: Request.Token ? Request.Token.Name : null,
			Project: Request.Project ? { Id: Request.Project.Id, Name: Request.Project.Name, Path: Request.Project.Path || null } : null,
			Plan: Request.Plan ? { Id: Request.Plan.Id, Title: Request.Plan.Title } : null,
			Command: [ line.Command ].concat( line.Arguments ).join( ' ' ),
			Started: new Date().toISOString(),
			Ended: null,
			Duration: null,
			Status: 'running',
			Exit: null,
			Error: null,
			Prompt: Request.Prompt || '',
			Output: '',
			Rounds: null,
			Usage: null,
			Transcript: is_ollama ? [] : null,
		};
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
	// Stop( Id ): the run is killed (a command) or aborted (a local model); its record says stopped.

	function Stop( Id )
	{
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
	// List( LlmId? ): the summaries, newest first; of one connection when LlmId is given.

	function List( LlmId )
	{
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
			if ( !record || ( LlmId && ( !record.Llm || record.Llm.Id !== LlmId ) ) )
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
		summaries.sort( function ( a, b ) { return ( a.Started < b.Started ) ? 1 : ( ( a.Started > b.Started ) ? -1 : 0 ); } );
		return summaries;
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
		for ( let llm_id of Object.keys( running ) )
		{
			if ( running[ llm_id ].Record.Id === Id )
			{
				return Object.assign( {}, running[ llm_id ].Record );
			}
		}
		return read_file( path_of( Id ) );
	}


	// OnChange( Handler ): Handler( summary ) when a run starts or ends.
	function OnChange( Handler )
	{
		handlers.push( Handler );
	}


	// Close: every running one is stopped.
	async function Close()
	{
		for ( let llm_id of Object.keys( running ) )
		{
			Stop( running[ llm_id ].Record.Id );
		}
	}


	return {
		Start: Start,
		Stop: Stop,
		Running: Running,
		List: List,
		Read: Read,
		OnChange: OnChange,
		Close: Close,
	};
}


module.exports = {
	Runs: Runs,
};
