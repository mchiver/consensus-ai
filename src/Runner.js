'use strict';

// Runner - a one-shot from a request (plan Run Shapes, Step 3): what the desktop's main process did over the
// connected server's API, done in the server over its own store: the lists the packaging popup checks, the package
// (Package.js) from the task's switches (plan LLM Tasks, Step 1: the task the button names, Tasks.js, says what the
// one-shot is given, what it may write and what it is asked), and the start of a run (Runs.js) in the project's
// folder, posting as the presser through the connection (plan User Management, Step 2: the run token the server
// mints, Tokens, names the connection as the Service and carries the task's Writes, so the run's posts read
// "<connection> by <owner>" and a none run is refused every write). A run reaches this server at its own address
// (Url), so a run is always on this machine.
//
//   Runner( { Store, Settings, Runs, Url, Tokens } ) -> { Lists( Request ), Package( Request, Token? ), Start( Request, By ) }
//   Url(): this server's address, what a run's tools and prompt reach it at; null when it does not listen.
//   Lists( { Project, Plan?, Llm? } ) -> { Documents, Threads, Speaker } | { Error }
//   Package( { Llm, Task, Project, Plan?, Overrides? }, Token? ) -> { Prompt, Llm, Task, Writes, Project, Plan, Folder, Speaker } | { Error }
//     Task: the task's id; Token: the run's token value; none for a preview, whose prompt says a token is made at the start.
//   Start( Request, By ) -> { Run } | { Error, Status }

const FS = require( 'fs' );
const PACKAGE = require( './Package.js' );
const LLMS = require( './Llms.js' );
const TASKS = require( './Tasks.js' );
const TOOLS = require( './Tools.js' );
const RULES = require( './Rules.js' );
const PARTICIPANTS = require( './Participants.js' );
const INSTRUCTIONS = require( './Instructions.js' );


