'use strict';

// Migrate - a data folder from before Global Ids moves to global ids, once, at start (the plan Global Ids).
//
// Old ids are a letter and 8 hex digits: p… a proposal, z… a corpus, j… a project, f… a folder, t… a thread, r… a
// reply, s… an LLM session run. Each gets a global id of its kind (Ids.js), and then:
//   - the data folder is first copied whole beside it, to <folder>-before-ids;
//   - every old id in every .json and .md file is replaced by its new one: projects.json, trees, Context pointers,
//     threads, replies, runs, revision records, and links such as #/p/<id> in every text and revision;
//   - proposal, corpus, project and trash folders are renamed to their new ids;
//   - search indexes are removed, to be rebuilt at start;
//   - each revision gets an Id and a Parent (the revision before it), each proposal its Head, and each Applied record
//     the RevisionId of the revision it names;
//   - the map from old ids to new is kept in ids.json, so an old id still opens its item.
// A data folder with ids.json, or with no old ids, is left as it is.

const FS = require( 'fs' );
const PATH = require( 'path' );
const IDS = require( './Ids.js' );

const MAP_FILE = 'ids.json';
const BACKUP_SUFFIX = '-before-ids';
const OLD_ID = /^[pzjftrs][0-9a-f]{8}$/;
const OLD_ID_IN_TEXT = /\b[pzjftrs][0-9a-f]{8}\b/g;
const REWRITTEN = [ '.json', '.md' ];
const INDEX_FILE = 'index.json';


//---------------------------------------------------------------------
// Files

function read_json( file )
{
	try
	{
		return JSON.parse( FS.readFileSync( file, 'utf8' ) );
	}
	catch ( error )
	{
		return null;
	}
}


function write_json( file, value )
{
	FS.writeFileSync( file, JSON.stringify( value, null, '\t' ) + '\n', 'utf8' );
}


function folders_in( folder )
{
	if ( !FS.existsSync( folder ) )
	{
		return [];
	}
	return FS.readdirSync( folder, { withFileTypes: true } ).filter( function ( entry ) { return entry.isDirectory(); } ).map( function ( entry ) { return entry.name; } );
}


// Every file under folder, with its path.
function files_under( folder, list )
{
	let found = list || [];
	for ( let entry of FS.readdirSync( folder, { withFileTypes: true } ) )
	{
		let path = PATH.join( folder, entry.name );
		if ( entry.isDirectory() )
		{
			files_under( path, found );
		}
		else
		{
			found.push( path );
		}
	}
	return found;
}


//---------------------------------------------------------------------
// The map: every old id in the data folder, with its new id.

function build_map( folder )
{
	let map = {};
	function note( old, kind )
	{
		if ( OLD_ID.test( old ) && !map[ old ] )
		{
			map[ old ] = IDS.New( kind );
		}
	}
	function note_proposal( old, home )
	{
		let proposal = read_json( PATH.join( home, 'proposal.json' ) );
		if ( proposal )
		{
			note( old, IDS.ForProposal( proposal.Kind ) );
			note_threads( home );
			return;
		}
		if ( read_json( PATH.join( home, 'corpus.json' ) ) )
		{
			note( old, IDS.CORPUS );
		}
	}
	function note_threads( home )
	{
		for ( let thread of read_json( PATH.join( home, 'threads.json' ) ) || [] )
		{
			note( thread.Id, IDS.THREAD );
			for ( let reply of thread.Replies || [] )
			{
				note( reply.Id, IDS.REPLY );
			}
		}
		for ( let run of read_json( PATH.join( home, 'runs.json' ) ) || [] )
		{
			note( run.Id, IDS.RUN );
		}
	}
	function note_tree( items )
	{
		for ( let node of items || [] )
		{
			if ( node.Kind === 'folder' )
			{
				note( node.Id, IDS.FOLDER );
			}
			note_tree( node.Items );
		}
	}

	for ( let id of folders_in( PATH.join( folder, 'proposals' ) ) )
	{
		note_proposal( id, PATH.join( folder, 'proposals', id ) );
	}
	for ( let id of folders_in( PATH.join( folder, 'trash' ) ) )
	{
		note_proposal( id, PATH.join( folder, 'trash', id ) );
	}
	for ( let project of folders_in( PATH.join( folder, 'projects' ) ) )
	{
		note( project, IDS.PROJECT );
		let tree = read_json( PATH.join( folder, 'projects', project, 'project.json' ) );
		note_tree( tree ? tree.Items : [] );
		for ( let corpus of folders_in( PATH.join( folder, 'projects', project, 'corpora' ) ) )
		{
			note( corpus, IDS.CORPUS );
		}
	}
	return map;
}


