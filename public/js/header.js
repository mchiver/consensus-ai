'use strict';

// Header - the title, the one-line state, Read / Edit / Revisions, Comment on the whole document,
// Approve as Plan (owner) and Delete (to the trash, confirmed inline).

angular.module( 'Consensus' ).controller( 'HeaderController', [ '$scope', '$window', 'State', 'Client', function ( $scope, $window, State, Client )
{
	$scope.State = State;
	$scope.Busy = false;
	$scope.ConfirmingDelete = false;


	$scope.SetView = function ( view )
	{
		State.SetView( view );
	};


	$scope.CommentOnWhole = function ()
	{
		State.StartCompose( null );
	};


	$scope.ApproveHint = function ()
	{
		if ( !State.Open )
		{
			return '';
		}
		let tally = State.Open.Proposal.Tally;
		if ( tally.Approvable )
		{
			return 'nothing contested, nothing waiting: approve this as a Plan';
		}
		let reasons = [];
		if ( tally.Contested )
		{
			reasons.push( tally.Contested + ' contested' );
		}
		if ( tally.Waiting )
		{
			reasons.push( tally.Waiting + ' waiting to be applied' );
		}
		return 'not yet: ' + reasons.join( ', ' );
	};


	$scope.Approve = async function ()
	{
		$scope.Busy = true;
		let answer = await State.Act( function ()
		{
			return Client.Post( '/api/proposals/' + encodeURIComponent( State.OpenId ) + '/approve' );
		} );
		$scope.Busy = false;
		if ( answer )
		{
			await State.Reload();
			State.LoadList();
		}
		$scope.$applyAsync();
	};


	$scope.Delete = async function ()
	{
		$scope.Busy = true;
		let answer = await State.Act( function ()
		{
			return Client.Delete( '/api/proposals/' + encodeURIComponent( State.OpenId ) );
		} );
		$scope.Busy = false;
		$scope.ConfirmingDelete = false;
		if ( answer )
		{
			$window.location.hash = '';
			State.LoadList();
		}
		$scope.$applyAsync();
	};


	$scope.$on( 'proposal-loaded', function ()
	{
		$scope.ConfirmingDelete = false;
	} );
} ] );
