'use strict';

// The API, started on port 0 over a temporary folder and driven with fetch.
// Nothing here spawns bin/consensus.js and nothing reads ~data.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const FS = require( 'fs' );
const OS = require( 'os' );
const PATH = require( 'path' );
const HTTP = require( 'http' );
const SERVER = require( '../src/Server.js' );
const PARTICIPANTS = require( '../src/Participants.js' );
const MAKER = require( './support/ZipMaker.js' );

const TEXT = [
	'# A proposal',
	'',
	'The first paragraph makes a claim about **anchors** and how they survive.',
	'',
	'- one list item',
	'- another list item to comment on',
	'',
	'A closing paragraph.',
	'',
].join( '\n' );

let running = null;
let token = null;

// The LLM, played by the tests: Answer( Prompt ) returns what the call answers, or throws.
let llm_answer = null;
let llm_prompts = [];


function fake_caller( Call )
{
	return async function ( Prompt )
	{
		llm_prompts.push( Prompt );
		return await llm_answer( Prompt, Call );
	};
}


function temporary_folder()
{
	return FS.mkdtempSync( PATH.join( OS.tmpdir(), 'consensus-api-' ) );
}


async function call( method, path, body, as_llm )
{
	let headers = {};
	if ( body !== undefined )
	{
		headers[ 'Content-Type' ] = 'application/json';
	}
	if ( as_llm === true )
	{
		headers.Authorization = 'Bearer ' + token;
	}
	else if ( typeof as_llm === 'string' )
	{
		headers.Authorization = as_llm;
	}
	let response = await fetch( running.Url + path, { method: method, headers: headers, body: ( body === undefined ) ? undefined : JSON.stringify( body ) } );
	let json = await response.json();
	return { Status: response.status, Body: json };
}


async function create( title, text )
{
	let result = await call( 'POST', '/api/proposals', { Title: title, Text: ( text === undefined ) ? TEXT : text } );
	ASSERT.equal( result.Status, 201 );
	return result.Body.Proposal;
}


// A thread by the owner on the given words, answered by the llm with an outcome.
async function discussed_thread( id, words, outcome )
{
	let thread = ( await call( 'POST', '/api/proposals/' + id + '/threads', { Anchor: { Text: words }, Text: 'Please reconsider this.' } ) ).Body.Thread;
	await call( 'POST', '/api/proposals/' + id + '/threads/' + thread.Id + '/replies', { Text: outcome }, true );
	return thread;
}


TEST.before( async function ()
{
	running = await SERVER.Start( { Data: temporary_folder(), Port: 0, Caller: fake_caller } );
	// The llm needs no token; these tests also play it over the API, so it gets one in memory.
	token = PARTICIPANTS.NewToken();
	running.Settings.Participants[ 1 ].Token = token;
} );


TEST.after( async function ()
{
	await running.Close();
} );


//---------------------------------------------------------------------

TEST( 'start writes the settings with Host 127.0.0.1 and listens there; the settings\' Host or the option moves it', async function ()
{
	ASSERT.equal( running.SettingsWritten, true );
	ASSERT.equal( running.Address.Host, '127.0.0.1' );
	ASSERT.equal( running.Address.Local, true );
	ASSERT.equal( running.Settings.Host, '127.0.0.1' );
	ASSERT.equal( FS.existsSync( running.Store.SettingsPath() ), true );
	// every interface, from the option; reached here at 127.0.0.1
	let everywhere = await SERVER.Start( { Data: temporary_folder(), Port: 0, Host: '0.0.0.0' } );
	ASSERT.deepEqual( [ everywhere.Address.Host, everywhere.Address.Local ], [ '0.0.0.0', false ] );
	ASSERT.equal( everywhere.Url, 'http://127.0.0.1:' + everywhere.Address.Port );
	ASSERT.equal( ( await fetch( everywhere.Url + '/api/me' ) ).status, 200 );
	await everywhere.Close();
	// from the settings' Host
	let folder = temporary_folder();
	let settings = PARTICIPANTS.DefaultSettings( 0 );
	settings.Host = 'localhost';
	FS.writeFileSync( PATH.join( folder, 'consensus.json' ), JSON.stringify( settings ) );
	let from_settings = await SERVER.Start( { Data: folder, Port: 0 } );
	ASSERT.deepEqual( [ from_settings.Address.Host, from_settings.Address.Local ], [ 'localhost', true ] );
	await from_settings.Close();
	let again = await SERVER.Start( { Data: running.Store.Folder, Port: 0 } );
	ASSERT.equal( again.SettingsWritten, false );
	ASSERT.deepEqual( again.Settings.Participants[ 1 ].Call, { Kind: 'claude-cli', Command: 'claude' } );
	ASSERT.equal( 'Token' in again.Settings.Participants[ 1 ], false );
	await again.Close();
} );


TEST( 'instructions: plain text, This server first with the address the request reached and the llm token, then the guide', async function ()
{
	let response = await fetch( running.Url + '/instructions' );
	ASSERT.equal( response.status, 200 );
	ASSERT.match( response.headers.get( 'content-type' ), /^text\/plain; charset=utf-8/ );
	let text = await response.text();
	ASSERT.ok( text.startsWith( '# This server\n' ) );
	ASSERT.ok( text.includes( '- API: ' + running.Url + '/api\n' ) );
	ASSERT.ok( text.includes( token ) );
	let guide = FS.readFileSync( PATH.join( __dirname, '..', '.guides', 'build-with-consensus.md' ), 'utf8' );
	ASSERT.ok( text.endsWith( guide ) );
	// the address is the one the request reached, as its Host header names it
	let by_name = await new Promise( function ( resolve, reject )
	{
		let request = HTTP.get( { host: '127.0.0.1', port: running.Address.Port, path: '/instructions', headers: { Host: 'consensus.example:8080' } }, function ( answer )
		{
			let body = '';
			answer.on( 'data', function ( chunk ) { body += chunk; } );
			answer.on( 'end', function () { resolve( body ); } );
		} );
		request.on( 'error', reject );
	} );
	ASSERT.ok( by_name.includes( '- API: http://consensus.example:8080/api\n' ) );
} );


TEST( 'identity: no header is the owner, the token is the llm, a wrong token is refused', async function ()
{
	let owner = await call( 'GET', '/api/me' );
	ASSERT.equal( owner.Status, 200 );
	ASSERT.deepEqual( owner.Body.Me, { Name: 'user', Display: 'User', Role: 'owner' } );
	ASSERT.equal( owner.Body.Participants.some( function ( participant ) { return 'Token' in participant; } ), false );
	let llm = await call( 'GET', '/api/me', undefined, true );
	ASSERT.equal( llm.Body.Me.Name, 'llm' );
	let wrong = await call( 'GET', '/api/me', undefined, 'Bearer nope' );
	ASSERT.equal( wrong.Status, 401 );
	ASSERT.equal( wrong.Body.Error, 'unknown token' );
} );


TEST( 'a proposal is created, listed with its tally, read, and retitled', async function ()
{
	let proposal = await create( 'First proposal' );
	ASSERT.equal( proposal.State, 'Proposal' );
	ASSERT.equal( proposal.Revision, 1 );
	ASSERT.equal( proposal.StateLine, 'no threads yet' );
	let list = await call( 'GET', '/api/proposals' );
	ASSERT.ok( list.Body.Proposals.some( function ( candidate ) { return candidate.Id === proposal.Id; } ) );
	let read = await call( 'GET', '/api/proposals/' + proposal.Id );
	ASSERT.equal( read.Status, 200 );
	ASSERT.equal( read.Body.Text, TEXT );
	ASSERT.deepEqual( read.Body.Threads, [] );
	ASSERT.equal( read.Body.Proposal.Tally.Total, 0 );
	let retitled = await call( 'PUT', '/api/proposals/' + proposal.Id, { Title: 'Renamed' } );
	ASSERT.equal( retitled.Body.Proposal.Title, 'Renamed' );
	ASSERT.equal( retitled.Body.Proposal.Id, proposal.Id );
	ASSERT.equal( ( await call( 'POST', '/api/proposals', { Text: 'no title' } ) ).Status, 400 );
	ASSERT.equal( ( await call( 'GET', '/api/proposals/none' ) ).Status, 404 );
	ASSERT.equal( ( await call( 'GET', '/api/nothing' ) ).Status, 404 );
} );


TEST( 'a thread anchors to visible text, or to the whole document; missing words are refused', async function ()
{
	let proposal = await create( 'Threads' );
	let anchored = await call( 'POST', '/api/proposals/' + proposal.Id + '/threads', { Anchor: { Text: 'anchors and how they survive' }, Text: 'Do they?' } );
	ASSERT.equal( anchored.Status, 201 );
	let thread = anchored.Body.Thread;
	ASSERT.equal( thread.Status, 'contested' );
	ASSERT.equal( thread.Anchor.Text, 'anchors and how they survive' );
	ASSERT.equal( thread.Anchor.Prefix.length > 0, true );
	ASSERT.equal( thread.Found.Method, 'exact' );
	ASSERT.deepEqual( thread.Turn, [ 'llm' ] );
	ASSERT.equal( thread.WaitingOnMe, false );
	ASSERT.equal( thread.Replies.length, 1 );
	ASSERT.equal( thread.Replies[ 0 ].By, 'user' );
	let whole = await call( 'POST', '/api/proposals/' + proposal.Id + '/threads', { Anchor: null, Text: 'On the whole thing.' }, true );
	ASSERT.equal( whole.Body.Thread.Anchor, null );
	ASSERT.equal( whole.Body.Thread.Found, null );
	ASSERT.deepEqual( whole.Body.Thread.Turn, [ 'user' ] );
	let missing = await call( 'POST', '/api/proposals/' + proposal.Id + '/threads', { Anchor: { Text: 'words that are not there' }, Text: 'x' } );
	ASSERT.equal( missing.Status, 400 );
	ASSERT.equal( ( await call( 'POST', '/api/proposals/' + proposal.Id + '/threads', { Text: '  ' } ) ).Status, 400 );
	let read = await call( 'GET', '/api/proposals/' + proposal.Id );
	ASSERT.equal( read.Body.Proposal.Tally.Contested, 2 );
	ASSERT.equal( read.Body.Proposal.StateLine, '2 contested, waiting on you 1' );
	let filtered = await call( 'GET', '/api/proposals/' + proposal.Id + '/threads?status=mine', undefined, true );
	ASSERT.deepEqual( filtered.Body.Threads.map( function ( candidate ) { return candidate.Id; } ), [ thread.Id ] );
	ASSERT.equal( ( await call( 'GET', '/api/proposals/' + proposal.Id + '/threads?status=bogus' ) ).Status, 400 );
} );


TEST( 'only the owner resolves; a reply to a resolved thread reopens it', async function ()
{
	let proposal = await create( 'Resolve' );
	let thread = await discussed_thread( proposal.Id, 'one list item', 'Outcome: the item is reworded.' );
	let by_llm = await call( 'POST', '/api/proposals/' + proposal.Id + '/threads/' + thread.Id + '/resolve', undefined, true );
	ASSERT.equal( by_llm.Status, 403 );
	let resolved = await call( 'POST', '/api/proposals/' + proposal.Id + '/threads/' + thread.Id + '/resolve' );
	ASSERT.equal( resolved.Status, 200 );
	ASSERT.equal( resolved.Body.Thread.Status, 'resolved' );
	ASSERT.equal( resolved.Body.Thread.State, 'resolved' );
	ASSERT.equal( resolved.Body.Thread.Resolved.By, 'user' );
	ASSERT.deepEqual( resolved.Body.Thread.Turn, [ 'llm' ] );
	ASSERT.equal( ( await call( 'POST', '/api/proposals/' + proposal.Id + '/threads/' + thread.Id + '/resolve' ) ).Status, 409 );
	let read = await call( 'GET', '/api/proposals/' + proposal.Id );
	ASSERT.equal( read.Body.Proposal.StateLine, '1 resolved' );
	let reply = await call( 'POST', '/api/proposals/' + proposal.Id + '/threads/' + thread.Id + '/replies', { Text: 'Wait, one more thing.' } );
	ASSERT.equal( reply.Status, 201 );
	ASSERT.equal( reply.Body.Reopened, true );
	ASSERT.equal( reply.Body.Thread.Status, 'contested' );
	ASSERT.equal( reply.Body.Thread.Reopened, true );
	ASSERT.equal( reply.Body.Thread.Resolved, null );
	let reopened = await call( 'GET', '/api/proposals/' + proposal.Id + '/threads?status=reopened' );
	ASSERT.equal( reopened.Body.Threads.length, 1 );
	ASSERT.equal( ( await call( 'GET', '/api/proposals/' + proposal.Id ) ).Body.Proposal.StateLine, '1 contested, 1 reopened' );
	ASSERT.equal( ( await call( 'GET', '/api/proposals/' + proposal.Id, undefined, true ) ).Body.Proposal.StateLine, '1 contested, waiting on you 1, 1 reopened' );
	ASSERT.equal( ( await call( 'POST', '/api/proposals/' + proposal.Id + '/threads/none/replies', { Text: 'x' } ) ).Status, 404 );
} );


