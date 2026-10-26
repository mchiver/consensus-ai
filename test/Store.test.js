'use strict';

// The store over the config folder and the project folders (plan Run Shapes, Step 2), on temporary folders: create,
// write, revisions, queueing, atomic writes, the trash and the archive per project, projects as folders in the
// settings' order, items copied and moved between projects, and missing folders.

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
	let settings = { Name: 'test', Port: 0, Scope: 'Local', States: [ 'Draft', 'Plan', 'Working', 'Finished' ], Owner: { Name: 'user', Display: 'User' } };
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


TEST( 'a created plan has its files in its project\'s content folder, revision 1 and a plain id', async function ()
{
	let ready = await prepared();
	let store = ready.Store;
	let plan = await store.CreatePlan( { Project: ready.Home.Id, Title: 'Hello, World!', Text: '# Hello\n\nText.\n', By: 'user', State: 'Draft' } );
	ASSERT.match( plan.Id, /^pln-[0-9a-z]{3}-[0-9a-z]{3}-[0-9a-z]{3}$/ );
	ASSERT.equal( IDS.Is( plan.Id, IDS.PLAN ), true );
	ASSERT.equal( plan.Revision, 1 );
	ASSERT.equal( plan.State, 'Draft' );
	ASSERT.equal( plan.Kind, 'plan' );
	let folder = PATH.join( home_of( store, ready.Home ), 'content', plan.Id );
	for ( let name of [ 'content.json', 'content.md', 'threads.json', 'revisions/0001.md', 'revisions/0001.json' ] )
	{
		ASSERT.equal( FS.existsSync( PATH.join( folder, name ) ), true, name );
	}
	let read = await store.ReadPlan( plan.Id );
	ASSERT.deepEqual( read.Plan, plan );
	ASSERT.equal( read.Text, '# Hello\n\nText.\n' );
	ASSERT.deepEqual( read.Threads, [] );
	let revisions = await store.ListRevisions( plan.Id );
	ASSERT.equal( revisions.length, 1 );
	ASSERT.equal( revisions[ 0 ].Reason, 'create' );
	ASSERT.equal( revisions[ 0 ].By, 'user' );
	// the Readme is there too
	ASSERT.equal( ( await store.ListPlans() ).length, 2 );
	ASSERT.equal( await store.ReadPlan( 'nope' ), null );
	ASSERT.equal( ( await store.ProjectOf( plan.Id ) ).Id, ready.Home.Id );
	await ASSERT.rejects( store.CreatePlan( { Project: 'prj-no-such', Title: 'x', Text: '', By: 'user' } ), /no such project/ );
} );


TEST( 'writing text makes a new revision with its snapshot and reason', async function ()
{
	let ready = await prepared();
	let store = ready.Store;
	let plan = await store.CreatePlan( { Project: ready.Home.Id, Title: 'T', Text: 'one', By: 'user' } );
	let updated = await store.WriteText( plan.Id, { Text: 'two', By: 'llm', Reason: 'apply', Thread: 't1' } );
	ASSERT.equal( updated.Revision, 2 );
	let read = await store.ReadPlan( plan.Id );
	ASSERT.equal( read.Text, 'two' );
	let revision = await store.ReadRevision( plan.Id, 2 );
	ASSERT.equal( revision.Text, 'two' );
	ASSERT.equal( revision.Reason, 'apply' );
	ASSERT.equal( revision.Thread, 't1' );
	ASSERT.equal( ( await store.ReadRevision( plan.Id, 1 ) ).Text, 'one' );
	ASSERT.equal( await store.ReadRevision( plan.Id, 3 ), null );
	ASSERT.equal( ( await store.ListRevisions( plan.Id ) ).length, 2 );
	ASSERT.equal( await store.WriteText( 'nope', { Text: 'x', By: 'user', Reason: 'edit' } ), null );
} );


TEST( 'plan changes and threads are written whole', async function ()
{
	let ready = await prepared();
	let store = ready.Store;
	let plan = await store.CreatePlan( { Project: ready.Home.Id, Title: 'T', Text: '', By: 'user' } );
	let updated = await store.UpdatePlan( plan.Id, { Title: 'New', State: 'Working' } );
	ASSERT.equal( updated.Title, 'New' );
	ASSERT.equal( updated.State, 'Working' );
	await store.WriteThreads( plan.Id, [ { Id: 't1' } ] );
	ASSERT.deepEqual( ( await store.ReadPlan( plan.Id ) ).Threads, [ { Id: 't1' } ] );
} );


