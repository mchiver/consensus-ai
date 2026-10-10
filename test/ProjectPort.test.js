'use strict';

// Project export and import (ProjectPort.js): a project on one server goes out as one json object and comes into
// others. Merge is tried on its own; the rest through the API, over temporary folders. An export from before plan
// Consensus Desktop (corpora, workers, a context proposal of Kind context) is read too. Nothing here reads ~data.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const FS = require( 'fs' );
const OS = require( 'os' );
const PATH = require( 'path' );
const SERVER = require( '../src/Server.js' );
const PARTICIPANTS = require( '../src/Participants.js' );
const PORT = require( '../src/ProjectPort.js' );
const IDS = require( '../src/Ids.js' );

let folders = [];
let origin = null;
let copy = null;
let bare = null;
let exported = null;
let alpha = null;
let ids = {};


function temporary_folder( prefix )
{
	let folder = FS.mkdtempSync( PATH.join( OS.tmpdir(), prefix ) );
	folders.push( folder );
	return folder;
}


// A Consensus server over a new folder.
async function start()
{
	let data = temporary_folder( 'consensus-port-data-' );
	let settings = PARTICIPANTS.DefaultSettings( 0 );
	FS.writeFileSync( PATH.join( data, 'consensus.json' ), JSON.stringify( settings, null, '\t' ) );
	return await SERVER.Start( { Data: data, Port: 0 } );
}


async function call( server, method, path, body, authorization )
{
	let headers = ( body === undefined ) ? {} : { 'Content-Type': 'application/json' };
	if ( authorization )
	{
		headers.Authorization = authorization;
	}
	let response = await fetch( server.Url + path, { method: method, headers: headers, body: ( body === undefined ) ? undefined : JSON.stringify( body ) } );
	return { Status: response.status, Body: await response.json() };
}


async function project_of( server, id )
{
	let projects = ( await call( server, 'GET', '/api/projects' ) ).Body.Projects;
	return projects.find( function ( project ) { return project.Id === id; } ) || null;
}


async function text_of( server, id )
{
	return ( await call( server, 'GET', '/api/proposals/' + id ) ).Body;
}


async function edit( server, id, text )
{
	let read = await text_of( server, id );
	let result = await call( server, 'PUT', '/api/proposals/' + id + '/text', { Text: text, Revision: read.Proposal.Revision } );
	ASSERT.equal( result.Status, 200 );
}


async function export_of( server, id )
{
	let result = await call( server, 'GET', '/api/projects/' + id + '/export' );
	ASSERT.equal( result.Status, 200 );
	return result.Body;
}


async function import_into( server, body )
{
	return await call( server, 'POST', '/api/projects/import', body );
}


// The tree's shape: kinds, ids and names, nothing the page adds.
function shape( items )
{
	return items.map( function ( node )
	{
		let plain = { Kind: node.Kind, Id: node.Id };
		if ( node.Name )
		{
			plain.Name = node.Name;
		}
		if ( Array.isArray( node.Items ) && node.Items.length )
		{
			plain.Items = shape( node.Items );
		}
		return plain;
	} );
}


TEST.before( async function ()
{
	origin = await start();
	copy = await start();
	bare = await start();

	// The project on the origin: a folder with a plan and its Subplan, a document in the Context folder, a thread,
	// and a Readme with text.
	alpha = ( await call( origin, 'POST', '/api/projects', { Name: 'Alpha' } ) ).Body.Project;
	let folder = ( await call( origin, 'POST', '/api/projects/' + alpha.Id + '/folders', { Name: 'Drafts' } ) ).Body.Folder;
	ids.Folder = folder.Id;
	ids.Plan = ( await call( origin, 'POST', '/api/proposals', { Title: 'Plan', Text: '# Plan\n\nThe plan says the heron fishes at dawn.\n', Project: alpha.Id, Parent: folder.Id } ) ).Body.Proposal.Id;
	ids.Subplan = ( await call( origin, 'POST', '/api/proposals', { Title: 'Subplan', Text: '# Subplan\n\nA smaller part.\n', Project: alpha.Id, Parent: ids.Plan } ) ).Body.Proposal.Id;
	ids.Document = ( await call( origin, 'POST', '/api/proposals', { Title: 'Notes', Text: '# Notes\n\nSome notes.\n', Kind: 'document', Project: alpha.Id } ) ).Body.Proposal.Id;
	ids.Thread = ( await call( origin, 'POST', '/api/proposals/' + ids.Plan + '/threads', { Anchor: { Text: 'fishes at dawn' }, Text: 'Why dawn?' } ) ).Body.Thread.Id;
	await edit( origin, alpha.Context, '# Alpha\n\nThe context of Alpha.\n' );
} );


TEST.after( async function ()
{
	for ( let server of [ origin, copy, bare ] )
	{
		if ( server )
		{
			await server.Close();
		}
	}
	for ( let folder of folders )
	{
		FS.rmSync( folder, { recursive: true, force: true } );
	}
} );