TEST( 'reply and resolve: the owner\'s reply becomes the outcome in one request; no one else may', async function ()
{
	let proposal = await create( 'Reply and resolve' );
	let thread = await discussed_thread( proposal.Id, 'one list item', 'Question: keep it, or drop it? I would keep it.' );
	let path = '/api/proposals/' + proposal.Id + '/threads/' + thread.Id + '/replies';
	let by_llm = await call( 'POST', path, { Text: 'Keep it.', Resolve: true }, true );
	ASSERT.equal( by_llm.Status, 403 );
	let read = await call( 'GET', '/api/proposals/' + proposal.Id );
	ASSERT.equal( thread_of_body( read, thread.Id ).Replies.length, 2 );
	let both = await call( 'POST', path, { Text: 'Drop it.', Resolve: true } );
	ASSERT.equal( both.Status, 201 );
	ASSERT.equal( both.Body.Resolved, true );
	ASSERT.equal( both.Body.Thread.Status, 'resolved' );
	ASSERT.equal( both.Body.Thread.Resolved.By, 'user' );
	ASSERT.deepEqual( both.Body.Thread.Turn, [ 'llm' ] );
	let replies = both.Body.Thread.Replies;
	ASSERT.deepEqual( [ replies[ replies.length - 1 ].By, replies[ replies.length - 1 ].Text ], [ 'user', 'Drop it.' ] );
	// a plain reply is as it was: it reopens the resolved thread
	let plain = await call( 'POST', path, { Text: 'On second thought.' } );
	ASSERT.equal( plain.Body.Resolved, false );
	ASSERT.equal( plain.Body.Thread.Status, 'contested' );
} );


TEST( 'comment and resolve: the owner posts a thread already resolved, its comment the outcome; no one else may', async function ()
{
	let proposal = await create( 'Comment and resolve' );
	let path = '/api/proposals/' + proposal.Id + '/threads';
	let by_llm = await call( 'POST', path, { Text: 'Drop the last line.', Resolve: true }, true );
	ASSERT.equal( by_llm.Status, 403 );
	ASSERT.equal( ( await call( 'GET', path ) ).Body.Threads.length, 0 );
	let posted = await call( 'POST', path, { Text: 'Drop the last line.', Resolve: true } );
	ASSERT.equal( posted.Status, 201 );
	ASSERT.equal( posted.Body.Thread.Status, 'resolved' );
	ASSERT.equal( posted.Body.Thread.Resolved.By, 'user' );
	ASSERT.deepEqual( posted.Body.Thread.Turn, [ 'llm' ] );
	ASSERT.equal( posted.Body.Thread.Replies.length, 1 );
	// without Resolve, a new thread is contested as before
	let plain = await call( 'POST', path, { Text: 'Why this line?' } );
	ASSERT.equal( plain.Body.Thread.Status, 'contested' );
} );


function thread_of_body( read, thread_id )
{
	return read.Body.Threads.find( function ( thread ) { return thread.Id === thread_id; } );
}


TEST( 'only the owner deletes a thread, applied or not; the revision it made keeps its text', async function ()
{
	let proposal = await create( 'Delete a thread' );
	let thread = await discussed_thread( proposal.Id, 'one list item', 'Outcome: the item is reworded.' );
	await call( 'POST', '/api/proposals/' + proposal.Id + '/threads/' + thread.Id + '/resolve' );
	let applied = await call( 'POST', '/api/proposals/' + proposal.Id + '/threads/' + thread.Id + '/apply', { Text: TEXT.replace( 'one list item', 'one reworded item' ), Revision: 1, Outcome: 'reworded' }, true );
	ASSERT.equal( applied.Status, 200 );
	let other = ( await call( 'POST', '/api/proposals/' + proposal.Id + '/threads', { Text: 'A second thread.' } ) ).Body.Thread;
	let path = '/api/proposals/' + proposal.Id + '/threads/' + thread.Id;
	ASSERT.equal( ( await call( 'DELETE', path, undefined, true ) ).Status, 403 );
	let deleted = await call( 'DELETE', path );
	ASSERT.equal( deleted.Status, 200 );
	ASSERT.equal( deleted.Body.Deleted, thread.Id );
	ASSERT.equal( ( await call( 'DELETE', path ) ).Status, 404 );
	let read = await call( 'GET', '/api/proposals/' + proposal.Id );
	ASSERT.deepEqual( read.Body.Threads.map( function ( candidate ) { return candidate.Id; } ), [ other.Id ] );
	ASSERT.match( read.Body.Text, /one reworded item/ );
	let revisions = await call( 'GET', '/api/proposals/' + proposal.Id + '/revisions' );
	ASSERT.equal( revisions.Body.Revisions[ 1 ].Thread, thread.Id );
	ASSERT.equal( ( await call( 'DELETE', '/api/proposals/none/threads/' + other.Id ) ).Status, 404 );
} );


TEST( 'apply: resolved threads only, a text change makes a revision tied to the thread, a stale revision is refused', async function ()
{
	let proposal = await create( 'Apply' );
	let thread = await discussed_thread( proposal.Id, 'another list item to comment on', 'Outcome: the item says "a reworded list item".' );
	let too_early = await call( 'POST', '/api/proposals/' + proposal.Id + '/threads/' + thread.Id + '/apply', { Outcome: 'x', Revision: 1 }, true );
	ASSERT.equal( too_early.Status, 409 );
	await call( 'POST', '/api/proposals/' + proposal.Id + '/threads/' + thread.Id + '/resolve' );
	let new_text = TEXT.replace( 'another list item to comment on', 'a reworded list item' );
	let stale = await call( 'POST', '/api/proposals/' + proposal.Id + '/threads/' + thread.Id + '/apply', { Text: new_text, Outcome: 'reworded', Revision: 7 }, true );
	ASSERT.equal( stale.Status, 409 );
	ASSERT.equal( stale.Body.Revision, 1 );
	ASSERT.equal( ( await call( 'POST', '/api/proposals/' + proposal.Id + '/threads/' + thread.Id + '/apply', { Text: new_text, Revision: 1 }, true ) ).Status, 400 );
	// an anchor not found in the new text is refused before anything is written: no revision, the thread still resolved
	let lost = await call( 'POST', '/api/proposals/' + proposal.Id + '/threads/' + thread.Id + '/apply', { Text: new_text, Outcome: 'reworded', Revision: 1, Anchor: { Text: '`a reworded list item`' } }, true );
	ASSERT.equal( lost.Status, 400 );
	let unchanged = await call( 'GET', '/api/proposals/' + proposal.Id );
	ASSERT.equal( unchanged.Body.Proposal.Revision, 1 );
	ASSERT.equal( unchanged.Body.Text, TEXT );
	ASSERT.equal( thread_of_body( unchanged, thread.Id ).State, 'resolved' );
	let applied =await call( 'POST', '/api/proposals/' + proposal.Id + '/threads/' + thread.Id + '/apply', { Text: new_text, Outcome: 'reworded', Revision: 1, Anchor: { Text: 'a reworded list item' } }, true );
	ASSERT.equal( applied.Status, 200 );
	ASSERT.equal( applied.Body.Proposal.Revision, 2 );
	ASSERT.equal( applied.Body.Thread.Applied.By, 'llm' );
	ASSERT.equal( applied.Body.Thread.Applied.Revision, 2 );
	ASSERT.equal( applied.Body.Thread.Applied.Outcome, 'reworded' );
	ASSERT.equal( applied.Body.Thread.Anchor.Text, 'a reworded list item' );
	ASSERT.equal( applied.Body.Thread.Found.Method, 'exact' );
	ASSERT.deepEqual( applied.Body.Thread.Turn, [] );
	ASSERT.equal( applied.Body.Proposal.StateLine, '1 applied' );
	let revisions = await call( 'GET', '/api/proposals/' + proposal.Id + '/revisions' );
	ASSERT.equal( revisions.Body.Revisions.length, 2 );
	ASSERT.equal( revisions.Body.Revisions[ 1 ].Reason, 'apply' );
	ASSERT.equal( revisions.Body.Revisions[ 1 ].Thread, thread.Id );
	ASSERT.equal( revisions.Body.Revisions[ 1 ].By, 'llm' );
	let second = await call( 'GET', '/api/proposals/' + proposal.Id + '/revisions/2' );
	ASSERT.equal( second.Body.Revision.Text, new_text );
	ASSERT.equal( ( await call( 'GET', '/api/proposals/' + proposal.Id + '/revisions/1' ) ).Body.Revision.Text, TEXT );
	ASSERT.equal( ( await call( 'GET', '/api/proposals/' + proposal.Id + '/revisions/9' ) ).Status, 404 );
	ASSERT.equal( ( await call( 'POST', '/api/proposals/' + proposal.Id + '/threads/' + thread.Id + '/apply', { Outcome: 'again', Revision: 2 }, true ) ).Status, 409 );
	// an outcome without a text change makes no revision
	let dropped = await discussed_thread( proposal.Id, 'A closing paragraph', 'Outcome: dropped.' );
	await call( 'POST', '/api/proposals/' + proposal.Id + '/threads/' + dropped.Id + '/resolve' );
	let only_outcome = await call( 'POST', '/api/proposals/' + proposal.Id + '/threads/' + dropped.Id + '/apply', { Outcome: 'dropped' }, true );
	ASSERT.equal( only_outcome.Status, 200 );
	ASSERT.equal( only_outcome.Body.Proposal.Revision, 2 );
	ASSERT.equal( only_outcome.Body.Thread.Applied.Revision, 2 );
} );


TEST( 'anchors follow an applied change: kept, moved by context, or detached and re-anchored', async function ()
{
	let proposal = await create( 'Anchors' );
	let kept = await discussed_thread( proposal.Id, 'A closing paragraph', 'Outcome: keep.' );
	let moved = await discussed_thread( proposal.Id, 'one list item', 'Outcome: reword.' );
	let lost = await discussed_thread( proposal.Id, 'another list item to comment on', 'Outcome: remove.' );
	await call( 'POST', '/api/proposals/' + proposal.Id + '/threads/' + lost.Id + '/resolve' );
	let new_text = TEXT.replace( '- one list item\n', '- one changed item\n' ).replace( '- another list item to comment on\n', '' );
	let applied = await call( 'POST', '/api/proposals/' + proposal.Id + '/threads/' + lost.Id + '/apply', { Text: new_text, Outcome: 'removed', Revision: 1 }, true );
	ASSERT.equal( applied.Status, 200 );
	let read = await call( 'GET', '/api/proposals/' + proposal.Id );
	let by_id = {};
	for ( let thread of read.Body.Threads )
	{
		by_id[ thread.Id ] = thread;
	}
	ASSERT.equal( by_id[ kept.Id ].Detached, false );
	ASSERT.equal( by_id[ kept.Id ].Found.Method, 'exact' );
	ASSERT.equal( by_id[ moved.Id ].Detached, false );
	ASSERT.equal( by_id[ moved.Id ].Anchor.Text, 'one changed item' );
	ASSERT.equal( by_id[ moved.Id ].Found.Method, 'exact' );
	ASSERT.equal( by_id[ lost.Id ].Detached, true );
	ASSERT.equal( by_id[ lost.Id ].Found, null );
	ASSERT.equal( read.Body.Proposal.Tally.Detached, 1 );
	let detached = await call( 'GET', '/api/proposals/' + proposal.Id + '/threads?status=detached' );
	ASSERT.deepEqual( detached.Body.Threads.map( function ( thread ) { return thread.Id; } ), [ lost.Id ] );
	ASSERT.equal( ( await call( 'POST', '/api/proposals/' + proposal.Id + '/threads/' + lost.Id + '/anchor', { Anchor: { Text: 'not present' } } ) ).Status, 400 );
	let re_anchored = await call( 'POST', '/api/proposals/' + proposal.Id + '/threads/' + lost.Id + '/anchor', { Anchor: { Text: 'A closing paragraph' } } );
	ASSERT.equal( re_anchored.Status, 200 );
	ASSERT.equal( re_anchored.Body.Thread.Detached, false );
	ASSERT.equal( re_anchored.Body.Thread.Found.Method, 'exact' );
} );


