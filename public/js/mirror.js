'use strict';

// Mirror - CodeMirror 6 behind the same small interface as Editor (Monaco), plan UI Components, Step 3. The modules
// come from codemirror-bundle.js (window.CodeMirror6, announced by codemirror-ready); Load waits for them.
//   Create( Element, Text, OnChange, Handlers, Options ) -> { Get, Set, Focus, Layout, LineHeight, Dispose, SetAnchors,
//                                                    SetSelected, SetPreview, ScrollTo, Flash, View }   the Edit view's editor
//       Options.Preview   true opens it as the Live Preview (live-preview.js, plan Markdown Editor, Step 1): the
//                         markdown rendered in place, the prose font, no gutters; SetPreview( On ) switches in place
//       Options.ReadOnly  true opens it read-only (an archived plan, a revision; plan Markdown Editor, Step 3);
//                         SetReadOnly( On ) switches in place
//   Plain( Element, Text, OnChange, OnSubmit ) -> { Get, Set, Focus, Layout, LineHeight, Dispose }  a comment box
//   OnSave( Handler )   Ctrl+S in the Edit view's editor
//   Theme()             every instance takes the page's palette as it stands (also on consensus-theme)
// The editor has line numbers and the fold gutter (in Source mode), wrapping, history, the default and search
// keymaps, Tab indents, multiple selections, the active line and markdown highlighting (GFM: tables, tasks,
// strikethrough, as the server renders them). Its anchors: SetAnchors
// takes [ { From, To, Id, State } ] in source offsets and marks them (class anchor, the state, selected), the marks
// following the text through edits; SetSelected restyles for the selected thread; a mousedown on a mark calls
// Handlers.OnAnchorClick( ids ) with the threads under the pointer, and a click off any mark that leaves no selection
// calls Handlers.OnBlankClick() (plan UI Tweaks X); Handlers.OnSelection() is called when the selection changes. ScrollTo( From ) brings a position to the middle; Flash( From, To ) marks a range for a second
// (plan Markdown Editor, Step 2). GetPlace and SetPlace (plan UI Tweaks IX): the scroll and the selection, kept per tab.
// The keys (plan UI Tweaks IX): Ctrl+Up and Ctrl+Down scroll a line, Ctrl+B and Ctrl+I toggle bold (**) and italic (_)
// around the selection or the word at the caret. The Live Preview's table widget marks the anchors within it with the
// Read view's own wrapping (Render.Show), handed to it with the anchor field.

