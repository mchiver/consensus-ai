'use strict';

// Instructions (plan UI Tweaks VII) - "LLM Instructions" in a project row's menu: the server's /instructions page
// (what an agent session needs: the API's address, the llm participant's token, the guide) shown in a popup to read
// and copy, for seeding an LLM by hand. A section naming the project and its Readme is put first, so the LLM knows
// which project is its own. In a browser, Open shows the page itself; the desktop opens links in the system
// browser, where the token would show, so it has no Open.
//   Instructions = { Open, Root, Project, Text, Url, InBrowser, Busy, Copied, Error, Start( Project, Root ), Copy(), Close() }

angular.module( 'Consensus' )

.factory( 'Instructions', [ 'Client', 'State', 'Toast', function ( Client, State, Toast )
{
	let instructions = { Open: false, Root: null, Project: null, Text: '', Url: '', InBrowser: !window.ConsensusDesktop, Busy: false, Copied: false, Error: '' };


	function reset( open, root )
	{
		instructions.Open = open;
		instructions.Root = root || State.Root;
		instructions.Project = null;
		instructions.Text = '';
		instructions.Url = '';
		instructions.Busy = false;
		instructions.Copied = false;
		instructions.Error = '';
	}


	// The section put first: the project's name and id, and its Readme's.
	function project_section( Project )
	{
		let readme = ( Project.Context && Project.Context.Id ) ? Project.Context.Id : null;
		let lines = [
			'# Your project',
			'',
			'- ' + Project.Name + ' (' + Project.Id + ')' + ( readme ? ', its Readme ' + readme : '' ),
			'',
			'',
		];
		return lines.join( '\n' );
	}


	// Start( Project, Root ): the popup over the project's server, the page fetched as text.
	async function Start( Project, Root )
	{
		reset( true, Root );
		instructions.Project = { Id: Project.Id, Name: Project.Name, Context: Project.Context };
		instructions.Url = Client.Base( instructions.Root ) + '/instructions';
		instructions.Busy = true;
		try
		{
			let response = await fetch( instructions.Url );
			let text = await response.text();
			if ( !response.ok )
			{
				throw new Error( 'the server refused: ' + response.status );
			}
			instructions.Text = project_section( instructions.Project ) + text;
		}
		catch ( error )
		{
			instructions.Error = error.message;
		}
		instructions.Busy = false;
	}


	async function Copy()
	{
		try
		{
			await navigator.clipboard.writeText( instructions.Text );
			instructions.Copied = true;
			Toast.Show( 'copied' );
		}
		catch ( error )
		{
			instructions.Error = 'the clipboard refused: select the text and copy it';
		}
	}


	function Close()
	{
		reset( false, null );
	}


	instructions.Start = Start;
	instructions.Copy = Copy;
	instructions.Close = Close;
	return instructions;
} ] )


//---------------------------------------------------------------------
.controller( 'InstructionsController', [ '$scope', 'Instructions', function ( $scope, Instructions )
{
	$scope.Instructions = Instructions;


	$scope.Copy = async function ()
	{
		await Instructions.Copy();
		$scope.$applyAsync();
	};


	$scope.Close = function ()
	{
		Instructions.Close();
	};


	$scope.Key = function ( event )
	{
		if ( event.key === 'Escape' )
		{
			event.stopPropagation();
			Instructions.Close();
		}
	};
} ] );
