'use strict';

// The page in a real browser (test/support/Cdp.js drives the installed Chrome or Edge headless):
// the list loads, a selection becomes a thread, the llm's reply (over the API) arrives live, resolve, edit and
// save, the state picker, projects and the Context folder, tabs, subplans, the tree, the settings popup, the
// hotkeys and the Help popups (plan UI Tweaks VI).
// The server runs on port 0 over a temporary folder; the llm is played with its token over the API.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const FS = require( 'fs' );
const OS = require( 'os' );
const PATH = require( 'path' );
const SERVER = require( '../src/Server.js' );
const CDP = require( './support/Cdp.js' );
const PARTICIPANTS = require( '../src/Participants.js' );

const LLM_TOKEN = 'ui-llm-token-0123456789abcdef';

// The Edit view's editor: Monaco's list also holds the comment boxes (plan UI Components, Step 1).
const EDIT_EDITOR = 'monaco.editor.getEditors().find( function ( editor ) { return document.getElementById( "editor" ).contains( editor.getDomNode() ); } )';

const TEXT = '# Browser check\n\nThe first paragraph makes a claim about anchors.\n\n- one list item\n- another list item\n\nA closing paragraph.\n';

let running = null;
let home = null;		// the first project's id (a prj- id in a folder of its own since plan Run Shapes, Step 2)
let browser = null;
let page = null;
let plan = null;


function count_of( selector )
{
	return 'document.querySelectorAll( ' + JSON.stringify( selector ) + ' ).length';
}


// The threads pane starts at Waiting on me; tests that work with threads waiting on others show them all.
async function show_all_threads()
{
	await page.Evaluate( '( function () { let injector = angular.element( document.body ).injector(); injector.get( "State" ).Filter = "all"; injector.get( "$rootScope" ).$apply(); return true; } )()' );
}


// A row's actions menu: its ⋯ opens the popup menu, and the entry whose label starts with Label is picked.
async function menu_pick( row, label, opener )
{
	let button = 'document.querySelector( ' + JSON.stringify( row + ' ' + ( opener || '.row-menu' ) ) + ' )';
	await page.WaitFor( button + ' !== null', 20000 );
	await page.Evaluate( button + '.click(); true' );
	let entry = '[ ...document.querySelectorAll( "#popup-menu .menu-button" ) ].find( function ( entry ) { return entry.textContent.trim().startsWith( ' + JSON.stringify( label ) + ' ); } )';
	await page.WaitFor( '!!' + entry );
	await page.Evaluate( entry + '.click(); true' );
}


// The selected thread's reply draft, set the way a person's typing would leave it: the reply box is an editor
// (plan UI Components, Step 1), so the draft is written where it binds, State.Drafts.
function draft_of( text )
{
	return '( function () { let injector = angular.element( document.body ).injector(); let state = injector.get( "State" ); state.Drafts[ state.Selected ] = ' + JSON.stringify( text ) + '; injector.get( "$rootScope" ).$apply(); return true; } )()';
}


// The editor engine picked in the title bar's look popover (plan UI Components, Step 5): opened, set, closed.
async function set_editor( engine )
{
	await page.Click( '#look-button' );
	await page.WaitFor( count_of( '#look-popover #editor-select' ) + ' === 1' );
	await page.Evaluate( '( function () { let select = document.getElementById( "editor-select" ); select.value = ' + JSON.stringify( engine ) + '; select.dispatchEvent( new Event( "change" ) ); return true; } )()' );
	await page.Click( '#look-button' );
	await page.WaitFor( count_of( '#look-popover' ) + ' === 0' );
}


// The threads filter picked by its label, as a person picks it in the dropdown.
async function pick_filter( label )
{
	await page.Evaluate( '( function () { let select = document.getElementById( "thread-filter" ); select.selectedIndex = [ ...select.options ].findIndex( function ( option ) { return option.textContent.trim() === ' + JSON.stringify( label ) + '; } ); select.dispatchEvent( new Event( "change" ) ); return true; } )()' );
}


function text_of( selector )
{
	return '( document.querySelector( ' + JSON.stringify( selector ) + ' ) || { textContent: "" } ).textContent.trim()';
}


// A request as the owner (no token) or, with as_llm, as the llm participant.
async function api( method, path, body, as_llm )
{
	let headers = {};
	if ( body !== undefined )
	{
		headers[ 'Content-Type' ] = 'application/json';
	}
	if ( as_llm )
	{
		headers[ 'X-Consensus-Service' ] = 'llm';
	}
	let response = await fetch( running.Url + path, { method: method, headers: headers, body: ( body === undefined ) ? undefined : JSON.stringify( body ) } );
	return response.json();
}


TEST.before( async function ()
{
	let data = FS.mkdtempSync( PATH.join( OS.tmpdir(), 'consensus-ui-' ) );
	let settings = PARTICIPANTS.DefaultSettings( 0 );
	FS.writeFileSync( PATH.join( data, 'consensus.json' ), JSON.stringify( settings, null, '	' ) );
	running = await SERVER.Start( { Data: data, Port: 0 } );
	home = ( await running.Store.ListProjects() )[ 0 ].Id;
	plan = ( await api( 'POST', '/api/plans', { Title: 'Browser check', Text: TEXT } ) ).Plan;
	browser = await CDP.StartBrowser();
	page = await browser.OpenPage( running.Url + '/#/p/' + plan.Id );
	// the page's Copy and Paste go through the system clipboard: the headless browser is granted it for this origin
	await page.Send( 'Browser.grantPermissions', { origin: running.Url, permissions: [ 'clipboardReadWrite', 'clipboardSanitizedWrite' ] } );
	// the tests were written for Monaco, the default before plan Markdown Editor, Step 5; the CodeMirror tests switch on their own
	await page.WaitFor( count_of( '#look-button' ) + ' === 1', 30000 );
	await set_editor( 'monaco' );
} );


TEST.after( async function ()
{
	if ( browser )
	{
		await browser.Close();
	}
	if ( running )
	{
		await running.Close();
	}
} );


//---------------------------------------------------------------------

TEST( 'the list and the plan load, live; the Context folder comes first', async function ()
{
	await page.WaitFor( count_of( '.tree-item:not(.context-item)' ) + ' === 1', 20000 );
	ASSERT.equal( await page.Evaluate( text_of( '.tree-item:not(.context-item) .plan-title' ) ), 'Browser check' );
	await page.WaitFor( text_of( '#read-view h1' ) + ' === "Browser check"' );
	await page.WaitFor( 'document.querySelector( ".connection" ).classList.contains( "live" )' );
	ASSERT.equal( await page.Evaluate( text_of( '#state-line' ) ), 'no threads yet' );
	// the Context folder first, holding the Readme
	ASSERT.equal( await page.Evaluate( 'document.querySelector( ".project.open .project-body > .tree > .tree-node" ).querySelector( ".folder" ).classList.contains( "context-folder" )' ), true );
	ASSERT.equal( await page.Evaluate( text_of( '.project.open .context-folder .folder-name' ) ), 'Context' );
	ASSERT.equal( await page.Evaluate( count_of( '.project.open .context-folder .tree-item.context-item' ) ), 1 );
	ASSERT.equal( await page.Evaluate( text_of( '.project.open .context-item .plan-title' ) ), 'Readme' );
	ASSERT.deepEqual( page.Errors, [] );
} );


TEST( 'a selection becomes an anchored thread', async function ()
{
	// the owner's new thread waits on the LLM, so the pane shows every thread
	await show_all_threads();
	// Select the words "one list item" in the rendered text, as a person's drag would leave them.
	await page.Evaluate( '( function () { let li = document.querySelector( "#read-view li" ); let range = document.createRange(); range.selectNodeContents( li ); let selection = window.getSelection(); selection.removeAllRanges(); selection.addRange( range ); document.getElementById( "read-view" ).dispatchEvent( new MouseEvent( "mouseup", { bubbles: true } ) ); return true; } )()' );
	await page.WaitFor( 'document.getElementById( "comment-button" ).classList.contains( "shown" )' );
	await page.Click( '#comment-button' );
	await page.WaitFor( 'document.activeElement && document.activeElement.closest( "#compose-text" ) !== null' );
	await page.Type( 'Is one item enough?' );
	await page.WaitFor( '!document.getElementById( "compose-post" ).disabled' );
	await page.Click( '#compose-post' );
	await page.WaitFor( count_of( '.thread:not(.compose)' ) + ' === 1' );
	// the card's parts arrive with their templates (plan UI Components, Step 1), so they are waited for
	await page.WaitFor( text_of( '.thread:not(.compose) .thread-anchor' ) + ' === "“one list item”"' );
	await page.WaitFor( text_of( '.thread:not(.compose) .state-badge' ) + ' === "contested"' );
	await page.WaitFor( count_of( '#read-view mark.anchor' ) + ' === 1' );
	ASSERT.equal( await page.Evaluate( text_of( '#read-view mark.anchor' ) ), 'one list item' );
	ASSERT.equal( await page.Evaluate( text_of( '#state-line' ) ), '1 contested' );
} );


TEST( 'the llm replies over the API, and the reply arrives live', async function ()
{
	let threads = ( await api( 'GET', '/api/plans/' + plan.Id + '/threads' ) ).Threads;
	await api( 'POST', '/api/plans/' + plan.Id + '/threads/' + threads[ 0 ].Id + '/replies', { Text: 'Outcome: one item stays.' }, true );
	await page.WaitFor( count_of( '.thread:not(.compose) .reply' ) + ' === 2' );
	ASSERT.equal( await page.Evaluate( 'Array.from( document.querySelectorAll( ".thread:not(.compose) .reply-text" ) ).pop().textContent.trim()' ), 'Outcome: one item stays.' );
	await page.WaitFor( text_of( '#state-line' ) + ' === "waiting on you 1 · 1 contested"' );
	await page.WaitFor( text_of( '#waiting-link' ) + ' === "Waiting on you: 1"' );
	ASSERT.deepEqual( page.Errors, [] );
} );


TEST( 'the owner resolves from the page; the selection moves on; Reply and Contest on the resolved thread; a blank click or Escape deselects', async function ()
{
	await show_all_threads();
	await page.WaitFor( count_of( '.thread:not(.compose)' ) + ' === 1' );
	await page.Click( '.thread:not(.compose)' );
	await page.WaitFor( count_of( '.thread.selected .resolve-button' ) + ' === 1' );
	ASSERT.equal( await page.Evaluate( text_of( '.thread.selected .reply-button' ) ), 'Reply' );
	await page.Click( '.thread.selected .resolve-button' );
	await page.WaitFor( text_of( '.thread:not(.compose) .state-badge' ) + ' === "resolved"' );
	// resolved, the thread is off the owner's list: it waits on the llm to apply it
	await page.WaitFor( text_of( '#state-line' ) + ' === "1 resolved"' );
	// after the owner's own resolve the selection passes on: with no other thread, to none (plan UI Tweaks VI)
	await page.WaitFor( count_of( '.thread.selected' ) + ' === 0' );
	// on the resolved thread, Reply reads Reply and Contest, in the contested colour
	await page.Click( '.thread:not(.compose)' );
	await page.WaitFor( count_of( '.thread.selected .reply-button.contest' ) + ' === 1' );
	ASSERT.equal( await page.Evaluate( text_of( '.thread.selected .reply-button' ) ), 'Reply and Contest' );
	// a click in the text off any highlight deselects; so does Escape
	await page.Click( '#read-view h1' );
	await page.WaitFor( count_of( '.thread.selected' ) + ' === 0' );
	await page.Click( '.thread:not(.compose)' );
	await page.WaitFor( count_of( '.thread.selected' ) + ' === 1' );
	await page.Press( 'Escape' );
	await page.WaitFor( count_of( '.thread.selected' ) + ' === 0' );
	ASSERT.deepEqual( page.Errors, [] );
} );


TEST( 'edit and save make a revision and keep the highlight; the editor stays, the toast says so', async function ()
{
	await page.Click( '#view-edit' );
	await page.WaitFor( 'window.monaco && !!' + EDIT_EDITOR, 30000 );
	await page.Evaluate( EDIT_EDITOR + '.setValue( ' + JSON.stringify( TEXT.replace( 'A closing paragraph.', 'A closing paragraph, edited in the browser.' ) ) + ' )' );
	await page.WaitFor( '!document.getElementById( "save-button" ).disabled' );
	await page.WaitFor( '/edited in the browser/.test( ' + text_of( '#edit-preview' ) + ' )' );
	await page.Click( '#save-button' );
	await page.WaitFor( text_of( '#revision' ) + ' === "revision 2"' );
	// saved, and still editing, now revision 2 (plan UI Tweaks VI)
	await page.WaitFor( 'document.getElementById( "toast" ).classList.contains( "shown" ) && ' + text_of( '#toast' ) + ' === "Saved, revision 2"' );
	ASSERT.equal( await page.Evaluate( 'document.getElementById( "view-edit" ).classList.contains( "btn-secondary" )' ), true );
	ASSERT.equal( await page.Evaluate( 'document.getElementById( "save-button" ).disabled' ), true );
	ASSERT.match( await page.Evaluate( text_of( '.edit-bar .muted' ) ), /^Editing revision 2\./ );
	await page.Click( '#view-read' );
	await page.WaitFor( 'document.getElementById( "view-read" ).classList.contains( "btn-secondary" )' );
	await page.WaitFor( text_of( '#read-view p:last-child' ) + ' === "A closing paragraph, edited in the browser."' );
	ASSERT.equal( await page.Evaluate( count_of( '#read-view mark.anchor' ) ), 1 );
} );


TEST( 'once the llm applies, the state picker makes the plan Working and the sidebar follows', async function ()
{
	let threads = ( await api( 'GET', '/api/plans/' + plan.Id + '/threads' ) ).Threads;
	await api( 'POST', '/api/plans/' + plan.Id + '/threads/' + threads[ 0 ].Id + '/apply', { Outcome: 'one item stays' }, true );
	await page.WaitFor( text_of( '#state-line' ) + ' === "1 applied"' );
	ASSERT.equal( await page.Evaluate( 'document.getElementById( "state-picker" ).selectedOptions[ 0 ].label' ), 'Draft' );
	await page.Evaluate( '( function () { let picker = document.getElementById( "state-picker" ); let option = Array.from( picker.options ).find( function ( candidate ) { return candidate.label === "Working"; } ); picker.value = option.value; picker.dispatchEvent( new Event( "change" ) ); return true; } )()' );
	await page.WaitFor( text_of( '.tree-item[data-id="' + plan.Id + '"] .item-state' ) + ' === "Working"' );
	ASSERT.equal( await page.Evaluate( 'document.getElementById( "state-picker" ).selectedOptions[ 0 ].label' ), 'Working' );
	ASSERT.deepEqual( page.Errors, [] );
} );


TEST( 'a new project opens and closes the others; a folder and a plan are made in it; a document goes in the Context folder', async function ()
{
	await page.WaitFor( count_of( '.project.open[data-project="' + home + '"]' ) + ' === 1' );
	// New Project is in the server row's menu (plan UI Tweaks VI)
	await menu_pick( '.root-head', 'New Project' );
	await page.WaitFor( 'document.activeElement && document.activeElement.id === "create-name"' );
	await page.Type( 'Browser project' );
	await page.Click( '#create-submit' );
	await page.WaitFor( count_of( '.project' ) + ' === 2' );
	await page.WaitFor( count_of( '.project.open' ) + ' === 1' );
	ASSERT.equal( await page.Evaluate( text_of( '.project.open .project-name' ) ), 'Browser project' );
	ASSERT.equal( await page.Evaluate( count_of( '.project[data-project="' + home + '"] .tree-item' ) ), 0 );
	await page.WaitFor( count_of( '.project.open .context-folder .context-item' ) + ' === 1' );
	// a folder, and a plan made from the folder's own menu
	await menu_pick( '.project.open > .project-head', 'New Folder' );
	await page.WaitFor( 'document.activeElement && document.activeElement.id === "create-name"' );
	await page.Type( 'Specs' );
	await page.Click( '#create-submit' );
	await page.WaitFor( count_of( '.project.open .folder:not(.context-folder)' ) + ' === 1' );
	await menu_pick( '.project.open .folder:not(.context-folder) .folder-head', 'New Draft' );
	await page.WaitFor( 'document.activeElement && document.activeElement.id === "create-name"' );
	await page.Type( 'Plan in a folder' );
	await page.Click( '#create-submit' );
	await page.WaitFor( count_of( '.project.open .folder:not(.context-folder) .tree-item' ) + ' === 1' );
	await page.WaitFor( text_of( '#read-view h1' ) + ' === "Plan in a folder"' );
	ASSERT.equal( await page.Evaluate( text_of( '.project.open .folder:not(.context-folder) .tree-item .plan-title' ) ), 'Plan in a folder' );
	// a document goes in the Context folder, from that folder's own menu: no threads pane, no state picker
	await menu_pick( '.project.open .context-folder .folder-head', 'New Document' );
	await page.WaitFor( 'document.activeElement && document.activeElement.id === "create-name"' );
	ASSERT.equal( await page.Evaluate( 'document.getElementById( "create-name" ).placeholder' ), 'Document title in Context' );
	await page.Type( 'Reference notes' );
	await page.Click( '#create-submit' );
	await page.WaitFor( text_of( '#read-view h1' ) + ' === "Reference notes"' );
	await page.WaitFor( 'document.querySelector( ".layout" ).classList.contains( "no-threads" )' );
	ASSERT.equal( await page.Evaluate( 'getComputedStyle( document.querySelector( "aside.threads" ) ).display' ), 'none' );
	ASSERT.equal( await page.Evaluate( 'getComputedStyle( document.getElementById( "state-picker" ) ).display' ), 'none' );
	ASSERT.equal( await page.Evaluate( text_of( '#document-badge' ) ), 'Document' );
	await page.WaitFor( count_of( '.project.open .context-folder .tree-item.document:not(.context-item)' ) + ' === 1' );
	ASSERT.equal( await page.Evaluate( text_of( '.project.open .context-folder .tree-item.document:not(.context-item) .item-state' ) ), 'document' );
	ASSERT.equal( await page.Evaluate( count_of( '.project.open .folder:not(.context-folder) .tree-item.document' ) ), 0 );
	// opening Default again closes the new project
	await page.Click( '.project[data-project="' + home + '"] .project-head' );
	await page.WaitFor( count_of( '.project.open[data-project="' + home + '"]' ) + ' === 1' );
	ASSERT.equal( await page.Evaluate( count_of( '.project.open' ) ), 1 );
	ASSERT.deepEqual( page.Errors, [] );
} );


TEST( 'an item dragged onto a project moves there; copy and paste makes a whole copy', async function ()
{
	// open the new project again, then drag the plan out of its folder onto the project's head: it moves to the root
	await page.Click( '.project:not([data-project="' + home + '"]) .project-head' );
	await page.WaitFor( count_of( '.project.open .folder:not(.context-folder) .tree-item' ) + ' === 1' );
	let moved = await page.Evaluate( '( function () {'
		+ ' let data = new DataTransfer();'
		+ ' let item = document.querySelector( ".project.open .folder:not(.context-folder) .tree-item" );'
		+ ' let head = document.querySelector( ".project.open .project-head" );'
		+ ' item.dispatchEvent( new DragEvent( "dragstart", { bubbles: true, dataTransfer: data } ) );'
		+ ' head.dispatchEvent( new DragEvent( "dragover", { bubbles: true, cancelable: true, dataTransfer: data } ) );'
		+ ' head.dispatchEvent( new DragEvent( "drop", { bubbles: true, cancelable: true, dataTransfer: data } ) );'
		+ ' return data.getData( "application/x-consensus-item" ); } )()' );
	ASSERT.match( moved, /^pln-[0-9a-z]{3}-[0-9a-z]{3}-[0-9a-z]{3}$/ );
	await page.WaitFor( count_of( '.project.open .project-body > .tree > .tree-node > .tree-item' ) + ' === 1' );
	ASSERT.equal( await page.Evaluate( count_of( '.project.open .folder:not(.context-folder) .tree-item' ) ), 0 );
	// the Readme cannot be dragged
	ASSERT.equal( await page.Evaluate( '!!document.querySelector( ".project.open .context-item" ).getAttribute( "draggable" )' ), false );
	ASSERT.equal( await page.Evaluate( '!!document.querySelector( ".project.open .context-folder .folder-head" ).getAttribute( "draggable" )' ), false );

	// copy the plan at the root, paste at the project's root
	await menu_pick( '.project.open .project-body > .tree > .tree-node > .tree-item', 'Copy' );
	await page.WaitFor( text_of( '#clipboard' ) + '.startsWith( "copied: Plan in a folder" )' );
	await menu_pick( '.project.open > .project-head', 'Paste' );
	await page.WaitFor( count_of( '.project.open .tree-item:not(.context-item)' ) + ' === 3' );
	// the copy keeps the title, with new ids
	await page.WaitFor( '[ ...document.querySelectorAll( ".project.open .plan-title" ) ].filter( function ( title ) { return title.textContent.trim() === "Plan in a folder"; } ).length === 2' );
	ASSERT.deepEqual( page.Errors, [] );
} );


