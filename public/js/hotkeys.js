'use strict';

// Hotkeys (plan UI Tweaks VI) - the one table of the page's keys. It drives both the Help > Hotkeys page and the
// one keydown listener, heard on the window before the editor or the browser act on a key.
//
//   row = { Keys: [ 'Ctrl+E', ... ], Label, When, Act: function ( event ) -> true when it acted }
//
// A key with several bindings lists them all: in a browser Ctrl+PgUp, Ctrl+PgDn and Ctrl+Shift+T are the browser's
// own and never reach the page, so each has a second binding that does (Alt+PgUp, Alt+PgDn, Ctrl+Shift+H); in the
// desktop both work. What only a controller can do (Save, Copy, Paste) is handed in with Provide( name, handler ).
//
// The rules: Ctrl+S and Ctrl+E work wherever the page has focus, the editor included; Ctrl+C and Ctrl+V are the
// browser's own while typing or with text selected; the Ctrl+Shift keys work everywhere; the tab keys work in the
// editor too (plan UI Tweaks IX) but Ctrl+Home and Ctrl+End, which are the editor's own there; Ctrl+F4 (Alt+W in a
// browser, where Ctrl+F4 is the browser's) closes the tab; no hotkey but Escape fires while a popup is open, and
// Escape presses the open popup's close button (plan UI Tweaks IX: every popup has one at its top right) wherever the
// focus is, or lets the menu close itself. Ctrl reads as Cmd on a Mac.