//---------------------------------------------------------------------

// A proposal whole for the merge tests: revisions [ [ Id, Parent, At, Text, Merged? ] ] in order.
function whole( revisions, threads )
{
	let records = revisions.map( function ( entry, index )
	{
		let record = { Id: entry[ 0 ], Parent: entry[ 1 ], Revision: index + 1, By: 'user', At: entry[ 2 ], Reason: 'edit', Text: entry[ 3 ] };
		if ( entry[ 4 ] )
		{
			record.Merged = entry[ 4 ];
		}
		return record;
	} );
	let head = records[ records.length - 1 ];
	return { Proposal: { Id: 'pln-aaa-bbb', Title: 'T', Kind: 'plan', State: 'Proposal', Revision: head.Revision, Updated: head.At }, Text: head.Text, Threads: threads || [], Revisions: records };
}


const R1 = [ 'rev-000-000-001', null, '2026-01-01', 'one' ];
const A2 = [ 'rev-aaa-000-002', 'rev-000-000-001', '2026-01-02', 'one, from A' ];
const B2 = [ 'rev-bbb-000-002', 'rev-000-000-001', '2026-01-03', 'one, from B' ];


TEST( 'merge by revision id: a history that goes on is appended; one behind, or the same file again, adds nothing', function ()
{
	let ahead = PORT.Merge( whole( [ R1 ] ), whole( [ R1, A2 ] ) );
	ASSERT.equal( ahead.Diverged, null );
	ASSERT.equal( ahead.Revisions, 1 );
	ASSERT.equal( ahead.Whole.Text, 'one, from A' );
	ASSERT.equal( ahead.Whole.Proposal.Revision, 2 );
	ASSERT.deepEqual( ahead.Whole.Revisions.map( function ( revision ) { return revision.Id; } ), [ R1[ 0 ], A2[ 0 ] ] );

	let behind = PORT.Merge( whole( [ R1, A2 ] ), whole( [ R1 ] ) );
	ASSERT.equal( behind.Revisions, 0 );
	ASSERT.equal( behind.Whole.Text, 'one, from A' );

	let again = PORT.Merge( ahead.Whole, whole( [ R1, A2 ] ) );
	ASSERT.equal( again.Revisions, 0 );
	ASSERT.equal( again.Whole.Revisions.length, 2 );
} );


TEST( 'merge by revision id: a conflict keeps both edits, adds a merge revision with the newer text, and a round trip converges', function ()
{
	let a = whole( [ R1, A2 ] );
	let b = whole( [ R1, B2 ] );

	// A into B: B keeps its B2, gets A2 as 3, and a merge revision 4 with the newer text (B's, 2026-01-03)
	let into_b = PORT.Merge( b, a, '2026-01-04', 'rev-mmm-000-004' );
	ASSERT.equal( into_b.Diverged, 1 );
	let revisions = into_b.Whole.Revisions;
	ASSERT.deepEqual( revisions.map( function ( revision ) { return [ revision.Revision, revision.Id ]; } ), [ [ 1, R1[ 0 ] ], [ 2, B2[ 0 ] ], [ 3, A2[ 0 ] ], [ 4, 'rev-mmm-000-004' ] ] );
	ASSERT.deepEqual( [ revisions[ 3 ].Parent, revisions[ 3 ].Merged, revisions[ 3 ].Reason ], [ B2[ 0 ], A2[ 0 ], 'merge' ] );
	ASSERT.equal( into_b.Whole.Text, 'one, from B' );
	ASSERT.equal( into_b.Whole.Proposal.Revision, 4 );

	// B into A: the merge revision descends from A2, so A simply goes on to it; both end with the same text
	let into_a = PORT.Merge( a, into_b.Whole, '2026-01-05', 'rev-never-used' );
	ASSERT.equal( into_a.Diverged, null );
	ASSERT.equal( into_a.Whole.Text, into_b.Whole.Text );
	ASSERT.deepEqual( into_a.Whole.Revisions.map( function ( revision ) { return revision.Id; } ).sort(), revisions.map( function ( revision ) { return revision.Id; } ).sort() );

	// and again either way: nothing changes
	let back = PORT.Merge( into_b.Whole, into_a.Whole );
	ASSERT.equal( back.Revisions, 0 );
	ASSERT.equal( back.Whole.Text, into_b.Whole.Text );
	ASSERT.equal( PORT.Merge( into_a.Whole, into_b.Whole ).Revisions, 0 );
} );


