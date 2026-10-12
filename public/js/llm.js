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
} ] )


//---------------------------------------------------------------------
// LlmController: the LLM page, for the connection the route names.

.controller( 'LlmController', [ '$scope', '$window', 'State', 'Client', 'Llms', 'Roots', function ( $scope, $window, State, Client, Llms, Roots )
{
	const OPEN_PROJECT_KEY = 'project';		// the sidebar's open project (stored.js, per server)

	$scope.State = State;
	$scope.Items = Llms;
	$scope.Root = null;			// the connection's server (roots.js)


	// The root of the connection the route names, else the current one.
	function current_root()
	{
		let open = State.OpenItem;
		return ( open && open.Kind === 'llm' && Roots.Of( open.Root ) ) || State.Root || Roots.List[ 0 ];
	}


	function items()
	{
		return Llms.For( current_root() );
	}
	$scope.Llm = null;			// the saved one
	$scope.Project = null;		// the project picked for the run
	$scope.PlanRows = [];		// the project's folders and plans, in the tree's order, with their depth and unresolved (contested) threads
	$scope.Pick = { Project: null, Plan: null };
	$scope.PickerOpen = false;
	$scope.Runs = [];
	$scope.Error = null;
	$scope.Busy = false;
	$scope.Details = null;		// the Details popup: { Form, Problems, Checked, Busy }
	$scope.Packaging = null;	// the Packaging popup: { Form, Lists, Preview, Problems, Busy, Copied }
	$scope.RunPopup = null;		// a run opened from the log: { Run, Source, Copied }


	//-----------------------------------------------------------------
	// The page follows the route: the connection; the project is picked, the sidebar's open one first.

	function rows_of( items, depth, into )
	{
		for ( let node of items || [] )
		{
			if ( node.Kind === 'folder' )
			{
				let before = into.length;
				into.push( { Kind: 'folder', Id: node.Id, Title: node.Name, Depth: depth } );
				rows_of( node.Items, depth + 1, into );
				if ( into.length === before + 1 )
				{
					into.pop();		// a folder with no plans is not listed
				}
				continue;
			}
			if ( node.Kind !== 'document' && !node.Missing )
			{
				into.push( { Kind: 'plan', Id: node.Id, Title: node.Title, State: node.State, Depth: depth, Unresolved: ( node.Tally && node.Tally.Contested ) || 0 } );
				rows_of( node.Items, depth + 1, into );
			}
		}
		return into;
	}


	function plan_rows()
	{
		return $scope.PlanRows.filter( function ( row ) { return row.Kind === 'plan'; } );
	}


	function project_by_id( id )
	{
		return current_root().Projects.find( function ( candidate ) { return candidate.Id === id; } ) || null;
	}


	function load()
	{
		let open = State.OpenItem;
		if ( State.View !== 'llm' || !open || open.Kind !== 'llm' )
		{
			return;
		}
		let root = current_root();
		$scope.Root = root;
		let llm = Llms.LlmById( open.Id );
		let changed = !$scope.Llm || $scope.Llm.Id !== open.Id;
		$scope.Llm = llm;
		if ( changed )
		{
			$scope.Details = null;
			$scope.Packaging = null;
			$scope.RunPopup = null;
			$scope.PickerOpen = false;
			$scope.Error = null;
			$scope.Pick = { Project: null, Plan: null };
			load_runs();
		}
		// the project: the one picked, else the sidebar's open project, else the first
		if ( !project_by_id( $scope.Pick.Project ) )
		{
			let remembered = window.ConsensusStored.Read( OPEN_PROJECT_KEY, null, root );
			$scope.Pick.Project = project_by_id( remembered ) ? remembered : ( root.Projects.length ? root.Projects[ 0 ].Id : null );
			$scope.Pick.Plan = null;
		}
		$scope.Project = project_by_id( $scope.Pick.Project );
		$scope.PlanRows = $scope.Project ? rows_of( $scope.Project.Items, 0, [] ) : [];
		// the plan at hand: the one picked, else the plan last opened in this project
		let plans = plan_rows();
		if ( !plans.some( function ( plan ) { return plan.Id === $scope.Pick.Plan; } ) )
		{
			let last = ( State.LastPlan && $scope.Project ) ? State.LastPlan[ $scope.Project.Id ] : null;
			$scope.Pick.Plan = plans.some( function ( plan ) { return plan.Id === last; } ) ? last : ( plans.length ? plans[ 0 ].Id : null );
		}
	}


	async function load_runs()
	{
		if ( !$scope.Llm || !items().Available )
		{
			$scope.Runs = [];
			return;
		}
		try
		{
			let answer = await Client.Get( current_root(), '/api/runs?Llm=' + encodeURIComponent( $scope.Llm.Id ) );
			$scope.Runs = answer.Runs || [];
			if ( $scope.RunPopup )
			{
				let fresh = await Client.Get( current_root(), '/api/runs/' + encodeURIComponent( $scope.RunPopup.Run.Id ) );
				$scope.RunPopup.Run = fresh.Run || $scope.RunPopup.Run;
			}
		}
		catch ( error )
		{
			$scope.Runs = [];
		}
		$scope.$applyAsync();
	}


	$scope.$watch( function () { return [ State.View, State.OpenItem ? State.OpenItem.Kind + '/' + State.OpenItem.Id + '/' + ( State.OpenItem.Root || '' ) : null, items().Llms, current_root() ? current_root().Projects : null, $scope.Pick.Project ]; }, load, true );


	// A run started, called a tool or ended: the log and the tree follow, and the popup showing that run re-reads it.
	$scope.$on( 'runs-changed', function ( event, summary )
	{
		if ( $scope.Llm && summary.Llm && summary.Llm.Id === $scope.Llm.Id && summary.Root === current_root().Key )
		{
			load_runs();
			if ( $scope.RunPopup && $scope.RunPopup.Run.Id === summary.Id )
			{
				$scope.RefreshRun();
			}
			if ( summary.Status !== 'running' )
			{
				Roots.LoadList( current_root() );
				if ( current_root() === State.Root )
				{
					State.Reload();
				}
			}
		}
	} );


	// The owner keeps the connections; everyone but an llm participant starts a run.
	$scope.IsOwner = function ()
	{
		let me = current_root().Me;
		return !!me && me.Role === 'owner';
	};


	$scope.MayRun = function ()
	{
		let me = current_root().Me;
		return !!me && me.Role !== 'llm';
	};


	// The popups close from their own buttons through these, on the controller's scope: an assignment inside a
	// popup's form (a child scope, under ng-if) would only shadow the variable there.
	$scope.CloseDetails = function ()
	{
		$scope.Details = null;
	};


	$scope.ClosePackaging = function ()
	{
		$scope.Packaging = null;
	};


	$scope.CloseRun = function ()
	{
		$scope.RunPopup = null;
	};


	// Escape closes the popup and the picker.
	$scope.Key = function ( event )
	{
		if ( event.key === 'Escape' )
		{
			$scope.CloseDetails();
			$scope.ClosePackaging();
			$scope.CloseRun();
			$scope.PickerOpen = false;
		}
	};


	// What a failed request said: its problems one by one when it named them, else its message.
	function problems_of( error )
	{
		if ( error && error.Body && Array.isArray( error.Body.Problems ) && error.Body.Problems.length )
		{
			return error.Body.Problems;
		}
		return [ ( error && error.message ) || 'the request failed' ];
	}


	//-----------------------------------------------------------------
	// The Details popup: saved whole, or cancelled; Check tries the form as it stands.

	function details_form( llm )
	{
		return {
			Name: llm.Name,
			Kind: llm.Kind,
			Command: llm.Command,
			ArgumentsText: ( llm.Arguments || [] ).join( '\n' ),
			Url: llm.Url,
			Model: llm.Model,
			Timeout: llm.Timeout,
			Context: llm.Context,
			Rounds: llm.Rounds,
		};
	}


	function lines( text )
	{
		return String( text || '' ).split( /\r?\n/ ).map( function ( line ) { return line.trim(); } ).filter( function ( line ) { return line; } );
	}


	function from_details( form )
	{
		return {
			Name: form.Name,
			Kind: form.Kind,
			Command: form.Command,
			Arguments: lines( form.ArgumentsText ),
			Url: form.Url,
			Model: form.Model,
			Timeout: form.Timeout,
			Context: form.Context,
			Rounds: form.Rounds,
		};
	}


	$scope.OpenDetails = function ()
	{
		if ( $scope.Llm && $scope.IsOwner() )
		{
			$scope.Details = { Form: details_form( $scope.Llm ), Problems: [], Checked: null, Busy: false };
		}
	};


	$scope.CheckDetails = async function ()
	{
		let popup = $scope.Details;
		if ( !popup || popup.Busy )
		{
			return;
		}
		popup.Busy = true;
		popup.Checked = null;
		try
		{
			popup.Checked = await Client.Post( current_root(), '/api/llms/' + encodeURIComponent( $scope.Llm.Id ) + '/check', from_details( popup.Form ) );
		}
		catch ( error )
		{
			popup.Checked = { Ok: false, Error: error.message };
		}
		popup.Busy = false;
		$scope.$applyAsync();
	};


	async function save_llm( fields )
	{
		let answer = await Client.Put( current_root(), '/api/llms/' + encodeURIComponent( $scope.Llm.Id ), fields );
		await items().Reload();
		$scope.Llm = Llms.LlmById( answer.Llm.Id );
	}


	$scope.SaveDetails = async function ()
	{
		let popup = $scope.Details;
		if ( !popup || popup.Busy )
		{
			return;
		}
		popup.Busy = true;
		popup.Problems = [];
		try
		{
			await save_llm( from_details( popup.Form ) );
			$scope.Details = null;
		}
		catch ( error )
		{
			popup.Problems = problems_of( error );
			popup.Busy = false;
		}
		$scope.$applyAsync();
	};


	//-----------------------------------------------------------------
	// The Packaging popup: the checks, the lists of documents and threads (each checkable, the unchecked ids kept),
	// the prompts, and a Preview of the package as the form stands.

	function packaging_form( llm )
	{
		return {
			Checks: Object.assign( {}, llm.Checks ),
			Prompts: Object.assign( {}, llm.Prompts ),
			Unchecked: { Documents: ( llm.Unchecked.Documents || [] ).slice(), Threads: ( llm.Unchecked.Threads || [] ).slice() },
		};
	}


	function from_packaging( form )
	{
		return { Checks: form.Checks, Prompts: form.Prompts, Unchecked: form.Unchecked };
	}


	$scope.OpenPackaging = async function ()
	{
		if ( !$scope.Llm || !$scope.IsOwner() )
		{
			return;
		}
		let popup = { Form: packaging_form( $scope.Llm ), Lists: { Documents: [], Threads: [], Participant: $scope.Llm.Participant }, Preview: null, Problems: [], Busy: true, Copied: false };
		$scope.Packaging = popup;
		try
		{
			let query = '?Project=' + encodeURIComponent( $scope.Pick.Project || '' ) + '&Plan=' + encodeURIComponent( $scope.Pick.Plan || '' ) + '&Llm=' + encodeURIComponent( $scope.Llm.Id );
			let answer = await Client.Get( current_root(), '/api/runs/lists' + query );
			popup.Lists = { Documents: answer.Documents || [], Threads: answer.Threads || [], Participant: answer.Participant || $scope.Llm.Participant };
		}
		catch ( error )
		{
			popup.Problems = [ error.message ];
		}
		popup.Busy = false;
		$scope.$applyAsync();
	};


	$scope.IsChecked = function ( list, id )
	{
		return !!$scope.Packaging && !$scope.Packaging.Form.Unchecked[ list ].includes( id );
	};


	$scope.ToggleChecked = function ( list, id )
	{
		if ( !$scope.Packaging )
		{
			return;
		}
		let unchecked = $scope.Packaging.Form.Unchecked[ list ];
		if ( unchecked.includes( id ) )
		{
			$scope.Packaging.Form.Unchecked[ list ] = unchecked.filter( function ( one ) { return one !== id; } );
		}
		else
		{
			unchecked.push( id );
		}
		$scope.Packaging.Preview = null;
	};


	$scope.ResetPrompt = function ( name )
	{
		if ( $scope.Packaging )
		{
			$scope.Packaging.Form.Prompts[ name ] = ( items().DefaultPrompts || {} )[ name ] || '';
		}
	};


	function request( kind, overrides )
	{
		let made = { Llm: $scope.Llm.Id, Kind: kind, Project: $scope.Pick.Project || null, Plan: $scope.Pick.Plan || null };
		if ( overrides )
		{
			made.Overrides = overrides;
		}
		return made;
	}


	// Preview: the package for the project and plan picked in Run, with the checks and prompts as the form stands.
	$scope.Preview = async function ( kind )
	{
		let popup = $scope.Packaging;
		if ( !popup || popup.Busy )
		{
			return;
		}
		popup.Busy = true;
		popup.Copied = false;
		popup.Problems = [];
		try
		{
			let answer = await Client.Post( current_root(), '/api/runs/package', request( kind, from_packaging( popup.Form ) ) );
			popup.Preview = { Kind: kind, Text: answer.Prompt };
		}
		catch ( error )
		{
			popup.Problems = [ error.message ];
			popup.Preview = null;
		}
		popup.Busy = false;
		$scope.$applyAsync();
	};


	$scope.SavePackaging = async function ()
	{
		let popup = $scope.Packaging;
		if ( !popup || popup.Busy )
		{
			return;
		}
		popup.Busy = true;
		popup.Problems = [];
		try
		{
			await save_llm( from_packaging( popup.Form ) );
			$scope.Packaging = null;
		}
		catch ( error )
		{
			popup.Problems = problems_of( error );
			popup.Busy = false;
		}
		$scope.$applyAsync();
	};


	$scope.Copy = function ( text, holder )
	{
		if ( text && navigator.clipboard )
		{
			navigator.clipboard.writeText( text ).then( function ()
			{
				if ( holder )
				{
					holder.Copied = true;
				}
				$scope.$applyAsync();
			} ).catch( function () {} );
		}
	};


	//-----------------------------------------------------------------
	// Run: the project, the plan picker (the page's own list, in the tree's order), the buttons.

	$scope.PickProject = function ()
	{
		$scope.Pick.Plan = null;
		$scope.PickerOpen = false;
	};


	$scope.TogglePicker = function ( event )
	{
		event.stopPropagation();
		$scope.PickerOpen = !$scope.PickerOpen;
	};


	$scope.PickPlan = function ( row )
	{
		if ( row.Kind === 'plan' )
		{
			$scope.Pick.Plan = row.Id;
			$scope.PickerOpen = false;
		}
	};


	$scope.ClearPlan = function ()
	{
		$scope.Pick.Plan = null;
		$scope.PickerOpen = false;
	};


	$scope.PickedPlan = function ()
	{
		return plan_rows().find( function ( plan ) { return plan.Id === $scope.Pick.Plan; } ) || null;
	};


	function close_picker()
	{
		if ( $scope.PickerOpen )
		{
			$scope.$applyAsync( function () { $scope.PickerOpen = false; } );
		}
	}

	document.addEventListener( 'mousedown', function ( event )
	{
		if ( $scope.PickerOpen && !event.target.closest( '.picker' ) )
		{
			close_picker();
		}
	}, true );
	$scope.$on( '$destroy', function () { close_picker(); } );


	$scope.IsRunning = function ()
	{
		return !!$scope.Llm && !!items().Running[ $scope.Llm.Id ];
	};


	// Why a button is disabled, or '' when it can run: no server runs, an llm participant, a run going, no project,
	// no plan.
	$scope.Reason = function ( kind )
	{
		if ( !$scope.Llm )
		{
			return 'no connection';
		}
		if ( !items().Available )
		{
			return 'this server runs no LLMs';
		}
		if ( !$scope.MayRun() )
		{
			return 'an LLM participant starts no run';
		}
		if ( $scope.IsRunning() )
		{
			return 'a run is going';
		}
		if ( !$scope.Pick.Project )
		{
			return 'pick the project';
		}
		if ( kind !== 'session' && !$scope.Pick.Plan )
		{
			return 'pick the plan at hand';
		}
		return '';
	};


	$scope.CanRun = function ( kind )
	{
		return !$scope.Busy && $scope.Reason( kind ) === '';
	};


	// The reasons shown beside the buttons: one line per button that cannot run, the same reason named once.
	$scope.Reasons = function ()
	{
		let seen = [];
		for ( let kind of [ 'review', 'build', 'session' ] )
		{
			let reason = $scope.Reason( kind );
			if ( reason && !seen.includes( reason ) )
			{
				seen.push( reason );
			}
		}
		return seen.join( '; ' );
	};


	$scope.Run = async function ( kind )
	{
		if ( !$scope.CanRun( kind ) )
		{
			return;
		}
		$scope.Busy = true;
		$scope.Error = null;
		try
		{
			let answer = await Client.Post( current_root(), '/api/runs', request( kind ) );
			items().Running[ $scope.Llm.Id ] = answer.Run;
			await load_runs();
			await $scope.OpenRun( answer.Run );
		}
		catch ( error )
		{
			$scope.Error = error.message;
		}
		$scope.Busy = false;
		$scope.$applyAsync();
	};


	$scope.Stop = async function ()
	{
		let running = $scope.Llm ? items().Running[ $scope.Llm.Id ] : null;
		if ( running )
		{
			try
			{
				await Client.Post( current_root(), '/api/runs/' + encodeURIComponent( running.Id ) + '/stop' );
			}
			catch ( error )
			{
				$scope.Error = error.message;
				$scope.$applyAsync();
			}
		}
	};


	//-----------------------------------------------------------------
	// The log: a run opens in a popup, its output and prompt rendered as markdown, or as source.

	$scope.OpenRun = async function ( run )
	{
		try
		{
			let answer = await Client.Get( current_root(), '/api/runs/' + encodeURIComponent( run.Id ) );
			$scope.RunPopup = { Run: answer.Run, Source: false, Copied: null, Open: {} };
		}
		catch ( error )
		{
			$scope.Error = error.message;
		}
		$scope.$applyAsync();
	};


	$scope.RefreshRun = async function ()
	{
		if ( $scope.RunPopup )
		{
			try
			{
				let answer = await Client.Get( current_root(), '/api/runs/' + encodeURIComponent( $scope.RunPopup.Run.Id ) );
				$scope.RunPopup.Run = answer.Run || $scope.RunPopup.Run;
			}
			catch ( error )
			{
				// the run is gone; the popup keeps what it has
			}
			$scope.$applyAsync();
		}
	};


	// The transcript's round headings: before the first entry of a round that is not the answer.
	$scope.RoundStarts = function ( transcript, index )
	{
		let entry = transcript[ index ];
		if ( entry.Kind === 'answer' )
		{
			return false;
		}
		return index === 0 || transcript[ index - 1 ].Round !== entry.Round || transcript[ index - 1 ].Kind === 'answer';
	};


	// A local model's run: its rounds and the tokens Ollama counted; '' for a command's run.
	$scope.Spent = function ( run )
	{
		if ( !run || run.Rounds === null || run.Rounds === undefined )
		{
			return '';
		}
		let words = run.Rounds + ( run.Rounds === 1 ? ' round' : ' rounds' );
		if ( run.Usage )
		{
			words += ' · ' + Number( run.Usage.Prompt || 0 ).toLocaleString() + ' prompt + ' + Number( run.Usage.Answer || 0 ).toLocaleString() + ' answer tokens';
		}
		return words;
	};


	$scope.Duration = function ( run )
	{
		if ( run.Duration === null || run.Duration === undefined )
		{
			return 'running since ' + new Date( run.Started ).toLocaleTimeString( [], { hour: '2-digit', minute: '2-digit' } );
		}
		if ( run.Duration < 60 )
		{
			return run.Duration + ' s';
		}
		return Math.floor( run.Duration / 60 ) + ' min ' + ( run.Duration % 60 ) + ' s';
	};
} ] );
