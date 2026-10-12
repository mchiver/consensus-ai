'use strict';

// Editor - Monaco over the markdown, loaded once through its AMD loader from /vendor/monaco.
// One editor instance lives in the edit view; Create replaces its text, Dispose frees it.
// The editor's colours follow the page's palette (plan UI Tweaks IV): a Monaco theme is defined from the page's
// CSS variables each time the theme changes, and the editor scrolls past the end of the text.

angular.module( 'Consensus.Editor', [] ).factory( 'Editor', [ '$q', function ( $q )
{
	const THEME_NAME = 'consensus';
	let loading = null;
	let editor = null;
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


	// Create: an editor in Element holding Text; OnChange fires on every edit.
	async function Create( Element, Text, OnChange )
	{
		let monaco = await Load();
		if ( !editor )
		{
			editor = monaco.editor.create( Element, {
				value: Text,
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
			editor.addCommand( monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, function ()
			{
				if ( save_handler )
				{
					save_handler();
				}
			} );
			editor.onDidChangeModelContent( function ()
			{
				if ( editor.OnChange )
				{
					editor.OnChange();
				}
			} );
		}
		else
		{
			editor.setValue( Text );
		}
		editor.OnChange = OnChange;
		Theme();
		editor.layout();
		editor.focus();
		return editor;
	}


	function Get()
	{
		return editor ? editor.getValue() : '';
	}


	function Set( Text )
	{
		if ( editor )
		{
			editor.setValue( Text );
		}
	}


	function Layout()
	{
		if ( editor )
		{
			editor.layout();
		}
	}


	function OnSave( Handler )
	{
		save_handler = Handler;
	}


	// Theme: the editor takes the page's palette as it stands.
	function Theme()
	{
		if ( editor && window.monaco )
		{
			window.monaco.editor.setTheme( define_theme( window.monaco ) );
		}
	}


	// The page's theme changed: the editor follows.
	document.addEventListener( 'consensus-theme', function ()
	{
		Theme();
	} );


	return {
		Load: Load,
		Create: Create,
		Get: Get,
		Set: Set,
		Layout: Layout,
		OnSave: OnSave,
		Theme: Theme,
	};
} ] );
