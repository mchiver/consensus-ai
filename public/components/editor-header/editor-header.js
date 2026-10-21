'use strict';

// editor-header - the open item's heading (plan UI Components, Step 2), three lines. The first: the title (with
// its server when the page shows several) and the views: Read / Edit / Revisions in Monaco mode; in CodeMirror mode
// (plan Markdown Editor, Step 3) Source and Revisions, with Save and Discard, since the editor is the one view there. The second: the location, server / project
// / folders / parent plans / the item, the project and folder crumbs revealing their node in the tree, a parent
// plan's opening it. The third: the state picker and the one-line state, the revision and the text's size, then
// the plan-tasks (plan LLM Tasks, Step 6: one button per enabled task that packages the plan, run through the project's
// chosen connection, a task with a Box asking in a popup), then one Actions menu (plan UI Tweaks IX; three buttons
// before) holding New Comment, Report (plan Printing and Reporting: the report page in a new tab, Ctrl+P) and New
// subplan, each disabled with its rule. Delete is in the item's menu in the tree. Ctrl+E (hotkeys.js) switches between
// Edit and Read.
//
// Interface:
//   <editor-header></editor-header>
//   reads State.Open, State.View, State.Root, State.Projects, State.Editor, State.Source, State.Editing; sets the
//   view, the Source mode and the state through State, saves and discards through State.Editing; sends
//   reveal-node { Root, Project, Id } for the tree

