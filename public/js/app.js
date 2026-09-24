'use strict';

// Consensus - the one AngularJS module. State holds what every pane shares; AppController wires the
// hash routes (#/p/<id>, #/waiting, #/search/<words>) and the live stream. Every rule is on the server.

angular.module( 'Consensus', [ 'Consensus.Client', 'Consensus.Render', 'Consensus.Editor' ] )


//---------------------------------------------------------------------
// State

.factory( 'State', [ 'Client', '$rootScope', function ( Client, $rootScope )
{
	let state = {
		Me: null,
		Participants: [],
		Proposals: [],
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
		digest();
	}


	async function LoadList()
	{
		let answer = await Client.Get( '/api/proposals' );
		state.Proposals = answer.Proposals;
		digest();
	}


	// OpenProposal( id ): show it; OpenProposal( null, view ): a view without a proposal (waiting, search).
	async function OpenProposal( Id, View )
	{
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
		try
		{
			let answer = await Client.Get( '/api/proposals/' + state.OpenId );
			state.Open = answer;
			clear_error();
		}
		catch ( error )
		{
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


	function Select( ThreadId )
	{
		state.Selected = ThreadId;
		$rootScope.$broadcast( 'thread-selected', ThreadId );
	}


	function StartCompose( Anchor )
	{
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


.filter( 'display', [ 'State', function ( State )
{
	return function ( Name )
	{
		return State.DisplayOf( Name );
	};
} ] )


//---------------------------------------------------------------------
// AppController: the routes and the live stream.

.controller( 'AppController', [ '$scope', '$window', 'State', 'Client', function ( $scope, $window, State, Client )
{
	$scope.State = State;


	function route()
	{
		let hash = $window.location.hash;
		let proposal = /^#\/p\/([^/]+)$/.exec( hash );
		if ( proposal )
		{
			State.OpenProposal( decodeURIComponent( proposal[ 1 ] ) );
			return;
		}
		if ( hash === '#/waiting' )
		{
			State.OpenProposal( null, 'waiting' );
			return;
		}
		let search = /^#\/search\/(.*)$/.exec( hash );
		if ( search )
		{
			State.Query = decodeURIComponent( search[ 1 ] );
			State.OpenProposal( null, 'search' );
			$scope.$broadcast( 'search-requested', State.Query );
			return;
		}
		State.OpenProposal( null );
	}


	function on_change( event )
	{
		State.LoadList();
		if ( event.Proposal === State.OpenId )
		{
			if ( event.Kind === 'trashed' )
			{
				$window.location.hash = '';
				return;
			}
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