TEST( 'the theme and the scale switch', async function ()
{
	await page.Evaluate( 'window.ConsensusTheme.SetTheme( "dark" )' );
	ASSERT.equal( await page.Evaluate( 'document.documentElement.dataset.bsTheme' ), 'dark' );
	await page.Evaluate( 'window.ConsensusTheme.SetScale( "large" )' );
	ASSERT.equal( await page.Evaluate( 'document.documentElement.style.getPropertyValue( "--scale" )' ), '1.15' );
	await page.Evaluate( 'window.ConsensusTheme.SetTheme( "light" ); window.ConsensusTheme.SetScale( "normal" ); true' );
	ASSERT.deepEqual( page.Errors, [] );
} );


TEST( 'the threads and the preview hide and are remembered; a plan is renamed in its tree row', async function ()
{
	await page.Evaluate( 'window.location.hash = "#/p/' + plan.Id + '"; true' );
	await page.WaitFor( text_of( '#read-view h1' ) + ' === "Browser check"' );
	// the threads toggle hides the pane, and a reload keeps it hidden
	await page.Click( '#threads-toggle' );
	await page.WaitFor( 'document.querySelector( ".layout" ).classList.contains( "no-threads" )' );
	await page.Evaluate( 'window.location.reload(); true' );
	await page.WaitFor( text_of( '#read-view h1' ) + ' === "Browser check"', 20000 );
	ASSERT.equal( await page.Evaluate( 'document.querySelector( ".layout" ).classList.contains( "no-threads" )' ), true );
	await page.Click( '#threads-toggle' );
	await page.WaitFor( '!document.querySelector( ".layout" ).classList.contains( "no-threads" )' );
	// the preview toggle gives the editor the whole width
	await page.Click( '#view-edit' );
	await page.WaitFor( 'window.monaco && !!' + EDIT_EDITOR, 30000 );
	await page.Click( '#preview-toggle' );
	await page.WaitFor( 'getComputedStyle( document.querySelector( ".edit-preview" ) ).display === "none"' );
	ASSERT.equal( await page.Evaluate( 'window.localStorage.getItem( "consensus.preview-hidden" )' ), 'true' );
	await page.Click( '#preview-toggle' );
	await page.WaitFor( 'getComputedStyle( document.querySelector( ".edit-preview" ) ).display !== "none"' );
	await page.Click( '#view-read' );
	// rename from the tree row: only the Title changes
	await menu_pick( '.tree-item[data-id="' + plan.Id + '"]', 'Rename' );
	await page.WaitFor( 'document.activeElement && document.activeElement.closest( ".rename-form" ) !== null' );
	await page.Evaluate( '( function () { let input = document.activeElement; input.value = "Browser check, renamed"; input.dispatchEvent( new Event( "input" ) ); input.form.dispatchEvent( new Event( "submit", { cancelable: true } ) ); return true; } )()' );
	await page.WaitFor( text_of( '.tree-item[data-id="' + plan.Id + '"] .plan-title' ) + ' === "Browser check, renamed"' );
	await page.WaitFor( text_of( '.header .title' ) + ' === "Browser check, renamed"' );
	ASSERT.deepEqual( page.Errors, [] );
} );


TEST( 'reply and resolve: Resolve with a reply typed posts it as the outcome and resolves the thread (plan UI Tweaks IX: the one Resolve button)', async function ()
{
	// the only thread is applied; a reply reopens it, and Resolve with a draft settles it again
	await show_all_threads();
	await page.WaitFor( count_of( '.thread:not(.compose)' ) + ' === 1' );
	await page.Click( '.thread:not(.compose)' );
	await page.WaitFor( count_of( '.thread.selected .reply-box' ) + ' === 1' );
	ASSERT.equal( await page.Evaluate( text_of( '.thread.selected .reply-button' ) ), 'Reply and Contest' );
	await page.Evaluate( draft_of( 'Reopened to ask again.' ) );
	await page.Click( '.thread.selected .reply-button' );
	await page.WaitFor( text_of( '.thread:not(.compose) .state-badge' ) + ' === "reopened"' );
	// the reply moved the selection on (to none: the only thread); picked again, Reply reads plainly, and Resolve shows; there is one Resolve
	await page.WaitFor( count_of( '.thread.selected' ) + ' === 0' );
	await page.Click( '.thread:not(.compose)' );
	await page.WaitFor( text_of( '.thread.selected .reply-button' ) + ' === "Reply"' );
	await page.WaitFor( 'getComputedStyle( document.querySelector( ".thread.selected .resolve-button" ) ).display !== "none"' );
	ASSERT.equal( await page.Evaluate( count_of( '.thread.selected .reply-resolve-button' ) ), 0 );
	// the posted draft is cleared a moment after the reply lands, so the button's title is waited for, not read at once
	await page.WaitFor( 'document.querySelector( ".thread.selected .resolve-button" ).title === "accept the outcome or recommendation in the last reply"' );
	await page.Evaluate( draft_of( 'Keep one item.' ) );
	await page.WaitFor( 'document.querySelector( ".thread.selected .resolve-button" ).title === "post your reply as the outcome and resolve the thread"' );
	await page.Click( '.thread.selected .resolve-button' );
	await page.WaitFor( text_of( '.thread:not(.compose) .state-badge' ) + ' === "resolved"' );
	await page.WaitFor( 'Array.from( document.querySelectorAll( ".thread:not(.compose) .reply-text" ) ).pop().textContent.trim() === "Keep one item."' );
	ASSERT.deepEqual( page.Errors, [] );
} );


TEST( 'the owner deletes a thread; the revision it made names it as deleted', async function ()
{
	await show_all_threads();
	await page.WaitFor( count_of( '.thread:not(.compose)' ) + ' === 1' );
	await page.Evaluate( 'document.querySelector( ".thread:not(.compose) .delete-thread" ).click(); true' );
	await page.WaitFor( 'getComputedStyle( document.querySelector( ".thread:not(.compose) .thread-delete .confirm" ) ).display !== "none"' );
	await page.Evaluate( 'document.querySelector( ".thread:not(.compose) .confirm-delete-thread" ).click(); true' );
	await page.WaitFor( count_of( '.thread:not(.compose)' ) + ' === 0' );
	await page.WaitFor( text_of( '#state-line' ) + ' === "no threads yet"' );
	await page.Click( '#view-revisions' );
	await page.WaitFor( count_of( '.revision-thread.deleted' ) + ' >= 1' );
	ASSERT.equal( await page.Evaluate( text_of( '.revision-thread.deleted' ) ), '(deleted thread)' );
	ASSERT.deepEqual( page.Errors, [] );
} );


// Drags Source onto the top edge of Target, as a person's drag would.
function drag_to_top( source, target )
{
	return '( function () {'
		+ ' let data = new DataTransfer();'
		+ ' let source = document.querySelector( ' + JSON.stringify( source ) + ' );'
		+ ' let target = document.querySelector( ' + JSON.stringify( target ) + ' );'
		+ ' let y = target.getBoundingClientRect().top + 1;'
		+ ' source.dispatchEvent( new DragEvent( "dragstart", { bubbles: true, dataTransfer: data } ) );'
		+ ' target.dispatchEvent( new DragEvent( "dragover", { bubbles: true, cancelable: true, dataTransfer: data, clientY: y } ) );'
		+ ' let shown = target.classList.contains( "drop-before" );'
		+ ' target.dispatchEvent( new DragEvent( "drop", { bubbles: true, cancelable: true, dataTransfer: data, clientY: y } ) );'
		+ ' return shown; } )()';
}


TEST( 'an item dropped on the top edge of another goes just before it; the Context folder stays first; a project dropped on another\'s head goes before it', async function ()
{
	await page.Click( '.project:not([data-project="' + home + '"]) .project-head' );
	await page.WaitFor( count_of( '.project.open .tree-item:not(.context-item)' ) + ' === 3' );
	function root_titles()
	{
		return '[ ...document.querySelectorAll( ".project.open .project-body > .tree > .tree-node" ) ].map( function ( node ) { let title = node.querySelector( ".plan-title, .folder-name" ); return title ? title.textContent.trim() : ""; } ).join( "|" )';
	}
	ASSERT.equal( ( await page.Evaluate( root_titles() ) ).split( '|' )[ 0 ], 'Context' );
	ASSERT.equal( ( await page.Evaluate( root_titles() ) ).split( '|' )[ 1 ], 'Specs' );
	// the copy, last at the root, dropped on the top edge of the Specs folder: just before it
	const COPY = '[ ...document.querySelectorAll( ".project.open .project-body > .tree > .tree-node > .tree-item" ) ].filter( function ( item ) { return item.textContent.includes( "Plan in a folder" ); } ).pop()';
	ASSERT.equal( await page.Evaluate( '( function () { let data = new DataTransfer(); let source = ' + COPY + '; let target = document.querySelector( ".project.open .folder:not(.context-folder) .folder-head" ); let y = target.getBoundingClientRect().top + 1; source.dispatchEvent( new DragEvent( "dragstart", { bubbles: true, dataTransfer: data } ) ); target.dispatchEvent( new DragEvent( "dragover", { bubbles: true, cancelable: true, dataTransfer: data, clientY: y } ) ); let shown = target.classList.contains( "drop-before" ); target.dispatchEvent( new DragEvent( "drop", { bubbles: true, cancelable: true, dataTransfer: data, clientY: y } ) ); return shown; } )()' ), true );
	await page.WaitFor( root_titles() + '.split( "|" )[ 1 ] === "Plan in a folder"' );
	// dropped on the top edge of the Context folder: it lands after the folder, which stays first
	ASSERT.equal( await page.Evaluate( '( function () { let data = new DataTransfer(); let source = document.querySelector( ".project.open .folder:not(.context-folder) .folder-head" ); let target = document.querySelector( ".project.open .context-folder .folder-head" ); let y = target.getBoundingClientRect().top + 1; source.dispatchEvent( new DragEvent( "dragstart", { bubbles: true, dataTransfer: data } ) ); target.dispatchEvent( new DragEvent( "dragover", { bubbles: true, cancelable: true, dataTransfer: data, clientY: y } ) ); let shown = target.classList.contains( "drop-before" ); target.dispatchEvent( new DragEvent( "drop", { bubbles: true, cancelable: true, dataTransfer: data, clientY: y } ) ); return shown; } )()' ), true );
	await page.WaitFor( root_titles() + '.split( "|" )[ 1 ] === "Specs"' );
	ASSERT.equal( ( await page.Evaluate( root_titles() ) ).split( '|' )[ 0 ], 'Context' );
	// the project first, before Default
	ASSERT.equal( await page.Evaluate( '[ ...document.querySelectorAll( ".project" ) ].map( function ( project ) { return project.dataset.project; } )[ 0 ]' ), ( await api( 'GET', '/api/projects' ) ).Projects[ 0 ].Id );
	ASSERT.equal( await page.Evaluate( drag_to_top( '.project:not([data-project="' + home + '"]) .project-head', '.project[data-project="' + home + '"] .project-head' ) ), true );
	await page.WaitFor( 'document.querySelector( ".project" ).dataset.project !== "' + home + '"' );
	ASSERT.deepEqual( page.Errors, [] );
} );


TEST( 'the Context folder and its Readme: opened, kept as they are, with their own menus', async function ()
{
	await page.WaitFor( count_of( '.project.open .context-item' ) + ' === 1' );
	ASSERT.equal( await page.Evaluate( text_of( '.project.open .context-item .item-state' ) ), 'empty' );
	ASSERT.equal( await page.Evaluate( count_of( '.project.open .context-item .row-menu' ) ), 0 );
	await page.Click( '.project.open .context-item' );
	await page.WaitFor( text_of( '.header .title' ) + ' === "Readme of Browser project"' );
	await page.WaitFor( 'document.querySelector( ".layout" ).classList.contains( "no-threads" )' );
	ASSERT.equal( await page.Evaluate( text_of( '#document-badge' ) ), 'Readme' );
	ASSERT.equal( await page.Evaluate( 'getComputedStyle( document.getElementById( "state-picker" ) ).display' ), 'none' );
	ASSERT.equal( await page.Evaluate( count_of( '.tab.active .icon-context' ) ), 1 );
	ASSERT.match( await page.Evaluate( text_of( '.tab.active .tab-title' ) ), /^Readme · Browser project$/ );
	// a right-click on the Readme opens nothing; on the Context folder, New Document and Paste only
	await page.Evaluate( 'document.querySelector( ".project.open .context-item" ).dispatchEvent( new MouseEvent( "contextmenu", { bubbles: true, cancelable: true, clientX: 60, clientY: 120 } ) ); true' );
	await new Promise( function ( resolve ) { setTimeout( resolve, 200 ); } );
	ASSERT.equal( await page.Evaluate( 'getComputedStyle( document.getElementById( "popup-menu" ) ).display' ), 'none' );
	await page.Evaluate( 'document.querySelector( ".project.open .context-folder .folder-head" ).dispatchEvent( new MouseEvent( "contextmenu", { bubbles: true, cancelable: true, clientX: 60, clientY: 100 } ) ); true' );
	await page.WaitFor( 'getComputedStyle( document.getElementById( "popup-menu" ) ).display !== "none"' );
	ASSERT.deepEqual( await page.Evaluate( '[ ...document.querySelectorAll( "#popup-menu .menu-button" ) ].map( function ( entry ) { return entry.textContent.trim(); } )' ), [ 'New Document', 'Paste' ] );
	await page.Press( 'Escape' );
	// text written into it clears the empty badge
	let context = await api( 'GET', '/api/plans/' + ( await page.Evaluate( 'window.location.hash.slice( 4 )' ) ) );
	await api( 'PUT', '/api/plans/' + context.Plan.Id + '/text', { Text: '# Browser project\n\nWhat it is.\n', Revision: context.Plan.Revision } );
	await page.WaitFor( text_of( '#read-view p' ) + ' === "What it is."' );
	await page.WaitFor( 'getComputedStyle( document.querySelector( ".project.open .context-item .item-state" ) ).display === "none"' );
	ASSERT.deepEqual( page.Errors, [] );
} );


//---------------------------------------------------------------------
// Tabs

let tab_one = null;
let tab_two = null;


async function created( title )
{
	return ( await api( 'POST', '/api/plans', { Title: title, Text: '# ' + title + '\n\nA line.\n' } ) ).Plan;
}


function tab_selector( id )
{
	return '.tab[data-key="p:' + id + '"]';
}


function tab_keys()
{
	return '[ ...document.querySelectorAll( ".tab" ) ].map( function ( tab ) { return tab.dataset.key; } )';
}


