'use strict';

// Consensus - the one AngularJS module. State holds what is one at a time (the open item, the view, the selection)
// and names its root; the roots (roots.js, plan Run Shapes, Step 5) hold each server's participants, plans and
// projects. AppController wires the hash routes (#/p/<id>, #/llm/<id>, #/x/<project id> (plan LLM Tasks, Step 4: the
// Explain tab), #/waiting, under #/s/<key> for a named
// root) and each root's live stream. Every rule is on the server.

angular.module( 'Consensus', [ 'Consensus.Client', 'Consensus.Render', 'Consensus.Editor', 'Consensus.Mirror' ] )


//---------------------------------------------------------------------
// The routes are plain hashes read from $window.location. ng-include (the sidebar's tree) brings in
// $location, which would rewrite them to "#!/..." unless its prefix is empty.

.config( [ '$locationProvider', function ( $locationProvider )
{
	$locationProvider.hashPrefix( '' );
} ] )


//---------------------------------------------------------------------
// auto-focus: an input shown by ng-if takes the focus (the autofocus attribute only works on page load).

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


//---------------------------------------------------------------------
// on-file="Handler( File )" on an <input type="file">: the picked file is handed over, and the input cleared
// so the same file can be picked again.

.directive( 'onFile', [ function ()
{
	return {
		restrict: 'A',
		link: function ( scope, element, attributes )
		{
			element[ 0 ].addEventListener( 'change', function ()
			{
				let file = element[ 0 ].files[ 0 ];
				element[ 0 ].value = '';
				if ( file )
				{
					scope.$apply( function () { scope.$eval( attributes.onFile, { File: file } ); } );
				}
			} );
		},
	};
} ] )


//---------------------------------------------------------------------
// State