TEST( 'merge: threads gain replies and resolve / apply records; an applied record gets its revision\'s number here', function ()
{
	let here_thread = { Id: 't1', Anchor: null, Status: 'contested', Replies: [ { Id: 'r1', By: 'user', At: 'a1', Text: 'q' } ] };
	let file_thread = { Id: 't1', Anchor: null, Status: 'resolved', Resolved: { By: 'user', At: 'a3' }, Applied: { By: 'llm', At: 'a4', Revision: 2, RevisionId: A2[ 0 ], Outcome: 'done' }, Replies: [ { Id: 'r1', By: 'user', At: 'a1', Text: 'q' }, { Id: 'r2', By: 'llm', At: 'a2', Text: 'a' } ] };
	let other = { Id: 't2', Anchor: { Text: 'missing words' }, Status: 'contested', Replies: [ { Id: 'r3', By: 'user', At: 'a4', Text: 'x' } ] };
	let merged = PORT.Merge( whole( [ R1, B2 ], [ here_thread ] ), whole( [ R1, A2 ], [ file_thread, other ] ), '2026-01-04', 'rev-mmm-000-004' );
	ASSERT.equal( merged.Threads, 1 );
	ASSERT.equal( merged.Replies, 1 );
	let t1 = merged.Whole.Threads[ 0 ];
	ASSERT.deepEqual( t1.Replies.map( function ( reply ) { return reply.Id; } ), [ 'r1', 'r2' ] );
	ASSERT.equal( t1.Status, 'resolved' );
	ASSERT.equal( t1.Applied.Revision, 3 );
	ASSERT.equal( merged.Whole.Threads[ 1 ].Detached, true );
} );


TEST( 'ids: a revision id is rev and three groups of three base36 characters', function ()
{
	ASSERT.match( IDS.New( IDS.REVISION ), /^rev-[0-9a-z]{3}-[0-9a-z]{3}-[0-9a-z]{3}$/ );
	ASSERT.notEqual( IDS.New( IDS.REVISION ), IDS.New( IDS.REVISION ) );
} );


TEST( 'check: a file that is not an export, or from a newer Consensus, is refused', function ()
{
	ASSERT.match( PORT.Check( null )[ 0 ], /not a json object/ );
	ASSERT.match( PORT.Check( { Format: 'other' } )[ 0 ], /not a Consensus project export/ );
	ASSERT.match( PORT.Check( { Format: PORT.FORMAT, Version: 99 } )[ 0 ], /newer Consensus/ );
	let broken = { Format: PORT.FORMAT, Version: 1, Project: { Id: 'j1', Name: 'X', Context: 'p1', Items: [ { Kind: 'plan', Id: 'p2' } ] }, Proposals: [] };
	let problems = PORT.Check( broken );
	ASSERT.ok( problems.some( function ( problem ) { return /names plan p2/.test( problem ); } ) );
	ASSERT.ok( problems.some( function ( problem ) { return /Project.Context/.test( problem ); } ) );
} );


TEST( 'export: the whole project, every revision, no token, no corpora; the owner or the llm', async function ()
{
	let llm_token = PARTICIPANTS.NewToken();
	origin.Settings.Participants[ 1 ].Token = llm_token;
	ASSERT.equal( ( await call( origin, 'GET', '/api/projects/' + alpha.Id + '/export', undefined, 'Bearer ' + llm_token ) ).Status, 200 );
	ASSERT.equal( ( await call( origin, 'GET', '/api/projects/jnothing/export' ) ).Status, 404 );

	exported = await export_of( origin, alpha.Id );
	ASSERT.equal( exported.Format, 'consensus-project' );
	ASSERT.equal( exported.Version, 1 );
	ASSERT.equal( exported.Project.Name, 'Alpha' );
	ASSERT.equal( exported.Project.Context, alpha.Context );
	ASSERT.equal( exported.Project.ContextFolder, alpha.ContextFolder );
	ASSERT.equal( exported.Project.Items[ 0 ].Id, alpha.ContextFolder );
	ASSERT.equal( 'Corpora' in exported, false );
	ASSERT.equal( 'Workers' in exported, false );
	let json = JSON.stringify( exported );
	ASSERT.equal( json.includes( llm_token ), false );
	let proposal_ids = exported.Proposals.map( function ( whole ) { return whole.Proposal.Id; } ).sort();
	ASSERT.deepEqual( proposal_ids, [ alpha.Context, ids.Plan, ids.Subplan, ids.Document ].sort() );
	let context_whole = exported.Proposals.find( function ( whole ) { return whole.Proposal.Id === alpha.Context; } );
	ASSERT.equal( context_whole.Proposal.Kind, 'document' );
	ASSERT.equal( context_whole.Revisions.length, 2 );
	ASSERT.equal( context_whole.Revisions[ 0 ].Text, '' );
	let plan = exported.Proposals.find( function ( whole ) { return whole.Proposal.Id === ids.Plan; } );
	ASSERT.equal( plan.Threads[ 0 ].Id, ids.Thread );
	ASSERT.deepEqual( PORT.Check( exported ), [] );
} );


