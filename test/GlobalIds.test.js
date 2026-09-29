'use strict';

// Global ids (the plan Global Ids): the id format, revisions with Id, Parent and Head, an applied record's RevisionId,
// and a data folder from before, migrated once at start with its old ids still opening their items.

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


function write_json( file, value )
{
	FS.mkdirSync( PATH.dirname( file ), { recursive: true } );
	FS.writeFileSync( file, JSON.stringify( value, null, '\t' ) );
}


// A proposal folder as it was before Global Ids: texts [ text, … ] one per revision, no revision ids.
function old_proposal( data, id, kind, title, texts, threads )
{
	let home = PATH.join( data, 'proposals', id );
	texts.forEach( function ( text, index )
	{
		let name = String( index + 1 ).padStart( 4, '0' );
		write_json( PATH.join( home, 'revisions', name + '.json' ), { Revision: index + 1, By: 'user', At: '2026-09-2' + index + 'T00:00:00.000Z', Reason: index ? 'edit' : 'create' } );
		FS.writeFileSync( PATH.join( home, 'revisions', name + '.md' ), text );
	} );
	FS.writeFileSync( PATH.join( home, 'proposal.md' ), texts[ texts.length - 1 ] );
	write_json( PATH.join( home, 'threads.json' ), threads || [] );
	write_json( PATH.join( home, 'proposal.json' ), { Id: id, Title: title, Kind: kind, State: ( kind === 'plan' ) ? 'Proposal' : null, Created: '2026-09-20T00:00:00.000Z', Updated: '2026-09-21T00:00:00.000Z', Revision: texts.length } );
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
		FS.rmSync( folder + '-before-ids', { recursive: true, force: true } );
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


TEST( 'an old data folder is migrated once: new ids everywhere, folders renamed, revisions given ids, old ids still open', async function ()
{
	let data = temporary_folder( 'consensus-ids-old-' );
	write_json( PATH.join( data, 'consensus.json' ), PARTICIPANTS.DefaultSettings( 0 ) );
	write_json( PATH.join( data, 'projects.json' ), { Projects: [ { Id: 'default', Name: 'Default' }, { Id: 'j0000abcd', Name: 'Old' } ] } );
	write_json( PATH.join( data, 'projects', 'default', 'project.json' ), { Id: 'default', Context: 'p1111aaaa', Created: 'c', Updated: 'u', Version: 1, Items: [] } );
	write_json( PATH.join( data, 'projects', 'j0000abcd', 'project.json' ), { Id: 'j0000abcd', Context: 'p2222bbbb', Created: 'c', Updated: 'u', Version: 3, Items: [
		{ Kind: 'folder', Id: 'f3333cccc', Name: 'Drafts', Items: [ { Kind: 'plan', Id: 'p4444dddd' } ] },
		{ Kind: 'corpus', Id: 'z5555eeee' },
	] } );
	write_json( PATH.join( data, 'projects', 'j0000abcd', 'corpora', 'z5555eeee', 'corpus.json' ), { Id: 'z5555eeee', Kind: 'corpus', Name: 'code', Created: 'c', Updated: 'u', Version: 1, Source: 'attached', Include: [], Exclude: [], Files: [] } );
	old_proposal( data, 'p1111aaaa', 'context', 'Context', [ '' ] );
	old_proposal( data, 'p2222bbbb', 'context', 'Context', [ '# Old\n\nSee [the plan](#/p/p4444dddd).\n' ] );
	let threads = [ { Id: 't6666ffff', Anchor: null, Detached: false, Status: 'resolved', Reopened: false, Resolved: { By: 'user', At: 'a' }, Applied: { By: 'llm', At: 'b', Revision: 2, Outcome: 'done' }, Created: 'a',
		Replies: [ { Id: 'r7777aaaa', By: 'user', At: 'a', Text: 'Do it.' } ] } ];
	old_proposal( data, 'p4444dddd', 'plan', 'Plan', [ '# Plan\n\nFirst.\n', '# Plan\n\nSecond.\n' ], threads );
	write_json( PATH.join( data, 'proposals', 'p4444dddd', 'index.json' ), [ { Chunk: 1, Proposal: 'p4444dddd' } ] );

	let running = await SERVER.Start( { Data: data, Port: 0 } );
	let kept = JSON.parse( FS.readFileSync( PATH.join( data, 'ids.json' ), 'utf8' ) );
	let map = kept.Map;
	ASSERT.equal( FS.existsSync( data + '-before-ids' ), true );
	ASSERT.equal( FS.existsSync( PATH.join( data + '-before-ids', 'proposals', 'p4444dddd' ) ), true );
	ASSERT.deepEqual( Object.keys( map ).sort(), [ 'f3333cccc', 'j0000abcd', 'p1111aaaa', 'p2222bbbb', 'p4444dddd', 'r7777aaaa', 't6666ffff', 'z5555eeee' ] );
	ASSERT.equal( IDS.Is( map.j0000abcd, IDS.PROJECT ), true );
	ASSERT.equal( IDS.Is( map.p2222bbbb, IDS.CONTEXT ), true );
	ASSERT.equal( IDS.Is( map.p4444dddd, IDS.PLAN ), true );
	ASSERT.equal( IDS.Is( map.f3333cccc, IDS.FOLDER ), true );
	ASSERT.equal( IDS.Is( map.z5555eeee, IDS.CORPUS ), true );
	ASSERT.equal( FS.existsSync( PATH.join( data, 'proposals', 'p4444dddd' ) ), false );
	ASSERT.equal( FS.existsSync( PATH.join( data, 'projects', map.j0000abcd, 'corpora', map.z5555eeee, 'corpus.json' ) ), true );

	let project = ( await call( running, 'GET', '/api/projects' ) ).Body.Projects.find( function ( candidate ) { return candidate.Name === 'Old'; } );
	ASSERT.equal( project.Id, map.j0000abcd );
	ASSERT.equal( project.Context.Id, map.p2222bbbb );
	ASSERT.deepEqual( [ project.Items[ 0 ].Id, project.Items[ 0 ].Items[ 0 ].Id, project.Items[ 1 ].Id ], [ map.f3333cccc, map.p4444dddd, map.z5555eeee ] );

	// the old id still opens the plan, which answers with its new one
	let plan = ( await call( running, 'GET', '/api/proposals/p4444dddd' ) ).Body;
	ASSERT.equal( plan.Proposal.Id, map.p4444dddd );
	ASSERT.deepEqual( [ plan.Threads[ 0 ].Id, plan.Threads[ 0 ].Replies[ 0 ].Id ], [ map.t6666ffff, map.r7777aaaa ] );
	let revisions = ( await call( running, 'GET', '/api/proposals/' + map.p4444dddd + '/revisions' ) ).Body.Revisions;
	ASSERT.ok( revisions.every( function ( revision ) { return IDS.Is( revision.Id, IDS.REVISION ); } ) );
	ASSERT.deepEqual( [ revisions[ 0 ].Parent, revisions[ 1 ].Parent ], [ null, revisions[ 0 ].Id ] );
	ASSERT.equal( plan.Proposal.Head, revisions[ 1 ].Id );
	ASSERT.equal( plan.Threads[ 0 ].Applied.RevisionId, revisions[ 1 ].Id );
	// links in texts name the new id; the index was rebuilt under it
	ASSERT.equal( ( await call( running, 'GET', '/api/proposals/p2222bbbb' ) ).Body.Text, '# Old\n\nSee [the plan](#/p/' + map.p4444dddd + ').\n' );
	ASSERT.equal( JSON.parse( FS.readFileSync( PATH.join( data, 'proposals', map.p4444dddd, 'index.json' ), 'utf8' ) )[ 0 ].Proposal, map.p4444dddd );
	await running.Close();

	// a second start migrates nothing, and old ids still open their items
	let again = await SERVER.Start( { Data: data, Port: 0 } );
	ASSERT.deepEqual( JSON.parse( FS.readFileSync( PATH.join( data, 'ids.json' ), 'utf8' ) ).Map, map );
	ASSERT.equal( ( await call( again, 'GET', '/api/proposals/p4444dddd' ) ).Body.Proposal.Id, map.p4444dddd );
	ASSERT.equal( ( await call( again, 'GET', '/api/corpus/z5555eeee' ) ).Body.Corpus.Id, map.z5555eeee );
	await again.Close();
} );
