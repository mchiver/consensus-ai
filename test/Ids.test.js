'use strict';

// migrate-ids over an older data folder written by hand: slug ids become plain ids everywhere they are named,
// project names move to the master, a backup is made first, and a second run changes nothing.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const FS = require( 'fs' );
const OS = require( 'os' );
const PATH = require( 'path' );
const STORE = require( '../src/Store.js' );
const IDS = require( '../src/Ids.js' );


function write( folder, file, value )
{
	let path = PATH.join( folder, file );
	FS.mkdirSync( PATH.dirname( path ), { recursive: true } );
	FS.writeFileSync( path, ( typeof value === 'string' ) ? value : JSON.stringify( value ) );
}


function read( folder, file )
{
	return JSON.parse( FS.readFileSync( PATH.join( folder, file ), 'utf8' ) );
}


// An older data folder: two plans (one in a folder), a trashed plan, a corpus, and two projects besides Default.
function older_folder()
{
	let parent = FS.mkdtempSync( PATH.join( OS.tmpdir(), 'consensus-ids-' ) );
	let folder = PATH.join( parent, '~data' );
	for ( let id of [ 'first-plan-111111', 'second-plan-222222' ] )
	{
		write( folder, 'proposals/' + id + '/proposal.json', { Id: id, Title: id, Kind: 'plan', State: 'Proposal', Revision: 1 } );
		write( folder, 'proposals/' + id + '/proposal.md', '# ' + id + '\n' );
		write( folder, 'proposals/' + id + '/threads.json', [] );
		write( folder, 'proposals/' + id + '/revisions/0001.json', { Revision: 1 } );
		write( folder, 'proposals/' + id + '/revisions/0001.md', '# ' + id + '\n' );
		write( folder, 'proposals/' + id + '/index.json', [ { Chunk: 0, Proposal: id, Revision: 1, Text: id } ] );
	}
	write( folder, 'trash/gone-plan-333333/proposal.json', { Id: 'gone-plan-333333', Title: 'Gone', Kind: 'plan', State: 'Proposal', Revision: 1 } );
	write( folder, 'corpora/notes-444444/corpus.json', { Id: 'notes-444444', Kind: 'corpus', Name: 'notes', Version: 1, Files: [] } );
	write( folder, 'corpora/notes-444444/index.json', [ { Chunk: 0, Corpus: 'notes-444444', Path: 'a.md', Revision: 1, Text: 'a' } ] );
	write( folder, 'projects/default/project.json', { Id: 'default', Name: 'Default', Version: 1, Items: [ { Kind: 'plan', Id: 'first-plan-111111' } ] } );
	write( folder, 'projects/zebra-555555/project.json', { Id: 'zebra-555555', Name: 'Zebra', Version: 1, Items: [ { Kind: 'corpus', Id: 'notes-444444' } ] } );
	write( folder, 'projects/alpha-666666/project.json', { Id: 'alpha-666666', Name: 'Alpha', Version: 1, Items: [ { Kind: 'folder', Id: 'f12345678', Name: 'Specs', Items: [ { Kind: 'plan', Id: 'second-plan-222222' } ] } ] } );
	return folder;
}


TEST( 'migrate-ids gives every item a plain id, everywhere it is named, after a backup', async function ()
{
	let folder = older_folder();
	let result = await IDS.MigrateIds( folder );
	ASSERT.match( PATH.basename( result.Backup ), /^~data-backup-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}$/ );
	ASSERT.equal( FS.existsSync( PATH.join( result.Backup, 'proposals', 'first-plan-111111', 'proposal.json' ) ), true );

	let proposals = FS.readdirSync( PATH.join( folder, 'proposals' ) );
	ASSERT.equal( proposals.length, 2 );
	for ( let id of proposals )
	{
		ASSERT.match( id, /^p[0-9a-f]{8}$/ );
		ASSERT.equal( read( folder, 'proposals/' + id + '/proposal.json' ).Id, id );
		ASSERT.equal( read( folder, 'proposals/' + id + '/index.json' )[ 0 ].Proposal, id );
	}
	let trashed = FS.readdirSync( PATH.join( folder, 'trash' ) );
	ASSERT.match( trashed[ 0 ], /^p[0-9a-f]{8}$/ );
	let corpora = FS.readdirSync( PATH.join( folder, 'corpora' ) );
	ASSERT.match( corpora[ 0 ], /^z[0-9a-f]{8}$/ );
	ASSERT.equal( read( folder, 'corpora/' + corpora[ 0 ] + '/index.json' )[ 0 ].Corpus, corpora[ 0 ] );

	// the master holds the names, in the order they were shown: Default, then by name
	let master = read( folder, 'projects.json' );
	ASSERT.deepEqual( master.Projects.map( function ( entry ) { return entry.Name; } ), [ 'Default', 'Alpha', 'Zebra' ] );
	ASSERT.equal( master.Projects[ 0 ].Id, 'default' );
	ASSERT.match( master.Projects[ 1 ].Id, /^j[0-9a-f]{8}$/ );

	// the trees name the new ids, and the store reads them all back
	let store = STORE.Open( folder );
	let projects = await store.ListProjects();
	ASSERT.deepEqual( projects.map( function ( project ) { return project.Name; } ), [ 'Default', 'Alpha', 'Zebra' ] );
	for ( let project of projects )
	{
		ASSERT.equal( 'Name' in read( folder, 'projects/' + project.Id + '/project.json' ), false );
		for ( let id of require( '../src/Tree.js' ).ItemIds( project.Items ) )
		{
			ASSERT.equal( proposals.includes( id ) || corpora.includes( id ), true, id );
		}
	}
	ASSERT.equal( projects[ 1 ].Items[ 0 ].Id, 'f12345678' );
	ASSERT.equal( ( await store.ReadProposal( projects[ 0 ].Items[ 0 ].Id ) ).Text, '# first-plan-111111\n' );

	// once more: nothing to change
	let again = await IDS.MigrateIds( folder );
	ASSERT.deepEqual( again.Lines, [] );
	ASSERT.deepEqual( FS.readdirSync( PATH.join( folder, 'proposals' ) ).sort(), proposals.sort() );
} );