TEST( 'import of a project that is not here: every id intact, the Context folder and document as they were', async function ()
{
	ASSERT.equal( ( await import_into( copy, { Export: { Format: 'nope' } } ) ).Status, 400 );
	ASSERT.equal( ( await import_into( copy, { Export: exported, Mode: 'sideways' } ) ).Status, 400 );
	let preview = await import_into( copy, { Export: exported, Preview: true } );
	ASSERT.equal( preview.Status, 200 );
	ASSERT.equal( preview.Body.Preview.Project.Exists, false );
	ASSERT.deepEqual( preview.Body.Preview.Modes, [] );
	ASSERT.equal( await project_of( copy, alpha.Id ), null );

	let result = await import_into( copy, { Export: exported } );
	ASSERT.equal( result.Status, 201 );
	let report = result.Body.Report;
	ASSERT.deepEqual( report.Project, { Id: alpha.Id, Name: 'Alpha', Mode: 'new' } );
	ASSERT.deepEqual( report.Made, { Plans: 2, Documents: 2, Threads: 1 } );
	ASSERT.deepEqual( report.UnknownParticipants, [] );

	let here = await project_of( copy, alpha.Id );
	let there = await project_of( origin, alpha.Id );
	ASSERT.equal( here.Name, 'Alpha' );
	ASSERT.equal( here.Context.Id, alpha.Context );
	ASSERT.equal( here.ContextFolder, alpha.ContextFolder );
	ASSERT.deepEqual( shape( here.Items ), shape( there.Items ) );
	let read = await text_of( copy, ids.Plan );
	ASSERT.equal( read.Text, ( await text_of( origin, ids.Plan ) ).Text );
	ASSERT.equal( read.Threads[ 0 ].Id, ids.Thread );
	ASSERT.equal( read.Threads[ 0 ].Detached, false );
	ASSERT.equal( ( await text_of( copy, alpha.Context ) ).Text, '# Alpha\n\nThe context of Alpha.\n' );
	ASSERT.equal( ( await text_of( copy, alpha.Context ) ).Context, true );
	let revisions = ( await call( copy, 'GET', '/api/proposals/' + alpha.Context + '/revisions' ) ).Body;
	ASSERT.equal( JSON.stringify( revisions ).includes( '"Revision":2' ), true );
} );


TEST( 'a project that is here: the preview offers copy or merge, and an import without a Mode is refused', async function ()
{
	let preview = ( await import_into( copy, { Export: exported, Preview: true } ) ).Body.Preview;
	ASSERT.equal( preview.Project.Exists, true );
	ASSERT.deepEqual( preview.Modes, [ 'copy', 'merge' ] );
	ASSERT.match( preview.CopyName, /^Copy of Alpha \(imported \d{4}-\d{2}-\d{2}\)$/ );
	let refused = await import_into( copy, { Export: exported } );
	ASSERT.equal( refused.Status, 400 );
	ASSERT.match( refused.Body.Error, /already here: choose Mode copy or merge/ );
} );


TEST( 'merge existing, by the llm over the API: new revisions, replies and plans come in; a conflict converges both ways', async function ()
{
	// the origin moves on: a new revision, a reply and a new plan in the folder
	await edit( origin, ids.Plan, '# Plan\n\nThe plan says the heron fishes at dawn, and rests at noon.\n' );
	await call( origin, 'POST', '/api/proposals/' + ids.Plan + '/threads/' + ids.Thread + '/replies', { Text: 'Because the light is low.' } );
	let added = ( await call( origin, 'POST', '/api/proposals', { Title: 'Later', Text: '# Later\n\nAdded later.\n', Project: alpha.Id, Parent: ids.Folder } ) ).Body.Proposal.Id;
	// the document is edited on both servers, the origin last
	await edit( copy, ids.Document, '# Notes\n\nNotes kept here.\n' );
	await edit( origin, ids.Document, '# Notes\n\nNotes kept there.\n' );

	let llm_token = PARTICIPANTS.NewToken();
	copy.Settings.Participants[ 1 ].Token = llm_token;
	let result = await call( copy, 'POST', '/api/projects/import', { Export: await export_of( origin, alpha.Id ), Mode: 'merge' }, 'Bearer ' + llm_token );
	ASSERT.equal( result.Status, 201 );
	let report = result.Body.Report;
	ASSERT.deepEqual( report.Project, { Id: alpha.Id, Name: 'Alpha', Mode: 'merge' } );
	ASSERT.deepEqual( report.Made, { Plans: 1, Documents: 0, Threads: 0 } );
	let plan = report.Merged.find( function ( item ) { return item.Id === ids.Plan; } );
	ASSERT.equal( plan.Revisions, 1 );
	ASSERT.equal( plan.Replies, 1 );
	ASSERT.deepEqual( report.Diverged.map( function ( item ) { return [ item.Id, item.At ]; } ), [ [ ids.Document, 1 ] ] );
	ASSERT.match( ( await text_of( copy, ids.Plan ) ).Text, /rests at noon/ );
	ASSERT.equal( ( await text_of( copy, ids.Plan ) ).Threads[ 0 ].Replies.length, 2 );
	ASSERT.equal( ( await text_of( copy, added ) ).Proposal.Title, 'Later' );
	ASSERT.deepEqual( shape( ( await project_of( copy, alpha.Id ) ).Items ), shape( ( await project_of( origin, alpha.Id ) ).Items ) );
	// the conflict: both edits kept, and a merge revision with the newer text, the origin's
	let document_here = await text_of( copy, ids.Document );
	ASSERT.match( document_here.Text, /kept there/ );
	let history = ( await call( copy, 'GET', '/api/proposals/' + ids.Document + '/revisions' ) ).Body.Revisions;
	ASSERT.deepEqual( history.map( function ( revision ) { return revision.Reason; } ), [ 'create', 'edit', 'edit', 'merge' ] );

	// back the other way: the origin goes on to the merge revision, and both servers hold the same
	let back = ( await import_into( origin, { Export: await export_of( copy, alpha.Id ), Mode: 'merge' } ) ).Body.Report;
	ASSERT.deepEqual( back.Diverged, [] );
	for ( let id of [ alpha.Context, ids.Plan, ids.Subplan, ids.Document, added ] )
	{
		let here = await text_of( copy, id );
		let there = await text_of( origin, id );
		ASSERT.equal( here.Text, there.Text );
		ASSERT.equal( here.Proposal.Head, there.Proposal.Head );
	}

	// and again either way: nothing new
	let again = ( await import_into( copy, { Export: await export_of( origin, alpha.Id ), Mode: 'merge' } ) ).Body.Report;
	ASSERT.ok( again.Merged.every( function ( item ) { return item.Revisions === 0 && item.Threads === 0 && item.Replies === 0; } ) );
	ASSERT.deepEqual( again.Diverged, [] );
} );


