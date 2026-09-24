'use strict';

// Edit view - Monaco over the markdown with a live preview beside it. Save (or Ctrl+S) sends the text with
// the revision it was made from; a stale revision is refused by the server and the editor keeps the text.

angular.module( 'Consensus' ).controller( 'EditController', [ '$scope', '$timeout', 'State', 'Client', 'Editor', 'Render', function ( $scope, $timeout, State, Client, Editor, Render )
{
	const PREVIEW_DELAY = 150;
	$scope.State = State;
	$scope.Base = null;
	$scope.BaseText = '';
	$scope.Dirty = false;
	$scope.Stale = false;
	$scope.Busy = false;
	let element = document.getElementById( 'editor' );
	let preview = document.getElementById( 'edit-preview' );
	let preview_timer = null;


	async function open()
	{
		if ( !State.Open )
		{
			return;
		}
		$scope.Base = State.Open.Proposal.Revision;
		$scope.BaseText = State.Open.Text;
		$scope.Dirty = false;
		$scope.Stale = false;
		render_preview( State.Open.Text );
		await Editor.Create( element, State.Open.Text, on_change );
		$scope.$applyAsync();
	}


	function render_preview( text )
	{
		preview.innerHTML = Render.Html( text );
	}


	function on_change()
	{
		let dirty = ( Editor.Get() !== $scope.BaseText );
		if ( dirty !== $scope.Dirty )
		{
			$scope.Dirty = dirty;
			$scope.$applyAsync();
		}
		if ( preview_timer )
		{
			$timeout.cancel( preview_timer );
		}
		preview_timer = $timeout( function ()
		{
			preview_timer = null;
			render_preview( Editor.Get() );
		}, PREVIEW_DELAY, false );
	}


	$scope.Save = async function ()
	{
		if ( !$scope.Dirty || $scope.Stale || $scope.Busy || State.View !== 'edit' )
		{
			return;
		}
		$scope.Busy = true;
		let text = Editor.Get();
		let base = $scope.Base;
		let answer = await State.Act( function ()
		{
			return Client.Put( '/api/proposals/' + encodeURIComponent( State.OpenId ) + '/text', { Text: text, Revision: base } );
		} );
		$scope.Busy = false;
		if ( answer )
		{
			$scope.BaseText = text;
			$scope.Dirty = false;
			await State.Reload();
			State.SetView( 'read' );
		}
		else if ( State.Error )
		{
			$scope.Stale = true;
		}
		$scope.$applyAsync();
	};


	$scope.Discard = function ()
	{
		$scope.Dirty = false;
		$scope.Stale = false;
		State.SetView( 'read' );
	};


	Editor.OnSave( function ()
	{
		$scope.Save();
	} );

	$scope.$on( 'view-changed', function ( event, view )
	{
		if ( view === 'edit' )
		{
			open();
		}
	} );

	// While editing, a reload from a live event does not touch the editor; a newer revision makes it stale.
	$scope.$on( 'proposal-loaded', function ()
	{
		if ( State.View === 'edit' && State.Open && $scope.Base !== null && State.Open.Proposal.Revision !== $scope.Base )
		{
			$scope.Stale = true;
		}
	} );
} ] );
