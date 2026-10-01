'use strict';

// Tabs - the open items above the document view, and the windows they can be detached into.
//
//   tab = { Key, Kind: 'p' | 'waiting', Id?, Hash, Title?, View?, Filter?, Draft? }
//     Key    'p:<id>' or 'waiting': one tab per item
//     Hash   the route that shows it (#/p/<id>, #/waiting)
//     View   read | edit | revisions, for a proposal: each tab comes back as it was left
//     Filter the threads pane's filter, for a proposal: a new tab starts at Waiting on me
//     Draft  { Text, Base }: an unsaved edit, kept while its tab is not the one shown
//
// The hash stays the route: AppController calls Visit for it, and a tab's click sets it. The tabs are kept in
// sessionStorage, so a reload brings them back and a browser restart starts clean.
//
// A detached window is the page at ?detached=1#<hash>, showing one item and no sidebar or tab strip. The windows
// talk over the BroadcastChannel "consensus-windows":
//   detached -> main   here { Key }         on load, and in answer to hello: the main window counts it as out
//   detached -> main   closed { Key }       the window is going away: its item closes
//   detached -> main   reattach { Tab }     put the tab back; the main window answers attached { Key }
//   main -> detached   hello                on load: which items are out?
//   main -> detached   focus { Key }        its item was clicked in the main window
//   main -> detached   call-back { Key }    Re-attach from the main window: the detached window re-attaches
//   main -> detached   close { Key }        Close from the main window: the detached window closes
// A re-attach that nobody answers (the main window is gone) turns the detached window into the main window.
//
// A detached tab stays in the main window's strip, ghosted: clicking it does nothing, and its menu offers Re-attach
// and Close. Each tab's menu (▾ or a right-click) closes it, the others, those to its right, or all, and detaches it.

