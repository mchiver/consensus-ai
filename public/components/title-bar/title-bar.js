'use strict';

// title-bar - the bar across the top of the page (plan UI Components, Step 5): the brand, the application menu
// (About and Hotkeys; in the desktop also New window, Open folder in new window…, the recent folders, Settings, Reload
// and Quit: plan Rearchitecturation, Step 2), the
// status (Waiting on you over every root, and Running while an LLM run is in progress on any root, each a link to
// its view) and the look button, whose popover holds look-controls. In the desktop the bar is the window's title
// bar: Electron draws the window buttons over its right end (titleBarOverlay, desktop/main.js), the bar is the drag
// region, and it tells the desktop its colours and height (ConsensusDesktop.SetChrome) once drawn and after every
// change of theme or size, so the buttons follow the palette. A browser shows the same bar as a plain top bar.
//
// Interface:
//   <title-bar></title-bar>
//   reads State.View, Roots.List (the waiting tallies), Llms.For( root ).Running, Session.SignedIn() (plan User
//   Management, Step 4: Clerk's user button mounted when someone is signed in); opens the Menus popup and the
//   HelpPanel popups; hears consensus-theme on the document; calls window.Desktop (the menu's desktop items) and
//   window.ConsensusDesktop.SetChrome when the desktop is the host

