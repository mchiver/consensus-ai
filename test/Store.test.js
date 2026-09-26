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


TEST( 'a created proposal has its files, revision 1 and a plain id', async function ()
{
	let store = STORE.Open( temporary_folder() );
	let proposal = await store.CreateProposal( { Title: 'Hello, World!', Text: '# Hello\n\nText.\n', By: 'user', State: 'Proposal' } );
	ASSERT.match( proposal.Id, /^p[0-9a-f]{8}$/ );
	ASSERT.equal( STORE.IsNewId( proposal.Id, STORE.PROPOSAL_LETTER ), true );
	ASSERT.equal( STORE.IsNewId( 'hello-world-1a2b3c', STORE.PROPOSAL_LETTER ), false );
	ASSERT.equal( proposal.Revision, 1 );
	ASSERT.equal( proposal.State, 'Proposal' );
	ASSERT.equal( proposal.Kind, 'plan' );
	ASSERT.equal( 'Status' in proposal, false );
	ASSERT.equal( 'Approved' in proposal, false );
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
	let updated = await store.UpdateProposal( proposal.Id, { Title: 'New', State: 'Working' } );
	ASSERT.equal( updated.Title, 'New' );
	ASSERT.equal( updated.State, 'Working' );
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


TEST( 'projects: in the master\'s order, new ones last; created, written with a new version, found by item, moved, deleted', async function ()
{
	let store = STORE.Open( temporary_folder() );
	ASSERT.equal( FS.existsSync( PATH.join( store.Folder, 'projects' ) ), true );
	await store.Prepare();
	let zebra = await store.CreateProject( { Name: 'Zebra' } );
	let alpha = await store.CreateProject( { Name: 'Alpha work' } );
	ASSERT.match( alpha.Id, /^j[0-9a-f]{8}$/ );
	ASSERT.equal( alpha.Name, 'Alpha work' );
	ASSERT.equal( alpha.Version, 1 );
	ASSERT.deepEqual( alpha.Items, [] );
	function names( projects ) { return projects.map( function ( p ) { return p.Name; } ); }
	ASSERT.deepEqual( names( await store.ListProjects() ), [ 'Default', 'Zebra', 'Alpha work' ] );
	// the name lives in the master, not in project.json
	let master = JSON.parse( FS.readFileSync( PATH.join( store.Folder, 'projects.json' ), 'utf8' ) );
	ASSERT.deepEqual( master.Projects.map( function ( entry ) { return entry.Name; } ), [ 'Default', 'Zebra', 'Alpha work' ] );
	ASSERT.equal( 'Name' in JSON.parse( FS.readFileSync( PATH.join( store.Folder, 'projects', alpha.Id, 'project.json' ), 'utf8' ) ), false );
	alpha.Items.push( { Kind: 'plan', Id: 'p1' } );
	alpha.Name = 'Alpha, renamed';
	let written = await store.WriteProject( alpha );
	ASSERT.equal( written.Version, 2 );
	ASSERT.deepEqual( ( await store.ReadProject( alpha.Id ) ).Items, [ { Kind: 'plan', Id: 'p1' } ] );
	ASSERT.equal( ( await store.ReadProject( alpha.Id ) ).Name, 'Alpha, renamed' );
	ASSERT.equal( ( await store.ProjectOf( 'p1' ) ).Id, alpha.Id );
	ASSERT.equal( await store.ProjectOf( 'p2' ), null );
	ASSERT.equal( await store.ReadProject( '../proposals' ), null );
	// moved before Default, then to the end
	ASSERT.equal( await store.MoveProject( alpha.Id, 'default' ), true );
	ASSERT.deepEqual( names( await store.ListProjects() ), [ 'Alpha, renamed', 'Default', 'Zebra' ] );
	ASSERT.equal( await store.MoveProject( alpha.Id, null ), true );
	ASSERT.deepEqual( names( await store.ListProjects() ), [ 'Default', 'Zebra', 'Alpha, renamed' ] );
	ASSERT.equal( await store.MoveProject( alpha.Id, 'none' ), false );
	ASSERT.equal( await store.MoveProject( 'none', null ), false );
	ASSERT.equal( await store.DeleteProject( zebra.Id ), true );
	ASSERT.equal( await store.DeleteProject( zebra.Id ), false );
	ASSERT.equal( await store.ReadProject( zebra.Id ), null );
	ASSERT.deepEqual( names( await store.ListProjects() ), [ 'Default', 'Alpha, renamed' ] );
} );


TEST( 'an older data folder with no master lists Default first, then by name, with the names its project.json files carry', async function ()
{
	let folder = temporary_folder();
	for ( let project of [ { Id: 'zebra-111111', Name: 'Zebra' }, { Id: 'default', Name: 'Default' }, { Id: 'alpha-222222', Name: 'Alpha' } ] )
	{
		FS.mkdirSync( PATH.join( folder, 'projects', project.Id ), { recursive: true } );
		FS.writeFileSync( PATH.join( folder, 'projects', project.Id, 'project.json' ), JSON.stringify( Object.assign( { Version: 1, Items: [] }, project ) ) );
	}
	let store = STORE.Open( folder );
	ASSERT.deepEqual( ( await store.ListProjects() ).map( function ( p ) { return p.Name; } ), [ 'Default', 'Alpha', 'Zebra' ] );
	// a new project joins at the end; the master now names them all
	await store.CreateProject( { Name: 'Beta' } );
	ASSERT.deepEqual( ( await store.ListProjects() ).map( function ( p ) { return p.Name; } ), [ 'Default', 'Alpha', 'Zebra', 'Beta' ] );
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


TEST( 'corpora are kept in their project\'s folder: made, moved, copied, updated, trashed', async function ()
{
	let folder = temporary_folder();
	let store = STORE.Open( folder );
	await store.Prepare();
	let other = await store.CreateProject( { Name: 'Other' } );
	let made = await store.CreateCorpus( { Project: other.Id, Name: 'repo', Zip: Buffer.from( 'zip' ), Files: [] } );
	ASSERT.equal( made.Source, 'attached' );
	ASSERT.deepEqual( [ made.Include, made.Exclude ], [ [], [] ] );
	ASSERT.equal( FS.existsSync( PATH.join( folder, 'projects', other.Id, 'corpora', made.Id, 'corpus.zip' ) ), true );
	let linked = await store.CreateCorpus( { Name: 'docs', Link: { Server: 'Desk', Corpus: 'Docs' } } );
	ASSERT.equal( linked.Source, 'linked' );
	ASSERT.equal( FS.existsSync( PATH.join( folder, 'projects', 'default', 'corpora', linked.Id, 'corpus.zip' ) ), false );

	ASSERT.equal( await store.MoveCorpus( made.Id, 'default' ), true );
	ASSERT.equal( FS.existsSync( PATH.join( folder, 'projects', 'default', 'corpora', made.Id, 'corpus.json' ) ), true );
	ASSERT.equal( ( await store.ReadCorpusZip( made.Id ) ).toString(), 'zip' );
	let copy = await store.CopyCorpus( made.Id, other.Id );
	ASSERT.equal( FS.existsSync( PATH.join( folder, 'projects', other.Id, 'corpora', copy.Id, 'corpus.zip' ) ), true );
	let updated = await store.UpdateCorpus( made.Id, { Include: [ '**/*.md' ], Files: [] } );
	ASSERT.deepEqual( [ updated.Include, updated.Version ], [ [ '**/*.md' ], 2 ] );
	ASSERT.equal( await store.TrashCorpus( copy.Id ), true );
	ASSERT.equal( await store.ReadCorpus( copy.Id ), null );
	ASSERT.deepEqual( ( await store.ListCorpora() ).map( function ( corpus ) { return corpus.Id; } ).sort(), [ made.Id, linked.Id ].sort() );

} );