TEST( 'import as a copy: a new project named "Copy of …", every id new, the project here untouched', async function ()
{
	let before = await project_of( copy, alpha.Id );
	let again = await export_of( origin, alpha.Id );
	let report = ( await import_into( copy, { Export: again, Mode: 'copy' } ) ).Body.Report;
	ASSERT.equal( report.Project.Mode, 'copy' );
	ASSERT.notEqual( report.Project.Id, alpha.Id );
	ASSERT.match( report.Project.Name, /^Copy of Alpha \(imported \d{4}-\d{2}-\d{2}\)$/ );
	let made = await project_of( copy, report.Project.Id );
	ASSERT.equal( made.Name, report.Project.Name );
	ASSERT.notEqual( made.Context.Id, alpha.Context );
	ASSERT.notEqual( made.ContextFolder, alpha.ContextFolder );
	ASSERT.equal( made.Items[ 0 ].Id, made.ContextFolder );
	ASSERT.equal( made.Items[ 0 ].Items[ 0 ].Id, made.Context.Id );
	let all = JSON.stringify( made.Items );
	for ( let id of [ ids.Folder, ids.Plan, ids.Subplan, ids.Document, alpha.Context, alpha.ContextFolder ] )
	{
		ASSERT.equal( all.includes( id ), false );
	}
	ASSERT.deepEqual( shape( made.Items ).length, shape( ( await project_of( origin, alpha.Id ) ).Items ).length );
	ASSERT.equal( ( await text_of( copy, made.Context.Id ) ).Text, '# Alpha\n\nThe context of Alpha.\n' );
	let copied_plan = made.Items[ 1 ].Items.find( function ( node ) { return node.Items && node.Items.length; } );
	ASSERT.equal( ( await text_of( copy, copied_plan.Id ) ).Proposal.Title, 'Plan' );
	ASSERT.deepEqual( shape( ( await project_of( copy, alpha.Id ) ).Items ), shape( before.Items ) );
} );


TEST( 'an export from before Consensus Desktop: corpora and workers dropped, the context a document, the Context folder made', async function ()
{
	let older = JSON.parse( JSON.stringify( exported ) );
	// as the old server wrote it: no ContextFolder, the context of Kind context outside the tree, a corpus in it
	delete older.Project.ContextFolder;
	older.Project.Items = older.Project.Items.filter( function ( node ) { return node.Id !== alpha.ContextFolder; } );
	older.Project.Items.push( { Kind: 'document', Id: ids.Document } );
	older.Project.Items[ 0 ].Items.push( { Kind: 'corpus', Id: 'cor-old-old-old' } );
	older.Corpora = [ { Id: 'cor-old-old-old', Name: 'code', Files: [ { Path: 'a.md', Size: 3 } ] } ];
	older.Workers = [ { Name: 'Box', Workspaces: [ 'Docs' ], Inference: [] } ];
	for ( let whole of older.Proposals )
	{
		if ( whole.Proposal.Id === alpha.Context )
		{
			whole.Proposal.Kind = 'context';
		}
	}
	ASSERT.deepEqual( PORT.Check( older ), [] );
	let result = await import_into( bare, { Export: older } );
	ASSERT.equal( result.Status, 201 );
	let report = result.Body.Report;
	ASSERT.equal( report.Project.Mode, 'new' );
	ASSERT.equal( 'Corpora' in report, false );
	ASSERT.equal( 'Workers' in report, false );
	let here = await project_of( bare, alpha.Id );
	ASSERT.equal( here.Items[ 0 ].Id, here.ContextFolder );
	ASSERT.deepEqual( here.Items[ 0 ].Items.map( function ( node ) { return node.Id; } ), [ alpha.Context, ids.Document ] );
	ASSERT.equal( JSON.stringify( here.Items ).includes( 'cor-old-old-old' ), false );
	let context = await text_of( bare, alpha.Context );
	ASSERT.equal( context.Proposal.Kind, 'document' );
	ASSERT.equal( context.Context, true );
	ASSERT.equal( context.Text, '# Alpha\n\nThe context of Alpha.\n' );
} );


