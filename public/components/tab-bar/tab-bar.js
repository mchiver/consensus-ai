'use strict';

// tab-bar - the row above the document (plan UI Components, Step 2): the tree toggle, the strip of open items
// (one tab each, dragged to reorder, a menu with Close, Close others, Close to the right, Close all and Detach),
// and the threads toggle; in a detached window, the bar with Hide threads and Re-attach instead. The tabs
// themselves are the Tabs service's (public/js/tabs.js).
//
// Interface:
//   <tab-bar></tab-bar>
//   reads Tabs.List, Tabs.ActiveKey, Tabs.Detached, State.TreeHidden, State.ThreadsHidden; acts through Tabs,
//   Menus and State

angular.module( 'Consensus' ).component( 'tabBar', {
	templateUrl: '/components/tab-bar/tab-bar.html',
	controller: [ 'State', 'Tabs', 'Menus', 'Llms', 'Users', 'Roots', function ( State, Tabs, Menus, Llms, Users, Roots )
	{
		let controller = this;
		controller.State = State;
		controller.Tabs = Tabs;


		function root_of( tab )
		{
			return Roots.Of( tab.Root || '' ) || State.Root;
		}


		// A tab's menu: a ghosted tab can only come back or close; the others close in their ways, or detach.
		controller.OpenTabMenu = function ( tab, event )
		{
			let items = [];
			if ( Tabs.IsOut( tab.Key ) )
			{
				items.push( { Label: 'Re-attach', Icon: 'attach', Act: function () { Tabs.CallBack( tab ); } } );
				items.push( { Label: 'Close', Icon: 'x', Act: function () { Tabs.Close( tab ); } } );
				Menus.Show( items, event, 'tab:' + tab.Key );
				return;
			}
			let index = Tabs.List.indexOf( tab );
			items.push( { Label: 'Close', Icon: 'x', Act: function () { Tabs.Close( tab ); } } );
			items.push( { Label: 'Close others', Icon: 'x', Act: function () { Tabs.CloseOthers( tab ); }, Disabled: Tabs.List.length < 2 } );
			items.push( { Label: 'Close to the right', Icon: 'x', Act: function () { Tabs.CloseToTheRight( tab ); }, Disabled: index === Tabs.List.length - 1 } );
			items.push( { Label: 'Close all', Icon: 'x', Act: function () { Tabs.CloseAll(); } } );
			if ( Tabs.CanDetach( tab ) )
			{
				items.push( { Separator: true } );
				items.push( { Label: 'Detach', Icon: 'detach', Act: function () { Tabs.Detach( tab ); } } );
			}
			Menus.Show( items, event, 'tab:' + tab.Key );
		};


		controller.MenuOpenFor = function ( tab )
		{
			return Menus.IsOpenFor( 'tab:' + tab.Key );
		};


		function plan_of( tab )
		{
			let id = tab.Id;
			if ( State.Open && State.Open.Plan.Id === id && root_of( tab ) === State.Root )
			{
				return State.Open.Plan;
			}
			let root = root_of( tab );
			return root ? ( root.Plans.find( function ( plan ) { return plan.Id === id; } ) || null ) : null;
		}


		// The project whose Readme the item is, or null.
		function context_project( tab )
		{
			let root = root_of( tab );
			return root ? ( root.Projects.find( function ( candidate ) { return candidate.Context && candidate.Context.Id === tab.Id; } ) || null ) : null;
		}


		// A tab's title, found afresh each time so a rename shows at once; the last one found is kept for a reload.
		controller.Title = function ( tab )
		{
			let title = null;
			if ( tab.Kind === 'waiting' )
			{
				title = 'Waiting on you';
			}
			else if ( tab.Kind === 'llm' )
			{
				let llm = Llms.LlmById( tab.Id );
				if ( llm )
				{
					title = llm.Name;
				}
			}
			else if ( tab.Kind === 'u' )
			{
				// an account's page (plan User Management, Step 3)
				let user = Users.UserById( tab.Id );
				if ( user )
				{
					title = user.Display;
				}
			}
			else if ( tab.Kind === 'x' )
			{
				// the Explain tab of a project (plan LLM Tasks, Step 4)
				let root = root_of( tab );
				let project = root ? root.Projects.find( function ( candidate ) { return candidate.Id === tab.Id; } ) : null;
				if ( project )
				{
					title = 'Explain · ' + project.Name;
				}
			}
			else
			{
				let plan = plan_of( tab );
				let project = context_project( tab );
				if ( project )
				{
					title = 'Readme · ' + project.Name;
				}
				else if ( plan )
				{
					title = plan.Title;
				}
			}
			if ( title )
			{
				tab.Title = title;
			}
			return tab.Title || '…';
		};


		// The tab's tooltip: its title, and its server when the page shows several.
		controller.Tooltip = function ( tab )
		{
			let root = root_of( tab );
			return controller.Title( tab ) + ( ( Roots.Several() && root ) ? ' on ' + root.Name : '' ) + ( Tabs.IsOut( tab.Key ) ? ' (in its own window)' : '' );
		};


		controller.Icon = function ( tab )
		{
			if ( tab.Kind === 'waiting' )
			{
				return 'icon-waiting';
			}
			if ( tab.Kind === 'llm' || tab.Kind === 'x' )
			{
				return 'icon-llm';
			}
			if ( tab.Kind === 'u' )
			{
				return 'icon-user';
			}
			if ( context_project( tab ) )
			{
				return 'icon-context';
			}
			let plan = plan_of( tab );
			let kind = plan ? plan.Kind : 'plan';
			return ( kind === 'document' ) ? 'icon-document' : 'icon-plan';
		};


		controller.Open = function ( tab )
		{
			Tabs.Open( tab );
		};


		controller.Close = function ( tab, event )
		{
			event.stopPropagation();
			Tabs.Close( tab );
		};


		controller.Reattach = function ()
		{
			Tabs.Reattach();
		};


		// The button at the left of the strip hides or shows the project tree; its mirror at the right, the threads
		// pane (plan UI Tweaks V), shown for a plan: a document has no threads.
		controller.ToggleTree = function ()
		{
			State.SetTreeHidden( !State.TreeHidden );
		};


		controller.HasThreads = function ()
		{
			return !!State.Open && State.Open.Plan.Kind !== 'document';
		};


		controller.ToggleThreads = function ()
		{
			State.SetThreadsHidden( !State.ThreadsHidden );
		};


		controller.MoveTab = function ( key, before )
		{
			Tabs.Move( key, before );
		};
	} ],
} )


