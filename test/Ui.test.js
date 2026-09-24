'use strict';

// The page in a real browser (test/support/Cdp.js drives the installed Chrome or Edge headless):
// the list loads, a selection becomes a thread, Send to LLM brings a reply live, resolve, edit and save, approve.
// The server runs on port 0 over a temporary folder; the LLM behind Send to LLM is played by fake_caller.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const FS = require( 'fs' );
const OS = require( 'os' );
const PATH = require( 'path' );
const SERVER = require( '../src/Server.js' );
const CDP = require( './support/Cdp.js' );

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


TEST( 'Send to LLM hands it the thread; its reply arrives without a reload and its tokens are counted', async function ()
{
	await page.WaitFor( text_of( '#send-button' ) + ' === "Send to LLM (1)"' );
	await page.Click( '#send-button' );
	await page.WaitFor( count_of( '.thread:not(.compose) .reply' ) + ' === 2' );
	ASSERT.equal( await page.Evaluate( 'Array.from( document.querySelectorAll( ".thread:not(.compose) .reply-text" ) ).pop().textContent.trim()' ), 'Outcome: one item stays.' );
	await page.WaitFor( text_of( '#state-line' ) + ' === "1 contested, waiting on you 1"' );
	await page.WaitFor( text_of( '#send-button' ) + ' === "Send to LLM (0)"' );
	ASSERT.equal( await page.Evaluate( 'document.getElementById( "send-button" ).disabled' ), true );
	await page.WaitFor( text_of( '#usage' ) + ' === "LLM today: 1.5k in · 120 out"' );
} );


TEST( 'the owner resolves from the page', async function ()
{
	await page.Click( '.thread:not(.compose)' );
	await page.WaitFor( count_of( '.thread.selected .resolve-button' ) + ' === 1' );
	await page.Click( '.thread.selected .resolve-button' );
	await page.WaitFor( text_of( '.thread:not(.compose) .state-badge' ) + ' === "waiting"' );
	await page.WaitFor( text_of( '#state-line' ) + ' === "1 waiting to be applied"' );
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


TEST( 'once the LLM applies, the owner approves and the proposal is a Plan', async function ()
{
	await page.WaitFor( text_of( '#send-button' ) + ' === "Send to LLM (1)"' );
	await page.Click( '#send-button' );
	await page.WaitFor( '!document.getElementById( "approve-button" ).disabled' );
	await page.WaitFor( text_of( '#state-line' ) + ' === "1 applied · ready for approval as a Plan"' );
	await page.Click( '#approve-button' );
	await page.WaitFor( text_of( '#status-badge' ) + ' === "Plan"' );
	await page.WaitFor( count_of( '.proposal-item.plan' ) + ' === 1' );
	ASSERT.deepEqual( page.Errors, [] );
} );


TEST( 'search finds the thread and the theme switches', async function ()
{
	await page.Click( '#search-box' );
	await page.Type( 'one item stays' );
	await page.Press( 'Enter' );
	await page.WaitFor( count_of( '.search-hit' ) + ' >= 1', 15000 );
	ASSERT.equal( await page.Evaluate( 'document.querySelector( ".search-hit" ).classList.contains( "thread" )' ), true );
	await page.Evaluate( 'window.ConsensusTheme.SetTheme( "dark" )' );
	ASSERT.equal( await page.Evaluate( 'document.documentElement.dataset.bsTheme' ), 'dark' );
	await page.Evaluate( 'window.ConsensusTheme.SetScale( "large" )' );
	ASSERT.equal( await page.Evaluate( 'document.documentElement.style.getPropertyValue( "--scale" )' ), '1.15' );
	ASSERT.deepEqual( page.Errors, [] );
} );