angular.module( 'Consensus' ).factory( 'Tabs', [ '$window', '$rootScope', '$timeout', 'State', 'Menus', function ( $window, $rootScope, $timeout, State, Menus )
{
	const STORAGE_KEY = 'consensus.tabs';
	const CHANNEL_NAME = 'consensus-windows';
	const REATTACH_WAIT = 700;
	const VIEWS = [ 'read', 'edit', 'revisions' ];
	const DEFAULT_FILTER = 'mine';

	let tabs = {
		List: [],
		ActiveKey: null,
		Detached: /[?&]detached=1(&|$)/.test( $window.location.search ),
		Out: {},
	};
	let channel = null;
	let reattach_timer = null;
	let call_back_timers = {};


	//-----------------------------------------------------------------
	// Kept in this window's session only; a blocked storage keeps the tabs for this page's life.

	function load()
	{
		try
		{
			let saved = JSON.parse( $window.sessionStorage.getItem( STORAGE_KEY ) || 'null' );
			if ( saved && Array.isArray( saved.Tabs ) )
			{
				tabs.List = saved.Tabs;
				tabs.ActiveKey = saved.Active || null;
			}
		}
		catch ( error )
		{
			tabs.List = [];
		}
	}


	function save()
	{
		try
		{
			$window.sessionStorage.setItem( STORAGE_KEY, JSON.stringify( { Tabs: tabs.List, Active: tabs.ActiveKey } ) );
		}
		catch ( error )
		{
			// not kept; the tabs last as long as the page
		}
	}


	//-----------------------------------------------------------------
	// Tabs

	function find( key )
	{
		return tabs.List.find( function ( tab ) { return tab.Key === key; } ) || null;
	}


	function Active()
	{
		return find( tabs.ActiveKey );
	}


	// The key a route stands for: { Kind, Id? }
	function KeyOf( Info )
	{
		return Info.Id ? Info.Kind + ':' + Info.Id : Info.Kind;
	}


	// Visit: the tab for a route, made if it is not open, and made the active one. Info = { Kind, Id?, Hash, Query? }
	// In a detached window it is the only tab.
	function Visit( Info )
	{
		let key = KeyOf( Info );
		let tab = find( key );
		if ( !tab )
		{
			tab = { Key: key, Kind: Info.Kind, Id: Info.Id || null, Hash: Info.Hash };
			tabs.List.push( tab );
		}
		tab.Hash = Info.Hash;
		if ( Info.Query !== undefined )
		{
			tab.Query = Info.Query;
		}
		if ( tabs.Detached )
		{
			tabs.List = [ tab ];
		}
		tabs.ActiveKey = key;
		if ( tab.Kind === 'p' )
		{
			State.Filter = tab.Filter || DEFAULT_FILTER;
		}
		save();
		return tab;
	}


	// After a proposal's tab is visited and its proposal loaded: the view it was left in.
	function RestoreView( Tab )
	{
		if ( Tab && Tab.Kind === 'p' && State.OpenId === Tab.Id && Tab.View && Tab.View !== State.View )
		{
			State.SetView( Tab.View );
		}
	}


	function go( hash )
	{
		$window.location.hash = hash;
	}


	// A ghosted tab (its item is in its own window) does not open.
	function Open( Tab )
	{
		if ( IsOut( Tab.Key ) )
		{
			return;
		}
		if ( Tab.Key !== tabs.ActiveKey || $window.location.hash !== Tab.Hash )
		{
			go( Tab.Hash );
		}
	}


	// The tab to show next to one taken away from Index: the nearest after it, else before it, that is not ghosted.
	function neighbor_of( index )
	{
		for ( let at = index; at < tabs.List.length; at++ )
		{
			if ( !IsOut( tabs.List[ at ].Key ) )
			{
				return tabs.List[ at ];
			}
		}
		for ( let at = index - 1; at >= 0; at-- )
		{
			if ( !IsOut( tabs.List[ at ].Key ) )
			{
				return tabs.List[ at ];
			}
		}
		return null;
	}


	// A ghosted tab's window is told to close too.
	function Close( Tab )
	{
		let index = tabs.List.indexOf( Tab );
		if ( index < 0 )
		{
			return;
		}
		if ( IsOut( Tab.Key ) )
		{
			post( { Type: 'close', Key: Tab.Key } );
			delete tabs.Out[ Tab.Key ];
		}
		tabs.List.splice( index, 1 );
		if ( Tab.Key === tabs.ActiveKey )
		{
			let next = neighbor_of( index );
			tabs.ActiveKey = next ? next.Key : null;
			save();
			go( next ? next.Hash : '' );
			return;
		}
		save();
	}


	// Several at once: the active one last, so the strip moves on once.
	function CloseMany( List )
	{
		let active = null;
		for ( let tab of List.slice() )
		{
			if ( tab.Key === tabs.ActiveKey )
			{
				active = tab;
				continue;
			}
			Close( tab );
		}
		if ( active )
		{
			Close( active );
		}
	}


	function CloseOthers( Tab )
	{
		CloseMany( tabs.List.filter( function ( tab ) { return tab !== Tab; } ) );
		Open( Tab );
	}


	function CloseToTheRight( Tab )
	{
		CloseMany( tabs.List.slice( tabs.List.indexOf( Tab ) + 1 ) );
	}


	function CloseAll()
	{
		CloseMany( tabs.List );
	}


	// Every tab of an item that is gone (trashed here or elsewhere).
	function CloseItem( Id )
	{
		for ( let tab of tabs.List.slice() )
		{
			if ( tab.Id === Id )
			{
				Close( tab );
			}
		}
	}


	// Drag and drop in the strip: Key goes just before Before, or to the end when Before is null.
	function Move( Key, Before )
	{
		let tab = find( Key );
		if ( !tab || Key === Before )
		{
			return;
		}
		tabs.List.splice( tabs.List.indexOf( tab ), 1 );
		let at = Before ? tabs.List.findIndex( function ( candidate ) { return candidate.Key === Before; } ) : -1;
		if ( at < 0 )
		{
			tabs.List.push( tab );
		}
		else
		{
			tabs.List.splice( at, 0, tab );
		}
		save();
	}


	// The unsaved edit of the proposal Id's tab, or null to forget it.
	function SetDraft( Id, Draft )
	{
		let tab = find( 'p:' + Id );
		if ( tab )
		{
			if ( Draft )
			{
				tab.Draft = Draft;
			}
			else
			{
				delete tab.Draft;
			}
			save();
		}
	}


	function DraftOf( Id )
	{
		let tab = find( 'p:' + Id );
		return ( tab && tab.Draft ) ? tab.Draft : null;
	}


	// Each proposal's tab keeps the view it is left in.
	$rootScope.$on( 'view-changed', function ( event, view )
	{
		let tab = Active();
		if ( tab && tab.Kind === 'p' && tab.Id === State.OpenId && VIEWS.includes( view ) && tab.View !== view )
		{
			tab.View = view;
			save();
		}
	} );


	// Each proposal's tab keeps its threads filter.
	$rootScope.$watch( function () { return State.Filter; }, function ( filter )
	{
		let tab = Active();
		if ( tab && tab.Kind === 'p' && tab.Filter !== filter )
		{
			tab.Filter = filter;
			save();
		}
	} );


	//-----------------------------------------------------------------
	// Detached windows

	function post( message )
	{
		if ( channel )
		{
			channel.postMessage( message );
		}
	}


	function CanDetach( Tab )
	{
		return !tabs.Detached && ( Tab.Kind === 'p' || Tab.Kind === 'c' );
	}


	// The tab opens in its own window and stays in the strip, ghosted; the strip shows the tab beside it. The new
	// window starts from a copy of this window's session, so it finds the tab's view and draft there.
	function Detach( Tab )
	{
		save();
		let url = $window.location.pathname + '?detached=1' + Tab.Hash;
		let opened = $window.open( url, 'consensus-' + Tab.Key.replace( /[^a-z0-9]/gi, '-' ), 'popup,width=1100,height=800' );
		if ( !opened )
		{
			State.Error = 'the browser did not open the window; allow pop-ups for this page and try again';
			return false;
		}
		tabs.Out[ Tab.Key ] = true;
		if ( Tab.Key === tabs.ActiveKey )
		{
			let next = neighbor_of( tabs.List.indexOf( Tab ) );
			tabs.ActiveKey = next ? next.Key : null;
			go( next ? next.Hash : '' );
		}
		save();
		return true;
	}


	// Re-attach from the main window: its window is asked to come back. With no window to answer (it is gone), the
	// tab simply stops being ghosted.
	function CallBack( Tab )
	{
		post( { Type: 'call-back', Key: Tab.Key } );
		call_back_timers[ Tab.Key ] = $timeout( function ()
		{
			delete call_back_timers[ Tab.Key ];
			delete tabs.Out[ Tab.Key ];
			save();
			Open( Tab );
		}, REATTACH_WAIT );
	}


	function IsOut( Key )
	{
		return !!tabs.Out[ Key ];
	}


	// An item that is out was clicked here: its window comes forward, as far as the browser lets it.
	function FocusOut( Key )
	{
		post( { Type: 'focus', Key: Key } );
	}


	// In a detached window: back into the main window, or, with none to answer, become the main window.
	function Reattach()
	{
		let tab = Active();
		if ( !tab || !tabs.Detached )
		{
			return;
		}
		post( { Type: 'reattach', Tab: tab } );
		reattach_timer = $timeout( become_main, REATTACH_WAIT, false );
	}


	function become_main()
	{
		reattach_timer = null;
		let tab = Active();
		save();
		$window.location.replace( $window.location.pathname + ( tab ? tab.Hash : '' ) );
	}


	function on_message( event )
	{
		let message = event.data || {};
		if ( tabs.Detached )
		{
			let tab = Active();
			if ( !tab )
			{
				return;
			}
			if ( message.Type === 'hello' )
			{
				post( { Type: 'here', Key: tab.Key } );
			}
			else if ( message.Type === 'focus' && message.Key === tab.Key )
			{
				$window.focus();
			}
			else if ( message.Type === 'call-back' && message.Key === tab.Key )
			{
				Reattach();
			}
			else if ( message.Type === 'close' && message.Key === tab.Key )
			{
				tabs.List = [];
				$window.close();
			}
			else if ( message.Type === 'attached' && message.Key === tab.Key && reattach_timer )
			{
				$timeout.cancel( reattach_timer );
				reattach_timer = null;
				tabs.List = [];
				$window.close();
			}
			return;
		}
		$rootScope.$applyAsync( function ()
		{
			if ( message.Type === 'here' )
			{
				tabs.Out[ message.Key ] = true;
			}
			else if ( message.Type === 'closed' )
			{
				// its window is gone, and its item with it
				delete tabs.Out[ message.Key ];
				let gone = find( message.Key );
				if ( gone )
				{
					tabs.List.splice( tabs.List.indexOf( gone ), 1 );
					save();
				}
			}
			else if ( message.Type === 'reattach' && message.Tab )
			{
				let tab = message.Tab;
				delete tabs.Out[ tab.Key ];
				if ( call_back_timers[ tab.Key ] )
				{
					$timeout.cancel( call_back_timers[ tab.Key ] );
					delete call_back_timers[ tab.Key ];
				}
				// back where its ghost was, or at the end
				let open = find( tab.Key );
				if ( open )
				{
					tabs.List.splice( tabs.List.indexOf( open ), 1, tab );
				}
				else
				{
					tabs.List.push( tab );
				}
				save();
				post( { Type: 'attached', Key: tab.Key } );
				$window.focus();
				go( tab.Hash );
			}
		} );
	}


	function start()
	{
		load();
		if ( tabs.Detached )
		{
			document.body.classList.add( 'detached-window' );
		}
		if ( typeof BroadcastChannel !== 'function' )
		{
			return;
		}
		channel = new BroadcastChannel( CHANNEL_NAME );
		channel.onmessage = on_message;
		if ( tabs.Detached )
		{
			// the window says so when it goes away, unless it is only re-attaching or becoming the main window
			$window.addEventListener( 'pagehide', function ()
			{
				let tab = Active();
				if ( tab && tabs.List.length )
				{
					post( { Type: 'closed', Key: tab.Key } );
				}
			} );
		}
		else
		{
			post( { Type: 'hello' } );
		}
	}


	// A detached window, once its route is known, tells the main window it is out.
	function Announce()
	{
		let tab = Active();
		if ( tabs.Detached && tab )
		{
			post( { Type: 'here', Key: tab.Key } );
		}
	}


	start();

	tabs.KeyOf = KeyOf;
	tabs.Active = Active;
	tabs.Visit = Visit;
	tabs.RestoreView = RestoreView;
	tabs.Open = Open;
	tabs.Close = Close;
	tabs.CloseItem = CloseItem;
	tabs.CloseOthers = CloseOthers;
	tabs.CloseToTheRight = CloseToTheRight;
	tabs.CloseAll = CloseAll;
	tabs.CallBack = CallBack;
	tabs.Move = Move;
	tabs.SetDraft = SetDraft;
	tabs.DraftOf = DraftOf;
	tabs.CanDetach = CanDetach;
	tabs.Detach = Detach;
	tabs.IsOut = IsOut;
	tabs.FocusOut = FocusOut;
	tabs.Reattach = Reattach;
	tabs.Announce = Announce;
	return tabs;
} ] )


