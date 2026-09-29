'use strict';

// The worker's page in a real browser (test/support/Cdp.js): the connection, the running job with its tool calls,
// Cancel, the jobs list opening to a job's calls and answer, Pause and Resume, and the theme. Consensus and the worker
// run on port 0 over temporary folders; the model is a stand-in Runner.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const FS = require( 'fs' );
const OS = require( 'os' );
const PATH = require( 'path' );
const SERVER = require( '../src/Server.js' );
const WORKER = require( '../src/Worker.js' );
const PARTICIPANTS = require( '../src/Participants.js' );
const CDP = require( './support/Cdp.js' );

const TOKEN = 'worker-ui-token-0123456789';

let folders = [];
let running = null;
let worker = null;
let browser = null;
let page = null;
let hold = null;


function temporary_folder( prefix )
{
	let folder = FS.mkdtempSync( PATH.join( OS.tmpdir(), prefix ) );
	folders.push( folder );
	return folder;
}


function text_of( selector )
{
	return '( document.querySelector( ' + JSON.stringify( selector ) + ' ) || { textContent: "" } ).textContent.trim()';
}


function count_of( selector )
{
	return 'document.querySelectorAll( ' + JSON.stringify( selector ) + ' ).length';
}


async function call( method, path, body )
{
	let response = await fetch( running.Url + path, { method: method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify( body ) : undefined } );
	return { Status: response.status, Body: await response.json() };
}


TEST.before( async function ()
{
	let root = temporary_folder( 'consensus-worker-ui-root-' );
	FS.writeFileSync( PATH.join( root, 'a.js' ), 'const HERON = 1;\n' );
	let data = temporary_folder( 'consensus-worker-ui-data-' );
	let settings = PARTICIPANTS.DefaultSettings( 0 );
	settings.Workers = [ { Name: 'Desk', Token: TOKEN } ];
	FS.writeFileSync( PATH.join( data, 'consensus.json' ), JSON.stringify( settings, null, '\t' ) );
	running = await SERVER.Start( { Data: data, Port: 0, Workers: { WaitSeconds: 1 } } );
	worker = await WORKER.Start( {
		Settings: {
			Name: 'Desk',
			Consensus: { Url: running.Url, Token: TOKEN },
			Items: [ { Kind: 'Workspace', Name: 'Code', Root: root }, { Kind: 'Inference', Name: 'Claude', Type: 'claude-cli', Model: 'sonnet' } ],
		},
		Folder: temporary_folder( 'consensus-worker-ui-' ),
		Port: 0,
		Vendor: SERVER.AttachVendor,
		Runner: async function ( job, tools, context )
		{
			await tools.Call( 'read', { Path: 'a.js' } );
			await tools.Call( 'glob', { Pattern: '**/*.js' } );
			let thread = /## Thread (thr-[0-9a-z-]+)/.exec( job.Prompt )[ 1 ];
			if ( hold )
			{
				await new Promise( function ( resolve ) { context.Signal.addEventListener( 'abort', resolve ); } );
				throw new Error( 'stopped' );
			}
			return { Answer: { Actions: [ { Thread: thread, Kind: 'reply', Reply: 'HERON is 1.' } ] }, Usage: { Model: 'stand-in', Input: 40, Output: 4 } };
		},
	} );
	browser = await CDP.StartBrowser();
	page = await browser.OpenPage( worker.Url + '/' );
} );


TEST.after( async function ()
{
	if ( browser )
	{
		await browser.Close();
	}
	if ( worker )
	{
		await worker.Close();
	}
	if ( running )
	{
		await running.Close();
	}
	for ( let folder of folders )
	{
		FS.rmSync( folder, { recursive: true, force: true } );
	}
} );


