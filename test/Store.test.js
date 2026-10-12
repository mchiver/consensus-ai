'use strict';

// The store over the config folder and the project folders (plan Run Shapes, Step 2), on temporary folders: create,
// write, revisions, queueing, atomic writes, the trash and the archive per project, projects as folders in the
// settings' order, items copied and moved between projects, missing folders, and the migration of a config folder
// from before Step 2 (and of a data folder from before plan Consensus Desktop on the way).

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


// A store with its settings prepared: one project, Default, in <config>/projects/Default.
async function prepared()
{
	let store = STORE.Open( temporary_folder() );
	let settings = { Name: 'test', Port: 0, Scope: 'Local', States: [ 'Draft', 'Plan', 'Working', 'Finished' ], Participants: [ { Name: 'user', Role: 'owner' } ] };
	await store.WriteSettings( settings );
	let lines = await store.Prepare( settings );
	let home = ( await store.ListProjects() )[ 0 ];
	return { Store: store, Settings: settings, Lines: lines, Home: home };
}


function home_of( store, project )
{
	return PATH.join( project.Path, '.consensus' );
}


TEST( 'opening makes the config folder; settings are absent until written; Prepare makes the Default project in its folder', async function ()
{
	let folder = temporary_folder();
	let store = STORE.Open( folder );
	ASSERT.equal( await store.ReadSettings(), null );
	await store.WriteSettings( { Port: 1, Participants: [] } );
	ASSERT.deepEqual( await store.ReadSettings(), { Port: 1, Participants: [] } );
	ASSERT.equal( store.SettingsPath(), PATH.join( folder, 'consensus.json' ) );
	let settings = { Port: 1, Participants: [] };
	let lines = await store.Prepare( settings );
	ASSERT.equal( lines.length, 1 );
	ASSERT.match( lines[ 0 ], /^project Default created at / );
	let projects = await store.ListProjects();
	ASSERT.equal( projects.length, 1 );
	ASSERT.match( projects[ 0 ].Id, /^prj-[0-9a-z]{3}-[0-9a-z]{3}-[0-9a-z]{3}$/ );
	ASSERT.equal( projects[ 0 ].Name, 'Default' );
	ASSERT.equal( projects[ 0 ].Path, PATH.join( folder, 'projects', 'Default' ) );
	ASSERT.deepEqual( projects[ 0 ].States, STORE.DEFAULT_STATES );
	ASSERT.deepEqual( [ projects[ 0 ].Include, projects[ 0 ].Exclude, projects[ 0 ].Commands, projects[ 0 ].Archive ], [ [], STORE.DEFAULT_EXCLUDE, [], [] ] );
	// the settings list the folder, and were written with it
	ASSERT.deepEqual( settings.Projects, [ { Path: projects[ 0 ].Path } ] );
	ASSERT.deepEqual( ( await store.ReadSettings() ).Projects, settings.Projects );
	ASSERT.equal( FS.existsSync( PATH.join( folder, 'projects', 'Default', '.consensus', 'project.json' ) ), true );
	ASSERT.equal( 'Path' in JSON.parse( FS.readFileSync( PATH.join( folder, 'projects', 'Default', '.consensus', 'project.json' ), 'utf8' ) ), false );
	ASSERT.deepEqual( store.Roots(), [ { Id: projects[ 0 ].Id, Path: projects[ 0 ].Path } ] );
	ASSERT.deepEqual( store.Missing(), [] );
	// a second Prepare does nothing more
	ASSERT.deepEqual( await STORE.Open( folder ).Prepare( await store.ReadSettings() ), [] );
} );