angular.module( 'Consensus' ).factory( 'Hotkeys', [ '$rootScope', '$window', 'State', 'Tabs', 'Menus', 'Reports', function ( $rootScope, $window, State, Tabs, Menus, Reports )
{
	const MAC = /Mac|iPhone|iPad/.test( $window.navigator.platform || '' );
	const NAMED = { PgUp: 'PageUp', PgDn: 'PageDown', Home: 'Home', End: 'End', Escape: 'Escape' };
	const VIEWS_WITH_EDIT = [ 'read', 'edit', 'revisions' ];
	let provided = {};


	function Provide( Name, Handler )
	{
		provided[ Name ] = Handler;
	}


	function call( name )
	{
		if ( typeof provided[ name ] !== 'function' )
		{
			return false;
		}
		provided[ name ]();
		return true;
	}


	//-----------------------------------------------------------------
	// Where the page is

	function active_element()
	{
		return document.activeElement || null;
	}


	function typing()
	{
		let active = active_element();
		if ( !active )
		{
			return false;
		}
		let tag = active.tagName;
		return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || active.isContentEditable || in_editor();
	}


	function in_editor()
	{
		let active = active_element();
		return !!active && !!active.closest( '.monaco-editor, .cm-editor' );
	}


	function text_selected()
	{
		let selection = $window.getSelection();
		return !!selection && !selection.isCollapsed;
	}


	// The popup shown, the last in the page when several are: an element with the subplan-popup class that is displayed.
	function open_popup()
	{
		let found = null;
		for ( let popup of document.querySelectorAll( '.subplan-popup' ) )
		{
			if ( getComputedStyle( popup ).display !== 'none' )
			{
				found = popup;
			}
		}
		return found;
	}


	function popup_open()
	{
		return !!open_popup();
	}


	function open_plan()
	{
		return !!State.Open && !!State.OpenId;
	}


	function archived()
	{
		return !!( State.Open && State.Open.Plan && State.Open.Plan.Archived );
	}


	function has_threads()
	{
		return open_plan() && State.Open.Plan.Kind !== 'document';
	}


	function is_plan()
	{
		return open_plan() && ( State.Open.Plan.Kind || 'plan' ) === 'plan';
	}


	//-----------------------------------------------------------------
	// The acts

	// Ctrl+E. In CodeMirror mode (plan Markdown Editor, Step 3): Source on or off, and from Revisions back to the
	// editor. In Monaco mode: Edit from Read or Revisions; from Edit, save (when there is something to save) and read.
	function edit_or_read()
	{
		if ( !open_plan() || VIEWS_WITH_EDIT.indexOf( State.View ) < 0 )
		{
			return false;
		}
		if ( State.Editor === 'codemirror' )
		{
			State.SetSource( !State.Source );
			if ( State.View === 'revisions' )
			{
				State.SetView( 'read' );
			}
			return true;
		}
		if ( archived() )
		{
			return false;
		}
		if ( State.View === 'edit' )
		{
			return call( 'EditToRead' );
		}
		State.SetView( 'edit' );
		return true;
	}


	// Ctrl+S: Save, staying in the editor. Taken there even with nothing to save, so the browser's own save never opens.
	function save()
	{
		if ( !State.EditorShown() )
		{
			return false;
		}
		call( 'Save' );
		return true;
	}


	function copy()
	{
		if ( typing() || text_selected() || !open_plan() )
		{
			return false;
		}
		return call( 'Copy' );
	}


	function paste()
	{
		if ( typing() )
		{
			return false;
		}
		return call( 'Paste' );
	}


	// Escape: the menu closes itself and a popup's close button is pressed for it (on_key, outside the digest, since the
	// button's own click runs one); with neither open, the selected thread is deselected.
	function escape()
	{
		if ( Menus.Open || popup_open() || !State.Selected )
		{
			return false;
		}
		State.Select( null );
		return true;
	}


	function toggle_tree()
	{
		if ( Tabs.Detached )
		{
			return false;
		}
		State.SetTreeHidden( !State.TreeHidden );
		return true;
	}


	function toggle_threads()
	{
		if ( !has_threads() )
		{
			return false;
		}
		State.SetThreadsHidden( !State.ThreadsHidden );
		return true;
	}


	function comment_on_whole()
	{
		let editor_shown = State.MirrorShown();
		if ( !is_plan() || !( State.View === 'read' || editor_shown ) || archived() )
		{
			return false;
		}
		State.StartCompose( null );
		return true;
	}


	// Ctrl+F4, or Alt+W (plan UI Tweaks IX): the active tab closes, a draft asking first as the tab's own close does.
	function close_tab()
	{
		let tab = Tabs.Active();
		if ( Tabs.Detached || !tab )
		{
			return false;
		}
		Tabs.Close( tab );
		return true;
	}


	// The tabs by keyboard: the main window's tabs that are not out in their own window, wrapping at the ends.
	function live_tabs()
	{
		return Tabs.List.filter( function ( tab ) { return !Tabs.IsOut( tab.Key ); } );
	}


	// In the editor the keys work too (plan UI Tweaks IX), but Ctrl+Home and Ctrl+End, which are the editor's own there.
	function go_tab( how, event )
	{
		if ( Tabs.Detached )
		{
			return false;
		}
		if ( in_editor() && ( how === 'first' || how === 'last' ) && ( event.ctrlKey || event.metaKey ) )
		{
			return false;
		}
		let list = live_tabs();
		if ( !list.length )
		{
			return false;
		}
		let at = list.findIndex( function ( tab ) { return tab.Key === Tabs.ActiveKey; } );
		let index = 0;
		if ( how === 'previous' )
		{
			index = ( at <= 0 ) ? list.length - 1 : at - 1;
		}
		else if ( how === 'next' )
		{
			index = ( at < 0 || at >= list.length - 1 ) ? 0 : at + 1;
		}
		else if ( how === 'last' )
		{
			index = list.length - 1;
		}
		Tabs.Open( list[ index ] );
		return true;
	}


	// Ctrl+P (plan Printing and Reporting): the open plan's report in a new tab; a document has none.
	function report()
	{
		if ( !open_plan() || ( State.Open.Plan.Kind || 'plan' ) !== 'plan' )
		{
			return false;
		}
		Reports.Open( State.Root, State.OpenId );
		return true;
	}


	//-----------------------------------------------------------------
	// The table

	let rows = [
		{ Keys: [ 'Ctrl+E' ], Label: 'Source on or off; in Monaco mode Edit, and from Edit save and read', When: 'an item open', Act: edit_or_read },
		{ Keys: [ 'Ctrl+S' ], Label: 'Save, staying in the editor', When: 'in the editor', Act: save },
		{ Keys: [ 'Ctrl+C' ], Label: 'Copy the open item\'s export', When: 'not typing, no text selected', Act: copy },
		{ Keys: [ 'Ctrl+V' ], Label: 'Paste into the open project', When: 'not typing', Act: paste },
		{ Keys: [ 'Escape' ], Label: 'Close the menu or the popup; deselect the thread', When: '', Act: escape },
		{ Keys: [ 'Ctrl+Shift+E' ], Label: 'Show or hide the project tree', When: 'the main window', Act: toggle_tree },
		{ Keys: [ 'Ctrl+Shift+T', 'Ctrl+Shift+H' ], Label: 'Show or hide the threads', When: 'a plan open', Act: toggle_threads },
		{ Keys: [ 'Ctrl+P' ], Label: 'Report: the open plan, its Subplans and all their threads as one page to print', When: 'a plan open', Act: report },
		{ Keys: [ 'Ctrl+Shift+C' ], Label: 'Comment on the whole document', When: 'a plan\'s Read view, or its CodeMirror editor', Act: comment_on_whole },
		{ Keys: [ 'Ctrl+PgUp', 'Alt+PgUp' ], Label: 'Previous tab, wrapping to the last', When: 'the main window, the editor included', Act: function ( event ) { return go_tab( 'previous', event ); } },
		{ Keys: [ 'Ctrl+PgDn', 'Alt+PgDn' ], Label: 'Next tab, wrapping to the first', When: 'the main window, the editor included', Act: function ( event ) { return go_tab( 'next', event ); } },
		{ Keys: [ 'Ctrl+Home', 'Alt+Home' ], Label: 'First tab', When: 'the main window; in the editor Alt+Home, Ctrl+Home being the editor\'s', Act: function ( event ) { return go_tab( 'first', event ); } },
		{ Keys: [ 'Ctrl+End', 'Alt+End' ], Label: 'Last tab', When: 'the main window; in the editor Alt+End, Ctrl+End being the editor\'s', Act: function ( event ) { return go_tab( 'last', event ); } },
		{ Keys: [ 'Ctrl+F4', 'Alt+W' ], Label: 'Close the tab', When: 'the main window', Act: close_tab },
	];


	// "Ctrl+Shift+E" as { Ctrl, Shift, Alt, Key }, Key as the event names it.
	function parse( combo )
	{
		let parts = combo.split( '+' );
		let key = parts.pop();
		return {
			Ctrl: parts.includes( 'Ctrl' ),
			Shift: parts.includes( 'Shift' ),
			Alt: parts.includes( 'Alt' ),
			Key: ( NAMED[ key ] || key ).toLowerCase(),
		};
	}


	for ( let row of rows )
	{
		row.Combos = row.Keys.map( parse );
	}


	function matches( event, combo )
	{
		let ctrl = event.ctrlKey || event.metaKey;
		if ( ctrl !== combo.Ctrl || event.shiftKey !== combo.Shift || event.altKey !== combo.Alt )
		{
			return false;
		}
		return String( event.key || '' ).toLowerCase() === combo.Key;
	}


	function on_key( event )
	{
		if ( event.key === 'Escape' && Menus.Open )
		{
			return;
		}
		let popup = open_popup();
		if ( popup )
		{
			// Escape presses the popup's close (plan UI Tweaks IX), wherever the focus is; the other keys are the popup's own
			let close = ( event.key === 'Escape' ) ? popup.querySelector( '.popup-close' ) : null;
			if ( close )
			{
				event.preventDefault();
				event.stopPropagation();
				close.click();
			}
			return;
		}
		for ( let row of rows )
		{
			for ( let combo of row.Combos )
			{
				if ( !matches( event, combo ) )
				{
					continue;
				}
				// Acted in a digest, as a click would be: what an act shows (the compose card) is drawn before a timer
				// of its own (its focus) runs.
				let acted = false;
				function act()
				{
					acted = row.Act( event );
				}
				if ( $rootScope.$$phase )
				{
					act();
				}
				else
				{
					$rootScope.$apply( act );
				}
				if ( acted )
				{
					event.preventDefault();
					event.stopPropagation();
				}
				return;
			}
		}
	}


	$window.addEventListener( 'keydown', on_key, true );


	// A row's keys as the Hotkeys page shows them: Cmd for Ctrl on a Mac.
	function Display( Keys )
	{
		return Keys.map( function ( combo ) { return MAC ? combo.replace( /^Ctrl\+/, 'Cmd+' ) : combo; } );
	}


	// The editor's own keys (plan UI Tweaks IX), listed by Help > Hotkeys; mirror.js and editor.js act on them.
	const EDITOR_ROWS = [
		{ Keys: [ 'Ctrl+Up', 'Ctrl+Down' ], Label: 'Scroll a line up or down, the cursor staying', When: '' },
		{ Keys: [ 'Ctrl+B' ], Label: 'Bold (**) around the selection or the word at the cursor; again takes it off', When: '' },
		{ Keys: [ 'Ctrl+I' ], Label: 'Italic (_) around the selection or the word at the cursor; again takes it off', When: '' },
		{ Keys: [ 'Ctrl+Home', 'Ctrl+End' ], Label: 'The start or the end of the text', When: '' },
	];


	// The desktop window's own keys (plan UI Components, Step 6): the accelerators of its menu, which is set but not
	// shown (desktop/main.js). Listed by Help > Hotkeys when the desktop is the host; nothing here acts on them.
	const DESKTOP_ROWS = [
		{ Keys: [ 'Ctrl+R' ], Label: 'Reload the page', When: '' },
		{ Keys: [ 'Ctrl+N' ], Label: 'New window', When: 'a second instance of the app' },
		{ Keys: [ 'Ctrl+Shift+O' ], Label: 'Open folder in new window', When: 'that folder\'s project alone' },
		{ Keys: [ 'F12', 'Ctrl+Shift+I' ], Label: 'The developer tools', When: '' },
		{ Keys: [ 'Ctrl+0', 'Ctrl+=', 'Ctrl+-' ], Label: 'Zoom: reset, in, out', When: '' },
		{ Keys: [ 'F11' ], Label: 'Full screen', When: '' },
	];


	return {
		Rows: rows,
		EditorRows: EDITOR_ROWS,
		DesktopRows: DESKTOP_ROWS,
		Desktop: !!( $window.Desktop && typeof $window.Desktop.Servers === 'function' ),
		Provide: Provide,
		Display: Display,
	};
} ] );