TEST( 'state: anyone sets any of the States at any time; an edit or a comment leaves it as it is', async function ()
{
	let proposal = await create( 'States' );
	let thread = await discussed_thread( proposal.Id, 'one list item', 'Outcome: nothing to change.' );
	// with a thread still contested, by the llm
	let working = await call( 'PUT', '/api/proposals/' + proposal.Id + '/state', { State: 'Working' }, true );
	ASSERT.equal( working.Status, 200 );
	ASSERT.equal( working.Body.Proposal.State, 'Working' );
	ASSERT.equal( working.Body.Proposal.StateLine, '1 contested' );
	ASSERT.equal( ( await call( 'PUT', '/api/proposals/' + proposal.Id + '/state', { State: 'Done' } ) ).Status, 400 );
	ASSERT.equal( ( await call( 'PUT', '/api/proposals/' + proposal.Id + '/state', {} ) ).Status, 400 );
	ASSERT.equal( ( await call( 'PUT', '/api/proposals/none/state', { State: 'Plan' } ) ).Status, 404 );
	ASSERT.equal( ( await call( 'POST', '/api/proposals/' + proposal.Id + '/approve' ) ).Status, 404 );
	let listed = await call( 'GET', '/api/proposals?state=Working' );
	ASSERT.deepEqual( listed.Body.Proposals.map( function ( candidate ) { return candidate.Id; } ), [ proposal.Id ] );
	// a manual edit from a stale revision is refused; from the current one it makes a revision and keeps the state
	let stale = await call( 'PUT', '/api/proposals/' + proposal.Id + '/text', { Text: TEXT + '\nMore.\n', Revision: 0 } );
	ASSERT.equal( stale.Status, 409 );
	ASSERT.equal( stale.Body.Revision, 1 );
	let edited = await call( 'PUT', '/api/proposals/' + proposal.Id + '/text', { Text: TEXT + '\nMore.\n', Revision: 1 } );
	ASSERT.equal( edited.Status, 200 );
	ASSERT.equal( edited.Body.Proposal.State, 'Working' );
	ASSERT.equal( edited.Body.Proposal.Revision, 2 );
	ASSERT.equal( ( await call( 'GET', '/api/proposals/' + proposal.Id + '/revisions' ) ).Body.Revisions[ 1 ].Reason, 'edit' );
	// a manual edit changes no thread's status
	await call( 'POST', '/api/proposals/' + proposal.Id + '/threads/' + thread.Id + '/resolve' );
	await call( 'PUT', '/api/proposals/' + proposal.Id + '/text', { Text: TEXT, Revision: 2 } );
	let after_edit = await call( 'GET', '/api/proposals/' + proposal.Id );
	ASSERT.equal( after_edit.Body.Threads[ 0 ].Status, 'resolved' );
	// a comment keeps the state too
	await call( 'POST', '/api/proposals/' + proposal.Id + '/threads', { Anchor: null, Text: 'Another thought.' } );
	ASSERT.equal( ( await call( 'GET', '/api/proposals/' + proposal.Id ) ).Body.Proposal.State, 'Working' );
	// a new proposal starts in the first state, or in one it names
	ASSERT.equal( ( await call( 'POST', '/api/proposals', { Title: 'Named', Text: TEXT, State: 'Plan' } ) ).Body.Proposal.State, 'Plan' );
	ASSERT.equal( ( await call( 'POST', '/api/proposals', { Title: 'Bad', Text: TEXT, State: 'Nope' } ) ).Status, 400 );
	let me = await call( 'GET', '/api/me' );
	ASSERT.deepEqual( me.Body.States, [ 'Proposal', 'Plan', 'Working', 'Finished' ] );
} );


TEST( 'waiting lists each participant\'s threads across proposals', async function ()
{
	let a = await create( 'Waiting A' );
	let b = await create( 'Waiting B' );
	let asked = ( await call( 'POST', '/api/proposals/' + a.Id + '/threads', { Anchor: null, Text: 'A question for the llm.' } ) ).Body.Thread;
	let answered = await discussed_thread( b.Id, 'one list item', 'Outcome: answered.' );
	let llm = await call( 'GET', '/api/waiting', undefined, true );
	ASSERT.equal( llm.Body.Me.Name, 'llm' );
	let llm_threads = llm.Body.Waiting.filter( function ( item ) { return item.Proposal.Id === a.Id || item.Proposal.Id === b.Id; } );
	ASSERT.deepEqual( llm_threads.map( function ( item ) { return item.Thread.Id; } ), [ asked.Id ] );
	ASSERT.equal( llm_threads[ 0 ].Proposal.Title, 'Waiting A' );
	let user = await call( 'GET', '/api/waiting' );
	let user_threads = user.Body.Waiting.filter( function ( item ) { return item.Proposal.Id === a.Id || item.Proposal.Id === b.Id; } );
	ASSERT.deepEqual( user_threads.map( function ( item ) { return item.Thread.Id; } ), [ answered.Id ] );
	await call( 'POST', '/api/proposals/' + b.Id + '/threads/' + answered.Id + '/resolve' );
	let llm_again = await call( 'GET', '/api/waiting', undefined, true );
	let ids = llm_again.Body.Waiting.filter( function ( item ) { return item.Proposal.Id === b.Id; } ).map( function ( item ) { return item.Thread.Id; } );
	ASSERT.deepEqual( ids, [ answered.Id ] );
} );


TEST( 'a deleted proposal goes to the trash', async function ()
{
	let proposal = await create( 'Trash me' );
	ASSERT.equal( ( await call( 'DELETE', '/api/proposals/' + proposal.Id ) ).Body.Trashed, proposal.Id );
	ASSERT.equal( ( await call( 'GET', '/api/proposals/' + proposal.Id ) ).Status, 404 );
	ASSERT.equal( ( await call( 'DELETE', '/api/proposals/' + proposal.Id ) ).Status, 404 );
	let trash = await call( 'GET', '/api/trash' );
	ASSERT.ok( trash.Body.Proposals.some( function ( candidate ) { return candidate.Id === proposal.Id; } ) );
} );


TEST( 'search follows every change and answers passages and threads across proposals', async function ()
{
	let proposal = await create( 'Searchable', '# Searchable\n\nThe quorum threshold is two thirds of the members.\n\nAnother paragraph about nothing in particular.\n' );
	let thread = ( await call( 'POST', '/api/proposals/' + proposal.Id + '/threads', { Anchor: { Text: 'quorum threshold' }, Text: 'Why two thirds and not a simple majority?' } ) ).Body.Thread;
	await call( 'POST', '/api/proposals/' + proposal.Id + '/threads/' + thread.Id + '/replies', { Text: 'Outcome: a simple majority is too easy to game.' }, true );
	// the index is refreshed in the background after each change
	let hits = null;
	for ( let attempt = 0; attempt < 50; attempt++ )
	{
		let answer = await call( 'GET', '/api/search?q=' + encodeURIComponent( 'majority easy to game' ) );
		ASSERT.equal( answer.Status, 200 );
		hits = answer.Body.Hits;
		if ( hits.length && hits[ 0 ].Thread === thread.Id )
		{
			break;
		}
		await new Promise( function ( resolve ) { setTimeout( resolve, 50 ); } );
	}
	ASSERT.equal( hits[ 0 ].Thread, thread.Id );
	ASSERT.equal( hits[ 0 ].Proposal, proposal.Id );
	ASSERT.equal( hits[ 0 ].Title, 'Searchable' );
	let passage = await call( 'GET', '/api/search?q=' + encodeURIComponent( 'quorum threshold two thirds' ) + '&limit=3' );
	ASSERT.ok( passage.Body.Hits.length <= 3 );
	ASSERT.equal( passage.Body.Hits[ 0 ].Proposal, proposal.Id );
	ASSERT.equal( passage.Body.Hits[ 0 ].Thread === null || passage.Body.Hits[ 0 ].Thread === thread.Id, true );
	ASSERT.equal( passage.Body.Hits.some( function ( hit ) { return hit.Thread === null && /two thirds/.test( hit.Text ); } ), true );
	ASSERT.equal( ( await call( 'GET', '/api/search' ) ).Status, 400 );
	ASSERT.equal( ( await call( 'GET', '/api/search?q=xyzzyplugh' ) ).Body.Hits.length, 0 );
	let index = await running.Store.ReadIndex( proposal.Id );
	ASSERT.equal( index.some( function ( chunk ) { return chunk.Thread === thread.Id; } ), true );
} );


TEST( 'every change sends a Server-Sent Event { Proposal, Kind }', async function ()
{
	let response = await fetch( running.Url + '/api/events' );
	ASSERT.equal( response.headers.get( 'content-type' ), 'text/event-stream' );
	let reader = response.body.getReader();
	let decoder = new TextDecoder();
	let buffer = '';
	async function next_event()
	{
		while ( true )
		{
			let match = /event: change\ndata: (.*)\n\n/.exec( buffer );
			if ( match )
			{
				buffer = buffer.slice( match.index + match[ 0 ].length );
				return JSON.parse( match[ 1 ] );
			}
			let chunk = await reader.read();
			if ( chunk.done )
			{
				return null;
			}
			buffer += decoder.decode( chunk.value, { stream: true } );
		}
	}
	let proposal = await create( 'Events' );
	ASSERT.deepEqual( await next_event(), { Project: 'default', Kind: 'project' } );
	ASSERT.deepEqual( await next_event(), { Proposal: proposal.Id, Kind: 'created' } );
	let thread = ( await call( 'POST', '/api/proposals/' + proposal.Id + '/threads', { Anchor: null, Text: 'Hello?' } ) ).Body.Thread;
	ASSERT.deepEqual( await next_event(), { Proposal: proposal.Id, Kind: 'thread', Thread: thread.Id } );
	await call( 'POST', '/api/proposals/' + proposal.Id + '/threads/' + thread.Id + '/replies', { Text: 'Hello.' }, true );
	ASSERT.equal( ( await next_event() ).Kind, 'reply' );
	await call( 'POST', '/api/proposals/' + proposal.Id + '/threads/' + thread.Id + '/resolve' );
	ASSERT.equal( ( await next_event() ).Kind, 'resolved' );
	await call( 'POST', '/api/proposals/' + proposal.Id + '/threads/' + thread.Id + '/apply', { Outcome: 'said hello' }, true );
	ASSERT.equal( ( await next_event() ).Kind, 'applied' );
	await call( 'PUT', '/api/proposals/' + proposal.Id + '/state', { State: 'Plan' } );
	ASSERT.equal( ( await next_event() ).Kind, 'state' );
	await call( 'PUT', '/api/proposals/' + proposal.Id + '/text', { Text: 'changed', Revision: 1 } );
	ASSERT.equal( ( await next_event() ).Kind, 'text' );
	await call( 'DELETE', '/api/proposals/' + proposal.Id );
	ASSERT.deepEqual( await next_event(), { Project: 'default', Kind: 'project' } );
	ASSERT.equal( ( await next_event() ).Kind, 'trashed' );
	await reader.cancel();
} );


//---------------------------------------------------------------------
// Move and copy

TEST( 'items move within a project and into another; a folder never goes inside itself', async function ()
{
	let plan = await create( 'Mover' );
	let project = ( await call( 'POST', '/api/projects', { Name: 'Destination' } ) ).Body.Project;
	let outer = ( await call( 'POST', '/api/projects/' + project.Id + '/folders', { Name: 'Outer' } ) ).Body.Folder;
	let inner = ( await call( 'POST', '/api/projects/' + project.Id + '/folders', { Name: 'Inner', Parent: outer.Id } ) ).Body.Folder;

	let moved = await call( 'POST', '/api/items/' + plan.Id + '/move', { Project: project.Id, Parent: inner.Id } );
	ASSERT.equal( moved.Status, 200 );
	ASSERT.deepEqual( moved.Body.Project.Items[ 0 ].Items[ 0 ].Items, [ { Kind: 'plan', Id: plan.Id } ] );
	let default_items = ( await call( 'GET', '/api/projects' ) ).Body.Projects[ 0 ].Items;
	ASSERT.equal( default_items.some( function ( item ) { return item.Id === plan.Id; } ), false );
	ASSERT.equal( ( await call( 'GET', '/api/proposals/' + plan.Id ) ).Body.Project.Id, project.Id );

	// within the project, to its root; then a folder into its own child is refused
	let to_root = await call( 'POST', '/api/items/' + plan.Id + '/move', { Project: project.Id } );
	ASSERT.deepEqual( to_root.Body.Project.Items.map( function ( item ) { return item.Id; } ), [ outer.Id, plan.Id ] );
	ASSERT.equal( ( await call( 'POST', '/api/items/' + outer.Id + '/move', { Project: project.Id, Parent: inner.Id } ) ).Status, 400 );
	ASSERT.equal( ( await call( 'POST', '/api/items/' + outer.Id + '/move', { Project: project.Id, Parent: outer.Id } ) ).Status, 400 );

	// a folder moves with everything in it, into another project
	await call( 'POST', '/api/items/' + plan.Id + '/move', { Project: project.Id, Parent: inner.Id } );
	let folder_moved = await call( 'POST', '/api/items/' + outer.Id + '/move', { Project: 'default' } );
	ASSERT.equal( folder_moved.Status, 200 );
	ASSERT.equal( ( await call( 'GET', '/api/proposals/' + plan.Id ) ).Body.Project.Id, 'default' );

	// refusals
	ASSERT.equal( ( await call( 'POST', '/api/items/nothing/move', { Project: 'default' } ) ).Status, 404 );
	ASSERT.equal( ( await call( 'POST', '/api/items/' + plan.Id + '/move', {} ) ).Status, 400 );
	ASSERT.equal( ( await call( 'POST', '/api/items/' + plan.Id + '/move', { Project: 'none-000000' } ) ).Status, 404 );
	ASSERT.equal( ( await call( 'POST', '/api/items/' + plan.Id + '/move', { Project: 'default', Parent: 'fnothing' } ) ).Status, 400 );
} );


