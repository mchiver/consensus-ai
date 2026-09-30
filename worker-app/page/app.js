'use strict';

// The worker app's page (plan Worker Electron App): the settings form on the App tab, saved whole through the
// bridge (window.App, preload.js), and a tab per worker. A running worker's page is not in this document: the main
// process places it over the tab's area, at the bounds this page reports (View) whenever the tab, the statuses or
// the window's size change.

angular.module( 'WorkerApp', [] )


.controller( 'AppController', [ '$scope', '$timeout', function ( $scope, $timeout )
{
	$scope.Tab = 'app';
	$scope.Form = null;
	$scope.Path = '';
	$scope.Workers = [];
	$scope.Problems = [];
	$scope.Error = null;
	$scope.Notice = null;
	$scope.Saving = false;
	$scope.Theme = window.ConsensusTheme.Get().Theme;
	$scope.Scale = window.ConsensusTheme.Get().Scale;

	let saved_text = '';
	let saved_names = new Set();
	let opened = { llm: {}, worker: {} };
	let models = {};
	let notice_timer = null;


	//-----------------------------------------------------------------
	// The form: the settings with each worker's lists as text, one line each, and Builds for its Build.

	function lines_to_text( lines )
	{
		return ( lines || [] ).join( '\n' );
	}


	function text_to_lines( text )
	{
		return String( text || '' ).split( /\r?\n/ ).map( function ( line ) { return line.trim(); } ).filter( function ( line ) { return line; } );
	}


	function to_form( settings )
	{
		let form = JSON.parse( JSON.stringify( settings ) );
		form.Workers = form.Workers.map( function ( worker )
		{
			worker.IncludeText = lines_to_text( worker.Include );
			worker.ExcludeText = lines_to_text( worker.Exclude );
			worker.Builds = !!worker.Build;
			worker.Remote = worker.Build ? worker.Build.Remote : 'origin';
			worker.CommandsText = worker.Build ? lines_to_text( worker.Build.Commands ) : '';
			return worker;
		} );
		return form;
	}


	function from_form( form )
	{
		let settings = {
			Consensus: { Url: form.Consensus.Url },
			Inference: form.Inference.map( function ( item )
			{
				let clean = { Name: item.Name, Type: item.Type };
				if ( item.Type === 'claude-cli' )
				{
					clean.Command = item.Command || 'claude';
				}
				else
				{
					clean.Url = item.Url || '';
				}
				if ( item.Model )
				{
					clean.Model = item.Model;
				}
				return clean;
			} ),
			Workers: form.Workers.map( function ( worker )
			{
				return {
					Name: String( worker.Name || '' ).trim(),
					Token: worker.Token,
					Root: worker.Root,
					Include: text_to_lines( worker.IncludeText ),
					Exclude: text_to_lines( worker.ExcludeText ),
					Build: worker.Builds ? { Remote: worker.Remote || 'origin', Commands: text_to_lines( worker.CommandsText ) } : null,
					AutoStart: !!worker.AutoStart,
				};
			} ),
			MaxRounds: form.MaxRounds,
			TimeoutSeconds: form.TimeoutSeconds,
		};
		return settings;
	}


	function take( settings )
	{
		$scope.Form = to_form( settings );
		saved_text = JSON.stringify( from_form( $scope.Form ) );
		saved_names = new Set( settings.Workers.map( function ( worker ) { return worker.Name; } ) );
	}


	$scope.Dirty = function ()
	{
		return !!$scope.Form && JSON.stringify( from_form( $scope.Form ) ) !== saved_text;
	};


	// Saved( worker ): the worker exists as saved, so it can be started.
	$scope.Saved = function ( worker )
	{
		return saved_names.has( worker.Name );
	};


	//-----------------------------------------------------------------
	// Loading and saving

	async function load()
	{
		try
		{
			let answer = await window.App.Settings();
			take( answer.Settings );
			$scope.Path = answer.Path;
			$scope.Workers = await window.App.Workers();
		}
		catch ( error )
		{
			$scope.Error = 'the app does not answer: ' + error.message;
		}
		$scope.$applyAsync();
		sync_view();
	}


	$scope.Save = async function ()
	{
		$scope.Saving = true;
		$scope.Problems = [];
		try
		{
			let answer = await window.App.Save( from_form( $scope.Form ) );
			if ( answer.Problems )
			{
				$scope.Problems = answer.Problems;
			}
			else
			{
				take( answer.Settings );
				notice( 'Saved.' );
			}
		}
		catch ( error )
		{
			$scope.Error = error.message;
		}
		$scope.Saving = false;
		$scope.$applyAsync();
	};


	$scope.Revert = function ()
	{
		take( JSON.parse( saved_text ) );
		$scope.Problems = [];
	};


	function notice( text )
	{
		$scope.Notice = text;
		if ( notice_timer )
		{
			$timeout.cancel( notice_timer );
		}
		notice_timer = $timeout( function () { $scope.Notice = null; }, 2500 );
	}


	//-----------------------------------------------------------------
	// The lists

	$scope.Toggle = function ( kind, index )
	{
		opened[ kind ][ index ] = !opened[ kind ][ index ];
	};


	$scope.IsOpen = function ( kind, index )
	{
		return !!opened[ kind ][ index ];
	};


	$scope.AddLlm = function ()
	{
		$scope.Form.Inference.push( { Name: '', Type: 'claude-cli', Command: 'claude' } );
		opened.llm[ $scope.Form.Inference.length - 1 ] = true;
	};


	$scope.RemoveLlm = function ( index )
	{
		$scope.Form.Inference.splice( index, 1 );
		opened.llm = {};
	};


	$scope.AddWorker = async function ()
	{
		let token = await window.App.NewToken();
		$scope.Form.Workers.push( { Name: '', Token: token, Root: '', IncludeText: '', ExcludeText: 'node_modules/**', Builds: false, Remote: 'origin', CommandsText: '', AutoStart: true } );
		opened.worker[ $scope.Form.Workers.length - 1 ] = true;
		$scope.$applyAsync();
	};


	$scope.RemoveWorker = async function ( index )
	{
		let worker = $scope.Form.Workers[ index ];
		let status = $scope.StatusOf( worker.Name );
		let question = status.Url ? ( '"' + worker.Name + '" is running. Stop it and remove it?' ) : ( 'Remove "' + worker.Name + '"?' );
		if ( !window.confirm( question ) )
		{
			return;
		}
		if ( status.Url )
		{
			await window.App.Stop( worker.Name );
		}
		$scope.Form.Workers.splice( index, 1 );
		opened.worker = {};
		$scope.$applyAsync();
	};


	$scope.NewToken = async function ( worker )
	{
		worker.Token = await window.App.NewToken();
		$scope.$applyAsync();
	};


	$scope.PickFolder = async function ( worker )
	{
		let picked = await window.App.PickFolder( worker.Root || undefined );
		if ( picked )
		{
			worker.Root = picked;
			if ( !worker.Name )
			{
				worker.Name = picked.split( '/' ).filter( function ( part ) { return part; } ).pop() || '';
			}
		}
		$scope.$applyAsync();
	};


	$scope.Check = async function ( item )
	{
		item.Checking = true;
		item.CheckResult = null;
		item.CheckError = null;
		$scope.$applyAsync();
		let answer = await window.App.Check( { Type: item.Type, Command: item.Command, Url: item.Url } );
		item.Checking = false;
		item.CheckResult = answer.Result || null;
		item.CheckError = answer.Error || null;
		$scope.$applyAsync();
	};


	$scope.ModelChoices = function ( item )
	{
		let choices = ( models[ item.Url ] || [] ).slice();
		if ( item.Model && !choices.includes( item.Model ) )
		{
			choices.unshift( item.Model );
		}
		return choices;
	};


	$scope.RefreshModels = async function ( item )
	{
		let answer = await window.App.Models( item.Url );
		models[ item.Url ] = answer.Models || [];
		if ( answer.Error )
		{
			item.CheckError = answer.Error;
		}
		$scope.$applyAsync();
	};


	//-----------------------------------------------------------------
	// The workers

	$scope.StatusOf = function ( name )
	{
		return $scope.Workers.find( function ( worker ) { return worker.Name === name; } ) || { Status: 'stopped', Url: null };
	};


	$scope.Current = function ()
	{
		return $scope.StatusOf( $scope.Tab );
	};


	$scope.Start = async function ( name, event )
	{
		if ( event )
		{
			event.stopPropagation();
		}
		let answer = await window.App.Start( name );
		if ( answer.Error )
		{
			$scope.Error = name + ': ' + answer.Error;
		}
		$scope.Workers = await window.App.Workers();
		$scope.$applyAsync();
		sync_view();
	};


	$scope.Stop = async function ( name, event )
	{
		if ( event )
		{
			event.stopPropagation();
		}
		await window.App.Stop( name );
		$scope.Workers = await window.App.Workers();
		$scope.$applyAsync();
		sync_view();
	};


	$scope.OpenBrowser = function ( url )
	{
		window.App.OpenBrowser( url );
	};


	$scope.Copy = function ( text, event )
	{
		if ( event )
		{
			event.stopPropagation();
		}
		window.App.Copy( text );
		notice( 'Copied.' );
	};


	//-----------------------------------------------------------------
	// The tabs, and the embedded view's place

	$scope.Open = function ( tab )
	{
		$scope.Tab = tab;
		sync_view();
	};


	// The main process shows the open tab's worker page at the area's bounds, or none.
	function sync_view()
	{
		$timeout( function ()
		{
			let current = $scope.Current();
			let area = document.getElementById( 'view-area' );
			if ( $scope.Tab === 'app' || !current.Url || !area )
			{
				window.App.View( null, null );
				return;
			}
			let rect = area.getBoundingClientRect();
			window.App.View( $scope.Tab, { x: rect.left, y: rect.top, width: rect.width, height: rect.height } );
		}, 0 );
	}


	window.addEventListener( 'resize', sync_view );
	document.addEventListener( 'consensus-theme', sync_view );

	window.App.OnWorkers( function ( snapshot )
	{
		$scope.Workers = snapshot;
		if ( $scope.Tab !== 'app' && !snapshot.some( function ( worker ) { return worker.Name === $scope.Tab; } ) )
		{
			$scope.Tab = 'app';
		}
		$scope.$applyAsync();
		sync_view();
	} );


	//-----------------------------------------------------------------
	// Theme

	$scope.SetTheme = function ()
	{
		window.ConsensusTheme.SetTheme( $scope.Theme );
	};


	$scope.SetScale = function ()
	{
		window.ConsensusTheme.SetScale( $scope.Scale );
	};


	load();
} ] );