.factory( 'State', [ 'Client', '$rootScope', 'Roots', function ( Client, $rootScope, Roots )
{
	// The look, shared by every server (stored.js, plan UI Tweaks V). A detached window keeps whether its threads
	// are hidden to itself (plan UI Tweaks VI): it starts from the shared value and never writes it.
	const DETACHED = /[?&]detached=1(&|$)/.test( window.location.search );
	const THREADS_HIDDEN_KEY = 'threads-hidden';
	const EDITOR_KEY = 'editor';
	const PREVIEW_HIDDEN_KEY = 'preview-hidden';
	const SOURCE_KEY = 'source-mode';
	const CONFIRM_CLOSE_KEY = 'confirm-close';
	const TREE_HIDDEN_KEY = 'tree-hidden';
	const HIGHLIGHT_KEY = 'highlight';
	const FILTER_KEY = 'filter';


	function recall( key, fallback )
	{
		return window.ConsensusStored.Read( key, fallback, false );
	}


	function remember( key, value )
	{
		window.ConsensusStored.Write( key, value, false );
	}


	// The editor engine (plan UI Components, Step 3): CodeMirror, the one view (plan Markdown Editor, Step 5), unless
	// the look says Monaco, the backup with its Read and Edit views.
	function editor_setting()
	{
		return ( recall( EDITOR_KEY, 'codemirror' ) === 'monaco' ) ? 'monaco' : 'codemirror';
	}


	// The Monaco preview's hidden flag; the CodeMirror editor has no preview pane since plan Markdown Editor, Step 1.
	function preview_hidden()
	{
		return recall( PREVIEW_HIDDEN_KEY, false );
	}


	let state = {
		ThreadsHidden: recall( THREADS_HIDDEN_KEY, false ),
		Editor: editor_setting(),
		PreviewHidden: preview_hidden(),
		Source: recall( SOURCE_KEY, false ),	// the CodeMirror editor in Source mode, the plain markdown instead of the Live Preview (plan Markdown Editor, Step 1)
		ConfirmClose: recall( CONFIRM_CLOSE_KEY, true ),	// ask before the window closes, or the page is left, with unsaved edits (plan Markdown Editor, Step 4)
		TreeHidden: recall( TREE_HIDDEN_KEY, false ),
		Highlight: recall( HIGHLIGHT_KEY, 'all' ),
		Root: null,		// the root of the open item (roots.js); the first root until one is opened
		OpenId: null,
		Open: null,
		OpenItem: null,
		LastPlan: {},
		View: 'read',
		Filter: recall( FILTER_KEY, 'mine' ),	// the threads pane's filter, the same in every item (plan UI Components, Step 1)
		Selected: null,
		Compose: null,
		Reanchoring: null,
		Pending: null,
		Drafts: {},
		Editing: null,	// the edit-view's controller (Dirty, Stale, Busy, Save, Discard), read by the heading (plan Markdown Editor, Step 3)
		Collapsed: {},
		Error: null,
	};


	// The current root's participants, states, plans, projects and liveness, as every pane read them when the
	// page had one server.
	function of_root( field, fallback )
	{
		return function () { return state.Root ? state.Root[ field ] : fallback; };
	}

	Object.defineProperty( state, 'Me', { get: of_root( 'Me', null ), enumerable: true } );
	Object.defineProperty( state, 'Participants', { get: of_root( 'Participants', [] ), enumerable: true } );
	Object.defineProperty( state, 'States', { get: of_root( 'States', [] ), enumerable: true } );
	Object.defineProperty( state, 'Plans', { get: of_root( 'Plans', [] ), enumerable: true } );
	Object.defineProperty( state, 'Projects', { get: of_root( 'Projects', [] ), enumerable: true } );
	Object.defineProperty( state, 'Live', { get: of_root( 'Live', false ), enumerable: true } );


	// SetRoot: the root the open item belongs to; the calls without a root go there from now on.
	function SetRoot( Root )
	{
		if ( Root === state.Root )
		{
			return;
		}
		state.Root = Root || null;
		Client.SetCurrent( state.Root ? state.Root.Base : '' );
		$rootScope.$broadcast( 'root-changed', state.Root );
	}


	function display_of( name )
	{
		let participant = state.Participants.find( function ( candidate ) { return candidate.Name === name; } );
		return participant ? participant.Display : name;
	}


	// The byline of a record (a reply, a resolve, an apply, a revision, a run): "<Service> by <Display>", or the
	// display alone (plan User Management, Step 2).
	function byline_of( record )
	{
		if ( !record || !record.By )
		{
			return '';
		}
		let who = display_of( record.By );
		return record.Service ? record.Service + ' by ' + who : who;
	}


	function fail( error )
	{
		state.Error = error.message || String( error );
		if ( error.Status === 409 && state.OpenId )
		{
			return Reload();
		}
		return null;
	}


	function clear_error()
	{
		state.Error = null;
	}


	// Loads run as native async functions, outside Angular's digest: each ends with a digest.
	function digest()
	{
		$rootScope.$applyAsync();
	}


	// The current root's identity and lists (roots.js holds them per root).
	async function LoadMe()
	{
		if ( state.Root )
		{
			await Roots.LoadMe( state.Root );
		}
	}


	async function LoadList()
	{
		if ( state.Root )
		{
			await Roots.LoadList( state.Root );
		}
	}


	// OpenPlan( id, view, root ): show it, on its root; OpenPlan( null, view ): a view without a plan
	// (waiting, an LLM connection).
	async function OpenPlan( Id, View, Root )
	{
		if ( Root && Root !== state.Root )
		{
			SetRoot( Root );
			state.OpenId = null;
			state.Open = null;
		}
		if ( !Id )
		{
			state.OpenId = null;
			state.Open = null;
			state.Selected = null;
			state.Compose = null;
			state.Reanchoring = null;
			SetView( View || 'read' );
			$rootScope.$broadcast( 'plan-loaded' );
			digest();
			return;
		}
		if ( Id !== state.OpenId )
		{
			state.Selected = null;
			state.Compose = null;
			state.Reanchoring = null;
			SetView( 'read' );
		}
		else if ( state.View === 'waiting' || state.View === 'x' )
		{
			SetView( 'read' );
		}
		state.OpenId = Id;
		await Reload();
	}


	async function Reload()
	{
		if ( !state.OpenId )
		{
			return;
		}
		// Switching tabs quickly can leave an older load still on its way: an answer for a plan that is no longer
		// the open one is dropped, so it never shows over the newer one.
		let id = state.OpenId;
		try
		{
			let answer = await Client.Get( '/api/plans/' + id );
			if ( id !== state.OpenId )
			{
				return;
			}
			state.Open = answer;
			if ( answer.Project && answer.Plan && answer.Plan.Kind !== 'document' )
			{
				state.LastPlan[ answer.Project.Id ] = id;
			}
			clear_error();
		}
		catch ( error )
		{
			if ( id !== state.OpenId )
			{
				return;
			}
			state.Open = null;
			state.Error = error.message;
		}
		$rootScope.$broadcast( 'plan-loaded' );
		digest();
	}


	function SetView( View )
	{
		if ( state.View === View )
		{
			return;
		}
		state.View = View;
		$rootScope.$broadcast( 'view-changed', View );
	}


	// The threads pane and the edit preview, each shown or hidden, remembered in this browser.
	function SetThreadsHidden( Hidden )
	{
		state.ThreadsHidden = !!Hidden;
		if ( !DETACHED )
		{
			remember( THREADS_HIDDEN_KEY, state.ThreadsHidden );
		}
	}


	function SetPreviewHidden( Hidden )
	{
		state.PreviewHidden = !!Hidden;
		remember( PREVIEW_HIDDEN_KEY, state.PreviewHidden );
	}


	// Confirm on close, remembered in this browser; the drafts come back either way, so off loses nothing.
	function SetConfirmClose( On )
	{
		state.ConfirmClose = !!On;
		remember( CONFIRM_CLOSE_KEY, state.ConfirmClose );
	}


	// Source mode in the CodeMirror editor, remembered in this browser; the open editor switches at once (edit-view).
	function SetSource( On )
	{
		state.Source = !!On;
		remember( SOURCE_KEY, state.Source );
		$rootScope.$broadcast( 'source-changed', state.Source );
	}


	// The editor engine, remembered in this browser; the Edit view takes it when it next opens, the comment boxes as
	// they appear.
	function SetEditor( Name )
	{
		state.Editor = ( Name === 'codemirror' ) ? 'codemirror' : 'monaco';
		remember( EDITOR_KEY, state.Editor );
		$rootScope.$broadcast( 'editor-changed', state.Editor );
	}


	// The project tree shown or hidden, remembered in this browser.
	function SetTreeHidden( Hidden )
	{
		state.TreeHidden = !!Hidden;
		remember( TREE_HIDDEN_KEY, state.TreeHidden );
	}


	// Which anchored passages the read view highlights: 'all' threads, or only the 'open' (contested) ones.
	function SetHighlight( Highlight )
	{
		state.Highlight = ( Highlight === 'open' ) ? 'open' : 'all';
		remember( HIGHLIGHT_KEY, state.Highlight );
		$rootScope.$broadcast( 'highlight-changed' );
	}


	// Which threads the pane lists, the same for every item and remembered in this browser (plan UI Components,
	// Step 1); the views that show threads listen to filter-changed.
	function SetFilter( Filter )
	{
		state.Filter = Filter || 'mine';
		remember( FILTER_KEY, state.Filter );
		$rootScope.$broadcast( 'filter-changed' );
	}


	// Selecting a thread shows the threads pane, so the thread is in view.
	function Select( ThreadId )
	{
		state.Selected = ThreadId;
		if ( ThreadId && state.ThreadsHidden )
		{
			SetThreadsHidden( false );
		}
		$rootScope.$broadcast( 'thread-selected', ThreadId );
	}


	// The CodeMirror editor is the view shown (plan Markdown Editor, Step 3): in CodeMirror mode Read and Edit are
	// both the one editor, which also does what the Read view does with the threads (Step 2), so a comment or a
	// re-anchor started while it is shown stays in it. EditorShown is that, or Monaco's Edit view.
	function MirrorShown()
	{
		return state.Editor === 'codemirror' && ( state.View === 'read' || state.View === 'edit' );
	}


	function EditorShown()
	{
		return MirrorShown() || state.View === 'edit';
	}


	function StartCompose( Anchor )
	{
		if ( state.ThreadsHidden )
		{
			SetThreadsHidden( false );
		}
		state.Compose = { Anchor: Anchor || null, Text: '' };
		state.Reanchoring = null;
		state.Selected = null;
		if ( !MirrorShown() )
		{
			SetView( 'read' );
		}
		$rootScope.$broadcast( 'compose-started' );
	}


	function CancelCompose()
	{
		state.Compose = null;
	}


	function StartReanchor( ThreadId )
	{
		state.Reanchoring = ThreadId;
		state.Compose = null;
		if ( !MirrorShown() )
		{
			SetView( 'read' );
		}
		Select( ThreadId );
	}


	function CancelReanchor()
	{
		state.Reanchoring = null;
	}


	// Something to do once the next plan is loaded: select a thread, or scroll to a passage.
	function Pend( What )
	{
		state.Pending = What;
	}


	// Act: run a request; errors land in the state, and a 409 reloads what changed.
	async function Act( Work )
	{
		clear_error();
		try
		{
			let result = await Work();
			return result;
		}
		catch ( error )
		{
			await fail( error );
			return null;
		}
	}


	state.DisplayOf = display_of;
	state.BylineOf = byline_of;
	state.SetRoot = SetRoot;
	state.LoadMe = LoadMe;
	state.LoadList = LoadList;
	state.OpenPlan = OpenPlan;
	state.Reload = Reload;
	state.SetView = SetView;
	state.SetThreadsHidden = SetThreadsHidden;
	state.SetPreviewHidden = SetPreviewHidden;
	state.SetEditor = SetEditor;
	state.SetSource = SetSource;
	state.SetConfirmClose = SetConfirmClose;
	state.MirrorShown = MirrorShown;
	state.EditorShown = EditorShown;
	state.SetTreeHidden = SetTreeHidden;
	state.SetHighlight = SetHighlight;
	state.SetFilter = SetFilter;
	state.Select = Select;
	state.StartCompose = StartCompose;
	state.CancelCompose = CancelCompose;
	state.StartReanchor = StartReanchor;
	state.CancelReanchor = CancelReanchor;
	state.Pend = Pend;
	state.Act = Act;
	state.ClearError = clear_error;
	return state;
} ] )


