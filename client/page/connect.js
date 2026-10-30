'use strict';

// The Client's chooser (plan Review 2026-10-29, Step 5.1: the editions cut; the desktop's chooser of plan
// Rearchitecturation, Step 2, narrowed to its Servers section): a window with no project shows it. The saved Servers
// (client.json, each with its last project: Open opens that project, or the whole Server when none was picked yet;
// Project… lists the Server's projects to pick another; Remove drops the entry) and Connect to Server (a Name and a Url
// tried first, then one of the Server's projects picked; the Server is saved with it). Everything goes through
// window.Desktop (preload.js) to the main process, which opens the project in this window and shows the page, where
// the Server signs you in.

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
	$scope.Settings = { Servers: [] };
	$scope.Error = null;
	$scope.Busy = false;
	$scope.Adding = null;		// { Name, Url, Tried, Projects, Project, Fixed } while Connect to Server or Project… is open
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
			$scope.License = answer.License || null;		// the tier, for About's sake; the Server's own sign-in is what counts
			// --connect named a Server with no project known: its projects are listed first
			let pick = answer.Pick ? ( answer.Settings.Servers || [] ).find( function ( entry ) { return entry.Name === answer.Pick; } ) : null;
			if ( pick )
			{
				$scope.StartPick( pick );
			}
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
	// The saved Servers

	$scope.Open = async function ( entry )
	{
		$scope.Busy = true;
		took( await window.Desktop.ConnectServer( { Name: entry.Name, Url: entry.Url, Project: entry.Project || null, Title: entry.Title || null } ) );
	};


	$scope.Remove = async function ( entry )
	{
		let answer = await window.Desktop.RemoveServer( entry.Name );
		if ( answer.Settings )
		{
			$scope.Settings = answer.Settings;
		}
		if ( answer.Error )
		{
			$scope.Error = answer.Error;
		}
		$scope.$applyAsync();
	};


	// Project…: the Server tried again and its projects listed, the name as saved.
	$scope.StartPick = function ( entry )
	{
		$scope.Adding = { Name: entry.Name, Url: entry.Url, Tried: null, Projects: [], Project: null, Fixed: true };
		$scope.Try();
	};


	//-----------------------------------------------------------------
	// Connect to Server

	$scope.StartAdd = function ()
	{
		$scope.Adding = { Name: '', Url: 'http://', Tried: null, Projects: [], Project: null, Fixed: false };
	};


	// Try: the Server answers, and its projects are listed to pick from.
	$scope.Try = async function ()
	{
		if ( !$scope.Adding )
		{
			return;
		}
		$scope.Busy = true;
		let tried = await window.Desktop.ServerProjects( $scope.Adding.Url );
		if ( $scope.Adding )
		{
			$scope.Adding.Tried = tried;
			$scope.Adding.Projects = tried.Ok ? tried.Projects : [];
			$scope.Adding.Project = ( tried.Ok && tried.Projects.length ) ? tried.Projects[ 0 ].Id : null;
		}
		$scope.Busy = false;
		$scope.$applyAsync();
	};


	$scope.Connect = async function ()
	{
		let adding = $scope.Adding;
		if ( !adding || !adding.Name || !adding.Tried || !adding.Tried.Ok || ( !adding.Project && !adding.Tried.SignIn ) )
		{
			return;
		}
		let picked = adding.Projects.find( function ( project ) { return project.Id === adding.Project; } ) || null;
		$scope.Busy = true;
		took( await window.Desktop.ConnectServer( { Name: adding.Name.trim(), Url: adding.Tried.Url, Project: adding.Project, Title: picked ? picked.Name : null } ) );
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
