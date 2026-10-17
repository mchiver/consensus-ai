'use strict';

// monaco-edit - the Edit view (plan UI Components, Step 2): Monaco over the markdown with a live preview beside
// it (an html-view over PreviewText, with the threads' highlights while the text is still the saved one). Save
// (or Ctrl+S) sends the text with the revision it was made from and stays in Edit, the toast saying so (plan UI
// Tweaks VI); a stale revision is refused by the server and the editor keeps the text. Ctrl+E saves, when there is
// something to save, and reads (hotkeys.js). An unsaved edit is kept with the plan's tab (Tabs.SetDraft), so
// switching tabs and back brings it back. The Editor factory's one Edit instance lives in this component's #editor.
//
// Interface:
//   <monaco-edit></monaco-edit>
//   reads State.Open, State.View, State.PreviewHidden; listens to view-changed and plan-loaded; provides the Save
//   and EditToRead hotkeys

angular.module( 'Consensus' ).component( 'monacoEdit', {
	templateUrl: '/components/monaco-edit/monaco-edit.html',
	controller: [ '$scope', '$element', '$timeout', 'State', 'Client', 'Editor', 'Tabs', 'Hotkeys', 'Toast', function ( $scope, $element, $timeout, State, Client, Editor, Tabs, Hotkeys, Toast )
	{
		const PREVIEW_DELAY = 150;
		let controller = this;
		controller.State = State;
		controller.Base = null;
		controller.BaseText = '';
		controller.Dirty = false;
		controller.Stale = false;
		controller.Busy = false;
		controller.PreviewText = '';
		let element = null;
		let preview_timer = null;
		let opening = false;


		async function open()
		{
			if ( !State.Open || !element )
			{
				opening = !element;
				return;
			}
			// a draft left in this plan's tab comes back; made from an older revision, it is stale
			let draft = Tabs.DraftOf( State.OpenId );
			let text = draft ? draft.Text : State.Open.Text;
			controller.Base = draft ? draft.Base : State.Open.Plan.Revision;
			controller.BaseText = State.Open.Text;
			controller.Dirty = ( text !== State.Open.Text );
			controller.Stale = ( controller.Base !== State.Open.Plan.Revision );
			render_preview( text );
			await Editor.Create( element, text, on_change );
			$scope.$applyAsync();
		}


		// The preview beside the editor follows PreviewText; the html-view renders it.
		function render_preview( text )
		{
			controller.PreviewText = text;
			$scope.$applyAsync();
		}


		function on_change()
		{
			let dirty = ( Editor.Get() !== controller.BaseText );
			if ( dirty !== controller.Dirty )
			{
				controller.Dirty = dirty;
				$scope.$applyAsync();
			}
			if ( preview_timer )
			{
				$timeout.cancel( preview_timer );
			}
			// the draft belongs to the plan being edited now, even if another tab is shown before the timer fires
			let id = State.OpenId;
			let base = controller.Base;
			let base_text = controller.BaseText;
			let stale = controller.Stale;
			let current = Editor.Get();
			preview_timer = $timeout( function ()
			{
				preview_timer = null;
				render_preview( current );
				Tabs.SetDraft( id, ( current !== base_text || stale ) ? { Text: current, Base: base } : null );
			}, PREVIEW_DELAY, false );
		}


		// Save: the text goes up as a new revision and the editor stays, now editing that revision. True when saved.
		controller.Save = async function ()
		{
			if ( !controller.Dirty || controller.Stale || controller.Busy || State.View !== 'edit' )
			{
				return false;
			}
			controller.Busy = true;
			let text = Editor.Get();
			let base = controller.Base;
			let answer = await State.Act( function ()
			{
				return Client.Put( '/api/plans/' + encodeURIComponent( State.OpenId ) + '/text', { Text: text, Revision: base } );
			} );
			controller.Busy = false;
			if ( answer )
			{
				// the base moves on before the reload, so the reload's newer revision does not read as stale
				controller.Base = answer.Plan.Revision;
				controller.BaseText = text;
				controller.Dirty = false;
				Tabs.SetDraft( State.OpenId, null );
				await State.Reload();
				Toast.Show( 'Saved, revision ' + answer.Plan.Revision );
				$scope.$applyAsync();
				return true;
			}
			if ( State.Error )
			{
				controller.Stale = true;
			}
			$scope.$applyAsync();
			return false;
		};


		// Ctrl+E from Edit: a dirty, unrefused edit is saved first; a refused save stays here with the error; with
		// nothing to save (or a stale edit, kept as a draft, as the Read button keeps it) it just goes to Read.
		async function edit_to_read()
		{
			if ( controller.Dirty && !controller.Stale )
			{
				let saved = await controller.Save();
				if ( !saved )
				{
					return;
				}
			}
			State.SetView( 'read' );
			$scope.$applyAsync();
		}


		Hotkeys.Provide( 'Save', function () { controller.Save(); } );
		Hotkeys.Provide( 'EditToRead', edit_to_read );


		controller.Discard = function ()
		{
			controller.Dirty = false;
			controller.Stale = false;
			Tabs.SetDraft( State.OpenId, null );
			State.SetView( 'read' );
		};


		// The preview beside the editor, shown or hidden; shown again, it catches up with the text.
		controller.TogglePreview = function ()
		{
			State.SetPreviewHidden( !State.PreviewHidden );
			if ( !State.PreviewHidden )
			{
				render_preview( Editor.Get() );
			}
		};


		Editor.OnSave( function ()
		{
			controller.Save();
		} );


		controller.$postLink = function ()
		{
			element = $element[ 0 ].querySelector( '#editor' );
			if ( opening || State.View === 'edit' )
			{
				opening = false;
				open();
			}
		};


		$scope.$on( 'view-changed', function ( event, view )
		{
			if ( view === 'edit' )
			{
				open();
			}
		} );

		// While editing, a reload from a live event does not touch the editor; a newer revision makes it stale.
		$scope.$on( 'plan-loaded', function ()
		{
			if ( State.View === 'edit' && State.Open && controller.Base !== null && State.Open.Plan.Revision !== controller.Base )
			{
				controller.Stale = true;
			}
		} );
	} ],
} );