function Runner( Options )
{
	let store = Options.Store;
	let settings = Options.Settings;
	let runs = Options.Runs;
	let tokens = Options.Tokens || null;
	let url_of = Options.Url || function () { return null; };


	function documents_of( project )
	{
		let documents = [];
		let context_folder = ( project.Items || [] ).find( function ( node ) { return node.Id === project.ContextFolder; } );
		for ( let node of ( context_folder ? context_folder.Items : [] ) || [] )
		{
			if ( node.Kind === 'document' && node.Id !== project.Context )
			{
				documents.push( { Id: node.Id, Title: node.Title } );
			}
		}
		return documents;
	}


	// The first words of a thread's last reply, for the packaging popup's list.
	function last_words( thread )
	{
		let replies = thread.Replies || [];
		let last = replies.length ? replies[ replies.length - 1 ] : null;
		if ( !last )
		{
			return '';
		}
		let words = String( last.Text || '' ).replace( /\s+/g, ' ' ).trim();
		return last.By + ': ' + ( ( words.length > 90 ) ? words.slice( 0, 90 ) + '…' : words );
	}


	// The threads of a plan waiting on the speaker (a connection's key), or on any speaker but the owner when none is named.
	function waiting_threads( read, participant )
	{
		let all = PARTICIPANTS.SeenSpeakers( settings, read.Threads || [] );
		let llm_names = all.filter( function ( one ) { return one.Role !== 'owner'; } ).map( function ( one ) { return one.Name; } );
		return ( read.Threads || [] ).filter( function ( thread )
		{
			let turn = RULES.Turn( thread, all );
			if ( participant )
			{
				return turn.includes( participant );
			}
			return turn.some( function ( name ) { return llm_names.includes( name ); } );
		} );
	}


	async function project_of( id )
	{
		if ( !id )
		{
			return null;
		}
		return await store.ReadProject( id );
	}


	// The project's folder as a run works in it, or null when the folder is not on this machine.
	function folder_of( project )
	{
		if ( !project.Path || !FS.existsSync( project.Path ) )
		{
			return null;
		}
		return { Path: project.Path, Include: project.Include || [], Exclude: project.Exclude || [], Commands: project.Commands || [] };
	}


	// A task needs the project's folder when it writes files or packages them.
	function needs_folder( task )
	{
		return task.Writes === 'files' || task.Package.Files;
	}


	//-----------------------------------------------------------------
	// Lists: the other Context documents of the project, and the threads of the plan waiting on the connection.

	async function Lists( Request )
	{
		let request = Request || {};
		let project = await project_of( request.Project );
		if ( !project )
		{
			return { Error: 'no project with the id ' + request.Project };
		}
		let llm = request.Llm ? LLMS.ById( settings, request.Llm ) : null;
		let participant = llm ? LLMS.SpeakerName( llm, settings ) : null;
		let threads = [];
		if ( request.Plan )
		{
			let read = await store.ReadPlan( request.Plan );
			if ( !read )
			{
				return { Error: 'no plan with the id ' + request.Plan };
			}
			for ( let thread of waiting_threads( read, participant ) )
			{
				threads.push( { Id: thread.Id, Status: thread.Status, Anchor: thread.Anchor ? thread.Anchor.Text : null, Last: last_words( thread ) } );
			}
		}
		return { Documents: documents_of( project ), Threads: threads, Speaker: llm ? LLMS.SpeakerDisplay( llm, settings ) : null };
	}


	//-----------------------------------------------------------------
	// Package: the prompt of a run, from the task's switches; Overrides are the popup's unsaved fields of the
	// connection (its Session Prompt and its unchecked ids).

	async function Package( Request, Token )
	{
		let request = Request || {};
		let llm = LLMS.ById( settings, request.Llm );
		if ( !llm )
		{
			return { Error: 'no LLM connection with the id ' + request.Llm };
		}
		if ( request.Overrides && typeof request.Overrides === 'object' )
		{
			llm = LLMS.Fill( Object.assign( {}, llm, request.Overrides, { Id: llm.Id, Name: llm.Name } ) );
		}
		let task = TASKS.ById( settings, request.Task );
		if ( !task )
		{
			return { Error: request.Task ? 'no task with the id ' + request.Task : 'a Task is needed: one of ' + ( settings.Tasks || [] ).map( function ( one ) { return one.Id; } ).join( ', ' ) };
		}
		let url = url_of();
		if ( !url )
		{
			return { Error: 'this server does not listen (Scope None): a run could not reach it' };
		}
		let project = await project_of( request.Project );
		if ( !project )
		{
			return { Error: 'no project with the id ' + request.Project };
		}
		if ( !TASKS.IsEnabled( settings, project, task.Id ) )
		{
			return { Error: 'the task "' + task.Name + '" is not enabled in the project "' + project.Name + '"' };
		}
		let folder = needs_folder( task ) ? folder_of( project ) : null;
		if ( needs_folder( task ) && !folder )
		{
			return { Error: 'a ' + task.Name + ' needs the project\'s folder on this machine' + ( project.Path ? ': ' + project.Path + ' is missing' : '' ) };
		}
		let participant = LLMS.SpeakerName( llm, settings );
		let is_ollama = ( llm.Kind === 'ollama' );
		let readme = null;
		if ( task.Package.Readme && project.Context )
		{
			let read = await store.ReadPlan( project.Context );
			if ( read )
			{
				readme = { Id: project.Context, Title: read.Plan.Title, Text: read.Text };
			}
		}
		let instructions = null;
		if ( task.Package.Instructions )
		{
			if ( is_ollama )
			{
				instructions = TOOLS.Tools( { Writes: task.Writes, Folder: folder, Server: { Url: url, Token: Token || null, Project: project.Id } } ).Instructions();
			}
			else
			{
				instructions = INSTRUCTIONS.Make( settings, url, await INSTRUCTIONS.Guide(), { Service: llm.Name, Token: Token || null, Writes: task.Writes } );
			}
		}
		let plan = null;
		let threads = [];
		if ( request.Plan )
		{
			let read = await store.ReadPlan( request.Plan );
			if ( !read || read.Plan.Kind !== 'plan' )
			{
				return { Error: 'no plan with the id ' + request.Plan };
			}
			plan = { Id: read.Plan.Id, Title: read.Plan.Title, State: read.Plan.State };
			if ( task.Package.Threads )
			{
				threads = waiting_threads( read, participant ).filter( function ( thread ) { return !llm.Unchecked.Threads.includes( thread.Id ); } );
			}
		}
		else if ( task.Package.Plan || task.Package.Threads )
		{
			return { Error: 'a ' + task.Name + ' needs a plan: select one in the tree' };
		}
		let prompt = PACKAGE.Build( {
			Task: task,
			Llm: llm,
			Server: { Url: url, Name: settings.Name },
			Project: { Id: project.Id, Name: project.Name },
			Plan: plan,
			Folder: folder ? folder.Path : null,
			Owner: PARTICIPANTS.Owner( settings ),
			Service: llm.Name,
			Token: is_ollama ? null : Token,
			Instructions: instructions,
			InstructionsTitle: is_ollama ? 'Tool instructions' : 'Agent instructions',
			DocumentsHint: is_ollama ? 'Read one with the read_document tool.' : undefined,
			Readme: readme,
			Documents: documents_of( project ).filter( function ( document ) { return !llm.Unchecked.Documents.includes( document.Id ); } ),
			Threads: threads,
		} );
		return {
			Prompt: prompt,
			Llm: llm,
			Task: { Id: task.Id, Name: task.Name },
			Writes: task.Writes,
			Project: { Id: project.Id, Name: project.Name, Path: project.Path || null },
			Plan: plan,
			Folder: folder,
			Speaker: LLMS.SpeakerDisplay( llm, settings ),
		};
	}


	//-----------------------------------------------------------------
	// Start: the run's token minted (named after the task, carrying its Writes), the package made with it, the run
	// begun, By the presser's account name; the token is dropped if the run cannot start, and by Runs when it ends.

	async function Start( Request, By )
	{
		let request = Request || {};
		let llm = LLMS.ById( settings, request.Llm );
		let task = TASKS.ById( settings, request.Task );
		let token = null;
		if ( llm && task && tokens )
		{
			let name = task.Name + ' run';
			token = { Value: tokens.Mint( { Service: llm.Name, Name: name, Project: request.Project || null, Writes: task.Writes } ), Name: name };
		}
		let made = await Package( request, token ? token.Value : null );
		if ( made.Error )
		{
			drop( token );
			return { Error: made.Error, Status: 400 };
		}
		let server = null;
		if ( made.Llm.Kind === 'ollama' )
		{
			server = { Url: url_of(), Token: token ? token.Value : null, Project: made.Project.Id };
		}
		try
		{
			let run = runs.Start( { Llm: made.Llm, Task: made.Task, Writes: made.Writes, By: By || null, Token: token, Project: made.Project, Plan: made.Plan, Folder: made.Folder, Prompt: made.Prompt, Server: server } );
			return { Run: run };
		}
		catch ( error )
		{
			drop( token );
			return { Error: error.message, Status: /already running/.test( error.message ) ? 409 : 400 };
		}
	}


	function drop( token )
	{
		if ( token && tokens )
		{
			tokens.Drop( token.Value );
		}
	}


	return {
		Lists: Lists,
		Package: Package,
		Start: Start,
	};
}


module.exports = {
	Runner: Runner,
};
