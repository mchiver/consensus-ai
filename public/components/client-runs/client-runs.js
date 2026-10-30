'use strict';

// client-runs - the Desktop's runs (plan Client Edition, Step 3, as the Client's; the Desktop's since plan Review
// 2026-10-29, Step 5.1, the editions cut, the component keeping its name): what a person sees of the tasks they press, every
// run being the Server's. My runs, shown beside the waiting list: the person's own runs on every Server (GET
// /api/runs?By=<their name>), newest first, each with its task, plan, Server, state and time. A run's popup: its state,
// its Output (an ollama run's Output is its transcript rendered) growing as it comes in, read again on every event of
// the run and every two seconds while it is queued or running, with Stop for the person who pressed. When a run the
// person pressed in this window ends, a short notice links to it. Nothing here changes on the Server: it reads the
// records and events it already has. The run's Prompt is not shown in the Desktop.
//
// Interface:
//   <client-runs></client-runs>                 My runs (in the waiting view), the run's popup and the notices
//   ClientRuns { Available, Mine( root ), Latest( root, plan id, task id ), Pressed( root, run ), Open( root, run ),
//                Close(), Stop(), Reload( root ), Popup, Notices, Dismiss( notice ), Words( run ), Duration( run ) }
//   hears runs-changed (Llms.RunChanged) and changed; reads Roots.List

angular.module( 'Consensus' ).factory( 'ClientRuns', [ '$rootScope', '$window', '$interval', 'Client', 'Roots', function ( $rootScope, $window, $interval, Client, Roots )
{
	const POLL = 2000;			// a queued or running run in the popup is read again this often
	const NOTICE_TIME = 15000;	// a notice stays this long unless dismissed
	const ENDED = [ 'done', 'failed', 'stopped' ];
	let available = !!( $window.ConsensusDesktop && $window.ConsensusDesktop.Edition === 'desktop' );
	let mine = {};				// root key -> [ summaries ], newest first
	let pressed = {};			// run id -> root key: the runs pressed in this window, for the notices
	let poll = null;
	let runs = {
		Available: available,
		Popup: null,			// { Root, Run, Source }
		Notices: [],			// [ { Root, Run, Text } ]
	};


	function Mine( Root )
	{
		return ( Root && mine[ Root.Key ] ) || [];
	}


	async function Reload( Root )
	{
		if ( !available || !Root || !Root.Me || !Root.Me.Name )
		{
			return;
		}
		try
		{
			let answer = await Client.Get( Root, '/api/runs?By=' + encodeURIComponent( Root.Me.Name ) );
			mine[ Root.Key ] = ( answer.Runs || [] ).map( function ( run ) { run.Root = Root.Key; return run; } );
		}
		catch ( error )
		{
			mine[ Root.Key ] = [];
		}
		$rootScope.$applyAsync();
	}


	// The person's newest run of a task on a plan, or null.
	function Latest( Root, PlanId, TaskId )
	{
		return Mine( Root ).find( function ( run ) { return run.Plan && run.Plan.Id === PlanId && run.Task && run.Task.Id === TaskId; } ) || null;
	}


	// A press in this window: the run is listed at once and its end will be noticed.
	function Pressed( Root, Run )
	{
		if ( !available || !Root || !Run )
		{
			return;
		}
		Run.Root = Root.Key;
		pressed[ Run.Id ] = Root.Key;
		mine[ Root.Key ] = [ Run ].concat( Mine( Root ).filter( function ( one ) { return one.Id !== Run.Id; } ) );
		$rootScope.$applyAsync();
	}


	function stop_polling()
	{
		if ( poll )
		{
			$interval.cancel( poll );
			poll = null;
		}
	}


	async function read_open()
	{
		let popup = runs.Popup;
		if ( !popup )
		{
			return;
		}
		try
		{
			let answer = await Client.Get( popup.Root, '/api/runs/' + encodeURIComponent( popup.Run.Id ) );
			if ( runs.Popup === popup && answer.Run )
			{
				popup.Run = answer.Run;
			}
		}
		catch ( error )
		{
			// the run is gone: the popup keeps what it has
		}
		if ( runs.Popup === popup && ENDED.includes( popup.Run.Status ) )
		{
			stop_polling();
		}
		$rootScope.$applyAsync();
	}


	async function Open( Root, Run )
	{
		stop_polling();
		runs.Popup = { Root: Root, Run: Run, Source: false };
		await read_open();
		if ( runs.Popup && !ENDED.includes( runs.Popup.Run.Status ) )
		{
			poll = $interval( read_open, POLL );
		}
	}


	function Close()
	{
		stop_polling();
		runs.Popup = null;
	}


	async function Stop()
	{
		let popup = runs.Popup;
		if ( !popup )
		{
			return;
		}
		try
		{
			await Client.Post( popup.Root, '/api/runs/' + encodeURIComponent( popup.Run.Id ) + '/stop' );
		}
		catch ( error )
		{
			popup.Error = error.message;
		}
		await read_open();
	}


	function Dismiss( Notice )
	{
		runs.Notices = runs.Notices.filter( function ( one ) { return one !== Notice; } );
	}


	// The state in words: Queued (behind which run), Running, Done, Failed, Stopped.
	function Words( Run )
	{
		if ( !Run )
		{
			return '';
		}
		if ( Run.Status === 'queued' )
		{
			return 'Queued' + ( Run.Behind ? ' behind ' + ( Run.Behind.Task || 'a run' ) + ( Run.Behind.Plan ? ' on ' + Run.Behind.Plan : '' ) : '' );
		}
		return Run.Status ? Run.Status.charAt( 0 ).toUpperCase() + Run.Status.slice( 1 ) : '';
	}


	// The time so far, or the time it took.
	function Duration( Run )
	{
		if ( !Run )
		{
			return '';
		}
		let seconds = null;
		if ( Run.Duration !== null && Run.Duration !== undefined )
		{
			seconds = Run.Duration;
		}
		else if ( Run.Status === 'running' && Run.Started )
		{
			seconds = Math.max( 0, Math.round( ( Date.now() - new Date( Run.Started ).getTime() ) / 1000 ) );
		}
		else if ( Run.Status === 'queued' && Run.Queued )
		{
			seconds = Math.max( 0, Math.round( ( Date.now() - new Date( Run.Queued ).getTime() ) / 1000 ) );
		}
		if ( seconds === null )
		{
			return '';
		}
		return Math.floor( seconds / 60 ) + ':' + String( seconds % 60 ).padStart( 2, '0' );
	}


	// A run's events come a few times a second while it runs: the list is read once a second at most.
	let reloading = {};		// root key -> the timer

	function reload_soon( root )
	{
		if ( reloading[ root.Key ] )
		{
			return;
		}
		reloading[ root.Key ] = setTimeout( function ()
		{
			delete reloading[ root.Key ];
			Reload( root );
		}, 1000 );
	}


	// A run changed on a root: the person's list follows, the open run is read again, and a run pressed here that
	// ended leaves a notice.
	$rootScope.$on( 'runs-changed', function ( event, summary )
	{
		if ( !available || !summary )
		{
			return;
		}
		let root = Roots.Of( summary.Root );
		if ( !root )
		{
			return;
		}
		reload_soon( root );
		if ( runs.Popup && runs.Popup.Run.Id === summary.Id )
		{
			read_open();
		}
		if ( pressed[ summary.Id ] === root.Key && ENDED.includes( summary.Status ) )
		{
			delete pressed[ summary.Id ];
			let run = Mine( root ).find( function ( one ) { return one.Id === summary.Id; } ) || { Id: summary.Id, Status: summary.Status };
			run.Status = summary.Status;
			let notice = { Root: root, Run: run, Text: ( run.Task ? run.Task.Name : 'A run' ) + ( run.Plan ? ' on ' + run.Plan.Title : '' ) + ': ' + Words( run ).toLowerCase() };
			runs.Notices = runs.Notices.concat( [ notice ] );
			setTimeout( function () { Dismiss( notice ); $rootScope.$applyAsync(); }, NOTICE_TIME );
		}
		$rootScope.$applyAsync();
	} );


	runs.Mine = Mine;
	runs.Latest = Latest;
	runs.Pressed = Pressed;
	runs.Open = Open;
	runs.Close = Close;
	runs.Stop = Stop;
	runs.Reload = Reload;
	runs.Dismiss = Dismiss;
	runs.Words = Words;
	runs.Duration = Duration;
	return runs;
} ] )


