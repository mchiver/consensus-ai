'use strict';

// Tabs - the open items above the document view, and the windows they can be detached into.
//
//   tab = { Key, Kind: 'p' | 'c' | 'waiting' | 'search', Id?, Hash, Title?, Query?, View?, Draft? }
//     Key    'p:<id>', 'c:<id>', 'waiting' or 'search': one tab per item
//     Hash   the route that shows it (#/p/<id>, #/c/<id>, #/waiting, #/search/...)
//     View   read | edit | revisions, for a proposal: each tab comes back as it was left
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
// A re-attach that nobody answers (the main window is gone) turns the detached window into the main window.

angular.module( 'Consensus' ).factory( 'Tabs', [ '$window', '$rootScope', '$timeout', 'State', function ( $window, $rootScope, $timeout, State )
{
	const STORAGE_KEY = 'consensus.tabs';
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


	function Open( Tab )
	{
		if ( Tab.Key !== tabs.ActiveKey || $window.location.hash !== Tab.Hash )
		{
			go( Tab.Hash );
		}
	}


	// The tab next to one taken away, or null.
	function neighbor_of( index )
	{
		return tabs.List[ index ] || tabs.List[ index - 1 ] || null;
	}


	function Close( Tab )
	{
		let index = tabs.List.indexOf( Tab );
		if ( index < 0 )
		{
			return;
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


	// The tab opens in its own window and leaves the strip. The new window starts from a copy of this window's
	// session, so it finds the tab's view and draft there.
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
		Close( Tab );
		return true;
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
				delete tabs.Out[ message.Key ];
			}
			else if ( message.Type === 'reattach' && message.Tab )
			{
				let tab = message.Tab;
				delete tabs.Out[ tab.Key ];
				let open = find( tab.Key );
				if ( open )
				{
					tabs.List.splice( tabs.List.indexOf( open ), 1 );
				}
				tabs.List.push( tab );
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

.controller( 'TabsController', [ '$scope', 'State', 'Tabs', function ( $scope, State, Tabs )
{
	$scope.State = State;
	$scope.Tabs = Tabs;


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


	function corpus_title( id )
	{
		for ( let project of State.Projects )
		{
			let node = node_in( project.Items, id );
			if ( node && node.Title )
			{
				return node.Title;
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
		else if ( tab.Kind === 'search' )
		{
			title = 'Search: ' + ( tab.Query || '' );
		}
		else if ( tab.Kind === 'c' )
		{
			title = corpus_title( tab.Id );
		}
		else
		{
			let proposal = proposal_of( tab.Id );
			if ( proposal && proposal.Kind === 'context' )
			{
				let project = State.Projects.find( function ( candidate ) { return candidate.Context && candidate.Context.Id === tab.Id; } );
				title = 'Context' + ( project ? ' · ' + project.Name : '' );
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


	$scope.Icon = function ( tab )
	{
		if ( tab.Kind === 'c' )
		{
			return 'icon-zip';
		}
		if ( tab.Kind === 'waiting' )
		{
			return 'icon-waiting';
		}
		if ( tab.Kind === 'search' )
		{
			return 'icon-search';
		}
		let proposal = proposal_of( tab.Id );
		let kind = proposal ? proposal.Kind : 'plan';
		return ( kind === 'document' ) ? 'icon-document' : ( ( kind === 'context' ) ? 'icon-context' : 'icon-plan' );
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


	$scope.Detach = function ( tab, event )
	{
		event.stopPropagation();
		Tabs.Detach( tab );
	};


	$scope.Reattach = function ()
	{
		Tabs.Reattach();
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
