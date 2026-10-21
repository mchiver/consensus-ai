'use strict';

// edit-view - the editor over the markdown (plan UI Components, Steps 2 and 3). The editor is one of two engines
// behind one interface, picked by the Editor setting: Editor (Monaco), the Edit view with a live preview beside it
// (an html-view over PreviewText, with the threads' highlights while the text is still the saved one), or Mirror
// (CodeMirror), which is the Live Preview itself (plan Markdown Editor, Step 1: the markdown rendered in place,
// Source mode the plain markdown, State.Source) and, in CodeMirror mode, the one view of a plan or document (Step 3:
// shown for Read and Edit alike, read-only for an archived plan, Save and Discard in the heading through
// State.Editing, a newer revision taken silently while the text is clean). A change of setting takes effect at once. Save (or Ctrl+S) sends the text
// with the revision it was made from and stays in Edit, the toast saying so (plan UI Tweaks VI); a stale revision is
// refused by the server and the editor keeps the text. Ctrl+E saves, when there is something to save, and reads
// (hotkeys.js). An unsaved edit is kept with the plan's tab (Tabs.SetDraft), so switching tabs and back brings it back.
// In the CodeMirror editor the threads' passages are highlighted (Step 3): the server's positions in the plain text,
// mapped onto the source by the anchor map when its plain text is the server's, set on the saved text and following
// the text through edits until the next save; a mousedown on a mark selects its thread. The editor does the rest
// of what the Read view does with the threads (plan Markdown Editor, Step 2): a thread selected elsewhere scrolls
// to its passage and flashes it; a selection offers the selection-buttons (Copy always, Comment or Re-anchor here
// and Start a new Subplan while the text is the saved one); a pending select, scroll or compose is settled here
// when this is the view shown. Each tab keeps its place (plan UI Tweaks IX): the editor's scroll and selection are
// taken into the tab's record (Tabs.SetPlace) before another plan's text goes into the one instance, and put back
// when the tab is shown again; a tab with no place starts at the top.
//
// Interface:
//   <edit-view></edit-view>
//   reads State.Open, State.View, State.Editor, State.PreviewHidden, State.Source, State.Selected, State.Highlight,
//   State.Pending, State.Reanchoring; sets State.Editing to itself; listens to view-changed, plan-loaded,
//   thread-selected, highlight-changed, source-changed and editor-changed; provides the Save and EditToRead hotkeys

