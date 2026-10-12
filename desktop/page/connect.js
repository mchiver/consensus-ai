'use strict';

// The connect screen (plan Consensus Desktop, Step 2): the saved servers with Connect, Edit and Remove; Add server,
// tried before it is saved; this machine's server, the config's own, started with the app as its Scope says (plan
// Run Shapes, Step 1); and what the app is connected to. Everything goes through window.Desktop (preload.js) to
// the main process.

angular.module( 'Connect', [] )


// auto-focus: an input shown by ng-if takes the focus.
.directive( 'autoFocus', [ '$timeout', function ( $timeout )
{
	return {
		restrict: 'A',
		link: function ( scope, element )
		{
			$timeout( function () { element[ 0 ].focus(); } );
		},
	};
} ] )


.controller( 'ConnectController', [ '$scope', function ( $scope )
{
	$scope.Version = window.ConsensusDesktop.Version;
	$scope.Server = window.ConsensusDesktop.Server;
	$scope.Reason = window.ConsensusDesktop.Reason;
	$scope.Settings = { Servers: [] };
	$scope.Local = null;
	$scope.Missing = [];
	$scope.Editing = null;
	$scope.Error = null;
	$scope.Busy = false;
	$scope.Theme = window.ConsensusTheme.Get().Theme;
	$scope.Scale = window.ConsensusTheme.Get().Scale;
	$scope.Palettes = window.ConsensusTheme.PALETTES;


	async function load()
	{
		try
		{
			let answer = await window.Desktop.Settings();
			$scope.Settings = answer.Settings;
			$scope.Local = answer.Local;
			$scope.Missing = answer.Missing || [];
			$scope.Server = answer.Server;
			$scope.Reason = answer.Reason;
		}
		catch ( error )
		{
			$scope.Error = 'the app does not answer: ' + error.message;
		}
		$scope.$applyAsync();
	}


	//-----------------------------------------------------------------
	// Servers

	$scope.StartAdd = function ()
	{
		$scope.Editing = { Original: null, Name: '', Url: 'http://', Tried: null };
	};


	$scope.StartEdit = function ( server )
	{
		$scope.Editing = { Original: server, Name: server.Name, Url: server.Url, Tried: null };
	};


	$scope.CancelEdit = function ()
	{
		$scope.Editing = null;
	};


	$scope.Try = async function ()
	{
		if ( !$scope.Editing )
		{
			return;
		}
		$scope.Busy = true;
		$scope.Editing.Tried = await window.Desktop.Try( $scope.Editing.Url );
		$scope.Busy = false;
		$scope.$applyAsync();
	};


	// Save: the server is tried first; a server that does not answer is not saved.
	$scope.Save = async function ( then_connect )
	{
		let editing = $scope.Editing;
		if ( !editing || !editing.Name || !editing.Url )
		{
			return;
		}
		$scope.Busy = true;
		let tried = await window.Desktop.Try( editing.Url );
		editing.Tried = tried;
		if ( !tried.Ok )
		{
			$scope.Busy = false;
			$scope.$applyAsync();
			return;
		}
		let servers = $scope.Settings.Servers.filter( function ( server ) { return server !== editing.Original; } );
		servers.push( { Name: editing.Name.trim(), Url: tried.Url } );
		let answer = await window.Desktop.Save( { Servers: servers } );
		if ( answer.Problems )
		{
			$scope.Error = answer.Problems.join( '; ' );
			$scope.Busy = false;
			$scope.$applyAsync();
			return;
		}
		$scope.Settings = answer.Settings;
		$scope.Editing = null;
		$scope.Busy = false;
		$scope.$applyAsync();
		if ( then_connect )
		{
			await $scope.Connect( { Name: editing.Name.trim() } );
		}
	};


	$scope.Remove = async function ( server )
	{
		let servers = $scope.Settings.Servers.filter( function ( candidate ) { return candidate !== server; } );
		let answer = await window.Desktop.Save( { Servers: servers } );
		if ( answer.Settings )
		{
			$scope.Settings = answer.Settings;
		}
		$scope.$applyAsync();
	};


	// Connect: the main process tries the server and, when it answers, shows the Consensus page in this window.
	$scope.Connect = async function ( server )
	{
		$scope.Busy = true;
		$scope.Reason = null;
		let answer = await window.Desktop.Connect( { Kind: 'server', Name: server.Name } );
		if ( !answer.Ok )
		{
			$scope.Reason = answer.Error;
			$scope.Busy = false;
		}
		$scope.$applyAsync();
	};


	//-----------------------------------------------------------------
	// This machine's server

	$scope.ConnectLocal = async function ()
	{
		$scope.Busy = true;
		$scope.Reason = null;
		let answer = await window.Desktop.Connect( { Kind: 'local' } );
		if ( !answer.Ok )
		{
			$scope.Reason = answer.Error;
			$scope.Busy = false;
		}
		$scope.$applyAsync();
	};


	$scope.NewWindow = function ()
	{
		window.Desktop.NewWindow();
	};


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
