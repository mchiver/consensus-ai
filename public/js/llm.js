'use strict';

// Llm - the LLM connections and the runs of the server (plan Run Shapes, Step 3; the desktop's items before, plan
// Consensus Desktop, Step 3): the connections from /api/llms, each a participant of the server, listed once under
// the projects in the sidebar; the LLM page (a head with Details… and Packaging… popups for the owner, the Run
// with its project and plan pickers and the Review, Build and Session buttons, and the log of runs, a run opened
// in a popup; plan UI Tweaks IV), over /api/runs. The same in a browser and in the desktop: the server runs the LLM,
// in the project's folder on its own machine.
//
//   Llms      { For( root ) -> { Loaded, Available, Llms, Running, Kinds, DefaultPrompts, Reload() }, LlmById( id ),
//               RunChanged( root, event ); and the current root's Loaded, Available, Llms, Running, Kinds, DefaultPrompts }
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
		else
		{
			delete items.Running[ Event.Llm ];
		}
		$rootScope.$broadcast( 'runs-changed', summary );
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
	Object.defineProperty( llms, 'Running', { get: of_current( 'Running' ) } );
	Object.defineProperty( llms, 'Kinds', { get: of_current( 'Kinds' ) } );
	Object.defineProperty( llms, 'DefaultPrompts', { get: of_current( 'DefaultPrompts' ) } );
	llms.For = For;
	llms.LlmById = LlmById;
	llms.RunChanged = RunChanged;
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