TEST( 'an item goes just before another; a project moves in the order', async function ()
{
	let project = ( await call( 'POST', '/api/projects', { Name: 'Ordering' } ) ).Body.Project;
	let a = await create( 'A' );
	let b = await create( 'B' );
	let c = await create( 'C' );
	for ( let plan of [ a, b, c ] )
	{
		await call( 'POST', '/api/items/' + plan.Id + '/move', { Project: project.Id } );
	}
	function ids( body ) { return body.Project.Items.map( function ( item ) { return item.Id; } ); }
	// C just before A, then A to the end, within the root
	let moved = await call( 'POST', '/api/items/' + c.Id + '/move', { Project: project.Id, Before: a.Id } );
	ASSERT.deepEqual( ids( moved.Body ), [ c.Id, a.Id, b.Id ] );
	moved = await call( 'POST', '/api/items/' + a.Id + '/move', { Project: project.Id } );
	ASSERT.deepEqual( ids( moved.Body ), [ c.Id, b.Id, a.Id ] );
	// into a folder, just before what it holds
	let folder = ( await call( 'POST', '/api/projects/' + project.Id + '/folders', { Name: 'Box' } ) ).Body.Folder;
	await call( 'POST', '/api/items/' + b.Id + '/move', { Project: project.Id, Parent: folder.Id } );
	moved = await call( 'POST', '/api/items/' + c.Id + '/move', { Project: project.Id, Parent: folder.Id, Before: b.Id } );
	ASSERT.deepEqual( moved.Body.Project.Items[ 1 ].Items.map( function ( item ) { return item.Id; } ), [ c.Id, b.Id ] );
	ASSERT.equal( ( await call( 'POST', '/api/items/' + c.Id + '/move', { Project: project.Id, Before: c.Id } ) ).Status, 400 );

	// the project, before Default, then back to the end
	let order = await call( 'POST', '/api/projects/' + project.Id + '/move', { Before: 'default' } );
	ASSERT.equal( order.Status, 200 );
	ASSERT.equal( order.Body.Projects[ 0 ].Id, project.Id );
	order = await call( 'POST', '/api/projects/' + project.Id + '/move', {} );
	ASSERT.equal( order.Body.Projects[ order.Body.Projects.length - 1 ].Id, project.Id );
	ASSERT.equal( ( await call( 'GET', '/api/projects' ) ).Body.Projects[ 0 ].Id, 'default' );
	ASSERT.equal( ( await call( 'POST', '/api/projects/none/move', {} ) ).Status, 404 );
	ASSERT.equal( ( await call( 'POST', '/api/projects/' + project.Id + '/move', { Before: 'none' } ) ).Status, 400 );
} );


TEST( 'a copied plan carries its text, threads and revisions; a copied folder copies everything in it', async function ()
{
	let plan = await create( 'Original' );
	let thread = await discussed_thread( plan.Id, 'one list item', 'Outcome: keep it.' );
	await call( 'PUT', '/api/proposals/' + plan.Id + '/text', { Text: TEXT + '\nEdited.\n', Revision: 1 } );
	let project = ( await call( 'POST', '/api/projects', { Name: 'Copies' } ) ).Body.Project;

	let copied = await call( 'POST', '/api/items/' + plan.Id + '/copy', { Project: project.Id } );
	ASSERT.equal( copied.Status, 201 );
	let copy_id = copied.Body.Node.Id;
	ASSERT.notEqual( copy_id, plan.Id );
	let copy = ( await call( 'GET', '/api/proposals/' + copy_id ) ).Body;
	ASSERT.equal( copy.Proposal.Title, 'Original (copy)' );
	ASSERT.equal( copy.Proposal.Revision, 2 );
	ASSERT.equal( copy.Text, TEXT + '\nEdited.\n' );
	ASSERT.deepEqual( copy.Threads.map( function ( t ) { return t.Id; } ), [ thread.Id ] );
	ASSERT.equal( copy.Threads[ 0 ].Replies.length, 2 );
	ASSERT.equal( copy.Project.Id, project.Id );
	ASSERT.equal( ( await call( 'GET', '/api/proposals/' + copy_id + '/revisions' ) ).Body.Revisions.length, 2 );
	// the original is where it was, unchanged
	ASSERT.equal( ( await call( 'GET', '/api/proposals/' + plan.Id ) ).Body.Project.Id, 'default' );

	// a folder with a plan in it
	let folder = ( await call( 'POST', '/api/projects/' + project.Id + '/folders', { Name: 'Bundle' } ) ).Body.Folder;
	await call( 'POST', '/api/items/' + copy_id + '/move', { Project: project.Id, Parent: folder.Id } );
	let folder_copy = await call( 'POST', '/api/items/' + folder.Id + '/copy', { Project: 'default' } );
	ASSERT.equal( folder_copy.Status, 201 );
	let node = folder_copy.Body.Node;
	ASSERT.equal( node.Kind, 'folder' );
	ASSERT.equal( node.Name, 'Bundle' );
	ASSERT.notEqual( node.Id, folder.Id );
	ASSERT.equal( node.Items.length, 1 );
	ASSERT.notEqual( node.Items[ 0 ].Id, copy_id );
	ASSERT.equal( ( await call( 'GET', '/api/proposals/' + node.Items[ 0 ].Id ) ).Body.Proposal.Title, 'Original (copy) (copy)' );
	ASSERT.equal( ( await call( 'POST', '/api/items/nothing/copy', { Project: 'default' } ) ).Status, 404 );
} );


//---------------------------------------------------------------------
// Corpus

async function upload( method, path, zip )
{
	let response = await fetch( running.Url + path, { method: method, headers: { 'Content-Type': 'application/zip' }, body: zip } );
	return { Status: response.status, Body: await response.json() };
}


async function search_until( query, found )
{
	for ( let attempt = 0; attempt < 100; attempt++ )
	{
		let hits = ( await call( 'GET', '/api/search?q=' + encodeURIComponent( query ) ) ).Body.Hits;
		if ( found( hits ) )
		{
			return hits;
		}
		await new Promise( function ( resolve ) { setTimeout( resolve, 20 ); } );
	}
	return [];
}


TEST( 'a corpus: uploaded, listed with reasons, indexed and found, read, replaced, copied, renamed and trashed', async function ()
{
	let zip = MAKER.Make( [
		{ Name: 'repo/readme.md', Data: '# Repo\n\nThe gearbox ratio is chosen by the flux capacitor.\n' },
		{ Name: 'repo/src/engine.js', Data: 'function flux_capacitor()\n{\n\treturn 88;\n}\n' },
		{ Name: 'repo/logo.png', Data: 'png\u0000bytes' },
		{ Name: 'repo/LICENSE', Data: 'Permission is granted to anyone.' },
		{ Name: 'repo/data.txt', Data: Buffer.from( [ 0x61, 0x00, 0x62 ] ) },
		{ Name: 'repo/huge.txt', Data: 'x'.repeat( 600 * 1024 ) },
		{ Name: '__MACOSX/repo/._readme.md', Data: 'fork' },
	] );
	let project = ( await call( 'POST', '/api/projects', { Name: 'Corpus home' } ) ).Body.Project;
	let made = await upload( 'POST', '/api/projects/' + project.Id + '/corpus?name=repo.zip', zip );
	ASSERT.equal( made.Status, 201 );
	let corpus = made.Body.Corpus;
	ASSERT.equal( corpus.Name, 'repo' );
	ASSERT.equal( corpus.Kind, 'corpus' );
	let files = {};
	for ( let file of corpus.Files )
	{
		files[ file.Path ] = file.Indexed ? 'indexed' : file.Reason;
	}
	ASSERT.deepEqual( files, {
		'repo/data.txt': 'binary (holds a NUL byte)',
		'repo/huge.txt': 'larger than 512 KB',
		'repo/LICENSE': 'indexed',
		'repo/logo.png': 'binary (holds a NUL byte)',
		'repo/readme.md': 'indexed',
		'repo/src/engine.js': 'indexed',
	} );
	let tree = ( await call( 'GET', '/api/projects' ) ).Body.Projects.find( function ( candidate ) { return candidate.Id === project.Id; } );
	ASSERT.deepEqual( [ tree.Items[ 0 ].Kind, tree.Items[ 0 ].Title, tree.Items[ 0 ].Files, tree.Items[ 0 ].Indexed ], [ 'corpus', 'repo', 6, 3 ] );
	ASSERT.equal( typeof tree.Items[ 0 ].Created, 'string' );

	// found by search, with its path
	let hits = await search_until( 'flux capacitor gearbox', function ( list ) { return list.some( function ( hit ) { return hit.Corpus === corpus.Id; } ); } );
	let hit = hits.find( function ( candidate ) { return candidate.Corpus === corpus.Id; } );
	ASSERT.equal( hit.Title, 'repo' );
	ASSERT.equal( hit.Proposal, null );
	ASSERT.match( hit.Path, /^repo\/(readme\.md|src\/engine\.js)$/ );

	// read
	let read = await call( 'GET', '/api/corpus/' + corpus.Id );
	ASSERT.equal( read.Body.Project.Id, project.Id );
	let file = await call( 'GET', '/api/corpus/' + corpus.Id + '/file?path=' + encodeURIComponent( 'repo/src/engine.js' ) );
	ASSERT.equal( file.Body.Text, 'function flux_capacitor()\n{\n\treturn 88;\n}\n' );
	ASSERT.equal( ( await call( 'GET', '/api/corpus/' + corpus.Id + '/file?path=repo/logo.png' ) ).Status, 409 );
	ASSERT.equal( ( await call( 'GET', '/api/corpus/' + corpus.Id + '/file?path=nothing' ) ).Status, 404 );

	// refusals
	ASSERT.equal( ( await upload( 'POST', '/api/projects/' + project.Id + '/corpus?name=bad', Buffer.from( 'not a zip' ) ) ).Status, 400 );
	ASSERT.equal( ( await upload( 'POST', '/api/projects/' + project.Id + '/corpus', zip ) ).Status, 400 );
	ASSERT.equal( ( await upload( 'POST', '/api/projects/none-000000/corpus?name=x', zip ) ).Status, 404 );
	ASSERT.equal( ( await upload( 'POST', '/api/projects/' + project.Id + '/corpus?name=bad', MAKER.Make( [ { Name: '../out.md', Data: 'x' } ] ) ) ).Status, 400 );

	// replaced: new files, a new version, the index follows
	let replaced = await upload( 'PUT', '/api/corpus/' + corpus.Id, MAKER.Make( [ { Name: 'notes.md', Data: 'The warp coil hums at night.' } ] ) );
	ASSERT.equal( replaced.Status, 200 );
	ASSERT.equal( replaced.Body.Corpus.Version, 2 );
	ASSERT.deepEqual( replaced.Body.Corpus.Files.map( function ( entry ) { return entry.Path; } ), [ 'notes.md' ] );
	await search_until( 'warp coil', function ( list ) { return list.some( function ( candidate ) { return candidate.Corpus === corpus.Id; } ); } );
	let old = await search_until( 'gearbox', function ( list ) { return !list.some( function ( candidate ) { return candidate.Corpus === corpus.Id; } ); } );
	ASSERT.equal( old.some( function ( candidate ) { return candidate.Corpus === corpus.Id; } ), false );

	// copied, renamed, trashed
	let copied = await call( 'POST', '/api/items/' + corpus.Id + '/copy', { Project: 'default' } );
	ASSERT.equal( copied.Status, 201 );
	ASSERT.equal( ( await call( 'GET', '/api/corpus/' + copied.Body.Node.Id ) ).Body.Corpus.Name, 'repo (copy)' );
	ASSERT.equal( ( await call( 'PUT', '/api/corpus/' + corpus.Id + '/name', { Name: 'Engine repo' } ) ).Body.Corpus.Name, 'Engine repo' );
	ASSERT.equal( ( await call( 'DELETE', '/api/corpus/' + corpus.Id ) ).Status, 200 );
	ASSERT.equal( ( await call( 'GET', '/api/corpus/' + corpus.Id ) ).Status, 404 );
	let trash = ( await call( 'GET', '/api/trash' ) ).Body.Proposals;
	ASSERT.equal( trash.some( function ( entry ) { return entry.Id === corpus.Id && entry.Kind === 'corpus'; } ), true );
	let emptied = ( await call( 'GET', '/api/projects' ) ).Body.Projects.find( function ( candidate ) { return candidate.Id === project.Id; } );
	ASSERT.deepEqual( emptied.Items, [] );
} );


//---------------------------------------------------------------------
// Search and the LLM's context, within a project