TEST( 'a created proposal has its files in its project\'s content folder, revision 1 and a plain id', async function ()
{
	let ready = await prepared();
	let store = ready.Store;
	let proposal = await store.CreateProposal( { Project: ready.Home.Id, Title: 'Hello, World!', Text: '# Hello\n\nText.\n', By: 'user', State: 'Draft' } );
	ASSERT.match( proposal.Id, /^pln-[0-9a-z]{3}-[0-9a-z]{3}-[0-9a-z]{3}$/ );
	ASSERT.equal( IDS.Is( proposal.Id, IDS.PLAN ), true );
	ASSERT.equal( proposal.Revision, 1 );
	ASSERT.equal( proposal.State, 'Draft' );
	ASSERT.equal( proposal.Kind, 'plan' );
	let folder = PATH.join( home_of( store, ready.Home ), 'content', proposal.Id );
	for ( let name of [ 'content.json', 'content.md', 'threads.json', 'revisions/0001.md', 'revisions/0001.json' ] )
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
	// the Readme is there too
	ASSERT.equal( ( await store.ListProposals() ).length, 2 );
	ASSERT.equal( await store.ReadProposal( 'nope' ), null );
	ASSERT.equal( ( await store.ProjectOf( proposal.Id ) ).Id, ready.Home.Id );
	await ASSERT.rejects( store.CreateProposal( { Project: 'prj-no-such', Title: 'x', Text: '', By: 'user' } ), /no such project/ );
} );


TEST( 'writing text makes a new revision with its snapshot and reason', async function ()
{
	let ready = await prepared();
	let store = ready.Store;
	let proposal = await store.CreateProposal( { Project: ready.Home.Id, Title: 'T', Text: 'one', By: 'user' } );
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
	let ready = await prepared();
	let store = ready.Store;
	let proposal = await store.CreateProposal( { Project: ready.Home.Id, Title: 'T', Text: '', By: 'user' } );
	let updated = await store.UpdateProposal( proposal.Id, { Title: 'New', State: 'Working' } );
	ASSERT.equal( updated.Title, 'New' );
	ASSERT.equal( updated.State, 'Working' );
	await store.WriteThreads( proposal.Id, [ { Id: 't1' } ] );
	ASSERT.deepEqual( ( await store.ReadProposal( proposal.Id ) ).Threads, [ { Id: 't1' } ] );
} );


