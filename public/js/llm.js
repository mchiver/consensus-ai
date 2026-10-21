'use strict';

// Llm - the LLM connections and the runs of the server (plan Run Shapes, Step 3; the desktop's items before, plan
// Consensus Desktop, Step 3): the connections from /api/llms, each a participant of the server, listed once under
// the projects in the sidebar; the LLM page (a head with Details… and Packaging… popups for the owner, the Run
// with its project and plan pickers and one button per task the project enables (plan LLM Tasks, Step 1: the
// server's tasks from /api/tasks), and the log of runs, a run opened in a popup; plan UI Tweaks IV), over /api/runs. The same in a browser and in the desktop: the server runs the LLM,
// in the project's folder on its own machine.
//
//   Llms      { For( root ) -> { Loaded, Available, Llms, Tasks, Running, Kinds, DefaultPrompts, Reload() }, LlmById( id ),
//               RunChanged( root, event ); TasksOf( root, project ), NeedsPlan( task ), ProjectLlm( root, project ),
//               Reason( root, pick ) (plan LLM Tasks, Step 6: the one set of rules the LLM page and the plan's heading
//               ask); and the current root's Loaded, Available, Llms, Tasks, Running, Kinds, DefaultPrompts }
//   route     #/llm/<llm id>, under #/s/<root> for a named root (plan Run Shapes, Step 5)

