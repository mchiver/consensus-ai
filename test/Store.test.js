'use strict';

// The data folder, on a temporary folder: create, write, revisions, queueing, atomic write, trash.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const FS = require( 'fs' );
const OS = require( 'os' );
const PATH = require( 'path' );
const STORE = require( '../src/Store.js' );


function temporary_folder()
{
	return FS.mkdtempSync( PATH.join( OS.tmpdir(), 'consensus-store-' ) );
}


TEST( 'opening creates the folders; settings are absent until written', async function ()
{
	let folder = temporary_folder();
	let store = STORE.Open( folder );
	ASSERT.equal( FS.existsSync( PATH.join( folder, 'proposals' ) ), true );
	ASSERT.equal( FS.existsSync( PATH.join( folder, 'trash' ) ), true );
	ASSERT.equal( await store.ReadSettings(), null );
	await store.WriteSettings( { Port: 1, Participants: [] } );
	ASSERT.deepEqual( await store.ReadSettings(), { Port: 1, Participants: [] } );
	ASSERT.equal( store.SettingsPath(), PATH.join( folder, 'consensus.json' ) );
} );


TEST( 'a created proposal has its files, revision 1 and a slug id', async function ()
{
	let store = STORE.Open( temporary_folder() );
	let proposal = await store.CreateProposal( { Title: 'Hello, World!', Text: '# Hello\n\nText.\n', By: 'user' } );
	ASSERT.match( proposal.Id, /^hello-world-[0-9a-f]{6}$/ );
	ASSERT.equal( proposal.Revision, 1 );
	ASSERT.equal( proposal.Status, 'contested' );
	ASSERT.equal( proposal.Approved, null );
	let folder = PATH.join( store.Folder, 'proposals', proposal.Id );
	for ( let name of [ 'proposal.json', 'proposal.md', 'threads.json', 'revisions/0001.md', 'revisions/0001.json' ] )
	{
		ASSERT.equal( FS.existsSync( PATH.join( folder, name ) ), true, name );
	}
	let read = await store.ReadProposal( proposal.Id );
	ASSERT.deepEqual( read.Proposal, proposal );
	ASSERT.equal( read.Text, '# Hello\n\nText.\n' );
	ASSERT.deepEqual( read.Threads, [] );
	let revisions = await store.ListRevisions( proposal.Id );
	ASSERT.equal( revisions.length, 1 );
	ASSERT.equal( revisions[ 0 ].Reason, 'create' );
	ASSERT.equal( revisions[ 0 ].By, 'user' );
	ASSERT.equal( ( await store.ListProposals() ).length, 1 );
	ASSERT.equal( await store.ReadProposal( 'nope' ), null );
} );


TEST( 'writing text makes a new revision with its snapshot and reason', async function ()
{
	let store = STORE.Open( temporary_folder() );
	let proposal = await store.CreateProposal( { Title: 'T', Text: 'one', By: 'user' } );
	let updated = await store.WriteText( proposal.Id, { Text: 'two', By: 'llm', Reason: 'apply', Thread: 't1' } );
	ASSERT.equal( updated.Revision, 2 );
	let read = await store.ReadProposal( proposal.Id );
	ASSERT.equal( read.Text, 'two' );
	let revision = await store.ReadRevision( proposal.Id, 2 );
	ASSERT.equal( revision.Text, 'two' );
	ASSERT.equal( revision.Reason, 'apply' );
	ASSERT.equal( revision.Thread, 't1' );
	ASSERT.equal( ( await store.ReadRevision( proposal.Id, 1 ) ).Text, 'one' );
	ASSERT.equal( await store.ReadRevision( proposal.Id, 3 ), null );
	ASSERT.equal( ( await store.ListRevisions( proposal.Id ) ).length, 2 );
	ASSERT.equal( await store.WriteText( 'nope', { Text: 'x', By: 'user', Reason: 'edit' } ), null );
} );


TEST( 'proposal changes and threads are written whole', async function ()
{
	let store = STORE.Open( temporary_folder() );
	let proposal = await store.CreateProposal( { Title: 'T', Text: '', By: 'user' } );
	let updated = await store.UpdateProposal( proposal.Id, { Title: 'New', Status: 'consensus' } );
	ASSERT.equal( updated.Title, 'New' );
	ASSERT.equal( updated.Status, 'consensus' );
	await store.WriteThreads( proposal.Id, [ { Id: 't1' } ] );
	ASSERT.deepEqual( ( await store.ReadProposal( proposal.Id ) ).Threads, [ { Id: 't1' } ] );
	ASSERT.deepEqual( await store.ReadIndex( proposal.Id ), [] );
	await store.WriteIndex( proposal.Id, [ { Chunk: 1 } ] );
	ASSERT.deepEqual( await store.ReadIndex( proposal.Id ), [ { Chunk: 1 } ] );
} );