TEST( 'writes are atomic: no .tmp files remain and the file is whole', async function ()
{
	let ready = await prepared();
	let store = ready.Store;
	let plan = await store.CreatePlan( { Project: ready.Home.Id, Title: 'T', Text: 'x'.repeat( 100000 ), By: 'user' } );
	let folder = PATH.join( home_of( store, ready.Home ), 'content', plan.Id );
	let files = FS.readdirSync( folder ).concat( FS.readdirSync( PATH.join( folder, 'revisions' ) ) );
	ASSERT.equal( files.some( function ( name ) { return name.endsWith( '.tmp' ); } ), false );
	ASSERT.equal( FS.readFileSync( PATH.join( folder, 'content.md' ), 'utf8' ).length, 100000 );
} );


TEST( 'the queue runs one plan\'s work in order and other plans\' work independently', async function ()
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


TEST( 'queued writes to one plan do not interleave', async function ()
{
	let ready = await prepared();
	let store = ready.Store;
	let plan = await store.CreatePlan( { Project: ready.Home.Id, Title: 'T', Text: '0', By: 'user' } );
	let writes = [];
	for ( let index = 1; index <= 5; index++ )
	{
		writes.push( store.Queue( plan.Id, async function ()
		{
			let read = await store.ReadPlan( plan.Id );
			await store.WriteText( plan.Id, { Text: String( parseInt( read.Text, 10 ) + 1 ), By: 'user', Reason: 'edit' } );
		} ) );
	}
	await Promise.all( writes );
	let read = await store.ReadPlan( plan.Id );
	ASSERT.equal( read.Text, '5' );
	ASSERT.equal( read.Plan.Revision, 6 );
} );


TEST( 'a trashed plan moves whole into its project\'s trash and leaves the list', async function ()
{
	let ready = await prepared();
	let store = ready.Store;
	let plan = await store.CreatePlan( { Project: ready.Home.Id, Title: 'Gone', Text: 'x', By: 'user' } );
	ASSERT.equal( await store.TrashPlan( plan.Id ), true );
	ASSERT.equal( await store.TrashPlan( plan.Id ), false );
	ASSERT.equal( ( await store.ListPlans() ).length, 1 );
	ASSERT.equal( await store.ReadPlan( plan.Id ), null );
	let trash = await store.ListTrash();
	ASSERT.equal( trash.length, 1 );
	ASSERT.equal( trash[ 0 ].Id, plan.Id );
	ASSERT.equal( trash[ 0 ].Project, ready.Home.Id );
	ASSERT.equal( FS.existsSync( PATH.join( home_of( store, ready.Home ), 'trash', plan.Id, 'revisions', '0001.md' ) ), true );
} );


TEST( 'an archived plan moves to its project\'s archive, reads as archived, refuses writes, and comes back', async function ()
{
	let ready = await prepared();
	let store = ready.Store;
	let plan = await store.CreatePlan( { Project: ready.Home.Id, Title: 'Done', Text: 'x', By: 'user', State: 'Finished' } );
	ASSERT.equal( await store.ArchivePlan( plan.Id ), true );
	ASSERT.equal( await store.ArchivePlan( plan.Id ), false );
	ASSERT.equal( FS.existsSync( PATH.join( home_of( store, ready.Home ), 'archive', plan.Id, 'content.md' ) ), true );
	ASSERT.equal( FS.existsSync( PATH.join( home_of( store, ready.Home ), 'content', plan.Id ) ), false );
	let read = await store.ReadPlan( plan.Id );
	ASSERT.equal( read.Plan.Archived, true );
	ASSERT.equal( read.Text, 'x' );
	ASSERT.equal( ( await store.ListRevisions( plan.Id ) ).length, 1 );
	// not listed among the live ones; still its project's
	ASSERT.equal( ( await store.ListPlans() ).some( function ( one ) { return one.Id === plan.Id; } ), false );
	ASSERT.equal( ( await store.ProjectOf( plan.Id ) ).Id, ready.Home.Id );
	await ASSERT.rejects( store.WriteText( plan.Id, { Text: 'y', By: 'user', Reason: 'edit' } ), /is archived/ );
	await ASSERT.rejects( store.WriteThreads( plan.Id, [] ), /is archived/ );
	await ASSERT.rejects( store.UpdatePlan( plan.Id, { Title: 'z' } ), /is archived/ );
	ASSERT.equal( await store.MovePlan( plan.Id, ready.Home.Id ), false );
	ASSERT.equal( await store.RestorePlan( plan.Id ), true );
	ASSERT.equal( await store.RestorePlan( plan.Id ), false );
	ASSERT.equal( 'Archived' in ( await store.ReadPlan( plan.Id ) ).Plan, false );
	ASSERT.equal( ( await store.UpdatePlan( plan.Id, { Title: 'z' } ) ).Title, 'z' );
	// a store opened again over the same config knows the archived one
	await store.ArchivePlan( plan.Id );
	let again = STORE.Open( store.Folder );
	await again.Prepare( await again.ReadSettings() );
	ASSERT.equal( ( await again.ReadPlan( plan.Id ) ).Plan.Archived, true );
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
	ASSERT.equal( ( await store.ReadPlan( alpha.Context ) ).Plan.Title, 'Readme' );
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
	ASSERT.equal( await store.ReadProject( '../plans' ), null );
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
	let plan = await store.CreatePlan( { Project: ready.Home.Id, Title: 'T', Text: 'text', By: 'user' } );
	await store.WriteThreads( plan.Id, [ { Id: 't1' } ] );
	let copy = await store.CopyPlan( plan.Id, other.Id );
	ASSERT.equal( copy.Title, 'T (copy)' );
	ASSERT.equal( ( await store.ProjectOf( copy.Id ) ).Id, other.Id );
	ASSERT.equal( FS.existsSync( PATH.join( home_of( store, other ), 'content', copy.Id, 'content.md' ) ), true );
	ASSERT.deepEqual( ( await store.ReadPlan( copy.Id ) ).Threads, [ { Id: 't1' } ] );
	let same = await store.CopyPlan( plan.Id );
	ASSERT.equal( ( await store.ProjectOf( same.Id ) ).Id, ready.Home.Id );
	ASSERT.equal( await store.CopyPlan( 'nope' ), null );
	ASSERT.equal( await store.MovePlan( plan.Id, other.Id ), true );
	ASSERT.equal( ( await store.ProjectOf( plan.Id ) ).Id, other.Id );
	ASSERT.equal( FS.existsSync( PATH.join( home_of( store, ready.Home ), 'content', plan.Id ) ), false );
	ASSERT.equal( ( await store.ReadPlan( plan.Id ) ).Text, 'text' );
	ASSERT.equal( await store.MovePlan( plan.Id, other.Id ), true );
	ASSERT.equal( await store.MovePlan( 'nope', other.Id ), false );
	await ASSERT.rejects( store.MovePlan( plan.Id, 'prj-no-such' ), /no such project/ );
	ASSERT.equal( ( await store.ListPlans() ).length, 5 );
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


TEST( 'plans list newest updated first', async function ()
{
	let ready = await prepared();
	let store = ready.Store;
	let first = await store.CreatePlan( { Project: ready.Home.Id, Title: 'First', Text: '', By: 'user' } );
	await new Promise( function ( resolve ) { setTimeout( resolve, 5 ); } );
	let second = await store.CreatePlan( { Project: ready.Home.Id, Title: 'Second', Text: '', By: 'user' } );
	ASSERT.deepEqual( ( await store.ListPlans() ).slice( 0, 2 ).map( function ( p ) { return p.Id; } ), [ second.Id, first.Id ] );
	await new Promise( function ( resolve ) { setTimeout( resolve, 5 ); } );
	await store.UpdatePlan( first.Id, { Title: 'First again' } );
	ASSERT.deepEqual( ( await store.ListPlans() ).slice( 0, 2 ).map( function ( p ) { return p.Id; } ), [ first.Id, second.Id ] );
} );


TEST( 'the registry entry keeps Mounted (plan Rearchitecturation, Step 1): through a start, a folder on the command line, a move and SetMounted; the projects carry it', async function ()
{
	let ready = await prepared();
	let store = ready.Store;
	ASSERT.equal( ready.Home.Mounted, false );
	let zebra = await store.CreateProject( { Name: 'Zebra' } );
	ASSERT.equal( zebra.Mounted, false );
	let mounted = await store.SetMounted( zebra.Id, true );
	ASSERT.equal( mounted.Mounted, true );
	ASSERT.equal( ( await store.ReadProject( zebra.Id ) ).Mounted, true );
	ASSERT.equal( await store.SetMounted( 'prj-nope', true ), null );
	ASSERT.deepEqual( ( await store.ReadSettings() ).Projects, [ { Path: ready.Home.Path }, { Path: zebra.Path, Mounted: true } ] );
	// a start again keeps it; the folder on the command line goes first with its switch
	let again = STORE.Open( store.Folder );
	let settings = await again.ReadSettings();
	await again.Prepare( settings, { Project: zebra.Path } );
	ASSERT.deepEqual( settings.Projects, [ { Path: zebra.Path, Mounted: true }, { Path: ready.Home.Path } ] );
	ASSERT.equal( ( await again.ListProjects() )[ 0 ].Mounted, true );
	// a move keeps the entry whole; the switch goes back off
	let plain = STORE.Open( store.Folder );
	let plain_settings = await plain.ReadSettings();
	await plain.Prepare( plain_settings );
	await plain.MoveProject( zebra.Id, null );
	ASSERT.deepEqual( ( await plain.ReadSettings() ).Projects, [ { Path: ready.Home.Path }, { Path: zebra.Path, Mounted: true } ] );
	ASSERT.equal( ( await plain.SetMounted( zebra.Id, false ) ).Mounted, false );
	ASSERT.deepEqual( ( await plain.ReadSettings() ).Projects, [ { Path: ready.Home.Path }, { Path: zebra.Path, Mounted: false } ] );
} );


TEST( 'a read-only store (the Desktop reading the Host config) reads the settings and the projects and writes nothing; a folder with no settings gives empty lists', async function ()
{
	let ready = await prepared();
	let zebra = await ready.Store.CreateProject( { Name: 'Zebra' } );
	await ready.Store.SetMounted( zebra.Id, true );
	let before = FS.readFileSync( ready.Store.SettingsPath(), 'utf8' );
	let reader = STORE.Open( ready.Store.Folder, { ReadOnly: true } );
	ASSERT.equal( reader.ReadOnly, true );
	ASSERT.equal( ready.Store.ReadOnly, false );
	let settings = await reader.ReadSettings();
	ASSERT.deepEqual( await reader.Prepare( settings ), [] );
	ASSERT.deepEqual( ( await reader.ListProjects() ).map( function ( project ) { return [ project.Name, project.Mounted ]; } ), [ [ 'Default', false ], [ 'Zebra', true ] ] );
	await ASSERT.rejects( reader.WriteSettings( settings ), /the settings are read-only: consensus.json is written by the Server alone/ );
	// the registry writes are skipped: the list in memory changes, the file does not
	ASSERT.equal( await reader.MoveProject( zebra.Id, ready.Home.Id ), true );
	ASSERT.equal( ( await reader.SetMounted( zebra.Id, false ) ).Mounted, false );
	ASSERT.equal( FS.readFileSync( ready.Store.SettingsPath(), 'utf8' ), before );
	// a folder that is not there: no folder made, no settings, no Default project
	let nowhere = PATH.join( temporary_folder(), 'nowhere' );
	let empty = STORE.Open( nowhere, { ReadOnly: true } );
	ASSERT.equal( await empty.ReadSettings(), null );
	ASSERT.deepEqual( await empty.Prepare( {} ), [] );
	ASSERT.deepEqual( await empty.ListProjects(), [] );
	ASSERT.equal( FS.existsSync( nowhere ), false );
} );


TEST( 'Roles, Llm and Tasks live on the registry entry, not in project.json (plan Project settings, Step 1): moved once at registration, joined on read, written back to the entry; read-only leaves the file alone', async function ()
{
	let ready = await prepared();
	let store = ready.Store;
	let zebra = await store.CreateProject( { Name: 'Zebra' } );
	let file = PATH.join( zebra.Path, '.consensus', 'project.json' );
	let written = JSON.parse( FS.readFileSync( file, 'utf8' ) );
	ASSERT.deepEqual( [ written.Roles, written.Llm, written.Tasks, written.Mounted ], [ undefined, undefined, undefined, undefined ] );
	ASSERT.deepEqual( zebra.Roles, { Owners: [], Members: [], Service: [], Watchers: [] } );
	// a change to the Server's fields goes to the entry; the file never holds them
	let project = await store.ReadProject( zebra.Id );
	project.Roles = { Owners: [ 'acc-one' ], Members: [], Service: [], Watchers: [] };
	project.Llm = 'llm-abc';
	project.Tasks = [ 'answer' ];
	await store.WriteProject( project );
	written = JSON.parse( FS.readFileSync( file, 'utf8' ) );
	ASSERT.deepEqual( [ written.Roles, written.Llm, written.Tasks, written.Mounted ], [ undefined, undefined, undefined, undefined ] );
	let entry = ( await store.ReadSettings() ).Projects.find( function ( item ) { return item.Path === zebra.Path; } );
	ASSERT.deepEqual( entry, { Path: zebra.Path, Llm: 'llm-abc', Tasks: [ 'answer' ], Roles: { Owners: [ 'acc-one' ], Members: [], Service: [], Watchers: [] } } );
	let read = await store.ReadProject( zebra.Id );
	ASSERT.deepEqual( [ read.Roles.Owners, read.Llm, read.Tasks ], [ [ 'acc-one' ], 'llm-abc', [ 'answer' ] ] );
	// cleared: off the entry
	delete read.Llm;
	delete read.Tasks;
	read.Roles = { Owners: [], Members: [], Service: [], Watchers: [] };
	await store.WriteProject( read );
	entry = ( await store.ReadSettings() ).Projects.find( function ( item ) { return item.Path === zebra.Path; } );
	ASSERT.deepEqual( entry, { Path: zebra.Path } );

	// an old project.json: the read-only store (the Desktop's sidecar) shows none of its fields and writes them back as they were
	let old = JSON.parse( FS.readFileSync( file, 'utf8' ) );
	old.Roles = { Owners: [ 'acc-two' ], Members: [ 'acc-three' ], Service: [], Watchers: [] };
	old.Llm = 'llm-old';
	old.Tasks = [ 'work' ];
	old.Mounted = true;
	FS.writeFileSync( file, JSON.stringify( old, null, '\t' ) );
	let before = FS.readFileSync( ready.Store.SettingsPath(), 'utf8' );
	let reader = STORE.Open( store.Folder, { ReadOnly: true } );
	await reader.Prepare( await reader.ReadSettings(), { Project: zebra.Path } );
	let seen = await reader.ReadProject( zebra.Id );
	ASSERT.deepEqual( [ seen.Roles, seen.Llm, seen.Tasks, seen.Mounted ], [ { Owners: [], Members: [], Service: [], Watchers: [] }, undefined, undefined, false ] );
	seen.Name = 'Zebra renamed';
	await reader.WriteProject( seen );
	written = JSON.parse( FS.readFileSync( file, 'utf8' ) );
	ASSERT.equal( written.Name, 'Zebra renamed' );
	ASSERT.deepEqual( [ written.Roles, written.Llm, written.Tasks, written.Mounted ], [ old.Roles, 'llm-old', [ 'work' ], undefined ] );
	ASSERT.equal( FS.readFileSync( ready.Store.SettingsPath(), 'utf8' ), before );

	// a writable start moves them to the entry, once; the roles, the connection and the tasks read the same
	let server = STORE.Open( store.Folder );
	let settings = await server.ReadSettings();
	let lines = await server.Prepare( settings );
	ASSERT.deepEqual( lines, [ 'project Zebra renamed: Roles, Llm, Tasks moved out of project.json' ] );
	written = JSON.parse( FS.readFileSync( file, 'utf8' ) );
	ASSERT.deepEqual( [ written.Roles, written.Llm, written.Tasks, written.Mounted ], [ undefined, undefined, undefined, undefined ] );
	entry = ( await server.ReadSettings() ).Projects.find( function ( item ) { return item.Path === zebra.Path; } );
	ASSERT.deepEqual( entry, { Path: zebra.Path, Roles: old.Roles, Llm: 'llm-old', Tasks: [ 'work' ] } );
	let moved = await server.ReadProject( zebra.Id );
	ASSERT.deepEqual( [ moved.Roles, moved.Llm, moved.Tasks ], [ old.Roles, 'llm-old', [ 'work' ] ] );
	let later = STORE.Open( store.Folder );
	ASSERT.deepEqual( await later.Prepare( await later.ReadSettings() ), [] );

	// an entry that has its own keeps them; the file's are dropped
	let stale = JSON.parse( FS.readFileSync( file, 'utf8' ) );
	stale.Llm = 'llm-stale';
	FS.writeFileSync( file, JSON.stringify( stale, null, '\t' ) );
	let third = STORE.Open( store.Folder );
	ASSERT.deepEqual( await third.Prepare( await third.ReadSettings() ), [ 'project Zebra renamed: Llm moved out of project.json' ] );
	ASSERT.equal( ( await third.ReadProject( zebra.Id ) ).Llm, 'llm-old' );
} );
