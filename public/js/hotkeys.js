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
// browser's own while typing or with text selected; the Ctrl+Shift keys work everywhere; the tab keys yield to the
// editor, whose own they are there; no hotkey but Escape fires while a popup is open, and Escape is the popups' and
// the menu's own, each closing itself. Ctrl reads as Cmd on a Mac.

angular.module( 'Consensus' ).factory( 'Hotkeys', [ '$rootScope', '$window', 'State', 'Tabs', 'Menus', function ( $rootScope, $window, State, Tabs, Menus )
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


	function popup_open()
	{
		for ( let popup of document.querySelectorAll( '.subplan-popup' ) )
		{
			if ( getComputedStyle( popup ).display !== 'none' )
			{
				return true;
			}
		}
		return false;
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

	// Ctrl+E: Edit from Read or Revisions; from Edit, save (when there is something to save) and read.
	function edit_or_read()
	{
		if ( !open_plan() || VIEWS_WITH_EDIT.indexOf( State.View ) < 0 || archived() )
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


	// Ctrl+S: Save, staying in Edit. Taken in Edit even with nothing to save, so the browser's own save never opens.
	function save()
	{
		if ( State.View !== 'edit' )
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


	// Escape: the menu and the popups close themselves; with none open, the selected thread is deselected.
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
		if ( !is_plan() || State.View !== 'read' || archived() )
		{
			return false;
		}
		State.StartCompose( null );
		return true;
	}


	// The tabs by keyboard: the main window's tabs that are not out in their own window, wrapping at the ends.
	function live_tabs()
	{
		return Tabs.List.filter( function ( tab ) { return !Tabs.IsOut( tab.Key ); } );
	}


	function go_tab( how )
	{
		if ( Tabs.Detached || in_editor() )
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


	//-----------------------------------------------------------------
	// The table

	let rows = [
		{ Keys: [ 'Ctrl+E' ], Label: 'Edit; from Edit, save and read', When: 'an item open, not archived', Act: edit_or_read },
		{ Keys: [ 'Ctrl+S' ], Label: 'Save, staying in Edit', When: 'in Edit', Act: save },
		{ Keys: [ 'Ctrl+C' ], Label: 'Copy the open item\'s export', When: 'not typing, no text selected', Act: copy },
		{ Keys: [ 'Ctrl+V' ], Label: 'Paste into the open project', When: 'not typing', Act: paste },
		{ Keys: [ 'Escape' ], Label: 'Close the menu or the popup; deselect the thread', When: '', Act: escape },
		{ Keys: [ 'Ctrl+Shift+E' ], Label: 'Show or hide the project tree', When: 'the main window', Act: toggle_tree },
		{ Keys: [ 'Ctrl+Shift+T', 'Ctrl+Shift+H' ], Label: 'Show or hide the threads', When: 'a plan open', Act: toggle_threads },
		{ Keys: [ 'Ctrl+Shift+C' ], Label: 'Comment on the whole document', When: 'a plan\'s Read view', Act: comment_on_whole },
		{ Keys: [ 'Ctrl+PgUp', 'Alt+PgUp' ], Label: 'Previous tab, wrapping to the last', When: 'outside the editor', Act: function () { return go_tab( 'previous' ); } },
		{ Keys: [ 'Ctrl+PgDn', 'Alt+PgDn' ], Label: 'Next tab, wrapping to the first', When: 'outside the editor', Act: function () { return go_tab( 'next' ); } },
		{ Keys: [ 'Ctrl+Home', 'Alt+Home' ], Label: 'First tab', When: 'outside the editor', Act: function () { return go_tab( 'first' ); } },
		{ Keys: [ 'Ctrl+End', 'Alt+End' ], Label: 'Last tab', When: 'outside the editor', Act: function () { return go_tab( 'last' ); } },
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
		if ( event.key === 'Escape' && ( Menus.Open || popup_open() ) )
		{
			return;
		}
		if ( popup_open() )
		{
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
		DesktopRows: DESKTOP_ROWS,
		Desktop: !!( $window.Desktop && typeof $window.Desktop.Servers === 'function' ),
		Provide: Provide,
		Display: Display,
	};
} ] );
