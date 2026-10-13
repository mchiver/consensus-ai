'use strict';

// Edit view - Monaco over the markdown with a live preview beside it. Save (or Ctrl+S) sends the text with
// the revision it was made from and stays in Edit, the toast saying so (plan UI Tweaks VI); a stale revision is
// refused by the server and the editor keeps the text. Ctrl+E saves, when there is something to save, and reads
// (hotkeys.js). An unsaved edit is kept with the proposal's tab (Tabs.SetDraft), so switching tabs and back brings
// it back.

angular.module( 'Consensus' ).controller( 'EditController', [ '$scope', '$timeout', 'State', 'Client', 'Editor', 'Render', 'Tabs', 'Hotkeys', 'Toast', function ( $scope, $timeout, State, Client, Editor, Render, Tabs, Hotkeys, Toast )
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
		// a draft left in this proposal's tab comes back; made from an older revision, it is stale
		let draft = Tabs.DraftOf( State.OpenId );
		let text = draft ? draft.Text : State.Open.Text;
		$scope.Base = draft ? draft.Base : State.Open.Proposal.Revision;
		$scope.BaseText = State.Open.Text;
		$scope.Dirty = ( text !== State.Open.Text );
		$scope.Stale = ( $scope.Base !== State.Open.Proposal.Revision );
		render_preview( text );
		await Editor.Create( element, text, on_change );
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
		// the draft belongs to the proposal being edited now, even if another tab is shown before the timer fires
		let id = State.OpenId;
		let base = $scope.Base;
		let base_text = $scope.BaseText;
		let stale = $scope.Stale;
		let current = Editor.Get();
		preview_timer = $timeout( function ()
		{
			preview_timer = null;
			render_preview( current );
			Tabs.SetDraft( id, ( current !== base_text || stale ) ? { Text: current, Base: base } : null );
		}, PREVIEW_DELAY, false );
	}


	// Save: the text goes up as a new revision and the editor stays, now editing that revision. True when saved.
	$scope.Save = async function ()
	{
		if ( !$scope.Dirty || $scope.Stale || $scope.Busy || State.View !== 'edit' )
		{
			return false;
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
			// the base moves on before the reload, so the reload's newer revision does not read as stale
			$scope.Base = answer.Proposal.Revision;
			$scope.BaseText = text;
			$scope.Dirty = false;
			Tabs.SetDraft( State.OpenId, null );
			await State.Reload();
			Toast.Show( 'Saved, revision ' + answer.Proposal.Revision );
			$scope.$applyAsync();
			return true;
		}
		if ( State.Error )
		{
			$scope.Stale = true;
		}
		$scope.$applyAsync();
		return false;
	};


	// Ctrl+E from Edit: a dirty, unrefused edit is saved first; a refused save stays here with the error; with nothing
	// to save (or a stale edit, kept as a draft, as the Read button keeps it) it just goes to Read.
	async function edit_to_read()
	{
		if ( $scope.Dirty && !$scope.Stale )
		{
			let saved = await $scope.Save();
			if ( !saved )
			{
				return;
			}
		}
		State.SetView( 'read' );
		$scope.$applyAsync();
	}


	Hotkeys.Provide( 'Save', function () { $scope.Save(); } );
	Hotkeys.Provide( 'EditToRead', edit_to_read );


	$scope.Discard = function ()
	{
		$scope.Dirty = false;
		$scope.Stale = false;
		Tabs.SetDraft( State.OpenId, null );
		State.SetView( 'read' );
	};


	// The preview beside the editor, shown or hidden; shown again, it catches up with the text.
	$scope.TogglePreview = function ()
	{
		State.SetPreviewHidden( !State.PreviewHidden );
		if ( !State.PreviewHidden )
		{
			render_preview( Editor.Get() );
		}
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
