'use strict';

// The API, started on port 0 over a temporary folder and driven with fetch.
// Nothing here spawns bin/consensus.js and nothing reads ~data.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const FS = require( 'fs' );
const OS = require( 'os' );
const PATH = require( 'path' );
const SERVER = require( '../src/Server.js' );

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
	running = await SERVER.Start( { Data: temporary_folder(), Port: 0 } );
	token = running.Settings.Participants[ 1 ].Token;
} );


TEST.after( async function ()
{
	await running.Close();
} );


//---------------------------------------------------------------------

TEST( 'start writes the settings, binds to 127.0.0.1 and refuses any other host', async function ()
{
	ASSERT.equal( running.SettingsWritten, true );
	ASSERT.equal( running.Address.Host, '127.0.0.1' );
	ASSERT.equal( FS.existsSync( running.Store.SettingsPath() ), true );
	await ASSERT.rejects( SERVER.Start( { Data: temporary_folder(), Port: 0, Host: '0.0.0.0' } ), /localhost only/ );
	let again = await SERVER.Start( { Data: running.Store.Folder, Port: 0 } );
	ASSERT.equal( again.SettingsWritten, false );
	ASSERT.equal( again.Settings.Participants[ 1 ].Token, token );
	await again.Close();
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
	ASSERT.equal( proposal.Status, 'contested' );
	ASSERT.equal( proposal.Revision, 1 );
	ASSERT.equal( proposal.State, 'no threads yet' );
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
	ASSERT.equal( read.Body.Proposal.State, '2 contested, waiting on you 1' );
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
	ASSERT.equal( resolved.Body.Thread.Status, 'consensus' );
	ASSERT.equal( resolved.Body.Thread.Resolved.By, 'user' );
	ASSERT.deepEqual( resolved.Body.Thread.Turn, [ 'llm' ] );
	ASSERT.equal( ( await call( 'POST', '/api/proposals/' + proposal.Id + '/threads/' + thread.Id + '/resolve' ) ).Status, 409 );
	let read = await call( 'GET', '/api/proposals/' + proposal.Id );
	ASSERT.equal( read.Body.Proposal.State, '1 waiting to be applied' );
	let reply = await call( 'POST', '/api/proposals/' + proposal.Id + '/threads/' + thread.Id + '/replies', { Text: 'Wait, one more thing.' } );
	ASSERT.equal( reply.Status, 201 );
	ASSERT.equal( reply.Body.Reopened, true );
	ASSERT.equal( reply.Body.Thread.Status, 'contested' );
	ASSERT.equal( reply.Body.Thread.Reopened, true );
	ASSERT.equal( reply.Body.Thread.Resolved, null );
	let reopened = await call( 'GET', '/api/proposals/' + proposal.Id + '/threads?status=reopened' );
	ASSERT.equal( reopened.Body.Threads.length, 1 );
	ASSERT.equal( ( await call( 'GET', '/api/proposals/' + proposal.Id ) ).Body.Proposal.State, '1 contested, 1 reopened' );
	ASSERT.equal( ( await call( 'GET', '/api/proposals/' + proposal.Id, undefined, true ) ).Body.Proposal.State, '1 contested, waiting on you 1, 1 reopened' );
	ASSERT.equal( ( await call( 'POST', '/api/proposals/' + proposal.Id + '/threads/none/replies', { Text: 'x' } ) ).Status, 404 );
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
	let applied = await call( 'POST', '/api/proposals/' + proposal.Id + '/threads/' + thread.Id + '/apply', { Text: new_text, Outcome: 'reworded', Revision: 1, Anchor: { Text: 'a reworded list item' } }, true );
	ASSERT.equal( applied.Status, 200 );
	ASSERT.equal( applied.Body.Proposal.Revision, 2 );
	ASSERT.equal( applied.Body.Thread.Applied.By, 'llm' );
	ASSERT.equal( applied.Body.Thread.Applied.Revision, 2 );
	ASSERT.equal( applied.Body.Thread.Applied.Outcome, 'reworded' );
	ASSERT.equal( applied.Body.Thread.Anchor.Text, 'a reworded list item' );
	ASSERT.equal( applied.Body.Thread.Found.Method, 'exact' );
	ASSERT.deepEqual( applied.Body.Thread.Turn, [] );
	ASSERT.equal( applied.Body.Proposal.State, '1 applied · ready for approval as a Plan' );
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


TEST( 'approval: refused while contested or waiting, owner only, then a Plan; an edit or a comment makes it contested again', async function ()
{
	let proposal = await create( 'Approve' );
	let thread = await discussed_thread( proposal.Id, 'one list item', 'Outcome: nothing to change.' );
	let contested = await call( 'POST', '/api/proposals/' + proposal.Id + '/approve' );
	ASSERT.equal( contested.Status, 409 );
	ASSERT.match( contested.Body.Error, /contested/ );
	await call( 'POST', '/api/proposals/' + proposal.Id + '/threads/' + thread.Id + '/resolve' );
	let waiting = await call( 'POST', '/api/proposals/' + proposal.Id + '/approve' );
	ASSERT.equal( waiting.Status, 409 );
	ASSERT.match( waiting.Body.Error, /waiting to be applied/ );
	await call( 'POST', '/api/proposals/' + proposal.Id + '/threads/' + thread.Id + '/apply', { Outcome: 'nothing to change' }, true );
	ASSERT.equal( ( await call( 'POST', '/api/proposals/' + proposal.Id + '/approve', undefined, true ) ).Status, 403 );
	let approved = await call( 'POST', '/api/proposals/' + proposal.Id + '/approve' );
	ASSERT.equal( approved.Status, 200 );
	ASSERT.equal( approved.Body.Proposal.Status, 'consensus' );
	ASSERT.deepEqual( Object.keys( approved.Body.Proposal.Approved ), [ 'By', 'At', 'Revision' ] );
	ASSERT.equal( approved.Body.Proposal.Approved.Revision, 1 );
	ASSERT.equal( approved.Body.Proposal.State, 'a Plan, approved at revision 1' );
	let plans = await call( 'GET', '/api/proposals?status=consensus' );
	ASSERT.deepEqual( plans.Body.Proposals.map( function ( candidate ) { return candidate.Id; } ), [ proposal.Id ] );
	ASSERT.equal( ( await call( 'POST', '/api/proposals/' + proposal.Id + '/approve' ) ).Status, 409 );
	// a manual edit from a stale revision is refused; from the current one it makes a revision and a contested proposal
	let stale = await call( 'PUT', '/api/proposals/' + proposal.Id + '/text', { Text: TEXT + '\nMore.\n', Revision: 0 } );
	ASSERT.equal( stale.Status, 409 );
	ASSERT.equal( stale.Body.Revision, 1 );
	let edited = await call( 'PUT', '/api/proposals/' + proposal.Id + '/text', { Text: TEXT + '\nMore.\n', Revision: 1 } );
	ASSERT.equal( edited.Status, 200 );
	ASSERT.equal( edited.Body.Proposal.Status, 'contested' );
	ASSERT.equal( edited.Body.Proposal.Approved, null );
	ASSERT.equal( edited.Body.Proposal.Revision, 2 );
	ASSERT.equal( ( await call( 'GET', '/api/proposals/' + proposal.Id + '/revisions' ) ).Body.Revisions[ 1 ].Reason, 'edit' );
	ASSERT.equal( ( await call( 'GET', '/api/proposals?status=consensus' ) ).Body.Proposals.length, 0 );
	// a manual edit changes no thread's status
	let after_edit = await call( 'GET', '/api/proposals/' + proposal.Id );
	ASSERT.equal( after_edit.Body.Threads[ 0 ].Status, 'consensus' );
	ASSERT.equal( after_edit.Body.Threads[ 0 ].Applied.Outcome, 'nothing to change' );
	// approve again, then a reply in the applied thread reopens it and the Plan is contested again
	await call( 'POST', '/api/proposals/' + proposal.Id + '/approve' );
	let reply = await call( 'POST', '/api/proposals/' + proposal.Id + '/threads/' + thread.Id + '/replies', { Text: 'Second thoughts.' }, true );
	ASSERT.equal( reply.Body.Reopened, true );
	ASSERT.equal( reply.Body.Thread.Applied.Outcome, 'nothing to change' );
	let after_reply = await call( 'GET', '/api/proposals/' + proposal.Id );
	ASSERT.equal( after_reply.Body.Proposal.Status, 'contested' );
	ASSERT.equal( after_reply.Body.Proposal.Approved, null );
	ASSERT.equal( after_reply.Body.Proposal.Tally.Reopened, 1 );
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
	ASSERT.deepEqual( await next_event(), { Proposal: proposal.Id, Kind: 'created' } );
	let thread = ( await call( 'POST', '/api/proposals/' + proposal.Id + '/threads', { Anchor: null, Text: 'Hello?' } ) ).Body.Thread;
	ASSERT.deepEqual( await next_event(), { Proposal: proposal.Id, Kind: 'thread', Thread: thread.Id } );
	await call( 'POST', '/api/proposals/' + proposal.Id + '/threads/' + thread.Id + '/replies', { Text: 'Hello.' }, true );
	ASSERT.equal( ( await next_event() ).Kind, 'reply' );
	await call( 'POST', '/api/proposals/' + proposal.Id + '/threads/' + thread.Id + '/resolve' );
	ASSERT.equal( ( await next_event() ).Kind, 'resolved' );
	await call( 'POST', '/api/proposals/' + proposal.Id + '/threads/' + thread.Id + '/apply', { Outcome: 'said hello' }, true );
	ASSERT.equal( ( await next_event() ).Kind, 'applied' );
	await call( 'POST', '/api/proposals/' + proposal.Id + '/approve' );
	ASSERT.equal( ( await next_event() ).Kind, 'approved' );
	await call( 'PUT', '/api/proposals/' + proposal.Id + '/text', { Text: 'changed', Revision: 1 } );
	ASSERT.equal( ( await next_event() ).Kind, 'text' );
	await call( 'DELETE', '/api/proposals/' + proposal.Id );
	ASSERT.equal( ( await next_event() ).Kind, 'trashed' );
	await reader.cancel();
} );
