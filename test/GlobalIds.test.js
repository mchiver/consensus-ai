'use strict';

// Global ids (the plan Global Ids): the id format, revisions with Id, Parent and Head, and an applied record's
// RevisionId.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const FS = require( 'fs' );
const OS = require( 'os' );
const PATH = require( 'path' );
const IDS = require( '../src/Ids.js' );
const STORE = require( '../src/Store.js' );
const SERVER = require( '../src/Server.js' );
const PARTICIPANTS = require( '../src/Participants.js' );

const GLOBAL = /^[a-z]{3}-[0-9a-z]{3}-[0-9a-z]{3}-[0-9a-z]{3}$/;

let folders = [];


function temporary_folder( prefix )
{
	let folder = FS.mkdtempSync( PATH.join( OS.tmpdir(), prefix ) );
	folders.push( folder );
	return folder;
}


async function call( server, method, path, body )
{
	let headers = ( body === undefined ) ? {} : { 'Content-Type': 'application/json' };
	let response = await fetch( server.Url + path, { method: method, headers: headers, body: ( body === undefined ) ? undefined : JSON.stringify( body ) } );
	return { Status: response.status, Body: await response.json() };
}


TEST.after( function ()
{
	for ( let folder of folders )
	{
		FS.rmSync( folder, { recursive: true, force: true } );
	}
} );


//---------------------------------------------------------------------

TEST( 'ids: three letters and three groups of three base36 characters, one kind for each thing', function ()
{
	for ( let kind of IDS.KINDS )
	{
		let id = IDS.New( kind );
		ASSERT.match( id, GLOBAL );
		ASSERT.equal( id.slice( 0, 3 ), kind );
		ASSERT.equal( IDS.Is( id, kind ), true );
	}
	ASSERT.deepEqual( IDS.KINDS, [ 'prj', 'pln', 'doc', 'ctx', 'fld', 'cor', 'thr', 'rep', 'rev', 'run' ] );
	ASSERT.equal( IDS.Is( 'p95cb55db' ), false );
	ASSERT.equal( IDS.Is( 'abc-000-000-000' ), false );
	ASSERT.equal( IDS.Is( IDS.New( IDS.PLAN ), IDS.DOCUMENT ), false );
	ASSERT.deepEqual( [ IDS.ForProposal( 'plan' ), IDS.ForProposal( 'document' ), IDS.ForProposal( 'context' ) ], [ 'pln', 'doc', 'ctx' ] );
	let many = new Set();
	for ( let count = 0; count < 2000; count++ )
	{
		many.add( IDS.New( IDS.REVISION ) );
	}
	ASSERT.equal( many.size, 2000 );
} );


TEST( 'revisions: each has an Id and the Parent it was made from; the proposal\'s Head is the current one', async function ()
{
	let store = STORE.Open( temporary_folder( 'consensus-ids-store-' ) );
	let document = await store.CreateProposal( { Title: 'Notes', Text: 'one', By: 'user', Kind: 'document' } );
	ASSERT.equal( IDS.Is( document.Id, IDS.DOCUMENT ), true );
	let first = await store.ReadRevision( document.Id, 1 );
	ASSERT.equal( IDS.Is( first.Id, IDS.REVISION ), true );
	ASSERT.equal( first.Parent, null );
	ASSERT.equal( document.Head, first.Id );
	let edited = await store.WriteText( document.Id, { Text: 'two', By: 'user', Reason: 'edit' } );
	let second = await store.ReadRevision( document.Id, 2 );
	ASSERT.equal( second.Parent, first.Id );
	ASSERT.equal( edited.Head, second.Id );
	ASSERT.equal( IDS.Is( ( await store.CreateProject( { Name: 'P' } ) ).Id, IDS.PROJECT ), true );
	ASSERT.equal( IDS.Is( ( await store.ListProposals() ).find( function ( proposal ) { return proposal.Kind === 'context'; } ).Id, IDS.CONTEXT ), true );
} );


TEST( 'an applied thread names its revision by number and by RevisionId', async function ()
{
	let running = await SERVER.Start( { Data: temporary_folder( 'consensus-ids-api-' ), Port: 0 } );
	let token = PARTICIPANTS.NewToken();
	running.Settings.Participants[ 1 ].Token = token;
	let plan = ( await call( running, 'POST', '/api/proposals', { Title: 'Plan', Text: '# Plan\n\nA line to change.\n' } ) ).Body.Proposal;
	ASSERT.equal( IDS.Is( plan.Id, IDS.PLAN ), true );
	let thread = ( await call( running, 'POST', '/api/proposals/' + plan.Id + '/threads', { Text: 'Change it.', Resolve: true } ) ).Body.Thread;
	ASSERT.equal( IDS.Is( thread.Id, IDS.THREAD ), true );
	ASSERT.equal( IDS.Is( thread.Replies[ 0 ].Id, IDS.REPLY ), true );
	let response = await fetch( running.Url + '/api/proposals/' + plan.Id + '/threads/' + thread.Id + '/apply', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify( { Text: '# Plan\n\nA line changed.\n', Revision: 1, Outcome: 'changed' } ) } );
	let applied = ( await response.json() ).Thread.Applied;
	let revision = ( await call( running, 'GET', '/api/proposals/' + plan.Id + '/revisions' ) ).Body.Revisions[ 1 ];
	ASSERT.deepEqual( [ applied.Revision, applied.RevisionId ], [ 2, revision.Id ] );
	await running.Close();
} );

