'use strict';

// Instructions (plan UI Tweaks VII) - "LLM Instructions" in a project row's menu: the server's /instructions page
// (what an agent session needs: the API's address, how to say who it is, the guide) shown in a popup to read and
// copy, for seeding an LLM by hand. A section naming the project and its Readme is put first, so the LLM knows
// which project is its own. In a browser, Open shows the page itself; the desktop has no Open. Plan The Server, Step 5:
// on a Server (root.People) a token is minted for the person and the project (POST /api/instructions/token, named
// "LLM session: <project name>", replacing the last one) and put first, so the copied text signs the session in; it is
// never written anywhere else, and the account's page lists and revokes it.
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


	// The token section (plan The Server, Step 5): the session's token, the header to send, whose it is.
	function token_section( Minted, Root )
	{
		let me = ( Root && Root.Me ) ? ( Root.Me.Display || Root.Me.Name ) : 'you';
		let lines = [
			'# Your token',
			'',
			'- Send "Authorization: Bearer ' + Minted.Token + '" with every request: you act as ' + me + ', allowed what their role in each project allows.',
			'- It is the token "' + Minted.Name + '" on ' + me + '\'s account page, where it is revoked; opening these instructions again replaces it. Keep it out of the project\'s files.',
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
			let token_part = '';
			if ( instructions.Root && instructions.Root.People )
			{
				let minted = await Client.Post( instructions.Root, '/api/instructions/token', { Project: Project.Id } );
				token_part = token_section( minted, instructions.Root );
			}
			instructions.Text = project_section( instructions.Project ) + token_part + text;
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
