'use strict';

// The data folder, on a temporary folder: create, write, revisions, queueing, atomic write, trash, projects with their
// Context folder, and the migration of a data folder from before plan Consensus Desktop.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const FS = require( 'fs' );
const OS = require( 'os' );
const PATH = require( 'path' );
const STORE = require( '../src/Store.js' );
const IDS = require( '../src/Ids.js' );


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
	ASSERT.match( proposal.Id, /^pln-[0-9a-z]{3}-[0-9a-z]{3}-[0-9a-z]{3}$/ );
	ASSERT.equal( IDS.Is( proposal.Id, IDS.PLAN ), true );
	ASSERT.equal( IDS.Is( 'hello-world-1a2b3c' ), false );
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
	ASSERT.match( alpha.Id, /^prj-[0-9a-z]{3}-[0-9a-z]{3}-[0-9a-z]{3}$/ );
	ASSERT.equal( alpha.Name, 'Alpha work' );
	ASSERT.equal( alpha.Version, 1 );
	// a new project holds its Context folder, first, with its Context document
	ASSERT.equal( alpha.Items.length, 1 );
	ASSERT.equal( alpha.Items[ 0 ].Id, alpha.ContextFolder );
	ASSERT.equal( alpha.Items[ 0 ].Name, 'Context' );
	ASSERT.deepEqual( alpha.Items[ 0 ].Items, [ { Kind: 'document', Id: alpha.Context } ] );
	ASSERT.equal( IDS.Is( alpha.ContextFolder, IDS.FOLDER ), true );
	ASSERT.equal( ( await store.ReadProposal( alpha.Context ) ).Proposal.Kind, 'document' );
	ASSERT.equal( ( await store.ReadProposal( alpha.Context ) ).Proposal.Title, 'Context' );
	ASSERT.equal( ( await store.ProjectOf( alpha.Context ) ).Id, alpha.Id );
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
	ASSERT.deepEqual( ( await store.ReadProject( alpha.Id ) ).Items[ 1 ], { Kind: 'plan', Id: 'p1' } );
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


