'use strict';

// title-bar - the bar across the top of the page (plan UI Components, Step 5): the brand, the application menu
// (About and Hotkeys; in the desktop also Servers…, New window, Open folder in new window…, Reload and Quit), the
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
	controller: [ '$scope', '$element', '$window', 'State', 'Roots', 'Llms', 'Menus', 'HelpPanel', 'Session', function ( $scope, $element, $window, State, Roots, Llms, Menus, HelpPanel, Session )
	{
		const MENU_KEY = 'app';
		let controller = this;
		controller.Session = Session;
		let desktop = ( $window.Desktop && typeof $window.Desktop.Servers === 'function' ) ? $window.Desktop : null;
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
				items.push( { Separator: true } );
				items.push( { Label: 'Servers…', Icon: 'link', Act: function () { desktop.Servers(); } } );
				items.push( { Label: 'New window', Icon: 'detach', Act: function () { desktop.NewWindow(); } } );
				if ( typeof desktop.OpenFolderWindow === 'function' )
				{
					items.push( { Label: 'Open folder in new window…', Icon: 'detach', Act: function () { desktop.OpenFolderWindow(); } } );
				}
				items.push( { Label: 'Reload', Icon: 'refresh', Act: function () { $window.location.reload(); } } );
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
