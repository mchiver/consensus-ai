'use strict';

// Desktop - the LLM connections and the workspaces (plan Consensus Desktop, Step 3): the desktop's own items,
// read through window.Desktop (preload.js) and shown in every project's Context folder by the sidebar. Each opens
// in a tab of its own: the LLM page (a head with Details… and Packaging… popups, the Run with its plan picker and
// the Review, Build and Session buttons, and the log of runs, a run opened in a popup; plan UI Tweaks IV) and the
// workspace page (its details, and the files it includes). In a browser, without the desktop, there are no items
// and nothing here shows.
//
//   DesktopItems  { Available, Loaded, Llms, Workspaces, Running, DefaultPrompts, Reload(), LlmById( id ), WorkspaceById( id ), WorkspacesOf( project id ) }
//   routes        #/llm/<project id>/<llm id>   #/w/<workspace id>

angular.module( 'Consensus' ).factory( 'DesktopItems', [ '$rootScope', function ( $rootScope )
{
	let desktop = ( window.Desktop && typeof window.Desktop.Items === 'function' ) ? window.Desktop : null;
	let items = {
		Available: !!desktop,
		Loaded: false,
		Llms: [],
		Workspaces: [],
		Running: {},
		DefaultPrompts: {},
	};


	async function Reload()
	{
		if ( !desktop )
		{
			return;
		}
		let answer = await desktop.Items();
		items.Llms = answer.Llms || [];
		items.Workspaces = answer.Workspaces || [];
		items.DefaultPrompts = answer.DefaultPrompts || {};
		items.Running = {};
		for ( let run of answer.Running || [] )
		{
			items.Running[ run.Llm.Id ] = run;
		}
		items.Loaded = true;
		$rootScope.$applyAsync();
	}


	function LlmById( Id )
	{
		return items.Llms.find( function ( llm ) { return llm.Id === Id; } ) || null;
	}


	function WorkspaceById( Id )
	{
		return items.Workspaces.find( function ( workspace ) { return workspace.Id === Id; } ) || null;
	}


	function WorkspacesOf( ProjectId )
	{
		return items.Workspaces.filter( function ( workspace ) { return workspace.Project === ProjectId; } );
	}


	// A run started or ended, in this window or another: the running marks follow, and everyone hears it.
	if ( desktop )
	{
		desktop.OnRunsChanged( function ( summary )
		{
			$rootScope.$applyAsync( function ()
			{
				if ( summary.Status === 'running' )
				{
					items.Running[ summary.Llm.Id ] = summary;
				}
				else
				{
					delete items.Running[ summary.Llm.Id ];
				}
				$rootScope.$broadcast( 'runs-changed', summary );
			} );
		} );
		Reload();
	}

	items.Reload = Reload;
	items.LlmById = LlmById;
	items.WorkspaceById = WorkspaceById;
	items.WorkspacesOf = WorkspacesOf;
	return items;
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
// LlmController: the LLM page, for the connection and the project the route names.

.controller( 'LlmController', [ '$scope', '$window', '$timeout', 'State', 'DesktopItems', function ( $scope, $window, $timeout, State, DesktopItems )
{
	const KINDS = [ 'claude-cli', 'ollama' ];

	$scope.State = State;
	$scope.Items = DesktopItems;
	$scope.Kinds = KINDS;
	$scope.Llm = null;			// the saved one
	$scope.Project = null;
	$scope.PlanRows = [];		// the project's folders and plans, in the tree's order, with their depth and unresolved (contested) threads
	$scope.Workspaces = [];
	$scope.Pick = { Plan: null, Workspace: null };
	$scope.PickerOpen = false;
	$scope.Runs = [];
	$scope.Error = null;
	$scope.Busy = false;
	$scope.Details = null;		// the Details popup: { Form, Problems, Checked, Busy }
	$scope.Packaging = null;	// the Packaging popup: { Form, Lists, Preview, Problems, Busy, Copied }
	$scope.RunPopup = null;		// a run opened from the log: { Run, Source, Copied }


	//-----------------------------------------------------------------
	// The page follows the route: the connection and the project it was opened from.

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


	function load()
	{
		let open = State.OpenItem;
		if ( State.View !== 'llm' || !open || open.Kind !== 'llm' )
		{
			return;
		}
		let llm = DesktopItems.LlmById( open.Id );
		let project = State.Projects.find( function ( candidate ) { return candidate.Id === open.Project; } ) || null;
		let changed = !$scope.Llm || $scope.Llm.Id !== open.Id || !$scope.Project || $scope.Project.Id !== open.Project;
		$scope.Llm = llm;
		$scope.Project = project;
		$scope.PlanRows = project ? rows_of( project.Items, 0, [] ) : [];
		$scope.Workspaces = project ? DesktopItems.WorkspacesOf( project.Id ) : [];
		if ( changed )
		{
			$scope.Details = null;
			$scope.Packaging = null;
			$scope.RunPopup = null;
			$scope.PickerOpen = false;
			$scope.Error = null;
			$scope.Pick = { Plan: null, Workspace: null };
			load_runs();
		}
		// the plan at hand: the one picked, else the plan last opened in this project
		let plans = plan_rows();
		if ( !plans.some( function ( plan ) { return plan.Id === $scope.Pick.Plan; } ) )
		{
			let last = State.LastPlan ? State.LastPlan[ open.Project ] : null;
			$scope.Pick.Plan = plans.some( function ( plan ) { return plan.Id === last; } ) ? last : ( plans.length ? plans[ 0 ].Id : null );
		}
		if ( !$scope.Workspaces.some( function ( workspace ) { return workspace.Id === $scope.Pick.Workspace; } ) )
		{
			$scope.Pick.Workspace = $scope.Workspaces.length ? $scope.Workspaces[ 0 ].Id : null;
		}
	}


	async function load_runs()
	{
		if ( !$scope.Llm || !DesktopItems.Available )
		{
			$scope.Runs = [];
			return;
		}
		let answer = await window.Desktop.Runs( $scope.Llm.Id );
		// the log shows this project's runs only
		let project_id = $scope.Project ? $scope.Project.Id : null;
		$scope.Runs = ( answer.Runs || [] ).filter( function ( run ) { return run.Project && run.Project.Id === project_id; } );
		if ( $scope.RunPopup )
		{
			let fresh = await window.Desktop.ReadRun( $scope.RunPopup.Run.Id );
			$scope.RunPopup.Run = fresh.Run || $scope.RunPopup.Run;
		}
		$scope.$applyAsync();
	}


	$scope.$watch( function () { return [ State.View, State.OpenItem ? State.OpenItem.Kind + '/' + State.OpenItem.Project + '/' + State.OpenItem.Id : null, DesktopItems.Llms, DesktopItems.Workspaces, State.Projects ]; }, load, true );


	// A run started, called a tool or ended: the log and the tree follow, and the popup showing that run re-reads it.
	$scope.$on( 'runs-changed', function ( event, summary )
	{
		if ( $scope.Llm && summary.Llm && summary.Llm.Id === $scope.Llm.Id )
		{
			load_runs();
			if ( $scope.RunPopup && $scope.RunPopup.Run.Id === summary.Id )
			{
				$scope.RefreshRun();
			}
			if ( summary.Status !== 'running' )
			{
				State.LoadList();
				State.Reload();
			}
		}
	} );


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
		return Object.assign( {}, $scope.Llm, {
			Name: form.Name,
			Kind: form.Kind,
			Command: form.Command,
			Arguments: lines( form.ArgumentsText ),
			Url: form.Url,
			Model: form.Model,
			Timeout: form.Timeout,
			Context: form.Context,
			Rounds: form.Rounds,
		} );
	}


	$scope.OpenDetails = function ()
	{
		if ( $scope.Llm )
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
		popup.Checked = await window.Desktop.CheckLlm( from_details( popup.Form ) );
		popup.Busy = false;
		$scope.$applyAsync();
	};


	$scope.SaveDetails = async function ()
	{
		let popup = $scope.Details;
		if ( !popup || popup.Busy )
		{
			return;
		}
		popup.Busy = true;
		popup.Problems = [];
		let answer = await window.Desktop.SaveLlm( from_details( popup.Form ) );
		if ( answer.Problems )
		{
			popup.Problems = answer.Problems;
			popup.Busy = false;
		}
		else
		{
			await DesktopItems.Reload();
			$scope.Llm = DesktopItems.LlmById( answer.Item.Id );
			$scope.Details = null;
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
		return Object.assign( {}, $scope.Llm, { Checks: form.Checks, Prompts: form.Prompts, Unchecked: form.Unchecked } );
	}


	$scope.OpenPackaging = async function ()
	{
		if ( !$scope.Llm )
		{
			return;
		}
		let popup = { Form: packaging_form( $scope.Llm ), Lists: { Documents: [], Threads: [] }, Preview: null, Problems: [], Busy: true, Copied: false };
		$scope.Packaging = popup;
		let answer = await window.Desktop.PackageLists( { ProjectId: $scope.Project ? $scope.Project.Id : null, PlanId: $scope.Pick.Plan || null } );
		if ( answer.Error )
		{
			popup.Problems = [ answer.Error ];
		}
		else
		{
			popup.Lists = { Documents: answer.Documents || [], Threads: answer.Threads || [] };
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
			$scope.Packaging.Form.Prompts[ name ] = ( DesktopItems.DefaultPrompts || {} )[ name ] || '';
		}
	};


	function request( kind, overrides )
	{
		let made = { LlmId: $scope.Llm.Id, Kind: kind, ProjectId: $scope.Project ? $scope.Project.Id : null, PlanId: $scope.Pick.Plan || null, WorkspaceId: $scope.Pick.Workspace || null };
		if ( overrides )
		{
			made.Overrides = overrides;
		}
		return made;
	}


	// Preview: the package for the plan and workspace picked in Run, with the checks and prompts as the form stands.
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
		let answer = await window.Desktop.Package( request( kind, { Checks: popup.Form.Checks, Prompts: popup.Form.Prompts, Unchecked: popup.Form.Unchecked } ) );
		if ( answer.Error )
		{
			popup.Problems = [ answer.Error ];
			popup.Preview = null;
		}
		else
		{
			popup.Preview = { Kind: kind, Text: answer.Prompt };
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
		let answer = await window.Desktop.SaveLlm( from_packaging( popup.Form ) );
		if ( answer.Problems )
		{
			popup.Problems = answer.Problems;
			popup.Busy = false;
		}
		else
		{
			await DesktopItems.Reload();
			$scope.Llm = DesktopItems.LlmById( answer.Item.Id );
			$scope.Packaging = null;
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
	// Run: the plan picker (the page's own list, in the tree's order), the workspace, the buttons.

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
		return !!$scope.Llm && !!DesktopItems.Running[ $scope.Llm.Id ];
	};


	// Why a button is disabled, or '' when it can run: a run going, no plan, no workspace.
	$scope.Reason = function ( kind )
	{
		if ( !$scope.Llm )
		{
			return 'no connection';
		}
		if ( $scope.IsRunning() )
		{
			return 'a run is going';
		}
		if ( kind !== 'session' && !$scope.Pick.Plan )
		{
			return 'pick the plan at hand';
		}
		if ( kind === 'build' && !$scope.Pick.Workspace )
		{
			return 'a build needs a workspace';
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
		let answer = await window.Desktop.Run( request( kind ) );
		if ( answer.Error )
		{
			$scope.Error = answer.Error;
		}
		else
		{
			DesktopItems.Running[ $scope.Llm.Id ] = answer.Run;
			await load_runs();
			await $scope.OpenRun( answer.Run );
		}
		$scope.Busy = false;
		$scope.$applyAsync();
	};


	$scope.Stop = async function ()
	{
		let running = $scope.Llm ? DesktopItems.Running[ $scope.Llm.Id ] : null;
		if ( running )
		{
			await window.Desktop.StopRun( running.Id );
		}
	};


	//-----------------------------------------------------------------
	// The log: a run opens in a popup, its output and prompt rendered as markdown, or as source.

	$scope.OpenRun = async function ( run )
	{
		let answer = await window.Desktop.ReadRun( run.Id );
		if ( answer.Run )
		{
			$scope.RunPopup = { Run: answer.Run, Source: false, Copied: null, Open: {} };
		}
		$scope.$applyAsync();
	};


	$scope.RefreshRun = async function ()
	{
		if ( $scope.RunPopup )
		{
			let answer = await window.Desktop.ReadRun( $scope.RunPopup.Run.Id );
			$scope.RunPopup.Run = answer.Run || $scope.RunPopup.Run;
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


	// A local model's run: its rounds and the tokens Ollama counted (Step 4); '' for a command's run.
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
} ] )


//---------------------------------------------------------------------
// WorkspaceController: the workspace page, and the files it includes as the form stands.

.controller( 'WorkspaceController', [ '$scope', '$timeout', 'State', 'DesktopItems', function ( $scope, $timeout, State, DesktopItems )
{
	const WALK_DELAY = 400;

	$scope.State = State;
	$scope.Items = DesktopItems;
	$scope.Workspace = null;
	$scope.Form = null;
	$scope.Project = null;
	$scope.Problems = [];
	$scope.Saved = false;
	$scope.Busy = false;
	$scope.Files = { Count: 0, Files: [], Truncated: false, Error: null, Busy: false };
	let walk_timer = null;


	function to_form( workspace )
	{
		return {
			Name: workspace.Name,
			Path: workspace.Path,
			IncludeText: ( workspace.Include || [] ).join( '\n' ),
			ExcludeText: ( workspace.Exclude || [] ).join( '\n' ),
			CommandsText: ( workspace.Commands || [] ).join( '\n' ),
		};
	}


	function lines( text )
	{
		return String( text || '' ).split( /\r?\n/ ).map( function ( line ) { return line.trim(); } ).filter( function ( line ) { return line; } );
	}


	function from_form( form )
	{
		return {
			Id: $scope.Workspace.Id,
			Project: $scope.Workspace.Project,
			Name: form.Name,
			Path: form.Path,
			Include: lines( form.IncludeText ),
			Exclude: lines( form.ExcludeText ),
			Commands: lines( form.CommandsText ),
		};
	}


	function load()
	{
		let open = State.OpenItem;
		if ( State.View !== 'workspace' || !open || open.Kind !== 'workspace' )
		{
			return;
		}
		let workspace = DesktopItems.WorkspaceById( open.Id );
		let changed = !$scope.Workspace || $scope.Workspace.Id !== open.Id;
		$scope.Workspace = workspace;
		$scope.Project = workspace ? ( State.Projects.find( function ( candidate ) { return candidate.Id === workspace.Project; } ) || null ) : null;
		if ( changed || ( workspace && !$scope.Form ) )
		{
			$scope.Form = workspace ? to_form( workspace ) : null;
			$scope.Problems = [];
			$scope.Saved = false;
		}
	}


	$scope.$watch( function () { return [ State.View, State.OpenItem ? State.OpenItem.Kind + '/' + State.OpenItem.Id : null, DesktopItems.Workspaces, State.Projects ]; }, load, true );


	// The files follow the form: walked again, a moment after the last change.
	async function walk()
	{
		if ( !$scope.Form || !DesktopItems.Available )
		{
			return;
		}
		$scope.Files.Busy = true;
		let answer = await window.Desktop.Files( { Path: $scope.Form.Path, Include: lines( $scope.Form.IncludeText ), Exclude: lines( $scope.Form.ExcludeText ) } );
		$scope.Files = { Count: answer.Count || 0, Files: answer.Files || [], Truncated: !!answer.Truncated, Error: answer.Error || null, Busy: false };
		$scope.$applyAsync();
	}


	$scope.$watch( function () { return $scope.Form ? [ $scope.Form.Path, $scope.Form.IncludeText, $scope.Form.ExcludeText ] : null; }, function ( form )
	{
		if ( walk_timer )
		{
			$timeout.cancel( walk_timer );
		}
		if ( form )
		{
			walk_timer = $timeout( walk, WALK_DELAY, false );
		}
	}, true );


	$scope.Dirty = function ()
	{
		return !!$scope.Workspace && !!$scope.Form && JSON.stringify( from_form( $scope.Form ) ) !== JSON.stringify( $scope.Workspace );
	};


	$scope.PickFolder = async function ()
	{
		let picked = await window.Desktop.PickFolder( $scope.Form.Path || undefined );
		if ( picked )
		{
			$scope.Form.Path = picked;
		}
		$scope.$applyAsync();
	};


	$scope.Save = async function ()
	{
		if ( !$scope.Workspace || !$scope.Form || $scope.Busy )
		{
			return;
		}
		$scope.Busy = true;
		$scope.Problems = [];
		$scope.Saved = false;
		let answer = await window.Desktop.SaveWorkspace( from_form( $scope.Form ) );
		if ( answer.Problems )
		{
			$scope.Problems = answer.Problems;
		}
		else
		{
			await DesktopItems.Reload();
			$scope.Workspace = DesktopItems.WorkspaceById( answer.Item.Id );
			$scope.Form = to_form( $scope.Workspace );
			$scope.Saved = true;
		}
		$scope.Busy = false;
		$scope.$applyAsync();
	};


	$scope.Discard = function ()
	{
		if ( $scope.Workspace )
		{
			$scope.Form = to_form( $scope.Workspace );
			$scope.Problems = [];
		}
	};
} ] );
