'use strict';

// The page in a real browser (test/support/Cdp.js drives the installed Chrome or Edge headless):
// the list loads, a selection becomes a thread, Send to LLM brings a reply live, resolve, edit and save, the state picker.
// The server runs on port 0 over a temporary folder; the LLM behind Send to LLM is played by fake_caller.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const FS = require( 'fs' );
const OS = require( 'os' );
const PATH = require( 'path' );
const SERVER = require( '../src/Server.js' );
const CDP = require( './support/Cdp.js' );
const MAKER = require( './support/ZipMaker.js' );
const PARTICIPANTS = require( '../src/Participants.js' );
const CONTEXT_SERVER = require( '../src/ContextServer.js' );

const CONTEXT_TOKEN = 'ui-context-token-0123456789';

const TEXT = '# Browser check\n\nThe first paragraph makes a claim about anchors.\n\n- one list item\n- another list item\n\nA closing paragraph.\n';

let running = null;
let browser = null;
let page = null;
let proposal = null;
let context = null;
let corpus_root = null;


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


function text_of( selector )
{
	return '( document.querySelector( ' + JSON.stringify( selector ) + ' ) || { textContent: "" } ).textContent.trim()';
}


// The LLM behind Send to LLM, played here: it replies to a contested thread and applies a resolved one.
function fake_caller()
{
	return async function ( Prompt )
	{
		let actions = [];
		let project = /Write the context of the project "([^"]+)"/.exec( Prompt );
		if ( project )
		{
			actions.push( { Kind: 'context', Text: '# ' + project[ 1 ] + '\n\nWritten by the LLM.\n', Reason: 'initialized' } );
		}
		let reply = /## Thread (t[0-9a-f]+), contested, WAITING ON YOU to reply/.exec( Prompt );
		if ( reply )
		{
			actions.push( { Thread: reply[ 1 ], Kind: 'reply', Reply: 'Outcome: one item stays.' } );
		}
		let apply = /## Thread (t[0-9a-f]+), resolved, WAITING ON YOU to apply/.exec( Prompt );
		if ( apply )
		{
			actions.push( { Thread: apply[ 1 ], Kind: 'apply', Outcome: 'one item stays' } );
		}
		return { Answer: { Actions: actions }, Usage: { Model: 'fake-model', Input: 1500, Output: 120 } };
	};
}


