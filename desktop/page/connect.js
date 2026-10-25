'use strict';

// The servers screen (plan Consensus Desktop, Step 2; the servers' list since plan Run Shapes, Step 5, the page
// showing every server at once; the list is desktop.json's Hosts since plan Rearchitecturation, Step 1): the saved
// servers with Edit and Remove; Add server, tried before it is saved; this
// machine's server, the config's own, started with the app as its Scope says (plan Run Shapes, Step 1); and Open the
// page. Everything goes through window.Desktop (preload.js) to the main process.

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
	$scope.Reason = window.ConsensusDesktop.Reason;
	$scope.Settings = { Hosts: [] };
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
	$scope.Save = async function ()
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
		let hosts = $scope.Settings.Hosts.filter( function ( host ) { return host !== editing.Original; } );
		hosts.push( { Name: editing.Name.trim(), Url: tried.Url, Project: editing.Original ? editing.Original.Project : null } );
		let answer = await window.Desktop.Save( { Hosts: hosts } );
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
	};


	$scope.Remove = async function ( server )
	{
		let hosts = $scope.Settings.Hosts.filter( function ( candidate ) { return candidate !== server; } );
		let answer = await window.Desktop.Save( { Hosts: hosts } );
		if ( answer.Settings )
		{
			$scope.Settings = answer.Settings;
		}
		$scope.$applyAsync();
	};


	//-----------------------------------------------------------------
	// The page: shown when there is a server to show, this machine's or a saved one.

	$scope.CanOpen = function ()
	{
		return !!$scope.Local || ( $scope.Settings.Hosts || [] ).length > 0;
	};


	$scope.OpenPage = function ()
	{
		$scope.Busy = true;
		window.Desktop.OpenPage();
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


	// The window buttons Electron draws over the header (plan UI Components, Step 5) follow its colours and height,
	// once drawn and after every change of theme or size, as the page's title bar does.
	function report_chrome()
	{
		window.requestAnimationFrame( function ()
		{
			window.ConsensusTheme.ReportChrome( document.querySelector( '.connect-head' ) );
		} );
	}


	document.addEventListener( 'consensus-theme', report_chrome );
	report_chrome();
	load();
} ] );
