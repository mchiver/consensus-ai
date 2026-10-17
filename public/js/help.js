'use strict';

// Help (plan UI Tweaks VI) - the two help popups: About (the version, the source and the guide, and a summary of
// every project: its threads, how many are contested, how many wait on you and how many on the LLMs) and Hotkeys
// (the table in hotkeys.js). They open from the application menu in the title bar (public/components/title-bar,
// plan UI Components, Step 5) through HelpPanel.Show. The summary is made when About opens, from the tallies the
// tree already holds: each server's projects, their plans and Subplans, archived plans left out; "waiting on LLMs"
// counts every participant whose Role is llm.
//
//   HelpPanel = { Open: null | 'about' | 'hotkeys', Summary: [ { Root, Rows: [ { Id, Name, Total, Contested, Mine, Llms } ] } ],
//                 Show( which ), Close() }

angular.module( 'Consensus' ).factory( 'HelpPanel', [ 'Roots', function ( Roots )
{
	let panel = { Open: null, Summary: [] };


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


	// Show: 'about' or 'hotkeys'; About's summary is made as it opens.
	function Show( Which )
	{
		if ( Which === 'about' )
		{
			panel.Summary = Roots.List.map( summary_of );
		}
		panel.Open = Which;
	}


	function Close()
	{
		panel.Open = null;
	}


	panel.Show = Show;
	panel.Close = Close;
	return panel;
} ] )


//---------------------------------------------------------------------
// HelpController: the popups' own scope, on the help popup element.

.controller( 'HelpController', [ '$scope', '$window', 'Roots', 'HelpPanel', 'Hotkeys', function ( $scope, $window, Roots, HelpPanel, Hotkeys )
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


	$scope.Close = function ()
	{
		HelpPanel.Close();
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