TEST( 'tabs: one per item; each keeps its view and an unsaved edit; tabs reorder and close', async function ()
{
	tab_one = await created( 'Tab one' );
	tab_two = await created( 'Tab two' );
	await page.Evaluate( 'window.location.hash = "#/p/' + tab_one.Id + '"; true' );
	await page.WaitFor( text_of( '.header .title' ) + ' === "Tab one"' );
	await page.Evaluate( 'window.location.hash = "#/p/' + tab_two.Id + '"; true' );
	await page.WaitFor( text_of( '.header .title' ) + ' === "Tab two"' );
	let count = await page.Evaluate( count_of( '.tab' ) );
	await page.Evaluate( 'window.location.hash = "#/p/' + tab_one.Id + '"; true' );
	await page.WaitFor( text_of( '.header .title' ) + ' === "Tab one"' );
	ASSERT.equal( await page.Evaluate( count_of( '.tab' ) ), count );
	ASSERT.equal( await page.Evaluate( 'document.querySelector( "' + tab_selector( tab_one.Id ).replace( /"/g, '\\"' ) + '" ).classList.contains( "active" )' ), true );

	// an edit in Tab one, unsaved; Tab two shows its own view; back in Tab one, the edit is still there
	await page.Click( '#view-edit' );
	// the editor from an earlier test is reused: wait until it holds this plan's text
	await page.WaitFor( 'window.monaco && !!' + EDIT_EDITOR + ' && ' + EDIT_EDITOR + '.getValue() === "# Tab one\\n\\nA line.\\n"', 30000 );
	await page.Evaluate( EDIT_EDITOR + '.setValue( "# Tab one\\n\\nA line, not saved yet.\\n" ); true' );
	await page.WaitFor( '!document.getElementById( "save-button" ).disabled' );
	await new Promise( function ( resolve ) { setTimeout( resolve, 400 ); } );
	await page.Click( tab_selector( tab_two.Id ) );
	await page.WaitFor( text_of( '.header .title' ) + ' === "Tab two"' );
	await page.WaitFor( 'document.getElementById( "view-read" ).classList.contains( "btn-secondary" )' );
	await page.Click( tab_selector( tab_one.Id ) );
	await page.WaitFor( 'document.getElementById( "view-edit" ).classList.contains( "btn-secondary" )' );
	await page.WaitFor( EDIT_EDITOR + '.getValue() === "# Tab one\\n\\nA line, not saved yet.\\n"' );
	await page.WaitFor( '!document.getElementById( "save-button" ).disabled' );
	await page.Evaluate( '[ ...document.querySelectorAll( ".edit-buttons .btn-outline-secondary" ) ].pop().click(); true' );
	await page.WaitFor( 'document.getElementById( "view-read" ).classList.contains( "btn-secondary" )' );

	// Tab two dragged onto the left half of Tab one goes just before it
	let moved = await page.Evaluate( '( function () {'
		+ ' let data = new DataTransfer();'
		+ ' let source = document.querySelector( ' + JSON.stringify( tab_selector( tab_two.Id ) ) + ' );'
		+ ' let target = document.querySelector( ' + JSON.stringify( tab_selector( tab_one.Id ) ) + ' );'
		+ ' let x = target.getBoundingClientRect().left + 2;'
		+ ' source.dispatchEvent( new DragEvent( "dragstart", { bubbles: true, dataTransfer: data } ) );'
		+ ' target.dispatchEvent( new DragEvent( "dragover", { bubbles: true, cancelable: true, dataTransfer: data, clientX: x } ) );'
		+ ' target.dispatchEvent( new DragEvent( "drop", { bubbles: true, cancelable: true, dataTransfer: data, clientX: x } ) );'
		+ ' return true; } )()' );
	ASSERT.equal( moved, true );
	await page.WaitFor( '( function () { let keys = ' + tab_keys() + '; return keys.indexOf( "p:' + tab_two.Id + '" ) === keys.indexOf( "p:' + tab_one.Id + '" ) - 1; } )()' );

	// closing the shown tab shows the one beside it
	await page.Evaluate( 'document.querySelector( ' + JSON.stringify( tab_selector( tab_one.Id ) + ' .close-tab' ) + ' ).click(); true' );
	await page.WaitFor( count_of( tab_selector( tab_one.Id ) ) + ' === 0' );
	await page.WaitFor( text_of( '.header .title' ) + ' !== "Tab one"' );
	ASSERT.deepEqual( page.Errors, [] );
} );


TEST( 'tabs: a tab detaches into its own window, stays ghosted in the strip, and is re-attached from either window', async function ()
{
	await page.Evaluate( 'window.location.hash = "#/p/' + tab_one.Id + '"; true' );
	await page.WaitFor( text_of( '.header .title' ) + ' === "Tab one"' );
	// the window the browser would open is recorded instead; the messages between windows are overheard
	await page.Evaluate( '( function () {'
		+ ' window.opened = []; window.open = function ( url ) { window.opened.push( url ); return {}; };'
		+ ' window.heard = []; let channel = new BroadcastChannel( "consensus-windows" ); channel.onmessage = function ( event ) { window.heard.push( event.data.Type ); };'
		+ ' return true; } )()' );
	await menu_pick( tab_selector( tab_one.Id ), 'Detach', '.tab-menu' );
	await page.WaitFor( count_of( tab_selector( tab_one.Id ) + '.out' ) + ' === 1' );
	ASSERT.equal( await page.Evaluate( 'window.opened[ 0 ]' ), '/?detached=1#/p/' + tab_one.Id );
	// the strip shows the tab beside it; the ghost does not open when clicked
	await page.WaitFor( text_of( '.header .title' ) + ' !== "Tab one"' );
	let shown = await page.Evaluate( text_of( '.header .title' ) );
	await page.Evaluate( 'document.querySelector( ' + JSON.stringify( tab_selector( tab_one.Id ) ) + ' ).click(); true' );
	ASSERT.equal( await page.Evaluate( text_of( '.header .title' ) ), shown );
	// opened again from the tree, the item stays out: its window is asked to come forward
	await page.Evaluate( 'window.location.hash = "#/p/' + tab_one.Id + '"; true' );
	await page.WaitFor( 'window.heard.includes( "focus" )' );
	await page.WaitFor( text_of( '.header .title' ) + ' === ' + JSON.stringify( shown ) );
	ASSERT.deepEqual( await page.Evaluate( '[ ...document.querySelectorAll( "#popup-menu .menu-button" ) ].length' ), 0 );

	// the detached window: the item alone, no sidebar, and Re-attach puts it back as a tab in the main window
	let detached = await browser.OpenPage( running.Url + '/?detached=1#/p/' + tab_one.Id );
	await detached.WaitFor( text_of( '.header .title' ) + ' === "Tab one"', 20000 );
	ASSERT.equal( await detached.Evaluate( 'getComputedStyle( document.querySelector( "aside.sidebar" ) ).display' ), 'none' );
	ASSERT.equal( await detached.Evaluate( 'getComputedStyle( document.querySelector( ".tabs-row" ) ).display' ), 'none' );
	// the bar's threads button hides and shows the threads there (plan UI Tweaks VI); the window keeps the choice to itself
	let remembered = await detached.Evaluate( 'window.localStorage.getItem( "consensus.threads-hidden" )' );
	await detached.Click( '#detached-threads' );
	await detached.WaitFor( 'document.querySelector( ".layout" ).classList.contains( "no-threads" )' );
	ASSERT.equal( await detached.Evaluate( 'window.localStorage.getItem( "consensus.threads-hidden" )' ), remembered );
	await detached.Click( '#detached-threads' );
	await detached.WaitFor( '!document.querySelector( ".layout" ).classList.contains( "no-threads" )' );
	await page.WaitFor( 'window.heard.includes( "here" )' );
	await detached.Click( '#reattach' );
	await page.WaitFor( count_of( tab_selector( tab_one.Id ) ) + ' === 1' );
	await page.WaitFor( text_of( '.header .title' ) + ' === "Tab one"' );
	await page.WaitFor( 'window.heard.includes( "attached" )' );
	ASSERT.equal( await page.Evaluate( count_of( tab_selector( tab_one.Id ) + '.out' ) ), 0 );
	detached.Close();

	// out again, and called back from the main window: the ghost's menu has Re-attach and Close
	await menu_pick( tab_selector( tab_one.Id ), 'Detach', '.tab-menu' );
	await page.WaitFor( count_of( tab_selector( tab_one.Id ) + '.out' ) + ' === 1' );
	let again = await browser.OpenPage( running.Url + '/?detached=1#/p/' + tab_one.Id );
	await again.WaitFor( text_of( '.header .title' ) + ' === "Tab one"', 20000 );
	await page.Evaluate( 'document.querySelector( ' + JSON.stringify( tab_selector( tab_one.Id ) + ' .tab-menu' ) + ' ).click(); true' );
	await page.WaitFor( count_of( '#popup-menu .menu-button' ) + ' === 2' );
	ASSERT.deepEqual( await page.Evaluate( '[ ...document.querySelectorAll( "#popup-menu .menu-button" ) ].map( function ( entry ) { return entry.textContent.trim(); } )' ), [ 'Re-attach', 'Close' ] );
	await page.Press( 'Escape' );
	await menu_pick( tab_selector( tab_one.Id ), 'Re-attach', '.tab-menu' );
	await page.WaitFor( 'window.heard.includes( "call-back" )' );
	await page.WaitFor( count_of( tab_selector( tab_one.Id ) + '.out' ) + ' === 0' );
	await page.WaitFor( text_of( '.header .title' ) + ' === "Tab one"' );
	ASSERT.deepEqual( page.Errors, [] );
	ASSERT.deepEqual( detached.Errors, [] );
	ASSERT.deepEqual( again.Errors, [] );
	again.Close();
} );


TEST( 'tabs: the tab menu closes others, those to the right, or all', async function ()
{
	let made = [];
	for ( let name of [ 'Menu one', 'Menu two', 'Menu three' ] )
	{
		let plan = await created( name );
		made.push( plan );
		await page.Evaluate( 'window.location.hash = "#/p/' + plan.Id + '"; true' );
		await page.WaitFor( text_of( '.header .title' ) + ' === ' + JSON.stringify( name ) );
	}
	// to the right of the first of them: the other two go
	await menu_pick( tab_selector( made[ 0 ].Id ), 'Close to the right', '.tab-menu' );
	await page.WaitFor( count_of( tab_selector( made[ 1 ].Id ) ) + ' + ' + count_of( tab_selector( made[ 2 ].Id ) ) + ' === 0' );
	ASSERT.equal( await page.Evaluate( count_of( tab_selector( made[ 0 ].Id ) ) ), 1 );
	// others: only it is left, and shown
	await menu_pick( tab_selector( made[ 0 ].Id ), 'Close others', '.tab-menu' );
	await page.WaitFor( count_of( '.tab' ) + ' === 1' );
	await page.WaitFor( text_of( '.header .title' ) + ' === "Menu one"' );
	// all: the start page
	await menu_pick( tab_selector( made[ 0 ].Id ), 'Close all', '.tab-menu' );
	await page.WaitFor( count_of( '.tab' ) + ' === 0' );
	ASSERT.deepEqual( page.Errors, [] );
} );


//---------------------------------------------------------------------

TEST( 'subplans: started from the header, selected text, a new thread and a reply; they fold under their parent', async function ()
{
	let parent = await created( 'Parent plan' );
	async function open_parent()
	{
		await page.Evaluate( 'window.location.hash = "#/p/' + parent.Id + '"; true' );
		await page.WaitFor( text_of( '#read-view h1' ) + ' === "Parent plan"', 20000 );
	}
	async function name_it( title )
	{
		await page.WaitFor( 'document.activeElement && document.activeElement.id === "subplan-title"' );
		await page.Type( title );
		await page.Click( '#subplan-create' );
		await page.WaitFor( text_of( '#read-view h1' ) + ' === ' + JSON.stringify( title ), 20000 );
	}
	function select_line()
	{
		return '( function () { let paragraph = document.querySelector( "#read-view p" ); let range = document.createRange(); range.selectNodeContents( paragraph ); let selection = window.getSelection(); selection.removeAllRanges(); selection.addRange( range ); document.getElementById( "read-view" ).dispatchEvent( new MouseEvent( "mouseup", { bubbles: true } ) ); return true; } )()';
	}
	async function threads_of( id )
	{
		return ( await api( 'GET', '/api/plans/' + id ) ).Threads;
	}

	// from the header's Actions menu (plan UI Tweaks IX): an empty Subplan, opened
	await open_parent();
	await menu_pick( '.header', 'New subplan', '#header-actions' );
	await name_it( 'From the header' );

	// from selected text: it starts with the passage; the parent is not changed
	await open_parent();
	await page.Evaluate( select_line() );
	await page.WaitFor( 'document.getElementById( "subplan-button" ).classList.contains( "shown" )' );
	await page.Click( '#subplan-button' );
	await name_it( 'From the selection' );
	ASSERT.equal( await page.Evaluate( text_of( '#read-view blockquote' ) ), 'A line.' );

	// from a new thread: the thread is posted with the comment and a link
	await open_parent();
	await page.Evaluate( select_line() );
	await page.WaitFor( 'document.getElementById( "comment-button" ).classList.contains( "shown" )' );
	await page.Click( '#comment-button' );
	await page.WaitFor( 'document.activeElement && document.activeElement.closest( "#compose-text" ) !== null' );
	await page.Type( 'This needs its own plan.' );
	await page.Click( '#compose-subplan' );
	await name_it( 'From a new thread' );
	let threads = await threads_of( parent.Id );
	ASSERT.equal( threads.length, 1 );
	ASSERT.match( threads[ 0 ].Replies[ 0 ].Text, /^This needs its own plan\.\n\nStarted a new Subplan: \[From a new thread\]\(#\/p\/pln-[0-9a-z]{3}-[0-9a-z]{3}-[0-9a-z]{3}\)$/ );

	// from a reply: the draft goes in with the link, and the thread stays open
	await open_parent();
	await show_all_threads();
	await page.Click( '.thread:not(.compose)' );
	await page.WaitFor( count_of( '.thread.selected .reply-box' ) + ' === 1' );
	await page.Evaluate( draft_of( 'Or split it further.' ) );
	await page.Click( '.thread.selected .subplan-from-thread' );
	await name_it( 'From a reply' );
	ASSERT.match( await page.Evaluate( text_of( '#read-view' ) ), /This needs its own plan\./ );
	threads = await threads_of( parent.Id );
	ASSERT.equal( threads[ 0 ].Status, 'contested' );
	ASSERT.match( threads[ 0 ].Replies[ 1 ].Text, /^Or split it further\.\n\nStarted a new Subplan: \[From a reply\]/ );

	// the tree: four Subplans under the parent, folded away by its chevron
	let under = '.tree-item[data-id="' + parent.Id + '"] + .subplans .tree-item';
	await page.WaitFor( count_of( under ) + ' === 4' );
	await page.Click( '.tree-item[data-id="' + parent.Id + '"] .chevron' );
	await page.WaitFor( count_of( under ) + ' === 0' );
	ASSERT.match( await page.Evaluate( 'window.location.hash' ), /#\/p\// );
	await page.Click( '.tree-item[data-id="' + parent.Id + '"] .chevron' );
	await page.WaitFor( count_of( under ) + ' === 4' );
	ASSERT.deepEqual( page.Errors, [] );
} );


//---------------------------------------------------------------------

TEST( 'the tree: it hides and shows; it sorts by name, created and updated; it shows each item\'s last update', async function ()
{
	async function sort_by( value )
	{
		await page.Evaluate( '( function () { let select = document.getElementById( "tree-sort" ); select.value = "' + value + '"; select.dispatchEvent( new Event( "change" ) ); return true; } )()' );
	}
	const TITLES = '[ ...document.querySelectorAll( ".project.open .tree-item:not(.context-item) .plan-title" ) ].map( function ( title ) { return title.textContent.trim(); } ).join( "," )';

	let project = ( await api( 'POST', '/api/projects', { Name: 'Sorting' } ) ).Project;
	let beta = ( await api( 'POST', '/api/plans', { Title: 'Beta', Text: '# Beta\n', Project: project.Id } ) ).Plan;
	await new Promise( function ( resolve ) { setTimeout( resolve, 20 ); } );
	let alpha = ( await api( 'POST', '/api/plans', { Title: 'Alpha', Text: '# Alpha\n', Project: project.Id } ) ).Plan;
	await new Promise( function ( resolve ) { setTimeout( resolve, 20 ); } );
	await api( 'POST', '/api/plans/' + beta.Id + '/threads', { Text: 'A question for the LLM.' } );

	await page.Evaluate( 'window.location.hash = "#/p/' + alpha.Id + '"; true' );
	await page.WaitFor( TITLES + ' === "Beta,Alpha"' );
	await sort_by( 'name' );
	await page.WaitFor( TITLES + ' === "Alpha,Beta"' );
	ASSERT.equal( await page.Evaluate( count_of( '.project.open .tree-item:not(.context-item) .tree-date' ) ), 0 );
	await sort_by( 'created' );
	await page.WaitFor( TITLES + ' === "Beta,Alpha"' );
	let dates = await page.Evaluate( '[ ...document.querySelectorAll( ".project.open .tree-item:not(.context-item) .tree-date" ) ].map( function ( date ) { return date.textContent.trim(); } )' );
	ASSERT.equal( dates.length, 2 );
	ASSERT.ok( dates.every( function ( date ) { return /^\d{4}-\d{2}-\d{2}$/.test( date ); } ) );
	await sort_by( 'updated' );
	await page.WaitFor( TITLES + ' === "Alpha,Beta"' );
	await sort_by( 'none' );
	await page.WaitFor( TITLES + ' === "Beta,Alpha"' );

	// the last update on each row, and on the project's heading
	ASSERT.equal( await page.Evaluate( count_of( '.project.open .tree-stamp' ) ), 0 );
	await page.Click( '#show-updated' );
	await page.WaitFor( count_of( '.project.open .tree-item:not(.context-item) .tree-stamp' ) + ' === 2' );
	ASSERT.equal( await page.Evaluate( count_of( '.project.open > .project-head .tree-stamp' ) ), 1 );
	await page.Click( '#show-updated' );
	await page.WaitFor( count_of( '.project.open .tree-stamp' ) + ' === 0' );

	// the tree hides and comes back, remembered
	await page.Click( '#tree-toggle' );
	await page.WaitFor( 'getComputedStyle( document.querySelector( ".sidebar" ) ).display === "none"' );
	ASSERT.equal( await page.Evaluate( 'window.localStorage.getItem( "consensus.tree-hidden" )' ), 'true' );
	await page.Click( '#tree-toggle' );
	await page.WaitFor( 'getComputedStyle( document.querySelector( ".sidebar" ) ).display !== "none"' );

	// the threads filter is global (plan UI Components, Step 1): the same in every tab, remembered in the browser
	const FILTER = 'document.getElementById( "thread-filter" ).selectedOptions[ 0 ].textContent.trim()';
	await pick_filter( 'Waiting on me' );
	await page.WaitFor( FILTER + ' === "Waiting on me"' );
	await page.Evaluate( 'window.location.hash = "#/p/' + beta.Id + '"; true' );
	await page.WaitFor( text_of( '.header .title' ) + ' === "Beta"' );
	ASSERT.equal( await page.Evaluate( FILTER ), 'Waiting on me' );
	ASSERT.equal( await page.Evaluate( count_of( '.thread:not(.compose)' ) ), 0 );
	await show_all_threads();
	await page.WaitFor( count_of( '.thread:not(.compose)' ) + ' === 1' );
	// a selected thread the filter leaves out stays listed until it is deselected
	await page.Click( '.thread:not(.compose)' );
	await page.WaitFor( count_of( '.thread.selected' ) + ' === 1' );
	await page.Evaluate( '( function () { let injector = angular.element( document.body ).injector(); injector.get( "State" ).Filter = "mine"; injector.get( "$rootScope" ).$apply(); return true; } )()' );
	await page.WaitFor( count_of( '.thread:not(.compose)' ) + ' === 1 && ' + count_of( '.thread.selected' ) + ' === 1' );
	await page.Evaluate( '( function () { let injector = angular.element( document.body ).injector(); injector.get( "State" ).Selected = null; injector.get( "$rootScope" ).$apply(); return true; } )()' );
	await page.WaitFor( count_of( '.thread:not(.compose)' ) + ' === 0' );
	await show_all_threads();
	await page.WaitFor( count_of( '.thread:not(.compose)' ) + ' === 1' );
	ASSERT.equal( await page.Evaluate( count_of( '.thread.selected' ) ), 0 );
	// the choice goes with you to another tab, and is remembered
	await pick_filter( 'Contested' );
	await page.WaitFor( FILTER + ' === "Contested"' );
	await page.Click( tab_selector( alpha.Id ) );
	await page.WaitFor( text_of( '.header .title' ) + ' === "Alpha"' );
	ASSERT.equal( await page.Evaluate( FILTER ), 'Contested' );
	ASSERT.equal( await page.Evaluate( 'window.localStorage.getItem( "consensus.filter" )' ), '"contested"' );
	await pick_filter( 'Waiting on me' );
	await page.WaitFor( FILTER + ' === "Waiting on me"' );
	await page.Click( tab_selector( beta.Id ) );
	await page.WaitFor( text_of( '.header .title' ) + ' === "Beta"' );
	ASSERT.equal( await page.Evaluate( FILTER ), 'Waiting on me' );
	ASSERT.deepEqual( page.Errors, [] );
} );


TEST( 'threads: New Comment with Comment and resolve; Re-anchor on a whole-document thread; highlight all or open', async function ()
{
	const MARKED = '[ ...document.querySelectorAll( "#read-view mark.anchor" ) ].map( function ( mark ) { return mark.dataset.threads; } ).join( " " )';

	let plan = await created( 'Highlights' );
	await api( 'PUT', '/api/plans/' + plan.Id + '/text', { Text: '# Highlights\n\nThe first passage.\n\nThe second passage.\n', Revision: plan.Revision } );
	let open_thread = ( await api( 'POST', '/api/plans/' + plan.Id + '/threads', { Text: 'Why first?', Anchor: { Text: 'first passage' } } ) ).Thread;
	let resolved_thread = ( await api( 'POST', '/api/plans/' + plan.Id + '/threads', { Text: 'Keep it.', Anchor: { Text: 'second passage' }, Resolve: true } ) ).Thread;
	ASSERT.equal( resolved_thread.Status, 'resolved' );

	await page.Evaluate( 'window.location.hash = "#/p/' + plan.Id + '"; true' );
	await page.WaitFor( MARKED + '.includes( "' + open_thread.Id + '" ) && ' + MARKED + '.includes( "' + resolved_thread.Id + '" )' );
	await page.Evaluate( '( function () { let select = document.getElementById( "thread-highlight" ); select.selectedIndex = 1; select.dispatchEvent( new Event( "change" ) ); return true; } )()' );
	await page.WaitFor( '!' + MARKED + '.includes( "' + resolved_thread.Id + '" )' );
	ASSERT.match( await page.Evaluate( MARKED ), new RegExp( open_thread.Id ) );
	ASSERT.equal( await page.Evaluate( 'window.localStorage.getItem( "consensus.highlight" )' ), '"open"' );
	await page.Evaluate( '( function () { let select = document.getElementById( "thread-highlight" ); select.selectedIndex = 0; select.dispatchEvent( new Event( "change" ) ); return true; } )()' );
	await page.WaitFor( MARKED + '.includes( "' + resolved_thread.Id + '" )' );

	// New Comment (in the header's Actions menu, plan UI Tweaks IX) starts a whole-document thread; Comment and resolve posts it resolved
	await show_all_threads();
	await menu_pick( '.header', 'New Comment', '#header-actions' );
	await page.WaitFor( 'document.activeElement && document.activeElement.closest( "#compose-text" ) !== null' );
	await page.Type( 'Add a summary at the top.' );
	await page.WaitFor( '!document.getElementById( "compose-resolve" ).disabled' );
	await page.Click( '#compose-resolve' );
	await page.WaitFor( count_of( '.thread.selected' ) + ' === 1' );
	let threads = ( await api( 'GET', '/api/plans/' + plan.Id + '/threads' ) ).Threads;
	let posted = threads.find( function ( thread ) { return thread.Replies[ 0 ].Text === 'Add a summary at the top.'; } );
	ASSERT.equal( posted.Status, 'resolved' );
	ASSERT.equal( posted.Anchor, null );
	// resolved: waiting on the llm speakers that apply it, never on the owner who resolved it
	ASSERT.equal( posted.Turn.includes( 'user' ), false );

	// a whole-document thread can be anchored afterwards
	await page.WaitFor( 'getComputedStyle( document.querySelector( ".thread.selected .reanchor-button" ) ).display !== "none"' );
	ASSERT.deepEqual( page.Errors, [] );
} );


TEST( 'tree menus: a right-click or the ⋯ opens a row\'s actions; Delete is there only, confirmed on the row; the open project has the filled icon', async function ()
{
	let doomed = await created( 'Doomed plan' );
	await page.Evaluate( 'window.location.hash = "#/p/' + doomed.Id + '"; true' );
	await page.WaitFor( text_of( '.header .title' ) + ' === "Doomed plan"' );
	const ROW = '.tree-item[data-id="' + doomed.Id + '"]';
	await page.WaitFor( count_of( ROW ) + ' === 1' );

	// no Delete in the heading; the open project's folder icon is filled, the others outlined (plan UI Tweaks VI); the server has its icon
	ASSERT.equal( await page.Evaluate( '[ ...document.querySelectorAll( ".header button" ) ].some( function ( button ) { return button.textContent.trim() === "Delete"; } )' ), false );
	ASSERT.equal( await page.Evaluate( count_of( '.project.open .icon-project.open' ) ), 1 );
	ASSERT.equal( await page.Evaluate( count_of( '.icon-project.open' ) ), 1 );
	ASSERT.equal( await page.Evaluate( count_of( '.icon-project' ) + ' - ' + count_of( '.project' ) ), 0 );
	ASSERT.equal( await page.Evaluate( count_of( '.root-head .icon-server' ) ), 1 );

	// a right-click opens the same menu; Escape closes it
	await page.Evaluate( 'document.querySelector( ' + JSON.stringify( ROW ) + ' ).dispatchEvent( new MouseEvent( "contextmenu", { bubbles: true, cancelable: true, clientX: 60, clientY: 200 } ) ); true' );
	await page.WaitFor( 'getComputedStyle( document.getElementById( "popup-menu" ) ).display !== "none"' );
	ASSERT.deepEqual( await page.Evaluate( '[ ...document.querySelectorAll( "#popup-menu .menu-button" ) ].map( function ( entry ) { return entry.textContent.trim(); } )' ), [ 'New Subplan', 'New Comment', 'Copy', 'Rename', 'Export', 'Report', 'Archive', 'Delete' ] );
	await page.Press( 'Escape' );
	await page.WaitFor( 'getComputedStyle( document.getElementById( "popup-menu" ) ).display === "none"' );

	// Delete from the menu asks on the row; Yes sends it to the trash and closes its tab
	await menu_pick( ROW, 'Delete' );
	await page.WaitFor( count_of( ROW + ' .confirm-delete-item' ) + ' === 1' );
	await page.Evaluate( 'document.querySelector( ' + JSON.stringify( ROW + ' .confirm-delete-item' ) + ' ).click(); true' );
	await page.WaitFor( count_of( ROW ) + ' === 0' );
	await page.WaitFor( count_of( tab_selector( doomed.Id ) ) + ' === 0' );
	ASSERT.equal( ( await fetch( running.Url + '/api/plans/' + doomed.Id ) ).status, 404 );
	// the Trash heading counts it; Empty Trash in the heading's menu asks under it, and Yes empties it
	await page.WaitFor( text_of( '.trash-heading .tally' ) + ' === "1"' );
	await menu_pick( '.trash-heading', 'Empty Trash' );
	await page.WaitFor( count_of( '.trash-confirm .confirm-empty-trash' ) + ' === 1' );
	await page.Click( '.trash-confirm .confirm-empty-trash' );
	await page.WaitFor( text_of( '.trash-heading .tally' ) + ' === "0" && ' + count_of( '.trash-confirm' ) + ' === 0' );
	ASSERT.deepEqual( ( await api( 'GET', '/api/trash' ) ).Plans, [] );
	ASSERT.deepEqual( page.Errors, [] );
} );


TEST( 'Ctrl+E: Read to Edit; from the editor it saves the edit and reads; with nothing to save it just reads', async function ()
{
	let plan = await created( 'Keyboard plan' );
	await page.Evaluate( 'window.location.hash = "#/p/' + plan.Id + '"; true' );
	await page.WaitFor( text_of( '.header .title' ) + ' === "Keyboard plan"' );
	await page.WaitFor( 'document.getElementById( "view-read" ).classList.contains( "btn-secondary" )' );
	await page.Click( '#read-view' );
	await page.Press( 'e', [ 'Control' ] );
	await page.WaitFor( 'document.getElementById( "view-edit" ).classList.contains( "btn-secondary" )' );
	const SAVED = JSON.stringify( '# Keyboard plan\n\nA line.\n' );
	const EDITED = JSON.stringify( '# Keyboard plan\n\nA line, saved by Ctrl+E.\n' );
	await page.WaitFor( 'window.monaco && !!' + EDIT_EDITOR + ' && ' + EDIT_EDITOR + '.getValue() === ' + SAVED, 30000 );
	await page.Evaluate( '( function () { let editor = ' + EDIT_EDITOR + '; editor.setValue( ' + EDITED + ' ); editor.focus(); return true; } )()' );
	// the edit is kept with the tab a moment after typing (stored.js: localStorage in a browser); Ctrl+E from inside the
	// editor saves it (plan UI Tweaks VI) and goes to Read, where the saved text shows
	await page.WaitFor( '( window.localStorage.getItem( "consensus.tabs" ) || "" ).includes( "saved by Ctrl+E" )' );
	await page.Press( 'e', [ 'Control' ] );
	await page.WaitFor( 'document.getElementById( "view-read" ).classList.contains( "btn-secondary" )' );
	await page.WaitFor( text_of( '#revision' ) + ' === "revision 2"' );
	await page.WaitFor( text_of( '#read-view p' ) + ' === "A line, saved by Ctrl+E."' );
	ASSERT.equal( await page.Evaluate( '( window.localStorage.getItem( "consensus.tabs" ) || "" ).includes( "saved by Ctrl+E" )' ), false );
	// back to Edit: the saved text, nothing dirty; Ctrl+E again just reads
	await page.Press( 'e', [ 'Control' ] );
	await page.WaitFor( 'document.getElementById( "view-edit" ).classList.contains( "btn-secondary" )' );
	await page.WaitFor( EDIT_EDITOR + '.getValue() === ' + EDITED );
	await page.WaitFor( 'document.getElementById( "save-button" ).disabled' );
	await page.Press( 'e', [ 'Control' ] );
	await page.WaitFor( 'document.getElementById( "view-read" ).classList.contains( "btn-secondary" )' );
	ASSERT.equal( await page.Evaluate( text_of( '#revision' ) ), 'revision 2' );
	ASSERT.deepEqual( page.Errors, [] );
} );


TEST( 'hotkeys: Ctrl+Shift+T hides the threads, Ctrl+Shift+E the tree, Ctrl+Shift+C comments on the whole document, and the Alt tab keys move along the strip', async function ()
{
	await page.Click( '#read-view' );
	await page.Press( 't', [ 'Control', 'Shift' ] );
	await page.WaitFor( 'document.querySelector( ".layout" ).classList.contains( "no-threads" )' );
	await page.Press( 'h', [ 'Control', 'Shift' ] );
	await page.WaitFor( '!document.querySelector( ".layout" ).classList.contains( "no-threads" )' );
	await page.Press( 'e', [ 'Control', 'Shift' ] );
	await page.WaitFor( 'document.querySelector( ".layout" ).classList.contains( "no-tree" )' );
	await page.Press( 'e', [ 'Control', 'Shift' ] );
	await page.WaitFor( '!document.querySelector( ".layout" ).classList.contains( "no-tree" )' );
	// Ctrl+Shift+C is the inspect-element key of a renderer with a debugger attached, as this one has, so the key event is
	// made on the page itself; the listener hears it on the window as it would a real press
	await page.Evaluate( 'document.body.dispatchEvent( new KeyboardEvent( "keydown", { key: "C", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true } ) ); true' );
	await page.WaitFor( 'document.activeElement && document.activeElement.closest( "#compose-text" ) !== null' );
	ASSERT.equal( await page.Evaluate( text_of( '.thread.compose .thread-anchor.whole' ) ), 'the whole document' );
	// while typing in the compose box, Ctrl+Shift+T still toggles; Escape leaves the box alone
	await page.Evaluate( '[ ...document.querySelectorAll( ".thread.compose button" ) ].pop().click(); true' );
	await page.WaitFor( 'document.querySelector( ".thread.compose" ) === null' );
	// the tabs: a second plan opens as the last tab; Alt+Home, Alt+End, Alt+PgDn (wrapping) and Alt+PgUp move along the strip
	let second = await created( 'Second keyboard plan' );
	await page.Evaluate( 'window.location.hash = "#/p/' + second.Id + '"; true' );
	await page.WaitFor( text_of( '.header .title' ) + ' === "Second keyboard plan"' );
	await page.Click( '#read-view' );
	let first_title = await page.Evaluate( text_of( '.tab-strip .tab:first-child .tab-title' ) );
	await page.Press( 'Home', [ 'Alt' ] );
	await page.WaitFor( text_of( '.header .title' ) + ' === ' + JSON.stringify( first_title ) );
	await page.Press( 'End', [ 'Alt' ] );
	await page.WaitFor( text_of( '.header .title' ) + ' === "Second keyboard plan"' );
	await page.Press( 'PageDown', [ 'Alt' ] );
	await page.WaitFor( text_of( '.header .title' ) + ' === ' + JSON.stringify( first_title ) );
	await page.Press( 'PageUp', [ 'Alt' ] );
	await page.WaitFor( text_of( '.header .title' ) + ' === "Second keyboard plan"' );
	ASSERT.deepEqual( page.Errors, [] );
} );


TEST( 'Help: About shows the version, the links and the project summary; Hotkeys lists the keys; Escape closes each', async function ()
{
	await menu_pick( '', 'About', '#app-menu' );
	let me = await api( 'GET', '/api/me' );
	await page.WaitFor( text_of( '#about-version' ) + ' === "version ' + me.Version + '"' );
	ASSERT.equal( await page.Evaluate( 'document.getElementById( "about-source" ).href' ), 'https://github.com/mchiver/consensus-ai' );
	ASSERT.equal( await page.Evaluate( 'document.getElementById( "about-guide" ).href' ), 'http://consensus-ai.mchiver.com/' );
	ASSERT.equal( await page.Evaluate( text_of( '.help-server .view-heading' ) ), running.Settings.Name + ' version ' + me.Version );
	let rows = await page.Evaluate( '[ ...document.querySelectorAll( ".about-table tbody tr" ) ].filter( function ( row ) { return getComputedStyle( row ).display !== "none"; } ).map( function ( row ) { return [ ...row.children ].map( function ( cell ) { return cell.textContent.trim(); } ); } )' );
	ASSERT.ok( rows.length >= 2 );
	ASSERT.ok( rows.some( function ( row ) { return row[ 0 ] === 'Default'; } ) );
	ASSERT.ok( rows.every( function ( row ) { return row.length === 5 && row.slice( 1 ).every( function ( cell ) { return /^\d+$/.test( cell ); } ); } ) );
	await page.Press( 'Escape' );
	await page.WaitFor( count_of( '.help-form' ) + ' === 0' );
	await menu_pick( '', 'Hotkeys', '#app-menu' );
	await page.WaitFor( count_of( '.hotkeys-table tr' ) + ' === 14' );
	// the editor's own keys (plan UI Tweaks IX)
	ASSERT.equal( await page.Evaluate( count_of( '.editor-keys-table tr' ) ), 4 );
	ASSERT.equal( await page.Evaluate( text_of( '.hotkeys-table tr:first-child kbd' ) ), 'Ctrl+E' );
	// the desktop window's keys are listed in the desktop only (plan UI Components, Step 6)
	ASSERT.equal( await page.Evaluate( count_of( '.desktop-keys-table' ) ), 0 );
	await page.Click( '#hotkeys-close' );
	await page.WaitFor( count_of( '.help-form' ) + ' === 0' );
	ASSERT.deepEqual( page.Errors, [] );
} );


TEST( 'the title bar (plan UI Components, Step 5): the brand, the menu without the desktop items, the status, the look popover', async function ()
{
	ASSERT.equal( await page.Evaluate( text_of( 'title-bar .brand' ) ), 'Consensus' );
	ASSERT.equal( await page.Evaluate( count_of( '#title-bar #app-menu' ) + ' + ' + count_of( '#title-bar #waiting-link' ) + ' + ' + count_of( '#title-bar #look-button' ) ), 3 );
	ASSERT.equal( await page.Evaluate( count_of( '#running-link' ) ), 0 );
	ASSERT.equal( await page.Evaluate( count_of( '.sidebar .brand, .sidebar #help-menu, .sidebar #theme-select' ) ), 0 );
	// the menu in a browser: About and Hotkeys, nothing of the desktop's
	await page.Click( '#app-menu' );
	await page.WaitFor( count_of( '#popup-menu .menu-button' ) + ' === 2' );
	ASSERT.equal( await page.Evaluate( '[ ...document.querySelectorAll( "#popup-menu .menu-button" ) ].map( function ( entry ) { return entry.textContent.trim(); } ).join( "," )' ), 'About,Hotkeys' );
	await page.Press( 'Escape' );
	await page.WaitFor( 'getComputedStyle( document.getElementById( "popup-menu" ) ).display === "none"' );
	// the look popover: the three selects; a theme picked applies; Escape closes it
	let before = await page.Evaluate( 'window.ConsensusTheme.Get().Theme' );
	await page.Click( '#look-button' );
	await page.WaitFor( count_of( '#look-popover #theme-select' ) + ' + ' + count_of( '#look-popover #scale-select' ) + ' + ' + count_of( '#look-popover #editor-select' ) + ' === 3' );
	await page.Evaluate( '( function () { let select = document.getElementById( "theme-select" ); select.selectedIndex = [ ...select.options ].findIndex( function ( option ) { return option.textContent.trim() === "Dark"; } ); select.dispatchEvent( new Event( "change" ) ); return true; } )()' );
	await page.WaitFor( 'document.documentElement.dataset.theme === "dark"' );
	await page.Press( 'Escape' );
	await page.WaitFor( count_of( '#look-popover' ) + ' === 0' );
	await page.Evaluate( 'window.ConsensusTheme.SetTheme( ' + JSON.stringify( before ) + ' ); true' );
	ASSERT.deepEqual( page.Errors, [] );
} );


TEST( 'LLM Instructions (plan UI Tweaks VII): a project row\'s menu shows the server\'s instructions with the project named first; Open links the page; Escape closes', async function ()
{
	await menu_pick( '.project.open > .project-head', 'LLM Instructions' );
	await page.WaitFor( '( document.getElementById( "instructions-text" ) || { value: "" } ).value.indexOf( "# This server" ) >= 0' );
	let text = await page.Evaluate( 'document.getElementById( "instructions-text" ).value' );
	ASSERT.match( text, /^# Your project\n\n- .+ \(prj-[^)]+\), its Readme (doc|ctx)-[^\n]+\n\n# This server\n/ );
	ASSERT.ok( text.indexOf( 'X-Consensus-Service: <your name>' ) >= 0 );
	ASSERT.ok( text.indexOf( '- API: ' + running.Url + '/api' ) >= 0 );
	ASSERT.equal( await page.Evaluate( 'document.getElementById( "instructions-open" ).getAttribute( "href" )' ), '/instructions' );
	await page.Press( 'Escape' );
	await page.WaitFor( count_of( '#instructions-popup .port-form' ) + ' === 0' );
	ASSERT.deepEqual( page.Errors, [] );
} );


TEST( 'export and import: a project\'s json in a popup; pasted back, the preview offers a copy, and the copy is made', async function ()
{
	const HEAD = '.project[data-project="' + home + '"] .project-head';
	await menu_pick( HEAD, 'Export' );
	await page.WaitFor( '( document.getElementById( "export-json" ) || { value: "" } ).value.includes( "consensus-project" )', 20000 );
	let json = await page.Evaluate( 'document.getElementById( "export-json" ).value' );
	ASSERT.match( JSON.parse( json ).Project.Id, /^prj-/ );
	ASSERT.equal( 'Corpora' in JSON.parse( json ), false );
	await page.Evaluate( '[ ...document.querySelectorAll( ".port-form button" ) ].find( function ( button ) { return button.textContent.trim() === "Close"; } ).click(); true' );
	await page.WaitFor( count_of( '#export-json' ) + ' === 0' );

	await menu_pick( '.root-head', 'Import' );
	await page.WaitFor( count_of( '#import-json' ) + ' === 1' );
	await page.Evaluate( '( function () { let box = document.getElementById( "import-json" ); box.value = ' + JSON.stringify( json ) + '; box.dispatchEvent( new Event( "input" ) ); return true; } )()' );
	await page.Click( '#import-preview' );
	await page.WaitFor( 'getComputedStyle( document.getElementById( "import-copy" ) ).display !== "none"' );
	ASSERT.match( await page.Evaluate( text_of( '.port-preview' ) ), /is already here/ );
	await page.Click( '#import-copy' );
	await page.WaitFor( count_of( '#import-report' ) + ' === 1', 20000 );
	ASSERT.match( await page.Evaluate( text_of( '#import-report' ) ), /Copy of Default \(imported \d{4}-\d{2}-\d{2}\): imported as a copy/ );
	await page.WaitFor( '[ ...document.querySelectorAll( ".project-name" ) ].some( function ( name ) { return name.textContent.startsWith( "Copy of Default" ); } )' );
	await page.Click( '#import-done' );
	await page.WaitFor( count_of( '#import-report' ) + ' === 0' );
	ASSERT.deepEqual( page.Errors, [] );
} );


TEST( 'settings: the owner edits consensus.json in a popup; problems are shown and nothing saved; a state added to a project reaches the picker', async function ()
{
	ASSERT.equal( await page.Evaluate( count_of( '.root-head .settings-button' ) ), 0 );
	ASSERT.equal( await page.Evaluate( 'getComputedStyle( document.getElementById( "root-menu" ) ).visibility' ), 'visible' );
	await menu_pick( '.root-head', 'Settings' );
	await page.WaitFor( 'document.getElementById( "settings-port" ) && document.getElementById( "settings-port" ).value === "0"', 20000 );
	ASSERT.equal( await page.Evaluate( 'document.getElementById( "settings-name" ).value' ), running.Settings.Name );
	ASSERT.equal( await page.Evaluate( 'document.getElementById( "settings-scope" ).selectedOptions[ 0 ].textContent.trim()' ), 'Local' );
	ASSERT.match( await page.Evaluate( 'document.getElementById( "settings-states" ).value' ), /^Draft\nPlan\nWorking\nFinished$/ );
	// plan User Management, Step 1: the line beneath the Scope (the Clerk section left the popup on 2026-10-20)
	ASSERT.match( await page.Evaluate( text_of( '#settings-trust' ) ), /^Local: this machine only\. A request is the owner\. Public needs a sign-in with a Host license\./ );
	ASSERT.equal( await page.Evaluate( count_of( '.settings-clerk' ) ), 0 );
	// plan Clerk, Step 5: Public is offered to a sign-in with a Host license alone; the Sign in button asks for one
	ASSERT.equal( await page.Evaluate( '[ ...document.getElementById( "settings-scope" ).options ].find( function ( option ) { return option.textContent.trim() === "Public"; } ).disabled' ), true );
	ASSERT.equal( await page.Evaluate( '[ ...document.getElementById( "settings-scope" ).options ].find( function ( option ) { return option.textContent.trim() === "Local"; } ).disabled' ), false );
	ASSERT.equal( await page.Evaluate( 'getComputedStyle( document.getElementById( "settings-sign-in" ) ).display !== "none"' ), true );
	// plan User Management, Step 2: the Owner in place of the participants, its name read-only
	ASSERT.equal( await page.Evaluate( 'document.getElementById( "settings-owner-name" ).value' ), 'user' );
	ASSERT.equal( await page.Evaluate( 'document.getElementById( "settings-owner-name" ).readOnly' ), true );
	ASSERT.equal( await page.Evaluate( 'document.getElementById( "settings-owner-display" ).value' ), 'User' );
	ASSERT.equal( await page.Evaluate( count_of( '.settings-participant' ) ), 0 );
	// plan LLM Tasks, Step 1: the three shipped tasks, one row each
	await page.WaitFor( count_of( '.settings-task' ) + ' === 5' );
	ASSERT.equal( await page.Evaluate( 'document.querySelector( ".settings-task-name" ).value' ), 'Answer' );
	ASSERT.equal( await page.Evaluate( 'document.querySelector( ".settings-task-writes" ).selectedOptions[ 0 ].textContent.trim()' ), 'consensus' );
	// an owner with no name: refused, the problem shown, nothing written
	await page.Evaluate( '( function () { let box = document.getElementById( "settings-owner-name" ); box.removeAttribute( "readonly" ); box.value = ""; box.dispatchEvent( new Event( "input" ) ); return true; } )()' );
	await page.Click( '#settings-save' );
	await page.WaitFor( 'getComputedStyle( document.getElementById( "settings-problems" ) ).display !== "none"' );
	ASSERT.match( await page.Evaluate( text_of( '#settings-problems' ) ), /Owner must have a Name/ );
	ASSERT.deepEqual( ( await api( 'GET', '/api/settings' ) ).Settings.Owner, { Name: 'user', Display: 'User' } );
	// the name back, a state added: saved, and the picker offers it at once
	await page.Evaluate( '( function () { let box = document.getElementById( "settings-owner-name" ); box.value = "user"; box.dispatchEvent( new Event( "input" ) ); return true; } )()' );
	await page.Evaluate( '( function () { let box = document.getElementById( "settings-states" ); box.value = box.value + "\\nShelved"; box.dispatchEvent( new Event( "input" ) ); return true; } )()' );
	await page.Click( '#settings-save' );
	await page.WaitFor( 'getComputedStyle( document.getElementById( "settings-saved" ) ).display !== "none"' );
	ASSERT.equal( await page.Evaluate( 'getComputedStyle( document.getElementById( "settings-restart" ) ).display' ), 'none' );
	ASSERT.deepEqual( ( await api( 'GET', '/api/me' ) ).States, [ 'Draft', 'Plan', 'Working', 'Finished', 'Shelved' ] );
	await page.Click( '#settings-close' );
	await page.WaitFor( count_of( '.settings-form' ) + ' === 0' );
	// the settings' list is the default for a new project (plan Run Shapes, Step 2); the picker follows the project's own
	// States, edited in its Settings popup
	await menu_pick( '.project[data-project="' + home + '"] .project-head', 'Settings' );
	await page.WaitFor( '( document.getElementById( "project-states" ) || { value: "" } ).value.startsWith( "Draft" )' );
	await page.WaitFor( count_of( '.project-task' ) + ' === 5' );
	ASSERT.equal( await page.Evaluate( '[ ...document.querySelectorAll( ".project-task input" ) ].every( function ( box ) { return box.checked; } )' ), true );
	await page.Evaluate( '( function () { let box = document.getElementById( "project-states" ); box.value = box.value + "\\nShelved"; box.dispatchEvent( new Event( "input" ) ); return true; } )()' );
	await page.Click( '#project-settings-save' );
	await page.WaitFor( 'getComputedStyle( document.getElementById( "project-settings-saved" ) ).display !== "none"' );
	await page.Click( '#project-settings-close' );
	let plan = ( await api( 'POST', '/api/plans', { Title: 'Shelved plan', Text: '# Shelved plan\n', Project: home } ) ).Plan;
	await page.Evaluate( 'window.location.hash = "#/p/' + plan.Id + '"; true' );
	await page.WaitFor( '[ ...( document.getElementById( "state-picker" ) || { options: [] } ).options ].some( function ( option ) { return option.label === "Shelved"; } )' );
	// the refused save is a 400 the browser logs as an error; nothing else is
	ASSERT.deepEqual( page.Errors.filter( function ( error ) { return !/400 \(Bad Request\).*\/api\/settings/.test( error ); } ), [] );
	page.Errors.length = 0;
} );


TEST( 'folds: a folder another server remembers folded still folds and unfolds here (plan UI Tweaks VI)', async function ()
{
	// The Consensus project moved from one server into the checkout with its ids, and the server it left remembered
	// its Context folder folded: the page read every root's list, so the folder never unfolded on the local server.
	let context = ( await api( 'GET', '/api/projects' ) ).Projects.find( function ( project ) { return project.Id === home; } ).ContextFolder;
	let chevron = '.project[data-project="' + home + '"] .folder-head .chevron';
	let folded = 'document.querySelector( ' + JSON.stringify( chevron ) + ' ).classList.contains( "folded" )';
	await page.WaitFor( count_of( chevron ) + ' >= 1' );
	let before = await page.Evaluate( folded );
	// another root, offline, whose remembered list has that folder
	await page.Evaluate( '( function () { localStorage.setItem( "consensus.other:1.folded", JSON.stringify( [ ' + JSON.stringify( context ) + ' ] ) ); let injector = angular.element( document.body ).injector(); let roots = injector.get( "Roots" ); roots.List.push( { Key: "other", Name: "Other", Url: "http://other:1", Kind: "server", Version: null, Base: "/servers/other", Me: null, Participants: [], States: [], Plans: [], Projects: [], Live: false, Error: "not reached", Loaded: true } ); injector.get( "Tree" ).Of( roots.List[ roots.List.length - 1 ] ); injector.get( "$rootScope" ).$apply(); return true; } )()' );
	await page.WaitFor( count_of( '.root' ) + ' === 2' );
	ASSERT.equal( await page.Evaluate( folded ), before );
	await page.Click( chevron );
	await page.WaitFor( folded + ' === ' + String( !before ) );
	await page.Click( chevron );
	await page.WaitFor( folded + ' === ' + String( before ) );
	ASSERT.deepEqual( JSON.parse( await page.Evaluate( 'localStorage.getItem( "consensus.other:1.folded" )' ) ), [ context ] );
	await page.Evaluate( '( function () { localStorage.removeItem( "consensus.other:1.folded" ); let roots = angular.element( document.body ).injector().get( "Roots" ); roots.List.pop(); angular.element( document.body ).injector().get( "$rootScope" ).$apply(); return true; } )()' );
	await page.WaitFor( count_of( '.root' ) + ' === 1' );
	ASSERT.deepEqual( page.Errors, [] );
} );


TEST( 'one project in the window (plan Rearchitecturation, Step 2): the page shows one project view, open, with no root head; a page of many shows the server rows', async function ()
{
	// The Host page (a browser): the server rows, each an array of project views
	ASSERT.equal( await page.Evaluate( count_of( '.root > .root-head' ) ), 1 );
	ASSERT.equal( await page.Evaluate( count_of( 'project-view.project' ) ) >= 1, true );
	ASSERT.equal( await page.Evaluate( count_of( '.project.single' ) ), 0 );
	// The Desktop's page: window.ConsensusDesktop names the window's one project before the page loads; the remembered
	// state is keyed by the project's key, not the server's address
	let single = await browser.OpenPage();
	try
	{
		let before_load = 'window.ConsensusDesktop = { Roots: [ { Key: "", Name: "here", Url: "", Kind: "browser", StoredKey: "W:/code/one" } ], Project: { Id: ' + JSON.stringify( home ) + ', Name: "One", Path: "W:/code/one", Host: null, Key: "W:/code/one" }, Recent: [], Remembered: {} };';
		await single.Send( 'Page.addScriptToEvaluateOnNewDocument', { source: before_load } );
		await single.Navigate( running.Url + '/#/p/' + plan.Id );
		await single.WaitFor( count_of( '.project.single.open' ) + ' === 1 && ' + count_of( '.header .title' ) + ' === 1', 30000 );
		ASSERT.equal( await single.Evaluate( count_of( '.root-head' ) ), 0 );
		ASSERT.equal( await single.Evaluate( count_of( 'project-view.project' ) ), 1 );
		ASSERT.equal( await single.Evaluate( count_of( '.project.single > .project-head .chevron' ) ), 0 );
		ASSERT.equal( await single.Evaluate( text_of( '.project.single .project-name' ) ), 'Default' );
		ASSERT.equal( await single.Evaluate( 'angular.element( document.body ).injector().get( "Roots" ).Single()' ), true );
		ASSERT.equal( await single.Evaluate( 'angular.element( document.body ).injector().get( "Tree" ).IsOpen( { Id: ' + JSON.stringify( home ) + ' } )' ), true );
		// a fold is remembered under the project's key
		let folder_chevron = '.project.single .folder-head .chevron';
		await single.WaitFor( count_of( folder_chevron ) + ' >= 1' );
		let was_folded = await single.Evaluate( 'document.querySelector( ' + JSON.stringify( folder_chevron ) + ' ).classList.contains( "folded" )' );
		await single.Click( folder_chevron );
		await single.WaitFor( 'document.querySelector( ' + JSON.stringify( folder_chevron ) + ' ).classList.contains( "folded" ) === ' + String( !was_folded ) );
		ASSERT.equal( typeof await single.Evaluate( 'localStorage.getItem( "consensus.W:/code/one.folded" )' ), 'string' );
		await single.Click( folder_chevron );
		ASSERT.deepEqual( single.Errors, [] );
	}
	finally
	{
		// the tab is closed, not left behind: a page behind another gets no animation frames (the main page's tests follow)
		await single.Send( 'Page.close' ).catch( function () {} );
		single.Close();
		await page.Send( 'Page.bringToFront' );
	}
} );


// A click at the centre of an element's first line box: a mark that wraps onto two lines has its bounding box's centre
// between them, where no text is.
async function click_first_line( selector )
{
	let box = await page.Evaluate( '( function () { let e = document.querySelector( ' + JSON.stringify( selector ) + ' ); if ( !e ) { return null; } e.scrollIntoView( { block: "center" } ); let r = e.getClientRects()[ 0 ]; return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; } )()' );
	ASSERT.ok( box, 'nothing matches ' + selector );
	await page.Send( 'Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 } );
	await page.Send( 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 } );
}


TEST( 'CodeMirror (plan UI Components, Step 3): the Editor setting switches the Edit view and the reply box; the threads\' passages are marked, a mark\'s click selects, the marks follow the text and are found again on save; back to Monaco', async function ()
{
	let plan = await created( 'Mirror plan' );
	await api( 'PUT', '/api/plans/' + plan.Id + '/text', { Text: '# Mirror plan\n\nThe first paragraph makes a **bold claim** here.\n\n- one list item\n- another one\n\nA closing line.\n', Revision: plan.Revision } );
	let claim = ( await api( 'POST', '/api/plans/' + plan.Id + '/threads', { Text: 'Why this claim?', Anchor: { Text: 'bold claim' } } ) ).Thread;
	await api( 'POST', '/api/plans/' + plan.Id + '/threads', { Text: 'Keep it.', Anchor: { Text: 'another one' }, Resolve: true } );
	await page.Evaluate( 'window.location.hash = "#/p/' + plan.Id + '"; true' );
	await page.WaitFor( text_of( '.header .title' ) + ' === "Mirror plan"' );
	await show_all_threads();
	// the setting, as the look popover's select sets it
	await set_editor( 'codemirror' );
	ASSERT.equal( await page.Evaluate( 'window.localStorage.getItem( "consensus.editor" )' ), '"codemirror"' );
	// in CodeMirror mode the editor is the view (plan Markdown Editor, Step 3): it opens at once
	await page.WaitFor( count_of( '#editor .cm-editor' ) + ' === 1 && ' + count_of( '#editor .monaco-editor' ) + ' === 0', 30000 );
	// the CodeMirror editor has no preview pane or Preview button: it opens as the Live Preview, with the Source button (plan Markdown Editor, Step 1)
	ASSERT.equal( await page.Evaluate( count_of( '.edit-preview' ) + ' + ' + count_of( '#preview-toggle' ) ), 0 );
	ASSERT.equal( await page.Evaluate( count_of( '#editor .cm-editor.cm-live' ) + ' + ' + count_of( '#view-source' ) ), 2 );
	// the two threads' passages are marked, by state; a click on one selects its thread, in the pane and in the text
	const MARKS = '[ ...document.querySelectorAll( "#editor .cm-content .anchor" ) ].map( function ( mark ) { return mark.textContent + ":" + mark.className.replace( "anchor ", "" ); } ).join( " " )';
	await page.WaitFor( MARKS + ' === "bold claim:contested another one:resolved"', 10000 );
	await click_first_line( '#editor .cm-content .anchor[data-threads="' + claim.Id + '"]' );
	await page.WaitFor( count_of( '.thread.selected' ) + ' === 1 && document.querySelector( ".thread.selected" ).id === "thread-' + claim.Id + '"' );
	await page.WaitFor( MARKS + ' === "bold claim:contested selected another one:resolved"' );
	// a click in the text off any mark deselects (plan UI Tweaks X), as in the Read view; the mark again reselects
	await click_line( 'A closing line.' );
	await page.WaitFor( count_of( '.thread.selected' ) + ' === 0' );
	await page.WaitFor( MARKS + ' === "bold claim:contested another one:resolved"' );
	await click_first_line( '#editor .cm-content .anchor[data-threads="' + claim.Id + '"]' );
	await page.WaitFor( count_of( '.thread.selected' ) + ' === 1' );
	await page.WaitFor( MARKS + ' === "bold claim:contested selected another one:resolved"' );
	// typing at the top: the marks follow their words; Ctrl+S saves, and the server finds them again
	await page.Evaluate( 'document.querySelector( "#editor .cm-content" ).focus(); true' );
	await page.Press( 'Home', [ 'Control' ] );
	await page.Type( 'Typed first. ' );
	await page.WaitFor( '!document.getElementById( "save-button" ).disabled' );
	ASSERT.equal( await page.Evaluate( MARKS ), 'bold claim:contested selected another one:resolved' );
	await page.Press( 's', [ 'Control' ] );
	await page.WaitFor( text_of( '#revision' ) + ' === "revision 3"' );
	await page.WaitFor( MARKS + ' === "bold claim:contested selected another one:resolved"' );
	ASSERT.equal( ( await api( 'GET', '/api/plans/' + plan.Id ) ).Text.startsWith( 'Typed first. # Mirror plan' ), true );
	// the reply box is a CodeMirror box; Ctrl+Enter posts
	await page.WaitFor( count_of( '.thread.selected .reply-box .cm-editor' ) + ' === 1', 10000 );
	await page.Evaluate( 'document.querySelector( ".thread.selected .reply-box .cm-content" ).focus(); true' );
	await page.Type( 'From the CodeMirror box.' );
	await page.WaitFor( '!document.querySelector( ".thread.selected .reply-button" ).disabled' );
	await page.Press( 'Enter', [ 'Control' ] );
	await page.WaitFor( 'Array.from( document.querySelectorAll( "#thread-' + claim.Id + ' .reply-text" ) ).pop().textContent.trim() === "From the CodeMirror box."' );
	// back to Monaco: the next Edit opens it
	await set_editor( 'monaco' );
	await page.Click( '#view-edit' );
	await page.WaitFor( count_of( '#editor .monaco-editor' ) + ' === 1 && ' + count_of( '#editor .cm-editor' ) + ' === 0', 30000 );
	ASSERT.deepEqual( page.Errors, [] );
} );


// A click near the left end of the editor line whose text is Text, as a person clicks into a rendered line.
async function click_line( text )
{
	let box = await page.Evaluate( '( function () { let line = [ ...document.querySelectorAll( "#editor .cm-line" ) ].find( function ( one ) { return one.textContent.trim() === ' + JSON.stringify( text ) + '; } ); if ( !line ) { return null; } line.scrollIntoView( { block: "center" } ); let r = line.getBoundingClientRect(); return { x: r.x + 12, y: r.y + r.height / 2 }; } )()' );
	ASSERT.ok( box, 'no editor line reads ' + text );
	await page.Send( 'Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 } );
	await page.Send( 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 } );
}


TEST( 'Live Preview (plan Markdown Editor, Step 1): off the cursor\'s line the markdown renders in place, on it the source shows; Source shows it all and is remembered; a checkbox edits the text; the table widget gives way to its source; the thread marks stay and Save works; back to Monaco', async function ()
{
	let plan = await created( 'Live plan' );
	const SOURCE = '# Live plan\n\nThe first paragraph makes a **bold claim** with a [link](http://example.com/) here.\n\n## Second heading\n\n- one list item\n- [ ] a task\n\n```js\nlet x = 1;\n```\n\n| Head | Other |\n| --- | --- |\n| a | b |\n\n![a picture](/img/mark.svg)\n\nA closing line.\n';
	await api( 'PUT', '/api/plans/' + plan.Id + '/text', { Text: SOURCE, Revision: plan.Revision } );
	await api( 'POST', '/api/plans/' + plan.Id + '/threads', { Text: 'Why?', Anchor: { Text: 'bold claim' } } );
	await api( 'POST', '/api/plans/' + plan.Id + '/threads', { Text: 'Fine.', Anchor: { Text: 'closing line' }, Resolve: true } );
	await page.Evaluate( 'window.location.hash = "#/p/' + plan.Id + '"; true' );
	await page.WaitFor( text_of( '.header .title' ) + ' === "Live plan"' );
	await show_all_threads();
	await set_editor( 'codemirror' );
	await page.WaitFor( count_of( '#editor .cm-editor.cm-live' ) + ' === 1 && ' + count_of( '#editor .cm-content .anchor' ) + ' === 2', 30000 );
	const LINE = function ( text ) { return '[ ...document.querySelectorAll( "#editor .cm-line" ) ].find( function ( line ) { return line.textContent.trim() === ' + JSON.stringify( text ) + '; } )'; };
	// the cursor is on the first line, so its marks show; the second heading\'s are hidden and its line is sized as a heading
	await page.WaitFor( '!!' + LINE( 'Second heading' ) + ' && !!' + LINE( '# Live plan' ) );
	ASSERT.equal( await page.Evaluate( LINE( 'Second heading' ) + '.classList.contains( "cm-live-h2" )' ), true );
	ASSERT.equal( await page.Evaluate( count_of( '#editor .cm-live-bullet' ) ), 2 );
	ASSERT.equal( await page.Evaluate( count_of( '#editor .cm-live-check input' ) + ' + ' + count_of( '#editor .cm-live-fence.start' ) + ' + ' + count_of( '#editor .cm-live-table table' ) + ' + ' + count_of( '#editor img.cm-live-image, #editor .cm-live-image-missing' ) ), 4 );
	ASSERT.equal( await page.Evaluate( '[ ...document.querySelectorAll( "#editor .cm-live-link" ) ].map( function ( link ) { return link.textContent + ">" + link.dataset.url; } ).join()' ), 'link>http://example.com/' );
	ASSERT.equal( await page.Evaluate( count_of( '#editor .cm-lineNumbers' ) ), 0 );
	// a click into the second heading reveals its marks
	await click_line( 'Second heading' );
	await page.WaitFor( '!!' + LINE( '## Second heading' ) );
	// Source shows every mark, with the gutters, and is remembered; off again
	await page.Click( '#view-source' );
	await page.WaitFor( count_of( '#editor .cm-editor.cm-live' ) + ' === 0' );
	ASSERT.equal( await page.Evaluate( count_of( '#editor .cm-live-bullet' ) + ' + ' + count_of( '#editor .cm-live-table' ) ), 0 );
	ASSERT.equal( await page.Evaluate( count_of( '#editor .cm-lineNumbers' ) ), 1 );
	ASSERT.equal( await page.Evaluate( 'window.localStorage.getItem( "consensus.source-mode" )' ), 'true' );
	await page.Click( '#view-source' );
	await page.WaitFor( count_of( '#editor .cm-editor.cm-live' ) + ' === 1 && ' + count_of( '#editor .cm-live-bullet' ) + ' === 2' );
	ASSERT.equal( await page.Evaluate( 'window.localStorage.getItem( "consensus.source-mode" )' ), 'false' );
	// the checkbox edits the source and lights Save
	await page.Evaluate( 'document.querySelector( "#editor .cm-live-check input" ).click(); true' );
	await page.WaitFor( '!document.getElementById( "save-button" ).disabled' );
	await page.WaitFor( 'document.querySelector( "#editor .cm-live-check input" ).checked === true' );
	// the table widget gives way to its source on a click
	await page.Evaluate( 'document.querySelector( "#editor .cm-live-table" ).dispatchEvent( new MouseEvent( "mousedown", { bubbles: true, cancelable: true } ) ); true' );
	await page.WaitFor( count_of( '#editor .cm-live-table' ) + ' === 0 && !!' + LINE( '| Head | Other |' ) );
	// Ctrl+S saves the checkbox\'s edit; the marks are found again
	await page.Press( 's', [ 'Control' ] );
	await page.WaitFor( text_of( '#revision' ) + ' === "revision 3"' );
	ASSERT.equal( ( await api( 'GET', '/api/plans/' + plan.Id ) ).Text.indexOf( '- [x] a task' ) > 0, true );
	await page.WaitFor( count_of( '#editor .cm-content .anchor' ) + ' === 2' );
	await set_editor( 'monaco' );
	await page.Click( '#view-read' );
	ASSERT.deepEqual( page.Errors, [] );
} );


// A mouse drag along the editor line whose text is Text, from its first character past its end: the way a person
// selects a line. The editor renders the lines in view and around them, so the line is first scrolled to through
// the view (EditorView.findFromDOM), then measured once it is in the DOM.
async function drag_line( text )
{
	const LINE = '[ ...document.querySelectorAll( "#editor .cm-line" ) ].find( function ( one ) { return one.textContent.trim() === ' + JSON.stringify( text ) + '; } )';
	let found = await page.Evaluate( '( function () { let view = window.CodeMirror6.EditorView.findFromDOM( document.querySelector( "#editor .cm-editor" ) ); let at = view.state.doc.toString().indexOf( ' + JSON.stringify( text ) + ' ); if ( at < 0 ) { return false; } view.dispatch( { effects: window.CodeMirror6.EditorView.scrollIntoView( at, { y: "center" } ) } ); return true; } )()' );
	ASSERT.equal( found, true, 'the text is not in the editor: ' + text );
	await page.WaitFor( '!!' + LINE, 5000 );
	// the scroll settles before the line is measured
	await new Promise( function ( resolve ) { setTimeout( resolve, 300 ); } );
	let box = await page.Evaluate( '( function () { let line = ' + LINE + '; let r = line.getBoundingClientRect(); let range = document.createRange(); range.selectNodeContents( line ); let t = range.getBoundingClientRect(); return { x1: t.x + 1, x2: t.x + t.width + 4, y: r.y + r.height / 2 }; } )()' );
	await page.Send( 'Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x1, y: box.y, button: 'left', clickCount: 1 } );
	await page.Send( 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: ( box.x1 + box.x2 ) / 2, y: box.y, button: 'left', buttons: 1 } );
	await page.Send( 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x2, y: box.y, button: 'left', buttons: 1 } );
	await page.Send( 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x2, y: box.y, button: 'left', clickCount: 1 } );
}

// A drag tried again when the page did not answer it: under the whole suite the layout may still be moving when the
// line is measured, and the drag lands beside it.
async function drag_until( text, condition )
{
	for ( let attempt = 1; ; attempt++ )
	{
		await drag_line( text );
		try
		{
			await page.WaitFor( condition, 4000 );
			return;
		}
		catch ( error )
		{
			if ( attempt >= 3 )
			{
				throw error;
			}
		}
	}
}


TEST( 'The threads in the editor (plan Markdown Editor, Step 2): a thread picked in the pane scrolls the editor to its passage and flashes it; a selection offers Copy, Comment and Start a new Subplan, Re-anchor here while re-anchoring, Copy alone while dirty; a pending select is settled in the editor; New Comment is there', async function ()
{
	let plan = await created( 'Threads in editor' );
	let filler = '';
	for ( let index = 1; index <= 40; index++ )
	{
		filler += 'Paragraph ' + index + ' fills the page with a few words of its own.\n\n';
	}
	const SOURCE = '# Threads in editor\n\nThe first paragraph makes a **bold claim** here.\n\n' + filler + 'A closing line.\n';
	await api( 'PUT', '/api/plans/' + plan.Id + '/text', { Text: SOURCE, Revision: plan.Revision } );
	let claim = ( await api( 'POST', '/api/plans/' + plan.Id + '/threads', { Text: 'Why?', Anchor: { Text: 'bold claim' } } ) ).Thread;
	let closing = ( await api( 'POST', '/api/plans/' + plan.Id + '/threads', { Text: 'Fine.', Anchor: { Text: 'closing line' }, Resolve: true } ) ).Thread;
	await page.Evaluate( 'window.location.hash = "#/p/' + plan.Id + '"; true' );
	await page.WaitFor( text_of( '.header .title' ) + ' === "Threads in editor"' );
	// the editor scrolls in an animation frame, and a background page (the detached-window test left this one behind a popup) gets none: the page is brought to the front
	await page.Send( 'Page.bringToFront' );
	await show_all_threads();
	await set_editor( 'codemirror' );
	// the editor renders the lines in view and around them, so only the first passage's mark is in the DOM yet
	await page.WaitFor( count_of( '#editor .cm-editor.cm-live' ) + ' === 1 && ' + count_of( '#editor .cm-content .anchor[data-threads="' + claim.Id + '"]' ) + ' === 1', 30000 );
	// New Comment is offered in the editor: the Actions menu's entry is enabled there
	await page.Evaluate( 'document.getElementById( "header-actions" ).click(); true' );
	await page.WaitFor( '[ ...document.querySelectorAll( "#popup-menu .menu-button" ) ].some( function ( entry ) { return entry.textContent.trim() === "New Comment" && !entry.disabled; } )' );
	await page.Press( 'Escape' );
	await page.WaitFor( 'getComputedStyle( document.getElementById( "popup-menu" ) ).display === "none"' );
	// the closing thread\'s card: the editor scrolls to its passage, which flashes
	const IN_VIEW = '( function () { let mark = document.querySelector( "#editor .cm-content .anchor[data-threads=\\"' + closing.Id + '\\"]" ); let scroller = document.querySelector( "#editor .cm-scroller" ); if ( !mark || !scroller ) { return false; } let m = mark.getBoundingClientRect(); let s = scroller.getBoundingClientRect(); return m.top >= Math.max( 0, s.top ) && m.bottom <= Math.min( window.innerHeight, s.bottom ); } )()';
	ASSERT.equal( await page.Evaluate( IN_VIEW ), false );
	await page.Evaluate( 'document.querySelector( "#thread-' + closing.Id + ' .thread-anchor" ).click(); true' );
	await page.WaitFor( count_of( '#editor .cm-content .flash-mark' ) + ' === 1' );
	await page.WaitFor( IN_VIEW, 5000 );
	await page.WaitFor( count_of( '#editor .cm-content .flash-mark' ) + ' === 0', 5000 );
	// a selection offers the three buttons; Comment starts a comment on the words, the view staying the editor
	await drag_until( 'A closing line.', count_of( '.edit-view .comment-button.shown' ) + ' === 3' );
	ASSERT.equal( await page.Evaluate( text_of( '.edit-view .comment-selection' ) ), 'Comment' );
	await page.Evaluate( 'document.querySelector( ".edit-view .comment-selection" ).click(); true' );
	await page.WaitFor( '( function () { let state = angular.element( document.body ).injector().get( "State" ); return !!state.Compose && !!state.Compose.Anchor && state.Compose.Anchor.Text.indexOf( "closing line" ) >= 0 && state.MirrorShown(); } )()' );
	await page.WaitFor( count_of( '.edit-view .comment-button.shown' ) + ' === 0' );
	await page.Evaluate( '( function () { let injector = angular.element( document.body ).injector(); injector.get( "State" ).CancelCompose(); injector.get( "$rootScope" ).$apply(); return true; } )()' );
	// re-anchoring: the hint above the editor, the button reads Re-anchor here, and the thread moves
	await page.Evaluate( '( function () { let injector = angular.element( document.body ).injector(); injector.get( "State" ).StartReanchor( ' + JSON.stringify( claim.Id ) + ' ); injector.get( "$rootScope" ).$apply(); return true; } )()' );
	await page.WaitFor( 'document.querySelector( ".reanchor-hint" ).offsetParent !== null && angular.element( document.body ).injector().get( "State" ).MirrorShown()' );
	await drag_until( 'A closing line.', count_of( '.edit-view .comment-button.shown' ) + ' === 2 && ' + text_of( '.edit-view .comment-selection' ) + ' === "Re-anchor here"' );
	await page.Evaluate( 'document.querySelector( ".edit-view .comment-selection" ).click(); true' );
	await page.WaitFor( 'document.querySelector( ".reanchor-hint" ).offsetParent === null' );
	let moved = ( await api( 'GET', '/api/plans/' + plan.Id + '/threads' ) ).Threads.find( function ( thread ) { return thread.Id === claim.Id; } );
	ASSERT.equal( moved.Anchor.Text.indexOf( 'closing line' ) >= 0 && moved.Anchor.Text !== 'bold claim', true, 'the thread moved to the selected words: ' + moved.Anchor.Text );
	// a pending select (a waiting item\'s) is settled in the editor: the thread selected and its passage flashed
	await page.Evaluate( '( function () { let injector = angular.element( document.body ).injector(); let state = injector.get( "State" ); state.Select( null ); state.Pend( { Select: ' + JSON.stringify( closing.Id ) + ' } ); state.Reload(); return true; } )()' );
	await page.WaitFor( count_of( '.thread.selected' ) + ' === 1 && document.querySelector( ".thread.selected" ).id === "thread-' + closing.Id + '" && ' + count_of( '#editor .cm-content .flash-mark' ) + ' === 1', 5000 );
	// Start a new Subplan from a selection opens the form
	await drag_until( 'Paragraph 3 fills the page with a few words of its own.', count_of( '.edit-view .comment-button.shown' ) + ' === 3' );
	await page.Evaluate( 'document.querySelector( ".edit-view .subplan-selection" ).click(); true' );
	await page.WaitFor( count_of( '.subplan-form' ) + ' === 1' );
	await page.Evaluate( '( function () { let injector = angular.element( document.body ).injector(); injector.get( "Subplans" ).Cancel(); injector.get( "$rootScope" ).$apply(); return true; } )()' );
	// a dirty text offers Copy alone; undone, the three come back
	await page.Evaluate( 'document.querySelector( "#editor .cm-content" ).focus(); true' );
	await page.Press( 'End', [ 'Control' ] );
	await page.Type( 'x' );
	await page.WaitFor( '!document.getElementById( "save-button" ).disabled' );
	await drag_until( 'Paragraph 2 fills the page with a few words of its own.', count_of( '.edit-view .comment-button.shown' ) + ' === 1 && ' + count_of( '.edit-view .copy-selection.shown' ) + ' === 1' );
	await page.Press( 'z', [ 'Control' ] );
	await page.WaitFor( 'document.getElementById( "save-button" ).disabled' );
	await set_editor( 'monaco' );
	await page.Click( '#view-read' );
	ASSERT.deepEqual( page.Errors, [] );
} );


TEST( 'One view (plan Markdown Editor, Step 3): in CodeMirror mode a plan opens in the editor, with Source and Revisions and Save in the heading; Source by button and Ctrl+E; the dirty dot; a newer revision taken silently while clean, Stale while dirty, Discard; Revisions read-only; an archived plan read-only; back to Monaco', async function ()
{
	let plan = await created( 'One view' );
	const SOURCE = '# One view\n\nFirst paragraph here.\n\nSecond paragraph here.\n\nA closing line.\n';
	await api( 'PUT', '/api/plans/' + plan.Id + '/text', { Text: SOURCE, Revision: plan.Revision } );
	await page.Evaluate( 'window.location.hash = "#/p/' + plan.Id + '"; true' );
	await page.WaitFor( text_of( '.header .title' ) + ' === "One view"' );
	await page.Send( 'Page.bringToFront' );
	const VIEW = 'window.CodeMirror6.EditorView.findFromDOM( document.querySelector( "#editor .cm-editor" ) )';
	// the setting switched: the editor shows at once, no Read or Edit; Source and Revisions; Save in the heading, disabled while clean; no edit bar
	await set_editor( 'codemirror' );
	await page.WaitFor( count_of( '#editor .cm-editor.cm-live' ) + ' === 1 && ' + count_of( '#view-read' ) + ' + ' + count_of( '#view-edit' ) + ' === 0 && ' + count_of( '#view-source' ) + ' + ' + count_of( '#view-revisions' ) + ' === 2', 30000 );
	ASSERT.equal( await page.Evaluate( count_of( '.header #save-button' ) + ' + ' + count_of( '.edit-bar' ) ), 1 );
	ASSERT.equal( await page.Evaluate( 'document.getElementById( "save-button" ).disabled' ), true );
	ASSERT.equal( await page.Evaluate( 'document.querySelector( "#editor .cm-editor" ).offsetParent !== null && document.getElementById( "read-view" ).offsetParent === null' ), true );
	// Source by the button, back by Ctrl+E
	await page.Click( '#view-source' );
	await page.WaitFor( count_of( '#editor .cm-editor.cm-live' ) + ' === 0 && ' + count_of( '#editor .cm-lineNumbers' ) + ' === 1' );
	await page.Press( 'e', [ 'Control' ] );
	await page.WaitFor( count_of( '#editor .cm-editor.cm-live' ) + ' === 1' );
	// an edit lights Save and dots the tab; Save from the heading makes the revision and clears both
	await page.Evaluate( 'document.querySelector( "#editor .cm-content" ).focus(); true' );
	await page.Press( 'End', [ 'Control' ] );
	await page.Type( 'Typed at the end.' );
	await page.WaitFor( '!document.getElementById( "save-button" ).disabled && ' + count_of( tab_selector( plan.Id ) + ' .dirty-dot' ) + ' === 1' );
	await page.Click( '#save-button' );
	await page.WaitFor( text_of( '#revision' ) + ' === "revision 3" && ' + count_of( tab_selector( plan.Id ) + ' .dirty-dot' ) + ' === 0 && document.getElementById( "save-button" ).disabled' );
	// a newer revision from elsewhere while the text is clean: taken silently, the cursor still at the end
	let saved = await api( 'GET', '/api/plans/' + plan.Id );
	ASSERT.equal( saved.Text.indexOf( 'Typed at the end.' ) > 0, true );
	await api( 'PUT', '/api/plans/' + plan.Id + '/text', { Text: saved.Text.replace( 'Second paragraph here.', 'Second paragraph, changed on the server, here.' ), Revision: saved.Plan.Revision } );
	await page.WaitFor( text_of( '#revision' ) + ' === "revision 4" && ' + VIEW + '.state.doc.toString().indexOf( "changed on the server" ) > 0', 10000 );
	ASSERT.equal( await page.Evaluate( '( function () { let view = ' + VIEW + '; return view.state.selection.main.head === view.state.doc.length; } )()' ), true );
	ASSERT.equal( await page.Evaluate( count_of( '.edit-stale' ) + ' + ' + count_of( '#discard-button' ) ), 0 );
	ASSERT.equal( await page.Evaluate( 'document.getElementById( "save-button" ).disabled' ), true );
	// a newer revision while dirty: Stale, Save off, Discard brings the server\'s text back
	await page.Evaluate( 'document.querySelector( "#editor .cm-content" ).focus(); true' );
	await page.Press( 'End', [ 'Control' ] );
	await page.Type( ' More.' );
	await page.WaitFor( '!document.getElementById( "save-button" ).disabled' );
	let fresh = await api( 'GET', '/api/plans/' + plan.Id );
	await api( 'PUT', '/api/plans/' + plan.Id + '/text', { Text: fresh.Text + '\nA line added on the server.\n', Revision: fresh.Plan.Revision } );
	await page.WaitFor( count_of( '.edit-stale' ) + ' === 1 && ' + count_of( '#discard-button' ) + ' === 1 && document.getElementById( "save-button" ).disabled', 10000 );
	await page.Click( '#discard-button' );
	await page.WaitFor( count_of( '.edit-stale' ) + ' === 0 && ' + VIEW + '.state.doc.toString().indexOf( "added on the server" ) > 0 && ' + VIEW + '.state.doc.toString().indexOf( "More." ) < 0 && document.getElementById( "save-button" ).disabled' );
	// Revisions: the text in a read-only editor; pressed again, the editor comes back
	await page.Click( '#view-revisions' );
	await page.WaitFor( count_of( '#revision-editor .cm-editor.cm-live .cm-content[contenteditable="false"]' ) + ' === 1 && ' + count_of( '#revision-view' ) + ' === 0', 10000 );
	await page.Click( '#view-revisions' );
	await page.WaitFor( 'document.querySelector( "#editor .cm-editor" ).offsetParent !== null && ' + count_of( '#editor .cm-content[contenteditable="true"]' ) + ' === 1' );
	// archived: read-only in the editor, Save off; restored: editable again
	await api( 'POST', '/api/items/' + plan.Id + '/archive' );
	await page.WaitFor( 'document.getElementById( "archived-badge" ).offsetParent !== null && ' + count_of( '#editor .cm-content[contenteditable="false"]' ) + ' === 1 && document.getElementById( "save-button" ).disabled', 10000 );
	await api( 'POST', '/api/items/' + plan.Id + '/restore' );
	await page.WaitFor( 'document.getElementById( "archived-badge" ).offsetParent === null && ' + count_of( '#editor .cm-content[contenteditable="true"]' ) + ' === 1', 10000 );
	// back to Monaco: Read and Edit are back and the Read view shows
	await set_editor( 'monaco' );
	await page.WaitFor( count_of( '#view-read' ) + ' === 1 && document.getElementById( "read-view" ).offsetParent !== null' );
	ASSERT.deepEqual( page.Errors, [] );
} );


TEST( 'Closing (plan Markdown Editor, Step 4): a dirty tab\'s close asks; Cancel keeps it, Discard drops the draft, Save makes the revision; Close all lists every dirty tab and keeps a stale one; the Confirm on close setting and the leave prompt', async function ()
{
	let first = await created( 'Closing one' );
	let second = await created( 'Closing two' );
	await page.Evaluate( 'window.location.hash = "#/p/' + first.Id + '"; true' );
	await page.WaitFor( text_of( '.header .title' ) + ' === "Closing one"' );
	await page.Evaluate( 'window.location.hash = "#/p/' + second.Id + '"; true' );
	await page.WaitFor( text_of( '.header .title' ) + ' === "Closing two"' );
	const DRAFT = function ( id, text, base ) { return '( function () { let injector = angular.element( document.body ).injector(); injector.get( "Tabs" ).SetDraft( ' + JSON.stringify( id ) + ', { Text: ' + JSON.stringify( text ) + ', Base: ' + base + ' } ); injector.get( "$rootScope" ).$apply(); return true; } )()'; };
	const CLOSE_X = function ( id ) { return 'document.querySelector( ' + JSON.stringify( tab_selector( id ) + ' .close-tab' ) + ' ).click(); true'; };
	const FORM = count_of( '#close-popup .close-form' );
	// the × of a dirty tab asks, naming it; Cancel keeps the tab and its draft
	await page.Evaluate( DRAFT( first.Id, 'Draft one.', first.Revision ) );
	await page.WaitFor( count_of( tab_selector( first.Id ) + ' .dirty-dot' ) + ' === 1' );
	await page.Evaluate( CLOSE_X( first.Id ) );
	await page.WaitFor( FORM + ' === 1' );
	ASSERT.equal( ( await page.Evaluate( text_of( '#close-popup .subplan-head' ) ) ).indexOf( 'Closing one' ) >= 0, true );
	await page.Click( '#close-cancel' );
	await page.WaitFor( FORM + ' === 0' );
	ASSERT.equal( await page.Evaluate( count_of( tab_selector( first.Id ) + ' .dirty-dot' ) ), 1 );
	// Discard closes it and the draft is gone
	await page.Evaluate( CLOSE_X( first.Id ) );
	await page.WaitFor( FORM + ' === 1' );
	await page.Click( '#close-discard' );
	await page.WaitFor( count_of( tab_selector( first.Id ) ) + ' === 0' );
	await page.Evaluate( 'window.location.hash = "#/p/' + first.Id + '"; true' );
	await page.WaitFor( text_of( '.header .title' ) + ' === "Closing one"' );
	ASSERT.equal( await page.Evaluate( count_of( tab_selector( first.Id ) + ' .dirty-dot' ) ), 0 );
	ASSERT.equal( ( await api( 'GET', '/api/plans/' + first.Id ) ).Plan.Revision, first.Revision );
	// Save makes the revision and closes
	await page.Evaluate( DRAFT( first.Id, 'Draft one, saved.', first.Revision ) );
	await page.WaitFor( count_of( tab_selector( first.Id ) + ' .dirty-dot' ) + ' === 1' );
	await page.Evaluate( CLOSE_X( first.Id ) );
	await page.WaitFor( FORM + ' === 1' );
	await page.Click( '#close-save' );
	await page.WaitFor( count_of( tab_selector( first.Id ) ) + ' === 0' );
	let saved = await api( 'GET', '/api/plans/' + first.Id );
	ASSERT.equal( saved.Text, 'Draft one, saved.' );
	ASSERT.equal( saved.Plan.Revision, first.Revision + 1 );
	// Close all with two dirty tabs, the second one stale: Save saves the first, keeps the second with a toast
	await page.Evaluate( 'window.location.hash = "#/p/' + first.Id + '"; true' );
	await page.WaitFor( text_of( '.header .title' ) + ' === "Closing one"' );
	await page.Evaluate( DRAFT( first.Id, 'Draft one, again.', saved.Plan.Revision ) );
	await page.Evaluate( DRAFT( second.Id, 'Draft two.', second.Revision ) );
	await api( 'PUT', '/api/plans/' + second.Id + '/text', { Text: '# Closing two\n\nMoved on.\n', Revision: second.Revision } );
	await page.WaitFor( '( function () { let plan = angular.element( document.body ).injector().get( "State" ).Plans.find( function ( one ) { return one.Id === ' + JSON.stringify( second.Id ) + '; } ); return !!plan && plan.Revision === ' + ( second.Revision + 1 ) + '; } )()', 10000 );
	await menu_pick( tab_selector( first.Id ), 'Close all', '.tab-menu' );
	await page.WaitFor( FORM + ' === 1 && ' + count_of( '#close-popup .close-list li' ) + ' === 2' );
	ASSERT.equal( ( await page.Evaluate( text_of( '#close-popup .close-list' ) ) ).indexOf( 'stale' ) >= 0, true );
	await page.Click( '#close-save' );
	await page.WaitFor( count_of( tab_selector( first.Id ) ) + ' === 0 && ' + count_of( tab_selector( second.Id ) + ' .dirty-dot' ) + ' === 1 && ' + text_of( '#toast' ) + '.indexOf( "not saved" ) >= 0', 10000 );
	ASSERT.equal( ( await api( 'GET', '/api/plans/' + first.Id ) ).Text, 'Draft one, again.' );
	await page.Evaluate( CLOSE_X( second.Id ) );
	await page.WaitFor( FORM + ' === 1' );
	await page.Click( '#close-discard' );
	await page.WaitFor( count_of( tab_selector( second.Id ) ) + ' === 0' );
	// the setting, on by default, guards the browser\'s leave prompt; off, the page leaves without asking
	const LEAVE = '( function () { let event = new Event( "beforeunload", { cancelable: true } ); window.dispatchEvent( event ); return event.defaultPrevented; } )()';
	ASSERT.equal( await page.Evaluate( LEAVE ), false );
	await page.Evaluate( 'window.location.hash = "#/p/' + first.Id + '"; true' );
	await page.WaitFor( text_of( '.header .title' ) + ' === "Closing one"' );
	await page.Evaluate( DRAFT( first.Id, 'Dirty again.', saved.Plan.Revision + 1 ) );
	await page.WaitFor( count_of( tab_selector( first.Id ) + ' .dirty-dot' ) + ' === 1' );
	ASSERT.equal( await page.Evaluate( LEAVE ), true );
	await page.Click( '#look-button' );
	await page.WaitFor( count_of( '#look-popover #confirm-close' ) + ' === 1' );
	ASSERT.equal( await page.Evaluate( 'document.getElementById( "confirm-close" ).checked' ), true );
	await page.Click( '#confirm-close' );
	await page.WaitFor( 'window.localStorage.getItem( "consensus.confirm-close" ) === "false"' );
	ASSERT.equal( await page.Evaluate( LEAVE ), false );
	await page.Click( '#confirm-close' );
	await page.WaitFor( 'window.localStorage.getItem( "consensus.confirm-close" ) === "true"' );
	ASSERT.equal( await page.Evaluate( LEAVE ), true );
	await page.Press( 'Escape' );
	await page.WaitFor( count_of( '#look-popover' ) + ' === 0' );
	// left clean; the one console error is the refused save of the stale draft, which the test asked for
	await page.Evaluate( CLOSE_X( first.Id ) );
	await page.WaitFor( FORM + ' === 1' );
	await page.Click( '#close-discard' );
	await page.WaitFor( count_of( tab_selector( first.Id ) ) + ' === 0' );
	ASSERT.deepEqual( page.Errors.filter( function ( error ) { return !/409/.test( error ); } ), [] );
	page.Errors.length = 0;
} );


TEST( 'UI Tweaks VIII: the mark in the title bar; replies collapse earlier by default and a choice is kept; a selection to a line\'s end anchors that line; the active line is translucent and the editor shows the caret', async function ()
{
	// the mark before the brand
	ASSERT.equal( await page.Evaluate( count_of( 'title-bar .brand img.brand-mark' ) ), 1 );
	ASSERT.equal( await page.Evaluate( text_of( 'title-bar .brand' ) ), 'Consensus' );
	// a plan with a thread of three replies
	await set_editor( 'monaco' );
	let plan = await created( 'Tweaks eight' );
	await api( 'PUT', '/api/plans/' + plan.Id + '/text', { Text: '# Tweaks eight\n\nThe first paragraph of this plan.\n\n- one list item\n- another one\n\nA closing line.\n', Revision: plan.Revision } );
	let thread = ( await api( 'POST', '/api/plans/' + plan.Id + '/threads', { Text: 'First.', Anchor: { Text: 'closing line' } } ) ).Thread;
	await api( 'POST', '/api/plans/' + plan.Id + '/threads/' + thread.Id + '/replies', { Text: 'Second.' }, true );
	await api( 'POST', '/api/plans/' + plan.Id + '/threads/' + thread.Id + '/replies', { Text: 'Third.' } );
	await page.Evaluate( 'window.location.hash = "#/p/' + plan.Id + '"; true' );
	await page.WaitFor( text_of( '.header .title' ) + ' === "Tweaks eight"' );
	await show_all_threads();
	await page.WaitFor( count_of( '.thread:not(.compose) .reply' ) + ' === 3' );
	// by default the earlier replies are collapsed and the last one is open
	const COLLAPSED = '[ ...document.querySelectorAll( ".thread:not(.compose) .reply" ) ].map( function ( reply ) { return reply.classList.contains( "collapsed" ) ? 1 : 0; } ).join( "" )';
	const CONTROL = function ( label ) { return '[ ...document.querySelectorAll( ".thread:not(.compose) .reply-controls button" ) ].find( function ( button ) { return button.textContent.trim() === ' + JSON.stringify( label ) + '; } ).click(); true'; };
	await page.WaitFor( COLLAPSED + ' === "110"' );
	// the caret opens one and the choice stays; expand all opens every one; collapse earlier is the default again
	await page.Evaluate( 'document.querySelectorAll( ".thread:not(.compose) .reply-badge" )[ 0 ].click(); true' );
	await page.WaitFor( COLLAPSED + ' === "010"' );
	await page.Evaluate( CONTROL( 'expand all' ) );
	await page.WaitFor( COLLAPSED + ' === "000"' );
	await page.Evaluate( CONTROL( 'collapse earlier' ) );
	await page.WaitFor( COLLAPSED + ' === "110"' );
	// a reply arriving collapses the one that was last
	await api( 'POST', '/api/plans/' + plan.Id + '/threads/' + thread.Id + '/replies', { Text: 'Fourth.' }, true );
	await page.WaitFor( COLLAPSED + ' === "1110"' );
	// the Read view's selection as an anchor, at the points a drag or a triple-click leaves
	await page.WaitFor( text_of( '#read-view h1' ) + ' === "Tweaks eight"' );
	const ANCHOR = function ( setup )
	{
		return '( function () { let article = document.querySelector( "#read-view article" ); let p = article.querySelector( "p" ); let range = document.createRange(); ' + setup + ' let selection = window.getSelection(); selection.removeAllRanges(); selection.addRange( range ); let anchor = angular.element( document.body ).injector().get( "Render" ).SelectionAnchor( article ); selection.removeAllRanges(); return anchor ? anchor.Text : null; } )()';
	};
	// dragged past the line's end: the selection ends at offset 0 of the next block
	ASSERT.equal( await page.Evaluate( ANCHOR( 'range.setStart( p.firstChild, 0 ); range.setEnd( article.querySelector( "ul" ), 0 );' ) ), 'The first paragraph of this plan.' );
	// a triple-click: the block's own element points
	ASSERT.equal( await page.Evaluate( ANCHOR( 'let at = [ ...article.childNodes ].indexOf( p ); range.setStart( article, at ); range.setEnd( article, at + 1 );' ) ), 'The first paragraph of this plan.' );
	// the mirror case: a selection that starts after a block's last child
	ASSERT.equal( await page.Evaluate( ANCHOR( 'let li = article.querySelector( "li" ); range.setStart( p, p.childNodes.length ); range.setEnd( li.firstChild, li.firstChild.length );' ) ), 'one list item' );
	// within one text node, as before
	ASSERT.equal( await page.Evaluate( ANCHOR( 'range.setStart( p.firstChild, 4 ); range.setEnd( p.firstChild, 9 );' ) ), 'first' );
	// CodeMirror: the active line lets the selection show through, and the content shows the caret
	await set_editor( 'codemirror' );
	await page.WaitFor( count_of( '#editor .cm-editor' ) + ' === 1', 30000 );
	await page.Evaluate( 'document.querySelector( "#editor .cm-content" ).focus(); true' );
	await page.WaitFor( count_of( '#editor .cm-activeLine' ) + ' >= 1' );
	let active = await page.Evaluate( 'getComputedStyle( document.querySelector( "#editor .cm-activeLine" ) ).backgroundColor' );
	ASSERT.match( active, /\/\s*0\.\d+\s*\)|rgba\([^)]*,\s*0\.\d+\s*\)/, 'the active line is translucent: ' + active );
	ASSERT.equal( await page.Evaluate( 'getComputedStyle( document.querySelector( "#editor .cm-content" ) ).cursor' ), 'text' );
	// back to Monaco: Read and Edit are back and the Read view shows
	await set_editor( 'monaco' );
	await page.WaitFor( count_of( '#view-read' ) + ' === 1 && document.getElementById( "read-view" ).offsetParent !== null' );
	ASSERT.deepEqual( page.Errors, [] );
} );


TEST( 'Printing and Reporting: Report in a plan\'s row menu, the heading\'s button and Ctrl+P open the report page; it is the plan, its Subplans and threads as one page', async function ()
{
	let plan = await created( 'Reported plan' );
	let subplan = ( await api( 'POST', '/api/plans', { Title: 'Reported step', Text: '# Reported step\n\nA step.\n', Parent: plan.Id } ) ).Plan;
	await api( 'POST', '/api/plans/' + plan.Id + '/threads', { Text: 'On the line.', Anchor: { Text: 'A line.' } } );
	await page.Evaluate( 'window.location.hash = "#/p/' + plan.Id + '"; true' );
	await page.WaitFor( text_of( '.header .title' ) + ' === "Reported plan"' );
	// window.open is caught, so the page stays here and the URL is read
	await page.Evaluate( 'window.__opened = []; window.open = function ( url ) { window.__opened.push( url ); return null; }; true' );
	const OPENED = 'JSON.stringify( window.__opened )';
	// the heading's Actions menu (plan UI Tweaks IX)
	await menu_pick( '.header', 'Report', '#header-actions' );
	await page.WaitFor( OPENED + ' === ' + JSON.stringify( JSON.stringify( [ '/api/plans/' + plan.Id + '/report' ] ) ) );
	// Ctrl+P
	await page.Press( 'p', [ 'Control' ] );
	await page.WaitFor( 'window.__opened.length === 2' );
	// the row's menu
	await menu_pick( '.tree-item[data-id="' + plan.Id + '"]', 'Report' );
	await page.WaitFor( 'window.__opened.length === 3' );
	ASSERT.equal( await page.Evaluate( 'window.__opened[ 2 ]' ), '/api/plans/' + plan.Id + '/report' );
	// a document has no Actions menu (no threads, no Report, no Subplans)
	let readme = ( await api( 'GET', '/api/projects' ) ).Projects.find( function ( one ) { return one.Id === home; } ).Context.Id;
	await page.Evaluate( 'window.location.hash = "#/p/' + readme + '"; true' );
	await page.WaitFor( 'document.getElementById( "header-actions" ) === null || document.getElementById( "header-actions" ).offsetParent === null' );
	// the page itself
	let response = await fetch( running.Url + '/api/plans/' + plan.Id + '/report' );
	ASSERT.equal( response.status, 200 );
	let html = await response.text();
	ASSERT.ok( html.includes( '<title>Reported plan - Consensus report</title>' ) );
	ASSERT.ok( html.includes( '<mark class="anchor contested" data-numbers="1">A line.</mark>' ) );
	ASSERT.ok( html.includes( 'id="plan-' + subplan.Id + '"' ) );
	ASSERT.deepEqual( page.Errors, [] );
} );



TEST( 'the Work options (plan LLM Tasks, Step 3): the LLM page shows Git sync and Auto-commit when a task writes files, and a checkbox saves on the project', async function ()
{
	let llm = ( await api( 'POST', '/api/llms', { Name: 'worker', Kind: 'claude-cli', Command: process.execPath, Arguments: [ '-e', '' ], Timeout: 60 } ) ).Llm;
	await page.Evaluate( 'window.location.hash = "#/llm/' + llm.Id + '"; true' );
	await page.WaitFor( count_of( '#llm-git-row input[type=checkbox]' ) + ' === 2' );
	ASSERT.equal( await page.Evaluate( 'getComputedStyle( document.getElementById( "llm-git-row" ) ).display !== "none"' ), true );
	ASSERT.deepEqual( await page.Evaluate( '[ document.getElementById( "llm-git-sync" ).checked, document.getElementById( "llm-auto-commit" ).checked ]' ), [ false, false ] );
	await page.Click( '#llm-auto-commit' );
	await page.WaitFor( 'document.getElementById( "llm-auto-commit" ).checked && !document.getElementById( "llm-auto-commit" ).disabled' );
	let project = ( await api( 'GET', '/api/projects' ) ).Projects.find( function ( one ) { return one.Id === home; } );
	ASSERT.deepEqual( [ project.AutoCommit, project.GitSync ], [ true, undefined ] );
	await page.Click( '#llm-auto-commit' );
	await page.WaitFor( '!document.getElementById( "llm-auto-commit" ).checked && !document.getElementById( "llm-auto-commit" ).disabled' );
	project = ( await api( 'GET', '/api/projects' ) ).Projects.find( function ( one ) { return one.Id === home; } );
	ASSERT.equal( project.AutoCommit, undefined );
	await api( 'DELETE', '/api/llms/' + llm.Id );
	ASSERT.deepEqual( page.Errors, [] );
} );


TEST( 'Explain (plan LLM Tasks, Step 4): the project\'s menu opens its Explain tab with the question box, the project\'s connection and Ask; the Explain button on the LLM page opens it too', async function ()
{
	let llm = ( await api( 'POST', '/api/llms', { Name: 'explainer', Kind: 'claude-cli', Command: process.execPath, Arguments: [ '-e', '' ], Timeout: 60 } ) ).Llm;
	await api( 'PUT', '/api/projects/' + home, { Llm: llm.Id } );	// plan LLM Tasks, Step 6: the tab runs the project's connection
	await menu_pick( '.project[data-project="' + home + '"] .project-head', 'Explain' );
	await page.WaitFor( 'window.location.hash === "#/x/' + home + '"' );
	await page.WaitFor( 'getComputedStyle( document.getElementById( "explain-view" ) ).display !== "none"' );
	await page.WaitFor( 'document.getElementById( "explain-empty" ) !== null && getComputedStyle( document.getElementById( "explain-empty" ) ).display !== "none"' );
	ASSERT.match( await page.Evaluate( 'document.querySelector( ".tab[data-key=\\"x:' + home + '\\"]" ).textContent' ), /Explain · / );
	await page.WaitFor( 'document.getElementById( "explain-llm" ) !== null && document.getElementById( "explain-llm" ).textContent.includes( "explainer" )' );
	ASSERT.equal( await page.Evaluate( 'document.getElementById( "explain-ask" ).disabled' ), true );
	await page.Evaluate( '( function () { let box = document.getElementById( "explain-question" ); box.value = "What is this project?"; box.dispatchEvent( new Event( "input" ) ); return true; } )()' );
	await page.WaitFor( '!document.getElementById( "explain-ask" ).disabled' );
	ASSERT.equal( await page.Evaluate( 'getComputedStyle( document.getElementById( "explain-disabled" ) ).display' ), 'none' );
	// the LLM page's Explain button opens the tab instead of running
	await page.Evaluate( 'window.location.hash = "#/llm/' + llm.Id + '"; true' );
	await page.WaitFor( 'document.getElementById( "llm-run-explain" ) !== null && !document.getElementById( "llm-run-explain" ).disabled' );
	await page.Click( '#llm-run-explain' );
	await page.WaitFor( 'window.location.hash === "#/x/' + home + '"' );
	ASSERT.equal( ( await api( 'GET', '/api/runs?Task=explain' ) ).Runs.length, 0 );
	await api( 'PUT', '/api/projects/' + home, { Llm: null } );
	await api( 'DELETE', '/api/llms/' + llm.Id );
	ASSERT.deepEqual( page.Errors, [] );
} );


// A stand-in for an Enhance run (as test/Api.test.js has it): it reads the package from its standard input, takes the
// API address, the token, the plan id and the person's instructions from it, and posts a new text as the run.
const ENHANCE_STAND_IN = [
	"let t = '';",
	"process.stdin.on( 'data', function ( c ) { t += c; } );",
	"process.stdin.on( 'end', async function ()",
	"{",
	"\tlet api = /- Consensus API: (\\S+)/.exec( t )[ 1 ];",
	"\tlet token = /Bearer <token>\": ([0-9a-f]{48})/.exec( t )[ 1 ];",
	"\tlet plan = /The plan at hand: .* \\((pln-[^)]+)\\)/.exec( t )[ 1 ];",
	"\tlet asked = /## Your instructions\\n\\n([^\\n]+)/.exec( t )[ 1 ];",
	"\tlet headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };",
	"\tlet current = await ( await fetch( api + '/plans/' + plan, { headers: headers } ) ).json();",
	"\tlet text = '# Buttoned\\n\\n## Enhanced\\n\\nAs asked: ' + asked + '\\n';",
	"\tlet written = await ( await fetch( api + '/plans/' + plan + '/text', { method: 'PUT', headers: headers, body: JSON.stringify( { Text: text, Revision: current.Plan.Revision } ) } ) ).json();",
	"\tprocess.stdout.write( 'wrote revision ' + written.Plan.Revision );",
	"} );",
].join( '\n' );


TEST( 'the task buttons on the plan page (plan LLM Tasks, Step 6): on a plan\'s heading once the server has a connection, disabled until the project chooses its LLM connection in its settings; Enhance asks for the instructions in a popup and runs on that connection', async function ()
{
	let plan = ( await api( 'POST', '/api/plans', { Title: 'Buttoned', Text: '# Buttoned\n\nA sketch.\n', Project: home } ) ).Plan;
	await page.Evaluate( 'window.location.hash = "#/p/' + plan.Id + '"; true' );
	await page.WaitFor( 'document.getElementById( "revision" ) !== null && document.getElementById( "revision" ).textContent.trim() === "revision 1"' );
	// no connection on the server: no button
	ASSERT.equal( await page.Evaluate( '[ ...document.querySelectorAll( ".plan-task" ) ].filter( function ( button ) { return button.offsetParent !== null; } ).length' ), 0 );
	// a connection: the three plan-tasks appear, disabled with the reason
	let stand_in = PATH.join( FS.mkdtempSync( PATH.join( OS.tmpdir(), 'consensus-ui-' ) ), 'enhance.js' );
	FS.writeFileSync( stand_in, ENHANCE_STAND_IN );
	let llm = ( await api( 'POST', '/api/llms', { Name: 'planner', Kind: 'claude-cli', Command: process.execPath, Arguments: [ stand_in ], Timeout: 60 } ) ).Llm;
	await page.WaitFor( '[ ...document.querySelectorAll( ".plan-task" ) ].filter( function ( button ) { return button.offsetParent !== null; } ).length === 3' );
	ASSERT.deepEqual( await page.Evaluate( '[ ...document.querySelectorAll( ".plan-task" ) ].map( function ( button ) { return button.textContent.trim(); } )' ), [ 'Answer', 'Enhance', 'Work' ] );
	ASSERT.equal( await page.Evaluate( 'document.getElementById( "plan-task-enhance" ).disabled' ), true );
	ASSERT.match( await page.Evaluate( 'document.getElementById( "plan-task-enhance" ).title' ), /choose the project's LLM connection in its settings/ );
	// the project's settings choose it
	await menu_pick( '.project[data-project="' + home + '"] .project-head', 'Settings' );
	await page.WaitFor( 'document.getElementById( "project-llm" ) !== null && document.getElementById( "project-llm" ).options.length === 2' );
	await page.Evaluate( '( function () { let pick = document.getElementById( "project-llm" ); pick.selectedIndex = 1; pick.dispatchEvent( new Event( "change" ) ); return true; } )()' );
	await page.Click( '#project-settings-save' );
	await page.WaitFor( 'getComputedStyle( document.getElementById( "project-settings-saved" ) ).display !== "none"' );
	await page.Click( '#project-settings-close' );
	ASSERT.equal( ( await api( 'GET', '/api/projects' ) ).Projects.find( function ( one ) { return one.Id === home; } ).Llm, llm.Id );
	await page.WaitFor( '!document.getElementById( "plan-task-enhance" ).disabled' );
	ASSERT.match( await page.Evaluate( 'document.getElementById( "plan-task-enhance" ).title' ), /^Enhance on planner: package this plan and run it once/ );
	// Enhance: the popup, the instructions, the run; the plan reloads with the stand-in's revision
	await page.Click( '#plan-task-enhance' );
	await page.WaitFor( 'document.getElementById( "plan-task-box" ) !== null' );
	await page.Evaluate( '( function () { let box = document.getElementById( "plan-task-box" ); box.value = "Three sections, please."; box.dispatchEvent( new Event( "input" ) ); return true; } )()' );
	await page.Click( '#plan-task-run' );
	await page.WaitFor( 'document.getElementById( "plan-task-box" ) === null' );
	await page.WaitFor( 'document.getElementById( "revision" ).textContent.trim() === "revision 2"', 30000 );
	let runs = ( await api( 'GET', '/api/runs?Project=' + home + '&Task=enhance' ) ).Runs;
	ASSERT.equal( runs.length, 1 );
	let run = ( await api( 'GET', '/api/runs/' + runs[ 0 ].Id ) ).Run;
	ASSERT.deepEqual( [ run.Llm.Id, run.Text, ( run.Plan && run.Plan.Id ) || run.Plan ], [ llm.Id, 'Three sections, please.', plan.Id ] );
	await api( 'PUT', '/api/projects/' + home, { Llm: null } );
	await api( 'DELETE', '/api/llms/' + llm.Id );
	ASSERT.deepEqual( page.Errors, [] );
} );



// The editor's view, for a check of where it is.
const VIEW = 'window.CodeMirror6.EditorView.findFromDOM( document.querySelector( "#editor .cm-editor" ) )';


TEST( 'UI Tweaks IX: the margins setting, Resolve with a draft, the thread tools in the header, an anchor in a table, the tab keys and Ctrl+B in the editor, a tab\'s place, Escape and the × on a popup, Alt+W closes a tab, the Users folder last with its own icon, the tree width, the Actions menu', async function ()
{
	// the tree's default width (14)
	ASSERT.equal( await page.Evaluate( 'getComputedStyle( document.documentElement ).getPropertyValue( "--sidebar-width" ).trim()' ), '480px' );
	// the Users folder (13): last in the project, with the people icon
	ASSERT.equal( await page.Evaluate( 'document.querySelector( ".project[data-project=\\"' + home + '\\"] .project-body" ).lastElementChild.tagName === "ROLES-FOLDER"' ), true );
	ASSERT.equal( await page.Evaluate( count_of( '.project[data-project="' + home + '"] .roles-folder .users-head .icon-users' ) ), 1 );

	// a long plan with a table and an anchored thread in it; the editor is CodeMirror
	let lines = [ '# Tweaks nine', '', 'The first line makes a claim.', '', '| Head | Other |', '| --- | --- |', '| alpha cell | beta cell |', '' ];
	for ( let index = 1; index <= 60; index++ )
	{
		lines.push( 'Filler line number ' + index + ' of the long text.', '' );
	}
	lines.push( 'A closing line.', '' );
	let plan = ( await api( 'POST', '/api/plans', { Title: 'Tweaks nine', Text: lines.join( '\n' ), Project: home } ) ).Plan;
	let other = await created( 'Tweaks other' );
	let cell = ( await api( 'POST', '/api/plans/' + plan.Id + '/threads', { Text: 'In the table.', Anchor: { Text: 'alpha cell' } }, true ) ).Thread;
	let whole = ( await api( 'POST', '/api/plans/' + plan.Id + '/threads', { Text: 'On the whole.', Anchor: null }, true ) ).Thread;
	await page.Evaluate( 'window.location.hash = "#/p/' + plan.Id + '"; true' );
	await page.WaitFor( text_of( '.header .title' ) + ' === "Tweaks nine"' );
	await show_all_threads();
	await set_editor( 'codemirror' );
	await page.WaitFor( count_of( '#editor .cm-editor.cm-live' ) + ' === 1 && ' + count_of( '#editor .cm-live-table' ) + ' === 1', 30000 );

	// the margins (2): the look popover's select sets the page's attribute and the text's width
	const WIDTH = 'getComputedStyle( document.querySelector( "#editor .cm-content" ) ).maxWidth';
	await page.Click( '#look-button' );
	await page.WaitFor( count_of( '#look-popover #margins-select' ) + ' === 1' );
	ASSERT.equal( await page.Evaluate( 'document.getElementById( "margins-select" ).value' ), 'normal' );
	let normal = await page.Evaluate( WIDTH );
	for ( let name of [ 'narrow', 'wide', 'normal' ] )
	{
		await page.Evaluate( '( function () { let select = document.getElementById( "margins-select" ); select.value = ' + JSON.stringify( name ) + '; select.dispatchEvent( new Event( "change" ) ); return true; } )()' );
		await page.WaitFor( 'document.documentElement.dataset.margins === ' + JSON.stringify( name ) );
		if ( name === 'narrow' )
		{
			ASSERT.equal( await page.Evaluate( WIDTH ), 'none' );
		}
		if ( name === 'wide' )
		{
			ASSERT.ok( parseFloat( await page.Evaluate( WIDTH ) ) < parseFloat( normal ), 'wide margins hold the text narrower than normal' );
		}
	}
	ASSERT.equal( await page.Evaluate( 'window.localStorage.getItem( "consensus.margins" )' ), '"normal"' );
	await page.Click( '#look-button' );
	await page.WaitFor( count_of( '#look-popover' ) + ' === 0' );

	// the anchor in the table (5): marked in the Live Preview's table, a click on it selects the thread
	await page.WaitFor( count_of( '#editor .cm-live-table mark.anchor' ) + ' === 1 && document.querySelector( "#editor .cm-live-table mark.anchor" ).textContent === "alpha cell"', 10000 );
	// a mousedown on the mark, as the Live Preview test clicks the table: the widget's own listener hears it
	await page.Evaluate( 'document.querySelector( "#editor .cm-live-table mark.anchor" ).dispatchEvent( new MouseEvent( "mousedown", { bubbles: true, cancelable: true } ) ); true' );
	await page.WaitFor( count_of( '.thread.selected' ) + ' === 1 && document.querySelector( ".thread.selected" ).id === "thread-' + cell.Id + '"' );
	await page.WaitFor( 'document.querySelector( "#editor .cm-live-table mark.anchor" ).classList.contains( "selected" )' );
	ASSERT.equal( await page.Evaluate( count_of( '#editor .cm-live-table table' ) ), 1, 'the table is still the widget' );
	// the thread tools (4): Re-anchor and Start a new Subplan in the selected thread's header, not in the reply row
	await page.WaitFor( 'getComputedStyle( document.querySelector( ".thread.selected .thread-head .reanchor-button" ) ).display !== "none"' );
	ASSERT.equal( await page.Evaluate( count_of( '.thread.selected .thread-head .subplan-from-thread' ) + ' + ' + count_of( '.thread.selected .reply-form .reanchor-button' ) + ' + ' + count_of( '.thread.selected .reply-form .subplan-from-thread' ) ), 1 );

	// Resolve with a draft (3): the draft is the outcome
	await page.Click( '#thread-' + whole.Id );
	await page.WaitFor( count_of( '.thread.selected .resolve-button' ) + ' === 1 && document.querySelector( ".thread.selected" ).id === "thread-' + whole.Id + '"' );
	await page.Evaluate( draft_of( 'Agreed, as the outcome.' ) );
	await page.WaitFor( 'document.querySelector( ".thread.selected .resolve-button" ).title === "post your reply as the outcome and resolve the thread"' );
	await page.Click( '.thread.selected .resolve-button' );
	await page.WaitFor( text_of( '#thread-' + whole.Id + ' .state-badge' ) + ' === "resolved"' );
	let resolved = ( await api( 'GET', '/api/plans/' + plan.Id + '/threads' ) ).Threads.find( function ( thread ) { return thread.Id === whole.Id; } );
	ASSERT.equal( resolved.Replies[ resolved.Replies.length - 1 ].Text, 'Agreed, as the outcome.' );

	// the editor's keys (7, 8): Ctrl+Down scrolls with the cursor staying; Ctrl+B puts ** around the word and takes it off again
	await page.Evaluate( 'document.querySelector( "#editor .cm-content" ).focus(); true' );
	await page.Evaluate( VIEW + '.dispatch( { selection: { anchor: 0 } } ); ' + VIEW + '.scrollDOM.scrollTop = 0; true' );
	await page.Press( 'ArrowDown', [ 'Control' ] );
	await page.Press( 'ArrowDown', [ 'Control' ] );
	await page.WaitFor( VIEW + '.scrollDOM.scrollTop > 0' );
	ASSERT.equal( await page.Evaluate( VIEW + '.state.selection.main.anchor' ), 0 );
	let at = lines.join( '\n' ).indexOf( 'claim' );
	await page.Evaluate( VIEW + '.dispatch( { selection: { anchor: ' + at + ' } } ); true' );
	await page.Press( 'b', [ 'Control' ] );
	await page.WaitFor( VIEW + '.state.doc.toString().indexOf( "makes a **claim**." ) > 0' );
	await page.Press( 'b', [ 'Control' ] );
	await page.WaitFor( VIEW + '.state.doc.toString().indexOf( "makes a claim." ) > 0' );
	await page.Press( 'i', [ 'Control' ] );
	await page.WaitFor( VIEW + '.state.doc.toString().indexOf( "makes a _claim_." ) > 0' );
	await page.Press( 'i', [ 'Control' ] );
	await page.WaitFor( VIEW + '.state.doc.toString().indexOf( "makes a claim." ) > 0' );
	await page.WaitFor( 'document.getElementById( "save-button" ).disabled' );

	// a tab's place (9): scrolled and placed, left for another tab and shown again, the editor is where it was; the other tab starts at the top
	await page.Evaluate( VIEW + '.dispatch( { selection: { anchor: 40 } } ); ' + VIEW + '.scrollDOM.scrollTop = 150; true' );
	await page.WaitFor( VIEW + '.scrollDOM.scrollTop >= 140' );
	await page.Evaluate( 'window.location.hash = "#/p/' + other.Id + '"; true' );
	await page.WaitFor( text_of( '.header .title' ) + ' === "Tweaks other" && ' + VIEW + '.state.doc.toString().startsWith( "# Tweaks other" )' );
	ASSERT.equal( await page.Evaluate( VIEW + '.scrollDOM.scrollTop' ), 0 );
	// the tab keys in the editor (6): Alt+PgUp from the editor goes to the previous tab
	await page.Evaluate( 'document.querySelector( "#editor .cm-content" ).focus(); true' );
	await page.Press( 'PageUp', [ 'Alt' ] );
	await page.WaitFor( text_of( '.header .title' ) + ' === "Tweaks nine" && ' + VIEW + '.state.doc.toString().startsWith( "# Tweaks nine" )' );
	await page.WaitFor( VIEW + '.state.selection.main.anchor === 40', 5000 );
	await page.WaitFor( VIEW + '.scrollDOM.scrollTop >= 140', 5000 );

	// the Actions menu (15): New Comment from it, then cancelled
	await menu_pick( '.header', 'New Comment', '#header-actions' );
	await page.WaitFor( 'document.activeElement && document.activeElement.closest( "#compose-text" ) !== null' );
	await page.Evaluate( '[ ...document.querySelectorAll( ".thread.compose button" ) ].pop().click(); true' );
	await page.WaitFor( 'document.querySelector( ".thread.compose" ) === null' );
	ASSERT.equal( await page.Evaluate( count_of( '#new-comment' ) + ' + ' + count_of( '#report-button' ) + ' + ' + count_of( '#new-subplan' ) ), 0 );

	// Escape and the × (11): Settings closes on Escape with the focus outside it, and on its ×
	await menu_pick( '.root-head', 'Settings' );
	await page.WaitFor( 'document.getElementById( "settings-port" ) !== null', 20000 );
	await page.Evaluate( 'document.activeElement.blur(); document.body.focus(); true' );
	await page.Press( 'Escape' );
	await page.WaitFor( 'getComputedStyle( document.getElementById( "settings-popup" ) ).display === "none"' );
	await menu_pick( '.root-head', 'Settings' );
	await page.WaitFor( 'document.getElementById( "settings-port" ) !== null', 20000 );
	await page.Click( '#settings-popup .popup-close' );
	await page.WaitFor( 'getComputedStyle( document.getElementById( "settings-popup" ) ).display === "none"' );

	// Alt+W (12) closes the tab shown
	let before = await page.Evaluate( count_of( '.tab' ) );
	await page.Click( tab_selector( other.Id ) );
	await page.WaitFor( text_of( '.header .title' ) + ' === "Tweaks other"' );
	await page.Press( 'w', [ 'Alt' ] );
	await page.WaitFor( count_of( '.tab' ) + ' === ' + ( before - 1 ) + ' && ' + count_of( tab_selector( other.Id ) ) + ' === 0' );

	// the task buttons' row (16): the group's gap
	let gap = JSON.parse( await page.Evaluate( 'JSON.stringify( [ getComputedStyle( document.querySelector( ".header .task-buttons" ) ).gap, getComputedStyle( document.documentElement ).fontSize ] )' ) );
	ASSERT.ok( Math.abs( parseFloat( gap[ 0 ] ) - 0.75 * parseFloat( gap[ 1 ] ) ) < 0.1, 'the task buttons sit 0.75rem apart: ' + gap.join( ' at ' ) );
	await set_editor( 'monaco' );
	ASSERT.deepEqual( page.Errors, [] );
} );


TEST( 'users and roles (plan User Management, Step 3): the Users fold holds the owner, the owner\'s page mints a token shown once and revokes it, a project shows the four role folders and an account placed in Watchers, taken out with the ×', async function ()
{
	// the fold: the owner alone on a Local server; its row opens the owner's page
	await page.WaitFor( count_of( '#users-list .user-row' ) + ' === 1' );
	ASSERT.equal( await page.Evaluate( 'document.querySelector( "#users-list .user-row .plan-title" ).textContent.trim()' ), 'User' );
	await page.Evaluate( 'document.querySelector( "#users-list .user-row" ).click(); true' );
	await page.WaitFor( 'window.location.hash.startsWith( "#/u/" )' );
	await page.WaitFor( 'document.getElementById( "user-token-name" ) !== null && getComputedStyle( document.getElementById( "user-view" ) ).display !== "none"' );
	ASSERT.equal( await page.Evaluate( 'document.getElementById( "user-login" ).value' ), 'user' );
	ASSERT.equal( await page.Evaluate( 'document.getElementById( "user-login" ).readOnly' ), true );
	ASSERT.match( await page.Evaluate( 'document.querySelector( ".tab[data-key^=\\"u:\\"]" ).textContent' ), /User/ );
	// a token: made with a name, shown once, listed; the value is the owner
	await page.Evaluate( '( function () { let box = document.getElementById( "user-token-name" ); box.value = "laptop"; box.dispatchEvent( new Event( "input" ) ); return true; } )()' );
	await page.Click( '#user-token-create' );
	await page.WaitFor( 'document.getElementById( "user-token-shown" ) !== null' );
	let value = await page.Evaluate( 'document.querySelector( "#user-token-shown .user-token-value" ).textContent.trim()' );
	ASSERT.match( value, /^[0-9a-f]{48}$/ );
	await page.WaitFor( count_of( '.user-token' ) + ' === 1' );
	let as_token = await ( await fetch( running.Url + '/api/me', { headers: { Authorization: 'Bearer ' + value } } ) ).json();
	ASSERT.deepEqual( [ as_token.Me.Name, as_token.Me.Token, as_token.Admin ], [ 'user', 'laptop', true ] );
	await page.Click( '.user-token-revoke' );
	await page.Click( '.user-token-revoke-yes' );
	await page.WaitFor( count_of( '.user-token' ) + ' === 0' );
	ASSERT.equal( ( await fetch( running.Url + '/api/me', { headers: { Authorization: 'Bearer ' + value } } ) ).status, 401 );
	// an account made through the API appears in the fold; placed in Watchers through the API, the project's Users folder shows it
	let ann = ( await api( 'POST', '/api/users', { Type: 'user', Login: 'ann', Display: 'Ann', Email: 'ann@example.com' } ) ).User;
	await page.WaitFor( count_of( '#users-list .user-row' ) + ' === 2' );
	await api( 'PUT', '/api/projects/' + home + '/roles', { Watchers: [ ann.Id ] } );
	let roles = '.roles-folder[data-roles="' + home + '"]';
	await page.WaitFor( 'document.querySelector( ' + JSON.stringify( roles + ' > .folder-head .count' ) + ' ) !== null' );
	await page.WaitFor( 'document.querySelector( ' + JSON.stringify( roles + ' > .folder-head .count' ) + ' ).textContent.trim() === "1"' );
	await page.Evaluate( 'document.querySelector( ' + JSON.stringify( roles + ' > .folder-head' ) + ' ).click(); true' );
	await page.WaitFor( count_of( roles + ' .role-folder' ) + ' === 4' );
	await page.Evaluate( 'document.querySelector( ' + JSON.stringify( roles + ' .role-folder[data-role="Watchers"] > .folder-head' ) + ' ).click(); true' );
	await page.WaitFor( count_of( roles + ' .role-folder[data-role="Watchers"] .role-account' ) + ' === 1' );
	ASSERT.equal( await page.Evaluate( 'document.querySelector( ' + JSON.stringify( roles + ' .role-folder[data-role="Watchers"] .role-account .plan-title' ) + ' ).textContent.trim()' ), 'Ann' );
	await page.Click( roles + ' .role-folder[data-role="Watchers"] .role-remove' );
	await page.WaitFor( count_of( roles + ' .role-folder[data-role="Watchers"] .role-account' ) + ' === 0' );
	ASSERT.deepEqual( ( await api( 'GET', '/api/projects' ) ).Projects.find( function ( one ) { return one.Id === home; } ).Roles.Watchers, [] );
	await api( 'DELETE', '/api/users/' + ann.Id );
	await page.WaitFor( count_of( '#users-list .user-row' ) + ' === 1' );
	ASSERT.deepEqual( page.Errors, [] );
} );


TEST( 'Multiuser Step 2: the page says who may resolve, comment and resolve, and set the State, as the server does; the state line leads with what waits on you', async function ()
{
	let plan = await created( 'Many parties' );
	let asked = ( await api( 'POST', '/api/plans/' + plan.Id + '/threads', { Anchor: null, Text: 'The owner asks.' } ) ).Thread;
	await page.Evaluate( 'window.location.hash = "#/p/' + plan.Id + '"; true' );
	await page.WaitFor( text_of( '#read-view h1' ) + ' === "Many parties"' );
	// the thread waits on nobody yet (no LLM has spoken here), so the "mine" filter would hide it
	await show_all_threads();
	await page.WaitFor( count_of( '.thread:not(.compose)' ) + ' === 1' );
	await page.Evaluate( 'document.querySelector( ".thread:not(.compose)" ).click(); true' );
	await page.WaitFor( count_of( '.thread.selected' ) + ' === 1' );
	// the owner: an Owner of every project
	await page.WaitFor( '( function () { let e = document.querySelector( ".thread.selected .resolve-button" ); return !!e && getComputedStyle( e ).display !== "none"; } )()' );
	ASSERT.equal( await page.Evaluate( 'document.getElementById( "state-picker" ).disabled' ), false );
	ASSERT.equal( await page.Evaluate( text_of( '#state-line' ) ), '1 contested' );
	let me = await page.Evaluate( 'JSON.stringify( angular.element( document.body ).injector().get( "State" ).Root.Me )' );
	const AS = '( function ( me, role ) { let injector = angular.element( document.body ).injector(); let state = injector.get( "State" ); state.Root.Me = me; if ( role ) { state.Root.Roles[ state.Open.Project.Id ] = role; } else { delete state.Root.Roles[ state.Open.Project.Id ]; } injector.get( "$rootScope" ).$apply(); return true; } )';
	const RULES = 'JSON.stringify( ( function () { let threads = angular.element( document.body ).injector().get( "Threads" ); return [ threads.IsOwner(), threads.CanStartResolved(), threads.CanSetState(), threads.CanResolve( { Status: "contested", Replies: [ { By: "bob" } ] } ), threads.CanDelete() ]; } )() )';
	// as bob, a Member: the owner's thread is not his to resolve, his own is; the State is not his; Comment and resolve is
	await page.Evaluate( AS + '( { Name: "bob", Display: "Bob", Role: "user" }, "Members" )' );
	await page.WaitFor( '( function () { let e = document.querySelector( ".thread.selected .resolve-button" ); return !e || getComputedStyle( e ).display === "none"; } )()' );
	ASSERT.equal( await page.Evaluate( 'document.getElementById( "state-picker" ).disabled' ), true );
	ASSERT.match( await page.Evaluate( 'document.getElementById( "state-picker" ).title' ), /only an Owner/ );
	ASSERT.equal( await page.Evaluate( RULES ), '[false,true,false,true,false]' );
	// as ann, a Watcher: nothing
	await page.Evaluate( AS + '( { Name: "ann", Display: "Ann", Role: "user" }, "Watchers" )' );
	ASSERT.equal( await page.Evaluate( RULES ), '[false,false,false,false,false]' );
	// as olga, in the project's Owners folder: everything, as the owner
	await page.Evaluate( AS + '( { Name: "olga", Display: "Olga", Role: "user" }, "Owners" )' );
	ASSERT.equal( await page.Evaluate( RULES ), '[true,true,true,true,true]' );
	await page.WaitFor( '( function () { let e = document.querySelector( ".thread.selected .resolve-button" ); return !!e && getComputedStyle( e ).display !== "none"; } )()' );
	ASSERT.equal( await page.Evaluate( 'document.getElementById( "state-picker" ).disabled' ), false );
	// the owner again: the thread they resolve is off their list, counted as resolved
	await page.Evaluate( AS + '( ' + me + ', null )' );
	await api( 'POST', '/api/plans/' + plan.Id + '/threads/' + asked.Id + '/resolve' );
	await page.WaitFor( text_of( '#state-line' ) + ' === "1 resolved"' );
	ASSERT.deepEqual( page.Errors, [] );
} );


TEST( 'Clerk on a Local server (plan User Management, Step 4; plan Clerk, Step 5): the page asks its server, finds our instance with no sign-in required, loads nothing from Clerk, shows no sign-in box and no user button, and the owner\'s calls carry no token', async function ()
{
	let config = await api( 'GET', '/api/clerk' );
	ASSERT.deepEqual( [ config.On, config.Required, /^pk_/.test( config.PublishableKey ), typeof config.FrontendApi, typeof config.Pricing ], [ true, false, true, 'string', 'string' ] );
	await page.WaitFor( '( function () { let session = angular.element( document.body ).injector().get( "Session" ); return session.Loaded && session.On && !session.Required && !session.Asked; } )()' );
	ASSERT.equal( await page.Evaluate( 'typeof window.Clerk' ), 'undefined', 'ClerkJS is not loaded until asked' );
	ASSERT.equal( await page.Evaluate( count_of( '#sign-in-popup' ) ), 0 );
	ASSERT.equal( await page.Evaluate( count_of( '#user-button' ) ), 0 );
	ASSERT.equal( await page.Evaluate( 'angular.element( document.body ).injector().get( "Session" ).Token().then( function ( token ) { return token === null; } )' ), true );
	ASSERT.equal( await page.Evaluate( 'angular.element( document.body ).injector().get( "Session" ).Plan()' ), null );
	ASSERT.equal( await page.Evaluate( 'angular.element( document.body ).injector().get( "Session" ).Licensed( "Host" )' ), false );
	ASSERT.match( await page.Evaluate( text_of( '.root-head .me' ) ), /^you are User \(owner\)/ );
	ASSERT.deepEqual( page.Errors, [] );
} );


//---------------------------------------------------------------------
// The Host's page (plan Rearchitecturation, Step 5): the array of project views, the Mount switch

TEST( 'the Host\'s page (plan Rearchitecturation, Step 5): one project-view per registered project in the one sidebar, each collapsible; a new project is marked unmounted for the Administrator, Mount in its menu lifts the mark and Unmount brings it back', async function ()
{
	let before = ( await api( 'GET', '/api/projects' ) ).Projects.length;
	let made = ( await api( 'POST', '/api/projects', { Name: 'Mounting' } ) ).Project;
	ASSERT.equal( made.Mounted, false );
	let row = '.project[data-project="' + made.Id + '"]';
	await page.WaitFor( count_of( row ) + ' === 1' );
	// the array: one project view per project, none the single kind, each with its head
	ASSERT.equal( await page.Evaluate( count_of( 'project-view.project' ) ), before + 1 );
	ASSERT.equal( await page.Evaluate( count_of( '.project.single' ) ), 0 );
	ASSERT.equal( await page.Evaluate( count_of( 'project-view.project > .project-head' ) ), before + 1 );
	// the mark: the owner of a Local server is its Administrator
	ASSERT.equal( await page.Evaluate( text_of( row + ' .project-head .unmounted' ) ), 'unmounted' );
	await menu_pick( row + ' > .project-head', 'Mount' );
	await page.WaitFor( count_of( row + ' .project-head .unmounted' ) + ' === 0' );
	ASSERT.equal( ( await api( 'GET', '/api/projects' ) ).Projects.find( function ( one ) { return one.Id === made.Id; } ).Mounted, true );
	await menu_pick( row + ' > .project-head', 'Unmount' );
	await page.WaitFor( count_of( row + ' .project-head .unmounted' ) + ' === 1' );
	ASSERT.equal( ( await api( 'GET', '/api/projects' ) ).Projects.find( function ( one ) { return one.Id === made.Id; } ).Mounted, false );
	// collapsible: the head folds the project and opens it again
	await page.Click( row + ' > .project-head' );
	await page.WaitFor( count_of( row + '.open' ) + ' === 1' );
	await page.Click( row + ' > .project-head' );
	await page.WaitFor( count_of( row + '.open' ) + ' === 0' );
	ASSERT.deepEqual( page.Errors, [] );
} );