//---------------------------------------------------------------------
// Filters

.filter( 'when', [ function ()
{
	return function ( Value )
	{
		if ( !Value )
		{
			return '';
		}
		let date = new Date( Value );
		let today = new Date();
		let same_day = ( date.toDateString() === today.toDateString() );
		let time = date.toLocaleTimeString( [], { hour: '2-digit', minute: '2-digit' } );
		if ( same_day )
		{
			return time;
		}
		return date.toLocaleDateString( [], { month: 'short', day: 'numeric' } ) + ' ' + time;
	};
} ] )


// A reply's time with a day word: "today 07:22", "yesterday 07:22", "last week 07:22", or "Sep 12 07:22".
.filter( 'stamp', [ function ()
{
	const DAY_LENGTH = 24 * 60 * 60 * 1000;

	return function ( Value )
	{
		if ( !Value )
		{
			return '';
		}
		let date = new Date( Value );
		let today = new Date();
		let time = date.toLocaleTimeString( [], { hour: '2-digit', minute: '2-digit' } );
		let date_midnight = new Date( date.getFullYear(), date.getMonth(), date.getDate() );
		let today_midnight = new Date( today.getFullYear(), today.getMonth(), today.getDate() );
		let days_ago = Math.round( ( today_midnight - date_midnight ) / DAY_LENGTH );
		if ( days_ago === 0 )
		{
			return 'today ' + time;
		}
		if ( days_ago === 1 )
		{
			return 'yesterday ' + time;
		}
		if ( days_ago > 1 && days_ago < 7 )
		{
			return 'last week ' + time;
		}
		let date_options = { month: 'short', day: 'numeric' };
		if ( date.getFullYear() !== today.getFullYear() )
		{
			date_options.year = 'numeric';
		}
		return date.toLocaleDateString( [], date_options ) + ' ' + time;
	};
} ] )