TEST( 'a project\'s search and its LLM context hold only its own items', async function ()
{
	let alpha = ( await call( 'POST', '/api/projects', { Name: 'Alpha scope' } ) ).Body.Project;
	let beta = ( await call( 'POST', '/api/projects', { Name: 'Beta scope' } ) ).Body.Project;
	let in_alpha = ( await call( 'POST', '/api/proposals', { Title: 'Alpha notes', Text: '# Alpha notes\n\nThe marmalade pipeline runs nightly in alpha.\n', Kind: 'document', Project: alpha.Id } ) ).Body.Proposal;
	let in_beta = ( await call( 'POST', '/api/proposals', { Title: 'Beta notes', Text: '# Beta notes\n\nThe marmalade pipeline was retired in beta.\n', Kind: 'document', Project: beta.Id } ) ).Body.Proposal;
	await upload( 'POST', '/api/projects/' + beta.Id + '/corpus?name=beta-code', MAKER.Make( [ { Name: 'pipeline.js', Data: 'function marmalade_pipeline() {}\n' } ] ) );
	await search_until( 'marmalade pipeline', function ( list ) { return list.some( function ( hit ) { return hit.Corpus; } ) && list.some( function ( hit ) { return hit.Proposal === in_alpha.Id; } ); } );

	function sources( hits )
	{
		return hits.map( function ( hit ) { return hit.Proposal || hit.Corpus; } );
	}
	let all = ( await call( 'GET', '/api/search?q=marmalade+pipeline' ) ).Body.Hits;
	ASSERT.equal( sources( all ).includes( in_alpha.Id ) && sources( all ).includes( in_beta.Id ), true );
	let only_alpha = ( await call( 'GET', '/api/search?q=marmalade+pipeline&project=' + alpha.Id ) ).Body.Hits;
	ASSERT.deepEqual( Array.from( new Set( sources( only_alpha ) ) ), [ in_alpha.Id ] );
	let only_beta = ( await call( 'GET', '/api/search?q=marmalade+pipeline&project=' + beta.Id ) ).Body.Hits;
	ASSERT.equal( sources( only_beta ).includes( in_alpha.Id ), false );
	ASSERT.equal( only_beta.some( function ( hit ) { return hit.Corpus && hit.Path === 'pipeline.js'; } ), true );
	ASSERT.equal( ( await call( 'GET', '/api/search?q=marmalade&project=none-000000' ) ).Status, 404 );

	// the LLM, sent a thread in alpha, is shown alpha's passages and not beta's, and told the project
	let plan = ( await call( 'POST', '/api/proposals', { Title: 'Alpha plan', Text: TEXT, Project: alpha.Id } ) ).Body.Proposal;
	await call( 'POST', '/api/proposals/' + plan.Id + '/threads', { Anchor: null, Text: 'Does the marmalade pipeline still run?' } );
	llm_answer = async function () { return { Answer: { Actions: [] }, Usage: { Model: 'fake-model', Input: 1, Output: 1 } }; };
	llm_prompts = [];
	ASSERT.equal( ( await send_and_wait( plan.Id ) ).Status, 202 );
	let prompt = llm_prompts[ 0 ];
	ASSERT.match( prompt, /in the project "Alpha scope"/ );
	ASSERT.match( prompt, /runs nightly in alpha/ );
	ASSERT.doesNotMatch( prompt, /retired in beta/ );
	ASSERT.doesNotMatch( prompt, /marmalade_pipeline/ );
} );


//---------------------------------------------------------------------
// Documents

TEST( 'a Document is edited and kept like a Plan, has no threads and no state, and is found by search', async function ()
{
	let made = await call( 'POST', '/api/proposals', { Title: 'Glossary', Text: '# Glossary\n\nA quokka is a small wallaby that smiles.\n', Kind: 'document' } );
	ASSERT.equal( made.Status, 201 );
	let document = made.Body.Proposal;
	ASSERT.equal( document.Kind, 'document' );
	ASSERT.equal( document.State, null );
	ASSERT.equal( document.StateLine, 'a document' );
	ASSERT.equal( ( await call( 'POST', '/api/proposals', { Title: 'X', Text: '', Kind: 'document', State: 'Plan' } ) ).Status, 400 );
	ASSERT.equal( ( await call( 'POST', '/api/proposals', { Title: 'X', Text: '', Kind: 'poem' } ) ).Status, 400 );
	// in its project's tree as a document
	let default_project = ( await call( 'GET', '/api/projects' ) ).Body.Projects[ 0 ];
	ASSERT.equal( default_project.Items.find( function ( item ) { return item.Id === document.Id; } ).Kind, 'document' );
	// no threads, no state, nothing to send
	let thread = await call( 'POST', '/api/proposals/' + document.Id + '/threads', { Anchor: null, Text: 'A comment?' } );
	ASSERT.equal( thread.Status, 409 );
	ASSERT.match( thread.Body.Error, /no threads/ );
	ASSERT.equal( ( await call( 'PUT', '/api/proposals/' + document.Id + '/state', { State: 'Plan' } ) ).Status, 409 );
	ASSERT.equal( ( await call( 'POST', '/api/proposals/' + document.Id + '/send' ) ).Status, 409 );
	let read = await call( 'GET', '/api/proposals/' + document.Id );
	ASSERT.deepEqual( read.Body.Llm, { Configured: false } );
	// edits make revisions
	let edited = await call( 'PUT', '/api/proposals/' + document.Id + '/text', { Text: '# Glossary\n\nA quokka is a small wallaby that smiles for photographs.\n', Revision: 1 } );
	ASSERT.equal( edited.Status, 200 );
	ASSERT.equal( edited.Body.Proposal.Revision, 2 );
	// and it is indexed like a Plan
	let hits = await search_until( 'quokka photographs', function ( list ) { return list.some( function ( hit ) { return hit.Proposal === document.Id && /photographs/.test( hit.Text ); } ); } );
	ASSERT.equal( hits.some( function ( hit ) { return hit.Proposal === document.Id && /photographs/.test( hit.Text ); } ), true );
} );


//---------------------------------------------------------------------
// Projects

TEST( 'projects: Default holds new proposals; a project and its folders are created, renamed and deleted when empty', async function ()
{
	let listed = await call( 'GET', '/api/projects' );
	ASSERT.equal( listed.Status, 200 );
	ASSERT.equal( listed.Body.Projects[ 0 ].Id, 'default' );
	ASSERT.equal( listed.Body.Projects[ 0 ].Name, 'Default' );

	let loose = await create( 'Loose' );
	let default_project = ( await call( 'GET', '/api/projects' ) ).Body.Projects[ 0 ];
	let node = default_project.Items.find( function ( item ) { return item.Id === loose.Id; } );
	ASSERT.equal( node.Kind, 'plan' );
	ASSERT.equal( node.Title, 'Loose' );
	ASSERT.equal( node.State, 'Proposal' );
	ASSERT.equal( node.StateLine, 'no threads yet' );
	ASSERT.equal( ( await call( 'GET', '/api/proposals/' + loose.Id ) ).Body.Project.Id, 'default' );

	let made = await call( 'POST', '/api/projects', { Name: 'Consensus' } );
	ASSERT.equal( made.Status, 201 );
	let project = made.Body.Project;
	ASSERT.equal( project.Version, 1 );
	ASSERT.equal( ( await call( 'POST', '/api/projects', { Name: ' ' } ) ).Status, 400 );

	let folder = await call( 'POST', '/api/projects/' + project.Id + '/folders', { Name: 'Specs', Version: 1 } );
	ASSERT.equal( folder.Status, 201 );
	ASSERT.match( folder.Body.Folder.Id, /^f[0-9a-f]{8}$/ );
	ASSERT.equal( folder.Body.Project.Version, 2 );
	let stale = await call( 'POST', '/api/projects/' + project.Id + '/folders', { Name: 'Late', Version: 1 } );
	ASSERT.equal( stale.Status, 409 );
	ASSERT.equal( stale.Body.Version, 2 );
	ASSERT.equal( ( await call( 'POST', '/api/projects/' + project.Id + '/folders', { Name: 'Inner', Parent: 'fnothing' } ) ).Status, 400 );
	ASSERT.equal( ( await call( 'POST', '/api/projects/none-000000/folders', { Name: 'X' } ) ).Status, 404 );

	// a proposal created into the folder
	let placed = await call( 'POST', '/api/proposals', { Title: 'Placed', Text: TEXT, Project: project.Id, Parent: folder.Body.Folder.Id } );
	ASSERT.equal( placed.Status, 201 );
	ASSERT.equal( placed.Body.Project, project.Id );
	ASSERT.equal( ( await call( 'POST', '/api/proposals', { Title: 'Nowhere', Text: TEXT, Project: 'none-000000' } ) ).Status, 404 );
	ASSERT.equal( ( await call( 'POST', '/api/proposals', { Title: 'Nowhere', Text: TEXT, Kind: 'document', Project: project.Id, Parent: placed.Body.Proposal.Id } ) ).Status, 400 );
	let read = ( await call( 'GET', '/api/projects' ) ).Body.Projects.find( function ( candidate ) { return candidate.Id === project.Id; } );
	ASSERT.equal( read.Items[ 0 ].Kind, 'folder' );
	ASSERT.equal( read.Items[ 0 ].Items[ 0 ].Title, 'Placed' );
	ASSERT.equal( read.Items[ 0 ].Items[ 0 ].Created, placed.Body.Proposal.Created );
	ASSERT.equal( typeof read.Items[ 0 ].Items[ 0 ].Updated, 'string' );

	// renames
	let renamed = await call( 'PUT', '/api/projects/' + project.Id, { Name: 'Consensus work' } );
	ASSERT.equal( renamed.Body.Project.Name, 'Consensus work' );
	let folder_renamed = await call( 'PUT', '/api/projects/' + project.Id + '/folders/' + folder.Body.Folder.Id, { Name: 'Specifications' } );
	ASSERT.equal( folder_renamed.Body.Project.Items[ 0 ].Name, 'Specifications' );
	ASSERT.equal( ( await call( 'PUT', '/api/projects/' + project.Id + '/folders/fnothing', { Name: 'X' } ) ).Status, 404 );

	// deletes: only when empty, never Default; a trashed proposal leaves its project
	ASSERT.equal( ( await call( 'DELETE', '/api/projects/' + project.Id + '/folders/' + folder.Body.Folder.Id ) ).Status, 409 );
	ASSERT.equal( ( await call( 'DELETE', '/api/projects/' + project.Id ) ).Status, 409 );
	ASSERT.equal( ( await call( 'DELETE', '/api/projects/default' ) ).Status, 409 );
	await call( 'DELETE', '/api/proposals/' + placed.Body.Proposal.Id );
	ASSERT.equal( ( await call( 'DELETE', '/api/projects/' + project.Id + '/folders/' + folder.Body.Folder.Id ) ).Status, 200 );
	ASSERT.equal( ( await call( 'DELETE', '/api/projects/' + project.Id ) ).Status, 200 );
	ASSERT.equal( ( await call( 'DELETE', '/api/projects/' + project.Id ) ).Status, 404 );
	ASSERT.equal( ( await call( 'GET', '/api/projects' ) ).Body.Projects.some( function ( candidate ) { return candidate.Id === project.Id; } ), false );
} );


//---------------------------------------------------------------------
// Send to LLM: the owner's button, the call in the background, the answer carried out as the llm.

async function wait_idle( id )
{
	for ( let attempt = 0; attempt < 200; attempt++ )
	{
		let read = await call( 'GET', '/api/proposals/' + id );
		if ( !read.Body.Llm.Running )
		{
			return;
		}
		await new Promise( function ( resolve ) { setTimeout( resolve, 20 ); } );
	}
	throw new Error( 'the call did not finish' );
}


async function send_and_wait( id )
{
	let sent = await call( 'POST', '/api/proposals/' + id + '/send' );
	if ( sent.Status === 202 )
	{
		await wait_idle( id );
	}
	return sent;
}


function thread_of( read, thread_id )
{
	return read.Body.Threads.find( function ( thread ) { return thread.Id === thread_id; } );
}


TEST( 'send: owner only, refused when nothing is waiting on the LLM', async function ()
{
	let proposal = await create( 'Send refusals' );
	let read = await call( 'GET', '/api/proposals/' + proposal.Id );
	ASSERT.deepEqual( read.Body.Llm, { Configured: true, Name: 'llm', Running: false, Waiting: 0 } );
	let nothing = await call( 'POST', '/api/proposals/' + proposal.Id + '/send' );
	ASSERT.equal( nothing.Status, 409 );
	ASSERT.match( nothing.Body.Error, /nothing is waiting/ );
	let as_llm = await call( 'POST', '/api/proposals/' + proposal.Id + '/send', {}, true );
	ASSERT.equal( as_llm.Status, 403 );
	let missing = await call( 'POST', '/api/proposals/no-such/send' );
	ASSERT.equal( missing.Status, 404 );
} );


