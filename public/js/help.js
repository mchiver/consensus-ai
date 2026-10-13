'use strict';

// Help (plan UI Tweaks VI) - the Help menu in the bar above the project tree, and its two popups: About (the
// version, the source and the guide, and a summary of every project: its threads, how many are contested, how many
// wait on you and how many on the LLMs) and Hotkeys (the table in hotkeys.js). The summary is made when About
// opens, from the tallies the tree already holds: each server's projects, their plans and Subplans, archived plans
// left out; "waiting on LLMs" counts every participant whose Role is llm.
//
//   HelpPanel = { Open: null | 'about' | 'hotkeys', Summary: [ { Root, Rows: [ { Id, Name, Total, Contested, Mine, Llms } ] } ] }

angular.module( 'Consensus' ).factory( 'HelpPanel', [ function ()
{
	return { Open: null, Summary: [] };
} ] )


.controller( 'HelpController', [ '$scope', '$window', 'State', 'Roots', 'Menus', 'HelpPanel', 'Hotkeys', function ( $scope, $window, State, Roots, Menus, HelpPanel, Hotkeys )
{
	const SOURCE_URL = 'https://github.com/mchiver/consensus-ai';
	const GUIDE_URL = 'http://consensus-ai.liquicode.com';
	$scope.Panel = HelpPanel;
	$scope.Roots = Roots;
	$scope.Hotkeys = Hotkeys;
	$scope.SourceUrl = SOURCE_URL;
	$scope.GuideUrl = GUIDE_URL;


	// The page's own version: the desktop's, or the server's as /api/me gave it.
	$scope.Version = function ()
	{
		if ( $window.ConsensusDesktop && $window.ConsensusDesktop.Version )
		{
			return $window.ConsensusDesktop.Version;
		}
		let root = Roots.List[ 0 ];
		return ( root && root.Version ) ? root.Version : '';
	};


	//-----------------------------------------------------------------
	// The summary

	// The tallies of a project's plans and Subplans, folders walked, documents and the Archive left out.
	function tallies_of( items, into )
	{
		for ( let node of items || [] )
		{
			if ( node.Kind === 'folder' )
			{
				tallies_of( node.Items, into );
				continue;
			}
			if ( node.Kind === 'document' )
			{
				continue;
			}
			if ( node.Tally )
			{
				into.push( node.Tally );
			}
			tallies_of( node.Items, into );
		}
		return into;
	}


	function summary_of( root )
	{
		let me = root.Me ? root.Me.Name : null;
		let llms = ( root.Participants || [] ).filter( function ( participant ) { return participant.Role === 'llm'; } ).map( function ( participant ) { return participant.Name; } );
		let rows = [];
		for ( let project of root.Projects || [] )
		{
			let row = { Id: project.Id, Name: project.Name, Total: 0, Contested: 0, Mine: 0, Llms: 0 };
			for ( let tally of tallies_of( project.Items, [] ) )
			{
				row.Total += tally.Total || 0;
				row.Contested += tally.Contested || 0;
				row.Mine += ( me && tally.WaitingOn ) ? ( tally.WaitingOn[ me ] || 0 ) : 0;
				for ( let name of llms )
				{
					row.Llms += tally.WaitingOn ? ( tally.WaitingOn[ name ] || 0 ) : 0;
				}
			}
			rows.push( row );
		}
		return { Root: root, Rows: rows };
	}


	function open( which )
	{
		if ( which === 'about' )
		{
			HelpPanel.Summary = Roots.List.map( summary_of );
		}
		HelpPanel.Open = which;
	}


	//-----------------------------------------------------------------
	// The menu and the popups

	$scope.OpenHelpMenu = function ( event )
	{
		let items = [
			{ Label: 'About', Icon: 'info', Act: function () { open( 'about' ); } },
			{ Label: 'Hotkeys', Icon: 'keyboard', Act: function () { open( 'hotkeys' ); } },
		];
		Menus.Show( items, event, 'help' );
	};


	$scope.MenuOpen = function ()
	{
		return Menus.IsOpenFor( 'help' );
	};


	$scope.Close = function ()
	{
		HelpPanel.Open = null;
	};


	$scope.Key = function ( event )
	{
		if ( event.key === 'Escape' )
		{
			$scope.Close();
		}
	};


	// A row's keys, as the platform names them.
	$scope.KeysOf = function ( row )
	{
		return Hotkeys.Display( row.Keys );
	};
} ] );