angular.module( 'Consensus' ).component( 'titleBar', {
	templateUrl: '/components/title-bar/title-bar.html',
	controller: [ '$scope', '$element', '$window', 'State', 'Roots', 'Llms', 'Menus', 'HelpPanel', 'Session', 'Tree', function ( $scope, $element, $window, State, Roots, Llms, Menus, HelpPanel, Session, Tree )
	{
		const MENU_KEY = 'app';
		const RECENT_SHOWN = 5;		// the recent folders the desktop's menu lists (plan Rearchitecturation, Step 2)
		let controller = this;
		controller.Session = Session;
		let desktop = ( $window.Desktop && typeof $window.Desktop.NewWindow === 'function' ) ? $window.Desktop : null;
		controller.State = State;
		controller.LookOpen = false;


		//-----------------------------------------------------------------
		// The status

		// Waiting on you, over every root, each with its own participant.
		controller.WaitingCount = function ()
		{
			let count = 0;
			for ( let root of Roots.List )
			{
				let name = root.Me ? root.Me.Name : null;
				for ( let plan of root.Plans )
				{
					count += ( plan.Tally.WaitingOn[ name ] || 0 );
				}
			}
			return count;
		};


		// The runs in progress over every root: [ { Root, Id } ], Id the connection's.
		function running_runs()
		{
			let list = [];
			for ( let root of Roots.List )
			{
				let running = Llms.For( root ).Running;
				for ( let id of Object.keys( running ) )
				{
					list.push( { Root: root, Id: id } );
				}
			}
			return list;
		}


		controller.RunningCount = function ()
		{
			return running_runs().length;
		};


		// The first running run's LLM page.
		controller.RunningHref = function ()
		{
			let first = running_runs()[ 0 ];
			if ( !first )
			{
				return '';
			}
			return Roots.HashFor( first.Root, '/llm/' + encodeURIComponent( first.Id ) );
		};


		// Every running connection and its server, for the tooltip.
		controller.RunningTitle = function ()
		{
			let names = [];
			for ( let entry of running_runs() )
			{
				let llm = Llms.For( entry.Root ).Llms.find( function ( candidate ) { return candidate.Id === entry.Id; } );
				names.push( ( llm ? llm.Name : entry.Id ) + ' on ' + entry.Root.Name );
			}
			return 'running: ' + names.join( ', ' );
		};


		//-----------------------------------------------------------------
		// The application menu

		controller.OpenMenu = function ( event )
		{
			let items = [
				{ Label: 'About', Icon: 'info', Act: function () { HelpPanel.Show( 'about' ); } },
				{ Label: 'Hotkeys', Icon: 'keyboard', Act: function () { HelpPanel.Show( 'hotkeys' ); } },
			];
			if ( desktop )
			{
				// A window is one project (plan Rearchitecturation, Step 2): New window opens the chooser in another instance,
				// Open folder and the recent folders another instance on that folder; Settings is the window's server's.
				items.push( { Separator: true } );
				items.push( { Label: 'New window', Icon: 'detach', Act: function () { desktop.NewWindow(); } } );
				if ( typeof desktop.OpenFolderWindow === 'function' )
				{
					items.push( { Label: 'Open folder in new window…', Icon: 'detach', Act: function () { desktop.OpenFolderWindow(); } } );
				}
				let recent = ( $window.ConsensusDesktop && Array.isArray( $window.ConsensusDesktop.Recent ) ) ? $window.ConsensusDesktop.Recent : [];
				let current = ( $window.ConsensusDesktop && $window.ConsensusDesktop.Project ) ? $window.ConsensusDesktop.Project.Path : null;
				for ( let entry of recent.filter( function ( one ) { return one.Path !== current; } ).slice( 0, RECENT_SHOWN ) )
				{
					items.push( { Label: 'Open ' + entry.Path.split( /[\\/]/ ).filter( Boolean ).pop() + ' in new window', Icon: 'detach', Act: function () { desktop.OpenRecent( entry.Path ); } } );
				}
				items.push( { Separator: true } );
				let root = Roots.List[ 0 ] || null;
				if ( root && root.Manage === true )
				{
					items.push( { Label: 'Settings', Icon: 'settings', Act: function () { Tree.OpenSettings( root ); } } );
				}
				// The account (plan Rearchitecturation, Step 6): Sign in loads Clerk's box, as the Settings popup's button does;
				// signed in, Sign out; the tier the desktop is at is in About.
				if ( Session.On && !Session.SignedIn() )
				{
					items.push( { Label: 'Sign in…', Icon: 'info', Act: function () { Session.Open(); } } );
				}
				else if ( Session.SignedIn() )
				{
					items.push( { Label: 'Sign out', Icon: 'info', Act: function () { Session.SignOut(); } } );
				}
				items.push( { Label: 'Reload', Icon: 'refresh', Act: function () { $window.location.reload(); } } );
				// The Desktop starts no Server (plan The Server, Step 4): the Server is an application of its own.
				if ( typeof desktop.Quit === 'function' )
				{
					items.push( { Separator: true } );
					items.push( { Label: 'Quit', Icon: 'x', Act: function () { desktop.Quit(); } } );
				}
			}
			Menus.Show( items, event, MENU_KEY );
		};


		controller.MenuOpen = function ()
		{
			return Menus.IsOpenFor( MENU_KEY );
		};


		//-----------------------------------------------------------------
		// The look popover: opened by its button, closed by a click elsewhere, Escape or the button again.

		controller.ToggleLook = function ( event )
		{
			event.stopPropagation();
			controller.LookOpen = !controller.LookOpen;
		};


		function close_look()
		{
			if ( controller.LookOpen )
			{
				controller.LookOpen = false;
				$scope.$applyAsync();
			}
		}


		function on_mousedown( event )
		{
			if ( !controller.LookOpen )
			{
				return;
			}
			let popover = $element[ 0 ].querySelector( '#look-popover' );
			let button = $element[ 0 ].querySelector( '#look-button' );
			if ( ( popover && popover.contains( event.target ) ) || ( button && button.contains( event.target ) ) )
			{
				return;
			}
			close_look();
		}


		function on_keydown( event )
		{
			if ( event.key === 'Escape' )
			{
				close_look();
			}
		}


		//-----------------------------------------------------------------
		// The desktop's window buttons follow the bar: its colours and height, once drawn and after every change of
		// theme or size (ConsensusTheme.ReportChrome, theme.js), so Electron's overlay matches the palette.

		function report_chrome()
		{
			$window.ConsensusTheme.ReportChrome( $element[ 0 ] );
		}


		function report_chrome_soon()
		{
			$window.requestAnimationFrame( report_chrome );
		}


		controller.$postLink = function ()
		{
			report_chrome_soon();
		};


		document.addEventListener( 'mousedown', on_mousedown, true );
		document.addEventListener( 'keydown', on_keydown );
		document.addEventListener( 'consensus-theme', report_chrome_soon );

		controller.$onDestroy = function ()
		{
			document.removeEventListener( 'mousedown', on_mousedown, true );
			document.removeEventListener( 'keydown', on_keydown );
			document.removeEventListener( 'consensus-theme', report_chrome_soon );
		};
	} ],
} );