angular.module( 'Consensus' ).factory( 'Llms', [ '$rootScope', 'Client', 'State', 'Roots', function ( $rootScope, Client, State, Roots )
{
	let per_root = {};		// root key -> the root's connections


	function make( root )
	{
		let items = {
			Root: root,
			Loaded: false,
			Available: false,		// whether the server runs LLMs at all
			Llms: [],
			Tasks: [],				// the server's tasks, in the buttons' order
			Running: {},			// llm id -> the running run's summary
			Kinds: [],
			DefaultPrompts: {},
		};


		async function Reload()
		{
			let answer = null;
			try
			{
				answer = await Client.Get( root, '/api/llms' );
			}
			catch ( error )
			{
				items.Loaded = true;
				$rootScope.$applyAsync();
				return;
			}
			items.Llms = ( answer.Llms || [] ).map( function ( llm ) { llm.Root = root.Key; return llm; } );
			items.Kinds = answer.Kinds || [];
			items.DefaultPrompts = answer.DefaultPrompts || {};
			items.Available = !!answer.Runs;
			try
			{
				items.Tasks = ( await Client.Get( root, '/api/tasks' ) ).Tasks || [];
			}
			catch ( error )
			{
				items.Tasks = [];
			}
			items.Running = {};
			for ( let llm of items.Llms )
			{
				if ( llm.Running )
				{
					items.Running[ llm.Id ] = llm.Running;
				}
			}
			items.Loaded = true;
			$rootScope.$applyAsync();
		}


		items.Reload = Reload;
		return items;
	}


	// For: a root's connections (plan Run Shapes, Step 5), read at start and again as the root's stream connects (app.js).
	function For( Root )
	{
		let root = Root || Roots.List[ 0 ];
		let key = root ? root.Key : '';
		if ( !per_root[ key ] )
		{
			per_root[ key ] = make( root );
		}
		return per_root[ key ];
	}


	// A connection by id, on any root.
	function LlmById( Id )
	{
		for ( let key of Object.keys( per_root ) )
		{
			let found = per_root[ key ].Llms.find( function ( llm ) { return llm.Id === Id; } );
			if ( found )
			{
				return found;
			}
		}
		return null;
	}


	// A run started, progressed or ended on a root, heard over its events: the running marks follow, and everyone
	// hears it.
	function RunChanged( Root, Event )
	{
		let items = For( Root );
		let summary = { Id: Event.Run, Llm: { Id: Event.Llm }, Status: Event.Status, Root: Root.Key };
		if ( Event.Status === 'running' )
		{
			items.Running[ Event.Llm ] = summary;
		}
		else if ( Event.Status !== 'queued' )
		{
			// a run queued behind the running one (plan Multiuser, Step 3) changes nothing about the mark
			delete items.Running[ Event.Llm ];
		}
		$rootScope.$broadcast( 'runs-changed', summary );
	}


	// The tasks a project enables, in the server's order; a project with no list enables them all (plan LLM Tasks, Step 1).
	function TasksOf( Root, Project )
	{
		let tasks = For( Root ).Tasks || [];
		let enabled = Project ? Project.Tasks : null;
		if ( !Array.isArray( enabled ) )
		{
			return tasks;
		}
		return tasks.filter( function ( task ) { return enabled.includes( task.Id ); } );
	}


	// A task that packages the plan or its threads needs one picked.
	function NeedsPlan( Task )
	{
		return !!Task && !!Task.Package && !!( Task.Package.Plan || Task.Package.Threads );
	}


	// The connection a project chose (plan LLM Tasks, Step 6: project.json's Llm), while the server still has it.
	function ProjectLlm( Root, Project )
	{
		let id = ( Project && typeof Project.Llm === 'string' ) ? Project.Llm : '';
		if ( !id )
		{
			return null;
		}
		return For( Root ).Llms.find( function ( llm ) { return llm.Id === id; } ) || null;
	}


	// Why a task cannot run, or '' when it can (plan LLM Tasks, Step 6: one set of rules for the LLM page and the plan's
	// heading): no connection, no server that runs, no one signed in, a run going on that connection, no project, no
	// plan when the task packages one. Pick = { Llm: a connection's id or null, NoLlm: the words when there is none,
	// Project: its id, Plan: its id, Task }.
	function Reason( Root, Pick )
	{
		let items = For( Root );
		if ( !Pick.Llm )
		{
			return Pick.NoLlm || 'no connection';
		}
		if ( !items.Available )
		{
			return 'this server runs no LLMs';
		}
		if ( !items.Root || !items.Root.Me )
		{
			return 'no one is signed in';
		}
		// Plan User Management, Step 5: what the role may press, as src/Roles.js MayPress has it, said before the server says it.
		if ( items.Root.Me.Role !== 'owner' && Pick.Project )
		{
			let role = ( items.Root.Roles || {} )[ Pick.Project ] || null;
			let writes = ( Pick.Task && Pick.Task.Writes ) || 'consensus';
			if ( !role )
			{
				return 'no role in this project';
			}
			if ( role === 'Service' )
			{
				return 'a Service account presses no task';
			}
			if ( role === 'Watchers' && writes !== 'none' )
			{
				return 'a Watcher presses a task that reads only';
			}
		}
		if ( items.Running[ Pick.Llm ] )
		{
			return 'a run is going';
		}
		if ( !Pick.Project )
		{
			return 'pick the project';
		}
		if ( NeedsPlan( Pick.Task ) && !Pick.Plan )
		{
			return 'pick the plan at hand';
		}
		return '';
	}


	// The current root's connections, as the panes read them when the page had one server.
	let llms = {};

	function of_current( field )
	{
		return function () { return For( State.Root )[ field ]; };
	}

	Object.defineProperty( llms, 'Loaded', { get: of_current( 'Loaded' ) } );
	Object.defineProperty( llms, 'Available', { get: of_current( 'Available' ) } );
	Object.defineProperty( llms, 'Llms', { get: of_current( 'Llms' ) } );
	Object.defineProperty( llms, 'Tasks', { get: of_current( 'Tasks' ) } );
	Object.defineProperty( llms, 'Running', { get: of_current( 'Running' ) } );
	Object.defineProperty( llms, 'Kinds', { get: of_current( 'Kinds' ) } );
	Object.defineProperty( llms, 'DefaultPrompts', { get: of_current( 'DefaultPrompts' ) } );
	// What a queued run waits for, for a toast or a record's line (plan Multiuser, Step 3): " behind Work on The plan".
	function BehindWords( Run )
	{
		if ( !Run || !Run.Behind )
		{
			return '';
		}
		return ' behind ' + ( Run.Behind.Task ? Run.Behind.Task.Name : 'a run' ) + ( Run.Behind.Plan ? ' on ' + Run.Behind.Plan.Title : '' );
	}


	llms.For = For;
	llms.LlmById = LlmById;
	llms.BehindWords = BehindWords;
	llms.RunChanged = RunChanged;
	llms.TasksOf = TasksOf;
	llms.NeedsPlan = NeedsPlan;
	llms.ProjectLlm = ProjectLlm;
	llms.Reason = Reason;
	llms.Reload = function () { return For( State.Root ).Reload(); };
	for ( let root of Roots.List )
	{
		For( root ).Reload();
	}
	return llms;
} ] )


//---------------------------------------------------------------------
// A text's size, for the prompts and the outputs: "12,345 characters · ≈ 3,086 tokens" (four characters per token).

.filter( 'size', [ function ()
{
	return function ( Text )
	{
		let length = String( Text || '' ).length;
		return length.toLocaleString() + ' characters · ≈ ' + Math.round( length / 4 ).toLocaleString() + ' tokens';
	};
} ] );