TEST( 'migration: a data folder from before Consensus Desktop gets its Context folders, loses its corpora and the LLM\'s files', async function ()
{
	let folder = temporary_folder();
	// A project as the old server kept it: a context proposal of Kind context, a corpus in its tree and folder, and a plan.
	FS.mkdirSync( PATH.join( folder, 'proposals', 'ctx-aaa-aaa-aaa', 'revisions' ), { recursive: true } );
	FS.writeFileSync( PATH.join( folder, 'proposals', 'ctx-aaa-aaa-aaa', 'proposal.json' ), JSON.stringify( { Id: 'ctx-aaa-aaa-aaa', Title: 'Context', Kind: 'context', State: null, Created: 't', Updated: 't', Revision: 1 } ) );
	FS.writeFileSync( PATH.join( folder, 'proposals', 'ctx-aaa-aaa-aaa', 'proposal.md' ), '# Context\n' );
	FS.writeFileSync( PATH.join( folder, 'proposals', 'ctx-aaa-aaa-aaa', 'threads.json' ), '[]' );
	FS.writeFileSync( PATH.join( folder, 'proposals', 'ctx-aaa-aaa-aaa', 'index.json' ), '[]' );
	FS.mkdirSync( PATH.join( folder, 'proposals', 'pln-bbb-bbb-bbb', 'revisions' ), { recursive: true } );
	FS.writeFileSync( PATH.join( folder, 'proposals', 'pln-bbb-bbb-bbb', 'proposal.json' ), JSON.stringify( { Id: 'pln-bbb-bbb-bbb', Title: 'Plan', Kind: 'plan', State: 'Proposal', Created: 't', Updated: 't', Revision: 1 } ) );
	FS.writeFileSync( PATH.join( folder, 'proposals', 'pln-bbb-bbb-bbb', 'proposal.md' ), '# Plan\n' );
	FS.writeFileSync( PATH.join( folder, 'proposals', 'pln-bbb-bbb-bbb', 'threads.json' ), '[]' );
	FS.writeFileSync( PATH.join( folder, 'proposals', 'pln-bbb-bbb-bbb', 'runs.json' ), '[]' );
	FS.mkdirSync( PATH.join( folder, 'projects', 'default', 'corpora', 'cor-ccc-ccc-ccc' ), { recursive: true } );
	FS.writeFileSync( PATH.join( folder, 'projects', 'default', 'corpora', 'cor-ccc-ccc-ccc', 'corpus.json' ), JSON.stringify( { Id: 'cor-ccc-ccc-ccc', Kind: 'corpus', Name: 'repo', Updated: 't', Files: [] } ) );
	FS.writeFileSync( PATH.join( folder, 'projects', 'default', 'project.json' ), JSON.stringify( {
		Id: 'default', Context: 'ctx-aaa-aaa-aaa', Created: 't', Updated: 't', Version: 3, Workspace: { Worker: 'w', Name: 'x' },
		Items: [ { Kind: 'folder', Id: 'fld-ddd-ddd-ddd', Name: 'Drafts', Items: [ { Kind: 'plan', Id: 'pln-bbb-bbb-bbb' }, { Kind: 'corpus', Id: 'cor-ccc-ccc-ccc' } ] } ],
	} ) );
	FS.writeFileSync( PATH.join( folder, 'projects.json' ), JSON.stringify( { Projects: [ { Id: 'default', Name: 'Default' } ] } ) );
	FS.writeFileSync( PATH.join( folder, 'usage.json' ), '{}' );

	let store = STORE.Open( folder );
	let lines = await store.Prepare();
	ASSERT.equal( lines.length, 3, lines.join( '\n' ) );
	ASSERT.match( lines[ 0 ], /^projects\/default: the Context folder made, fld-.*, 1 corpora to the trash$/ );
	ASSERT.equal( lines[ 1 ], 'usage.json: removed' );
	ASSERT.equal( lines[ 2 ], 'proposals: 2 runs.json and index.json files removed' );

	let project = await store.ReadProject( 'default' );
	ASSERT.equal( project.Context, 'ctx-aaa-aaa-aaa' );
	ASSERT.equal( project.Items[ 0 ].Id, project.ContextFolder );
	ASSERT.deepEqual( project.Items[ 0 ].Items, [ { Kind: 'document', Id: 'ctx-aaa-aaa-aaa' } ] );
	ASSERT.deepEqual( project.Items[ 1 ], { Kind: 'folder', Id: 'fld-ddd-ddd-ddd', Name: 'Drafts', Items: [ { Kind: 'plan', Id: 'pln-bbb-bbb-bbb' } ] } );
	ASSERT.equal( 'Workspace' in project, false );
	ASSERT.equal( ( await store.ReadProposal( 'ctx-aaa-aaa-aaa' ) ).Proposal.Kind, 'document' );
	ASSERT.equal( FS.existsSync( PATH.join( folder, 'trash', 'cor-ccc-ccc-ccc', 'corpus.json' ) ), true );
	ASSERT.equal( FS.existsSync( PATH.join( folder, 'projects', 'default', 'corpora', 'cor-ccc-ccc-ccc' ) ), false );
	ASSERT.equal( FS.existsSync( PATH.join( folder, 'usage.json' ) ), false );
	ASSERT.equal( FS.existsSync( PATH.join( folder, 'proposals', 'ctx-aaa-aaa-aaa', 'index.json' ) ), false );
	ASSERT.equal( FS.existsSync( PATH.join( folder, 'proposals', 'pln-bbb-bbb-bbb', 'runs.json' ) ), false );
	ASSERT.equal( ( await store.ListTrash() ).map( function ( item ) { return item.Kind; } ).join( ',' ), 'corpus' );

	// A second start does nothing more.
	ASSERT.deepEqual( await STORE.Open( folder ).Prepare(), [] );
} );
