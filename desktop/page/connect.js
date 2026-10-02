'use strict';

// The connect screen (plan Consensus Desktop, Step 2): the saved servers with Connect, Edit and Remove; Add server,
// tried before it is saved; the local server's data folder, Start and Stop; and what the app is connected to.
// Everything goes through window.Desktop (preload.js) to the main process.

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
	$scope.Settings = { Servers: [], Local: { Data: '' } };
	$scope.Local = null;
	$scope.LocalData = '';
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
			$scope.LocalData = answer.Settings.Local.Data || '';
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
	// The local server

	$scope.PickFolder = async function ()
	{
		let picked = await window.Desktop.PickFolder( $scope.LocalData || undefined );
		if ( picked )
		{
			$scope.LocalData = picked;
		}
		$scope.$applyAsync();
	};


	$scope.LocalStart = async function ()
	{
		$scope.Busy = true;
		$scope.Error = null;
		let answer = await window.Desktop.LocalStart( $scope.LocalData );
		if ( answer.Ok )
		{
			$scope.Local = answer.Running;
		}
		else
		{
			$scope.Error = answer.Error;
		}
		$scope.Busy = false;
		$scope.$applyAsync();
	};


	$scope.LocalStop = async function ()
	{
		$scope.Busy = true;
		await window.Desktop.LocalStop();
		$scope.Local = null;
		$scope.Busy = false;
		$scope.$applyAsync();
	};


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