TEST.before( async function ()
{
	// A context server beside it, offering one corpus to link.
	corpus_root = FS.mkdtempSync( PATH.join( OS.tmpdir(), 'consensus-ui-corpus-' ) );
	FS.writeFileSync( PATH.join( corpus_root, 'field-notes.md' ), '# Field notes\n\nThe heron waits by the reeds.\n' );
	context = await CONTEXT_SERVER.Start( { Port: 0, Settings: { Token: CONTEXT_TOKEN, Items: [ { Kind: 'Corpus', Name: 'Notes', Root: corpus_root } ] } } );
	let data = FS.mkdtempSync( PATH.join( OS.tmpdir(), 'consensus-ui-' ) );
	let settings = PARTICIPANTS.DefaultSettings( 0 );
	settings.ContextServers = [ { Name: 'Desk', Url: context.Url, Token: CONTEXT_TOKEN } ];
	FS.writeFileSync( PATH.join( data, 'consensus.json' ), JSON.stringify( settings, null, '	' ) );
	running = await SERVER.Start( { Data: data, Port: 0, Caller: fake_caller } );
	let created = await fetch( running.Url + '/api/proposals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify( { Title: 'Browser check', Text: TEXT } ) } );
	proposal = ( await created.json() ).Proposal;
	browser = await CDP.StartBrowser();
	page = await browser.OpenPage( running.Url + '/#/p/' + proposal.Id );
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
	if ( context )
	{
		await context.Close();
		FS.rmSync( corpus_root, { recursive: true, force: true } );
	}
} );


//---------------------------------------------------------------------

TEST( 'the list and the proposal load, live', async function ()
{
	await page.WaitFor( count_of( '.proposal-item' ) + ' === 1', 20000 );
	ASSERT.equal( await page.Evaluate( text_of( '.proposal-item .proposal-title' ) ), 'Browser check' );
	await page.WaitFor( text_of( '#read-view h1' ) + ' === "Browser check"' );
	await page.WaitFor( text_of( '.connection' ) + ' === "live"' );
	ASSERT.equal( await page.Evaluate( text_of( '#state-line' ) ), 'no threads yet' );
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
	await page.WaitFor( 'document.activeElement && document.activeElement.id === "compose-text"' );
	await page.Type( 'Is one item enough?' );
	await page.Click( '#compose-post' );
	await page.WaitFor( count_of( '.thread:not(.compose)' ) + ' === 1' );
	ASSERT.equal( await page.Evaluate( text_of( '.thread:not(.compose) .thread-anchor' ) ), '“one list item”' );
	ASSERT.equal( await page.Evaluate( text_of( '.thread:not(.compose) .state-badge' ) ), 'contested');
	await page.WaitFor( count_of( '#read-view mark.anchor' ) + ' === 1' );
	ASSERT.equal( await page.Evaluate( text_of( '#read-view mark.anchor' ) ), 'one list item' );
	ASSERT.equal( await page.Evaluate( text_of( '#state-line' ) ), '1 contested' );
} );


// Send to LLM opens the plan's session panel; Send there runs the session with the panel's choices.
async function send_from_panel()
{
	if ( !await page.Evaluate( 'getComputedStyle( document.getElementById( "session-panel" ) ).display !== "none"' ) )
	{
		await page.Click( '#send-button' );
	}
	await page.WaitFor( 'getComputedStyle( document.getElementById( "session-panel" ) ).display !== "none"' );
	await page.WaitFor( '!document.getElementById( "session-send" ).disabled' );
	await page.Click( '#session-send' );
}


TEST( 'Send to LLM opens the session panel; its Send hands the LLM the thread, the reply arrives live, and the run log shows each step', async function ()
{
	await page.WaitFor( text_of( '#send-button' ) + ' === "Send to LLM (1)"' );
	await page.Click( '#send-button' );
	await page.WaitFor( 'getComputedStyle( document.getElementById( "session-panel" ) ).display !== "none"' );
	// the prompt's size, part by part, and its preview
	await page.WaitFor( '/\\d tokens/.test( ' + text_of( '#session-size' ) + ' )' );
	ASSERT.match( await page.Evaluate( text_of( '#session-size' ) ), /Rules \d+%/ );
	await page.Click( '#session-preview-toggle' );
	await page.WaitFor( '/# The rules/.test( ' + text_of( '#session-preview' ) + ' )' );
	await page.Click( '#session-preview-toggle' );
	// only the waiting threads: the size shrinks or stays, never grows
	let open_size = await page.Evaluate( 'parseInt( ' + text_of( '#session-size b' ) + '.replace( /\\D/g, "" ), 10 )' );
	await page.Evaluate( '( function () { let select = document.getElementById( "session-threads" ); select.value = "waiting"; select.dispatchEvent( new Event( "change" ) ); return true; } )()' );
	await page.WaitFor( 'parseInt( ' + text_of( '#session-size b' ) + '.replace( /\\D/g, "" ), 10 ) <= ' + open_size );
	await send_from_panel();
	await page.WaitFor( count_of( '.thread:not(.compose) .reply' ) + ' === 2' );
	ASSERT.equal( await page.Evaluate( 'Array.from( document.querySelectorAll( ".thread:not(.compose) .reply-text" ) ).pop().textContent.trim()' ), 'Outcome: one item stays.' );
	await page.WaitFor( text_of( '#state-line' ) + ' === "1 contested, waiting on you 1"' );
	await page.WaitFor( text_of( '#send-button' ) + ' === "Send to LLM (0)"' );
	await page.WaitFor( 'document.getElementById( "session-send" ).disabled' );
	await page.WaitFor( text_of( '#usage' ) + ' === "LLM today: 1.5k in · 120 out"' );
	await page.WaitFor( 'document.querySelector( ".run" ) && document.querySelector( ".run" ).querySelectorAll( ".run-step" ).length === 3' );
	let steps = await page.Evaluate( '[ ...document.querySelector( ".run" ).querySelectorAll( ".run-step .step-text" ) ].map( function ( step ) { return step.textContent.trim(); } )' );
	ASSERT.match( steps[ 0 ], /^Consensus sent the prompt to / );
	ASSERT.equal( steps[ 1 ], 'fake-model answered: 1 reply' );
	ASSERT.equal( steps[ 2 ], 'Consensus carried out 1 action, 0 refused' );
	await page.Click( '.session-head .btn-close' );
	await page.WaitFor( 'getComputedStyle( document.getElementById( "session-panel" ) ).display === "none"' );
	ASSERT.deepEqual( page.Errors, [] );
} );


TEST( 'the owner resolves from the page', async function ()
{
	await show_all_threads();
	await page.Click( '.thread:not(.compose)' );
	await page.WaitFor( count_of( '.thread.selected .resolve-button' ) + ' === 1' );
	await page.Click( '.thread.selected .resolve-button' );
	await page.WaitFor( text_of( '.thread:not(.compose) .state-badge' ) + ' === "resolved"' );
	await page.WaitFor( text_of( '#state-line' ) + ' === "1 resolved"' );
} );


TEST( 'edit and save make a revision and keep the highlight', async function ()
{
	await page.Click( '#view-edit' );
	await page.WaitFor( 'window.monaco && monaco.editor.getEditors().length === 1', 30000 );
	await page.Evaluate( 'monaco.editor.getEditors()[ 0 ].setValue( ' + JSON.stringify( TEXT.replace( 'A closing paragraph.', 'A closing paragraph, edited in the browser.' ) ) + ' )' );
	await page.WaitFor( '!document.getElementById( "save-button" ).disabled' );
	await page.WaitFor( '/edited in the browser/.test( ' + text_of( '#edit-preview' ) + ' )' );
	await page.Click( '#save-button' );
	await page.WaitFor( text_of( '#revision' ) + ' === "revision 2"' );
	await page.WaitFor( text_of( '#read-view p:last-child' ) + ' === "A closing paragraph, edited in the browser."' );
	ASSERT.equal( await page.Evaluate( count_of( '#read-view mark.anchor' ) ), 1 );
} );


TEST( 'once the LLM applies, the state picker makes the proposal Working and the sidebar follows', async function ()
{
	await page.WaitFor( text_of( '#send-button' ) + ' === "Send to LLM (1)"' );
	await send_from_panel();
	await page.WaitFor( text_of( '#state-line' ) + ' === "1 applied"' );
	await page.Click( '.session-head .btn-close' );
	ASSERT.equal( await page.Evaluate( 'document.getElementById( "state-picker" ).selectedOptions[ 0 ].label' ), 'Proposal' );
	await page.Evaluate( '( function () { let picker = document.getElementById( "state-picker" ); let option = Array.from( picker.options ).find( function ( candidate ) { return candidate.label === "Working"; } ); picker.value = option.value; picker.dispatchEvent( new Event( "change" ) ); return true; } )()' );
	await page.WaitFor( text_of( '.tree-item[data-id="' + proposal.Id + '"] .item-state' ) + ' === "Working"' );
	ASSERT.equal( await page.Evaluate( 'document.getElementById( "state-picker" ).selectedOptions[ 0 ].label' ), 'Working' );
	ASSERT.deepEqual( page.Errors, [] );
} );


TEST( 'a new project opens and closes the others; a folder and a plan are made in it', async function ()
{
	await page.WaitFor( count_of( '.project.open[data-project="default"]' ) + ' === 1' );
	await page.Click( '#new-project' );
	await page.WaitFor( 'document.activeElement && document.activeElement.id === "create-name"' );
	await page.Type( 'Browser project' );
	await page.Click( '#create-submit' );
	await page.WaitFor( count_of( '.project' ) + ' === 2' );
	await page.WaitFor( count_of( '.project.open' ) + ' === 1' );
	ASSERT.equal( await page.Evaluate( text_of( '.project.open .project-name' ) ), 'Browser project' );
	ASSERT.equal( await page.Evaluate( count_of( '.project[data-project="default"] .tree-item' ) ), 0 );
	// a folder, picked as where the plan goes
	await menu_pick( '.project.open > .project-head', 'New folder' );
	await page.WaitFor( 'document.activeElement && document.activeElement.id === "create-name"' );
	await page.Type( 'Specs' );
	await page.Click( '#create-submit' );
	await page.WaitFor( count_of( '.project.open .folder' ) + ' === 1' );
	await page.Click( '.project.open .folder-head' );
	await page.WaitFor( count_of( '.project.open .folder-head.target' ) + ' === 1' );
	await menu_pick( '.project.open > .project-head', 'New plan' );
	await page.WaitFor( 'document.activeElement && document.activeElement.id === "create-name"' );
	await page.Type( 'Plan in a folder' );
	await page.Click( '#create-submit' );
	await page.WaitFor( count_of( '.project.open .folder .tree-item' ) + ' === 1' );
	await page.WaitFor( text_of( '#read-view h1' ) + ' === "Plan in a folder"' );
	ASSERT.equal( await page.Evaluate( text_of( '.project.open .folder .tree-item .proposal-title' ) ), 'Plan in a folder' );
	// a document: no threads pane, no state picker, no comment button
	await menu_pick( '.project.open > .project-head', 'New document' );
	await page.WaitFor( 'document.activeElement && document.activeElement.id === "create-name"' );
	await page.Type( 'Reference notes' );
	await page.Click( '#create-submit' );
	await page.WaitFor( text_of( '#read-view h1' ) + ' === "Reference notes"' );
	await page.WaitFor( 'document.querySelector( ".layout" ).classList.contains( "no-threads" )' );
	ASSERT.equal( await page.Evaluate( 'getComputedStyle( document.querySelector( "aside.threads" ) ).display' ), 'none' );
	ASSERT.equal( await page.Evaluate( 'getComputedStyle( document.getElementById( "state-picker" ) ).display' ), 'none' );
	ASSERT.equal( await page.Evaluate( text_of( '#document-badge' ) ), 'Document' );
	await page.WaitFor( text_of( '.project.open .tree-item.document .item-state' ) + ' === "document"' );
	// opening Default again closes the new project
	await page.Click( '.project[data-project="default"] .project-head' );
	await page.WaitFor( count_of( '.project.open[data-project="default"]' ) + ' === 1' );
	ASSERT.equal( await page.Evaluate( count_of( '.project.open' ) ), 1 );
	ASSERT.deepEqual( page.Errors, [] );
} );


TEST( 'an item dragged onto a project moves there; copy and paste makes a whole copy', async function ()
{
	// open the new project again, then drag the document out of its folder onto the project's head: it moves to the root
	await page.Click( '.project:not([data-project="default"]) .project-head' );
	await page.WaitFor( count_of( '.project.open .tree-item.document' ) + ' === 1' );
	let moved = await page.Evaluate( '( function () {'
		+ ' let data = new DataTransfer();'
		+ ' let item = document.querySelector( ".project.open .tree-item.document" );'
		+ ' let head = document.querySelector( ".project.open .project-head" );'
		+ ' item.dispatchEvent( new DragEvent( "dragstart", { bubbles: true, dataTransfer: data } ) );'
		+ ' head.dispatchEvent( new DragEvent( "dragover", { bubbles: true, cancelable: true, dataTransfer: data } ) );'
		+ ' head.dispatchEvent( new DragEvent( "drop", { bubbles: true, cancelable: true, dataTransfer: data } ) );'
		+ ' return data.getData( "application/x-consensus-item" ); } )()' );
	ASSERT.match( moved, /^p[0-9a-f]{8}$/ );
	await page.WaitFor( count_of( '.project.open .project-body > .tree > .tree-node > .tree-item.document' ) + ' === 1' );
	ASSERT.equal( await page.Evaluate( count_of( '.project.open .folder .tree-item.document' ) ), 0 );

	// copy the plan in the folder, paste at the project's root
	await menu_pick( '.project.open .folder .tree-item', 'Copy' );
	await page.WaitFor( text_of( '#clipboard' ) + '.startsWith( "copied: Plan in a folder" )' );
	await menu_pick( '.project.open > .project-head', 'Paste' );
	await page.WaitFor( count_of( '.project.open .tree-item' ) + ' === 3' );
	await page.WaitFor( '[ ...document.querySelectorAll( ".project.open .proposal-title" ) ].some( function ( title ) { return title.textContent.trim() === "Plan in a folder (copy)"; } )' );
	ASSERT.deepEqual( page.Errors, [] );
} );


TEST( 'a zip uploaded into the project becomes a corpus: its files listed, one read, and found by search', async function ()
{
	let zip = MAKER.Make( [ { Name: 'notes/lighthouse.md', Data: '# Lighthouse\n\nThe keeper winds the clockwork lamp at dusk.\n' }, { Name: 'notes/photo.jpg', Data: 'jpeg\u0000bytes' } ] );
	await page.WaitFor( count_of( '.project.open .zip-input' ) + ' === 1' );
	await page.Evaluate( '( function () {'
		+ ' let bytes = Uint8Array.from( atob( ' + JSON.stringify( zip.toString( 'base64' ) ) + ' ), function ( character ) { return character.charCodeAt( 0 ); } );'
		+ ' let data = new DataTransfer();'
		+ ' data.items.add( new File( [ bytes ], "lighthouse.zip", { type: "application/zip" } ) );'
		+ ' let input = document.querySelector( ".project.open .zip-input" );'
		+ ' input.files = data.files;'
		+ ' input.dispatchEvent( new Event( "change" ) );'
		+ ' return true; } )()' );
	await page.WaitFor( text_of( '#corpus-summary' ) + '.startsWith( "2 files, 1 indexed" )' );
	ASSERT.equal( await page.Evaluate( text_of( '#corpus-name' ) ), '📦 lighthouse' );
	await page.WaitFor( count_of( '.project.open .tree-item.corpus.open' ) + ' === 1' );
	ASSERT.equal( await page.Evaluate( 'getComputedStyle( document.querySelector( "aside.threads" ) ).display' ), 'none' );
	await page.Click( '.corpus-file.indexed' );
	await page.WaitFor( '/clockwork lamp/.test( ' + text_of( '#corpus-file-text' ) + ' )' );
	ASSERT.match( await page.Evaluate( text_of( '.corpus-file:not(.indexed)' ) ), /binary \(holds a NUL byte\)/ );
	// search finds the file
	await page.Click( '#search-box' );
	await page.Type( 'clockwork keeper' );
	await page.Press( 'Enter' );
	await page.WaitFor( count_of( '.search-hit.file' ) + ' >= 1', 15000 );
	ASSERT.match( await page.Evaluate( text_of( '.search-hit.file .search-hit-head' ) ), /notes\/lighthouse\.md/ );
	await page.WaitFor( text_of( '#search-heading' ) + '.startsWith( "Search in Browser project" )' );
	// only this project's items: the thread in Default is not among the hits
	ASSERT.equal( await page.Evaluate( count_of( '.search-hit.thread' ) ), 0 );
	// a hit opens its corpus at the file
	await page.Click( '.search-hit.file' );
	await page.WaitFor( '/clockwork lamp/.test( ' + text_of( '#corpus-file-text' ) + ' )' );
	await page.Evaluate( 'document.getElementById( "search-box" ).value = ""; document.getElementById( "search-box" ).dispatchEvent( new Event( "input" ) ); true' );
	ASSERT.deepEqual( page.Errors, [] );
} );


TEST( 'search finds the thread and the theme switches', async function ()
{
	// the thread is in Default: open it, so the search box searches there
	await page.Click( '.project[data-project="default"] .project-head' );
	await page.WaitFor( count_of( '.project.open[data-project="default"]' ) + ' === 1' );
	await page.Click( '#search-box' );
	await page.Type( 'one item stays' );
	await page.Press( 'Enter' );
	await page.WaitFor( count_of( '.search-hit' ) + ' >= 1', 15000 );
	await page.WaitFor( 'document.querySelector( ".search-hit" ).classList.contains( "thread" )', 15000 );
	await page.Evaluate( 'window.ConsensusTheme.SetTheme( "dark" )' );
	ASSERT.equal( await page.Evaluate( 'document.documentElement.dataset.bsTheme' ), 'dark' );
	await page.Evaluate( 'window.ConsensusTheme.SetScale( "large" )' );
	ASSERT.equal( await page.Evaluate( 'document.documentElement.style.getPropertyValue( "--scale" )' ), '1.15' );
	ASSERT.deepEqual( page.Errors, [] );
} );


TEST( 'the threads and the preview hide and are remembered; a plan is renamed in its tree row', async function ()
{
	await page.Evaluate( 'window.location.hash = "#/p/' + proposal.Id + '"; true' );
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
	await page.WaitFor( 'window.monaco && monaco.editor.getEditors().length === 1', 30000 );
	await page.Click( '#preview-toggle' );
	await page.WaitFor( 'getComputedStyle( document.querySelector( ".edit-preview" ) ).display === "none"' );
	ASSERT.equal( await page.Evaluate( 'window.localStorage.getItem( "consensus.preview-hidden" )' ), 'true' );
	await page.Click( '#preview-toggle' );
	await page.WaitFor( 'getComputedStyle( document.querySelector( ".edit-preview" ) ).display !== "none"' );
	await page.Click( '#view-read' );
	// rename from the tree row: only the Title changes
	await menu_pick( '.tree-item[data-id="' + proposal.Id + '"]', 'Rename' );
	await page.WaitFor( 'document.activeElement && document.activeElement.closest( ".rename-form" ) !== null' );
	await page.Evaluate( '( function () { let input = document.activeElement; input.value = "Browser check, renamed"; input.dispatchEvent( new Event( "input" ) ); input.form.dispatchEvent( new Event( "submit", { cancelable: true } ) ); return true; } )()' );
	await page.WaitFor( text_of( '.tree-item[data-id="' + proposal.Id + '"] .proposal-title' ) + ' === "Browser check, renamed"' );
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
	await page.Evaluate( '( function () { let box = document.querySelector( ".thread.selected .reply-box" ); box.value = "Reopened to ask again."; box.dispatchEvent( new Event( "input" ) ); return true; } )()' );
	await page.Click( '.thread.selected .reply-button' );
	await page.WaitFor( text_of( '.thread:not(.compose) .state-badge' ) + ' === "reopened"' );
	await page.WaitFor( 'getComputedStyle( document.querySelector( ".thread.selected .reply-resolve-button" ) ).display !== "none"' );
	// the posted draft is cleared a moment after the reply lands, so the button is waited for, not read at once
	await page.WaitFor( 'document.querySelector( ".thread.selected .reply-resolve-button" ).disabled' );
	await page.Evaluate( '( function () { let box = document.querySelector( ".thread.selected .reply-box" ); box.value = "Keep one item."; box.dispatchEvent( new Event( "input" ) ); return true; } )()' );
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


TEST( 'an item dropped on the top edge of another goes just before it; a project dropped on another\'s head goes before it', async function ()
{
	await page.Click( '.project:not([data-project="default"]) .project-head' );
	await page.WaitFor( count_of( '.project.open .tree-item.corpus' ) + ' === 1' );
	function root_titles()
	{
		return '[ ...document.querySelectorAll( ".project.open .project-body > .tree > .tree-node" ) ].map( function ( node ) { let title = node.querySelector( ".proposal-title, .folder-name" ); return title ? title.textContent.trim() : ""; } ).join( "|" )';
	}
	ASSERT.notEqual( ( await page.Evaluate( root_titles() ) ).split( '|' )[ 0 ], 'lighthouse' );
	ASSERT.equal( await page.Evaluate( drag_to_top( '.project.open .tree-item.corpus', '.project.open .project-body > .tree > .tree-node:first-child .tree-row' ) ), true );
	await page.WaitFor( root_titles() + '.split( "|" )[ 0 ] === "lighthouse"' );
	// the project first, before Default
	ASSERT.equal( await page.Evaluate( '[ ...document.querySelectorAll( ".project" ) ].map( function ( project ) { return project.dataset.project; } )[ 0 ]' ), 'default' );
	ASSERT.equal( await page.Evaluate( drag_to_top( '.project:not([data-project="default"]) .project-head', '.project[data-project="default"] .project-head' ) ), true );
	await page.WaitFor( 'document.querySelector( ".project" ).dataset.project !== "default"' );
	ASSERT.deepEqual( page.Errors, [] );
} );


TEST( 'a project\'s context is pinned above its tree; Initialize context has the LLM write it', async function ()
{
	await page.WaitFor( count_of( '.project.open .context-item' ) + ' === 1' );
	ASSERT.equal( await page.Evaluate( text_of( '.project.open .context-item .item-state' ) ), 'empty' );
	ASSERT.equal( await page.Evaluate( '!!document.querySelector( ".project.open .context-item" ).getAttribute( "draggable" )' ), false );
	await page.Click( '.project.open .context-item' );
	await page.WaitFor( text_of( '.header .title' ) + ' === "Context of Browser project"' );
	await page.WaitFor( 'document.querySelector( ".layout" ).classList.contains( "no-threads" )' );
	ASSERT.equal( await page.Evaluate( text_of( '#document-badge' ) ), 'Context' );
	ASSERT.equal( await page.Evaluate( 'getComputedStyle( document.getElementById( "send-button" ) ).display' ), 'none' );
	ASSERT.equal( await page.Evaluate( 'getComputedStyle( document.getElementById( "state-picker" ) ).display' ), 'none' );
	await page.Click( '#initialize-context' );
	await page.WaitFor( text_of( '#read-view p' ) + ' === "Written by the LLM."', 15000 );
	await page.WaitFor( text_of( '#revision' ) + ' === "revision 2"' );
	await page.WaitFor( 'getComputedStyle( document.querySelector( ".project.open .context-item .item-state" ) ).display === "none"' );
	await page.Click( '#view-revisions' );
	await page.WaitFor( '[ ...document.querySelectorAll( ".revision-note" ) ].some( function ( note ) { return note.textContent.trim() === "initialized"; } )' );
	await page.Click( '#view-read' );
	ASSERT.deepEqual( page.Errors, [] );
} );


//---------------------------------------------------------------------
// Tabs

let tab_one = null;
let tab_two = null;


async function created( title )
{
	let response = await fetch( running.Url + '/api/proposals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify( { Title: title, Text: '# ' + title + '\n\nA line.\n' } ) } );
	return ( await response.json() ).Proposal;
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
	// the editor from an earlier test is reused: wait until it holds this proposal's text
	await page.WaitFor( 'window.monaco && monaco.editor.getEditors().length === 1 && monaco.editor.getEditors()[ 0 ].getValue() === "# Tab one\\n\\nA line.\\n"', 30000 );
	await page.Evaluate( 'monaco.editor.getEditors()[ 0 ].setValue( "# Tab one\\n\\nA line, not saved yet.\\n" ); true' );
	await page.WaitFor( '!document.getElementById( "save-button" ).disabled' );
	await new Promise( function ( resolve ) { setTimeout( resolve, 400 ); } );
	await page.Click( tab_selector( tab_two.Id ) );
	await page.WaitFor( text_of( '.header .title' ) + ' === "Tab two"' );
	await page.WaitFor( 'document.getElementById( "view-read" ).classList.contains( "btn-secondary" )' );
	await page.Click( tab_selector( tab_one.Id ) );
	await page.WaitFor( 'document.getElementById( "view-edit" ).classList.contains( "btn-secondary" )' );
	await page.WaitFor( 'monaco.editor.getEditors()[ 0 ].getValue() === "# Tab one\\n\\nA line, not saved yet.\\n"' );
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


TEST( 'session: Manual copy / paste makes the prompt, and a pasted answer is carried out and logged', async function ()
{
	let posted = await fetch( running.Url + '/api/proposals/' + tab_one.Id + '/threads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify( { Text: 'Is one line enough?' } ) } );
	let thread = ( await posted.json() ).Thread;
	await page.Evaluate( 'window.location.hash = "#/p/' + tab_one.Id + '"; true' );
	await page.WaitFor( text_of( '.header .title' ) + ' === "Tab one"' );
	await page.WaitFor( text_of( '#send-button' ) + ' === "Send to LLM (1)"' );
	await page.Click( '#send-button' );
	await page.WaitFor( 'getComputedStyle( document.getElementById( "session-panel" ) ).display !== "none"' );
	await page.Evaluate( '( function () { let select = document.getElementById( "session-destination" ); select.value = "Manual"; select.dispatchEvent( new Event( "change" ) ); return true; } )()' );
	await page.WaitFor( 'getComputedStyle( document.getElementById( "session-copy" ) ).display !== "none"' );
	await page.Click( '#session-copy' );
	// the prompt is made, on the clipboard or shown to copy by hand
	await page.WaitFor( 'getComputedStyle( document.getElementById( "session-answer" ) ).display !== "none" && document.getElementById( "session-answer" ).offsetParent !== null' );
	let answer = JSON.stringify( { Actions: [ { Thread: thread.Id, Kind: 'reply', Reply: 'One line is enough.' } ] } );
	await page.Evaluate( '( function () { let box = document.getElementById( "session-answer" ); box.value = ' + JSON.stringify( answer ) + '; box.dispatchEvent( new Event( "input" ) ); return true; } )()' );
	await page.WaitFor( '!document.getElementById( "session-carry-out" ).disabled' );
	await page.Click( '#session-carry-out' );
	await page.WaitFor( text_of( '#session-result' ) + ' === "Carried out 1 actions, 0 refused."' );
	await page.WaitFor( 'Array.from( document.querySelectorAll( ".thread:not(.compose) .reply-text" ) ).some( function ( reply ) { return reply.textContent.trim() === "One line is enough."; } )' );
	await page.WaitFor( 'document.querySelector( ".run" ) && /^Manual/.test( document.querySelector( ".run .run-head" ).textContent.trim() )' );
	let steps = await page.Evaluate( '[ ...document.querySelector( ".run" ).querySelectorAll( ".run-step .step-text" ) ].map( function ( step ) { return step.textContent.trim(); } )' );
	ASSERT.deepEqual( steps, [ 'Consensus made the prompt for copying', 'The answer was pasted: 1 reply', 'Consensus carried out 1 action, 0 refused' ] );
	ASSERT.deepEqual( page.Errors, [] );
} );


TEST( 'session: a pasted answer that asks for more is answered, and Continue gives the next prompt', async function ()
{
	let posted = await fetch( running.Url + '/api/proposals/' + tab_one.Id + '/threads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify( { Text: 'What does Tab two say?' } ) } );
	let thread = ( await posted.json() ).Thread;
	await page.WaitFor( text_of( '#send-button' ) + ' === "Send to LLM (1)"' );
	await page.WaitFor( 'getComputedStyle( document.getElementById( "session-copy" ) ).display !== "none"' );
	await page.Click( '#session-copy' );
	await page.WaitFor( text_of( '#session-turn' ) + ' === "Answer 1 of 5"' );
	function paste( answer )
	{
		return '( function () { let box = document.getElementById( "session-answer" ); box.value = ' + JSON.stringify( JSON.stringify( answer ) ) + '; box.dispatchEvent( new Event( "input" ) ); return true; } )()';
	}
	await page.Evaluate( paste( { Actions: [], Requests: [ { Tool: 'read_plan', Plan: 'Tab two' } ] } ) );
	await page.WaitFor( '!document.getElementById( "session-carry-out" ).disabled' );
	await page.Click( '#session-carry-out' );
	await page.WaitFor( 'document.getElementById( "session-continue" ).offsetParent !== null' );
	await page.WaitFor( '[ ...document.querySelector( ".run" ).querySelectorAll( ".run-step .step-text" ) ].some( function ( step ) { return step.textContent.trim() === "Consensus answered read_plan \\"Tab two\\""; } )' );
	await page.Click( '#session-continue' );
	await page.WaitFor( text_of( '#session-turn' ) + ' === "Answer 2 of 5"' );
	await page.Evaluate( paste( { Actions: [ { Thread: thread.Id, Kind: 'reply', Reply: 'Tab two has one line.' } ] } ) );
	await page.WaitFor( '!document.getElementById( "session-carry-out" ).disabled' );
	await page.Click( '#session-carry-out' );
	await page.WaitFor( text_of( '#session-result' ) + ' === "Carried out 1 actions, 0 refused."' );
	await page.WaitFor( 'Array.from( document.querySelectorAll( ".thread:not(.compose) .reply-text" ) ).some( function ( reply ) { return reply.textContent.trim() === "Tab two has one line."; } )' );
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
		return ( await ( await fetch( running.Url + '/api/proposals/' + id ) ).json() ).Threads;
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
	await page.WaitFor( 'document.activeElement && document.activeElement.id === "compose-text"' );
	await page.Type( 'This needs its own plan.' );
	await page.Click( '#compose-subplan' );
	await name_it( 'From a new thread' );
	let threads = await threads_of( parent.Id );
	ASSERT.equal( threads.length, 1 );
	ASSERT.match( threads[ 0 ].Replies[ 0 ].Text, /^This needs its own plan\.\n\nStarted a new Subplan: \[From a new thread\]\(#\/p\/p[0-9a-f]{8}\)$/ );

	// from a reply: the draft goes in with the link, and the thread stays open
	await open_parent();
	await show_all_threads();
	await page.Click( '.thread:not(.compose)' );
	await page.WaitFor( count_of( '.thread.selected .reply-box' ) + ' === 1' );
	await page.Evaluate( '( function () { let box = document.querySelector( ".thread.selected .reply-box" ); box.value = "Or split it further."; box.dispatchEvent( new Event( "input" ) ); return true; } )()' );
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

TEST( 'context server: + link lists what it offers; the linked corpus opens, its file reads, and search finds it', async function ()
{
	await page.Evaluate( 'window.location.hash = "#/p/' + proposal.Id + '"; true' );
	await menu_pick( '.project.open > .project-head', 'Link a corpus' );
	await page.WaitFor( 'document.getElementById( "link-choice" ) && document.getElementById( "link-choice" ).selectedOptions.length === 1 && document.getElementById( "link-choice" ).selectedOptions[ 0 ].textContent !== ""' );
	ASSERT.match( await page.Evaluate( 'document.getElementById( "link-choice" ).selectedOptions[ 0 ].textContent' ), /^Desk \/ Notes \(1 files\)$/ );
	await page.Click( '#link-submit' );
	await page.WaitFor( text_of( '#corpus-link' ) + ' === "· linked from Desk / Notes"', 20000 );
	await page.WaitFor( count_of( '.corpus-file.indexed' ) + ' === 1' );
	ASSERT.equal( await page.Evaluate( 'getComputedStyle( document.querySelector( ".corpus-buttons label" ) ).display' ), 'none' );
	await page.Click( '.corpus-file.indexed' );
	await page.WaitFor( text_of( '#corpus-file-text' ) + '.includes( "heron" )' );
	await page.WaitFor( count_of( '.project.open .tree-item.corpus .badge.linked' ) + ' === 1' );
	let hits = await ( await fetch( running.Url + '/api/search?q=heron&project=default' ) ).json();
	ASSERT.equal( hits.Hits[ 0 ].Path, 'field-notes.md' );
	ASSERT.deepEqual( page.Errors, [] );
} );


TEST( 'a corpus\'s Include and Exclude are edited in its view; the tree marks it attached', async function ()
{
	let zip = MAKER.Make( [ { Name: 'kit/guide.md', Data: '# Guide\n\nThe lantern is trimmed.\n' }, { Name: 'kit/build.log', Data: 'noise' } ] );
	let made = await fetch( running.Url + '/api/projects/default/corpus?name=kit.zip', { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: zip } );
	let corpus = ( await made.json() ).Corpus;
	await page.Evaluate( 'window.location.hash = "#/c/' + corpus.Id + '"; true' );
	await page.WaitFor( text_of( '#corpus-summary' ) + '.startsWith( "2 files, 2 indexed" )', 20000 );
	ASSERT.match( await page.Evaluate( text_of( '#corpus-attached' ) ), /attached/ );
	await page.WaitFor( count_of( '.tree-item[data-id="' + corpus.Id + '"] .badge.attached' ) + ' === 1' );
	ASSERT.equal( await page.Evaluate( 'document.getElementById( "corpus-filter-save" ).disabled' ), true );
	await page.Evaluate( '( function () { let box = document.getElementById( "corpus-exclude" ); box.value = "*.log"; box.dispatchEvent( new Event( "input" ) ); return true; } )()' );
	await page.WaitFor( '!document.getElementById( "corpus-filter-save" ).disabled' );
	await page.Click( '#corpus-filter-save' );
	await page.WaitFor( text_of( '#corpus-summary' ) + '.startsWith( "2 files, 1 indexed" )' );
	ASSERT.match( await page.Evaluate( text_of( '.corpus-file:not(.indexed)' ) ), /left out by Exclude/ );
	await page.WaitFor( 'document.getElementById( "corpus-filter-save" ).disabled' );
	let saved = await ( await fetch( running.Url + '/api/corpus/' + corpus.Id ) ).json();
	ASSERT.deepEqual( saved.Corpus.Exclude, [ '*.log' ] );
	ASSERT.deepEqual( page.Errors, [] );
} );


TEST( 'the tree: it hides and shows; it sorts by name, created and updated; it shows each item\'s last update', async function ()
{
	async function post( path, body )
	{
		let response = await fetch( running.Url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify( body ) } );
		return response.json();
	}
	async function sort_by( value )
	{
		await page.Evaluate( '( function () { let select = document.getElementById( "tree-sort" ); select.value = "' + value + '"; select.dispatchEvent( new Event( "change" ) ); return true; } )()' );
	}
	const TITLES = '[ ...document.querySelectorAll( ".project.open .tree-item:not(.context-item) .proposal-title" ) ].map( function ( title ) { return title.textContent.trim(); } ).join( "," )';

	let project = ( await post( '/api/projects', { Name: 'Sorting' } ) ).Project;
	let beta = ( await post( '/api/proposals', { Title: 'Beta', Text: '# Beta\n', Project: project.Id } ) ).Proposal;
	await new Promise( function ( resolve ) { setTimeout( resolve, 20 ); } );
	let alpha = ( await post( '/api/proposals', { Title: 'Alpha', Text: '# Alpha\n', Project: project.Id } ) ).Proposal;
	await new Promise( function ( resolve ) { setTimeout( resolve, 20 ); } );
	await post( '/api/proposals/' + beta.Id + '/threads', { Text: 'A question for the LLM.' } );

	await page.Evaluate( 'window.location.hash = "#/p/' + alpha.Id + '"; true' );
	await page.WaitFor( TITLES + ' === "Beta,Alpha"' );
	await sort_by( 'name' );
	await page.WaitFor( TITLES + ' === "Alpha,Beta"' );
	ASSERT.equal( await page.Evaluate( count_of( '.project.open .tree-date' ) ), 0 );
	await sort_by( 'created' );
	await page.WaitFor( TITLES + ' === "Beta,Alpha"' );
	let dates = await page.Evaluate( '[ ...document.querySelectorAll( ".project.open .tree-date" ) ].map( function ( date ) { return date.textContent.trim(); } )' );
	ASSERT.equal( dates.length, 2 );
	ASSERT.ok( dates.every( function ( date ) { return /^\d{4}-\d{2}-\d{2}$/.test( date ); } ) );
	await sort_by( 'updated' );
	await page.WaitFor( TITLES + ' === "Alpha,Beta"' );
	await sort_by( 'none' );
	await page.WaitFor( TITLES + ' === "Beta,Alpha"' );

	// the last update on each row, and on the project's heading
	ASSERT.equal( await page.Evaluate( count_of( '.project.open .tree-stamp' ) ), 0 );
	await page.Click( '#show-updated' );
	await page.WaitFor( count_of( '.project.open .tree-item .tree-stamp' ) + ' === 2' );
	ASSERT.equal( await page.Evaluate( count_of( '.project.open > .project-head .tree-stamp' ) ), 1 );
	await page.Click( '#show-updated' );
	await page.WaitFor( count_of( '.project.open .tree-stamp' ) + ' === 0' );

	// the tree hides and comes back, remembered
	await page.Click( '#tree-toggle' );
	await page.WaitFor( 'getComputedStyle( document.querySelector( ".sidebar" ) ).display === "none"' );
	ASSERT.equal( await page.Evaluate( 'window.localStorage.getItem( "consensus.tree-hidden" )' ), 'true' );
	await page.Click( '#tree-toggle' );
	await page.WaitFor( 'getComputedStyle( document.querySelector( ".sidebar" ) ).display !== "none"' );

	// the threads filter: a new tab starts at Waiting on me, and each tab keeps its own
	const FILTER = 'document.getElementById( "thread-filter" ).selectedOptions[ 0 ].textContent.trim()';
	await page.Evaluate( 'window.location.hash = "#/p/' + beta.Id + '"; true' );
	await page.WaitFor( text_of( '.header .title' ) + ' === "Beta"' );
	await page.WaitFor( FILTER + ' === "Waiting on me"' );
	ASSERT.equal( await page.Evaluate( count_of( '.thread:not(.compose)' ) ), 0 );
	await show_all_threads();
	await page.WaitFor( count_of( '.thread:not(.compose)' ) + ' === 1' );
	// a selected thread the filter leaves out is deselected
	await page.Click( '.thread:not(.compose)' );
	await page.WaitFor( count_of( '.thread.selected' ) + ' === 1' );
	await page.Evaluate( '( function () { let injector = angular.element( document.body ).injector(); injector.get( "State" ).Filter = "mine"; injector.get( "$rootScope" ).$apply(); return true; } )()' );
	await page.WaitFor( count_of( '.thread:not(.compose)' ) + ' === 0' );
	await page.WaitFor( 'angular.element( document.body ).injector().get( "State" ).Selected === null' );
	await show_all_threads();
	await page.WaitFor( count_of( '.thread:not(.compose)' ) + ' === 1' );
	ASSERT.equal( await page.Evaluate( count_of( '.thread.selected' ) ), 0 );
	await page.Click( tab_selector( alpha.Id ) );
	await page.WaitFor( text_of( '.header .title' ) + ' === "Alpha"' );
	ASSERT.equal( await page.Evaluate( FILTER ), 'Waiting on me' );
	await page.Click( tab_selector( beta.Id ) );
	await page.WaitFor( FILTER + ' === "All threads"' );
	ASSERT.deepEqual( page.Errors, [] );
} );


TEST( 'threads: New Comment with Comment and resolve; Re-anchor on a whole-document thread; highlight all or open', async function ()
{
	async function post( path, body )
	{
		let response = await fetch( running.Url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify( body ) } );
		return response.json();
	}
	const MARKED = '[ ...document.querySelectorAll( "#read-view mark.anchor" ) ].map( function ( mark ) { return mark.dataset.threads; } ).join( " " )';

	let plan = await created( 'Highlights' );
	await fetch( running.Url + '/api/proposals/' + plan.Id + '/text', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify( { Text: '# Highlights\n\nThe first passage.\n\nThe second passage.\n', Revision: plan.Revision } ) } );
	let open_thread = ( await post( '/api/proposals/' + plan.Id + '/threads', { Text: 'Why first?', Anchor: { Text: 'first passage' } } ) ).Thread;
	let resolved_thread = ( await post( '/api/proposals/' + plan.Id + '/threads', { Text: 'Keep it.', Anchor: { Text: 'second passage' }, Resolve: true } ) ).Thread;
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
	await page.WaitFor( 'document.activeElement && document.activeElement.id === "compose-text"' );
	await page.Type( 'Add a summary at the top.' );
	await page.WaitFor( '!document.getElementById( "compose-resolve" ).disabled' );
	await page.Click( '#compose-resolve' );
	await page.WaitFor( count_of( '.thread.selected' ) + ' === 1' );
	let threads = ( await ( await fetch( running.Url + '/api/proposals/' + plan.Id + '/threads' ) ).json() ).Threads;
	let posted = threads.find( function ( thread ) { return thread.Replies[ 0 ].Text === 'Add a summary at the top.'; } );
	ASSERT.equal( posted.Status, 'resolved' );
	ASSERT.equal( posted.Anchor, null );
	ASSERT.deepEqual( posted.Turn, [ 'llm' ] );

	// a whole-document thread can be anchored afterwards
	await page.WaitFor( 'getComputedStyle( document.querySelector( ".thread.selected .reanchor-button" ) ).display !== "none"' );
	ASSERT.deepEqual( page.Errors, [] );
} );


TEST( 'session panel: it opens centered, moves by its heading, resizes by its corner grip, and Reset centers it again', async function ()
{
	const BOX = '( function () { let panel = document.getElementById( "session-panel" ); let area = panel.closest( ".content-area" ); return { Left: panel.offsetLeft, Top: panel.offsetTop, Width: panel.offsetWidth, Height: panel.offsetHeight, AreaWidth: area.clientWidth, AreaHeight: area.clientHeight }; } )()';
	function centered( box )
	{
		return Math.abs( box.Left + box.Width / 2 - box.AreaWidth / 2 ) <= 2;
	}

	let plan = await created( 'Floating' );
	await page.Evaluate( 'window.location.hash = "#/p/' + plan.Id + '"; true' );
	await page.WaitFor( text_of( '.header .title' ) + ' === "Floating"' );
	await page.Click( '#send-button' );
	await page.WaitFor( 'getComputedStyle( document.getElementById( "session-panel" ) ).display !== "none"' );
	await new Promise( function ( resolve ) { setTimeout( resolve, 100 ); } );
	let first = await page.Evaluate( BOX );
	ASSERT.ok( centered( first ), JSON.stringify( first ) );

	// moved by its heading, and remembered
	await page.Drag( '.session-head .session-title', -5, -60 );
	let moved = await page.Evaluate( BOX );
	ASSERT.ok( Math.abs( moved.Top - ( first.Top - 60 ) ) <= 1, JSON.stringify( moved ) );
	let saved = JSON.parse( await page.Evaluate( 'window.localStorage.getItem( "consensus.session-box" )' ) );
	ASSERT.deepEqual( [ saved.Left, saved.Top ], [ moved.Left, moved.Top ] );

	// sized by the grip in its corner, within the area
	await page.Drag( '#session-grip', -60, 50 );
	await page.WaitFor( '( JSON.parse( window.localStorage.getItem( "consensus.session-box" ) ) || {} ).Width > 0' );
	let resized = await page.Evaluate( BOX );
	ASSERT.ok( resized.Width < moved.Width, JSON.stringify( resized ) );
	ASSERT.ok( resized.Top + resized.Height <= resized.AreaHeight, JSON.stringify( resized ) );

	// Reset: centered again at its first size, and nothing remembered
	await page.Click( '#session-reset' );
	await page.WaitFor( 'window.localStorage.getItem( "consensus.session-box" ) === null' );
	let reset = await page.Evaluate( BOX );
	ASSERT.ok( centered( reset ), JSON.stringify( reset ) );
	ASSERT.equal( reset.Width, first.Width );
	await page.Click( '#session-panel .btn-close' );
	await page.WaitFor( 'getComputedStyle( document.getElementById( "session-panel" ) ).display === "none"' );
	ASSERT.deepEqual( page.Errors, [] );
} );


TEST( 'tree menus: a right-click or the ⋯ opens a row\'s actions; Delete is there only, confirmed on the row; the open project has the solid dot', async function ()
{
	let doomed = await created( 'Doomed plan' );
	await page.Evaluate( 'window.location.hash = "#/p/' + doomed.Id + '"; true' );
	await page.WaitFor( text_of( '.header .title' ) + ' === "Doomed plan"' );
	const ROW = '.tree-item[data-id="' + doomed.Id + '"]';
	await page.WaitFor( count_of( ROW ) + ' === 1' );

	// no Delete in the heading; the open project's dot is solid, the others hollow
	ASSERT.equal( await page.Evaluate( '[ ...document.querySelectorAll( ".header button" ) ].some( function ( button ) { return button.textContent.trim() === "Delete"; } )' ), false );
	ASSERT.equal( await page.Evaluate( count_of( '.project.open .project-dot.open' ) ), 1 );
	ASSERT.equal( await page.Evaluate( count_of( '.project-dot.open' ) ), 1 );
	ASSERT.equal( await page.Evaluate( count_of( '.project-dot' ) + ' - ' + count_of( '.project' ) ), 0 );

	// a right-click opens the same menu; Escape closes it
	await page.Evaluate( 'document.querySelector( ' + JSON.stringify( ROW ) + ' ).dispatchEvent( new MouseEvent( "contextmenu", { bubbles: true, cancelable: true, clientX: 60, clientY: 200 } ) ); true' );
	await page.WaitFor( 'getComputedStyle( document.getElementById( "popup-menu" ) ).display !== "none"' );
	ASSERT.deepEqual( await page.Evaluate( '[ ...document.querySelectorAll( "#popup-menu .menu-button" ) ].map( function ( entry ) { return entry.textContent.trim(); } )' ), [ 'New Subplan', 'Rename', 'Copy', 'Delete' ] );
	await page.Press( 'Escape' );
	await page.WaitFor( 'getComputedStyle( document.getElementById( "popup-menu" ) ).display === "none"' );

	// Delete from the menu asks on the row; Yes sends it to the trash and closes its tab
	await menu_pick( ROW, 'Delete' );
	await page.WaitFor( count_of( ROW + ' .confirm-delete-item' ) + ' === 1' );
	await page.Evaluate( 'document.querySelector( ' + JSON.stringify( ROW + ' .confirm-delete-item' ) + ' ).click(); true' );
	await page.WaitFor( count_of( ROW ) + ' === 0' );
	await page.WaitFor( count_of( tab_selector( doomed.Id ) ) + ' === 0' );
	ASSERT.equal( ( await fetch( running.Url + '/api/proposals/' + doomed.Id ) ).status, 404 );
	ASSERT.deepEqual( page.Errors, [] );
} );


TEST( 'Ctrl+E: Read to Edit, and back to Read from the editor, keeping the unsaved edit', async function ()
{
	let plan = await created( 'Keyboard plan' );
	await page.Evaluate( 'window.location.hash = "#/p/' + plan.Id + '"; true' );
	await page.WaitFor( text_of( '.header .title' ) + ' === "Keyboard plan"' );
	await page.WaitFor( 'document.getElementById( "view-read" ).classList.contains( "btn-secondary" )' );
	await page.Click( '#read-view' );
	await page.Press( 'e', [ 'Control' ] );
	await page.WaitFor( 'document.getElementById( "view-edit" ).classList.contains( "btn-secondary" )' );
	const SAVED = JSON.stringify( '# Keyboard plan\n\nA line.\n' );
	const EDITED = JSON.stringify( '# Keyboard plan\n\nA line, not saved.\n' );
	await page.WaitFor( 'window.monaco && monaco.editor.getEditors().length === 1 && monaco.editor.getEditors()[ 0 ].getValue() === ' + SAVED, 30000 );
	await page.Evaluate( '( function () { let editor = monaco.editor.getEditors()[ 0 ]; editor.setValue( ' + EDITED + ' ); editor.focus(); return true; } )()' );
	// from inside the editor, back to Read; the edit, kept with the tab a moment after typing, is there on the way back
	await page.WaitFor( '( window.sessionStorage.getItem( "consensus.tabs" ) || "" ).includes( "A line, not saved" )' );
	await page.Press( 'e', [ 'Control' ] );
	await page.WaitFor( 'document.getElementById( "view-read" ).classList.contains( "btn-secondary" )' );
	await page.Press( 'e', [ 'Control' ] );
	await page.WaitFor( 'document.getElementById( "view-edit" ).classList.contains( "btn-secondary" )' );
	await page.WaitFor( 'monaco.editor.getEditors()[ 0 ].getValue() === ' + EDITED );
	ASSERT.deepEqual( page.Errors, [] );
} );
