'use strict';

// The report (plan Printing and Reporting): over a server on a temporary folder, a plan with a Subplan and threads
// of every kind (anchored, whole-document, resolved and applied, reopened, detached, deleted) reports as one page
// and as markdown, in the order of the passages, with every author and timestamp and without the deleted thread;
// a document and a missing plan are refused; and MarkHtml wraps passages piece by piece across tags.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const FS = require( 'fs' );
const OS = require( 'os' );
const PATH = require( 'path' );
const SERVER = require( '../src/Server.js' );
const PARTICIPANTS = require( '../src/Participants.js' );
const REPORT = require( '../src/Report.js' );

const TEXT = [
	'# The reported plan',
	'',
	'The first paragraph makes a **bold claim** here, with a [link](http://x.y).',
	'',
	'- one list item',
	'- another list item',
	'',
	'A closing paragraph with words that will change.',
	'',
].join( '\n' );

let running = null;
let token = null;
let plan = null;
let subplan = null;
let threads = {};


async function call( method, path, body, as_llm )
{
	let headers = {};
	if ( body !== undefined )
	{
		headers[ 'Content-Type' ] = 'application/json';
	}
	if ( as_llm )
	{
		headers.Authorization = 'Bearer ' + token;
	}
	let response = await fetch( running.Url + path, { method: method, headers: headers, body: ( body === undefined ) ? undefined : JSON.stringify( body ) } );
	let type = response.headers.get( 'content-type' ) || '';
	let content = type.includes( 'json' ) ? await response.json() : await response.text();
	return { Status: response.status, Type: type, Body: content };
}


TEST.before( async function ()
{
	running = await SERVER.Start( { Data: FS.mkdtempSync( PATH.join( OS.tmpdir(), 'consensus-report-' ) ), Port: 0 } );
	token = PARTICIPANTS.NewToken();
	running.Settings.Participants[ 1 ].Token = token;
	plan = ( await call( 'POST', '/api/plans', { Title: 'The reported plan', Text: TEXT } ) ).Body.Plan;
	subplan = ( await call( 'POST', '/api/plans', { Title: 'The first step', Text: '# The first step\n\nA step\'s text.\n', Parent: plan.Id } ) ).Body.Plan;
	// applied: anchored, answered by the llm, resolved by the owner, applied by the llm with the outcome
	threads.Applied = ( await call( 'POST', '/api/plans/' + plan.Id + '/threads', { Anchor: { Text: 'bold claim' }, Text: 'Is it bold enough?' } ) ).Body.Thread;
	await call( 'POST', '/api/plans/' + plan.Id + '/threads/' + threads.Applied.Id + '/replies', { Text: 'Outcome: it stays.' }, true );
	await call( 'POST', '/api/plans/' + plan.Id + '/threads/' + threads.Applied.Id + '/resolve' );
	await call( 'POST', '/api/plans/' + plan.Id + '/threads/' + threads.Applied.Id + '/apply', { Outcome: 'kept as it was', Revision: 1 }, true );
	// whole document, contested
	threads.Whole = ( await call( 'POST', '/api/plans/' + plan.Id + '/threads', { Text: 'A word on the whole.' } ) ).Body.Thread;
	// reopened: resolved, then a reply
	threads.Reopened = ( await call( 'POST', '/api/plans/' + plan.Id + '/threads', { Anchor: { Text: 'one list item' }, Text: 'Enough items?' } ) ).Body.Thread;
	await call( 'POST', '/api/plans/' + plan.Id + '/threads/' + threads.Reopened.Id + '/resolve' );
	await call( 'POST', '/api/plans/' + plan.Id + '/threads/' + threads.Reopened.Id + '/replies', { Text: 'Not so sure.' } );
	// detached: anchored to words the next edit removes
	threads.Detached = ( await call( 'POST', '/api/plans/' + plan.Id + '/threads', { Anchor: { Text: 'words that will change' }, Text: 'These words go.' } ) ).Body.Thread;
	// deleted: made, then removed
	threads.Deleted = ( await call( 'POST', '/api/plans/' + plan.Id + '/threads', { Anchor: { Text: 'another list item' }, Text: 'Forget this one.' } ) ).Body.Thread;
	await call( 'DELETE', '/api/plans/' + plan.Id + '/threads/' + threads.Deleted.Id );
	// the edit that detaches the detached thread (the applied one made revision 2)
	let current = ( await call( 'GET', '/api/plans/' + plan.Id ) ).Body;
	await call( 'PUT', '/api/plans/' + plan.Id + '/text', { Text: current.Text.replace( 'words that will change', 'something else entirely' ), Revision: current.Plan.Revision } );
	// a thread on the Subplan
	threads.Sub = ( await call( 'POST', '/api/plans/' + subplan.Id + '/threads', { Anchor: { Text: 'A step\'s text.' }, Text: 'Which step?' } ) ).Body.Thread;
} );


TEST.after( async function ()
{
	await running.Close();
} );


//---------------------------------------------------------------------

