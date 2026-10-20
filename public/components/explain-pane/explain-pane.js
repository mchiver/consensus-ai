'use strict';

// explain-pane - the conversation with a project (plan LLM Tasks, Step 4: Explain): the person's Explain runs of the
// project, oldest first, each a question and its answer (the run's Text and Output, rendered as markdown), the
// question box at the bottom with Ask (Ctrl+Enter), the project's chosen connection (plan LLM Tasks, Step 6: project.json's
// Llm, picked in the project's settings; none chosen, Ask waits and says so), and Clear. An answer is a run of the Explain task, Writes none: it reads the project through the API or the tools and
// posts nothing, the answer being its output. The exchange follows the runs over the events.
//
// Interface:
//   <explain-pane></explain-pane>
//   reads State.OpenItem ({ Kind: 'x', Id: the project's id, Root }) and State.View ('x'); the connections and the
//   tasks through Llms; the runs over /api/runs?Project=&Task=explain&By=; listens to view-changed and runs-changed
//   route #/x/<project id>, under #/s/<root> for a named root

angular.module( 'Consensus' ).component( 'explainPane', {
	templateUrl: '/components/explain-pane/explain-pane.html',
	controller: [ '$scope', 'State', 'Client', 'Llms', 'Roots', function ( $scope, State, Client, Llms, Roots )
	{
		const TASK = 'explain';

		let controller = this;
		controller.State = State;
		controller.Root = null;			// the project's server (roots.js)
		controller.Project = null;
		controller.Items = [];			// { Id, Question, Answer, Status, Error, Started, By, Llm }
		controller.Loaded = false;
		controller.Question = '';
		controller.Busy = false;
		controller.Clearing = false;
		controller.Error = null;


		function current()
		{
			let open = State.OpenItem;
			if ( State.View !== 'x' || !open || open.Kind !== 'x' )
			{
				return null;
			}
			let root = Roots.Of( open.Root ) || State.Root;
			let project = root ? ( root.Projects.find( function ( candidate ) { return candidate.Id === open.Id; } ) || null ) : null;
			return project ? { Root: root, Project: project } : null;
		}


		async function load()
		{
			let where = current();
			if ( !where )
			{
				return;
			}
			let changed = !controller.Project || controller.Project.Id !== where.Project.Id || controller.Root !== where.Root;
			controller.Root = where.Root;
			controller.Project = where.Project;
			if ( changed )
			{
				controller.Items = [];
				controller.Loaded = false;
				controller.Error = null;
				controller.Clearing = false;
			}
			await load_runs();
		}


		// The person's Explain runs of the project, oldest first, each read whole for its answer.
		async function load_runs()
		{
			let root = controller.Root;
			let project = controller.Project;
			if ( !root || !project )
			{
				return;
			}
			try
			{
				let me = root.Me ? root.Me.Name : null;
				let query = '/api/runs?Project=' + encodeURIComponent( project.Id ) + '&Task=' + TASK + ( me ? '&By=' + encodeURIComponent( me ) : '' );
				let summaries = ( await Client.Get( root, query ) ).Runs || [];
				summaries.reverse();
				let records = await Promise.all( summaries.map( function ( summary )
				{
					return Client.Get( root, '/api/runs/' + encodeURIComponent( summary.Id ) ).then( function ( answer ) { return answer.Run; } );
				} ) );
				if ( controller.Project !== project )
				{
					return;
				}
				controller.Items = records.map( function ( run )
				{
					return { Id: run.Id, Question: run.Text || '', Answer: run.Output || '', Status: run.Status, Error: run.Error, Started: run.Started, By: run.By, Llm: run.Llm };
				} );
				controller.Loaded = true;
			}
			catch ( error )
			{
				controller.Error = error.message;
			}
			$scope.$applyAsync();
		}


		controller.Llms = function ()
		{
			return controller.Root ? Llms.For( controller.Root ).Llms : [];
		};


		// The project's chosen connection, read from the server's list each time: the settings may change it while the tab is open.
		controller.ProjectLlm = function ()
		{
			if ( !controller.Root || !controller.Project )
			{
				return null;
			}
			let project = controller.Root.Projects.find( function ( candidate ) { return candidate.Id === controller.Project.Id; } ) || controller.Project;
			return Llms.ProjectLlm( controller.Root, project );
		};


		controller.LlmName = function ()
		{
			let llm = controller.ProjectLlm();
			return llm ? llm.Name : '';
		};


		// Explain is enabled in the project when the server has it and the project's list, if any, names it.
		controller.Enabled = function ()
		{
			if ( !controller.Root || !controller.Project )
			{
				return false;
			}
			let shipped = Llms.For( controller.Root ).Tasks.some( function ( task ) { return task.Id === TASK; } );
			let enabled = controller.Project.Tasks;
			return shipped && ( !Array.isArray( enabled ) || enabled.includes( TASK ) );
		};


		controller.Answering = function ()
		{
			return controller.Items.some( function ( item ) { return item.Status === 'running'; } );
		};


		controller.CanAsk = function ()
		{
			return !!controller.ProjectLlm() && !!controller.Question.trim() && !controller.Busy && controller.Enabled() && !controller.Answering();
		};


		controller.Ask = async function ()
		{
			if ( !controller.CanAsk() )
			{
				return;
			}
			controller.Busy = true;
			controller.Error = null;
			let question = controller.Question.trim();
			try
			{
				let answer = await Client.Post( controller.Root, '/api/runs', { Llm: controller.ProjectLlm().Id, Task: TASK, Project: controller.Project.Id, Text: question } );
				controller.Question = '';
				controller.Items.push( { Id: answer.Run.Id, Question: question, Answer: '', Status: 'running', Error: null, Started: answer.Run.Started, By: answer.Run.By, Llm: answer.Run.Llm } );
			}
			catch ( error )
			{
				controller.Error = error.message;
			}
			controller.Busy = false;
			$scope.$applyAsync();
		};


		controller.Key = function ( event )
		{
			if ( event.key === 'Enter' && ( event.ctrlKey || event.metaKey ) )
			{
				event.preventDefault();
				controller.Ask();
			}
		};


		controller.StartClear = function ()
		{
			controller.Clearing = true;
		};


		// Clear: every run of the conversation deleted, but one still running.
		controller.ConfirmClear = async function ()
		{
			controller.Clearing = false;
			controller.Error = null;
			for ( let item of controller.Items.slice() )
			{
				if ( item.Status === 'running' )
				{
					continue;
				}
				try
				{
					await Client.Delete( controller.Root, '/api/runs/' + encodeURIComponent( item.Id ) );
				}
				catch ( error )
				{
					controller.Error = error.message;
				}
			}
			await load_runs();
		};


		$scope.$watch( function () { let open = State.OpenItem; return ( State.View === 'x' && open && open.Kind === 'x' ) ? open.Root + '|' + open.Id : null; }, function ( key )
		{
			if ( key )
			{
				load();
			}
		} );
		$scope.$on( 'runs-changed', function ( event, summary )
		{
			if ( controller.Root && summary.Root === controller.Root.Key && State.View === 'x' )
			{
				load_runs();
			}
		} );
		$scope.$on( 'changed', function ( event, change, root )
		{
			if ( controller.Root && root === controller.Root && change.Kind === 'llms' )
			{
				load();
			}
		} );
	} ],
} );