//---------------------------------------------------------------------
// The steps

// A free place beside the data folder for its copy.
function backup_path( folder )
{
	let target = folder + BACKUP_SUFFIX;
	for ( let count = 2; FS.existsSync( target ); count++ )
	{
		target = folder + BACKUP_SUFFIX + '-' + count;
	}
	return target;
}


// Every old id in the .json and .md files, replaced; search indexes removed.
function rewrite_files( folder, map )
{
	for ( let file of files_under( folder ) )
	{
		if ( PATH.basename( file ) === INDEX_FILE )
		{
			FS.rmSync( file );
			continue;
		}
		if ( !REWRITTEN.includes( PATH.extname( file ) ) )
		{
			continue;
		}
		let text = FS.readFileSync( file, 'utf8' );
		let rewritten = text.replace( OLD_ID_IN_TEXT, function ( old ) { return map[ old ] || old; } );
		if ( rewritten !== text )
		{
			FS.writeFileSync( file, rewritten, 'utf8' );
		}
	}
}


// The folders named by an old id take the new one.
function rename_folders( folder, map )
{
	let parents = [ PATH.join( folder, 'proposals' ), PATH.join( folder, 'trash' ) ];
	for ( let project of folders_in( PATH.join( folder, 'projects' ) ) )
	{
		parents.push( PATH.join( folder, 'projects', project, 'corpora' ) );
	}
	parents.push( PATH.join( folder, 'projects' ) );
	for ( let parent of parents )
	{
		for ( let name of folders_in( parent ) )
		{
			if ( map[ name ] )
			{
				FS.renameSync( PATH.join( parent, name ), PATH.join( parent, map[ name ] ) );
			}
		}
	}
}


// Each proposal's revisions get an Id and a Parent, the proposal its Head, and its Applied records their RevisionId.
function give_revisions_ids( home )
{
	let proposal = read_json( PATH.join( home, 'proposal.json' ) );
	let revisions_folder = PATH.join( home, 'revisions' );
	if ( !proposal || !FS.existsSync( revisions_folder ) )
	{
		return;
	}
	let names = FS.readdirSync( revisions_folder ).filter( function ( name ) { return name.endsWith( '.json' ); } ).sort();
	let ids = {};
	let parent = null;
	for ( let name of names )
	{
		let file = PATH.join( revisions_folder, name );
		let record = read_json( file );
		if ( !record )
		{
			continue;
		}
		if ( !record.Id )
		{
			record = Object.assign( { Id: IDS.New( IDS.REVISION ), Parent: parent }, record );
			write_json( file, record );
		}
		ids[ record.Revision ] = record.Id;
		parent = record.Id;
	}
	if ( !proposal.Head && ids[ proposal.Revision ] )
	{
		proposal.Head = ids[ proposal.Revision ];
		write_json( PATH.join( home, 'proposal.json' ), proposal );
	}
	let threads = read_json( PATH.join( home, 'threads.json' ) );
	if ( !threads )
	{
		return;
	}
	for ( let thread of threads )
	{
		if ( thread.Applied && !thread.Applied.RevisionId && ids[ thread.Applied.Revision ] )
		{
			thread.Applied.RevisionId = ids[ thread.Applied.Revision ];
		}
	}
	write_json( PATH.join( home, 'threads.json' ), threads );
}


//---------------------------------------------------------------------
// Run: migrates Folder when it holds old ids. Returns { Lines, Map }: what to print, and the old-to-new map (the
// one kept in ids.json when the folder was migrated before, empty when it never had old ids).

async function Run( Folder )
{
	let folder = PATH.resolve( Folder );
	let kept = read_json( PATH.join( folder, MAP_FILE ) );
	if ( kept )
	{
		return { Lines: [], Map: kept.Map || {} };
	}
	let map = build_map( folder );
	let count = Object.keys( map ).length;
	if ( !count )
	{
		return { Lines: [], Map: {} };
	}

	let backup = backup_path( folder );
	await FS.promises.cp( folder, backup, { recursive: true } );
	rewrite_files( folder, map );
	rename_folders( folder, map );
	for ( let parent of [ 'proposals', 'trash' ] )
	{
		for ( let id of folders_in( PATH.join( folder, parent ) ) )
		{
			give_revisions_ids( PATH.join( folder, parent, id ) );
		}
	}
	write_json( PATH.join( folder, MAP_FILE ), { Migrated: new Date().toISOString(), Backup: backup, Map: map } );
	return { Lines: [ 'migrated ' + count + ' ids to global ids; the data before is in ' + backup ], Map: map };
}


//---------------------------------------------------------------------

module.exports = {
	MAP_FILE: MAP_FILE,
	Run: Run,
};
