'use strict';

// Sidebar - Proposals and Plans with their tallies, New proposal, and the LLM's tokens today.

angular.module( 'Consensus' ).controller( 'SidebarController', [ '$scope', '$window', 'State', 'Client', function ( $scope, $window, State, Client )
{
	$scope.State = State;
	$scope.Creating = false;
	$scope.NewTitle = '';
	$scope.ShowingTrash = false;
	$scope.Trash = [];
	$scope.Query = '';
	$scope.Usage = null;
	$scope.Theme = window.ConsensusTheme.Get().Theme;
	$scope.Scale = window.ConsensusTheme.Get().Scale;


	$scope.Search = function ()
	{
		let query = ( $scope.Query || '' ).trim();
		if ( query )
		{
			$window.location.hash = '#/search/' + encodeURIComponent( query );
		}
	};


	$scope.WaitingCount = function ()
	{
		let count = 0;
		let name = State.Me ? State.Me.Name : null;
		for ( let proposal of State.Proposals )
		{
			count += ( proposal.Tally.WaitingOn[ name ] || 0 );
		}
		return count;
	};


	$scope.SetTheme = function ()
	{
		window.ConsensusTheme.SetTheme( $scope.Theme );
	};


	$scope.SetScale = function ()
	{
		window.ConsensusTheme.SetScale( $scope.Scale );
	};


	async function load_trash()
	{
		let answer = await State.Act( function () { return Client.Get( '/api/trash' ); } );
		$scope.Trash = answer ? answer.Proposals : [];
		$scope.$applyAsync();
	}


	$scope.ToggleTrash = function ()
	{
		$scope.ShowingTrash = !$scope.ShowingTrash;
		if ( $scope.ShowingTrash )
		{
			load_trash();
		}
	};


	$scope.$watch( function () { return State.Proposals; }, function ()
	{
		if ( $scope.ShowingTrash )
		{
			load_trash();
		}
	} );


	$scope.Proposals = function ()
	{
		return State.Proposals.filter( function ( proposal ) { return proposal.Status !== 'consensus'; } );
	};


	$scope.Plans = function ()
	{
		return State.Proposals.filter( function ( proposal ) { return proposal.Status === 'consensus'; } );
	};


	//-----------------------------------------------------------------
	// The LLM's tokens: today in the footer, everything in the tooltip. Reloaded after every call.

	async function load_usage()
	{
		try
		{
			$scope.Usage = await Client.Get( '/api/usage' );
		}
		catch ( error )
		{
			$scope.Usage = null;
		}
		$scope.$applyAsync();
	}


	$scope.UsageHint = function ()
	{
		let usage = $scope.Usage;
		if ( !usage )
		{
			return '';
		}
		let lines = [ 'today: ' + usage.Today.Calls + ' calls, ' + usage.Today.Input + ' in, ' + usage.Today.Output + ' out' ];
		lines.push( 'in all: ' + usage.Total.Calls + ' calls, ' + usage.Total.Input + ' in, ' + usage.Total.Output + ' out' );
		for ( let model of Object.keys( usage.Models ) )
		{
			let entry = usage.Models[ model ];
			lines.push( model + ': ' + entry.Calls + ' calls, ' + entry.Input + ' in, ' + entry.Output + ' out' );
		}
		return lines.join( '\n' );
	};


	$scope.$on( 'changed', function ( event, change )
	{
		if ( change.Kind === 'llm-finished' )
		{
			load_usage();
		}
	} );

	load_usage();


	$scope.StartNew = function ()
	{
		$scope.Creating = true;
		$scope.NewTitle = '';
	};


	$scope.CancelNew = function ()
	{
		$scope.Creating = false;
	};


	$scope.Create = async function ()
	{
		let title = ( $scope.NewTitle || '' ).trim();
		if ( !title )
		{
			return;
		}
		let answer = await State.Act( function ()
		{
			return Client.Post( '/api/proposals', { Title: title, Text: '# ' + title + '\n\n' } );
		} );
		if ( answer )
		{
			$scope.Creating = false;
			$scope.NewTitle = '';
			$window.location.hash = '#/p/' + encodeURIComponent( answer.Proposal.Id );
		}
		$scope.$applyAsync();
	};
} ] );
