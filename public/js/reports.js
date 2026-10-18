'use strict';

// reports - the report of a plan (plan Printing and Reporting): the server's page at /api/plans/<id>/report, the
// plan, its Subplans and all their threads flattened for review and printing. Open shows it in a new tab (in the
// desktop a new window of the app, whose Print button prints to PDF). Used by the tree's plan menu, the heading's
// Report button and Ctrl+P (hotkeys.js).
//
// Interface:
//   Reports = { Url( Root, Id ), Open( Root, Id ) }

angular.module( 'Consensus' ).factory( 'Reports', [ '$window', 'Client', function ( $window, Client )
{
	function Url( Root, Id )
	{
		return Client.Base( Root ) + '/api/plans/' + Id + '/report';
	}


	function Open( Root, Id )
	{
		$window.open( Url( Root, Id ), '_blank' );
	}


	return {
		Url: Url,
		Open: Open,
	};
} ] );
