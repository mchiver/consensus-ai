'use strict';

// Ids - MigrateIds( Folder ) converts a data folder's older slug ids ("consensus-ui-tweaks-07cf1e") to plain
// ids (a kind letter and 8 hex digits, see Store.js), once, with the server stopped:
//
//   - the whole data folder is first copied to <folder>-backup-<YYYY-MM-DD-HH-mm-ss> beside it
//   - each proposal, corpus and project folder (in proposals, corpora, trash and projects) is renamed,
//     and the Id in its proposal.json, corpus.json or project.json follows
//   - the search chunks in each index.json name the new id, so nothing is indexed again
//   - each project tree names the new ids
//   - each project's Name moves out of its project.json into the master projects.json, in the order the
//     projects were shown in: Default first, then by name
//
// Running it again changes nothing but the backup. Old links (#/p/<old id>) stop working.

const FS = require( 'fs' );
const PATH = require( 'path' );
const STORE = require( './Store.js' );

const PROPOSALS_FOLDER = 'proposals';
const CORPORA_FOLDER = 'corpora';
const TRASH_FOLDER = 'trash';
const PROJECTS_FOLDER = 'projects';


//---------------------------------------------------------------------
// Files

async function read_json_or_null( file )
{
	try
	{
		return JSON.parse( await FS.promises.readFile( file, 'utf8' ) );
	}
	catch ( error )
	{
		if ( error.code === 'ENOENT' )
		{
			return null;
		}
		throw error;
	}
}


async function write_json( file, value )
{
	await FS.promises.writeFile( file, JSON.stringify( value, null, '\t' ) + '\n', 'utf8' );
}


async function list_folder( folder )
{
	if ( !FS.existsSync( folder ) )
	{
		return [];
	}
	let entries = await FS.promises.readdir( folder, { withFileTypes: true } );
	return entries.filter( function ( entry ) { return entry.isDirectory(); } ).map( function ( entry ) { return entry.name; } );
}


// A local time stamp for the backup's name: 2026-09-25-23-59-07
function stamp( date )
{
	function two( number )
	{
		return String( number ).padStart( 2, '0' );
	}
	return date.getFullYear() + '-' + two( date.getMonth() + 1 ) + '-' + two( date.getDate() ) + '-' + two( date.getHours() ) + '-' + two( date.getMinutes() ) + '-' + two( date.getSeconds() );
}


//---------------------------------------------------------------------
// MigrateIds: returns { Backup, Lines }, a line for each id it changed.

async function MigrateIds( Folder )
{
	let folder = PATH.resolve( Folder );
	if ( !FS.existsSync( folder ) )
	{
		throw new Error( 'no data folder at ' + folder );
	}
	let backup = PATH.join( PATH.dirname( folder ), PATH.basename( folder ) + '-backup-' + stamp( new Date() ) );
	await FS.promises.cp( folder, backup, { recursive: true } );

	let lines = [];
	let map = await plan_ids( folder );

	// the folders and the ids inside them
	for ( let parent of [ PROPOSALS_FOLDER, CORPORA_FOLDER, TRASH_FOLDER ] )
	{
		for ( let id of await list_folder( PATH.join( folder, parent ) ) )
		{
			if ( !map[ id ] )
			{
				continue;
			}
			let source = PATH.join( folder, parent, id );
			let target = PATH.join( folder, parent, map[ id ] );
			await FS.promises.rename( source, target );
			await rewrite_item( target, id, map[ id ] );
			lines.push( parent + '/' + id + ' -> ' + map[ id ] );
		}
	}

	// the projects: renamed, their trees naming the new ids, their names in the master
	let master = await read_json_or_null( PATH.join( folder, STORE.MASTER_FILE ) );
	let entries = ( master && Array.isArray( master.Projects ) ) ? master.Projects : [];
	let unnamed = [];
	for ( let id of await list_folder( PATH.join( folder, PROJECTS_FOLDER ) ) )
	{
		let file = PATH.join( folder, PROJECTS_FOLDER, id, 'project.json' );
		let project = await read_json_or_null( file );
		if ( !project )
		{
			continue;
		}
		let new_id = map[ id ] || id;
		let entry = entries.find( function ( candidate ) { return candidate.Id === id; } );
		if ( entry )
		{
			entry.Id = new_id;
		}
		else
		{
			unnamed.push( { Id: new_id, Name: project.Name || id, Default: id === STORE.DEFAULT_PROJECT } );
		}
		project.Id = new_id;
		delete project.Name;
		project.Items = rename_nodes( project.Items || [], map );
		await write_json( file, project );
		if ( new_id !== id )
		{
			await FS.promises.rename( PATH.join( folder, PROJECTS_FOLDER, id ), PATH.join( folder, PROJECTS_FOLDER, new_id ) );
			lines.push( PROJECTS_FOLDER + '/' + id + ' -> ' + new_id );
		}
	}
	unnamed.sort( function ( a, b )
	{
		if ( a.Default !== b.Default )
		{
			return a.Default ? -1 : 1;
		}
		return a.Name.localeCompare( b.Name );
	} );
	for ( let one of unnamed )
	{
		entries.push( { Id: one.Id, Name: one.Name } );
	}
	if ( unnamed.length )
	{
		lines.push( STORE.MASTER_FILE + ': named ' + unnamed.map( function ( one ) { return one.Name; } ).join( ', ' ) );
	}
	await write_json( PATH.join( folder, STORE.MASTER_FILE ), { Projects: entries } );
	return { Backup: backup, Lines: lines };
}


