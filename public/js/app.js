'use strict';

// Consensus - the one AngularJS module. State holds what every pane shares; AppController wires the
// hash routes (#/p/<id>, #/waiting, #/search/<words>) and the live stream. Every rule is on the server.

angular.module( 'Consensus', [ 'Consensus.Client', 'Consensus.Render', 'Consensus.Editor' ] )


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

.factory( 'State', [ 'Client', '$rootScope', function ( Client, $rootScope )
{
	const THREADS_HIDDEN_KEY = 'consensus.threads-hidden';
	const PREVIEW_HIDDEN_KEY = 'consensus.preview-hidden';


	// Remembered in this browser only; a blocked or empty storage falls back to the default.
	function recall( key, fallback )
	{
		try
		{
			let value = window.localStorage.getItem( key );
			return ( value === null ) ? fallback : JSON.parse( value );
		}
		catch ( error )
		{
			return fallback;
		}
	}


	function remember( key, value )
	{
		try
		{
			window.localStorage.setItem( key, JSON.stringify( value ) );
		}
		catch ( error )
		{
			// not remembered; nothing else depends on it
		}
	}


	let state = {
		ThreadsHidden: recall( THREADS_HIDDEN_KEY, false ),
		PreviewHidden: recall( PREVIEW_HIDDEN_KEY, false ),
		Me: null,
		Participants: [],
		States: [],
		Proposals: [],
		Projects: [],
		CorpusId: null,
		SearchProject: null,
		OpenId: null,
		Open: null,
		View: 'read',
		Filter: 'all',
		Selected: null,
		Compose: null,
		Reanchoring: null,
		Pending: null,
		Query: '',
		Drafts: {},
		Collapsed: {},
		Live: false,
		Error: null,
	};


	function display_of( name )
	{
		let participant = state.Participants.find( function ( candidate ) { return candidate.Name === name; } );
		return participant ? participant.Display : name;
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


	async function LoadMe()
	{
		let answer = await Client.Get( '/api/me' );
		state.Me = answer.Me;
		state.Participants = answer.Participants;
		state.States = answer.States || [];
		digest();
	}


	// The proposals (for the counts) and the projects with their trees (for the sidebar), together.
	async function LoadList()
	{
		let answers = await Promise.all( [ Client.Get( '/api/proposals' ), Client.Get( '/api/projects' ) ] );
		state.Proposals = answers[ 0 ].Proposals;
		state.Projects = answers[ 1 ].Projects;
		digest();
	}


	// OpenProposal( id ): show it; OpenProposal( null, view ): a view without a proposal (waiting, search).
	async function OpenProposal( Id, View )
	{
		if ( View !== 'corpus' )
		{
			state.CorpusId = null;
		}
		if ( !Id )
		{
			state.OpenId = null;
			state.Open = null;
			state.Selected = null;
			state.Compose = null;
			state.Reanchoring = null;
			SetView( View || 'read' );
			$rootScope.$broadcast( 'proposal-loaded' );
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
		else if ( state.View === 'waiting' || state.View === 'search' )
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
		// Switching tabs quickly can leave an older load still on its way: an answer for a proposal that is no longer
		// the open one is dropped, so it never shows over the newer one.
		let id = state.OpenId;
		try
		{
			let answer = await Client.Get( '/api/proposals/' + id );
			if ( id !== state.OpenId )
			{
				return;
			}
			state.Open = answer;
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
		$rootScope.$broadcast( 'proposal-loaded' );
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
		remember( THREADS_HIDDEN_KEY, state.ThreadsHidden );
	}


	function SetPreviewHidden( Hidden )
	{
		state.PreviewHidden = !!Hidden;
		remember( PREVIEW_HIDDEN_KEY, state.PreviewHidden );
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


	function StartCompose( Anchor )
	{
		if ( state.ThreadsHidden )
		{
			SetThreadsHidden( false );
		}
		state.Compose = { Anchor: Anchor || null, Text: '' };
		state.Reanchoring = null;
		state.Selected = null;
		SetView( 'read' );
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
		SetView( 'read' );
		Select( ThreadId );
	}


	function CancelReanchor()
	{
		state.Reanchoring = null;
	}


	// Something to do once the next proposal is loaded: select a thread, or scroll to a passage.
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
	state.LoadMe = LoadMe;
	state.LoadList = LoadList;
	state.OpenProposal = OpenProposal;
	state.Reload = Reload;
	state.SetView = SetView;
	state.SetThreadsHidden = SetThreadsHidden;
	state.SetPreviewHidden = SetPreviewHidden;
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


// A token count, short: 950, 12.4k, 3.2M.
.filter( 'tokens', [ function ()
{
	return function ( Count )
	{
		let count = Count || 0;
		if ( count < 1000 )
		{
			return String( count );
		}
		if ( count < 1000000 )
		{
			return ( count / 1000 ).toFixed( 1 ) + 'k';
		}
		return ( count / 1000000 ).toFixed( 1 ) + 'M';
	};
} ] )


.filter( 'display', [ 'State', function ( State )
{
	return function ( Name )
	{
		return State.DisplayOf( Name );
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

.controller( 'AppController', [ '$scope', '$window', 'State', 'Client', 'Tabs', function ( $scope, $window, State, Client, Tabs )
{
	$scope.State = State;


	// What a hash stands for: { Kind: 'p' | 'c' | 'waiting' | 'search', Id?, Query?, Project? }, or null.
	function route_of( hash )
	{
		let proposal = /^#\/p\/([^/]+)$/.exec( hash );
		if ( proposal )
		{
			return { Kind: 'p', Id: decodeURIComponent( proposal[ 1 ] ) };
		}
		if ( hash === '#/waiting' )
		{
			return { Kind: 'waiting' };
		}
		let corpus = /^#\/c\/([^/]+)$/.exec( hash );
		if ( corpus )
		{
			return { Kind: 'c', Id: decodeURIComponent( corpus[ 1 ] ) };
		}
		// #/search/<words> searches everything; #/search/<project>/<words> one project (the words are encoded, so
		// they hold no slash).
		let search = /^#\/search\/(?:([^/]+)\/)?(.*)$/.exec( hash );
		if ( search )
		{
			return { Kind: 'search', Project: search[ 1 ] ? decodeURIComponent( search[ 1 ] ) : null, Query: decodeURIComponent( search[ 2 ] ) };
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
			State.OpenProposal( null );
			return;
		}
		if ( Tabs.IsOut( Tabs.KeyOf( where ) ) )
		{
			Tabs.FocusOut( Tabs.KeyOf( where ) );
			let active = Tabs.Active();
			$window.history.replaceState( null, '', active ? active.Hash : '#' );
			if ( !active )
			{
				State.OpenProposal( null );
			}
			return;
		}
		let tab = Tabs.Visit( { Kind: where.Kind, Id: where.Id, Hash: hash, Query: where.Query } );
		Tabs.Announce();
		if ( where.Kind === 'p' )
		{
			State.OpenProposal( where.Id ).then( function () { Tabs.RestoreView( tab ); } );
			return;
		}
		if ( where.Kind === 'waiting' )
		{
			State.OpenProposal( null, 'waiting' );
			return;
		}
		if ( where.Kind === 'c' )
		{
			State.CorpusId = where.Id;
			State.OpenProposal( null, 'corpus' );
			return;
		}
		State.SearchProject = where.Project;
		State.Query = where.Query;
		State.OpenProposal( null, 'search' );
		$scope.$broadcast( 'search-requested', State.Query, State.SearchProject );
	}


	function on_change( event )
	{
		State.LoadList();
		if ( event.Kind === 'trashed' )
		{
			Tabs.CloseItem( event.Proposal || event.Corpus );
		}
		else if ( event.Proposal && event.Proposal === State.OpenId )
		{
			State.Reload();
		}
		$scope.$broadcast( 'changed', event );
	}


	function on_status( live )
	{
		let was_live = State.Live;
		State.Live = live;
		if ( live && !was_live )
		{
			State.LoadList();
			State.Reload();
		}
	}


	$window.addEventListener( 'hashchange', function ()
	{
		$scope.$applyAsync( route );
	} );

	State.LoadMe().then( function ()
	{
		State.LoadList();
		route();
	} );
	Client.Listen( on_change, on_status );
} ] );