.component( 'clientRuns', {
	templateUrl: '/components/client-runs/client-runs.html',
	bindings: { list: '<' },
	controller: [ '$scope', '$interval', 'ClientRuns', 'Roots', function ( $scope, $interval, ClientRuns, Roots )
	{
		let controller = this;
		controller.Runs = ClientRuns;
		controller.Roots = Roots;


		// Every Server's runs of the person, newest first. The entries are kept from one digest to the next (the same
		// object for the same run), so the list's ng-repeat sees no change when nothing changed.
		let entries = {};		// root key + run id -> { Root, Run }

		controller.All = function ()
		{
			let all = [];
			let kept = {};
			for ( let root of Roots.List )
			{
				for ( let run of ClientRuns.Mine( root ) )
				{
					let key = root.Key + '\u0000' + run.Id;
					let entry = entries[ key ] || { Root: root, Run: run };
					entry.Run = run;
					kept[ key ] = entry;
					all.push( entry );
				}
			}
			entries = kept;
			all.sort( function ( a, b ) { return String( b.Run.Started || b.Run.Queued || '' ).localeCompare( String( a.Run.Started || a.Run.Queued || '' ) ); } );
			return all;
		};


		controller.Stamp = function ( run )
		{
			let when = run.Started || run.Queued;
			return when ? new Date( when ).toLocaleString( [], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' } ) : '';
		};


		// The list is read when it is shown, as the roots come in; the clock of a running run ticks.
		if ( controller.list )
		{
			$scope.$watch( function () { return Roots.List.map( function ( root ) { return root.Key + ':' + ( root.Me ? root.Me.Name : '' ); } ).join( '|' ); }, function ()
			{
				for ( let root of Roots.List )
				{
					ClientRuns.Reload( root );
				}
			} );
		}
		let tick = $interval( function () {}, 1000 );
		controller.$onDestroy = function ()
		{
			$interval.cancel( tick );
		};


		controller.Key = function ( event )
		{
			if ( event.key === 'Escape' )
			{
				ClientRuns.Close();
			}
		};
	} ],
} );