TEST( 'writes are atomic: no .tmp files remain and the file is whole', async function ()
{
	let store = STORE.Open( temporary_folder() );
	let proposal = await store.CreateProposal( { Title: 'T', Text: 'x'.repeat( 100000 ), By: 'user' } );
	let folder = PATH.join( store.Folder, 'proposals', proposal.Id );
	let files = FS.readdirSync( folder ).concat( FS.readdirSync( PATH.join( folder, 'revisions' ) ) );
	ASSERT.equal( files.some( function ( name ) { return name.endsWith( '.tmp' ); } ), false );
	ASSERT.equal( FS.readFileSync( PATH.join( folder, 'proposal.md' ), 'utf8' ).length, 100000 );
} );


TEST( 'the queue runs one proposal\'s work in order and other proposals\' work independently', async function ()
{
	let store = STORE.Open( temporary_folder() );
	let order = [];
	function work( label, delay )
	{
		return async function ()
		{
			await new Promise( function ( resolve ) { setTimeout( resolve, delay ); } );
			order.push( label );
			return label;
		};
	}
	let results = await Promise.all( [
		store.Queue( 'a', work( 'a1', 30 ) ),
		store.Queue( 'a', work( 'a2', 1 ) ),
		store.Queue( 'b', work( 'b1', 5 ) ),
	] );
	ASSERT.deepEqual( results, [ 'a1', 'a2', 'b1' ] );
	ASSERT.deepEqual( order, [ 'b1', 'a1', 'a2' ] );
	// a failure does not block the queue behind it
	await ASSERT.rejects( store.Queue( 'a', async function () { throw new Error( 'boom' ); } ), /boom/ );
	ASSERT.equal( await store.Queue( 'a', work( 'a3', 1 ) ), 'a3' );
} );


TEST( 'queued writes to one proposal do not interleave', async function ()
{
	let store = STORE.Open( temporary_folder() );
	let proposal = await store.CreateProposal( { Title: 'T', Text: '0', By: 'user' } );
	let writes = [];
	for ( let index = 1; index <= 5; index++ )
	{
		writes.push( store.Queue( proposal.Id, async function ()
		{
			let read = await store.ReadProposal( proposal.Id );
			await store.WriteText( proposal.Id, { Text: String( parseInt( read.Text, 10 ) + 1 ), By: 'user', Reason: 'edit' } );
		} ) );
	}
	await Promise.all( writes );
	let read = await store.ReadProposal( proposal.Id );
	ASSERT.equal( read.Text, '5' );
	ASSERT.equal( read.Proposal.Revision, 6 );
} );


TEST( 'a trashed proposal moves whole and leaves the list', async function ()
{
	let store = STORE.Open( temporary_folder() );
	let proposal = await store.CreateProposal( { Title: 'Gone', Text: 'x', By: 'user' } );
	ASSERT.equal( await store.TrashProposal( proposal.Id ), true );
	ASSERT.equal( await store.TrashProposal( proposal.Id ), false );
	ASSERT.equal( ( await store.ListProposals() ).length, 0 );
	ASSERT.equal( await store.ReadProposal( proposal.Id ), null );
	let trash = await store.ListTrash();
	ASSERT.equal( trash.length, 1 );
	ASSERT.equal( trash[ 0 ].Id, proposal.Id );
	ASSERT.equal( FS.existsSync( PATH.join( store.Folder, 'trash', proposal.Id, 'revisions', '0001.md' ) ), true );
} );


TEST( 'proposals list newest updated first', async function ()
{
	let store = STORE.Open( temporary_folder() );
	let first = await store.CreateProposal( { Title: 'First', Text: '', By: 'user' } );
	await new Promise( function ( resolve ) { setTimeout( resolve, 5 ); } );
	let second = await store.CreateProposal( { Title: 'Second', Text: '', By: 'user' } );
	ASSERT.deepEqual( ( await store.ListProposals() ).map( function ( p ) { return p.Id; } ), [ second.Id, first.Id ] );
	await new Promise( function ( resolve ) { setTimeout( resolve, 5 ); } );
	await store.UpdateProposal( first.Id, { Title: 'First again' } );
	ASSERT.deepEqual( ( await store.ListProposals() ).map( function ( p ) { return p.Id; } ), [ first.Id, second.Id ] );
} );
