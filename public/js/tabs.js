'use strict';

// Tabs - the open items above the document view, and the windows they can be detached into.
//
//   tab = { Key, Kind: 'p' | 'waiting' | 'llm', Id?, Root, Hash, Title?, View?, Draft? }
//     Key    'p:<id>' or 'waiting': one tab per item; 'llm:<id>' for an LLM connection (plan Run Shapes, Step 3);
//            '<root>|p:<id>' on a named root (plan Run Shapes, Step 5: Root is the root's key, '' in a browser)
//     Hash   the route that shows it (#/p/<id>, #/waiting, #/s/<root>/p/<id>)
//     View   read | edit | revisions, for a plan: each tab comes back as it was left
//     Draft  { Text, Base }: an unsaved edit, kept while its tab is not the one shown
//
// The hash stays the route: AppController calls Visit for it, and a tab's click sets it. The tabs are kept once per
// window (stored.js: localStorage in a browser, the config in the desktop), so a restart brings them back.
// The strip itself is the tab-bar component (public/components/tab-bar, plan UI Components, Step 2).
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

angular.module( 'Consensus' ).factory( 'Tabs', [ '$window', '$rootScope', '$timeout', 'State', 'Menus', 'Client', 'Roots', function ( $window, $rootScope, $timeout, State, Menus, Client, Roots )
{
	const STORAGE_KEY = 'tabs';		// once per window (stored.js); a detached window keeps its one tab in its session
	const CHANNEL_NAME = 'consensus-windows';
	const REATTACH_WAIT = 700;
	const VIEWS = [ 'read', 'edit', 'revisions' ];

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
	// The main window's tabs are kept once per window (plan UI Tweaks V; per server before plan Run Shapes, Step 5,
	// since a window spans servers now), so a restart brings them back; a detached window keeps its one tab in its own
	// session, as before. A tab of a root the page does not have (a server removed) is dropped. A blocked storage keeps
	// the tabs for this page's life.

	function load()
	{
		let saved = null;
		if ( tabs.Detached )
		{
			try
			{
				saved = JSON.parse( $window.sessionStorage.getItem( 'consensus.' + STORAGE_KEY ) || 'null' );
			}
			catch ( error )
			{
				saved = null;
			}
		}
		else
		{
			saved = window.ConsensusStored.Read( STORAGE_KEY, null, false );
		}
		if ( saved && Array.isArray( saved.Tabs ) )
		{
			tabs.List = saved.Tabs.filter( function ( tab ) { return !!Roots.Of( tab.Root || '' ); } );
			for ( let tab of tabs.List )
			{
				tab.Root = tab.Root || '';
			}
			tabs.ActiveKey = saved.Active || null;
		}
	}


	function save()
	{
		let saved = { Tabs: tabs.List, Active: tabs.ActiveKey };
		if ( tabs.Detached )
		{
			try
			{
				$window.sessionStorage.setItem( 'consensus.' + STORAGE_KEY, JSON.stringify( saved ) );
			}
			catch ( error )
			{
				// not kept; the tab lasts as long as the window
			}
			return;
		}
		window.ConsensusStored.Write( STORAGE_KEY, saved, false );
	}


	// A remembered tab whose plan is in no project any more (deleted while the app was closed) is dropped
	// silently once the projects are loaded; the strip moves to a neighbour when it was the active one. A tab the list
	// does not know may be newer than the list (made a moment ago, or opened by link) or archived (plan Run Shapes,
	// Step 2), so only the server's 404 closes it.
	function prune( root )
	{
		let projects = root.Projects;
		if ( !Array.isArray( projects ) || !projects.length )
		{
			return;
		}
		let known = {};
		function walk( items )
		{
			for ( let node of items || [] )
			{
				known[ node.Id ] = true;
				walk( node.Items );
			}
		}
		for ( let project of projects )
		{
			if ( project.Context && project.Context.Id )
			{
				known[ project.Context.Id ] = true;
			}
			walk( project.Items );
			walk( project.Archive );
		}
		let doubtful = tabs.List.filter( function ( tab ) { return tab.Kind === 'p' && tab.Root === root.Key && !known[ tab.Id ]; } );
		if ( !doubtful.length )
		{
			return;
		}
		Promise.all( doubtful.map( function ( tab )
		{
			return Client.Get( root, '/api/plans/' + encodeURIComponent( tab.Id ) ).then( function () { return null; }, function ( error ) { return ( error.Status === 404 ) ? tab : null; } );
		} ) ).then( function ( results )
		{
			let gone = results.filter( function ( tab ) { return tab && tabs.List.includes( tab ); } );
			if ( gone.length )
			{
				CloseMany( gone );
				$rootScope.$applyAsync();
			}
		} );
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


	// The key a route stands for: { Kind, Id?, Root? }
	function KeyOf( Info )
	{
		let item = Info.Id ? Info.Kind + ':' + Info.Id : Info.Kind;
		return Info.Root ? Info.Root + '|' + item : item;
	}


	// The tab of an item on a root (the current one when none is named), or null.
	function find_item( kind, id, root_key )
	{
		let key = ( root_key === undefined ) ? ( State.Root ? State.Root.Key : '' ) : root_key;
		return tabs.List.find( function ( tab ) { return tab.Kind === kind && tab.Id === id && tab.Root === key; } ) || null;
	}


	// Visit: the tab for a route, made if it is not open, and made the active one. Info = { Kind, Id?, Root?, Hash,
	// Query? }. In a detached window it is the only tab.
	function Visit( Info )
	{
		let key = KeyOf( Info );
		let tab = find( key );
		if ( !tab )
		{
			tab = { Key: key, Kind: Info.Kind, Id: Info.Id || null, Root: Info.Root || '', Hash: Info.Hash };
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
		save();
		return tab;
	}


	// After a plan's tab is visited and its plan loaded: the view it was left in.
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


	// Every tab of an item that is gone (trashed here or elsewhere), on the root named (every root when none is).
	function CloseItem( Id, RootKey )
	{
		for ( let tab of tabs.List.slice() )
		{
			if ( tab.Id === Id && ( RootKey === undefined || tab.Root === RootKey ) )
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


	// The unsaved edit of the plan Id's tab, or null to forget it.
	function SetDraft( Id, Draft )
	{
		let tab = find_item( 'p', Id );
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
		let tab = find_item( 'p', Id );
		return ( tab && tab.Draft ) ? tab.Draft : null;
	}


	// Each plan's tab keeps the view it is left in.
	$rootScope.$on( 'view-changed', function ( event, view )
	{
		let tab = Active();
		if ( tab && tab.Kind === 'p' && tab.Id === State.OpenId && VIEWS.includes( view ) && tab.View !== view )
		{
			tab.View = view;
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
		return !tabs.Detached && ( Tab.Kind === 'p' || Tab.Kind === 'c' || Tab.Kind === 'llm' );
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

	// Each root's projects, as they load: the tabs of items that are gone close.
	$rootScope.$watchCollection( function () { return Roots.List.map( function ( root ) { return root.Projects; } ); }, function ()
	{
		for ( let root of Roots.List )
		{
			prune( root );
		}
	} );

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
} ] );
