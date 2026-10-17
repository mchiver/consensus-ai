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
		headers.Authorization = 'Bearer ' + LLM_TOKEN;
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
	running.Settings.Participants[ 1 ].Token = LLM_TOKEN;
	plan = ( await api( 'POST', '/api/plans', { Title: 'Browser check', Text: TEXT } ) ).Plan;
	browser = await CDP.StartBrowser();
	page = await browser.OpenPage( running.Url + '/#/p/' + plan.Id );
	// the page's Copy and Paste go through the system clipboard: the headless browser is granted it for this origin
	await page.Send( 'Browser.grantPermissions', { origin: running.Url, permissions: [ 'clipboardReadWrite', 'clipboardSanitizedWrite' ] } );
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
	await page.WaitFor( text_of( '#state-line' ) + ' === "1 contested, waiting on you 1"' );
	await page.WaitFor( text_of( '#waiting-link' ) + ' === "Waiting on you: 1"' );
	ASSERT.deepEqual( page.Errors, [] );
} );


TEST( 'the owner resolves from the page; the selection moves on; Reply and Contest on the resolved thread; a blank click or Escape deselects', async function ()
{
	await show_all_threads();
	await page.Click( '.thread:not(.compose)' );
	await page.WaitFor( count_of( '.thread.selected .resolve-button' ) + ' === 1' );
	ASSERT.equal( await page.Evaluate( text_of( '.thread.selected .reply-button' ) ), 'Reply' );
	await page.Click( '.thread.selected .resolve-button' );
	await page.WaitFor( text_of( '.thread:not(.compose) .state-badge' ) + ' === "resolved"' );
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


TEST( 'reply and resolve: one click posts the owner\'s answer and resolves the thread', async function ()
{
	// the only thread is applied; a reply reopens it, and Reply and resolve settles it again
	await show_all_threads();
	await page.WaitFor( count_of( '.thread:not(.compose)' ) + ' === 1' );
	await page.Click( '.thread:not(.compose)' );
	await page.WaitFor( count_of( '.thread.selected .reply-box' ) + ' === 1' );
	ASSERT.equal( await page.Evaluate( text_of( '.thread.selected .reply-button' ) ), 'Reply and Contest' );
	await page.Evaluate( draft_of( 'Reopened to ask again.' ) );
	await page.Click( '.thread.selected .reply-button' );
	await page.WaitFor( text_of( '.thread:not(.compose) .state-badge' ) + ' === "reopened"' );
	// the reply moved the selection on (to none: the only thread); picked again, Reply reads plainly, and Reply and resolve shows
	await page.WaitFor( count_of( '.thread.selected' ) + ' === 0' );
	await page.Click( '.thread:not(.compose)' );
	await page.WaitFor( text_of( '.thread.selected .reply-button' ) + ' === "Reply"' );
	await page.WaitFor( 'getComputedStyle( document.querySelector( ".thread.selected .reply-resolve-button" ) ).display !== "none"' );
	// the posted draft is cleared a moment after the reply lands, so the button is waited for, not read at once
	await page.WaitFor( 'document.querySelector( ".thread.selected .reply-resolve-button" ).disabled' );
	await page.Evaluate( draft_of( 'Keep one item.' ) );
	await page.WaitFor( '!document.querySelector( ".thread.selected .reply-resolve-button" ).disabled' );
	await page.Click( '.thread.selected .reply-resolve-button' );
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

	// from the header: an empty Subplan, opened
	await open_parent();
	await page.Click( '#new-subplan' );
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

	// New Comment starts a whole-document thread; Comment and resolve posts it resolved
	await show_all_threads();
	ASSERT.equal( await page.Evaluate( text_of( '#new-comment' ) ), 'New Comment' );
	await page.Click( '#new-comment' );
	await page.WaitFor( 'document.activeElement && document.activeElement.closest( "#compose-text" ) !== null' );
	await page.Type( 'Add a summary at the top.' );
	await page.WaitFor( '!document.getElementById( "compose-resolve" ).disabled' );
	await page.Click( '#compose-resolve' );
	await page.WaitFor( count_of( '.thread.selected' ) + ' === 1' );
	let threads = ( await api( 'GET', '/api/plans/' + plan.Id + '/threads' ) ).Threads;
	let posted = threads.find( function ( thread ) { return thread.Replies[ 0 ].Text === 'Add a summary at the top.'; } );
	ASSERT.equal( posted.Status, 'resolved' );
	ASSERT.equal( posted.Anchor, null );
	ASSERT.deepEqual( posted.Turn, [ 'llm' ] );

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
	ASSERT.deepEqual( await page.Evaluate( '[ ...document.querySelectorAll( "#popup-menu .menu-button" ) ].map( function ( entry ) { return entry.textContent.trim(); } )' ), [ 'New Subplan', 'New Comment', 'Copy', 'Rename', 'Export', 'Archive', 'Delete' ] );
	await page.Press( 'Escape' );
	await page.WaitFor( 'getComputedStyle( document.getElementById( "popup-menu" ) ).display === "none"' );

	// Delete from the menu asks on the row; Yes sends it to the trash and closes its tab
	await menu_pick( ROW, 'Delete' );
	await page.WaitFor( count_of( ROW + ' .confirm-delete-item' ) + ' === 1' );
	await page.Evaluate( 'document.querySelector( ' + JSON.stringify( ROW + ' .confirm-delete-item' ) + ' ).click(); true' );
	await page.WaitFor( count_of( ROW ) + ' === 0' );
	await page.WaitFor( count_of( tab_selector( doomed.Id ) ) + ' === 0' );
	ASSERT.equal( ( await fetch( running.Url + '/api/plans/' + doomed.Id ) ).status, 404 );
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
	await menu_pick( '', 'About', '#help-menu' );
	let me = await api( 'GET', '/api/me' );
	await page.WaitFor( text_of( '#about-version' ) + ' === "version ' + me.Version + '"' );
	ASSERT.equal( await page.Evaluate( 'document.getElementById( "about-source" ).href' ), 'https://github.com/mchiver/consensus-ai' );
	ASSERT.equal( await page.Evaluate( 'document.getElementById( "about-guide" ).href' ), 'http://consensus-ai.liquicode.com/' );
	ASSERT.equal( await page.Evaluate( text_of( '.help-server .view-heading' ) ), running.Settings.Name + ' version ' + me.Version );
	let rows = await page.Evaluate( '[ ...document.querySelectorAll( ".about-table tbody tr" ) ].filter( function ( row ) { return getComputedStyle( row ).display !== "none"; } ).map( function ( row ) { return [ ...row.children ].map( function ( cell ) { return cell.textContent.trim(); } ); } )' );
	ASSERT.ok( rows.length >= 2 );
	ASSERT.ok( rows.some( function ( row ) { return row[ 0 ] === 'Default'; } ) );
	ASSERT.ok( rows.every( function ( row ) { return row.length === 5 && row.slice( 1 ).every( function ( cell ) { return /^\d+$/.test( cell ); } ); } ) );
	await page.Press( 'Escape' );
	await page.WaitFor( count_of( '.help-form' ) + ' === 0' );
	await menu_pick( '', 'Hotkeys', '#help-menu' );
	await page.WaitFor( count_of( '.hotkeys-table tr' ) + ' === 12' );
	ASSERT.equal( await page.Evaluate( text_of( '.hotkeys-table tr:first-child kbd' ) ), 'Ctrl+E' );
	await page.Click( '#hotkeys-close' );
	await page.WaitFor( count_of( '.help-form' ) + ' === 0' );
	ASSERT.deepEqual( page.Errors, [] );
} );


TEST( 'LLM Instructions (plan UI Tweaks VII): a project row\'s menu shows the server\'s instructions with the project named first; Open links the page; Escape closes', async function ()
{
	await menu_pick( '.project.open > .project-head', 'LLM Instructions' );
	await page.WaitFor( '( document.getElementById( "instructions-text" ) || { value: "" } ).value.indexOf( "# This server" ) >= 0' );
	let text = await page.Evaluate( 'document.getElementById( "instructions-text" ).value' );
	ASSERT.match( text, /^# Your project\n\n- .+ \(prj-[^)]+\), its Readme (doc|ctx)-[^\n]+\n\n# This server\n/ );
	ASSERT.ok( text.indexOf( LLM_TOKEN ) >= 0 );
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
	ASSERT.equal( await page.Evaluate( count_of( '.settings-participant' ) ), 2 );
	ASSERT.equal( await page.Evaluate( '[ ...document.querySelectorAll( ".settings-participant .settings-token" ) ][ 1 ].value' ), LLM_TOKEN );
	// a participant with no role left: refused, the problem shown, nothing written
	await page.Click( '#settings-add-participant' );
	await page.WaitFor( count_of( '.settings-participant' ) + ' === 3' );
	await page.Click( '#settings-save' );
	await page.WaitFor( 'getComputedStyle( document.getElementById( "settings-problems" ) ).display !== "none"' );
	ASSERT.match( await page.Evaluate( text_of( '#settings-problems' ) ), /a participant has no Name/ );
	ASSERT.equal( ( await api( 'GET', '/api/settings' ) ).Settings.Participants.length, 2 );
	// the new participant removed, a state added: saved, and the picker offers it at once
	await page.Evaluate( '[ ...document.querySelectorAll( ".settings-participant .btn-outline-danger" ) ].pop().click(); true' );
	await page.WaitFor( count_of( '.settings-participant' ) + ' === 2' );
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
	await page.Evaluate( '( function () { localStorage.setItem( "consensus.other:1.folded", JSON.stringify( [ ' + JSON.stringify( context ) + ' ] ) ); let injector = angular.element( document.body ).injector(); let roots = injector.get( "Roots" ); roots.List.push( { Key: "other", Name: "Other", Url: "http://other:1", Kind: "server", Version: null, Base: "/servers/other", Me: null, Participants: [], States: [], Plans: [], Projects: [], Live: false, Error: "not reached", Loaded: true } ); angular.element( document.querySelector( "[ng-controller=SidebarController]" ) ).scope().Of( roots.List[ roots.List.length - 1 ] ); injector.get( "$rootScope" ).$apply(); return true; } )()' );
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
	// the setting, as the sidebar's select sets it
	await page.Evaluate( '( function () { let select = document.getElementById( "editor-select" ); select.value = "codemirror"; select.dispatchEvent( new Event( "change" ) ); return true; } )()' );
	ASSERT.equal( await page.Evaluate( 'window.localStorage.getItem( "consensus.editor" )' ), '"codemirror"' );
	await page.Click( '#view-edit' );
	await page.WaitFor( count_of( '#editor .cm-editor' ) + ' === 1 && ' + count_of( '#editor .monaco-editor' ) + ' === 0', 30000 );
	// the preview starts hidden with CodeMirror, and shows on the button
	ASSERT.equal( await page.Evaluate( 'document.querySelector( ".edit-body" ).classList.contains( "no-preview" )' ), true );
	await page.Click( '#preview-toggle' );
	await page.WaitFor( '!document.querySelector( ".edit-body" ).classList.contains( "no-preview" )' );
	// the two threads' passages are marked, by state; a click on one selects its thread, in the pane and in the text
	const MARKS = '[ ...document.querySelectorAll( "#editor .cm-content .anchor" ) ].map( function ( mark ) { return mark.textContent + ":" + mark.className.replace( "anchor ", "" ); } ).join( " " )';
	await page.WaitFor( MARKS + ' === "bold claim:contested another one:resolved"', 10000 );
	await click_first_line( '#editor .cm-content .anchor[data-threads="' + claim.Id + '"]' );
	await page.WaitFor( count_of( '.thread.selected' ) + ' === 1 && document.querySelector( ".thread.selected" ).id === "thread-' + claim.Id + '"' );
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
	await page.Click( '#view-read' );
	await page.WaitFor( count_of( '.thread.selected .reply-box .cm-editor' ) + ' === 1', 10000 );
	await page.Evaluate( 'document.querySelector( ".thread.selected .reply-box .cm-content" ).focus(); true' );
	await page.Type( 'From the CodeMirror box.' );
	await page.WaitFor( '!document.querySelector( ".thread.selected .reply-button" ).disabled' );
	await page.Press( 'Enter', [ 'Control' ] );
	await page.WaitFor( 'Array.from( document.querySelectorAll( "#thread-' + claim.Id + ' .reply-text" ) ).pop().textContent.trim() === "From the CodeMirror box."' );
	// back to Monaco: the next Edit opens it
	await page.Evaluate( '( function () { let select = document.getElementById( "editor-select" ); select.value = "monaco"; select.dispatchEvent( new Event( "change" ) ); return true; } )()' );
	await page.Click( '#view-edit' );
	await page.WaitFor( count_of( '#editor .monaco-editor' ) + ' === 1 && ' + count_of( '#editor .cm-editor' ) + ' === 0', 30000 );
	ASSERT.deepEqual( page.Errors, [] );
} );