// The new id for every item whose id is not plain yet: { old id: new id }.
async function plan_ids( folder )
{
	let map = {};
	let used = new Set();
	let kinds = [];
	for ( let parent of [ PROPOSALS_FOLDER, CORPORA_FOLDER, TRASH_FOLDER ] )
	{
		for ( let id of await list_folder( PATH.join( folder, parent ) ) )
		{
			used.add( id );
			if ( FS.existsSync( PATH.join( folder, parent, id, 'proposal.json' ) ) )
			{
				kinds.push( { Id: id, Letter: STORE.PROPOSAL_LETTER } );
			}
			else if ( FS.existsSync( PATH.join( folder, parent, id, 'corpus.json' ) ) )
			{
				kinds.push( { Id: id, Letter: STORE.CORPUS_LETTER } );
			}
		}
	}
	for ( let id of await list_folder( PATH.join( folder, PROJECTS_FOLDER ) ) )
	{
		used.add( id );
		if ( id !== STORE.DEFAULT_PROJECT )
		{
			kinds.push( { Id: id, Letter: STORE.PROJECT_LETTER } );
		}
	}
	for ( let kind of kinds )
	{
		if ( STORE.IsNewId( kind.Id, kind.Letter ) || map[ kind.Id ] )
		{
			continue;
		}
		let id = STORE.NewId( kind.Letter );
		while ( used.has( id ) )
		{
			id = STORE.NewId( kind.Letter );
		}
		used.add( id );
		map[ kind.Id ] = id;
	}
	return map;
}


// A renamed proposal or corpus folder: the Id in its json, and the id its search chunks name.
async function rewrite_item( folder, old_id, new_id )
{
	for ( let name of [ 'proposal.json', 'corpus.json' ] )
	{
		let file = PATH.join( folder, name );
		let item = await read_json_or_null( file );
		if ( item )
		{
			item.Id = new_id;
			await write_json( file, item );
		}
	}
	let index_file = PATH.join( folder, 'index.json' );
	let chunks = await read_json_or_null( index_file );
	if ( Array.isArray( chunks ) )
	{
		for ( let chunk of chunks )
		{
			if ( chunk.Proposal === old_id )
			{
				chunk.Proposal = new_id;
			}
			if ( chunk.Corpus === old_id )
			{
				chunk.Corpus = new_id;
			}
		}
		await write_json( index_file, chunks );
	}
}


function rename_nodes( items, map )
{
	return items.map( function ( node )
	{
		if ( node.Kind === 'folder' )
		{
			return Object.assign( {}, node, { Items: rename_nodes( node.Items || [], map ) } );
		}
		return Object.assign( {}, node, { Id: map[ node.Id ] || node.Id } );
	} );
}


module.exports = {
	MigrateIds: MigrateIds,
};
