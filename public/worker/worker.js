'use strict';

// The worker's page (plan Workers): its state from /api/state, reloaded on each event from /api/events; the
// buttons post to /api/pause, /api/resume, /api/cancel and /api/reload, and Commit and Push on an accepted build to
// /api/jobs/<id>/commit and /push.

angular.module( 'Worker', [] )


//---------------------------------------------------------------------
// job-calls="<a job>": its tool calls, each opening to what it returned; the last one is always open.

.directive( 'jobCalls', function ()
{
	return {
		scope: { Job: '=jobCalls' },
		templateUrl: 'calls.html',
		link: function ( scope )
		{
			scope.Opened = {};
			scope.$watch( function () { return scope.Job ? scope.Job.Id : null; }, function ()
			{
				scope.Opened = {};
			} );
		},
	};
} )


.controller( 'WorkerController', [ '$scope', '$http', '$interval', function ( $scope, $http, $interval )
{
	$scope.State = { Consensus: {}, Jobs: [], Workspaces: [], Inference: [] };
	$scope.Selected = null;
	$scope.Error = null;
	$scope.Now = Date.now();
	$scope.Theme = window.ConsensusTheme.Get().Theme;
	$scope.Scale = window.ConsensusTheme.Get().Scale;


	async function load()
	{
		try
		{
			let answer = await $http.get( '/api/state' );
			$scope.State = answer.data;
			if ( $scope.Selected )
			{
				let id = $scope.Selected.Id;
				$scope.Selected = $scope.State.Jobs.find( function ( job ) { return job.Id === id; } ) || null;
			}
		}
		catch ( error )
		{
			$scope.Error = 'the worker does not answer';
		}
		$scope.$applyAsync();
	}


	$scope.Act = async function ( what )
	{
		try
		{
			await $http.post( '/api/' + what, {} );
			$scope.Error = null;
		}
		catch ( error )
		{
			$scope.Error = ( error.data && error.data.Error ) || ( what + ' failed' );
		}
		await load();
	};


	// Commit or Push on an accepted build: queued on the worker, run in the order pressed.
	$scope.Git = async function ( job, kind )
	{
		try
		{
			await $http.post( '/api/jobs/' + encodeURIComponent( job.Id ) + '/' + kind, {} );
			$scope.Error = null;
		}
		catch ( error )
		{
			$scope.Error = ( error.data && error.data.Error ) || ( kind + ' failed' );
		}
		await load();
	};


	$scope.GitBusy = function ( job )
	{
		return ( job.Git || [] ).some( function ( step ) { return step.Status === 'queued' || step.Status === 'running'; } );
	};


	$scope.Select = function ( job )
	{
		$scope.Selected = ( job && $scope.Selected && $scope.Selected.Id === job.Id ) ? null : job;
	};


	// "12s", "3m 4s" since an ISO time.
	$scope.Since = function ( started )
	{
		return seconds_words( ( $scope.Now - Date.parse( started ) ) / 1000 );
	};


	$scope.Duration = function ( job )
	{
		if ( !job.Finished )
		{
			return $scope.Since( job.Started );
		}
		return seconds_words( ( Date.parse( job.Finished ) - Date.parse( job.Started ) ) / 1000 );
	};


	function seconds_words( seconds )
	{
		let whole = Math.max( 0, Math.round( seconds ) );
		if ( whole < 60 )
		{
			return whole + 's';
		}
		return Math.floor( whole / 60 ) + 'm ' + ( whole % 60 ) + 's';
	}


	$scope.Pretty = function ( value )
	{
		return ( typeof value === 'string' ) ? value : JSON.stringify( value, null, 2 );
	};


	// What Consensus said it did with the answer.
	$scope.Carried = function ( carried )
	{
		if ( carried.Error )
		{
			return carried.Error;
		}
		let refused = Object.keys( carried.Refused || {} ).length;
		return 'carried out ' + carried.Actions + ( carried.Actions === 1 ? ' action' : ' actions' ) + ( refused ? ', ' + refused + ' refused' : '' );
	};


	$scope.SetTheme = function ()
	{
		window.ConsensusTheme.SetTheme( $scope.Theme );
	};


	$scope.SetScale = function ()
	{
		window.ConsensusTheme.SetScale( $scope.Scale );
	};


	let source = new EventSource( '/api/events' );
	source.addEventListener( 'change', function ()
	{
		load();
	} );
	source.onopen = function ()
	{
		load();
	};
	$interval( function () { $scope.Now = Date.now(); }, 1000 );
	load();
} ] );
