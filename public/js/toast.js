'use strict';

// Toast (plan UI Tweaks VI) - one line at the bottom of the main pane, shown for a moment: "Saved, revision 12",
// what was copied or pasted. Show( Text ) fades it in and out over about two seconds; a later message replaces the
// earlier one.
//
//   Toast = { Text, Shown, Show( Text ) }

angular.module( 'Consensus' ).factory( 'Toast', [ '$rootScope', '$timeout', function ( $rootScope, $timeout )
{
	const SHOWN_FOR = 2000;
	let toast = { Text: '', Shown: false };
	let timer = null;


	function Show( Text )
	{
		toast.Text = String( Text || '' );
		toast.Shown = true;
		if ( timer )
		{
			$timeout.cancel( timer );
		}
		timer = $timeout( function ()
		{
			timer = null;
			toast.Shown = false;
		}, SHOWN_FOR );
		$rootScope.$applyAsync();
	}


	toast.Show = Show;
	return toast;
} ] )


//---------------------------------------------------------------------
// ToastController: the line itself, drawn once in the main pane.

.controller( 'ToastController', [ '$scope', 'Toast', function ( $scope, Toast )
{
	$scope.Toast = Toast;
} ] );
