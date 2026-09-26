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

const TEXT = '# Browser check\n\nThe first paragraph makes a claim about anchors.\n\n- one list item\n- another list item\n\nA closing paragraph.\n';

let running = null;
let browser = null;
let page = null;
let proposal = null;


function count_of( selector )
{
	return 'document.querySelectorAll( ' + JSON.stringify( selector ) + ' ).length';
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
	running = await SERVER.Start( { Data: FS.mkdtempSync( PATH.join( OS.tmpdir(), 'consensus-ui-' ) ), Port: 0, Caller: fake_caller } );
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
	await page.Click( '.project.open .new-folder' );
	await page.WaitFor( 'document.activeElement && document.activeElement.id === "create-name"' );
	await page.Type( 'Specs' );
	await page.Click( '#create-submit' );
	await page.WaitFor( count_of( '.project.open .folder' ) + ' === 1' );
	await page.Click( '.project.open .folder-head' );
	await page.WaitFor( count_of( '.project.open .folder-head.target' ) + ' === 1' );
	await page.Click( '.project.open .new-plan' );
	await page.WaitFor( 'document.activeElement && document.activeElement.id === "create-name"' );
	await page.Type( 'Plan in a folder' );
	await page.Click( '#create-submit' );
	await page.WaitFor( count_of( '.project.open .folder .tree-item' ) + ' === 1' );
	await page.WaitFor( text_of( '#read-view h1' ) + ' === "Plan in a folder"' );
	ASSERT.equal( await page.Evaluate( text_of( '.project.open .folder .tree-item .proposal-title' ) ), 'Plan in a folder' );
	// a document: no threads pane, no state picker, no comment button
	await page.Click( '.project.open .new-document' );
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
	await page.Evaluate( 'document.querySelector( ".project.open .folder .tree-item .copy-item" ).click()' );
	await page.WaitFor( text_of( '#clipboard' ) + '.startsWith( "copied: Plan in a folder" )' );
	await page.Evaluate( 'document.querySelector( ".project.open .project-head .paste-here" ).click()' );
	await page.WaitFor( count_of( '.project.open .tree-item' ) + ' === 3' );
	await page.WaitFor( '[ ...document.querySelectorAll( ".project.open .proposal-title" ) ].some( function ( title ) { return title.textContent.trim() === "Plan in a folder (copy)"; } )' );
	ASSERT.deepEqual( page.Errors, [] );
} );


TEST( 'a zip uploaded into the project becomes a corpus: its files listed, one read, and found by search', async function ()
{
	let zip = MAKER.Make( [ { Name: 'notes/lighthouse.md', Data: '# Lighthouse\n\nThe keeper winds the clockwork lamp at dusk.\n' }, { Name: 'notes/photo.jpg', Data: 'jpeg' } ] );
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
	ASSERT.match( await page.Evaluate( text_of( '.corpus-file:not(.indexed)' ) ), /not a text type: \.jpg/ );
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
	await page.Evaluate( 'document.querySelector( ".tree-item[data-id=\\"' + proposal.Id + '\\"] .rename-item" ).click(); true' );
	await page.WaitFor( 'document.activeElement && document.activeElement.closest( ".rename-form" ) !== null' );
	await page.Evaluate( '( function () { let input = document.activeElement; input.value = "Browser check, renamed"; input.dispatchEvent( new Event( "input" ) ); input.form.dispatchEvent( new Event( "submit", { cancelable: true } ) ); return true; } )()' );
	await page.WaitFor( text_of( '.tree-item[data-id="' + proposal.Id + '"] .proposal-title' ) + ' === "Browser check, renamed"' );
	await page.WaitFor( text_of( '.header .title' ) + ' === "Browser check, renamed"' );
	ASSERT.deepEqual( page.Errors, [] );
} );