//---------------------------------------------------------------------
// Items out and in (plan UI Tweaks V): a folder, a plan or a document as a file of the same format, and any file
// Into a project's root or folder with every id new.

async function item_export_of( server, id )
{
	let result = await call( server, 'GET', '/api/items/' + id + '/export' );
	ASSERT.equal( result.Status, 200 );
	return result.Body;
}


function ids_in( items )
{
	return JSON.stringify( shape( items ) );
}


// The plan and document nodes under items, in tree order.
function proposal_nodes( items )
{
	let found = [];
	for ( let node of items )
	{
		if ( node.Kind !== 'folder' )
		{
			found.push( node );
		}
		if ( Array.isArray( node.Items ) )
		{
			found = found.concat( proposal_nodes( node.Items ) );
		}
	}
	return found;
}


// What an import of these items makes: the counts a report says.
async function counts_of( server, items )
{
	let counts = { Plans: 0, Documents: 0, Threads: 0 };
	for ( let node of proposal_nodes( items ) )
	{
		let read = await text_of( server, node.Id );
		counts[ ( node.Kind === 'plan' ) ? 'Plans' : 'Documents' ] += 1;
		counts.Threads += read.Threads.length;
	}
	return counts;
}


// The origin's Drafts folder as the tree has it now (earlier tests added to it).
async function drafts_folder()
{
	return ( await project_of( origin, alpha.Id ) ).Items.find( function ( node ) { return node.Id === ids.Folder; } );
}


TEST( 'item export: a folder with its plans and subplans, a plan with its subplans, a document; the Readme and the Context folder refused', async function ()
{
	let folder_file = await item_export_of( origin, ids.Folder );
	ASSERT.equal( folder_file.Format, 'consensus-project' );
	ASSERT.equal( folder_file.Version, 1 );
	ASSERT.match( folder_file.Project.Id, /^prj-/ );
	ASSERT.equal( folder_file.Project.Name, 'Drafts' );
	ASSERT.equal( folder_file.Project.Context, null );
	ASSERT.equal( folder_file.Project.ContextFolder, null );
	let drafts = await drafts_folder();
	ASSERT.deepEqual( shape( folder_file.Project.Items ), shape( [ drafts ] ) );
	ASSERT.deepEqual( folder_file.Proposals.map( function ( whole ) { return whole.Proposal.Id; } ).sort(), proposal_nodes( [ drafts ] ).map( function ( node ) { return node.Id; } ).sort() );
	ASSERT.equal( folder_file.Proposals.length >= 2, true );
	ASSERT.deepEqual( PORT.Check( folder_file ), [] );

	let plan_file = await item_export_of( origin, ids.Plan );
	ASSERT.equal( plan_file.Project.Name, 'Plan' );
	ASSERT.deepEqual( shape( plan_file.Project.Items ), [ { Kind: 'plan', Id: ids.Plan, Items: [ { Kind: 'plan', Id: ids.Subplan } ] } ] );
	ASSERT.equal( plan_file.Proposals.length, 2 );
	let plan_whole = plan_file.Proposals.find( function ( whole ) { return whole.Proposal.Id === ids.Plan; } );
	ASSERT.equal( plan_whole.Threads[ 0 ].Id, ids.Thread );
	ASSERT.equal( plan_whole.Revisions.length >= 1, true );

	let document_file = await item_export_of( origin, ids.Document );
	ASSERT.equal( document_file.Project.Name, 'Notes' );
	ASSERT.deepEqual( shape( document_file.Project.Items ), [ { Kind: 'document', Id: ids.Document } ] );
	ASSERT.equal( document_file.Proposals.length, 1 );

	ASSERT.equal( ( await call( origin, 'GET', '/api/items/' + alpha.Context + '/export' ) ).Status, 409 );
	ASSERT.equal( ( await call( origin, 'GET', '/api/items/' + alpha.ContextFolder + '/export' ) ).Status, 409 );
	ASSERT.equal( ( await call( origin, 'GET', '/api/items/fld-no-such/export' ) ).Status, 404 );
	let llm_token = PARTICIPANTS.NewToken();
	origin.Settings.Participants[ 1 ].Token = llm_token;
	ASSERT.equal( ( await call( origin, 'GET', '/api/items/' + ids.Plan + '/export', undefined, 'Bearer ' + llm_token ) ).Status, 200 );
} );