TEST( 'the report page: the title page, the text with its passages marked and numbered, the threads in passage order with every author and time, the Subplan as a chapter, the deleted thread gone', async function ()
{
	let result = await call( 'GET', '/api/plans/' + plan.Id + '/report' );
	ASSERT.equal( result.Status, 200 );
	ASSERT.match( result.Type, /text\/html/ );
	let html = result.Body;
	// a complete page with the stylesheet inlined and the controls
	ASSERT.match( html, /^<!DOCTYPE html>/ );
	ASSERT.ok( html.includes( '<title>The reported plan - Consensus report</title>' ) );
	ASSERT.ok( html.includes( '<style>' ) && html.includes( '@media print' ) );
	ASSERT.ok( html.includes( 'id="print-button"' ) && html.includes( 'href="report.md"' ) );
	ASSERT.ok( html.includes( 'id="browser-button" title="the same report in your browser, for its own preview and print" hidden>' ) );
	// the title page's facts
	ASSERT.ok( html.includes( '<dt>State</dt><dd>Draft' ) );
	ASSERT.ok( html.includes( '<dt>Participants</dt>' ) && html.includes( '<span class="who">User</span>' ) && html.includes( '<span class="who">LLM</span>' ) );
	ASSERT.ok( html.includes( '4 threads, 1 applied, 0 resolved, 3 contested (1 reopened), 1 detached; 1 Subplan' ), html.match( /<dt>Threads<\/dt><dd>[^<]*/ )[ 0 ] );
	ASSERT.ok( html.includes( '<ol class="contents">' ) && html.includes( '>The first step</a>' ) );
	// the passages: whole document 1, then bold claim 2 and one list item 3 in the text's order, the detached one last (4)
	ASSERT.ok( html.includes( '<mark class="anchor applied" data-numbers="2">bold claim</mark><sup class="passage-number applied" title="thread 2">2</sup>' ) );
	ASSERT.ok( html.includes( '<mark class="anchor reopened" data-numbers="3">one list item</mark><sup class="passage-number reopened" title="thread 3">3</sup>' ) );
	ASSERT.equal( ( html.match( /<sup class="passage-number/g ) || [] ).length, 3, 'the Subplan\'s passage makes the third number' );
	// the threads in order, each with its words, state, replies and records
	let heads = html.match( /<header class="thread-head">.*?<\/header>/g );
	ASSERT.equal( heads.length, 5 );
	ASSERT.match( heads[ 0 ], /<span class="number">1<\/span> <span class="anchor-words">the whole document<\/span> <span class="badge contested">contested<\/span>/ );
	ASSERT.match( heads[ 1 ], /<span class="number">2<\/span> <span class="anchor-words">“bold claim”<\/span> <span class="badge applied">applied<\/span>/ );
	ASSERT.match( heads[ 2 ], /<span class="number">3<\/span> <span class="anchor-words">“one list item”<\/span> <span class="badge reopened">reopened<\/span>/ );
	ASSERT.match( heads[ 3 ], /<span class="number">4<\/span> <span class="anchor-words">“words that will change” \(detached: these words are no longer in the text\)<\/span> <span class="badge contested">contested<\/span>/ );
	ASSERT.match( heads[ 4 ], /<span class="number">1<\/span> <span class="anchor-words">“A step's text.”<\/span>/ );
	ASSERT.match( html, /<div class="reply-head"><span class="who">LLM<\/span> <time datetime="[^"]+">\d{4}-\d\d-\d\d \d\d:\d\d:\d\d<\/time><\/div><div class="reply-text markdown"><p>Outcome: it stays.<\/p>/ );
	ASSERT.match( html, /<div class="record">Resolved by <span class="who">User<\/span> <time datetime="[^"]+">\d{4}-\d\d-\d\d \d\d:\d\d:\d\d<\/time><\/div>/ );
	ASSERT.match( html, /<div class="record">Applied by <span class="who">LLM<\/span> <time[^>]*>[^<]+<\/time> at revision 1: <span class="outcome">kept as it was<\/span><\/div>/ );
	// the deleted thread is not there
	ASSERT.equal( html.includes( 'Forget this one.' ), false );
	ASSERT.equal( html.includes( threads.Deleted.Id ), false );
	// the Subplan is a chapter with its own heading, text and threads
	ASSERT.ok( html.includes( '<section class="plan depth-1" id="plan-' + subplan.Id + '">' ) );
	ASSERT.ok( html.includes( '<div class="kicker">Subplan</div>\n<h2>The first step</h2>' ) );
	ASSERT.ok( html.includes( 'class="threads-title">Threads of The first step</h3>' ) );
} );


TEST( 'the markdown report: the same record as one markdown document, and a Subplan reports on its own with its path', async function ()
{
	let result = await call( 'GET', '/api/plans/' + plan.Id + '/report.md' );
	ASSERT.equal( result.Status, 200 );
	ASSERT.match( result.Type, /text\/markdown/ );
	let markdown = result.Body;
	ASSERT.match( markdown, /^# Report: The reported plan\n\n- Project: Default \/ The reported plan on / );
	ASSERT.ok( markdown.includes( '- Threads: 4 threads, 1 applied, 0 resolved, 3 contested (1 reopened), 1 detached; 1 Subplan' ) );
	ASSERT.ok( markdown.includes( '\n# The reported plan\n\nThe first paragraph makes a **bold claim** here' ) );
	ASSERT.ok( markdown.includes( '\n## Threads of The reported plan\n\n1. the whole document — contested\n    - **User** ' ) );
	ASSERT.match( markdown, /2\. “bold claim” — applied\n    - \*\*User\*\* \d{4}-\d\d-\d\d \d\d:\d\d:\d\d:\n      Is it bold enough\?\n    - \*\*LLM\*\* [^\n]+:\n      Outcome: it stays\.\n    - Resolved by User [^\n]+\n    - Applied by LLM [^\n]+ at revision 1: kept as it was\n/ );
	ASSERT.ok( markdown.includes( '4. “words that will change” (detached: these words are no longer in the text) — contested' ) );
	ASSERT.ok( markdown.includes( '\n## Subplan: The first step\n' ) && markdown.includes( '\n### Threads of The first step\n' ) );
	ASSERT.equal( markdown.includes( 'Forget this one.' ), false );
	// the Subplan alone, with its path through the parent
	let own = await call( 'GET', '/api/plans/' + subplan.Id + '/report.md' );
	ASSERT.match( own.Body, /^# Report: The first step\n\n- Project: Default \/ The reported plan \/ The first step on / );
	ASSERT.equal( own.Body.includes( 'Subplan' ), false );
} );


TEST( 'a document has no report, a missing plan none; the llm and a member read it as the owner does', async function ()
{
	let readme = ( await call( 'GET', '/api/projects' ) ).Body.Projects[ 0 ].Context.Id;
	let refused = await call( 'GET', '/api/plans/' + readme + '/report' );
	ASSERT.equal( refused.Status, 400 );
	ASSERT.match( refused.Body.Error, /a document has no threads/ );
	ASSERT.equal( ( await call( 'GET', '/api/plans/pln-000-000-000/report.md' ) ).Status, 404 );
	let as_llm = await call( 'GET', '/api/plans/' + plan.Id + '/report', undefined, true );
	ASSERT.equal( as_llm.Status, 200 );
	ASSERT.ok( as_llm.Body.includes( '<title>The reported plan - Consensus report</title>' ) );
} );


TEST( 'MarkHtml wraps a passage piece by piece across tags, numbers it once after its last piece, and marks an overlap with every number', function ()
{
	let html = '<p>Some <em>bold words</em> here, and &quot;quoted&quot; ones.</p>\n<ul>\n<li>one</li>\n</ul>\n';
	// the plain text the server's anchors see: Some bold words here, and "quoted" ones. one
	let marked = REPORT.MarkHtml( html, [ { Start: 5, End: 20, Number: 1, State: 'applied' } ] );
	ASSERT.equal( marked, '<p>Some <em><mark class="anchor applied" data-numbers="1">bold words</mark></em><mark class="anchor applied" data-numbers="1"> here</mark><sup class="passage-number applied" title="thread 1">1</sup>, and &quot;quoted&quot; ones.</p>\n<ul>\n<li>one</li>\n</ul>\n' );
	// an entity inside a passage stays an entity; the passage spans it whole
	let quoted = REPORT.MarkHtml( html, [ { Start: 26, End: 34, Number: 2, State: 'contested' } ] );
	ASSERT.ok( quoted.includes( '<mark class="anchor contested" data-numbers="2">&quot;quoted&quot;</mark><sup class="passage-number contested" title="thread 2">2</sup>' ), quoted );
	// two passages overlapping: the shared piece carries both numbers and the later state
	let both = REPORT.MarkHtml( html, [ { Start: 0, End: 15, Number: 1, State: 'applied' }, { Start: 10, End: 20, Number: 2, State: 'contested' } ] );
	ASSERT.ok( both.includes( '<mark class="anchor applied" data-numbers="1">Some </mark>' ), both );
	ASSERT.ok( both.includes( '<em><mark class="anchor applied" data-numbers="1">bold </mark><mark class="anchor contested several" data-numbers="1 2">words</mark><sup class="passage-number applied" title="thread 1">1</sup></em>' ), both );
	ASSERT.ok( both.includes( '<mark class="anchor contested" data-numbers="2"> here</mark><sup class="passage-number contested" title="thread 2">2</sup>' ), both );
	// a passage across blocks: the list item is its own piece
	let across = REPORT.MarkHtml( html, [ { Start: 35, End: 44, Number: 3, State: 'resolved' } ] );
	ASSERT.ok( across.includes( '<mark class="anchor resolved" data-numbers="3">ones.</mark>' ) && across.includes( '<li><mark class="anchor resolved" data-numbers="3">one</mark><sup class="passage-number resolved" title="thread 3">3</sup></li>' ), across );
	// nothing to mark: the html as it was
	ASSERT.equal( REPORT.MarkHtml( html, [] ), html );
} );