// The local date alone, for the tree's sorted rows: "2026-09-24".
.filter( 'day', [ function ()
{
	return function ( Value )
	{
		if ( !Value )
		{
			return '';
		}
		let date = new Date( Value );
		let month = String( date.getMonth() + 1 ).padStart( 2, '0' );
		let day = String( date.getDate() ).padStart( 2, '0' );
		return date.getFullYear() + '-' + month + '-' + day;
	};
} ] )


// The full timestamp, for a tooltip: "Thursday, September 24, 2026, 07:22:25".
.filter( 'fullstamp', [ function ()
{
	return function ( Value )
	{
		if ( !Value )
		{
			return '';
		}
		let date = new Date( Value );
		let date_options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
		let time_options = { hour: '2-digit', minute: '2-digit', second: '2-digit' };
		return date.toLocaleDateString( [], date_options ) + ', ' + date.toLocaleTimeString( [], time_options );
	};
} ] )


.filter( 'display', [ 'State', function ( State )
{
	return function ( Name )
	{
		return State.DisplayOf( Name );
	};
} ] )


// The byline of a record: "<Service> by <Display>", or the display alone.
.filter( 'byline', [ 'State', function ( State )
{
	return function ( Record )
	{
		return State.BylineOf( Record );
	};
} ] )


// A reply's markdown as trusted html; a single line break stays a line break, as typed.
.filter( 'markdown', [ '$sce', function ( $sce )
{
	return function ( Text )
	{
		let html = marked.parse( Text || '', { breaks: true } );
		return $sce.trustAsHtml( html );
	};
} ] )


//---------------------------------------------------------------------
// AppController: the routes and the live stream.