TEST( 'writes are atomic: no .tmp files remain and the file is whole', async function ()
{
	let ready = await prepared();
	let store = ready.Store;
	let proposal = await store.CreateProposal( { Project: ready.Home.Id, Title: 'T', Text: 'x'.repeat( 100000 ), By: 'user' } );
	let folder = PATH.join( home_of( store, ready.Home ), 'content', proposal.Id );
	let files = FS.readdirSync( folder ).concat( FS.readdirSync( PATH.join( folder, 'revisions' ) ) );
	ASSERT.equal( files.some( function ( name ) { return name.endsWith( '.tmp' ); } ), false );
	ASSERT.equal( FS.readFileSync( PATH.join( folder, 'content.md' ), 'utf8' ).length, 100000 );
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
	let ready = await prepared();
	let store = ready.Store;
	let proposal = await store.CreateProposal( { Project: ready.Home.Id, Title: 'T', Text: '0', By: 'user' } );
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


TEST( 'a trashed proposal moves whole into its project\'s trash and leaves the list', async function ()
{
	let ready = await prepared();
	let store = ready.Store;
	let proposal = await store.CreateProposal( { Project: ready.Home.Id, Title: 'Gone', Text: 'x', By: 'user' } );
	ASSERT.equal( await store.TrashProposal( proposal.Id ), true );
	ASSERT.equal( await store.TrashProposal( proposal.Id ), false );
	ASSERT.equal( ( await store.ListProposals() ).length, 1 );
	ASSERT.equal( await store.ReadProposal( proposal.Id ), null );
	let trash = await store.ListTrash();
	ASSERT.equal( trash.length, 1 );
	ASSERT.equal( trash[ 0 ].Id, proposal.Id );
	ASSERT.equal( trash[ 0 ].Project, ready.Home.Id );
	ASSERT.equal( FS.existsSync( PATH.join( home_of( store, ready.Home ), 'trash', proposal.Id, 'revisions', '0001.md' ) ), true );
} );


TEST( 'an archived proposal moves to its project\'s archive, reads as archived, refuses writes, and comes back', async function ()
{
	let ready = await prepared();
	let store = ready.Store;
	let proposal = await store.CreateProposal( { Project: ready.Home.Id, Title: 'Done', Text: 'x', By: 'user', State: 'Finished' } );
	ASSERT.equal( await store.ArchiveProposal( proposal.Id ), true );
	ASSERT.equal( await store.ArchiveProposal( proposal.Id ), false );
	ASSERT.equal( FS.existsSync( PATH.join( home_of( store, ready.Home ), 'archive', proposal.Id, 'content.md' ) ), true );
	ASSERT.equal( FS.existsSync( PATH.join( home_of( store, ready.Home ), 'content', proposal.Id ) ), false );
	let read = await store.ReadProposal( proposal.Id );
	ASSERT.equal( read.Proposal.Archived, true );
	ASSERT.equal( read.Text, 'x' );
	ASSERT.equal( ( await store.ListRevisions( proposal.Id ) ).length, 1 );
	// not listed among the live ones; still its project's
	ASSERT.equal( ( await store.ListProposals() ).some( function ( one ) { return one.Id === proposal.Id; } ), false );
	ASSERT.equal( ( await store.ProjectOf( proposal.Id ) ).Id, ready.Home.Id );
	await ASSERT.rejects( store.WriteText( proposal.Id, { Text: 'y', By: 'user', Reason: 'edit' } ), /is archived/ );
	await ASSERT.rejects( store.WriteThreads( proposal.Id, [] ), /is archived/ );
	await ASSERT.rejects( store.UpdateProposal( proposal.Id, { Title: 'z' } ), /is archived/ );
	ASSERT.equal( await store.MoveProposal( proposal.Id, ready.Home.Id ), false );
	ASSERT.equal( await store.RestoreProposal( proposal.Id ), true );
	ASSERT.equal( await store.RestoreProposal( proposal.Id ), false );
	ASSERT.equal( 'Archived' in ( await store.ReadProposal( proposal.Id ) ).Proposal, false );
	ASSERT.equal( ( await store.UpdateProposal( proposal.Id, { Title: 'z' } ) ).Title, 'z' );
	// a store opened again over the same config knows the archived one
	await store.ArchiveProposal( proposal.Id );
	let again = STORE.Open( store.Folder );
	await again.Prepare( await again.ReadSettings() );
	ASSERT.equal( ( await again.ReadProposal( proposal.Id ) ).Proposal.Archived, true );
} );


TEST( 'projects: folders in the settings\' order, new ones last; created, opened, written with a new version, found by item, moved, deleted', async function ()
{
	let ready = await prepared();
	let store = ready.Store;
	let home = ready.Home;
	let zebra = await store.CreateProject( { Name: 'Zebra' } );
	let elsewhere = PATH.join( temporary_folder(), 'alpha-repo' );
	let alpha = await store.CreateProject( { Name: 'Alpha work', Path: elsewhere } );
	ASSERT.match( alpha.Id, /^prj-[0-9a-z]{3}-[0-9a-z]{3}-[0-9a-z]{3}$/ );
	ASSERT.equal( alpha.Name, 'Alpha work' );
	ASSERT.equal( alpha.Version, 1 );
	ASSERT.equal( alpha.Path, elsewhere );
	ASSERT.equal( FS.existsSync( PATH.join( elsewhere, '.consensus', 'project.json' ) ), true );
	ASSERT.equal( zebra.Path, PATH.join( store.Folder, 'projects', 'Zebra' ) );
	// a new project holds its Context folder, first, with its Readme, in its own content folder
	ASSERT.equal( alpha.Items.length, 1 );
	ASSERT.equal( alpha.Items[ 0 ].Id, alpha.ContextFolder );
	ASSERT.equal( alpha.Items[ 0 ].Name, 'Context' );
	ASSERT.deepEqual( alpha.Items[ 0 ].Items, [ { Kind: 'document', Id: alpha.Context } ] );
	ASSERT.equal( IDS.Is( alpha.ContextFolder, IDS.FOLDER ), true );
	ASSERT.equal( ( await store.ReadProposal( alpha.Context ) ).Proposal.Title, 'Readme' );
	ASSERT.equal( FS.existsSync( PATH.join( elsewhere, '.consensus', 'content', alpha.Context, 'content.md' ) ), true );
	ASSERT.equal( ( await store.ProjectOf( alpha.Context ) ).Id, alpha.Id );
	function names( projects ) { return projects.map( function ( p ) { return p.Name; } ); }
	ASSERT.deepEqual( names( await store.ListProjects() ), [ 'Default', 'Zebra', 'Alpha work' ] );
	ASSERT.deepEqual( ready.Settings.Projects.map( function ( entry ) { return entry.Path; } ), [ home.Path, zebra.Path, elsewhere ] );
	// the name lives in project.json
	ASSERT.equal( JSON.parse( FS.readFileSync( PATH.join( elsewhere, '.consensus', 'project.json' ), 'utf8' ) ).Name, 'Alpha work' );
	alpha.Items.push( { Kind: 'plan', Id: 'p1' } );
	alpha.Name = 'Alpha, renamed';
	let written = await store.WriteProject( alpha );
	ASSERT.equal( written.Version, 2 );
	ASSERT.deepEqual( ( await store.ReadProject( alpha.Id ) ).Items[ 1 ], { Kind: 'plan', Id: 'p1' } );
	ASSERT.equal( ( await store.ReadProject( alpha.Id ) ).Name, 'Alpha, renamed' );
	ASSERT.equal( ( await store.ProjectOf( 'p1' ) ).Id, alpha.Id );
	ASSERT.equal( await store.ProjectOf( 'p2' ), null );
	ASSERT.equal( await store.ReadProject( '../proposals' ), null );
	// a folder that holds a project already is opened, not made again
	await ASSERT.rejects( store.CreateProject( { Name: 'Again', Path: elsewhere } ), /already holds a project/ );
	ASSERT.equal( ( await store.OpenProject( elsewhere ) ).Id, alpha.Id );
	ASSERT.equal( await store.OpenProject( temporary_folder() ), null );
	// moved before Default, then to the end
	ASSERT.equal( await store.MoveProject( alpha.Id, home.Id ), true );
	ASSERT.deepEqual( names( await store.ListProjects() ), [ 'Alpha, renamed', 'Default', 'Zebra' ] );
	ASSERT.equal( await store.MoveProject( alpha.Id, null ), true );
	ASSERT.deepEqual( names( await store.ListProjects() ), [ 'Default', 'Zebra', 'Alpha, renamed' ] );
	ASSERT.equal( await store.MoveProject( alpha.Id, 'none' ), false );
	ASSERT.equal( await store.MoveProject( 'none', null ), false );
	ASSERT.equal( await store.DeleteProject( zebra.Id ), true );
	ASSERT.equal( await store.DeleteProject( zebra.Id ), false );
	ASSERT.equal( await store.ReadProject( zebra.Id ), null );
	ASSERT.equal( FS.existsSync( PATH.join( zebra.Path, '.consensus' ) ), false );
	ASSERT.deepEqual( names( await store.ListProjects() ), [ 'Default', 'Alpha, renamed' ] );
	ASSERT.deepEqual( ( await store.ReadSettings() ).Projects.map( function ( entry ) { return entry.Path; } ), [ home.Path, elsewhere ] );

	// another store over the same config lists them from the settings; a project opened elsewhere again lists once
	let again = STORE.Open( store.Folder );
	await again.Prepare( await again.ReadSettings() );
	ASSERT.deepEqual( names( await again.ListProjects() ), [ 'Default', 'Alpha, renamed' ] );
	ASSERT.equal( ( await again.OpenProject( elsewhere ) ).Id, alpha.Id );
	ASSERT.equal( ( await again.ListProjects() ).length, 2 );
} );


TEST( 'a copy lands in the project asked for; a move carries the item\'s folder into the other project', async function ()
{
	let ready = await prepared();
	let store = ready.Store;
	let other = await store.CreateProject( { Name: 'Other' } );
	let proposal = await store.CreateProposal( { Project: ready.Home.Id, Title: 'T', Text: 'text', By: 'user' } );
	await store.WriteThreads( proposal.Id, [ { Id: 't1' } ] );
	let copy = await store.CopyProposal( proposal.Id, other.Id );
	ASSERT.equal( copy.Title, 'T (copy)' );
	ASSERT.equal( ( await store.ProjectOf( copy.Id ) ).Id, other.Id );
	ASSERT.equal( FS.existsSync( PATH.join( home_of( store, other ), 'content', copy.Id, 'content.md' ) ), true );
	ASSERT.deepEqual( ( await store.ReadProposal( copy.Id ) ).Threads, [ { Id: 't1' } ] );
	let same = await store.CopyProposal( proposal.Id );
	ASSERT.equal( ( await store.ProjectOf( same.Id ) ).Id, ready.Home.Id );
	ASSERT.equal( await store.CopyProposal( 'nope' ), null );
	ASSERT.equal( await store.MoveProposal( proposal.Id, other.Id ), true );
	ASSERT.equal( ( await store.ProjectOf( proposal.Id ) ).Id, other.Id );
	ASSERT.equal( FS.existsSync( PATH.join( home_of( store, ready.Home ), 'content', proposal.Id ) ), false );
	ASSERT.equal( ( await store.ReadProposal( proposal.Id ) ).Text, 'text' );
	ASSERT.equal( await store.MoveProposal( proposal.Id, other.Id ), true );
	ASSERT.equal( await store.MoveProposal( 'nope', other.Id ), false );
	await ASSERT.rejects( store.MoveProposal( proposal.Id, 'prj-no-such' ), /no such project/ );
	ASSERT.equal( ( await store.ListProposals() ).length, 5 );
} );


TEST( 'a listed folder that is gone is skipped and kept in the list; one under projects/ that the list lacks joins it', async function ()
{
	let ready = await prepared();
	let store = ready.Store;
	let gone = PATH.join( temporary_folder(), 'gone' );
	ready.Settings.Projects.push( { Path: gone } );
	let empty = temporary_folder();
	ready.Settings.Projects.push( { Path: empty } );
	await store.WriteSettings( ready.Settings );
	// a folder made by hand under projects/
	let by_hand = await store.CreateProject( { Name: 'By hand' } );
	let settings = await store.ReadSettings();
	settings.Projects = settings.Projects.filter( function ( entry ) { return entry.Path !== by_hand.Path; } );
	await store.WriteSettings( settings );
	let again = STORE.Open( store.Folder );
	let lines = await again.Prepare( settings );
	ASSERT.equal( lines.length, 3, lines.join( '\n' ) );
	ASSERT.equal( lines[ 0 ], 'project folder skipped: ' + gone + ' (the folder is not there)' );
	ASSERT.equal( lines[ 1 ], 'project folder skipped: ' + empty + ' (no .consensus/project.json in it)' );
	ASSERT.equal( lines[ 2 ], 'project folder found and listed: ' + by_hand.Path );
	ASSERT.deepEqual( again.Missing(), [ { Path: gone, Error: 'the folder is not there' }, { Path: empty, Error: 'no .consensus/project.json in it' } ] );
	ASSERT.deepEqual( ( await again.ListProjects() ).map( function ( p ) { return p.Name; } ), [ 'Default', 'By hand' ] );
	ASSERT.deepEqual( settings.Projects.map( function ( entry ) { return entry.Path; } ), [ ready.Home.Path, gone, empty, by_hand.Path ] );
	ASSERT.deepEqual( ( await again.ReadSettings() ).Projects, settings.Projects );
} );


TEST( 'proposals list newest updated first', async function ()
{
	let ready = await prepared();
	let store = ready.Store;
	let first = await store.CreateProposal( { Project: ready.Home.Id, Title: 'First', Text: '', By: 'user' } );
	await new Promise( function ( resolve ) { setTimeout( resolve, 5 ); } );
	let second = await store.CreateProposal( { Project: ready.Home.Id, Title: 'Second', Text: '', By: 'user' } );
	ASSERT.deepEqual( ( await store.ListProposals() ).slice( 0, 2 ).map( function ( p ) { return p.Id; } ), [ second.Id, first.Id ] );
	await new Promise( function ( resolve ) { setTimeout( resolve, 5 ); } );
	await store.UpdateProposal( first.Id, { Title: 'First again' } );
	ASSERT.deepEqual( ( await store.ListProposals() ).slice( 0, 2 ).map( function ( p ) { return p.Id; } ), [ first.Id, second.Id ] );
} );


//---------------------------------------------------------------------
// The migration

// An old-layout proposal in the config folder.
function write_old_proposal( folder, id, record, text, extra_files )
{
	FS.mkdirSync( PATH.join( folder, 'proposals', id, 'revisions' ), { recursive: true } );
	FS.writeFileSync( PATH.join( folder, 'proposals', id, 'proposal.json' ), JSON.stringify( record ) );
	FS.writeFileSync( PATH.join( folder, 'proposals', id, 'proposal.md' ), text );
	FS.writeFileSync( PATH.join( folder, 'proposals', id, 'threads.json' ), '[]' );
	FS.writeFileSync( PATH.join( folder, 'proposals', id, 'revisions', '0001.md' ), text );
	FS.writeFileSync( PATH.join( folder, 'proposals', id, 'revisions', '0001.json' ), JSON.stringify( { Id: 'rev-000-000-' + id.slice( -3 ), Parent: null, Revision: 1, By: 'user', At: 't', Reason: 'create' } ) );
	for ( let name of extra_files || [] )
	{
		FS.writeFileSync( PATH.join( folder, 'proposals', id, name ), '[]' );
	}
}


TEST( 'migration: a config folder from before Step 2 moves each project into a folder of its own, under a prj- id, with its items; strays and the old trash go to the first project\'s trash', async function ()
{
	let folder = temporary_folder();
	write_old_proposal( folder, 'ctx-aaa-aaa-aaa', { Id: 'ctx-aaa-aaa-aaa', Title: 'Readme', Kind: 'document', State: null, Created: 't', Updated: 't', Revision: 1 }, '# Readme\n' );
	write_old_proposal( folder, 'pln-bbb-bbb-bbb', { Id: 'pln-bbb-bbb-bbb', Title: 'Plan', Kind: 'plan', State: 'Draft', Created: 't', Updated: 't', Revision: 1 }, '# Plan\n' );
	write_old_proposal( folder, 'doc-ccc-ccc-ccc', { Id: 'doc-ccc-ccc-ccc', Title: 'Readme', Kind: 'document', State: null, Created: 't', Updated: 't', Revision: 1 }, '# Other readme\n' );
	write_old_proposal( folder, 'pln-ddd-ddd-ddd', { Id: 'pln-ddd-ddd-ddd', Title: 'Elsewhere', Kind: 'plan', State: 'Plan', Created: 't', Updated: 't', Revision: 1 }, '# Elsewhere\n' );
	write_old_proposal( folder, 'pln-eee-eee-eee', { Id: 'pln-eee-eee-eee', Title: 'Stray', Kind: 'plan', State: 'Draft', Created: 't', Updated: 't', Revision: 1 }, '# Stray\n' );
	FS.mkdirSync( PATH.join( folder, 'projects', 'default' ), { recursive: true } );
	FS.writeFileSync( PATH.join( folder, 'projects', 'default', 'project.json' ), JSON.stringify( { Id: 'default', Context: 'ctx-aaa-aaa-aaa', ContextFolder: 'fld-ctx-ctx-ctx', Created: 't', Updated: 't', Version: 3, Items: [ { Kind: 'folder', Id: 'fld-ctx-ctx-ctx', Name: 'Context', Items: [ { Kind: 'document', Id: 'ctx-aaa-aaa-aaa' } ] }, { Kind: 'folder', Id: 'fld-ddd-ddd-ddd', Name: 'Drafts', Items: [ { Kind: 'plan', Id: 'pln-bbb-bbb-bbb' } ] } ] } ) );
	FS.mkdirSync( PATH.join( folder, 'projects', 'prj-ooo-ooo-ooo' ), { recursive: true } );
	FS.writeFileSync( PATH.join( folder, 'projects', 'prj-ooo-ooo-ooo', 'project.json' ), JSON.stringify( { Id: 'prj-ooo-ooo-ooo', Context: 'doc-ccc-ccc-ccc', ContextFolder: 'fld-oct-oct-oct', Created: 't', Updated: 't', Version: 1, Items: [ { Kind: 'folder', Id: 'fld-oct-oct-oct', Name: 'Context', Items: [ { Kind: 'document', Id: 'doc-ccc-ccc-ccc' } ] }, { Kind: 'plan', Id: 'pln-ddd-ddd-ddd' } ] } ) );
	FS.writeFileSync( PATH.join( folder, 'projects.json' ), JSON.stringify( { Projects: [ { Id: 'prj-ooo-ooo-ooo', Name: 'Other' }, { Id: 'default', Name: 'Default' } ] } ) );
	FS.mkdirSync( PATH.join( folder, 'trash', 'pln-fff-fff-fff' ), { recursive: true } );
	FS.writeFileSync( PATH.join( folder, 'trash', 'pln-fff-fff-fff', 'proposal.json' ), JSON.stringify( { Id: 'pln-fff-fff-fff', Title: 'Trashed', Kind: 'plan', State: 'Draft', Created: 't', Updated: 't', Revision: 1 } ) );
	FS.writeFileSync( PATH.join( folder, 'trash', 'pln-fff-fff-fff', 'proposal.md' ), '# Trashed\n' );
	FS.writeFileSync( PATH.join( folder, 'usage.json' ), '{}' );

	let settings = { Name: 'test', Port: 0, Scope: 'Local', States: [ 'Draft', 'Plan' ], Participants: [ { Name: 'user', Role: 'owner' } ], Workspaces: [ { Id: 'wks-1', Name: 'w', Project: 'default', Path: '/w' } ] };
	let store = STORE.Open( folder );
	let lines = await store.Prepare( settings );
	ASSERT.equal( lines.length, 3, lines.join( '\n' ) );
	ASSERT.equal( lines[ 0 ], 'project Other moved to ' + PATH.join( folder, 'projects', 'Other' ) + ' (2 items)' );
	ASSERT.match( lines[ 1 ], /^project Default moved to .*Default \(2 items, its id now prj-[0-9a-z]{3}-[0-9a-z]{3}-[0-9a-z]{3}\)$/ );
	ASSERT.equal( lines[ 2 ], '1 items in no project went to the trash' );

	let projects = await store.ListProjects();
	ASSERT.deepEqual( projects.map( function ( p ) { return p.Name; } ), [ 'Other', 'Default' ] );
	let other = projects[ 0 ];
	let home = projects[ 1 ];
	ASSERT.equal( other.Id, 'prj-ooo-ooo-ooo' );
	ASSERT.match( home.Id, /^prj-/ );
	ASSERT.equal( settings.Workspaces[ 0 ].Project, home.Id );
	ASSERT.deepEqual( settings.Projects.map( function ( entry ) { return entry.Path; } ), [ other.Path, home.Path ] );
	ASSERT.deepEqual( ( await store.ReadSettings() ).Projects, settings.Projects );
	ASSERT.deepEqual( home.States, [ 'Draft', 'Plan' ] );
	ASSERT.equal( home.Version, 3 );
	ASSERT.deepEqual( home.Items[ 1 ], { Kind: 'folder', Id: 'fld-ddd-ddd-ddd', Name: 'Drafts', Items: [ { Kind: 'plan', Id: 'pln-bbb-bbb-bbb' } ] } );
	for ( let name of [ 'content.json', 'content.md', 'threads.json', 'revisions/0001.md' ] )
	{
		ASSERT.equal( FS.existsSync( PATH.join( home.Path, '.consensus', 'content', 'pln-bbb-bbb-bbb', name ) ), true, name );
	}
	ASSERT.equal( FS.existsSync( PATH.join( home.Path, '.consensus', 'content', 'pln-bbb-bbb-bbb', 'proposal.json' ) ), false );
	ASSERT.equal( ( await store.ReadProposal( 'pln-bbb-bbb-bbb' ) ).Text, '# Plan\n' );
	ASSERT.equal( ( await store.ReadProposal( 'ctx-aaa-aaa-aaa' ) ).Proposal.Title, 'Readme' );
	ASSERT.equal( ( await store.ProjectOf( 'pln-ddd-ddd-ddd' ) ).Id, other.Id );
	ASSERT.equal( ( await store.ReadProposal( 'doc-ccc-ccc-ccc' ) ).Text, '# Other readme\n' );
	// strays and the old trash, in the first project's trash, in the new layout
	let trash = await store.ListTrash();
	ASSERT.deepEqual( trash.map( function ( item ) { return item.Id + '@' + item.Project; } ).sort(), [ 'pln-eee-eee-eee@' + other.Id, 'pln-fff-fff-fff@' + other.Id ] );
	ASSERT.equal( FS.existsSync( PATH.join( other.Path, '.consensus', 'trash', 'pln-fff-fff-fff', 'content.md' ) ), true );
	// the old layout is gone
	// (projects/default and projects/Default are one folder on Windows: the old project.json is what must be gone)
	for ( let name of [ 'projects.json', 'proposals', 'trash', 'usage.json', 'projects/default/project.json', 'projects/prj-ooo-ooo-ooo', '.migrating' ] )
	{
		ASSERT.equal( FS.existsSync( PATH.join( folder, name ) ), false, name );
	}
	// a second start does nothing more
	ASSERT.deepEqual( await STORE.Open( folder ).Prepare( await store.ReadSettings() ), [] );
} );


TEST( 'migration: a data folder from before Consensus Desktop gets its Context folder, loses its corpora and the LLM\'s files, on the way into its folder', async function ()
{
	let folder = temporary_folder();
	write_old_proposal( folder, 'ctx-aaa-aaa-aaa', { Id: 'ctx-aaa-aaa-aaa', Title: 'Context', Kind: 'context', State: null, Created: 't', Updated: 't', Revision: 1 }, '# Context\n', [ 'index.json' ] );
	write_old_proposal( folder, 'pln-bbb-bbb-bbb', { Id: 'pln-bbb-bbb-bbb', Title: 'Plan', Kind: 'plan', State: 'Proposal', Created: 't', Updated: 't', Revision: 1 }, '# Plan\n', [ 'runs.json' ] );
	FS.mkdirSync( PATH.join( folder, 'projects', 'default', 'corpora', 'cor-ccc-ccc-ccc' ), { recursive: true } );
	FS.writeFileSync( PATH.join( folder, 'projects', 'default', 'corpora', 'cor-ccc-ccc-ccc', 'corpus.json' ), JSON.stringify( { Id: 'cor-ccc-ccc-ccc', Kind: 'corpus', Name: 'repo', Updated: 't', Files: [] } ) );
	FS.writeFileSync( PATH.join( folder, 'projects', 'default', 'project.json' ), JSON.stringify( {
		Id: 'default', Context: 'ctx-aaa-aaa-aaa', Created: 't', Updated: 't', Version: 3, Workspace: { Worker: 'w', Name: 'x' },
		Items: [ { Kind: 'folder', Id: 'fld-ddd-ddd-ddd', Name: 'Drafts', Items: [ { Kind: 'plan', Id: 'pln-bbb-bbb-bbb' }, { Kind: 'corpus', Id: 'cor-ccc-ccc-ccc' } ] } ],
	} ) );
	FS.writeFileSync( PATH.join( folder, 'usage.json' ), '{}' );

	let store = STORE.Open( folder );
	let lines = await store.Prepare( { States: [ 'Draft', 'Plan', 'Working', 'Finished' ] } );
	ASSERT.equal( lines.length, 1, lines.join( '\n' ) );
	let project = ( await store.ListProjects() )[ 0 ];
	ASSERT.equal( project.Name, 'Default' );
	ASSERT.equal( project.Context, 'ctx-aaa-aaa-aaa' );
	ASSERT.equal( project.Items[ 0 ].Id, project.ContextFolder );
	ASSERT.deepEqual( project.Items[ 0 ].Items, [ { Kind: 'document', Id: 'ctx-aaa-aaa-aaa' } ] );
	ASSERT.deepEqual( project.Items[ 1 ], { Kind: 'folder', Id: 'fld-ddd-ddd-ddd', Name: 'Drafts', Items: [ { Kind: 'plan', Id: 'pln-bbb-bbb-bbb' } ] } );
	ASSERT.equal( 'Workspace' in project, false );
	ASSERT.equal( ( await store.ReadProposal( 'ctx-aaa-aaa-aaa' ) ).Proposal.Kind, 'document' );
	ASSERT.equal( ( await store.ReadProposal( 'ctx-aaa-aaa-aaa' ) ).Proposal.Title, 'Readme' );
	let home = PATH.join( project.Path, '.consensus' );
	ASSERT.equal( FS.existsSync( PATH.join( home, 'trash', 'cor-ccc-ccc-ccc', 'corpus.json' ) ), true );
	ASSERT.equal( FS.existsSync( PATH.join( home, 'content', 'ctx-aaa-aaa-aaa', 'index.json' ) ), false );
	ASSERT.equal( FS.existsSync( PATH.join( home, 'content', 'pln-bbb-bbb-bbb', 'runs.json' ) ), false );
	ASSERT.equal( FS.existsSync( PATH.join( folder, 'usage.json' ) ), false );
	ASSERT.equal( ( await store.ListTrash() ).map( function ( item ) { return item.Kind; } ).join( ',' ), 'corpus' );
} );