TEST( 'send: the answer\'s replies and applies are carried out as the llm, and its tokens are counted', async function ()
{
	let proposal = await create( 'Send carried out' );
	let id = proposal.Id;
	let question = ( await call( 'POST', '/api/proposals/' + id + '/threads', { Anchor: { Text: 'A closing paragraph.' }, Text: 'Is this needed?' } ) ).Body.Thread;
	let resolved = await discussed_thread( id, 'one list item', 'Outcome: the item becomes "one better item".' );
	await call( 'POST', '/api/proposals/' + id + '/threads/' + resolved.Id + '/resolve' );
	let before = await call( 'GET', '/api/proposals/' + id );
	ASSERT.equal( before.Body.Llm.Waiting, 2 );
	let usage_before = ( await call( 'GET', '/api/usage' ) ).Body;

	llm_answer = async function ()
	{
		return {
			Answer: { Actions: [
				{ Thread: question.Id, Kind: 'reply', Reply: 'It closes the proposal. Outcome: no change.' },
				{ Thread: resolved.Id, Kind: 'apply', Outcome: 'the item is better', Text: TEXT.replace( '- one list item', '- one better item' ), Anchor: 'one better item' },
				{ Thread: 'tnot-waiting', Kind: 'reply', Reply: 'ignored' },
			] },
			Usage: { Model: 'fake-model', Input: 1000, Output: 200 },
		};
	};
	llm_prompts = [];
	let sent = await send_and_wait( id );
	ASSERT.equal( sent.Status, 202 );
	ASSERT.deepEqual( sent.Body.Threads.sort(), [ question.Id, resolved.Id ].sort() );

	let prompt = llm_prompts[ 0 ];
	ASSERT.match( prompt, /Thread [0-9a-z]+, contested, WAITING ON YOU to reply/ );
	ASSERT.match( prompt, /resolved, WAITING ON YOU to apply/ );
	ASSERT.match( prompt, /A closing paragraph\./ );
	ASSERT.match( prompt, /User: Is this needed\?/ );

	let after = await call( 'GET', '/api/proposals/' + id );
	ASSERT.equal( after.Body.Proposal.Revision, 2 );
	ASSERT.match( after.Body.Text, /one better item/ );
	let answered = thread_of( after, question.Id );
	ASSERT.equal( answered.Replies[ 1 ].By, 'llm' );
	ASSERT.equal( answered.WaitingOnMe, true );
	let applied = thread_of( after, resolved.Id );
	ASSERT.equal( applied.State, 'applied' );
	ASSERT.equal( applied.Applied.By, 'llm' );
	ASSERT.equal( applied.Anchor.Text, 'one better item' );
	ASSERT.equal( after.Body.Llm.Waiting, 0 );

	let usage = ( await call( 'GET', '/api/usage' ) ).Body;
	ASSERT.equal( usage.Today.Calls, usage_before.Today.Calls + 1 );
	ASSERT.equal( usage.Today.Input, usage_before.Today.Input + 1000 );
	ASSERT.equal( usage.Today.Output, usage_before.Today.Output + 200 );
	ASSERT.equal( usage.Models[ 'fake-model' ].Calls >= 1, true );
} );


