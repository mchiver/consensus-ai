'use strict';

// Editor - Monaco over the markdown, loaded once through its AMD loader from /vendor/monaco.
// One editor instance lives in the edit view; Create replaces its text, Dispose frees it.

angular.module( 'Consensus.Editor', [] ).factory( 'Editor', [ '$q', function ( $q )
{
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


	function theme_name()
	{
		return ( document.documentElement.dataset.bsTheme === 'dark' ) ? 'vs-dark' : 'vs';
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
				theme: theme_name(),
				wordWrap: 'on',
				minimap: { enabled: false },
				lineNumbers: 'on',
				fontSize: 14,
				scrollBeyondLastLine: false,
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
		editor.updateOptions( { theme: theme_name() } );
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


	function Theme( Dark )
	{
		if ( editor && window.monaco )
		{
			window.monaco.editor.setTheme( Dark ? 'vs-dark' : 'vs' );
		}
	}


	// The page's theme changed: the editor follows.
	document.addEventListener( 'consensus-theme', function ( event )
	{
		Theme( event.detail.Dark );
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