angular.module( 'Consensus' ).component( 'editorHeader', {
	templateUrl: '/components/editor-header/editor-header.html',
	controller: [ '$scope', '$rootScope', 'State', 'Client', 'Subplans', 'Roots', 'Reports', 'Llms', 'Toast', 'Menus', 'Threads', function ( $scope, $rootScope, State, Client, Subplans, Roots, Reports, Llms, Toast, Menus, Threads )
	{
		let controller = this;
		controller.State = State;
		controller.Busy = false;
		controller.PickedState = null;
		let crumbs = { Key: null, List: [] };


		// The open item's server, named beside the title when the page shows several (plan Run Shapes, Step 5).
		controller.RootName = function ()
		{
			return ( Roots.Several() && State.Root ) ? State.Root.Name : '';
		};


		controller.SetView = function ( view )
		{
			State.SetView( view );
		};


		// CodeMirror mode: the editor is the one view; Source and Revisions, Save and Discard in the heading.
		controller.CodeMirror = function ()
		{
			return State.Editor === 'codemirror';
		};


		// Source on or off; from Revisions it also brings the editor back.
		controller.ToggleSource = function ()
		{
			State.SetSource( !State.Source );
			if ( State.View === 'revisions' )
			{
				State.SetView( 'read' );
			}
		};


		// Revisions beside the editor: pressed again, the editor comes back.
		controller.ToggleRevisions = function ()
		{
			State.SetView( State.View === 'revisions' ? 'read' : 'revisions' );
		};


		controller.CanSave = function ()
		{
			let editing = State.Editing;
			return !!editing && editing.Dirty && !editing.Stale && !editing.Busy && !controller.IsArchived() && State.MirrorShown();
		};


		controller.Save = function ()
		{
			if ( controller.CanSave() )
			{
				State.Editing.Save();
			}
		};


		// A plan has threads; a document has none.
		controller.HasThreads = function ()
		{
			return !!State.Open && State.Open.Plan.Kind !== 'document';
		};


		// A plan (not a document) takes Subplans.
		controller.IsPlan = function ()
		{
			return !!State.Open && ( State.Open.Plan.Kind || 'plan' ) === 'plan';
		};


		controller.NewSubplan = function ()
		{
			Subplans.Start();
		};


		// The report of the open plan (plan Printing and Reporting), in a new tab or window.
		controller.OpenReport = function ()
		{
			Reports.Open( State.Root, State.OpenId );
		};


		// The open document is its project's Readme.
		controller.IsContext = function ()
		{
			return !!State.Open && !!State.Open.Context;
		};


		controller.CommentOnWhole = function ()
		{
			State.StartCompose( null );
		};


		// An archived plan (plan Run Shapes, Step 2) is read and never written until it is restored from the tree.
		controller.IsArchived = function ()
		{
			return !!( State.Open && State.Open.Plan && State.Open.Plan.Archived );
		};


		//-------------------------------------------------------------
		// The Actions menu (plan UI Tweaks IX): New Comment, Report and New subplan, through the page's menu.

		function can_comment()
		{
			return ( State.View === 'read' || State.MirrorShown() ) && controller.HasThreads() && !controller.IsArchived();
		}


		// Shown on a plan (the three) or a document with threads (New Comment).
		controller.HasActions = function ()
		{
			return controller.IsPlan() || controller.HasThreads();
		};


		controller.OpenActions = function ( event )
		{
			let items = [
				{ Label: 'New Comment', Icon: 'comment', Disabled: !can_comment(), Act: controller.CommentOnWhole },
				{ Label: 'Report', Icon: 'eye', Disabled: !controller.IsPlan(), Act: controller.OpenReport },
				{ Label: 'New subplan', Icon: 'subplan', Disabled: !controller.IsPlan() || controller.IsArchived(), Act: controller.NewSubplan },
			];
			Menus.Show( items, event, 'header-actions' );
		};


		//-------------------------------------------------------------
		// The plan-tasks (plan LLM Tasks, Step 6): the enabled tasks that package the plan, run through the connection the
		// project chose in its settings. The rules are the Llms service's, the same the LLM page asks.

		const BOX_KEY = 'llm-box';		// the box's text, per project, the LLM page's (stored.js, per server)
		const NO_LLM = 'choose the project\'s LLM connection in its settings';
		controller.BoxPopup = null;		// { Task, Llm, Text }
		controller.Starting = false;
		controller.TaskError = '';


		function open_project()
		{
			if ( !State.Open || !State.Open.Project )
			{
				return null;
			}
			return State.Projects.find( function ( candidate ) { return candidate.Id === State.Open.Project.Id; } ) || null;
		}


		controller.PlanTasks = function ()
		{
			return Llms.TasksOf( State.Root, open_project() ).filter( function ( task ) { return !!task.Package && !!task.Package.Plan; } );
		};


		// Shown on a plan that is not archived, when the server runs LLMs and has a connection.
		controller.ShowTasks = function ()
		{
			let items = Llms.For( State.Root );
			return controller.IsPlan() && !controller.IsArchived() && items.Available && items.Llms.length > 0;
		};


		controller.ProjectLlm = function ()
		{
			return Llms.ProjectLlm( State.Root, open_project() );
		};


		controller.TaskReason = function ( task )
		{
			if ( controller.Starting )
			{
				return 'starting';
			}
			let llm = controller.ProjectLlm();
			let project = open_project();
			return Llms.Reason( State.Root, { Llm: llm ? llm.Id : null, NoLlm: NO_LLM, Project: project ? project.Id : null, Plan: State.OpenId, Task: task } );
		};


		controller.TaskTitle = function ( task )
		{
			let reason = controller.TaskReason( task );
			if ( reason )
			{
				return reason;
			}
			let what = { none: 'reads only', consensus: 'may write to Consensus, not to files', files: 'may write to Consensus and to the project\'s files' };
			return task.Name + ' on ' + controller.ProjectLlm().Name + ': package this plan and run it once; ' + ( what[ task.Writes ] || task.Writes );
		};


		// A press: a task with a Box asks first; the others run at once.
		controller.RunTask = function ( task )
		{
			if ( controller.TaskReason( task ) )
			{
				return;
			}
			let project = open_project();
			if ( task.Package && task.Package.Box )
			{
				let text = String( window.ConsensusStored.Read( BOX_KEY + ':' + project.Id, '', State.Root ) || '' );
				controller.BoxPopup = { Task: task, Llm: controller.ProjectLlm(), Text: text };
				return;
			}
			start( task, controller.ProjectLlm(), project, null );
		};


		controller.RunBox = function ()
		{
			let popup = controller.BoxPopup;
			let project = open_project();
			if ( !popup || !project || controller.Starting )
			{
				return;
			}
			window.ConsensusStored.Write( BOX_KEY + ':' + project.Id, popup.Text || '', State.Root );
			controller.BoxPopup = null;
			start( popup.Task, popup.Llm, project, popup.Text || '' );
		};


		controller.BoxKey = function ( event )
		{
			if ( event.key === 'Escape' )
			{
				controller.BoxPopup = null;
			}
			else if ( event.key === 'Enter' && ( event.ctrlKey || event.metaKey ) )
			{
				event.preventDefault();
				controller.RunBox();
			}
		};


		// The run starts on the project's connection with the open plan; the toast says so, and the running mark
		// disables the buttons until the events say it ended. A refusal is shown beside the buttons until the next press.
		async function start( task, llm, project, text )
		{
			controller.Starting = true;
			controller.TaskError = '';
			let body = { Llm: llm.Id, Task: task.Id, Project: project.Id, Plan: State.OpenId };
			if ( text !== null )
			{
				body.Text = text;
			}
			try
			{
				let answer = await Client.Post( State.Root, '/api/runs', body );
				if ( answer.Run.Status === 'queued' )
				{
					// a run on this plan or this connection is on: the press waits its turn (plan Multiuser, Step 3)
					Toast.Show( task.Name + ' queued on ' + llm.Name + Llms.BehindWords( answer.Run ) );
				}
				else
				{
					Llms.For( State.Root ).Running[ llm.Id ] = answer.Run;
					Toast.Show( task.Name + ' started on ' + llm.Name );
				}
			}
			catch ( error )
			{
				controller.TaskError = task.Name + ' refused: ' + error.message;
			}
			controller.Starting = false;
			$scope.$applyAsync();
		}


		// A run on the project's connection ended: the toast says so (the plan itself reloads over the events, as any
		// change does); a failure is read from the run for its first line.
		$scope.$on( 'runs-changed', async function ( event, summary )
		{
			let llm = controller.ProjectLlm();
			if ( !llm || !summary.Llm || summary.Llm.Id !== llm.Id || !State.Root || summary.Root !== State.Root.Key || summary.Status === 'running' || summary.Status === 'queued' )
			{
				return;
			}
			if ( summary.Status === 'failed' )
			{
				let words = '';
				try
				{
					let run = ( await Client.Get( State.Root, '/api/runs/' + encodeURIComponent( summary.Id ) ) ).Run;
					words = String( run.Error || '' ).split( '\n' )[ 0 ];
				}
				catch ( error )
				{
					words = '';
				}
				Toast.Show( 'the run on ' + llm.Name + ' failed' + ( words ? ': ' + words : '' ) );
				return;
			}
			Toast.Show( 'the run on ' + llm.Name + ( summary.Status === 'stopped' ? ' was stopped' : ' ended' ) );
		} );


		//-------------------------------------------------------------
		// The location: the way down the project's tree to the item, found again when the item or the lists change.

		function path_to( items, id, trail )
		{
			for ( let node of items || [] )
			{
				if ( node.Id === id )
				{
					return trail.concat( [ node ] );
				}
				if ( node.Items && node.Items.length )
				{
					let found = path_to( node.Items, id, trail.concat( [ node ] ) );
					if ( found )
					{
						return found;
					}
				}
			}
			return null;
		}


		function build_crumbs()
		{
			let list = [];
			if ( !State.Open || !State.Open.Project )
			{
				return list;
			}
			let project = State.Projects.find( function ( candidate ) { return candidate.Id === State.Open.Project.Id; } );
			if ( !project )
			{
				return list;
			}
			if ( Roots.Several() && State.Root )
			{
				list.push( { Kind: 'server', Label: State.Root.Name } );
			}
			list.push( { Kind: 'project', Label: project.Name, Project: project.Id, Id: project.Id } );
			let path = path_to( project.Items, State.OpenId, [] ) || [];
			for ( let node of path )
			{
				if ( node.Id === State.OpenId )
				{
					list.push( { Kind: 'item', Label: node.Title || node.Name } );
				}
				else if ( node.Kind === 'folder' )
				{
					list.push( { Kind: 'folder', Label: node.Name, Project: project.Id, Id: node.Id } );
				}
				else
				{
					list.push( { Kind: 'plan', Label: node.Title, Id: node.Id, Hash: Roots.HashFor( State.Root, '/p/' + node.Id ) } );
				}
			}
			return list;
		}


		controller.Crumbs = function ()
		{
			let key = [ State.OpenId, State.Open ? State.Open.Plan.Title : '', State.Projects, Roots.Several() ];
			let same = crumbs.Key && key.every( function ( part, index ) { return part === crumbs.Key[ index ]; } );
			if ( !same )
			{
				crumbs = { Key: key, List: build_crumbs() };
			}
			return crumbs.List;
		};


		// A project or folder crumb: the tree shows its node.
		controller.Reveal = function ( crumb )
		{
			$rootScope.$broadcast( 'reveal-node', { Root: State.Root, Project: crumb.Project, Id: crumb.Id } );
		};


		//-------------------------------------------------------------
		// The size of the text as saved: its characters, and about a quarter as many tokens.

		controller.Size = function ()
		{
			if ( !State.Open )
			{
				return '';
			}
			let characters = ( State.Open.Text || '' ).length;
			let tokens = Math.round( characters / 4 );
			return characters.toLocaleString() + ' chars, about ' + tokens.toLocaleString() + ' tokens';
		};


		//-------------------------------------------------------------
		// The state picker: any of the settings' States, by an Owner (plan Multiuser, Step 2; by anyone before), at any time.

		controller.CanSetState = function ()
		{
			return Threads.CanSetState();
		};


		$scope.$watch( function () { return State.Open ? State.Open.Plan.State : null; }, function ( current )
		{
			controller.PickedState = current;
		} );


		// The project's States (the settings' when it has none; plan Run Shapes, Step 2), plus the plan's own when
		// the list no longer names it.
		controller.StateOptions = function ()
		{
			let states = State.States;
			let project = ( State.Open && State.Open.Project ) ? State.Projects.find( function ( candidate ) { return candidate.Id === State.Open.Project.Id; } ) : null;
			if ( project && Array.isArray( project.States ) && project.States.length )
			{
				states = project.States;
			}
			if ( !State.Open || states.includes( State.Open.Plan.State ) )
			{
				return states;
			}
			return states.concat( [ State.Open.Plan.State ] );
		};


		controller.SetState = async function ()
		{
			let wanted = controller.PickedState;
			if ( !State.Open || wanted === State.Open.Plan.State )
			{
				return;
			}
			controller.Busy = true;
			let answer = await State.Act( function ()
			{
				return Client.Put( '/api/plans/' + encodeURIComponent( State.OpenId ) + '/state', { State: wanted } );
			} );
			controller.Busy = false;
			if ( answer )
			{
				await State.Reload();
				State.LoadList();
			}
			else
			{
				controller.PickedState = State.Open ? State.Open.Plan.State : null;
			}
			$scope.$applyAsync();
		};
	} ],
} );
