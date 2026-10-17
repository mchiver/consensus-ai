'use strict';

// edit-view - the Edit view (plan UI Components, Steps 2 and 3): the editor over the markdown. The editor is one of
// two engines behind one interface, picked by the Editor setting when the view opens: Editor (Monaco), with a live
// preview beside it (an html-view over PreviewText, with the threads' highlights while the text is still the saved
// one), or Mirror (CodeMirror), which is the Live Preview itself (plan Markdown Editor, Step 1: the markdown
// rendered in place, the Source button switching to the plain markdown, remembered as State.Source) and has no
// preview pane; a change of setting takes effect at the next open. Save (or Ctrl+S) sends the text
// with the revision it was made from and stays in Edit, the toast saying so (plan UI Tweaks VI); a stale revision is
// refused by the server and the editor keeps the text. Ctrl+E saves, when there is something to save, and reads
// (hotkeys.js). An unsaved edit is kept with the plan's tab (Tabs.SetDraft), so switching tabs and back brings it back.
// In the CodeMirror editor the threads' passages are highlighted (Step 3): the server's positions in the plain text,
// mapped onto the source by the anchor map when its plain text is the server's, set on the saved text and following
// the text through edits until the next save; a mousedown on a mark selects its thread.
//
// Interface:
//   <edit-view></edit-view>
//   reads State.Open, State.View, State.Editor, State.PreviewHidden, State.Source, State.Selected, State.Highlight; listens to
//   view-changed, plan-loaded, thread-selected and highlight-changed; provides the Save and EditToRead hotkeys

