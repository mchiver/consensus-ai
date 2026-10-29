'use strict';

// Runner - a one-shot from a request (plan Run Shapes, Step 3): what the desktop's main process did over the
// connected server's API, done in the server over its own store: the lists the packaging popup checks, the package
// (Package.js) from the task's switches (plan LLM Tasks, Step 1: the task the button names, Tasks.js, says what the
// one-shot is given, what it may write and what it is asked), and the start of a run (Runs.js) in the project's
// folder, posting as the presser through the connection (plan User Management, Step 2: the run's posts read
// "<connection> by <owner>" and a none run is refused every write). The Work options (plan LLM Tasks, Step 3): a run of
// a task with Writes files pulls first when the project's GitSync is on (Git.js), a failed pull refusing the run; the
// record keeps git's words.
//
// Plan Tool calls only: every run is the tool loop (Step 3: claude-cli is gone), minted no token. Its Consensus tools
// are performed inside the Server as the run's account (Participants.RunAccount: the presser through the connection,
// carrying the task's Writes and the presser's role), through what the API attaches (Attach), so nothing of the run's
// identity is a secret that could leave the Server. The run's record and its posts name the run ("Answer run") as
// their Token, which ties a build log to its run. A connection with no Model is refused a run.
//
//   Runner( { Store, Settings, Runs, Users?, Git? } ) -> { Lists( Request ), Package( Request, By? ), Start( Request, By ), Attach( Perform ), Performer( Account ) }
//   Attach( Perform ): Perform( Account, Name, Arguments ), the API's check and the operation (Api.js), which a run's tools call.
//   Lists( { Project, Plan?, Llm? } ) -> { Documents, Threads, Speaker } | { Error }
//   Package( { Llm, Task, Project, Plan?, Text?, Overrides? }, By? ) -> { Prompt, Llm, Task, Writes, Text, Project, Plan, Folder, Speaker } | { Error }
//     By (plan User Management, Step 3): the presser's account, named in the package in place of the owner;
//     Task: the task's id; Text: the person's instructions, read when the task has a Box (Step 2); a task with the
//     Project switch (Step 4) packages the project's shape, every plan and document with its state and tally, and the last runs.
//   Start( Request, By ) -> { Run } | { Error, Status }
//     By: the presser's account (Participants.js), or a name; the run acts as that account with its role (Step 3).

const FS = require( 'fs' );
const PACKAGE = require( './Package.js' );
const LLMS = require( './Llms.js' );
const TASKS = require( './Tasks.js' );
const TOOLS = require( './Tools.js' );
const RULES = require( './Rules.js' );
const PARTICIPANTS = require( './Participants.js' );
const TREE = require( './Tree.js' );

const SHAPE_RUNS = 20;		// the runs the Project switch packages (Step 4)