TEST( 'import Into a root and Into a folder: new ids, the counts in the report, the preview writes nothing', async function ()
{
	let home = await project_of( bare, 'default' );
	let folder_file = await item_export_of( origin, ids.Folder );
	let drafts = await drafts_folder();
	let expected = await counts_of( origin, [ drafts ] );

	let preview = await import_into( bare, { Export: folder_file, Preview: true, Into: { Project: 'default' } } );
	ASSERT.equal( preview.Status, 200 );
	ASSERT.deepEqual( preview.Body.Preview.Made, expected );
	ASSERT.equal( preview.Body.Preview.Into.Project, 'default' );
	ASSERT.deepEqual( shape( ( await project_of( bare, 'default' ) ).Items ), shape( home.Items ) );

	let result = await import_into( bare, { Export: folder_file, Into: { Project: 'default' } } );
	ASSERT.equal( result.Status, 201 );
	let report = result.Body.Report;
	ASSERT.deepEqual( report.Project, { Id: 'default', Name: home.Name, Mode: 'into' } );
	ASSERT.deepEqual( report.Made, expected );
	ASSERT.equal( report.Into.Parent, null );
	ASSERT.equal( report.Into.Nodes.length, 1 );
	ASSERT.equal( report.Written.length, expected.Plans + expected.Documents );
	let after = await project_of( bare, 'default' );
	let brought = after.Items.find( function ( node ) { return node.Id === report.Into.Nodes[ 0 ]; } );
	ASSERT.equal( brought.Kind, 'folder' );
	ASSERT.equal( brought.Name, 'Drafts' );
	ASSERT.notEqual( brought.Id, ids.Folder );
	ASSERT.equal( brought.Items.length, drafts.Items.length );
	ASSERT.equal( brought.Items[ 0 ].Items.length, 1 );
	for ( let id of [ ids.Folder, ids.Plan, ids.Subplan ] )
	{
		ASSERT.equal( ids_in( after.Items ).includes( id ), false );
	}
	let brought_plan = await text_of( bare, brought.Items[ 0 ].Id );
	ASSERT.equal( brought_plan.Proposal.Title, 'Plan' );
	ASSERT.equal( brought_plan.Text, ( await text_of( origin, ids.Plan ) ).Text );
	ASSERT.equal( brought_plan.Threads.length >= 1, true );
	ASSERT.equal( brought_plan.Threads[ 0 ].Id, ids.Thread );	// a thread keeps its id, as in a copy import

	// Into a folder: the plan's file, with its subplan.
	let target = ( await call( bare, 'POST', '/api/projects/default/folders', { Name: 'Target' } ) ).Body.Folder;
	let plan_file = await item_export_of( origin, ids.Plan );
	let into_folder = await import_into( bare, { Export: plan_file, Into: { Project: 'default', Parent: target.Id } } );
	ASSERT.equal( into_folder.Status, 201 );
	ASSERT.equal( into_folder.Body.Report.Into.Parent, target.Id );
	let folder_after = ( await project_of( bare, 'default' ) ).Items.find( function ( node ) { return node.Id === target.Id; } );
	ASSERT.equal( folder_after.Items.length, 1 );
	ASSERT.equal( folder_after.Items[ 0 ].Kind, 'plan' );
	ASSERT.equal( folder_after.Items[ 0 ].Items.length, 1 );
	ASSERT.equal( ( await text_of( bare, folder_after.Items[ 0 ].Id ) ).Proposal.Title, 'Plan' );

	// The same file again: another copy, new ids again.
	let again = await import_into( bare, { Export: plan_file, Into: { Project: 'default', Parent: target.Id } } );
	ASSERT.equal( again.Status, 201 );
	ASSERT.notEqual( again.Body.Report.Into.Nodes[ 0 ], into_folder.Body.Report.Into.Nodes[ 0 ] );
} );


TEST( 'import Into: a project\'s file goes in as a folder named after it, without its Readme and Context folder', async function ()
{
	let project_file = await export_of( origin, alpha.Id );
	let outside = ( await project_of( origin, alpha.Id ) ).Items.filter( function ( node ) { return node.Id !== alpha.ContextFolder; } );
	let expected = await counts_of( origin, outside );
	let result = await import_into( bare, { Export: project_file, Into: { Project: 'default' } } );
	ASSERT.equal( result.Status, 201 );
	let report = result.Body.Report;
	ASSERT.deepEqual( report.Made, expected );
	let after = await project_of( bare, 'default' );
	let brought = after.Items.find( function ( node ) { return node.Id === report.Into.Nodes[ 0 ]; } );
	ASSERT.equal( brought.Kind, 'folder' );
	ASSERT.equal( brought.Name, 'Alpha' );
	ASSERT.deepEqual( brought.Items.map( function ( node ) { return node.Name; } ), [ 'Drafts' ] );
	ASSERT.equal( ids_in( after.Items ).includes( alpha.Context ), false );
	ASSERT.equal( ids_in( after.Items ).includes( alpha.ContextFolder ), false );
	ASSERT.equal( ids_in( after.Items ).includes( ids.Document ), false );
} );