.controller( 'AppController', [ '$scope', '$window', 'State', 'Client', 'Tabs', 'Llms', 'Roots', function ( $scope, $window, State, Client, Tabs, Llms, Roots )
{
	$scope.State = State;
	$scope.Roots = Roots;


	// What a hash stands for: { Kind: 'p' | 'waiting' | 'llm', Id?, Root }, or null. A route under #/s/<key> names its
	// root; one without (a browser's, or a link in a text) means the current root.
	function route_of( hash )
	{
		let root = State.Root || Roots.List[ 0 ] || null;
		let rest = hash;
		let scoped = /^#\/s\/([^/]+)(\/.*)?$/.exec( hash );
		if ( scoped )
		{
			root = Roots.Of( decodeURIComponent( scoped[ 1 ] ) );
			rest = '#' + ( scoped[ 2 ] || '' );
		}
		if ( !root )
		{
			return null;
		}
		let plan = /^#\/p\/([^/]+)$/.exec( rest );
		if ( plan )
		{
			return { Kind: 'p', Id: decodeURIComponent( plan[ 1 ] ), Root: root };
		}
		let llm = /^#\/llm\/([^/]+)$/.exec( rest );
		if ( llm )
		{
			return { Kind: 'llm', Id: decodeURIComponent( llm[ 1 ] ), Root: root };
		}
		let explain = /^#\/x\/([^/]+)$/.exec( rest );
		if ( explain )
		{
			return { Kind: 'x', Id: decodeURIComponent( explain[ 1 ] ), Root: root };
		}
		if ( rest === '#/waiting' )
		{
			return { Kind: 'waiting', Root: root };
		}
		return null;
	}


	// Every route is a tab. An item open in a detached window is brought forward there instead; no route shows the
	// last tab, or the start page when there are no tabs.
	function route()
	{
		let hash = $window.location.hash;
		let where = route_of( hash );
		if ( !where )
		{
			let last = Tabs.Active() || Tabs.List[ Tabs.List.length - 1 ];
			if ( last )
			{
				$window.location.replace( last.Hash );
				return;
			}
			State.OpenPlan( null );
			return;
		}
		let info = { Kind: where.Kind, Id: where.Id, Root: where.Root.Key, Hash: hash };
		if ( Tabs.IsOut( Tabs.KeyOf( info ) ) )
		{
			Tabs.FocusOut( Tabs.KeyOf( info ) );
			let active = Tabs.Active();
			$window.history.replaceState( null, '', active ? active.Hash : '#' );
			if ( !active )
			{
				State.OpenPlan( null );
			}
			return;
		}
		let tab = Tabs.Visit( info );
		Tabs.Announce();
		State.OpenItem = null;
		if ( where.Kind === 'p' )
		{
			State.OpenPlan( where.Id, undefined, where.Root ).then( function () { Tabs.RestoreView( tab ); } );
			return;
		}
		if ( where.Kind === 'llm' )
		{
			State.SetRoot( where.Root );
			State.OpenItem = { Kind: 'llm', Id: where.Id, Root: where.Root.Key };
			State.OpenPlan( null, 'llm' );
			return;
		}
		if ( where.Kind === 'x' )
		{
			State.SetRoot( where.Root );
			State.OpenItem = { Kind: 'x', Id: where.Id, Root: where.Root.Key };
			State.OpenPlan( null, 'x' );
			return;
		}
		State.OpenPlan( null, 'waiting' );
	}


	// A change on one root: its lists follow; the open item reloads when it is that root's.
	function on_change( root, event )
	{
		if ( event.Settings )
		{
			Roots.LoadMe( root );
			return;
		}
		// the server's LLM connections and their runs (plan Run Shapes, Step 3)
		if ( event.Kind === 'llms' )
		{
			Llms.For( root ).Reload();
			Roots.LoadMe( root );
			return;
		}
		if ( event.Kind === 'run' )
		{
			Llms.RunChanged( root, event );
			return;
		}
		Roots.LoadList( root );
		if ( event.Kind === 'trashed' )
		{
			Tabs.CloseItem( event.Plan, root.Key );
		}
		else if ( event.Plan && event.Plan === State.OpenId && root === State.Root )
		{
			State.Reload();
		}
		$scope.$broadcast( 'changed', event, root );
	}


	// A root's stream connected: its lists are read afresh (the first time, and after a drop).
	function on_status( root, live )
	{
		if ( live )
		{
			Roots.LoadMe( root ).then( function ()
			{
				Roots.LoadList( root );
				Llms.For( root ).Reload();
				if ( root === State.Root )
				{
					State.Reload();
				}
			} );
		}
	}


	$window.addEventListener( 'hashchange', function ()
	{
		$scope.$applyAsync( route );
	} );

	// The first root is the current one until an item of another opens; the route is read once its identity is known,
	// and every root's stream brings its lists in as it connects.
	State.SetRoot( Roots.List[ 0 ] || null );
	State.LoadMe().then( route );
	for ( let root of Roots.List )
	{
		Roots.Listen( root, function ( event ) { on_change( root, event ); }, function ( live ) { on_status( root, live ); } );
	}
} ] );