TEST( 'context: every project has one; a call includes it and may rewrite it, but not over a newer revision', async function ()
{
	let project = ( await call( 'POST', '/api/projects', { Name: 'With context' } ) ).Body.Project;
	let listed = ( await call( 'GET', '/api/projects' ) ).Body.Projects.find( function ( candidate ) { return candidate.Id === project.Id; } );
	ASSERT.equal( listed.Context.Empty, true );
	let context_id = listed.Context.Id;
	let context = await call( 'GET', '/api/proposals/' + context_id );
	ASSERT.equal( context.Body.Proposal.Kind, 'context' );
	ASSERT.equal( context.Body.Project.Id, project.Id );
	ASSERT.equal( context.Body.Proposal.StateLine, 'the project\'s context' );
	// no threads, no state, never deleted on its own
	ASSERT.equal( ( await call( 'POST', '/api/proposals/' + context_id + '/threads', { Text: 'x' } ) ).Status, 409 );
	ASSERT.equal( ( await call( 'PUT', '/api/proposals/' + context_id + '/state', { State: 'Plan' } ) ).Status, 409 );
	ASSERT.equal( ( await call( 'DELETE', '/api/proposals/' + context_id ) ).Status, 409 );
	ASSERT.equal( ( await call( 'POST', '/api/items/' + context_id + '/move', { Project: 'default' } ) ).Status, 404 );

	// the first call finds no context and writes one; a second context action is ignored
	let plan = ( await call( 'POST', '/api/proposals', { Title: 'Plan with context', Text: TEXT, Project: project.Id } ) ).Body.Proposal;
	let thread = ( await call( 'POST', '/api/proposals/' + plan.Id + '/threads', { Text: 'Review this.' } ) ).Body.Thread;
	llm_answer = async function ()
	{
		return {
			Answer: { Actions: [
				{ Thread: thread.Id, Kind: 'reply', Reply: 'Reviewed; I started the project\'s context.' },
				{ Kind: 'context', Text: '# Context\n\nFirst.\n', Reason: 'started it' },
				{ Kind: 'context', Text: '# Context\n\nIgnored.\n' },
			] },
			Usage: { Model: 'fake-model', Input: 10, Output: 10 },
		};
	};
	llm_prompts = [];
	await send_and_wait( plan.Id );
	ASSERT.match( llm_prompts[ 0 ], /This project has no context yet/ );
	ASSERT.match( llm_prompts[ 0 ], /Keep it under 12000 characters/ );
	context = await call( 'GET', '/api/proposals/' + context_id );
	ASSERT.equal( context.Body.Text, '# Context\n\nFirst.\n' );
	ASSERT.equal( context.Body.Proposal.Revision, 2 );
	let revisions = ( await call( 'GET', '/api/proposals/' + context_id + '/revisions' ) ).Body.Revisions;
	ASSERT.deepEqual( [ revisions[ 1 ].By, revisions[ 1 ].Reason, revisions[ 1 ].Note ], [ 'llm', 'context', 'started it' ] );
	ASSERT.equal( ( await call( 'GET', '/api/projects' ) ).Body.Projects.find( function ( candidate ) { return candidate.Id === project.Id; } ).Context.Empty, false );

	// the next call includes it; a person's edit while the call runs makes the LLM's change stale, and it is refused
	await call( 'POST', '/api/proposals/' + plan.Id + '/threads/' + thread.Id + '/replies', { Text: 'One more look.' } );
	llm_answer = async function ()
	{
		await call( 'PUT', '/api/proposals/' + context_id + '/text', { Text: '# Context\n\nEdited by hand.\n', Revision: 2 } );
		return { Answer: { Actions: [ { Kind: 'context', Text: '# Context\n\nStale.\n', Reason: 'late' } ] }, Usage: { Model: 'fake-model', Input: 10, Output: 10 } };
	};
	await send_and_wait( plan.Id );
	ASSERT.match( llm_prompts[ 1 ], /# The project's context, revision 2/ );
	ASSERT.match( llm_prompts[ 1 ], /First\./ );
	context = await call( 'GET', '/api/proposals/' + context_id );
	ASSERT.equal( context.Body.Text, '# Context\n\nEdited by hand.\n' );
	ASSERT.equal( context.Body.Proposal.Revision, 3 );
} );


TEST( 'context: Initialize context gives the LLM the project\'s items, zip files and key files; an empty project\'s context is trashed with it', async function ()
{
	let project = ( await call( 'POST', '/api/projects', { Name: 'From code' } ) ).Body.Project;
	let context_id = ( await call( 'GET', '/api/projects' ) ).Body.Projects.find( function ( candidate ) { return candidate.Id === project.Id; } ).Context.Id;
	let zip = MAKER.Make( [
		{ Name: 'app/README.md', Data: '# The app\n\nIt keeps lamps lit.\n' },
		{ Name: 'app/package.json', Data: '{ "name": "lamps" }\n' },
		{ Name: 'app/src/deep/README.md', Data: 'a deeper readme\n' },
		{ Name: 'app/src/index.js', Data: 'console.log( 1 );\n' },
	] );
	ASSERT.equal( ( await upload( 'POST', '/api/projects/' + project.Id + '/corpus?name=code', zip ) ).Status, 201 );
	await call( 'POST', '/api/proposals', { Title: 'A plan in it', Text: '# A plan in it\n', Project: project.Id } );

	ASSERT.equal( ( await call( 'POST', '/api/projects/' + project.Id + '/context/initialize', {}, true ) ).Status, 403 );
	ASSERT.equal( ( await call( 'POST', '/api/projects/none/context/initialize' ) ).Status, 404 );
	llm_answer = async function ()
	{
		return { Answer: { Actions: [ { Kind: 'context', Text: '# From code\n\nLamps.\n', Reason: 'from the zip' } ] }, Usage: { Model: 'fake-model', Input: 10, Output: 10 } };
	};
	llm_prompts = [];
	let started = await call( 'POST', '/api/projects/' + project.Id + '/context/initialize' );
	ASSERT.equal( started.Status, 202 );
	ASSERT.equal( started.Body.Context, context_id );
	await wait_idle( context_id );
	let prompt = llm_prompts[ 0 ];
	ASSERT.match( prompt, /Write the context of the project "From code"/ );
	ASSERT.match( prompt, /- plan: A plan in it/ );
	ASSERT.match( prompt, /- code\/app\/src\/index\.js/ );
	ASSERT.match( prompt, /# The file code\/app\/README\.md\n\n`+\n# The app/ );
	ASSERT.match( prompt, /# The file code\/app\/package\.json/ );
	ASSERT.ok( prompt.indexOf( 'code/app/README.md' ) < prompt.indexOf( '# The file code/app/src/deep/README.md' ) );
	let context = await call( 'GET', '/api/proposals/' + context_id );
	ASSERT.equal( context.Body.Text, '# From code\n\nLamps.\n' );

	// an empty project is deleted, and its context goes to the trash with it
	let empty = ( await call( 'POST', '/api/projects', { Name: 'Short lived' } ) ).Body.Project;
	ASSERT.equal( ( await call( 'DELETE', '/api/projects/' + empty.Id ) ).Status, 200 );
	ASSERT.equal( ( await call( 'GET', '/api/proposals/' + empty.Context ) ).Status, 404 );
	ASSERT.equal( ( await call( 'GET', '/api/trash' ) ).Body.Proposals.some( function ( trashed ) { return trashed.Id === empty.Context; } ), true );
} );


TEST( 'copy prompt and paste answer: the same prompt as a call, and the answer carried out against the revisions it was made from', async function ()
{
	let proposal = await create( 'Pasted answer' );
	let id = proposal.Id;
	let question = ( await call( 'POST', '/api/proposals/' + id + '/threads', { Anchor: { Text: 'A closing paragraph.' }, Text: 'Is this needed?' } ) ).Body.Thread;
	let resolved = await discussed_thread( id, 'one list item', 'Outcome: the item becomes "one pasted item".' );
	await call( 'POST', '/api/proposals/' + id + '/threads/' + resolved.Id + '/resolve' );

	ASSERT.equal( ( await call( 'GET', '/api/proposals/' + id + '/prompt', undefined, true ) ).Status, 403 );
	let copied = await call( 'GET', '/api/proposals/' + id + '/prompt' );
	ASSERT.equal( copied.Status, 200 );
	ASSERT.match( copied.Body.Prompt, /# The rules/ );
	ASSERT.match( copied.Body.Prompt, /contested, WAITING ON YOU to reply/ );
	ASSERT.equal( copied.Body.Revision, 1 );
	ASSERT.deepEqual( copied.Body.Waiting.sort(), [ question.Id, resolved.Id ].sort() );
	ASSERT.deepEqual( copied.Body.Schema.required, [ 'Actions' ] );

	// the answer, as text in a code fence, the way a chat LLM gives it
	let answer = '```json\n' + JSON.stringify( { Actions: [
		{ Thread: question.Id, Kind: 'reply', Reply: 'It closes the proposal.' },
		{ Thread: resolved.Id, Kind: 'apply', Outcome: 'the item is pasted', Text: TEXT.replace( '- one list item', '- one pasted item' ), Anchor: 'one pasted item' },
	] } ) + '\n```';
	ASSERT.equal( ( await call( 'POST', '/api/proposals/' + id + '/answer', { Answer: answer, Revision: 1 }, true ) ).Status, 403 );
	ASSERT.equal( ( await call( 'POST', '/api/proposals/' + id + '/answer', { Answer: 'I think so.', Revision: 1 } ) ).Status, 400 );
	ASSERT.equal( ( await call( 'POST', '/api/proposals/' + id + '/answer', { Answer: answer } ) ).Status, 400 );
	let pasted = await call( 'POST', '/api/proposals/' + id + '/answer', { Answer: answer, Revision: 1 } );
	ASSERT.equal( pasted.Status, 200 );
	ASSERT.equal( pasted.Body.Actions, 2 );
	ASSERT.deepEqual( pasted.Body.Refused, {} );
	let runs = ( await call( 'GET', '/api/proposals/' + id + '/runs' ) ).Body.Runs;
	let pasted_run = runs.find( function ( run ) { return run.Id === pasted.Body.Run; } );
	ASSERT.equal( pasted_run.Destination, 'Manual' );
	ASSERT.deepEqual( pasted_run.Steps.map( function ( step ) { return step.Text; } ), [ 'The answer was pasted: 1 reply, 1 apply', 'Consensus carried out 2 actions, 0 refused' ] );
	ASSERT.ok( pasted_run.Finished );
	let after = await call( 'GET', '/api/proposals/' + id );
	ASSERT.match( after.Body.Text, /one pasted item/ );
	ASSERT.equal( thread_of( after, question.Id ).Replies[ 1 ].By, 'llm' );
	ASSERT.equal( thread_of( after, resolved.Id ).State, 'applied' );

	// pasted again from the old prompt: the reply is fine, but the text moved on, so nothing is applied twice
	await call( 'POST', '/api/proposals/' + id + '/threads/' + question.Id + '/replies', { Text: 'Then keep it.' } );
	let stale = await call( 'POST', '/api/proposals/' + id + '/answer', { Answer: { Actions: [ { Thread: question.Id, Kind: 'reply', Reply: 'Kept.' } ] }, Revision: 1 } );
	ASSERT.deepEqual( stale.Body.Refused, {} );
	ASSERT.equal( ( await call( 'GET', '/api/proposals/' + id ) ).Body.Proposal.Revision, 2 );
} );


TEST( 'session: the prompt shaped by the choices and sized part by part; a destination and model picked; every step in the run log', async function ()
{
	let proposal = await create( 'Session' );
	let id = proposal.Id;
	let open = ( await call( 'POST', '/api/proposals/' + id + '/threads', { Anchor: { Text: 'A closing paragraph.' }, Text: 'Is this needed?' } ) ).Body.Thread;
	let done = await discussed_thread( id, 'one list item', 'Outcome: no change.' );
	await call( 'POST', '/api/proposals/' + id + '/threads/' + done.Id + '/resolve' );
	await call( 'POST', '/api/proposals/' + id + '/threads/' + done.Id + '/apply', { Outcome: 'no change', Revision: 1 }, true );

	// the choices: open threads (the default) leave the applied one out; all threads bring it in; no context, no search
	let shaped = ( await call( 'GET', '/api/proposals/' + id + '/prompt' ) ).Body;
	ASSERT.match( shaped.Prompt, new RegExp( 'Thread ' + open.Id ) );
	ASSERT.equal( shaped.Prompt.includes( 'Thread ' + done.Id ), false );
	ASSERT.deepEqual( shaped.Parts.map( function ( part ) { return part.Name; } ).slice( 0, 4 ), [ 'Rules', 'Context', 'Plan', 'Threads' ] );
	ASSERT.equal( shaped.Characters, shaped.Prompt.length );
	ASSERT.equal( shaped.Tokens, Math.ceil( shaped.Prompt.length / 4 ) );
	ASSERT.equal( shaped.Parts.reduce( function ( sum, part ) { return sum + part.Characters; }, 0 ) + shaped.Parts.length - 1, shaped.Characters );
	let all = ( await call( 'GET', '/api/proposals/' + id + '/prompt?threads=all&context=0&search=0' ) ).Body;
	ASSERT.match( all.Prompt, new RegExp( 'Thread ' + done.Id ) );
	ASSERT.deepEqual( all.Parts.map( function ( part ) { return part.Name; } ), [ 'Rules', 'Plan', 'Threads' ] );
	let waiting_only = ( await call( 'GET', '/api/proposals/' + id + '/prompt?threads=waiting' ) ).Body;
	ASSERT.match( waiting_only.Prompt, new RegExp( 'Thread ' + open.Id ) );

	// the destinations: the one Call is a list of one; Manual is always there
	let destinations = ( await call( 'GET', '/api/llm/destinations' ) ).Body;
	ASSERT.equal( destinations.Destinations.length, 1 );
	ASSERT.equal( destinations.Manual, true );
	ASSERT.equal( ( await call( 'POST', '/api/proposals/' + id + '/session', { Destination: 'Nowhere' } ) ).Status, 400 );

	// a session to the first destination with a model picked: its run log, step by step
	await call( 'POST', '/api/proposals/' + id + '/threads/' + open.Id + '/replies', { Text: 'Please answer.' } );
	llm_answer = async function ()
	{
		return { Answer: { Actions: [ { Thread: open.Id, Kind: 'reply', Reply: 'It closes the text.' } ] }, Usage: { Model: 'picked-model', Input: 900, Output: 40 } };
	};
	let started = await call( 'POST', '/api/proposals/' + id + '/session', { Destination: destinations.Destinations[ 0 ].Name, Model: 'picked-model', Options: { Threads: 'waiting', Search: false } } );
	ASSERT.equal( started.Status, 202 );
	await wait_idle( id );
	let run = ( await call( 'GET', '/api/proposals/' + id + '/runs' ) ).Body.Runs.find( function ( candidate ) { return candidate.Id === started.Body.Run; } );
	ASSERT.equal( run.Model, 'picked-model' );
	ASSERT.deepEqual( run.Options, { Context: true, Parents: true, Threads: 'waiting', Search: false } );
	ASSERT.deepEqual( run.Steps.map( function ( step ) { return step.Text; } ), [ 'Consensus sent the prompt to picked-model', 'picked-model answered: 1 reply', 'Consensus carried out 1 action, 0 refused' ] );
	ASSERT.equal( run.Steps[ 1 ].Tokens, 40 );
	ASSERT.ok( run.Steps.every( function ( step ) { return step.At; } ) );
	ASSERT.ok( run.Finished );

	// Manual: the prompt comes back at once, with its run
	let manual = await call( 'POST', '/api/proposals/' + id + '/session', { Destination: 'Manual' } );
	ASSERT.equal( manual.Status, 200 );
	ASSERT.match( manual.Body.Prompt, /# The rules/ );
	ASSERT.match( manual.Body.Run, /^s[0-9a-f]{8}$/ );
} );


TEST( 'turns: the LLM asks for more, Consensus answers within the project, the next prompt carries it, and the last answer acts', async function ()
{
	let project = ( await call( 'POST', '/api/projects', { Name: 'Turns' } ) ).Body.Project;
	let other = ( await call( 'POST', '/api/proposals', { Title: 'Other plan', Text: '# Other plan\n\nLamps are lit at dusk.\n', Project: project.Id } ) ).Body.Proposal;
	let elsewhere = await create( 'Not in the project' );
	let plan = ( await call( 'POST', '/api/proposals', { Title: 'Asking plan', Text: TEXT, Project: project.Id } ) ).Body.Proposal;
	let thread = ( await call( 'POST', '/api/proposals/' + plan.Id + '/threads', { Text: 'When are the lamps lit?' } ) ).Body.Thread;

	// answer 1 asks; answer 2 asks again; answer 3 acts
	let prompts = [];
	llm_answer = async function ( Prompt )
	{
		prompts.push( Prompt );
		if ( prompts.length === 1 )
		{
			return { Answer: { Actions: [], Requests: [ { Tool: 'list_project' }, { Tool: 'read_plan', Plan: 'other plan' }, { Tool: 'read_plan', Plan: elsewhere.Id } ] }, Usage: { Model: 'fake-model', Input: 10, Output: 5 } };
		}
		if ( prompts.length === 2 )
		{
			return { Answer: { Actions: [], Requests: [ { Tool: 'read_revision', Plan: other.Id, Revision: 1 }, { Tool: 'teleport' } ] }, Usage: { Model: 'fake-model', Input: 10, Output: 5 } };
		}
		return { Answer: { Actions: [ { Thread: thread.Id, Kind: 'reply', Reply: 'At dusk, says Other plan.' } ] }, Usage: { Model: 'fake-model', Input: 10, Output: 5 } };
	};
	let started = await call( 'POST', '/api/proposals/' + plan.Id + '/session', {} );
	ASSERT.equal( started.Status, 202 );
	await wait_idle( plan.Id );
	ASSERT.equal( prompts.length, 3 );
	ASSERT.equal( prompts[ 0 ].includes( '# What you asked for' ), false );
	ASSERT.match( prompts[ 1 ], /## list_project\n\n`+\nThe project "Turns":/ );
	ASSERT.match( prompts[ 1 ], /- plan "Other plan" \(Proposal\), id / );
	ASSERT.match( prompts[ 1 ], /## read_plan "other plan"\n\n`+\n# Other plan\n\nLamps are lit at dusk\./ );
	ASSERT.match( prompts[ 1 ], new RegExp( 'refused: no plan or document "' + elsewhere.Id + '" in the project' ) );
	ASSERT.match( prompts[ 1 ], /This is your answer 2 of 5\./ );
	ASSERT.match( prompts[ 2 ], /## read_revision "p[0-9a-f]{8}" 1\n\n`+\n# Other plan/ );
	ASSERT.match( prompts[ 2 ], /refused: there is no tool "teleport"/ );
	let read = await call( 'GET', '/api/proposals/' + plan.Id );
	ASSERT.equal( thread_of( read, thread.Id ).Replies[ 1 ].Text, 'At dusk, says Other plan.' );
	let run = ( await call( 'GET', '/api/proposals/' + plan.Id + '/runs' ) ).Body.Runs.find( function ( candidate ) { return candidate.Id === started.Body.Run; } );
	// the test's llm has a Call of kind claude-cli and no model: the log names the kind
	let target = run.Model || 'claude-cli';
	ASSERT.deepEqual( run.Steps.map( function ( step ) { return step.Text; } ), [
		'Consensus sent the prompt to ' + target,
		'fake-model asked for list_project, read_plan "other plan", read_plan "' + elsewhere.Id + '"',
		'Consensus answered list_project',
		'Consensus answered read_plan "other plan"',
		'Consensus answered read_plan "' + elsewhere.Id + '"',
		'Consensus sent answer 2\'s prompt to ' + target,
		'fake-model asked for read_revision "' + other.Id + '" 1, teleport',
		'Consensus answered read_revision "' + other.Id + '" 1',
		'Consensus answered teleport',
		'Consensus sent answer 3\'s prompt to ' + target,
		'fake-model answered: 1 reply',
		'Consensus carried out 1 action, 0 refused',
	] );
} );


TEST( 'turns, by hand: a pasted answer that asks for more gets the next prompt to copy; the last answer is carried out', async function ()
{
	let proposal = await create( 'Asking by hand' );
	let thread = ( await call( 'POST', '/api/proposals/' + proposal.Id + '/threads', { Text: 'What does search find?' } ) ).Body.Thread;
	let made = ( await call( 'POST', '/api/proposals/' + proposal.Id + '/session', { Destination: 'Manual' } ) ).Body;
	let asked = await call( 'POST', '/api/proposals/' + proposal.Id + '/answer', { Answer: { Actions: [], Requests: [ { Tool: 'read_plan', Plan: 'Asking by hand' } ] }, Revision: made.Revision, Run: made.Run } );
	ASSERT.equal( asked.Status, 200 );
	ASSERT.equal( asked.Body.Continue, true );
	ASSERT.equal( asked.Body.Turn, 2 );
	ASSERT.match( asked.Body.Prompt, /## read_plan "Asking by hand"\n\n`+\n# A proposal/ );
	let done = await call( 'POST', '/api/proposals/' + proposal.Id + '/answer', { Answer: { Actions: [ { Thread: thread.Id, Kind: 'reply', Reply: 'It finds the proposal itself.' } ] }, Revision: asked.Body.Revision, Run: made.Run } );
	ASSERT.equal( done.Body.Actions, 1 );
	let run = ( await call( 'GET', '/api/proposals/' + proposal.Id + '/runs' ) ).Body.Runs.find( function ( candidate ) { return candidate.Id === made.Run; } );
	ASSERT.deepEqual( run.Steps.map( function ( step ) { return step.Text; } ), [
		'Consensus made the prompt for copying',
		'The pasted answer asked for read_plan "Asking by hand"',
		'Consensus answered read_plan "Asking by hand"',
		'Consensus made answer 2\'s prompt for copying',
		'The answer was pasted: 1 reply',
		'Consensus carried out 1 action, 0 refused',
	] );
	ASSERT.equal( run.Turns.length, 1 );
} );


TEST( 'send: a failed call leaves a line on each thread; a refused action on its thread; the next success clears them', async function ()
{
	let proposal = await create( 'Send failures' );
	let id = proposal.Id;
	let first = ( await call( 'POST', '/api/proposals/' + id + '/threads', { Anchor: null, Text: 'First?' } ) ).Body.Thread;
	let second = ( await call( 'POST', '/api/proposals/' + id + '/threads', { Anchor: null, Text: 'Second?' } ) ).Body.Thread;

	llm_answer = async function () { throw new Error( 'the model is asleep' ); };
	await send_and_wait( id );
	let failed = await call( 'GET', '/api/proposals/' + id );
	ASSERT.equal( thread_of( failed, first.Id ).CallFailed.Reason, 'the model is asleep' );
	ASSERT.equal( thread_of( failed, second.Id ).CallFailed.Reason, 'the model is asleep' );

	llm_answer = async function ()
	{
		return {
			Answer: { Actions: [
				{ Thread: first.Id, Kind: 'reply', Reply: 'Answered.' },
				{ Thread: second.Id, Kind: 'apply', Outcome: 'nothing' },
			] },
			Usage: { Model: 'fake-model', Input: 1, Output: 1 },
		};
	};
	await send_and_wait( id );
	let partly = await call( 'GET', '/api/proposals/' + id );
	ASSERT.equal( thread_of( partly, first.Id ).CallFailed, undefined );
	ASSERT.match( thread_of( partly, second.Id ).CallFailed.Reason, /still contested/ );
} );


TEST( 'send: one call at a time per proposal, and a ceiling of calls per hour', async function ()
{
	let proposal = await create( 'Send overlap' );
	let id = proposal.Id;
	await call( 'POST', '/api/proposals/' + id + '/threads', { Anchor: null, Text: 'Anyone?' } );
	let release = null;
	llm_answer = function ()
	{
		return new Promise( function ( resolve )
		{
			release = function () { resolve( { Answer: { Actions: [] }, Usage: { Model: 'fake-model', Input: 0, Output: 0 } } ); };
		} );
	};
	let first = await call( 'POST', '/api/proposals/' + id + '/send' );
	ASSERT.equal( first.Status, 202 );
	ASSERT.equal( ( await call( 'GET', '/api/proposals/' + id ) ).Body.Llm.Running, true );
	let second = await call( 'POST', '/api/proposals/' + id + '/send' );
	ASSERT.equal( second.Status, 409 );
	ASSERT.match( second.Body.Error, /already running/ );
	while ( !release )
	{
		await new Promise( function ( resolve ) { setTimeout( resolve, 10 ); } );
	}
	release();
	await wait_idle( id );

	let settings_call = running.Settings.Participants[ 1 ].Call;
	settings_call.CallsPerHour = 1;
	let paused = await call( 'POST', '/api/proposals/' + id + '/send' );
	delete settings_call.CallsPerHour;
	ASSERT.equal( paused.Status, 409 );
	ASSERT.match( paused.Body.Error, /paused/ );
} );


//---------------------------------------------------------------------

TEST( 'subplans: a plan holds plans; they move, copy and go to the trash with it; the prompt carries the parents and names the subplans', async function ()
{
	let project = ( await call( 'POST', '/api/projects', { Name: 'Subplans' } ) ).Body.Project;
	let made = async function ( title, parent, kind, body_text )
	{
		let result = await call( 'POST', '/api/proposals', { Title: title, Text: body_text || ( '# ' + title + '\n\nThe text of ' + title + '.\n' ), Kind: kind || 'plan', Project: project.Id, Parent: parent } );
		return result;
	};
	let top = ( await made( 'Top' ) ).Body.Proposal;
	let middle = await made( 'Middle', top.Id );
	ASSERT.equal( middle.Status, 201 );
	middle = middle.Body.Proposal;
	let bottom = ( await made( 'Bottom', middle.Id ) ).Body.Proposal;
	let side = ( await made( 'Side', top.Id ) ).Body.Proposal;

	// only plans go under a plan
	ASSERT.equal( ( await made( 'Doc', top.Id, 'document' ) ).Status, 400 );
	let doc = ( await made( 'Doc', null, 'document' ) ).Body.Proposal;
	ASSERT.equal( ( await call( 'POST', '/api/items/' + doc.Id + '/move', { Project: project.Id, Parent: top.Id } ) ).Status, 400 );
	ASSERT.equal( ( await call( 'POST', '/api/items/' + top.Id + '/move', { Project: project.Id, Parent: bottom.Id } ) ).Status, 400 );

	// the tree shows them nested
	let listed = ( await call( 'GET', '/api/projects' ) ).Body.Projects.find( function ( candidate ) { return candidate.Id === project.Id; } );
	let top_node = listed.Items.find( function ( node ) { return node.Id === top.Id; } );
	ASSERT.deepEqual( top_node.Items.map( function ( node ) { return node.Title; } ), [ 'Middle', 'Side' ] );
	ASSERT.equal( top_node.Items[ 0 ].Items[ 0 ].Title, 'Bottom' );
	ASSERT.equal( top_node.Items[ 1 ].Items, undefined );

	// a plan dragged onto a plan becomes its subplan; dragged out, it is not
	let loose = ( await made( 'Loose' ) ).Body.Proposal;
	ASSERT.equal( ( await call( 'POST', '/api/items/' + loose.Id + '/move', { Project: project.Id, Parent: side.Id } ) ).Status, 200 );
	ASSERT.equal( ( await call( 'POST', '/api/items/' + loose.Id + '/move', { Project: project.Id, Parent: null } ) ).Status, 200 );

	// the prompt: the parents' text, the top one first, as their own part; a parent names its subplans
	let prompt = ( await call( 'GET', '/api/proposals/' + bottom.Id + '/prompt' ) ).Body;
	ASSERT.deepEqual( prompt.Parts.map( function ( part ) { return part.Name; } ).slice( 0, 4 ), [ 'Rules', 'Context', 'Parent plans', 'Plan' ] );
	let parents = prompt.Prompt.slice( prompt.Prompt.indexOf( '# The parent plans' ), prompt.Prompt.indexOf( '# The proposal:' ) );
	ASSERT.ok( parents.indexOf( 'The text of Top.' ) > 0 );
	ASSERT.ok( parents.indexOf( 'The text of Middle.' ) > parents.indexOf( 'The text of Top.' ) );
	ASSERT.equal( parents.includes( 'The text of Side.' ), false );
	let without = ( await call( 'GET', '/api/proposals/' + bottom.Id + '/prompt?parents=0' ) ).Body;
	ASSERT.equal( without.Prompt.includes( '# The parent plans' ), false );
	let top_prompt = ( await call( 'GET', '/api/proposals/' + top.Id + '/prompt' ) ).Body.Prompt;
	ASSERT.equal( top_prompt.includes( '# The parent plans' ), false );
	ASSERT.match( top_prompt, /Its Subplans[^\n]*\n- "Middle"\n- "Side"/ );

	// a copy carries its subplans, with new ids
	let copied = await call( 'POST', '/api/items/' + middle.Id + '/copy', { Project: project.Id } );
	ASSERT.equal( copied.Status, 201 );
	ASSERT.equal( copied.Body.Node.Items.length, 1 );
	ASSERT.notEqual( copied.Body.Node.Items[ 0 ].Id, bottom.Id );
	ASSERT.equal( ( await call( 'GET', '/api/proposals/' + copied.Body.Node.Items[ 0 ].Id ) ).Body.Proposal.Title.startsWith( 'Bottom' ), true );

	// the trash takes a plan's subplans with it
	let trashed = await call( 'DELETE', '/api/proposals/' + top.Id );
	ASSERT.equal( trashed.Status, 200 );
	ASSERT.deepEqual( trashed.Body.Subplans.slice().sort(), [ middle.Id, bottom.Id, side.Id ].sort() );
	ASSERT.equal( ( await call( 'GET', '/api/proposals/' + bottom.Id ) ).Status, 404 );
	listed = ( await call( 'GET', '/api/projects' ) ).Body.Projects.find( function ( candidate ) { return candidate.Id === project.Id; } );
	ASSERT.equal( listed.Items.some( function ( node ) { return node.Id === top.Id; } ), false );
} );


TEST( 'a corpus is kept in its project\'s folder, and moves and copies with it', async function ()
{
	let first = ( await call( 'POST', '/api/projects', { Name: 'Keeps a zip' } ) ).Body.Project;
	let second = ( await call( 'POST', '/api/projects', { Name: 'Takes it' } ) ).Body.Project;
	let made = await upload( 'POST', '/api/projects/' + first.Id + '/corpus?name=kept.zip', MAKER.Make( [ { Name: 'a.md', Data: '# A' } ] ) );
	let id = made.Body.Corpus.Id;
	let data = running.Store.Folder;
	ASSERT.equal( FS.existsSync( PATH.join( data, 'projects', first.Id, 'corpora', id, 'corpus.zip' ) ), true );
	ASSERT.equal( ( await call( 'POST', '/api/items/' + id + '/move', { Project: second.Id } ) ).Status, 200 );
	ASSERT.equal( FS.existsSync( PATH.join( data, 'projects', first.Id, 'corpora', id ) ), false );
	ASSERT.equal( FS.existsSync( PATH.join( data, 'projects', second.Id, 'corpora', id, 'corpus.zip' ) ), true );
	let copied = ( await call( 'POST', '/api/items/' + id + '/copy', { Project: first.Id } ) ).Body.Node;
	ASSERT.equal( FS.existsSync( PATH.join( data, 'projects', first.Id, 'corpora', copied.Id, 'corpus.zip' ) ), true );
	ASSERT.equal( ( await call( 'GET', '/api/corpus/' + id + '/file?path=a.md' ) ).Body.Text, '# A' );
} );


TEST( 'an attached corpus: its Include and Exclude narrow it; the LLM lists its files and reads one', async function ()
{
	let project = ( await call( 'POST', '/api/projects', { Name: 'Narrowed' } ) ).Body.Project;
	let zip = MAKER.Make( [
		{ Name: 'app/.gitignore', Data: 'dist/\n' },
		{ Name: 'app/README', Data: 'The heliograph flashes at noon.' },
		{ Name: 'app/src/main.go', Data: 'package main // semaphore tower' },
		{ Name: 'app/src/main_test.go', Data: 'package main // test' },
		{ Name: 'app/dist/out.js', Data: 'built' },
	] );
	let corpus = ( await upload( 'POST', '/api/projects/' + project.Id + '/corpus?name=app.zip', zip ) ).Body.Corpus;
	ASSERT.equal( corpus.Source, 'attached' );
	ASSERT.equal( corpus.Files.find( function ( file ) { return file.Path === 'app/dist/out.js'; } ).Reason, 'left out by app/.gitignore' );
	ASSERT.equal( corpus.Files.find( function ( file ) { return file.Path === 'app/README'; } ).Indexed, true );

	// narrowed: one pattern per line, or a list
	let narrowed = await call( 'PUT', '/api/corpus/' + corpus.Id + '/filter', { Include: 'app/src/**\n', Exclude: [ '**/*_test.go' ] } );
	ASSERT.equal( narrowed.Status, 200 );
	ASSERT.deepEqual( [ narrowed.Body.Corpus.Include, narrowed.Body.Corpus.Exclude ], [ [ 'app/src/**' ], [ '**/*_test.go' ] ] );
	let reasons = {};
	for ( let file of narrowed.Body.Corpus.Files )
	{
		reasons[ file.Path ] = file.Indexed ? 'read' : file.Reason;
	}
	ASSERT.equal( reasons[ 'app/src/main.go' ], 'read' );
	ASSERT.equal( reasons[ 'app/src/main_test.go' ], 'left out by Exclude' );
	ASSERT.equal( reasons[ 'app/README' ], 'not in Include' );
	ASSERT.equal( ( await call( 'GET', '/api/corpus/' + corpus.Id + '/file?path=app/README' ) ).Status, 409 );
	await search_until( 'semaphore tower', function ( list ) { return list.some( function ( hit ) { return hit.Corpus === corpus.Id; } ); } );
	await search_until( 'heliograph noon', function ( list ) { return !list.some( function ( hit ) { return hit.Corpus === corpus.Id; } ); } );
	ASSERT.equal( ( await call( 'PUT', '/api/corpus/none00000/filter', {} ) ).Status, 404 );

	// the LLM lists the corpus, then reads a file of it by the older name for the field
	let plan = ( await call( 'POST', '/api/proposals', { Title: 'Tower plan', Text: TEXT, Project: project.Id } ) ).Body.Proposal;
	let thread = ( await call( 'POST', '/api/proposals/' + plan.Id + '/threads', { Text: 'What is in the app?' } ) ).Body.Thread;
	let prompts = [];
	llm_answer = async function ( Prompt )
	{
		prompts.push( Prompt );
		if ( prompts.length === 1 )
		{
			return { Answer: { Actions: [], Requests: [ { Tool: 'list_project' }, { Tool: 'list_files', Corpus: 'app', Folder: 'app/src' }, { Tool: 'read_file', Zip: 'app', Path: 'app/src/main.go' }, { Tool: 'read_file', Corpus: 'app', Path: 'app/README' } ] }, Usage: { Model: 'fake-model', Input: 10, Output: 5 } };
		}
		return { Answer: { Actions: [ { Thread: thread.Id, Kind: 'reply', Reply: 'A Go program.' } ] }, Usage: { Model: 'fake-model', Input: 10, Output: 5 } };
	};
	await call( 'POST', '/api/proposals/' + plan.Id + '/session', {} );
	await wait_idle( plan.Id );
	ASSERT.equal( prompts.length, 2 );
	ASSERT.match( prompts[ 1 ], /- corpus "app" \(attached, 1 files read\), id z[0-9a-f]{8}/ );
	ASSERT.match( prompts[ 1 ], /The corpus "app" \(attached, 1 files read\), folder app\/src: 1 files\n- app\/src\/main\.go/ );
	ASSERT.equal( prompts[ 1 ].includes( 'main_test.go' ), false );
	ASSERT.match( prompts[ 1 ], /package main \/\/ semaphore tower/ );
	ASSERT.match( prompts[ 1 ], /refused: "app" does not read a file app\/README/ );
} );
