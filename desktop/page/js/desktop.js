'use strict';

// Desktop - the LLM connections and the workspaces (plan Consensus Desktop, Step 3): the desktop's own items,
// read through window.Desktop (preload.js) and shown in every project's Context folder by the sidebar. Each opens
// in a tab of its own: the LLM page (its details, the packaging checks, the prompts, the Review, Build and Session
// buttons, and its log of runs) and the workspace page (its details). In a browser, without the desktop, there are
// no items and nothing here shows.
//
//   DesktopItems  { Available, Loaded, Llms, Workspaces, Running, Reload(), LlmById( id ), WorkspaceById( id ), WorkspacesOf( project id ) }
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
// LlmController: the LLM page, for the connection and the project the route names.

.controller( 'LlmController', [ '$scope', '$window', 'State', 'DesktopItems', function ( $scope, $window, State, DesktopItems )
{
	const KINDS = [ 'claude-cli', 'ollama' ];
	const CHECKS = [
		{ Key: 'Instructions', Label: 'Agent Instructions', Hint: 'the connected server\'s /instructions page: the guide, with the server\'s address and token first' },
		{ Key: 'Readme', Label: 'Readme', Hint: 'the project\'s Readme, whole' },
		{ Key: 'Documents', Label: 'List of other Context documents', Hint: 'their titles and ids, for the model to read through the API' },
		{ Key: 'Threads', Label: 'List of "waiting on llm" threads', Hint: 'the threads of the plan at hand waiting on the llm participant, each with its anchor and replies' },
	];

	$scope.State = State;
	$scope.Items = DesktopItems;
	$scope.Kinds = KINDS;
	$scope.Checks = CHECKS;
	$scope.Llm = null;			// the saved one
	$scope.Form = null;			// the form's copy
	$scope.Project = null;
	$scope.Plans = [];
	$scope.Workspaces = [];
	$scope.Pick = { Plan: null, Workspace: null };
	$scope.Runs = [];
	$scope.Shown = null;		// a run opened from the log, whole
	$scope.Prompt = null;		// Show prompt's package
	$scope.Checked = null;
	$scope.Problems = [];
	$scope.Error = null;
	$scope.Saved = false;
	$scope.Copied = false;
	$scope.Busy = false;


	function to_form( llm )
	{
		return {
			Name: llm.Name,
			Kind: llm.Kind,
			Command: llm.Command,
			ArgumentsText: ( llm.Arguments || [] ).join( '\n' ),
			Url: llm.Url,
			Model: llm.Model,
			Timeout: llm.Timeout,
			Checks: Object.assign( {}, llm.Checks ),
			Prompts: Object.assign( {}, llm.Prompts ),
		};
	}


	function from_form( form )
	{
		return {
			Id: $scope.Llm.Id,
			Name: form.Name,
			Kind: form.Kind,
			Command: form.Command,
			Arguments: String( form.ArgumentsText || '' ).split( /\r?\n/ ).map( function ( line ) { return line.trim(); } ).filter( function ( line ) { return line; } ),
			Url: form.Url,
			Model: form.Model,
			Timeout: form.Timeout,
			Checks: form.Checks,
			Prompts: form.Prompts,
		};
	}


	// The project's plans, top down, with their depth.
	function plans_of( items, depth, into )
	{
		for ( let node of items || [] )
		{
			if ( node.Kind === 'folder' )
			{
				plans_of( node.Items, depth + 1, into );
				continue;
			}
			if ( node.Kind !== 'document' && !node.Missing )
			{
				into.push( { Id: node.Id, Title: node.Title, State: node.State, Depth: depth } );
				plans_of( node.Items, depth + 1, into );
			}
		}
		return into;
	}


	// The page follows the route: the connection and the project it was opened from.
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
		$scope.Plans = project ? plans_of( project.Items, 0, [] ) : [];
		$scope.Workspaces = project ? DesktopItems.WorkspacesOf( project.Id ) : [];
		if ( changed )
		{
			$scope.Form = llm ? to_form( llm ) : null;
			$scope.Shown = null;
			$scope.Prompt = null;
			$scope.Checked = null;
			$scope.Problems = [];
			$scope.Error = null;
			$scope.Saved = false;
			$scope.Pick = { Plan: null, Workspace: null };
			load_runs();
		}
		else if ( llm && !$scope.Form )
		{
			$scope.Form = to_form( llm );
		}
		// the plan at hand: the one picked, else the plan last opened in this project
		if ( !$scope.Plans.some( function ( plan ) { return plan.Id === $scope.Pick.Plan; } ) )
		{
			let last = State.LastPlan ? State.LastPlan[ open.Project ] : null;
			$scope.Pick.Plan = $scope.Plans.some( function ( plan ) { return plan.Id === last; } ) ? last : ( $scope.Plans.length ? $scope.Plans[ 0 ].Id : null );
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
		$scope.Runs = answer.Runs || [];
		if ( $scope.Shown )
		{
			let fresh = await window.Desktop.ReadRun( $scope.Shown.Id );
			$scope.Shown = fresh.Run || null;
		}
		$scope.$applyAsync();
	}


	$scope.$watch( function () { return [ State.View, State.OpenItem ? State.OpenItem.Kind + '/' + State.OpenItem.Project + '/' + State.OpenItem.Id : null, DesktopItems.Llms, DesktopItems.Workspaces, State.Projects ]; }, load, true );


	// A run started or ended: the log and the tree follow.
	$scope.$on( 'runs-changed', function ( event, summary )
	{
		if ( $scope.Llm && summary.Llm && summary.Llm.Id === $scope.Llm.Id )
		{
			load_runs();
			if ( summary.Status !== 'running' )
			{
				State.LoadList();
				State.Reload();
			}
		}
	} );


	//-----------------------------------------------------------------
	// The details and the prompts

	$scope.Dirty = function ()
	{
		return !!$scope.Llm && !!$scope.Form && JSON.stringify( from_form( $scope.Form ) ) !== JSON.stringify( Object.assign( {}, $scope.Llm, { Id: $scope.Llm.Id } ) );
	};


	$scope.Save = async function ()
	{
		if ( !$scope.Llm || !$scope.Form || $scope.Busy )
		{
			return;
		}
		$scope.Busy = true;
		$scope.Problems = [];
		$scope.Saved = false;
		let answer = await window.Desktop.SaveLlm( from_form( $scope.Form ) );
		if ( answer.Problems )
		{
			$scope.Problems = answer.Problems;
		}
		else
		{
			await DesktopItems.Reload();
			$scope.Llm = DesktopItems.LlmById( answer.Item.Id );
			$scope.Form = to_form( $scope.Llm );
			$scope.Saved = true;
		}
		$scope.Busy = false;
		$scope.$applyAsync();
	};


	$scope.Discard = function ()
	{
		if ( $scope.Llm )
		{
			$scope.Form = to_form( $scope.Llm );
			$scope.Problems = [];
		}
	};


	$scope.ResetPrompt = function ( name )
	{
		if ( $scope.Form )
		{
			$scope.Form.Prompts[ name ] = ( DesktopItems.DefaultPrompts || {} )[ name ] || '';
		}
	};


	// Check: the saved connection answers (the form is saved first when it changed).
	$scope.Check = async function ()
	{
		if ( !$scope.Llm || $scope.Busy )
		{
			return;
		}
		if ( $scope.Dirty() )
		{
			await $scope.Save();
			if ( $scope.Problems.length )
			{
				return;
			}
		}
		$scope.Busy = true;
		$scope.Checked = null;
		$scope.Checked = await window.Desktop.CheckLlm( $scope.Llm.Id );
		$scope.Busy = false;
		$scope.$applyAsync();
	};


	//-----------------------------------------------------------------
	// The buttons: Show prompt, Review, Build, Session; the log

	function request( kind )
	{
		return { LlmId: $scope.Llm.Id, Kind: kind, ProjectId: $scope.Project ? $scope.Project.Id : null, PlanId: $scope.Pick.Plan || null, WorkspaceId: $scope.Pick.Workspace || null };
	}


	$scope.IsRunning = function ()
	{
		return !!$scope.Llm && !!DesktopItems.Running[ $scope.Llm.Id ];
	};


	$scope.CanRun = function ( kind )
	{
		if ( !$scope.Llm || $scope.Busy || $scope.IsRunning() || $scope.Dirty() || $scope.Llm.Kind !== 'claude-cli' )
		{
			return false;
		}
		if ( kind === 'build' )
		{
			return !!$scope.Pick.Plan && !!$scope.Pick.Workspace;
		}
		if ( kind === 'review' )
		{
			return !!$scope.Pick.Plan;
		}
		return true;
	};


	$scope.RunTitle = function ( kind )
	{
		if ( $scope.Llm && $scope.Llm.Kind === 'ollama' )
		{
			return 'an ollama one-shot is Step 4';
		}
		if ( $scope.Dirty() )
		{
			return 'save the details first';
		}
		if ( kind === 'build' && !$scope.Pick.Workspace )
		{
			return 'a build needs a workspace';
		}
		if ( kind !== 'session' && !$scope.Pick.Plan )
		{
			return 'pick the plan at hand';
		}
		return 'package the ' + kind + ' prompt and run it once';
	};


	$scope.ShowPrompt = async function ( kind )
	{
		if ( !$scope.Llm || $scope.Busy )
		{
			return;
		}
		$scope.Busy = true;
		$scope.Error = null;
		$scope.Copied = false;
		let answer = await window.Desktop.Package( request( kind ) );
		if ( answer.Error )
		{
			$scope.Error = answer.Error;
			$scope.Prompt = null;
		}
		else
		{
			$scope.Prompt = { Kind: kind, Text: answer.Prompt };
			$scope.Shown = null;
		}
		$scope.Busy = false;
		$scope.$applyAsync();
	};


	$scope.Copy = function ( text )
	{
		if ( text && navigator.clipboard )
		{
			navigator.clipboard.writeText( text ).then( function ()
			{
				$scope.Copied = true;
				$scope.$applyAsync();
			} ).catch( function () {} );
		}
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
			$scope.Prompt = null;
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


	$scope.OpenRun = async function ( run )
	{
		if ( $scope.Shown && $scope.Shown.Id === run.Id )
		{
			$scope.Shown = null;
			$scope.$applyAsync();
			return;
		}
		let answer = await window.Desktop.ReadRun( run.Id );
		$scope.Shown = answer.Run || null;
		$scope.Prompt = null;
		$scope.$applyAsync();
	};


	$scope.RefreshShown = async function ()
	{
		if ( $scope.Shown )
		{
			let answer = await window.Desktop.ReadRun( $scope.Shown.Id );
			$scope.Shown = answer.Run || null;
			$scope.$applyAsync();
		}
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
// WorkspaceController: the workspace page.

.controller( 'WorkspaceController', [ '$scope', 'State', 'DesktopItems', function ( $scope, State, DesktopItems )
{
	$scope.State = State;
	$scope.Items = DesktopItems;
	$scope.Workspace = null;
	$scope.Form = null;
	$scope.Project = null;
	$scope.Problems = [];
	$scope.Saved = false;
	$scope.Busy = false;


	function to_form( workspace )
	{
		return {
			Name: workspace.Name,
			Path: workspace.Path,
			IncludeText: ( workspace.Include || [] ).join( '\n' ),
			ExcludeText: ( workspace.Exclude || [] ).join( '\n' ),
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