// A plan in a project on the worker's workspace, with one question, sent to the worker.
async function send_review( name )
{
	let project = ( await call( 'POST', '/api/projects', { Name: name } ) ).Body.Project;
	ASSERT.equal( ( await call( 'PUT', '/api/projects/' + project.Id + '/workspace', { Worker: 'Desk', Name: 'Code' } ) ).Status, 200 );
	let plan = ( await call( 'POST', '/api/proposals', { Title: name + ' plan', Text: '# Plan\n\nText.\n', Project: project.Id } ) ).Body.Proposal;
	await call( 'POST', '/api/proposals/' + plan.Id + '/threads', { Text: 'Is HERON 1?' } );
	let sent = await call( 'POST', '/api/proposals/' + plan.Id + '/session', { Destination: 'Desk / Claude' } );
	ASSERT.equal( sent.Status, 202 );
	return plan;
}


//---------------------------------------------------------------------

TEST( 'the page shows the worker, its connection, workspaces and inference; it waits for a job', async function ()
{
	await page.WaitFor( text_of( '#worker-name' ) + ' === "Desk"' );
	await page.WaitFor( text_of( '#connection' ) + '.startsWith( "connected to" )' );
	await page.WaitFor( text_of( '#idle' ) + ' === "No job is running: waiting for one."' );
	await page.WaitFor( count_of( '.worker-side .side-item' ) + ' === 2' );
	ASSERT.deepEqual( page.Errors, [] );
} );


TEST( 'a running job: its plan, project and tool calls as they happen; Cancel ends it, and the jobs list keeps it', async function ()
{
	hold = true;
	await send_review( 'Running' );
	await page.WaitFor( text_of( '#current-title' ) + ' === "Running plan"' );
	await page.WaitFor( count_of( '#current .call' ) + ' === 2' );
	ASSERT.match( await page.Evaluate( text_of( '#current .call:first-child .call-text' ) ), /^Read a\.js/ );
	ASSERT.match( await page.Evaluate( text_of( '#current .call:last-child .call-result' ) ), /^a\.js$/ );
	ASSERT.match( await page.Evaluate( text_of( '#current .job-facts' ) ), /project Running/ );
	await page.Click( '#cancel' );
	await page.WaitFor( count_of( '#current' ) + ' === 0' );
	await page.WaitFor( count_of( '.job-row' ) + ' === 1' );
	ASSERT.equal( await page.Evaluate( text_of( '.job-row .status' ) ), 'cancelled' );
	ASSERT.deepEqual( page.Errors, [] );
} );


TEST( 'a finished job opens to its calls and the answer, and what Consensus did with it', async function ()
{
	hold = false;
	await send_review( 'Finished' );
	await page.WaitFor( count_of( '.job-row' ) + ' === 2' );
	await page.WaitFor( text_of( '.job-row:first-child .status' ) + ' === "done"' );
	await page.Click( '.job-row:first-child' );
	await page.WaitFor( count_of( '#selected .call' ) + ' === 2' );
	ASSERT.match( await page.Evaluate( text_of( '#selected-answer' ) ), /"Reply": "HERON is 1\."/ );
	ASSERT.match( await page.Evaluate( text_of( '#selected' ) ), /carried out 1 action/ );
	ASSERT.match( await page.Evaluate( text_of( '#selected .job-facts' ) ), /40 in, 4 out/ );
	ASSERT.deepEqual( page.Errors, [] );
} );


TEST( 'Pause and Resume; the theme and size', async function ()
{
	await page.Click( '#pause' );
	await page.WaitFor( text_of( '#paused' ) + ' === "Paused: no new jobs are taken."' );
	await page.WaitFor( text_of( '#idle' ) + ' === "No job is running."' );
	ASSERT.equal( worker.State().Paused, true );
	await page.Click( '#resume' );
	await page.WaitFor( 'getComputedStyle( document.getElementById( "paused" ) ).display === "none"' );
	ASSERT.equal( worker.State().Paused, false );
	await page.Evaluate( 'let select = document.getElementById( "theme-select" ); select.value = "dark"; select.dispatchEvent( new Event( "change" ) ); true' );
	await page.WaitFor( 'document.documentElement.dataset.bsTheme === "dark"' );
	await page.Evaluate( 'let size = document.getElementById( "scale-select" ); size.value = "large"; size.dispatchEvent( new Event( "change" ) ); true' );
	await page.WaitFor( 'getComputedStyle( document.documentElement ).getPropertyValue( "--scale" ).trim() === "1.15"' );
	ASSERT.deepEqual( page.Errors, [] );
} );
