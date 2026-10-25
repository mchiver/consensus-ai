'use strict';

// The chooser (plan Rearchitecturation, Step 2; the servers screen of plan Consensus Desktop, Step 2, until then): a
// window with no project shows it. Recent projects (desktop.json, newest first; Open, Forget), Open folder (the folder
// picker; a folder without a .consensus gets one), New project (a name and a parent folder), and the Hosts: the saved
// Host projects (Open, Remove) and Add host (a Name and a Url tried first, then one of the Host's projects picked; the
// pair is saved as an entry). Everything goes through window.Desktop (preload.js) to the main process, which opens the
// project in this window and shows the page.

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
	$scope.Settings = { Recent: [], Hosts: [] };
	$scope.Error = null;
	$scope.Busy = false;
	$scope.Creating = null;		// { Name, Parent } while New project is open
	$scope.Adding = null;		// { Name, Url, Tried, Projects, Project } while Add host is open
	$scope.Theme = window.ConsensusTheme.Get().Theme;
	$scope.Scale = window.ConsensusTheme.Get().Scale;
	$scope.Palettes = window.ConsensusTheme.PALETTES;


	async function load()
	{
		try
		{
			let answer = await window.Desktop.Settings();
			$scope.Settings = answer.Settings;
			$scope.Reason = answer.Reason;
		}
		catch ( error )
		{
			$scope.Error = 'the app does not answer: ' + error.message;
		}
		$scope.$applyAsync();
	}


	// An answer from the main process: an error shows, Ok means the page is on its way.
	function took( answer )
	{
		$scope.Busy = false;
		if ( answer && answer.Error )
		{
			$scope.Error = answer.Error;
		}
		$scope.$applyAsync();
		return !!( answer && answer.Ok );
	}


	//-----------------------------------------------------------------
	// Recent projects

	$scope.NameOf = function ( path )
	{
		return String( path || '' ).split( /[\\/]/ ).filter( Boolean ).pop() || path;
	};


	$scope.OpenRecent = async function ( entry )
	{
		$scope.Busy = true;
		took( await window.Desktop.OpenPath( entry.Path ) );
	};


	$scope.Forget = async function ( entry )
	{
		let answer = await window.Desktop.Forget( entry.Path );
		if ( answer.Settings )
		{
			$scope.Settings = answer.Settings;
		}
		$scope.$applyAsync();
	};


	//-----------------------------------------------------------------
	// Open folder, New project

	$scope.OpenFolder = async function ()
	{
		$scope.Busy = true;
		took( await window.Desktop.OpenFolder() );
	};


	$scope.StartCreate = function ()
	{
		$scope.Creating = { Name: '', Parent: '' };
		$scope.Adding = null;
	};


	$scope.PickParent = async function ()
	{
		let picked = await window.Desktop.PickFolder( $scope.Creating ? $scope.Creating.Parent : null );
		if ( picked && $scope.Creating )
		{
			$scope.Creating.Parent = picked;
		}
		$scope.$applyAsync();
	};


	$scope.Create = async function ()
	{
		if ( !$scope.Creating || !$scope.Creating.Name || !$scope.Creating.Parent )
		{
			return;
		}
		$scope.Busy = true;
		took( await window.Desktop.NewProject( { Name: $scope.Creating.Name, Parent: $scope.Creating.Parent } ) );
	};


	$scope.CancelCreate = function ()
	{
		$scope.Creating = null;
	};


	//-----------------------------------------------------------------
	// Hosts

	$scope.OpenHost = async function ( entry )
	{
		$scope.Busy = true;
		took( await window.Desktop.ConnectHost( { Name: entry.Name, Url: entry.Url, Project: entry.Project } ) );
	};


	$scope.RemoveHost = async function ( entry )
	{
		let answer = await window.Desktop.RemoveHost( { Name: entry.Name, Project: entry.Project } );
		if ( answer.Settings )
		{
			$scope.Settings = answer.Settings;
		}
		$scope.$applyAsync();
	};


	$scope.StartAdd = function ()
	{
		$scope.Adding = { Name: '', Url: 'http://', Tried: null, Projects: [], Project: null };
		$scope.Creating = null;
	};


	// Try: the Host answers, and its projects are listed to pick from.
	$scope.TryHost = async function ()
	{
		if ( !$scope.Adding )
		{
			return;
		}
		$scope.Busy = true;
		let tried = await window.Desktop.HostProjects( $scope.Adding.Url );
		$scope.Adding.Tried = tried;
		$scope.Adding.Projects = tried.Ok ? tried.Projects : [];
		$scope.Adding.Project = ( tried.Ok && tried.Projects.length ) ? tried.Projects[ 0 ].Id : null;
		$scope.Busy = false;
		$scope.$applyAsync();
	};


	$scope.Connect = async function ()
	{
		let adding = $scope.Adding;
		if ( !adding || !adding.Name || !adding.Tried || !adding.Tried.Ok || !adding.Project )
		{
			return;
		}
		$scope.Busy = true;
		took( await window.Desktop.ConnectHost( { Name: adding.Name.trim(), Url: adding.Tried.Url, Project: adding.Project } ) );
	};


	$scope.CancelAdd = function ()
	{
		$scope.Adding = null;
	};


	//-----------------------------------------------------------------
	// Another window

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
