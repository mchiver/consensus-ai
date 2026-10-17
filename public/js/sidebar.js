'use strict';

// Sidebar - the shell around the project tree (plan UI Components, Step 4: the tree is project-tree and the Tree
// service, public/js/tree.js): the Waiting on you count and the look controls at the bottom (theme, size, editor).
// Step 5 takes these, with the brand and the Help menu above, into the Application Title.

angular.module( 'Consensus' ).controller( 'SidebarController', [ '$scope', 'State', 'Roots', function ( $scope, State, Roots )
{
	$scope.State = State;
	$scope.Roots = Roots;
	$scope.Theme = window.ConsensusTheme.Get().Theme;
	$scope.Scale = window.ConsensusTheme.Get().Scale;
	$scope.Palettes = window.ConsensusTheme.PALETTES;
	$scope.Editor = State.Editor;


	// Waiting on you, over every root, each with its own participant.
	$scope.WaitingCount = function ()
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


	$scope.SetTheme = function ()
	{
		window.ConsensusTheme.SetTheme( $scope.Theme );
	};


	$scope.SetScale = function ()
	{
		window.ConsensusTheme.SetScale( $scope.Scale );
	};


	// The editor engine (plan UI Components, Step 3), beside the theme and the size.
	$scope.SetEditor = function ()
	{
		State.SetEditor( $scope.Editor );
	};
} ] );