TEST( 'reply and resolve: one click posts the owner\'s answer and resolves the thread', async function ()
{
	// the only thread is applied; a reply reopens it, and Reply and resolve settles it again
	await page.WaitFor( count_of( '.thread:not(.compose)' ) + ' === 1' );
	await page.Click( '.thread:not(.compose)' );
	await page.WaitFor( count_of( '.thread.selected .reply-box' ) + ' === 1' );
	await page.Evaluate( '( function () { let box = document.querySelector( ".thread.selected .reply-box" ); box.value = "Reopened to ask again."; box.dispatchEvent( new Event( "input" ) ); return true; } )()' );
	await page.Click( '.thread.selected .reply-button' );
	await page.WaitFor( text_of( '.thread:not(.compose) .state-badge' ) + ' === "reopened"' );
	await page.WaitFor( 'getComputedStyle( document.querySelector( ".thread.selected .reply-resolve-button" ) ).display !== "none"' );
	ASSERT.equal( await page.Evaluate( 'document.querySelector( ".thread.selected .reply-resolve-button" ).disabled' ), true );
	await page.Evaluate( '( function () { let box = document.querySelector( ".thread.selected .reply-box" ); box.value = "Keep one item."; box.dispatchEvent( new Event( "input" ) ); return true; } )()' );
	await page.WaitFor( '!document.querySelector( ".thread.selected .reply-resolve-button" ).disabled' );
	await page.Click( '.thread.selected .reply-resolve-button' );
	await page.WaitFor( text_of( '.thread:not(.compose) .state-badge' ) + ' === "resolved"' );
	ASSERT.equal( await page.Evaluate( 'Array.from( document.querySelectorAll( ".thread:not(.compose) .reply-text" ) ).pop().textContent.trim()' ), 'Keep one item.' );
	ASSERT.deepEqual( page.Errors, [] );
} );


TEST( 'the owner deletes a thread; the revision it made names it as deleted', async function ()
{
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


TEST( 'tabs: a tab detaches into its own window and is re-attached from there', async function ()
{
	await page.Evaluate( 'window.location.hash = "#/p/' + tab_one.Id + '"; true' );
	await page.WaitFor( text_of( '.header .title' ) + ' === "Tab one"' );
	// the window the browser would open is recorded instead; the messages between windows are overheard
	await page.Evaluate( '( function () {'
		+ ' window.opened = []; window.open = function ( url ) { window.opened.push( url ); return {}; };'
		+ ' window.heard = []; let channel = new BroadcastChannel( "consensus-windows" ); channel.onmessage = function ( event ) { window.heard.push( event.data.Type ); };'
		+ ' return true; } )()' );
	await page.Evaluate( 'document.querySelector( ' + JSON.stringify( tab_selector( tab_one.Id ) + ' .detach-tab' ) + ' ).click(); true' );
	await page.WaitFor( count_of( tab_selector( tab_one.Id ) ) + ' === 0' );
	ASSERT.equal( await page.Evaluate( 'window.opened[ 0 ]' ), '/?detached=1#/p/' + tab_one.Id );
	// clicked again in the main window, the item stays out: its window is asked to come forward
	await page.WaitFor( text_of( '.header .title' ) + ' !== "Tab one"' );
	let shown = await page.Evaluate( text_of( '.header .title' ) );
	await page.Evaluate( 'window.location.hash = "#/p/' + tab_one.Id + '"; true' );
	await page.WaitFor( 'window.heard.includes( "focus" )' );
	ASSERT.equal( await page.Evaluate( count_of( tab_selector( tab_one.Id ) ) ), 0 );
	await page.WaitFor( text_of( '.header .title' ) + ' === ' + JSON.stringify( shown ) );

	// the detached window: the item alone, no sidebar, and Re-attach puts it back as a tab in the main window
	let detached = await browser.OpenPage( running.Url + '/?detached=1#/p/' + tab_one.Id );
	await detached.WaitFor( text_of( '.header .title' ) + ' === "Tab one"', 20000 );
	ASSERT.equal( await detached.Evaluate( 'getComputedStyle( document.querySelector( "aside.sidebar" ) ).display' ), 'none' );
	ASSERT.equal( await detached.Evaluate( 'getComputedStyle( document.querySelector( ".tab-strip" ) ).display' ), 'none' );
	await page.WaitFor( 'window.heard.includes( "here" )' );
	await detached.Click( '#reattach' );
	await page.WaitFor( count_of( tab_selector( tab_one.Id ) ) + ' === 1' );
	await page.WaitFor( text_of( '.header .title' ) + ' === "Tab one"' );
	await page.WaitFor( 'window.heard.includes( "attached" )' );
	ASSERT.deepEqual( page.Errors, [] );
	ASSERT.deepEqual( detached.Errors, [] );
	detached.Close();
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
