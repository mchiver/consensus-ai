'use strict';

// llm-session - the LLM page, for the connection the route names (plan UI Components, Step 2: moved as it was from
// llm.js's LlmController and index.html; the Llms factory stays in public/js/llm.js). The page's heading is its
// item head. The controller works on $scope, as it did, and the template reads it.
//
// Interface:
//   <llm-session></llm-session>
//   reads State.OpenItem (the connection), State.View; the runs, the connections and the tasks through Llms (plan LLM
//   Tasks, Step 1: one Run button per task the picked project enables, in the server's order; Step 2: a text box for
//   the tasks with a Box, its text kept per project in the browser and sent as the run's Text; Step 3: the Git row,
//   the project's GitSync and AutoCommit as two checkboxes when an enabled task writes files, saved on change; Step 4:
//   the Explain button opens the project's Explain tab, where the conversation is, instead of running)

angular.module( 'Consensus' ).component( 'llmSession', {
	templateUrl: '/components/llm-session/llm-session.html',
	controller: [ '$scope', '$window', 'State', 'Client', 'Llms', 'Roots', 'Toast', function ( $scope, $window, State, Client, Llms, Roots, Toast )
	{
		const OPEN_PROJECT_KEY = 'project';		// the sidebar's open project (stored.js, per server)
		const BOX_KEY = 'llm-box';				// the box's text, per project (stored.js, per server)

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
		$scope.Box = { Text: '' };	// the person's instructions for the tasks with a Box
		$scope.PickerOpen = false;
		$scope.Runs = [];
		$scope.Git = { Sync: false, AutoCommit: false, Busy: false };	// the project's Work options (Step 3)
		$scope.Error = null;
		$scope.Busy = false;
		$scope.Details = null;		// the Details popup: { Form, Problems, Checked, Busy }
		$scope.Packaging = null;	// the Packaging popup: { Form: { Prompts, Unchecked }, Lists, Preview, Problems, Busy, Copied }
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
			let project_changed = !$scope.Project || !project_by_id( $scope.Pick.Project ) || $scope.Project.Id !== $scope.Pick.Project;
			$scope.Project = project_by_id( $scope.Pick.Project );
			$scope.PlanRows = $scope.Project ? rows_of( $scope.Project.Items, 0, [] ) : [];
			if ( project_changed )
			{
				$scope.Box.Text = $scope.Project ? String( window.ConsensusStored.Read( BOX_KEY + ':' + $scope.Project.Id, '', root ) || '' ) : '';
			}
			if ( !$scope.Git.Busy )
			{
				$scope.Git.Sync = !!( $scope.Project && $scope.Project.GitSync );
				$scope.Git.AutoCommit = !!( $scope.Project && $scope.Project.AutoCommit );
			}
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
				if ( summary.Status !== 'running' && summary.Status !== 'queued' )
				{
					Roots.LoadList( current_root() );
					if ( current_root() === State.Root )
					{
						State.Reload();
					}
				}
			}
		} );


		// The owner keeps the connections and starts the runs (plan User Management, Step 2: every request is the owner).
		$scope.IsOwner = function ()
		{
			let me = current_root().Me;
			return !!me && me.Role === 'owner';
		};


		$scope.MayRun = function ()
		{
			return !!current_root().Me;
		};


		// The tasks the picked project enables, in the server's order; a project with no list enables them all.
		$scope.Tasks = function ()
		{
			return Llms.TasksOf( current_root(), $scope.Project );
		};


		// The tasks with a box, and their names for the box's label; the text is kept per project.
		$scope.BoxTasks = function ()
		{
			return $scope.Tasks().filter( function ( task ) { return task.Package && task.Package.Box; } );
		};


		$scope.BoxNames = function ()
		{
			return $scope.BoxTasks().map( function ( task ) { return task.Name; } ).join( ' and ' );
		};


		$scope.BoxChanged = function ()
		{
			if ( $scope.Project )
			{
				window.ConsensusStored.Write( BOX_KEY + ':' + $scope.Project.Id, $scope.Box.Text || '', current_root() );
			}
		};


		// The tasks that write files (the Work options apply to their runs, plan LLM Tasks, Step 3), and their names.
		$scope.FilesTasks = function ()
		{
			return $scope.Tasks().filter( function ( task ) { return task.Writes === 'files'; } );
		};


		$scope.FilesNames = function ()
		{
			return $scope.FilesTasks().map( function ( task ) { return task.Name; } ).join( ' and ' );
		};


		// A Work option changed: saved on the project at once; a refusal puts the checkbox back.
		$scope.GitChanged = async function ()
		{
			if ( !$scope.Project || $scope.Git.Busy )
			{
				return;
			}
			$scope.Git.Busy = true;
			$scope.Error = null;
			try
			{
				let answer = await Client.Put( current_root(), '/api/projects/' + encodeURIComponent( $scope.Project.Id ), { GitSync: !!$scope.Git.Sync, AutoCommit: !!$scope.Git.AutoCommit } );
				$scope.Project.GitSync = !!answer.Project.GitSync;
				$scope.Project.AutoCommit = !!answer.Project.AutoCommit;
			}
			catch ( error )
			{
				$scope.Error = error.message;
				$scope.Git.Sync = !!$scope.Project.GitSync;
				$scope.Git.AutoCommit = !!$scope.Project.AutoCommit;
			}
			$scope.Git.Busy = false;
			$scope.$applyAsync();
		};


		$scope.NeedsPlan = function ( task )
		{
			return Llms.NeedsPlan( task );
		};


		$scope.TaskTitle = function ( task )
		{
			let what = { none: 'reads only', consensus: 'may write to Consensus, not to files', files: 'may write to Consensus and to the project\'s files' };
			return task.Name + ': package it and run it once; ' + ( what[ task.Writes ] || task.Writes );
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
		// The Packaging popup: the lists of documents and threads (each checkable, the unchecked ids kept), the Session
		// Prompt, and a Preview of a task's package as the form stands.

		function packaging_form( llm )
		{
			return {
				Prompts: Object.assign( {}, llm.Prompts ),
				Unchecked: { Documents: ( llm.Unchecked.Documents || [] ).slice(), Threads: ( llm.Unchecked.Threads || [] ).slice() },
			};
		}


		function from_packaging( form )
		{
			return { Prompts: form.Prompts, Unchecked: form.Unchecked };
		}


		$scope.OpenPackaging = async function ()
		{
			if ( !$scope.Llm || !$scope.IsOwner() )
			{
				return;
			}
			let popup = { Form: packaging_form( $scope.Llm ), Lists: { Documents: [], Threads: [], Speaker: $scope.Llm.Speaker }, Preview: null, Problems: [], Busy: true, Copied: false };
			$scope.Packaging = popup;
			try
			{
				let query = '?Project=' + encodeURIComponent( $scope.Pick.Project || '' ) + '&Plan=' + encodeURIComponent( $scope.Pick.Plan || '' ) + '&Llm=' + encodeURIComponent( $scope.Llm.Id );
				let answer = await Client.Get( current_root(), '/api/runs/lists' + query );
				popup.Lists = { Documents: answer.Documents || [], Threads: answer.Threads || [], Speaker: answer.Speaker || $scope.Llm.Speaker };
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


		function request( task, overrides )
		{
			let made = { Llm: $scope.Llm.Id, Task: task.Id, Project: $scope.Pick.Project || null, Plan: $scope.Pick.Plan || null };
			if ( task.Package && task.Package.Box )
			{
				made.Text = $scope.Box.Text || '';
			}
			if ( overrides )
			{
				made.Overrides = overrides;
			}
			return made;
		}


		// Preview: a task's package for the project and plan picked in Run, with the form's prompt and unchecked ids.
		$scope.Preview = async function ( task )
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
				let answer = await Client.Post( current_root(), '/api/runs/package', request( task, from_packaging( popup.Form ) ) );
				popup.Preview = { Name: task.Name, Text: answer.Prompt };
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


		// Why a task's button is disabled, or '' when it can run: no server runs, no one signed in, a run going, no
		// project, no plan when the task packages one (plan LLM Tasks, Step 6: the rules are the Llms service's, shared
		// with the plan's heading).
		$scope.Reason = function ( task )
		{
			return Llms.Reason( current_root(), { Llm: $scope.Llm ? $scope.Llm.Id : null, Project: $scope.Pick.Project, Plan: $scope.Pick.Plan, Task: task } );
		};


		$scope.CanRun = function ( task )
		{
			return !$scope.Busy && $scope.Reason( task ) === '';
		};


		// The reasons shown beside the buttons: one line per button that cannot run, the same reason named once.
		$scope.Reasons = function ()
		{
			let seen = [];
			for ( let task of $scope.Tasks() )
			{
				let reason = $scope.Reason( task );
				if ( reason && !seen.includes( reason ) )
				{
					seen.push( reason );
				}
			}
			return seen.join( '; ' );
		};


		$scope.Run = async function ( task )
		{
			if ( !$scope.CanRun( task ) )
			{
				return;
			}
			if ( task.Id === 'explain' )
			{
				$window.location.hash = Roots.HashFor( current_root(), '/x/' + encodeURIComponent( $scope.Pick.Project ) );
				return;
			}
			$scope.Busy = true;
			$scope.Error = null;
			try
			{
				let answer = await Client.Post( current_root(), '/api/runs', request( task ) );
				if ( answer.Run.Status === 'queued' )
				{
					Toast.Show( task.Name + ' queued on ' + $scope.Llm.Name + Llms.BehindWords( answer.Run ) );
				}
				else
				{
					items().Running[ $scope.Llm.Id ] = answer.Run;
				}
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


		$scope.BehindWords = Llms.BehindWords;


		// A queued run taken out of the line from its popup (plan Multiuser, Step 3).
		$scope.StopRun = async function ( run )
		{
			try
			{
				await Client.Post( current_root(), '/api/runs/' + encodeURIComponent( run.Id ) + '/stop' );
				await load_runs();
				await $scope.RefreshRun();
			}
			catch ( error )
			{
				$scope.Error = error.message;
			}
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
			if ( run.Status === 'queued' )
			{
				return 'queued since ' + new Date( run.Queued ).toLocaleTimeString( [], { hour: '2-digit', minute: '2-digit' } );
			}
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
	} ],
} );