angular.module( 'Consensus' ).component( 'editView', {
	templateUrl: '/components/edit-view/edit-view.html',
	controller: [ '$scope', '$element', '$timeout', 'State', 'Client', 'Editor', 'Mirror', 'Tabs', 'Hotkeys', 'Toast', 'Threads', function ( $scope, $element, $timeout, State, Client, Editor, Mirror, Tabs, Hotkeys, Toast, Threads )
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
		controller.Engine = null;
		let element = null;
		let instance = null;
		let preview_timer = null;
		let opening = false;


		function wanted_engine()
		{
			return ( State.Editor === 'codemirror' ) ? 'codemirror' : 'monaco';
		}


		function factory_of( name )
		{
			return ( name === 'codemirror' ) ? Mirror : Editor;
		}


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
			// the engine the setting names; another one open is let go
			let wanted = wanted_engine();
			if ( wanted !== 'codemirror' )
			{
				render_preview( text );
			}
			if ( instance && controller.Engine !== wanted )
			{
				instance.Dispose();
				instance = null;
			}
			if ( instance )
			{
				instance.Set( text );
			}
			else
			{
				controller.Engine = wanted;
				instance = await factory_of( wanted ).Create( element, text, on_change, { OnAnchorClick: on_anchor_click }, { Preview: !State.Source } );
			}
			instance.Layout();
			instance.Focus();
			set_anchors();
			$scope.$applyAsync();
		}


		//-------------------------------------------------------------
		// The anchors in a CodeMirror editor: the saved text's, as the Highlight picker filters them. A draft's text is not
		// the saved one, so its marks are left to follow the text; they are set afresh when the texts agree again.

		function set_anchors()
		{
			if ( !instance || !instance.SetAnchors || !State.Open )
			{
				return;
			}
			if ( instance.Get() !== State.Open.Text )
			{
				return;
			}
			let CM = window.CodeMirror6;
			let map = CM.AnchorMap.Build( State.Open.Text );
			let expected = CM.AnchorMap.PlainTextOfHtml( marked.parse( State.Open.Text ) );
			if ( map.Plain !== expected )
			{
				let at = 0;
				while ( at < map.Plain.length && map.Plain[ at ] === expected[ at ] )
				{
					at++;
				}
				console.warn( 'The anchor map differs from the server\'s plain text at ' + at + ', so the editor shows no highlights for this text: ours "' + map.Plain.slice( at, at + 40 ) + '", the server\'s "' + expected.slice( at, at + 40 ) + '".' );
				instance.SetAnchors( [] );
				return;
			}
			let anchors = [];
			for ( let thread of Threads.Highlighted() )
			{
				if ( !thread.Found )
				{
					continue;
				}
				let range = CM.AnchorMap.SourceRange( map, thread.Found.Start, thread.Found.End );
				if ( range )
				{
					anchors.push( { From: range.From, To: range.To, Id: thread.Id, State: thread.State } );
				}
			}
			instance.SetAnchors( anchors );
			instance.SetSelected( State.Selected );
		}


		// A mousedown on a mark: its thread is selected (the next one on a passage of several) and its card scrolls into view.
		function on_anchor_click( ids )
		{
			let id = ids[ ids.length - 1 ];
			if ( ids.includes( State.Selected ) )
			{
				let index = ids.indexOf( State.Selected );
				id = ids[ ( index + 1 ) % ids.length ];
			}
			$scope.$applyAsync( function ()
			{
				State.Select( id );
				let card = document.getElementById( 'thread-' + id );
				if ( card )
				{
					card.scrollIntoView( { block: 'nearest', behavior: 'smooth' } );
				}
			} );
		}


		// The preview beside the editor follows PreviewText; the html-view renders it.
		function render_preview( text )
		{
			controller.PreviewText = text;
			$scope.$applyAsync();
		}


		function current_text()
		{
			return instance ? instance.Get() : '';
		}


		function on_change()
		{
			let dirty = ( current_text() !== controller.BaseText );
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
			let current = current_text();
			preview_timer = $timeout( function ()
			{
				preview_timer = null;
				if ( controller.Engine !== 'codemirror' )
				{
					render_preview( current );
				}
				Tabs.SetDraft( id, ( current !== base_text || stale ) ? { Text: current, Base: base } : null );
			}, PREVIEW_DELAY, false );
		}


		// Save: the text goes up as a new revision and the editor stays, now editing that revision. True when saved.
		controller.Save = async function ()
		{
			if ( !controller.Dirty || controller.Stale || controller.Busy || State.View !== 'edit' || !instance )
			{
				return false;
			}
			controller.Busy = true;
			let text = instance.Get();
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
				render_preview( current_text() );
			}
		};


		// Source in the CodeMirror editor: the plain markdown in place of the Live Preview, switched in place and remembered.
		controller.ToggleSource = function ()
		{
			State.SetSource( !State.Source );
			if ( instance && instance.SetPreview )
			{
				instance.SetPreview( !State.Source );
				instance.Focus();
			}
		};


		function save_from_keys()
		{
			controller.Save();
		}

		Editor.OnSave( save_from_keys );
		Mirror.OnSave( save_from_keys );


		controller.$postLink = function ()
		{
			element = $element[ 0 ].querySelector( '#editor' );
			if ( opening || State.View === 'edit' )
			{
				opening = false;
				open();
			}
		};


		controller.$onDestroy = function ()
		{
			if ( instance )
			{
				instance.Dispose();
				instance = null;
			}
		};


		$scope.$on( 'view-changed', function ( event, view )
		{
			if ( view === 'edit' )
			{
				open();
			}
		} );

		// While editing, a reload from a live event does not touch the editor; a newer revision makes it stale. After a
		// save the texts agree again, and the anchors are set from the server's new positions.
		$scope.$on( 'plan-loaded', function ()
		{
			if ( State.View === 'edit' && State.Open && controller.Base !== null && State.Open.Plan.Revision !== controller.Base )
			{
				controller.Stale = true;
			}
			if ( State.View === 'edit' )
			{
				set_anchors();
			}
		} );

		$scope.$on( 'thread-selected', function ( event, id )
		{
			if ( instance && instance.SetSelected )
			{
				instance.SetSelected( id );
			}
		} );

		$scope.$on( 'highlight-changed', function ()
		{
			if ( State.View === 'edit' )
			{
				set_anchors();
			}
		} );
	} ],
} );