TEST( 'import Into: a document goes into the Context folder only; a missing project or folder is refused; nothing is written on a refusal', async function ()
{
	let home = await project_of( bare, 'default' );
	let document_file = await item_export_of( origin, ids.Document );
	let before = ( await call( bare, 'GET', '/api/proposals' ) ).Body;
	let at_root = await import_into( bare, { Export: document_file, Into: { Project: 'default' } } );
	ASSERT.equal( at_root.Status, 400 );
	ASSERT.match( at_root.Body.Problems[ 0 ], /does not take a document/ );
	ASSERT.deepEqual( ( await call( bare, 'GET', '/api/proposals' ) ).Body, before );

	let in_context = await import_into( bare, { Export: document_file, Into: { Project: 'default', Parent: home.ContextFolder } } );
	ASSERT.equal( in_context.Status, 201 );
	ASSERT.deepEqual( in_context.Body.Report.Made, { Plans: 0, Documents: 1, Threads: 0 } );
	let context_folder = ( await project_of( bare, 'default' ) ).Items[ 0 ];
	ASSERT.equal( context_folder.Id, home.ContextFolder );
	ASSERT.equal( context_folder.Items[ context_folder.Items.length - 1 ].Id, in_context.Body.Report.Into.Nodes[ 0 ] );
	ASSERT.equal( ( await text_of( bare, in_context.Body.Report.Into.Nodes[ 0 ] ) ).Proposal.Title, 'Notes' );

	let folder_file = await item_export_of( origin, ids.Folder );
	ASSERT.equal( ( await import_into( bare, { Export: folder_file, Into: { Project: 'default', Parent: home.ContextFolder } } ) ).Status, 400 );
	ASSERT.equal( ( await import_into( bare, { Export: folder_file, Into: { Project: 'prj-no-such' } } ) ).Status, 400 );
	ASSERT.equal( ( await import_into( bare, { Export: folder_file, Into: { Project: 'default', Parent: 'fld-no-such' } } ) ).Status, 400 );
	ASSERT.equal( ( await import_into( bare, { Export: folder_file, Into: 'default' } ) ).Status, 400 );
} );


TEST( 'an item\'s file imports as a new project too, with an empty Readme', async function ()
{
	let folder_file = await item_export_of( origin, ids.Folder );
	ASSERT.deepEqual( ( await import_into( bare, { Export: folder_file, Preview: true } ) ).Body.Preview.Project.Exists, false );
	// Its plans are on this server already (brought over by the merge test), so it comes in as a copy.
	let result = await import_into( bare, { Export: folder_file, Mode: 'copy' } );
	ASSERT.equal( result.Status, 201, JSON.stringify( result.Body ) );
	ASSERT.equal( result.Body.Report.Project.Mode, 'copy' );
	let made = await project_of( bare, result.Body.Report.Project.Id );
	ASSERT.match( made.Name, /^Copy of Drafts \(imported / );
	ASSERT.equal( made.Items[ 0 ].Id, made.ContextFolder );
	ASSERT.equal( made.Items[ 0 ].Items[ 0 ].Id, made.Context.Id );
	ASSERT.equal( ( await text_of( bare, made.Context.Id ) ).Text, '' );
	ASSERT.equal( made.Items.length, 2 );
	ASSERT.equal( made.Items[ 1 ].Name, 'Drafts' );
	ASSERT.notEqual( made.Items[ 1 ].Id, ids.Folder );
	ASSERT.equal( ( await text_of( bare, made.Items[ 1 ].Items[ 0 ].Id ) ).Proposal.Title, 'Plan' );

	// A file with no plan here comes in as it is.
	let fresh = await start();
	let as_new = await import_into( fresh, { Export: folder_file } );
	ASSERT.equal( as_new.Status, 201, JSON.stringify( as_new.Body ) );
	ASSERT.equal( as_new.Body.Report.Project.Mode, 'new' );
	let made_new = await project_of( fresh, as_new.Body.Report.Project.Id );
	ASSERT.equal( made_new.Name, 'Drafts' );
	ASSERT.equal( made_new.Items[ 1 ].Id, ids.Folder );
	ASSERT.equal( ( await text_of( fresh, ids.Plan ) ).Proposal.Title, 'Plan' );
	await fresh.Close();

	let document_file = await item_export_of( origin, ids.Document );
	let as_project = await import_into( bare, { Export: document_file, Mode: 'copy' } );
	ASSERT.equal( as_project.Status, 201 );
	let made_too = await project_of( bare, as_project.Body.Report.Project.Id );
	ASSERT.equal( made_too.Items.length, 1 );
	ASSERT.equal( made_too.Items[ 0 ].Items.length, 2 );
	ASSERT.equal( made_too.Items[ 0 ].Items[ 1 ].Kind, 'document' );
} );