angular.module( 'Consensus.Mirror', [] ).factory( 'Mirror', [ '$q', 'Render', function ( $q, Render )
{
	let loading = null;
	let save_handler = null;
	let instances = new Set();
	let effects = null;		// the anchor effects and field, made once the modules are in


	function Load()
	{
		if ( !loading )
		{
			loading = $q( function ( resolve )
			{
				if ( window.CodeMirror6 )
				{
					resolve( window.CodeMirror6 );
					return;
				}
				document.addEventListener( 'codemirror-ready', function () { resolve( window.CodeMirror6 ); }, { once: true } );
			} );
		}
		return loading;
	}


	function is_dark()
	{
		return document.documentElement.dataset.bsTheme === 'dark';
	}


	function variable( name, fallback )
	{
		let value = getComputedStyle( document.documentElement ).getPropertyValue( name ).trim();
		return value || fallback;
	}


	// The theme in the page's colours: the background, the text, the gutter, the active line, the selection, and the
	// markdown's highlighting (headings bold, emphasis italic, the syntax marks and URLs muted, links in the accent), so
	// both palettes read; CodeMirror's default style is made for a light page.
	function theme_extension( CM )
	{
		let background = variable( '--page-bg', '#ffffff' );
		let text = variable( '--text', '#212529' );
		let muted = variable( '--muted', '#6c757d' );
		let panel = variable( '--panel-bg', '#f8f9fa' );
		let border = variable( '--border', '#dee2e6' );
		let accent = variable( '--accent', '#0d6efd' );
		let selection = is_dark() ? 'rgba( 110, 168, 254, 0.35 )' : 'rgba( 13, 110, 253, 0.22 )';
		let tags = CM.tags;
		let highlighting = CM.HighlightStyle.define( [
			{ tag: tags.heading, fontWeight: 'bold' },
			{ tag: tags.emphasis, fontStyle: 'italic' },
			{ tag: tags.strong, fontWeight: 'bold' },
			{ tag: tags.strikethrough, textDecoration: 'line-through' },
			{ tag: tags.link, color: accent, textDecoration: 'underline' },
			{ tag: tags.url, color: muted },
			{ tag: tags.processingInstruction, color: muted },
			{ tag: tags.quote, color: muted },
			{ tag: tags.escape, color: muted },
			{ tag: tags.labelName, color: muted },
			{ tag: tags.contentSeparator, color: muted },
			{ tag: tags.monospace, color: text },
		] );
		return [ CM.syntaxHighlighting( highlighting ), CM.EditorView.theme( {
			'&': { backgroundColor: background, color: text, height: '100%' },
			'.cm-scroller': { fontFamily: 'Consolas, "Cascadia Mono", Menlo, monospace', fontSize: '14px', lineHeight: '1.5' },
			// the Live Preview reads as the Read view does: the page's font and size
			'&.cm-live .cm-scroller': { fontFamily: 'inherit', fontSize: '1rem', lineHeight: '1.6' },
			'.cm-content': { caretColor: text },
			'.cm-cursor, .cm-dropCursor': { borderLeftColor: text },
			'&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: selection },
			'.cm-gutters': { backgroundColor: background, color: muted, borderRight: '1px solid ' + border },
			// translucent: drawSelection paints the selection behind the content, and an opaque line would hide it (plan UI Tweaks VIII)
			'.cm-activeLine': { backgroundColor: 'color-mix( in srgb, ' + panel + ' 55%, transparent )' },
			'.cm-activeLineGutter': { backgroundColor: panel },
			'.cm-foldPlaceholder': { backgroundColor: panel, border: '1px solid ' + border, color: muted },
			'.cm-panels': { backgroundColor: panel, color: text },
			'.cm-searchMatch': { backgroundColor: selection },
		}, { dark: is_dark() } ) ];
	}


	//-----------------------------------------------------------------
	// The anchors: a field of mark decorations set by an effect and mapped through the document's changes; a second
	// effect restyles them for the selected thread.

	function anchor_effects( CM )
	{
		if ( effects )
		{
			return effects;
		}
		let set_anchors = CM.StateEffect.define();
		let set_selected = CM.StateEffect.define();
		let set_flash = CM.StateEffect.define();

		function mark_of( anchor, selected_id )
		{
			let classes = 'anchor ' + anchor.State + ( anchor.Id === selected_id ? ' selected' : '' );
			return CM.Decoration.mark( { class: classes, attributes: { 'data-threads': anchor.Id }, Anchor: anchor } );
		}

		// The marks: the anchors, and the flashed range while there is one (a mark of its own, over whatever is there).
		function build( anchors, selected_id, flash )
		{
			let ranges = [];
			for ( let anchor of anchors )
			{
				if ( anchor.To > anchor.From )
				{
					ranges.push( mark_of( anchor, selected_id ).range( anchor.From, anchor.To ) );
				}
			}
			if ( flash && flash.To > flash.From )
			{
				ranges.push( CM.Decoration.mark( { class: 'flash-mark', Flash: true } ).range( flash.From, flash.To ) );
			}
			return CM.Decoration.set( ranges, true );
		}

		// The anchors as the field keeps them: their current ranges and the thread each marks.
		function anchors_of( decorations )
		{
			let anchors = [];
			decorations.between( 0, Number.MAX_SAFE_INTEGER, function ( from, to, decoration )
			{
				if ( decoration.spec.Anchor )
				{
					anchors.push( Object.assign( {}, decoration.spec.Anchor, { From: from, To: to } ) );
				}
			} );
			return anchors;
		}

		// The flashed range as the field keeps it, or null.
		function flash_of( decorations )
		{
			let flash = null;
			decorations.between( 0, Number.MAX_SAFE_INTEGER, function ( from, to, decoration )
			{
				if ( decoration.spec.Flash )
				{
					flash = { From: from, To: to };
				}
			} );
			return flash;
		}

		let field = CM.StateField.define( {
			create: function () { return { Decorations: CM.Decoration.none, Selected: null }; },
			update: function ( value, transaction )
			{
				if ( !transaction.docChanged && !transaction.effects.length )
				{
					return value;
				}
				let decorations = value.Decorations.map( transaction.changes );
				let selected = value.Selected;
				for ( let effect of transaction.effects )
				{
					if ( effect.is( set_anchors ) )
					{
						decorations = build( effect.value, selected, flash_of( decorations ) );
					}
					else if ( effect.is( set_selected ) )
					{
						selected = effect.value;
						decorations = build( anchors_of( decorations ), selected, flash_of( decorations ) );
					}
					else if ( effect.is( set_flash ) )
					{
						decorations = build( anchors_of( decorations ), selected, effect.value );
					}
				}
				return { Decorations: decorations, Selected: selected };
			},
			provide: function ( self )
			{
				return CM.EditorView.decorations.from( self, function ( value ) { return value.Decorations; } );
			},
		} );
		effects = { SetAnchors: set_anchors, SetSelected: set_selected, SetFlash: set_flash, Field: field, AnchorsOf: anchors_of };
		return effects;
	}


	// The threads marked at a document position, in the order of their marks.
	function threads_at( CM, view, position )
	{
		let ids = [];
		view.state.field( anchor_effects( CM ).Field ).Decorations.between( position, position, function ( from, to, decoration )
		{
			if ( decoration.spec.Anchor && from <= position && position <= to )
			{
				ids.push( decoration.spec.Anchor.Id );
			}
		} );
		return ids;
	}


	//-----------------------------------------------------------------
	// The keys (plan UI Tweaks IX).

	// Ctrl+Up and Ctrl+Down: the view scrolls one line, the selection stays.
	function scroll_line( view, direction )
	{
		view.scrollDOM.scrollBy( 0, direction * view.defaultLineHeight );
		return true;
	}


	// Ctrl+B and Ctrl+I: Mark put around the main selection, or the word at the caret; already there, inside the
	// selection or just outside it, it comes off.
	function toggle_mark( view, mark )
	{
		let state = view.state;
		let range = state.selection.main;
		let from = range.from;
		let to = range.to;
		if ( range.empty )
		{
			let word = state.wordAt( from );
			if ( !word )
			{
				return true;
			}
			from = word.from;
			to = word.to;
		}
		let length = mark.length;
		let inside = state.sliceDoc( from, to );
		let before = state.sliceDoc( Math.max( 0, from - length ), from );
		let after = state.sliceDoc( to, Math.min( state.doc.length, to + length ) );
		if ( inside.length >= 2 * length && inside.startsWith( mark ) && inside.endsWith( mark ) )
		{
			view.dispatch( { changes: [ { from: from, to: from + length, insert: '' }, { from: to - length, to: to, insert: '' } ], selection: { anchor: from, head: to - 2 * length } } );
			return true;
		}
		if ( before === mark && after === mark )
		{
			view.dispatch( { changes: [ { from: from - length, to: from, insert: '' }, { from: to, to: to + length, insert: '' } ], selection: { anchor: from - length, head: to - length } } );
			return true;
		}
		view.dispatch( { changes: [ { from: from, insert: mark }, { from: to, insert: mark } ], selection: { anchor: from + length, head: to + length } } );
		return true;
	}


	function key_extensions()
	{
		return [
			{ key: 'Mod-ArrowUp', run: function ( view ) { return scroll_line( view, -1 ); } },
			{ key: 'Mod-ArrowDown', run: function ( view ) { return scroll_line( view, 1 ); } },
			{ key: 'Mod-b', run: function ( view ) { return toggle_mark( view, '**' ); } },
			{ key: 'Mod-i', run: function ( view ) { return toggle_mark( view, '_' ); } },
		];
	}


	function common_extensions( CM, theme, OnChange )
	{
		return [
			theme.of( theme_extension( CM ) ),
			CM.history(),
			CM.drawSelection(),
			CM.markdown( { base: CM.markdownLanguage } ),
			CM.EditorView.lineWrapping,
			CM.EditorView.updateListener.of( function ( update )
			{
				if ( update.docChanged )
				{
					OnChange();
				}
			} ),
		];
	}


	function make_instance( CM, view, theme )
	{
		let instance = {
			View: view,
			Get: function () { return view.state.doc.toString(); },
			Set: function ( Text )
			{
				view.dispatch( { changes: { from: 0, to: view.state.doc.length, insert: Text || '' } } );
			},
			Focus: function () { view.focus(); },
			Layout: function () {},
			// the line height from the theme's styles, which apply at once; CodeMirror's own measure comes a frame later
			LineHeight: function ()
			{
				let measured = parseFloat( getComputedStyle( view.contentDOM ).lineHeight );
				return isNaN( measured ) ? view.defaultLineHeight : measured;
			},
			Dispose: function ()
			{
				instances.delete( instance );
				view.destroy();
			},
			Retheme: function ()
			{
				view.dispatch( { effects: theme.reconfigure( theme_extension( CM ) ) } );
			},
		};
		instances.add( instance );
		return instance;
	}


	// The gutters of Source mode; the Live Preview has none.
	function gutter_extensions( CM )
	{
		return [ CM.lineNumbers(), CM.highlightActiveLineGutter(), CM.foldGutter() ];
	}


	// Read-only: no edits by hand (a programmatic change still goes through), the content not editable.
	function editing_extensions( CM, read_only )
	{
		return [ CM.EditorState.readOnly.of( read_only ), CM.EditorView.editable.of( !read_only ) ];
	}


	// The Live Preview, with the class the theme and the styles key on (an editor attribute: CodeMirror owns the
	// editor element's class list and would drop a class set from outside).
	function live_extensions( CM, Handlers )
	{
		let options = { Anchors: anchor_effects( CM ).Field, Wrap: Render.Show, OnAnchorClick: ( Handlers && Handlers.OnAnchorClick ) ? Handlers.OnAnchorClick : null };
		return [ CM.LivePreview.Extension( options ), CM.EditorView.editorAttributes.of( { class: 'cm-live' } ) ];
	}


	// Create: the Edit view's editor in Element, holding Text; OnChange fires on every edit; Handlers.OnAnchorClick
	// gets the threads under a mousedown on a mark; Options.Preview opens it as the Live Preview.
	async function Create( Element, Text, OnChange, Handlers, Options )
	{
		let CM = await Load();
		let anchors = anchor_effects( CM );
		let theme = new CM.Compartment();
		let gutters = new CM.Compartment();
		let preview = new CM.Compartment();
		let editing = new CM.Compartment();
		let live = !!( Options && Options.Preview );
		let read_only = !!( Options && Options.ReadOnly );
		let state = CM.EditorState.create( {
			doc: Text || '',
			extensions: [
				gutters.of( live ? [] : gutter_extensions( CM ) ),
				editing.of( editing_extensions( CM, read_only ) ),
				CM.EditorState.allowMultipleSelections.of( true ),
				CM.rectangularSelection(),
				CM.crosshairCursor(),
				CM.highlightActiveLine(),
				CM.highlightSelectionMatches(),
				anchors.Field,
				CM.EditorView.domEventHandlers( {
					mousedown: function ( event, view )
					{
						if ( !Handlers || !Handlers.OnAnchorClick || !event.target.closest( '.anchor' ) )
						{
							return false;
						}
						let position = view.posAtCoords( { x: event.clientX, y: event.clientY } );
						let ids = ( position === null ) ? [] : threads_at( CM, view, position );
						if ( !ids.length )
						{
							ids = String( event.target.closest( '.anchor' ).dataset.threads || '' ).split( ' ' ).filter( function ( id ) { return !!id; } );
						}
						if ( ids.length )
						{
							Handlers.OnAnchorClick( ids );
						}
						return false;
					},
					// a click off any mark that leaves the caret (not one ending a drag) deselects the thread (plan UI Tweaks X)
					click: function ( event, view )
					{
						if ( !Handlers || !Handlers.OnBlankClick || event.target.closest( '.anchor' ) )
						{
							return false;
						}
						if ( !view.state.selection.main.empty )
						{
							return false;
						}
						Handlers.OnBlankClick();
						return false;
					},
				} ),
				CM.EditorView.updateListener.of( function ( update )
				{
					if ( update.selectionSet && Handlers && Handlers.OnSelection )
					{
						Handlers.OnSelection();
					}
				} ),
				CM.keymap.of( [
					{ key: 'Mod-s', run: function () { if ( save_handler ) { save_handler(); } return true; } },
					CM.indentWithTab,
				].concat( key_extensions(), CM.defaultKeymap, CM.historyKeymap, CM.searchKeymap, CM.foldKeymap ) ),
			].concat( common_extensions( CM, theme, OnChange ) ).concat( [
				// after the language, whose tree the preview reads
				preview.of( live ? live_extensions( CM, Handlers ) : [] ),
			] ),
		} );
		let view = new CM.EditorView( { state: state, parent: Element } );
		let instance = make_instance( CM, view, theme );
		// The Live Preview on or off, in place: the text, the cursor, the scroll and the history stay.
		instance.SetPreview = function ( On )
		{
			live = !!On;
			view.dispatch( { effects: [ preview.reconfigure( live ? live_extensions( CM, Handlers ) : [] ), gutters.reconfigure( live ? [] : gutter_extensions( CM ) ) ] } );
		};
		instance.IsPreview = function () { return live; };
		// The place (plan UI Tweaks IX): the scroll and the main selection, taken when a tab is left and put back when it
		// is shown again; the scroll is set once more a frame later, when the view has measured the new text.
		instance.GetPlace = function ()
		{
			let main = view.state.selection.main;
			return { Scroll: view.scrollDOM.scrollTop, Anchor: main.anchor, Head: main.head };
		};
		instance.SetPlace = function ( Place )
		{
			if ( !Place )
			{
				return;
			}
			let length = view.state.doc.length;
			let anchor = Math.max( 0, Math.min( length, Place.Anchor || 0 ) );
			let head = Math.max( 0, Math.min( length, ( Place.Head === undefined ) ? anchor : Place.Head ) );
			view.dispatch( { selection: { anchor: anchor, head: head } } );
			let scroll = Place.Scroll || 0;
			view.scrollDOM.scrollTop = scroll;
			// once more after the view's next measure of the new text, and the frame after that
			view.requestMeasure( { read: function () { return null; }, write: function ()
			{
				view.scrollDOM.scrollTop = scroll;
				window.requestAnimationFrame( function ()
				{
					if ( instances.has( instance ) )
					{
						view.scrollDOM.scrollTop = scroll;
					}
				} );
			} } );
		};
		instance.SetReadOnly = function ( On )
		{
			if ( read_only === !!On )
			{
				return;
			}
			read_only = !!On;
			view.dispatch( { effects: editing.reconfigure( editing_extensions( CM, read_only ) ) } );
		};
		instance.SetAnchors = function ( Anchors )
		{
			view.dispatch( { effects: anchors.SetAnchors.of( Anchors || [] ) } );
		};
		instance.SetSelected = function ( Id )
		{
			view.dispatch( { effects: anchors.SetSelected.of( Id || null ) } );
		};
		instance.Anchors = function ()
		{
			return anchors.AnchorsOf( view.state.field( anchors.Field ).Decorations );
		};
		// A position brought to the middle of the view.
		instance.ScrollTo = function ( From )
		{
			view.dispatch( { effects: CM.EditorView.scrollIntoView( From, { y: 'center' } ) } );
		};
		// A range marked for a second (the class flash-mark, animated by edit-view.css).
		let flash_timer = null;
		instance.Flash = function ( From, To )
		{
			if ( flash_timer )
			{
				clearTimeout( flash_timer );
			}
			view.dispatch( { effects: anchors.SetFlash.of( { From: From, To: To } ) } );
			flash_timer = setTimeout( function ()
			{
				flash_timer = null;
				if ( instances.has( instance ) )
				{
					view.dispatch( { effects: anchors.SetFlash.of( null ) } );
				}
			}, 1200 );
		};
		return instance;
	}


	// Plain: a comment box: wrapped markdown, no gutters; Ctrl+Enter is OnSubmit.
	async function Plain( Element, Text, OnChange, OnSubmit )
	{
		let CM = await Load();
		let theme = new CM.Compartment();
		let state = CM.EditorState.create( {
			doc: Text || '',
			extensions: [
				CM.keymap.of( [
					{ key: 'Mod-Enter', run: function () { if ( OnSubmit ) { OnSubmit(); } return true; } },
				].concat( CM.defaultKeymap, CM.historyKeymap ) ),
			].concat( common_extensions( CM, theme, OnChange ) ),
		} );
		let view = new CM.EditorView( { state: state, parent: Element } );
		return make_instance( CM, view, theme );
	}


	function OnSave( Handler )
	{
		save_handler = Handler;
	}


	function Theme()
	{
		for ( let instance of instances )
		{
			instance.Retheme();
		}
	}


	document.addEventListener( 'consensus-theme', function ()
	{
		Theme();
	} );


	return {
		Load: Load,
		Create: Create,
		Plain: Plain,
		OnSave: OnSave,
		Theme: Theme,
	};
} ] );