angular.module( 'Consensus' ).component( 'editView', {
	templateUrl: '/components/edit-view/edit-view.html',
	controller: [ '$scope', '$element', '$timeout', 'State', 'Client', 'Editor', 'Mirror', 'Tabs', 'Hotkeys', 'Toast', 'Threads', 'Render', function ( $scope, $element, $timeout, State, Client, Editor, Mirror, Tabs, Hotkeys, Toast, Threads, Render )
	{
		const PREVIEW_DELAY = 150;
		const SELECTION_DELAY = 250;
		let controller = this;
		controller.State = State;
		controller.Base = null;
		controller.BaseText = '';
		controller.Dirty = false;
		controller.Stale = false;
		controller.Busy = false;
		controller.PreviewText = '';
		controller.Engine = null;
		controller.ReadOnly = false;
		State.Editing = controller;
		controller.SelectionAnchor = null;
		controller.SelectedText = '';
		controller.ButtonsAt = null;
		let element = null;
		let instance = null;
		let preview_timer = null;
		let selection_timer = null;
		let selecting_from_editor = false;
		let map_cache = { Text: null, Map: null };
		let opening = false;
		let opened_id = null;	// the plan the instance holds
		let creating = null;	// the engine being created, so a second open waits for it


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
			if ( creating )
			{
				await creating;
			}
			if ( !State.Open )
			{
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
			// an archived plan is read in the editor, never written (plan Markdown Editor, Step 3)
			let read_only = !!State.Open.Plan.Archived;
			let switched = ( opened_id !== State.OpenId );
			if ( instance && switched )
			{
				keep_place();
			}
			if ( instance )
			{
				if ( instance.Get() !== text )
				{
					instance.Set( text );
				}
				if ( instance.SetReadOnly )
				{
					instance.SetReadOnly( read_only );
				}
			}
			else
			{
				controller.Engine = wanted;
				creating = factory_of( wanted ).Create( element, text, on_change, { OnAnchorClick: on_anchor_click, OnSelection: on_selection }, { Preview: !State.Source, ReadOnly: read_only } );
				instance = await creating;
				creating = null;
				if ( instance.View )
				{
					// the buttons sit in the editor's box, not in its scroller: a scroll takes them away
					instance.View.scrollDOM.addEventListener( 'scroll', hide_selection_buttons );
				}
			}
			opened_id = State.OpenId;
			controller.ReadOnly = read_only;
			instance.Layout();
			instance.Focus();
			if ( switched && instance.SetPlace )
			{
				// a tab with no place yet starts at the top
				instance.SetPlace( Tabs.PlaceOf( opened_id ) || { Scroll: 0, Anchor: 0, Head: 0 } );
			}
			set_anchors();
			settle_pending();
			$scope.$applyAsync();
		}


		// The place of the plan the instance holds, into its tab (plan UI Tweaks IX).
		function keep_place()
		{
			if ( instance && instance.GetPlace && opened_id )
			{
				Tabs.SetPlace( opened_id, instance.GetPlace() );
			}
		}


		function editor_shown()
		{
			return State.MirrorShown() && !!instance && !!instance.View;
		}


		// A newer revision while the text is clean: taken as one change over the middle that differs, so the cursor
		// and the scroll stay where the text did not move (CodeMirror); Monaco takes the whole text.
		function take_live_text()
		{
			let fresh = State.Open.Text;
			let current = instance.Get();
			controller.Base = State.Open.Plan.Revision;
			controller.BaseText = fresh;
			controller.Stale = false;
			if ( instance.View )
			{
				let prefix = 0;
				while ( prefix < current.length && prefix < fresh.length && current[ prefix ] === fresh[ prefix ] )
				{
					prefix++;
				}
				let suffix = 0;
				while ( suffix < current.length - prefix && suffix < fresh.length - prefix && current[ current.length - 1 - suffix ] === fresh[ fresh.length - 1 - suffix ] )
				{
					suffix++;
				}
				instance.View.dispatch( { changes: { from: prefix, to: current.length - suffix, insert: fresh.slice( prefix, fresh.length - suffix ) } } );
			}
			else
			{
				instance.Set( fresh );
			}
			controller.Dirty = false;
			Tabs.SetDraft( State.OpenId, null );
		}


		// The anchor map of a text, kept while the text is the same.
		function map_of( text )
		{
			if ( map_cache.Text !== text )
			{
				map_cache = { Text: text, Map: window.CodeMirror6.AnchorMap.Build( text ) };
			}
			return map_cache.Map;
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


		// A mousedown on a mark: its thread is selected (the next one on a passage of several) and its card scrolls into
		// view; the editor does not scroll to what was clicked in it.
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
				selecting_from_editor = true;
				State.Select( id );
				selecting_from_editor = false;
				let card = document.getElementById( 'thread-' + id );
				if ( card )
				{
					card.scrollIntoView( { block: 'nearest', behavior: 'smooth' } );
				}
			} );
		}


		// A thread selected elsewhere (its card, a waiting item): the editor scrolls to its passage and flashes it.
		function reveal_thread( id )
		{
			if ( !editor_shown() || !instance.Anchors )
			{
				return;
			}
			let mark = instance.Anchors().find( function ( anchor ) { return anchor.Id === id; } );
			if ( !mark )
			{
				return;
			}
			instance.ScrollTo( mark.From );
			instance.Flash( mark.From, mark.To );
		}


		//-------------------------------------------------------------
		// The selection-buttons: on a selection that rests, under its end; Copy always (the text as it reads, through the
		// anchor map), Comment and Start a new Subplan while the text is the saved one, on a plan that is not archived.

		function on_selection()
		{
			if ( selection_timer )
			{
				$timeout.cancel( selection_timer );
			}
			selection_timer = $timeout( offer_selection_buttons, SELECTION_DELAY, false );
		}


		function hide_selection_buttons()
		{
			if ( !controller.ButtonsAt && !controller.SelectionAnchor )
			{
				return;
			}
			controller.ButtonsAt = null;
			controller.SelectionAnchor = null;
			controller.SelectedText = '';
			$scope.$applyAsync();
		}


		function offer_selection_buttons()
		{
			selection_timer = null;
			if ( !editor_shown() || !State.Open )
			{
				hide_selection_buttons();
				return;
			}
			let range = instance.View.state.selection.main;
			if ( range.empty )
			{
				hide_selection_buttons();
				return;
			}
			let CM = window.CodeMirror6;
			let map = map_of( instance.Get() );
			let plain = CM.AnchorMap.PlainRange( map, range.from, range.to );
			let anchor = plain ? Render.AnchorOf( map.Plain, plain.Start, plain.End ) : null;
			let coords = instance.View.coordsAtPos( range.to );
			if ( !anchor || !coords )
			{
				hide_selection_buttons();
				return;
			}
			let box = element.getBoundingClientRect();
			let plan = State.Open.Plan;
			let allowed = !controller.Dirty && !controller.Stale && ( plan.Kind || 'plan' ) !== 'document' && !plan.Archived;
			controller.SelectionAnchor = allowed ? anchor : null;
			controller.SelectedText = anchor.Text;
			controller.ButtonsAt = { Top: coords.bottom - box.top + 6, Left: coords.left - box.left };
			$scope.$applyAsync();
		}


		// After a button: the selection collapses to its end and the buttons go.
		controller.SelectionDone = function ()
		{
			if ( instance && instance.View )
			{
				let main = instance.View.state.selection.main;
				instance.View.dispatch( { selection: { anchor: main.to } } );
			}
			hide_selection_buttons();
		};


		//-------------------------------------------------------------
		// A search hit or a waiting item asked for a thread or a passage once the plan is loaded; settled here when this
		// is the view shown (the Read view's html-view does it otherwise).

		function settle_pending()
		{
			let pending = State.Pending;
			if ( !pending || !State.Open || !editor_shown() )
			{
				return;
			}
			State.Pending = null;
			if ( pending.Select )
			{
				State.Select( pending.Select );
				let card = document.getElementById( 'thread-' + pending.Select );
				if ( card )
				{
					card.scrollIntoView( { block: 'nearest', behavior: 'smooth' } );
				}
			}
			else if ( pending.Scroll )
			{
				scroll_to_text( pending.Scroll );
			}
			else if ( pending.Compose )
			{
				State.StartCompose( null );
			}
			// the load that brought the pending came outside a digest
			$scope.$applyAsync();
		}


		// A passage by its first words, as Render.ScrollToText finds it in the rendered text: in the map's plain text.
		function scroll_to_text( text )
		{
			let CM = window.CodeMirror6;
			let map = map_of( instance.Get() );
			let words = ( text || '' ).replace( /^#+\s*/, '' ).replace( /\s+/g, ' ' ).trim().slice( 0, 60 );
			let position = map.Plain.indexOf( words );
			while ( position < 0 && words.length > 12 )
			{
				words = words.slice( 0, words.length - 8 );
				position = map.Plain.indexOf( words );
			}
			if ( position < 0 )
			{
				return;
			}
			let range = CM.AnchorMap.SourceRange( map, position, position + words.length );
			if ( range )
			{
				instance.ScrollTo( range.From );
				instance.Flash( range.From, range.To );
			}
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
			hide_selection_buttons();
			let dirty = ( current_text() !== controller.BaseText );
			if ( dirty !== controller.Dirty )
			{
				controller.Dirty = dirty;
				$scope.$applyAsync();
			}
			// the draft is written at once: the tab's dot and the close prompts read it (plan Markdown Editor, Step 3)
			let current = current_text();
			Tabs.SetDraft( State.OpenId, ( current !== controller.BaseText || controller.Stale ) ? { Text: current, Base: controller.Base } : null );
			if ( controller.Engine === 'codemirror' )
			{
				return;
			}
			if ( preview_timer )
			{
				$timeout.cancel( preview_timer );
			}
			preview_timer = $timeout( function ()
			{
				preview_timer = null;
				render_preview( current );
			}, PREVIEW_DELAY, false );
		}


		// Save: the text goes up as a new revision and the editor stays, now editing that revision. True when saved.
		controller.Save = async function ()
		{
			if ( !controller.Dirty || controller.Stale || controller.Busy || !State.EditorShown() || !instance )
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


		// Discard: the draft is forgotten. In CodeMirror mode the saved text comes back into the editor, which stays
		// (plan Markdown Editor, Step 3); in Monaco mode the view goes back to Read.
		controller.Discard = function ()
		{
			Tabs.SetDraft( State.OpenId, null );
			if ( controller.Engine === 'codemirror' && instance && State.Open )
			{
				controller.Base = State.Open.Plan.Revision;
				controller.BaseText = State.Open.Text;
				controller.Dirty = false;
				controller.Stale = false;
				instance.Set( State.Open.Text );
				set_anchors();
				return;
			}
			controller.Dirty = false;
			controller.Stale = false;
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


		function save_from_keys()
		{
			controller.Save();
		}

		Editor.OnSave( save_from_keys );
		Mirror.OnSave( save_from_keys );


		controller.$postLink = function ()
		{
			element = $element[ 0 ].querySelector( '#editor' );
			if ( opening || State.EditorShown() )
			{
				opening = false;
				open();
			}
		};


		controller.$onDestroy = function ()
		{
			keep_place();
			if ( instance )
			{
				instance.Dispose();
				instance = null;
			}
		};


		$scope.$on( 'view-changed', function ()
		{
			if ( State.EditorShown() )
			{
				open();
			}
		} );

		// The open plan's draft saved from the close prompt (Tabs.SaveDraft): the editor's base moves on with it.
		$scope.$on( 'draft-saved', function ( event, info )
		{
			if ( instance && State.Open && info.Id === State.OpenId )
			{
				controller.Base = info.Revision;
				controller.BaseText = info.Text;
				controller.Dirty = ( instance.Get() !== info.Text );
				controller.Stale = false;
			}
		} );

		// Source on or off (the heading's button, Ctrl+E): the open editor switches in place.
		$scope.$on( 'source-changed', function ()
		{
			if ( instance && instance.SetPreview )
			{
				instance.SetPreview( !State.Source );
				if ( editor_shown() )
				{
					instance.Focus();
				}
			}
		} );

		// The Editor setting changed: the open item re-opens the way the new mode shows it, a draft staying in its tab.
		$scope.$on( 'editor-changed', function ()
		{
			if ( State.EditorShown() )
			{
				open();
			}
		} );

		// A load while the editor is shown: another plan opens in it, or its archived state changed; the same plan at a
		// newer revision is taken silently while the text is clean and makes the edit stale when it is not (after a save
		// the base moved on already); then the anchors from the server's new positions, and the pending.
		$scope.$on( 'plan-loaded', function ()
		{
			if ( !State.EditorShown() || !State.Open )
			{
				return;
			}
			if ( !instance || opened_id !== State.OpenId || controller.ReadOnly !== !!State.Open.Plan.Archived )
			{
				open();
				return;
			}
			if ( controller.Base !== null && State.Open.Plan.Revision !== controller.Base )
			{
				if ( controller.Dirty )
				{
					controller.Stale = true;
				}
				else
				{
					take_live_text();
				}
			}
			set_anchors();
			settle_pending();
			$scope.$applyAsync();
		} );

		$scope.$on( 'thread-selected', function ( event, id )
		{
			if ( instance && instance.SetSelected )
			{
				instance.SetSelected( id );
			}
			if ( id && !selecting_from_editor )
			{
				reveal_thread( id );
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
