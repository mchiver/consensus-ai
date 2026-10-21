'use strict';

// Editor - Monaco behind the engine interface the Edit view and the comment boxes use (plan UI Components, Step 3;
// Mirror is CodeMirror behind the same one), loaded once through its AMD loader from /vendor/monaco.
//   Create( Element, Text, OnChange ) -> { Get, Set, Focus, Layout, LineHeight, Dispose, Raw }   the Edit view's editor
//   Plain( Element, Text, OnChange, OnSubmit ) -> the same shape, a comment box: wrapped markdown, no gutter
//   OnSave( Handler )   Ctrl+S in the Edit view's editor
//   Theme()             every instance takes the page's palette as it stands (also on consensus-theme; plan UI Tweaks IV)
// Each Create makes an instance of its own; the owner disposes it.

angular.module( 'Consensus.Editor', [] ).factory( 'Editor', [ '$q', function ( $q )
{
	const THEME_NAME = 'consensus';
	let loading = null;
	let save_handler = null;


	// Load: the AMD loader fetches vs/editor/editor.main once; the promise resolves with the monaco namespace.
	function Load()
	{
		if ( !loading )
		{
			loading = $q( function ( resolve, reject )
			{
				window.require.config( { paths: { vs: '/vendor/monaco' } } );
				window.require( [ 'vs/editor/editor.main' ], function ()
				{
					resolve( window.monaco );
				}, reject );
			} );
		}
		return loading;
	}


	function is_dark()
	{
		return document.documentElement.dataset.bsTheme === 'dark';
	}


	function variable( name )
	{
		return getComputedStyle( document.documentElement ).getPropertyValue( name ).trim();
	}


	// A Monaco theme in the page's colours: the base is vs or vs-dark, the background, text and gutter the palette's.
	function define_theme( monaco )
	{
		let colors = {};
		let background = variable( '--page-bg' );
		let text = variable( '--text' );
		let muted = variable( '--muted' );
		let panel = variable( '--panel-bg' );
		if ( /^#[0-9a-f]{6}$/i.test( background ) )
		{
			colors[ 'editor.background' ] = background;
			colors[ 'editorGutter.background' ] = background;
		}
		if ( /^#[0-9a-f]{6}$/i.test( text ) )
		{
			colors[ 'editor.foreground' ] = text;
		}
		if ( /^#[0-9a-f]{6}$/i.test( muted ) )
		{
			colors[ 'editorLineNumber.foreground' ] = muted;
		}
		if ( /^#[0-9a-f]{6}$/i.test( panel ) )
		{
			colors[ 'editor.lineHighlightBackground' ] = panel;
		}
		monaco.editor.defineTheme( THEME_NAME, { base: is_dark() ? 'vs-dark' : 'vs', inherit: true, rules: [], colors: colors } );
		return THEME_NAME;
	}


	// An instance behind the interface; Dispose frees Monaco and empties the element.
	function wrap( monaco, instance, Element )
	{
		return {
			Raw: instance,
			Get: function () { return instance.getValue(); },
			Set: function ( Text ) { instance.setValue( Text || '' ); },
			Focus: function () { instance.focus(); },
			Layout: function () { instance.layout(); },
			LineHeight: function () { return instance.getOption( monaco.editor.EditorOption.lineHeight ); },
			// The place (plan UI Tweaks IX): Monaco's own view state, the scroll and the cursor; none means the top.
			GetPlace: function () { return { Monaco: instance.saveViewState() }; },
			SetPlace: function ( Place )
			{
				if ( Place && Place.Monaco )
				{
					instance.restoreViewState( Place.Monaco );
					return;
				}
				instance.setScrollTop( 0 );
				instance.setPosition( { lineNumber: 1, column: 1 } );
			},
			Dispose: function ()
			{
				instance.dispose();
				Element.innerHTML = '';
			},
		};
	}


	// A key chord on an instance, handled by the instance alone (addCommand's bindings are Monaco-wide and pile up).
	function on_chord( monaco, instance, key_code, handler )
	{
		instance.onKeyDown( function ( event )
		{
			if ( ( event.ctrlKey || event.metaKey ) && event.keyCode === key_code )
			{
				event.preventDefault();
				event.stopPropagation();
				handler();
			}
		} );
	}


	// Ctrl+B and Ctrl+I (plan UI Tweaks IX): Mark put around the selection, or the word at the cursor; already there,
	// inside the selection or just outside it, it comes off.
	function toggle_mark( monaco, instance, mark )
	{
		let model = instance.getModel();
		let selection = instance.getSelection();
		let range = selection;
		if ( selection.isEmpty() )
		{
			let word = model.getWordAtPosition( selection.getStartPosition() );
			if ( !word )
			{
				return;
			}
			range = new monaco.Range( selection.startLineNumber, word.startColumn, selection.startLineNumber, word.endColumn );
		}
		let length = mark.length;
		let one_line = ( range.startLineNumber === range.endLineNumber );
		let inside = model.getValueInRange( range );
		let before = model.getValueInRange( new monaco.Range( range.startLineNumber, Math.max( 1, range.startColumn - length ), range.startLineNumber, range.startColumn ) );
		let after = model.getValueInRange( new monaco.Range( range.endLineNumber, range.endColumn, range.endLineNumber, range.endColumn + length ) );
		let edits = null;
		let next = null;
		if ( inside.length >= 2 * length && inside.startsWith( mark ) && inside.endsWith( mark ) )
		{
			edits = [
				{ range: new monaco.Range( range.startLineNumber, range.startColumn, range.startLineNumber, range.startColumn + length ), text: '' },
				{ range: new monaco.Range( range.endLineNumber, range.endColumn - length, range.endLineNumber, range.endColumn ), text: '' },
			];
			next = new monaco.Selection( range.startLineNumber, range.startColumn, range.endLineNumber, range.endColumn - ( one_line ? 2 * length : length ) );
		}
		else if ( before === mark && after === mark )
		{
			edits = [
				{ range: new monaco.Range( range.startLineNumber, range.startColumn - length, range.startLineNumber, range.startColumn ), text: '' },
				{ range: new monaco.Range( range.endLineNumber, range.endColumn, range.endLineNumber, range.endColumn + length ), text: '' },
			];
			next = new monaco.Selection( range.startLineNumber, range.startColumn - length, range.endLineNumber, range.endColumn - ( one_line ? length : 0 ) );
		}
		else
		{
			edits = [
				{ range: new monaco.Range( range.startLineNumber, range.startColumn, range.startLineNumber, range.startColumn ), text: mark },
				{ range: new monaco.Range( range.endLineNumber, range.endColumn, range.endLineNumber, range.endColumn ), text: mark },
			];
			next = new monaco.Selection( range.startLineNumber, range.startColumn + length, range.endLineNumber, range.endColumn + ( one_line ? length : 0 ) );
		}
		instance.executeEdits( 'mark', edits );
		instance.setSelection( next );
	}


	// Create: the Edit view's editor in Element holding Text; OnChange fires on every edit; Ctrl+S is OnSave's handler;
	// Ctrl+B and Ctrl+I toggle the marks (plan UI Tweaks IX).
	async function Create( Element, Text, OnChange )
	{
		let monaco = await Load();
		let instance = monaco.editor.create( Element, {
			value: Text || '',
			language: 'markdown',
			theme: define_theme( monaco ),
			wordWrap: 'on',
			minimap: { enabled: false },
			lineNumbers: 'on',
			fontSize: 14,
			scrollBeyondLastLine: true,
			automaticLayout: true,
			renderWhitespace: 'none',
			quickSuggestions: false,
		} );
		on_chord( monaco, instance, monaco.KeyCode.KeyS, function ()
		{
			if ( save_handler )
			{
				save_handler();
			}
		} );
		on_chord( monaco, instance, monaco.KeyCode.KeyB, function () { toggle_mark( monaco, instance, '**' ); } );
		on_chord( monaco, instance, monaco.KeyCode.KeyI, function () { toggle_mark( monaco, instance, '_' ); } );
		instance.onDidChangeModelContent( function ()
		{
			OnChange();
		} );
		Theme();
		instance.layout();
		return wrap( monaco, instance, Element );
	}


	// Plain: a comment box: markdown, wrapped, no gutter, no minimap, the page's theme, and the wheel left to the
	// pane when the box cannot scroll. OnChange fires on every edit, OnSubmit on Ctrl+Enter.
	async function Plain( Element, Text, OnChange, OnSubmit )
	{
		let monaco = await Load();
		let instance = monaco.editor.create( Element, {
			value: Text || '',
			language: 'markdown',
			theme: define_theme( monaco ),
			wordWrap: 'on',
			minimap: { enabled: false },
			lineNumbers: 'off',
			glyphMargin: false,
			folding: false,
			lineDecorationsWidth: 8,
			lineNumbersMinChars: 0,
			renderLineHighlight: 'none',
			fontSize: 14,
			scrollBeyondLastLine: false,
			automaticLayout: true,
			renderWhitespace: 'none',
			quickSuggestions: false,
			wordBasedSuggestions: 'off',
			overviewRulerLanes: 0,
			hideCursorInOverviewRuler: true,
			overviewRulerBorder: false,
			scrollbar: { horizontal: 'hidden', verticalScrollbarSize: 8, alwaysConsumeMouseWheel: false },
			padding: { top: 6, bottom: 6 },
		} );
		instance.onDidChangeModelContent( function ()
		{
			OnChange();
		} );
		on_chord( monaco, instance, monaco.KeyCode.Enter, function ()
		{
			if ( OnSubmit )
			{
				OnSubmit();
			}
		} );
		return wrap( monaco, instance, Element );
	}


	function OnSave( Handler )
	{
		save_handler = Handler;
	}


	// Theme: every instance takes the page's palette as it stands (the theme is one for all instances).
	function Theme()
	{
		if ( window.monaco )
		{
			window.monaco.editor.setTheme( define_theme( window.monaco ) );
		}
	}


	// The page's theme changed: the editors follow.
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