//---------------------------------------------------------------------
// TabsController: the strip, and in a detached window its Re-attach bar.

.controller( 'TabsController', [ '$scope', 'State', 'Tabs', 'Menus', function ( $scope, State, Tabs, Menus )
{
	$scope.State = State;
	$scope.Tabs = Tabs;


	// A tab's menu: a ghosted tab can only come back or close; the others close in their ways, or detach.
	$scope.OpenTabMenu = function ( tab, event )
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


	$scope.MenuOpenFor = function ( tab )
	{
		return Menus.IsOpenFor( 'tab:' + tab.Key );
	};


	function proposal_of( id )
	{
		if ( State.Open && State.Open.Proposal.Id === id )
		{
			return State.Open.Proposal;
		}
		return State.Proposals.find( function ( proposal ) { return proposal.Id === id; } ) || null;
	}


	function node_in( items, id )
	{
		for ( let node of items || [] )
		{
			if ( node.Id === id )
			{
				return node;
			}
			if ( node.Kind === 'folder' )
			{
				let found = node_in( node.Items, id );
				if ( found )
				{
					return found;
				}
			}
		}
		return null;
	}


	// A tab's title, found afresh each time so a rename shows at once; the last one found is kept for a reload.
	$scope.Title = function ( tab )
	{
		let title = null;
		if ( tab.Kind === 'waiting' )
		{
			title = 'Waiting on you';
		}
		else
		{
			let proposal = proposal_of( tab.Id );
			let project = context_project( tab.Id );
			if ( project )
			{
				title = 'Readme · ' + project.Name;
			}
			else if ( proposal )
			{
				title = proposal.Title;
			}
		}
		if ( title )
		{
			tab.Title = title;
		}
		return tab.Title || '…';
	};


	// The project whose Readme the item is, or null.
	function context_project( id )
	{
		return State.Projects.find( function ( candidate ) { return candidate.Context && candidate.Context.Id === id; } ) || null;
	}


	$scope.Icon = function ( tab )
	{
		if ( tab.Kind === 'waiting' )
		{
			return 'icon-waiting';
		}
		if ( context_project( tab.Id ) )
		{
			return 'icon-context';
		}
		let proposal = proposal_of( tab.Id );
		let kind = proposal ? proposal.Kind : 'plan';
		return ( kind === 'document' ) ? 'icon-document' : 'icon-plan';
	};


	$scope.Open = function ( tab )
	{
		Tabs.Open( tab );
	};


	$scope.Close = function ( tab, event )
	{
		event.stopPropagation();
		Tabs.Close( tab );
	};


	$scope.Reattach = function ()
	{
		Tabs.Reattach();
	};


	// The button at the left of the strip hides or shows the project tree.
	$scope.ToggleTree = function ()
	{
		State.SetTreeHidden( !State.TreeHidden );
	};


	$scope.MoveTab = function ( key, before )
	{
		Tabs.Move( key, before );
	};
} ] )


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