function Runner( Options )
{
	let store = Options.Store;
	let settings = Options.Settings;
	let runs = Options.Runs;
	let users = Options.Users || null;
	let git = Options.Git || null;
	let perform = null;


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


	// The project's shape for the Project switch (Step 4): every plan and document of the tree and the Archive but the
	// Readme, each with its state and the count of its threads by status, and the project's last runs.
	async function shape_of( project )
	{
		let items = [];
		let places = [ { Ids: TREE.ItemIds( project.Items || [] ), Archived: false }, { Ids: TREE.ItemIds( project.Archive || [] ), Archived: true } ];
		for ( let place of places )
		{
			for ( let id of place.Ids )
			{
				if ( id === project.Context )
				{
					continue;
				}
				let read = await store.ReadPlan( id );
				if ( !read )
				{
					continue;
				}
				let tally = { Contested: 0, Resolved: 0, Applied: 0 };
				for ( let thread of read.Threads || [] )
				{
					if ( thread.Status === 'contested' )
					{
						tally.Contested += 1;
					}
					else if ( RULES.IsWaiting( thread ) )
					{
						tally.Resolved += 1;
					}
					else
					{
						tally.Applied += 1;
					}
				}
				items.push( { Id: id, Title: read.Plan.Title, Kind: ( read.Plan.Kind === 'plan' ) ? 'plan' : 'document', State: read.Plan.State || null, Tally: tally, Archived: place.Archived } );
			}
		}
		let listed = runs ? runs.List( { Project: project.Id } ).slice( 0, SHAPE_RUNS ) : [];
		let records = listed.map( function ( run )
		{
			return { Task: run.Task ? run.Task.Name : ( run.Kind || '?' ), By: run.By || '?', Started: run.Started, Status: run.Status, Plan: run.Plan ? run.Plan.Title : null };
		} );
		return { Items: items, Runs: records };
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

	async function Package( Request, By )
	{
		let request = Request || {};
		let owner = PARTICIPANTS.Owner( settings );
		let presser = ( By && typeof By === 'object' && By.Name && By.Role !== 'owner' ) ? { Name: By.Name, Display: By.Display || By.Name, Role: By.ProjectRole || null } : { Name: owner.Name, Display: owner.Display, Role: 'owner' };
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
		if ( !LLMS.IsLoop( llm.Kind ) )
		{
			return { Error: 'the connection "' + llm.Name + '" is of a kind this Server does not run: ' + llm.Kind };
		}
		if ( !llm.Model )
		{
			return { Error: 'the connection "' + llm.Name + '" has no Model: pick one in its Details' };
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
			instructions = TOOLS.Tools( { Writes: task.Writes, Folder: folder, Server: { Project: project.Id } } ).Instructions();
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
		let text = ( task.Package.Box && typeof request.Text === 'string' ) ? request.Text.trim() : '';
		let shape = task.Package.Project ? await shape_of( project ) : null;
		let prompt = PACKAGE.Build( {
			Task: task,
			Text: text,
			Llm: llm,
			Server: { Name: settings.Name },
			Project: { Id: project.Id, Name: project.Name },
			Plan: plan,
			Folder: folder ? folder.Path : null,
			Owner: presser,
			Service: llm.Name,
			Instructions: instructions,
			Readme: readme,
			Documents: documents_of( project ).filter( function ( document ) { return !llm.Unchecked.Documents.includes( document.Id ); } ),
			Threads: threads,
			Shape: shape,
		} );
		return {
			Prompt: prompt,
			Llm: llm,
			Task: { Id: task.Id, Name: task.Name },
			Writes: task.Writes,
			Text: text,
			Project: { Id: project.Id, Name: project.Name, Path: project.Path || null },
			Plan: plan,
			Folder: folder,
			Speaker: LLMS.SpeakerDisplay( llm, settings ),
		};
	}


	//-----------------------------------------------------------------
	// Start: the run's account (named after the task, carrying its Writes), the package, the pull when the task writes
	// files and the project syncs (Step 3), the run begun, By the presser's account name.

	async function Start( Request, By )
	{
		let request = Request || {};
		let by = ( By && typeof By === 'object' ) ? By : { Name: By || null, Role: 'owner' };
		let llm = LLMS.ById( settings, request.Llm );
		let task = TASKS.ById( settings, request.Task );
		let name = task ? task.Name + ' run' : 'run';
		let run_account = null;
		if ( llm && task )
		{
			let account = by.Name ? { Id: by.Id || null, Name: by.Name, Display: by.Display || by.Name, Role: by.Role || 'owner', Type: by.Type || 'owner', Admin: ( by.Admin === undefined ) ? true : !!by.Admin, Manager: !!by.Manager } : null;
			run_account = PARTICIPANTS.RunAccount( settings, { Service: llm.Name, Name: name, Writes: task.Writes, Account: account, Role: by.ProjectRole || null }, users );
		}
		let made = await Package( request, by );
		if ( made.Error )
		{
			return { Error: made.Error, Status: 400 };
		}
		// A press that must wait for its connection or its plan (plan Multiuser, Step 3) is packaged and pulled again
		// when its turn comes, since the plan may have changed; the pull now is for a run that starts now.
		let waits = !!runs.IsBlocked( { Llm: made.Llm.Id, Plan: made.Plan ? made.Plan.Id : null } );
		let pulled = null;
		if ( !waits )
		{
			pulled = await pull_for( request, made );
			if ( pulled && pulled.Error )
			{
				return { Error: pulled.Error, Status: 400 };
			}
		}
		let server = { Perform: Performer( run_account ), Project: made.Project.Id };
		async function prepare()
		{
			let again = await Package( request, by );
			if ( again.Error )
			{
				return { Error: again.Error };
			}
			let pull = await pull_for( request, again );
			if ( pull && pull.Error )
			{
				return { Error: pull.Error };
			}
			return { Prompt: again.Prompt, Folder: again.Folder, Git: pull };
		}
		try
		{
			let run = runs.Start( { Llm: made.Llm, Task: made.Task, Writes: made.Writes, Text: made.Text, By: by.Name || null, Name: name, Project: made.Project, Plan: made.Plan, Folder: made.Folder, Prompt: made.Prompt, Server: server, Git: pulled, Prepare: prepare } );
			return { Run: run };
		}
		catch ( error )
		{
			return { Error: error.message, Status: /already running/.test( error.message ) ? 409 : 400 };
		}
	}


	// The pull before a files-writing run of a project that syncs (plan LLM Tasks, Step 3): { Pull } with git's words,
	// null when there is none to do, { Error } when it failed.
	async function pull_for( request, made )
	{
		if ( made.Writes !== 'files' || !made.Folder || !git )
		{
			return null;
		}
		let project = await project_of( request.Project );
		if ( !project || !project.GitSync )
		{
			return null;
		}
		let result = await git.Pull( made.Folder.Path );
		if ( !result.Ok )
		{
			return { Error: 'git pull failed in ' + made.Folder.Path + ': ' + last_lines( result.Output ) };
		}
		return { Pull: result.Output };
	}


	//-----------------------------------------------------------------
	// Attach: what performs a run's Consensus tools (the API's check and the operation); Performer: that, as one account.

	function Attach( Perform )
	{
		perform = ( typeof Perform === 'function' ) ? Perform : null;
	}


	function Performer( Account )
	{
		return async function ( Name, Arguments )
		{
			if ( !perform )
			{
				throw new Error( 'the run\'s tools are not attached to the API' );
			}
			return await perform( Account, Name, Arguments );
		};
	}


	// The last lines of git's words, for a refusal.
	function last_lines( text )
	{
		let lines = String( text || '' ).trim().split( /\r?\n/ );
		return lines.slice( -3 ).join( ' ' ) || 'no output';
	}


	return {
		Lists: Lists,
		Package: Package,
		Start: Start,
		Attach: Attach,
		Performer: Performer,
	};
}


module.exports = {
	Runner: Runner,
};