//---------------------------------------------------------------------
// tab-drag="<key>" on-tab-drop="Handler( Key, Before )": a tab dragged along the strip goes just before the tab it
// is dropped on (the left half) or just after it (the right half).

.directive( 'tabDrag', [ function ()
{
	const TYPE = 'application/x-consensus-tab';

	return {
		restrict: 'A',
		link: function ( scope, element, attributes )
		{
			let node = element[ 0 ];
			node.setAttribute( 'draggable', 'true' );

			function side( event )
			{
				let rect = node.getBoundingClientRect();
				return ( event.clientX - rect.left < rect.width / 2 ) ? 'before' : 'after';
			}

			function show( where )
			{
				node.classList.toggle( 'drop-before', where === 'before' );
				node.classList.toggle( 'drop-after', where === 'after' );
			}

			node.addEventListener( 'dragstart', function ( event )
			{
				event.dataTransfer.setData( TYPE, scope.$eval( attributes.tabDrag ) );
				event.dataTransfer.effectAllowed = 'move';
			} );
			node.addEventListener( 'dragover', function ( event )
			{
				if ( !Array.from( event.dataTransfer.types ).includes( TYPE ) )
				{
					return;
				}
				event.preventDefault();
				event.dataTransfer.dropEffect = 'move';
				show( side( event ) );
			} );
			node.addEventListener( 'dragleave', function ()
			{
				show( null );
			} );
			node.addEventListener( 'drop', function ( event )
			{
				show( null );
				if ( !Array.from( event.dataTransfer.types ).includes( TYPE ) )
				{
					return;
				}
				event.preventDefault();
				let key = event.dataTransfer.getData( TYPE );
				let here = scope.$eval( attributes.tabDrag );
				let before = here;
				if ( side( event ) === 'after' )
				{
					let next = node.nextElementSibling;
					before = ( next && next.dataset.key ) ? next.dataset.key : null;
				}
				if ( before === key )
				{
					return;
				}
				scope.$apply( function () { scope.$eval( attributes.onTabDrop, { Key: key, Before: before } ); } );
			} );
		},
	};
} ] );
