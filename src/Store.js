'use strict';

// Store - the data folder. Plain files, one folder per proposal, whole-file atomic writes,
// and a queue per proposal so two requests never interleave their writes.
//
//   <folder>/consensus.json                   settings
//   <folder>/usage.json                       the LLM's tokens, per day and model
//   <folder>/proposals/<id>/proposal.json     { Id, Title, Kind: 'plan' | 'document' | 'context', State, Created, Updated, Revision }
//   <folder>/proposals/<id>/proposal.md       the text at revision Revision
//   <folder>/proposals/<id>/threads.json      [ thread ]
//   <folder>/proposals/<id>/runs.json         the LLM sessions run on it, the last 20
//   <folder>/proposals/<id>/revisions/0001.md, 0001.json
//   <folder>/proposals/<id>/index.json        search chunks
//   <folder>/projects.json                    { Projects: [ { Id, Name } ] }  every project's name, in display order
//   <folder>/projects/<id>/project.json       { Id, Context, Created, Updated, Version, Items: [ node ] } (see Tree.js)
//                                             Context: the id of the project's context, a proposal of Kind 'context'
//   <folder>/corpora/<id>/corpus.json, corpus.zip, index.json    an uploaded zip, its files and search chunks
//   <folder>/trash/<id>/                      a deleted proposal or corpus, moved whole
//
// Ids are a kind letter and 8 hex digits: p… a plan or document, z… a corpus, j… a project (the Default
// project is 'default'). Older ids carry a slug of the title; bin/consensus.js migrate-ids converts them.

const FS = require( 'fs' );
const PATH = require( 'path' );
const CRYPTO = require( 'crypto' );
const TREE = require( './Tree.js' );

const SETTINGS_FILE = 'consensus.json';
const USAGE_FILE = 'usage.json';
const MASTER_FILE = 'projects.json';
const MASTER_QUEUE = 'projects.json';
const PROPOSALS_FOLDER = 'proposals';
const TRASH_FOLDER = 'trash';
const REVISIONS_FOLDER = 'revisions';
const PROJECTS_FOLDER = 'projects';
const CORPORA_FOLDER = 'corpora';
const DEFAULT_PROJECT = 'default';
const RENAME_ATTEMPTS = 10;
const RENAME_DELAY_MS = 20;
const PROPOSAL_LETTER = 'p';
const CORPUS_LETTER = 'z';
const PROJECT_LETTER = 'j';


//---------------------------------------------------------------------
// Ids: a kind letter and 8 hex digits.

function NewId( Letter )
{
	return Letter + CRYPTO.randomBytes( 4 ).toString( 'hex' );
}


// IsNewId( Id, Letter ): the id already has the form NewId gives.
function IsNewId( Id, Letter )
{
	return new RegExp( '^' + Letter + '[0-9a-f]{8}$' ).test( String( Id ) );
}


//---------------------------------------------------------------------
// Open: a store over a data folder, created if missing.

function Open( Folder )
{
	let folder = PATH.resolve( Folder );
	FS.mkdirSync( PATH.join( folder, PROPOSALS_FOLDER ), { recursive: true } );
	FS.mkdirSync( PATH.join( folder, TRASH_FOLDER ), { recursive: true } );
	FS.mkdirSync( PATH.join( folder, PROJECTS_FOLDER ), { recursive: true } );
	FS.mkdirSync( PATH.join( folder, CORPORA_FOLDER ), { recursive: true } );
	let queues = {};


	//-----------------------------------------------------------------
	// Files

	function proposal_folder( id )
	{
		return PATH.join( folder, PROPOSALS_FOLDER, id );
	}


	async function read_json( file )
	{
		let content = await FS.promises.readFile( file, 'utf8' );
		return JSON.parse( content );
	}


	async function read_json_or_null( file )
	{
		try
		{
			return await read_json( file );
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


	// Whole-file atomic write: to name.tmp, then rename over the target.
	async function write_file( file, content )
	{
		let temporary = file + '.tmp';
		await FS.promises.writeFile( temporary, content, 'utf8' );
		await rename_with_retry( temporary, file );
	}


	// On Windows a rename fails with EPERM, EBUSY or EACCES while another request has the target open
	// for reading; the reader is done within milliseconds, so the rename is tried again a few times.
	async function rename_with_retry( source, target )
	{
		for ( let attempt = 1; ; attempt++ )
		{
			try
			{
				await FS.promises.rename( source, target );
				return;
			}
			catch ( error )
			{
				let locked = ( error.code === 'EPERM' ) || ( error.code === 'EBUSY' ) || ( error.code === 'EACCES' );
				if ( !locked || ( attempt >= RENAME_ATTEMPTS ) )
				{
					throw error;
				}
				await wait( RENAME_DELAY_MS * attempt );
			}
		}
	}


	function wait( milliseconds )
	{
		return new Promise( function ( resolve ) { setTimeout( resolve, milliseconds ); } );
	}


	async function write_json( file, value )
	{
		await write_file( file, JSON.stringify( value, null, '\t' ) + '\n' );
	}


	//-----------------------------------------------------------------
	// Queue: writes to one proposal run one after another.

	function Queue( Id, Work )
	{
		let previous = queues[ Id ] || Promise.resolve();
		let next = previous.then( Work, Work );
		queues[ Id ] = next.then( nothing, nothing );
		return next;
	}


	function nothing()
	{
		return undefined;
	}


	//-----------------------------------------------------------------
	// Settings

	async function ReadSettings()
	{
		return await read_json_or_null( PATH.join( folder, SETTINGS_FILE ) );
	}


	async function WriteSettings( Settings )
	{
		await write_json( PATH.join( folder, SETTINGS_FILE ), Settings );
	}


	function SettingsPath()
	{
		return PATH.join( folder, SETTINGS_FILE );
	}


	//-----------------------------------------------------------------
	// Usage: { Days: { "2026-09-24": { "<model>": { Calls, Input, Output } } } }

	async function ReadUsage()
	{
		let usage = await read_json_or_null( PATH.join( folder, USAGE_FILE ) );
		return usage || { Days: {} };
	}


	async function WriteUsage( Usage )
	{
		await write_json( PATH.join( folder, USAGE_FILE ), Usage );
	}


	//-----------------------------------------------------------------
	// Proposals

	async function ListProposals()
	{
		let ids = await FS.promises.readdir( PATH.join( folder, PROPOSALS_FOLDER ) );
		let proposals = [];
		for ( let id of ids )
		{
			let proposal = await read_json_or_null( PATH.join( proposal_folder( id ), 'proposal.json' ) );
			if ( proposal )
			{
				proposals.push( proposal );
			}
		}
		proposals.sort( by_updated_descending );
		return proposals;
	}


	function by_updated_descending( a, b )
	{
		if ( a.Updated === b.Updated )
		{
			return 0;
		}
		return ( a.Updated < b.Updated ) ? 1 : -1;
	}


	async function ReadProposal( Id )
	{
		let proposal = await read_json_or_null( PATH.join( proposal_folder( Id ), 'proposal.json' ) );
		if ( !proposal )
		{
			return null;
		}
		let text = await FS.promises.readFile( PATH.join( proposal_folder( Id ), 'proposal.md' ), 'utf8' );
		let threads = await read_json_or_null( PATH.join( proposal_folder( Id ), 'threads.json' ) );
		return { Proposal: proposal, Text: text, Threads: threads || [] };
	}


	// Parameters: { Title, Text, By, Kind: 'plan' | 'document' | 'context', State }  Only a plan has a State.
	async function CreateProposal( Parameters )
	{
		let id = unique_id( PROPOSAL_LETTER );
		let now = new Date().toISOString();
		let kind = Parameters.Kind || 'plan';
		let proposal = {
			Id: id,
			Title: Parameters.Title,
			Kind: kind,
			State: ( kind === 'plan' ) ? Parameters.State : null,
			Created: now,
			Updated: now,
			Revision: 1,
		};
		await FS.promises.mkdir( PATH.join( proposal_folder( id ), REVISIONS_FOLDER ), { recursive: true } );
		await write_snapshot( id, 1, Parameters.Text || '', { Revision: 1, By: Parameters.By, At: now, Reason: 'create' } );
		await write_file( PATH.join( proposal_folder( id ), 'proposal.md' ), Parameters.Text || '' );
		await write_json( PATH.join( proposal_folder( id ), 'threads.json' ), [] );
		await write_json( PATH.join( proposal_folder( id ), 'proposal.json' ), proposal );
		return proposal;
	}


	// A new id: Letter and 8 hex digits, used by nothing in the data folder.
	function unique_id( Letter )
	{
		while ( true )
		{
			let id = NewId( Letter );
			let taken = FS.existsSync( proposal_folder( id ) ) || FS.existsSync( corpus_folder( id ) ) || FS.existsSync( PATH.join( folder, TRASH_FOLDER, id ) ) || FS.existsSync( PATH.dirname( project_file( id ) ) );
			if ( !taken )
			{
				return id;
			}
		}
	}


	// Changes to proposal.json other than the text: title, status, approval.
	async function UpdateProposal( Id, Changes )
	{
		let proposal = await read_json_or_null( PATH.join( proposal_folder( Id ), 'proposal.json' ) );
		if ( !proposal )
		{
			return null;
		}
		for ( let key of Object.keys( Changes ) )
		{
			proposal[ key ] = Changes[ key ];
		}
		proposal.Updated = new Date().toISOString();
		await write_json( PATH.join( proposal_folder( Id ), 'proposal.json' ), proposal );
		return proposal;
	}


	// A new revision of the text. Parameters: { Text, By, Reason: 'edit' | 'apply' | 'context', Thread?, Note? }
	// Note: a sentence saying why, kept with the revision (the LLM's reason for a context change).
	async function WriteText( Id, Parameters )
	{
		let proposal = await read_json_or_null( PATH.join( proposal_folder( Id ), 'proposal.json' ) );
		if ( !proposal )
		{
			return null;
		}
		let now = new Date().toISOString();
		let revision = proposal.Revision + 1;
		let record = { Revision: revision, By: Parameters.By, At: now, Reason: Parameters.Reason };
		if ( Parameters.Thread )
		{
			record.Thread = Parameters.Thread;
		}
		if ( Parameters.Note )
		{
			record.Note = Parameters.Note;
		}
		await write_snapshot( Id, revision, Parameters.Text, record );
		await write_file( PATH.join( proposal_folder( Id ), 'proposal.md' ), Parameters.Text );
		proposal.Revision = revision;
		proposal.Updated = now;
		await write_json( PATH.join( proposal_folder( Id ), 'proposal.json' ), proposal );
		return proposal;
	}


	async function write_snapshot( id, revision, text, record )
	{
		let name = String( revision ).padStart( 4, '0' );
		await write_file( PATH.join( proposal_folder( id ), REVISIONS_FOLDER, name + '.md' ), text );
		await write_json( PATH.join( proposal_folder( id ), REVISIONS_FOLDER, name + '.json' ), record );
	}


	async function WriteThreads( Id, Threads )
	{
		await write_json( PATH.join( proposal_folder( Id ), 'threads.json' ), Threads );
	}


	// The LLM sessions run on a proposal, newest last: [ { Id, Started, Destination, Model, Options, Steps, Finished } ]
	async function ReadRuns( Id )
	{
		return ( await read_json_or_null( PATH.join( proposal_folder( Id ), 'runs.json' ) ) ) || [];
	}


	async function WriteRuns( Id, Runs )
	{
		await write_json( PATH.join( proposal_folder( Id ), 'runs.json' ), Runs );
	}


	async function ListRevisions( Id )
	{
		let revisions_folder = PATH.join( proposal_folder( Id ), REVISIONS_FOLDER );
		let names = await FS.promises.readdir( revisions_folder );
		let revisions = [];
		for ( let name of names.sort() )
		{
			if ( name.endsWith( '.json' ) )
			{
				revisions.push( await read_json( PATH.join( revisions_folder, name ) ) );
			}
		}
		return revisions;
	}


	async function ReadRevision( Id, Revision )
	{
		let name = String( Revision ).padStart( 4, '0' );
		let revisions_folder = PATH.join( proposal_folder( Id ), REVISIONS_FOLDER );
		let record = await read_json_or_null( PATH.join( revisions_folder, name + '.json' ) );
		if ( !record )
		{
			return null;
		}
		record.Text = await FS.promises.readFile( PATH.join( revisions_folder, name + '.md' ), 'utf8' );
		return record;
	}


	async function ReadIndex( Id )
	{
		let index = await read_json_or_null( PATH.join( proposal_folder( Id ), 'index.json' ) );
		return index || [];
	}


	async function WriteIndex( Id, Chunks )
	{
		await write_json( PATH.join( proposal_folder( Id ), 'index.json' ), Chunks );
	}


	//-----------------------------------------------------------------
	// Projects: each is one project.json holding its tree; the master projects.json holds every project's name,
	// in display order. The Default project always exists. A project comes back with its Name from the master.

	function project_file( id )
	{
		return PATH.join( folder, PROJECTS_FOLDER, id, 'project.json' );
	}


	function master_file()
	{
		return PATH.join( folder, MASTER_FILE );
	}


	// The project ids that have a project.json.
	async function project_ids()
	{
		let ids = [];
		for ( let id of await FS.promises.readdir( PATH.join( folder, PROJECTS_FOLDER ) ) )
		{
			if ( FS.existsSync( project_file( id ) ) )
			{
				ids.push( id );
			}
		}
		return ids;
	}


	// The master: { Projects: [ { Id, Name } ] }, every project once, in display order. A project the master
	// does not name yet (an older data folder, or one put there by hand) joins at the end, Default first and
	// the rest by name, with the Name its project.json still carries. An entry whose project.json is missing
	// stays (a project being created writes the master first); ListProjects leaves it out.
	async function read_master()
	{
		let master = await read_json_or_null( master_file() );
		let listed = ( master && Array.isArray( master.Projects ) ) ? master.Projects : [];
		let ids = await project_ids();
		let unlisted = [];
		for ( let id of ids )
		{
			if ( !listed.some( function ( entry ) { return entry.Id === id; } ) )
			{
				let project = await read_json_or_null( project_file( id ) );
				unlisted.push( { Id: id, Name: ( project && project.Name ) || id } );
			}
		}
		unlisted.sort( by_default_then_name );
		return { Projects: listed.concat( unlisted ) };
	}


	function by_default_then_name( a, b )
	{
		if ( a.Id === DEFAULT_PROJECT || b.Id === DEFAULT_PROJECT )
		{
			return ( a.Id === DEFAULT_PROJECT ) ? -1 : 1;
		}
		return a.Name.localeCompare( b.Name );
	}


	// Change( master ) edits the master in place; the master's writes run one after another.
	function change_master( Change )
	{
		return Queue( MASTER_QUEUE, async function ()
		{
			let master = await read_master();
			let result = Change( master );
			await write_json( master_file(), master );
			return result;
		} );
	}


	function with_name( project, master )
	{
		let entry = master.Projects.find( function ( candidate ) { return candidate.Id === project.Id; } );
		let name = entry ? entry.Name : ( project.Name || project.Id );
		return Object.assign( {}, project, { Name: name } );
	}


	async function ListProjects()
	{
		let master = await read_master();
		let projects = [];
		for ( let entry of master.Projects )
		{
			let project = await read_json_or_null( project_file( entry.Id ) );
			if ( project )
			{
				projects.push( with_name( project, master ) );
			}
		}
		return projects;
	}


	async function ReadProject( Id )
	{
		if ( !/^[a-z0-9-]+$/.test( String( Id ) ) )
		{
			return null;
		}
		let project = await read_json_or_null( project_file( Id ) );
		if ( !project )
		{
			return null;
		}
		return with_name( project, await read_master() );
	}


	// Parameters: { Name, Id? }  Id only for the Default project. A new project goes to the end of the order,
	// with its context, empty until someone or the LLM writes it.
	async function CreateProject( Parameters )
	{
		let id = Parameters.Id || unique_id( PROJECT_LETTER );
		let now = new Date().toISOString();
		let context = await create_context();
		let project = { Id: id, Context: context.Id, Created: now, Updated: now, Version: 1, Items: [] };
		// The master first: were the folder there first, the master would count it among the unnamed ones.
		await change_master( function ( master )
		{
			let entry = master.Projects.find( function ( candidate ) { return candidate.Id === id; } );
			if ( entry )
			{
				entry.Name = Parameters.Name;
			}
			else
			{
				master.Projects.push( { Id: id, Name: Parameters.Name } );
			}
		} );
		await FS.promises.mkdir( PATH.dirname( project_file( id ) ), { recursive: true } );
		await write_json( project_file( id ), project );
		return Object.assign( {}, project, { Name: Parameters.Name } );
	}


	// A project's context: a proposal of Kind 'context', titled Context, with no text yet.
	async function create_context()
	{
		return await CreateProposal( { Title: 'Context', Text: '', By: 'consensus', Kind: 'context' } );
	}


	// Writes a changed project: its Version goes up by one and Updated is now. Its tree goes to its project.json,
	// its Name to the master. Returns the project as written, with its Name.
	async function WriteProject( Project )
	{
		Project.Version = ( Project.Version || 0 ) + 1;
		Project.Updated = new Date().toISOString();
		let stored = Object.assign( {}, Project );
		delete stored.Name;
		await write_json( project_file( Project.Id ), stored );
		if ( Project.Name )
		{
			await change_master( function ( master )
			{
				let entry = master.Projects.find( function ( candidate ) { return candidate.Id === Project.Id; } );
				if ( entry )
				{
					entry.Name = Project.Name;
				}
				else
				{
					master.Projects.push( { Id: Project.Id, Name: Project.Name } );
				}
			} );
		}
		return Project;
	}


	async function DeleteProject( Id )
	{
		let project_folder = PATH.dirname( project_file( Id ) );
		if ( !FS.existsSync( project_folder ) )
		{
			return false;
		}
		await FS.promises.rm( project_folder, { recursive: true } );
		await change_master( function ( master )
		{
			master.Projects = master.Projects.filter( function ( entry ) { return entry.Id !== Id; } );
		} );
		return true;
	}


	// Moves a project in the display order: before the project Before, or to the end when Before is null.
	// Returns false when either is not a project.
	async function MoveProject( Id, Before )
	{
		return await change_master( function ( master )
		{
			let index = master.Projects.findIndex( function ( entry ) { return entry.Id === Id; } );
			if ( index < 0 || Before === Id )
			{
				return index >= 0;
			}
			if ( Before !== null && !master.Projects.some( function ( entry ) { return entry.Id === Before; } ) )
			{
				return false;
			}
			let moved = master.Projects.splice( index, 1 )[ 0 ];
			let at = ( Before === null ) ? master.Projects.length : master.Projects.findIndex( function ( entry ) { return entry.Id === Before; } );
			master.Projects.splice( at, 0, moved );
			return true;
		} );
	}


	// The project whose tree holds the item Id, or whose context it is, or null.
	async function ProjectOf( Id )
	{
		for ( let project of await ListProjects() )
		{
			if ( project.Context === Id || TREE.Find( project.Items, Id ) )
			{
				return project;
			}
		}
		return null;
	}


	//-----------------------------------------------------------------
	// Corpora: each is an uploaded zip kept whole, with its file list and search chunks.
	//   corpora/<id>/corpus.json  { Id, Kind: 'corpus', Name, Created, Updated, Version, Files: [ { Path, Size, Indexed, Reason? } ] }
	//   corpora/<id>/corpus.zip   the upload, as it came
	//   corpora/<id>/index.json   search chunks

	function corpus_folder( id )
	{
		return PATH.join( folder, CORPORA_FOLDER, id );
	}


	async function ListCorpora()
	{
		let corpora = [];
		for ( let id of await FS.promises.readdir( PATH.join( folder, CORPORA_FOLDER ) ) )
		{
			let corpus = await read_json_or_null( PATH.join( corpus_folder( id ), 'corpus.json' ) );
			if ( corpus )
			{
				corpora.push( corpus );
			}
		}
		return corpora;
	}


	async function ReadCorpus( Id )
	{
		if ( !/^[a-z0-9-]+$/.test( String( Id ) ) )
		{
			return null;
		}
		return await read_json_or_null( PATH.join( corpus_folder( Id ), 'corpus.json' ) );
	}


	async function ReadCorpusZip( Id )
	{
		try
		{
			return await FS.promises.readFile( PATH.join( corpus_folder( Id ), 'corpus.zip' ) );
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


	// Parameters: { Name, Zip, Files }
	async function CreateCorpus( Parameters )
	{
		let id = unique_id( CORPUS_LETTER );
		let now = new Date().toISOString();
		let corpus = { Id: id, Kind: 'corpus', Name: Parameters.Name, Created: now, Updated: now, Version: 1, Files: Parameters.Files };
		await FS.promises.mkdir( corpus_folder( id ), { recursive: true } );
		await write_file( PATH.join( corpus_folder( id ), 'corpus.zip' ), Parameters.Zip );
		await write_json( PATH.join( corpus_folder( id ), 'corpus.json' ), corpus );
		return corpus;
	}


	// A new zip over an existing corpus: Parameters = { Zip, Files }. Returns the corpus, or null.
	async function ReplaceCorpus( Id, Parameters )
	{
		let corpus = await ReadCorpus( Id );
		if ( !corpus )
		{
			return null;
		}
		await write_file( PATH.join( corpus_folder( Id ), 'corpus.zip' ), Parameters.Zip );
		corpus.Files = Parameters.Files;
		corpus.Version += 1;
		corpus.Updated = new Date().toISOString();
		await write_json( PATH.join( corpus_folder( Id ), 'corpus.json' ), corpus );
		return corpus;
	}


	async function RenameCorpus( Id, Name )
	{
		let corpus = await ReadCorpus( Id );
		if ( !corpus )
		{
			return null;
		}
		corpus.Name = Name;
		corpus.Updated = new Date().toISOString();
		await write_json( PATH.join( corpus_folder( Id ), 'corpus.json' ), corpus );
		return corpus;
	}


	async function ReadCorpusIndex( Id )
	{
		return ( await read_json_or_null( PATH.join( corpus_folder( Id ), 'index.json' ) ) ) || [];
	}


	async function WriteCorpusIndex( Id, Chunks )
	{
		await write_json( PATH.join( corpus_folder( Id ), 'index.json' ), Chunks );
	}


	// A whole copy under a new id, named "<name> (copy)"; its index is rebuilt by the caller. Returns it, or null.
	async function CopyCorpus( Id )
	{
		let source = await ReadCorpus( Id );
		if ( !source )
		{
			return null;
		}
		let name = source.Name + ' (copy)';
		let id = unique_id( CORPUS_LETTER );
		await FS.promises.cp( corpus_folder( Id ), corpus_folder( id ), { recursive: true } );
		await FS.promises.rm( PATH.join( corpus_folder( id ), 'index.json' ), { force: true } );
		let now = new Date().toISOString();
		let corpus = Object.assign( {}, source, { Id: id, Name: name, Created: now, Updated: now } );
		await write_json( PATH.join( corpus_folder( id ), 'corpus.json' ), corpus );
		return corpus;
	}


	async function TrashCorpus( Id )
	{
		let source = corpus_folder( Id );
		if ( !await ReadCorpus( Id ) )
		{
			return false;
		}
		await FS.promises.rename( source, PATH.join( folder, TRASH_FOLDER, Id ) );
		return true;
	}


	// A copy of a proposal, whole: text, threads and revisions, under a new id, titled "<title> (copy)".
	// Its index is rebuilt by the caller (the chunks carry the proposal's id). Returns the new proposal, or null.
	async function CopyProposal( Id )
	{
		let source = await read_json_or_null( PATH.join( proposal_folder( Id ), 'proposal.json' ) );
		if ( !source )
		{
			return null;
		}
		let title = source.Title + ' (copy)';
		let id = unique_id( PROPOSAL_LETTER );
		await FS.promises.cp( proposal_folder( Id ), proposal_folder( id ), { recursive: true } );
		await FS.promises.rm( PATH.join( proposal_folder( id ), 'index.json' ), { force: true } );
		let now = new Date().toISOString();
		let proposal = Object.assign( {}, source, { Id: id, Title: title, Created: now, Updated: now } );
		await write_json( PATH.join( proposal_folder( id ), 'proposal.json' ), proposal );
		return proposal;
	}


	//-----------------------------------------------------------------
	// Trash

	async function TrashProposal( Id )
	{
		let source = proposal_folder( Id );
		if ( !FS.existsSync( source ) )
		{
			return false;
		}
		await FS.promises.rename( source, PATH.join( folder, TRASH_FOLDER, Id ) );
		return true;
	}


	async function ListTrash()
	{
		let ids = await FS.promises.readdir( PATH.join( folder, TRASH_FOLDER ) );
		let proposals = [];
		for ( let id of ids )
		{
			let proposal = await read_json_or_null( PATH.join( folder, TRASH_FOLDER, id, 'proposal.json' ) );
			if ( proposal )
			{
				proposals.push( proposal );
				continue;
			}
			let corpus = await read_json_or_null( PATH.join( folder, TRASH_FOLDER, id, 'corpus.json' ) );
			if ( corpus )
			{
				proposals.push( { Id: corpus.Id, Kind: 'corpus', Title: corpus.Name, Updated: corpus.Updated } );
			}
		}
		proposals.sort( by_updated_descending );
		return proposals;
	}


	//-----------------------------------------------------------------
	// Migrate: brings an older data folder up to date, in the proposals and in the trash. Run once at start;
	// running it again changes nothing. Returns a line for each proposal it changed.
	//   proposal: Status and Approved become State (an approved one is a Plan, any other a Proposal); no Kind is a plan
	//   thread:   Status 'consensus' becomes 'resolved'
	//   projects: the Default project exists, holds every proposal no project holds, and no tree names a proposal that is gone
	//   contexts: every project has its context

	async function Migrate( States )
	{
		let plan_state = States.includes( 'Plan' ) ? 'Plan' : States[ 0 ];
		let lines = [];
		for ( let parent of [ PROPOSALS_FOLDER, TRASH_FOLDER ] )
		{
			for ( let id of await FS.promises.readdir( PATH.join( folder, parent ) ) )
			{
				let one = PATH.join( folder, parent, id );
				let proposal = await read_json_or_null( PATH.join( one, 'proposal.json' ) );
				if ( !proposal )
				{
					continue;
				}
				let changes = [];
				if ( proposal.State === undefined )
				{
					let approved = ( proposal.Status === 'consensus' );
					proposal.State = approved ? plan_state : States[ 0 ];
					delete proposal.Status;
					delete proposal.Approved;
					changes.push( 'state ' + proposal.State );
				}
				if ( proposal.Kind === undefined )
				{
					proposal.Kind = 'plan';
					changes.push( 'kind plan' );
				}
				if ( changes.length )
				{
					await write_json( PATH.join( one, 'proposal.json' ), proposal );
				}
				let threads = await read_json_or_null( PATH.join( one, 'threads.json' ) );
				let renamed = 0;
				for ( let thread of threads || [] )
				{
					if ( thread.Status === 'consensus' )
					{
						thread.Status = 'resolved';
						renamed++;
					}
				}
				if ( renamed )
				{
					await write_json( PATH.join( one, 'threads.json' ), threads );
					changes.push( renamed + ' thread' + ( renamed === 1 ? '' : 's' ) + ' resolved' );
				}
				if ( changes.length )
				{
					lines.push( parent + '/' + id + ': ' + changes.join( ', ' ) );
				}
			}
		}
		for ( let line of await place_in_projects() )
		{
			lines.push( line );
		}
		return lines;
	}


	// The Default project exists; every proposal no project holds goes to its root; a node whose proposal is
	// gone (deleted or moved by hand) leaves its tree.
	async function place_in_projects()
	{
		let lines = [];
		if ( !await ReadProject( DEFAULT_PROJECT ) )
		{
			await CreateProject( { Id: DEFAULT_PROJECT, Name: 'Default' } );
			lines.push( 'projects/' + DEFAULT_PROJECT + ': created' );
		}
		for ( let project of await ListProjects() )
		{
			let context = project.Context ? await read_json_or_null( PATH.join( proposal_folder( project.Context ), 'proposal.json' ) ) : null;
			if ( !context )
			{
				project.Context = ( await create_context() ).Id;
				await WriteProject( project );
				lines.push( 'projects/' + project.Id + ': context ' + project.Context + ' created' );
			}
		}
		let kinds = {};
		for ( let proposal of await ListProposals() )
		{
			// a context belongs to its project, never to a tree
			if ( proposal.Kind !== 'context' )
			{
				kinds[ proposal.Id ] = proposal.Kind || 'plan';
			}
		}
		for ( let corpus of await ListCorpora() )
		{
			kinds[ corpus.Id ] = 'corpus';
		}
		let present = new Set( Object.keys( kinds ) );
		let held = new Set();
		for ( let project of await ListProjects() )
		{
			let gone = [];
			for ( let id of TREE.ItemIds( project.Items ) )
			{
				let node = TREE.Find( project.Items, id ).Node;
				if ( !present.has( id ) )
				{
					gone.push( id );
				}
				else
				{
					held.add( id );
				}
			}
			if ( gone.length )
			{
				for ( let id of gone )
				{
					TREE.Remove( project.Items, id );
				}
				await WriteProject( project );
				lines.push( 'projects/' + project.Id + ': dropped ' + gone.join( ', ' ) + ', no longer in the data folder' );
			}
		}
		let orphans = Array.from( present ).filter( function ( id ) { return !held.has( id ); } );
		if ( orphans.length )
		{
			let default_project = await ReadProject( DEFAULT_PROJECT );
			for ( let id of orphans.sort() )
			{
				TREE.Insert( default_project.Items, null, { Kind: kinds[ id ], Id: id } );
			}
			await WriteProject( default_project );
			lines.push( 'projects/' + DEFAULT_PROJECT + ': placed ' + orphans.join( ', ' ) );
		}
		return lines;
	}


	//-----------------------------------------------------------------

	return {
		Folder: folder,
		Queue: Queue,
		ReadSettings: ReadSettings,
		WriteSettings: WriteSettings,
		SettingsPath: SettingsPath,
		ReadUsage: ReadUsage,
		WriteUsage: WriteUsage,
		ListProposals: ListProposals,
		ReadProposal: ReadProposal,
		CreateProposal: CreateProposal,
		UpdateProposal: UpdateProposal,
		WriteText: WriteText,
		WriteThreads: WriteThreads,
		ReadRuns: ReadRuns,
		WriteRuns: WriteRuns,
		ListRevisions: ListRevisions,
		ReadRevision: ReadRevision,
		ReadIndex: ReadIndex,
		WriteIndex: WriteIndex,
		ListProjects: ListProjects,
		ReadProject: ReadProject,
		CreateProject: CreateProject,
		WriteProject: WriteProject,
		DeleteProject: DeleteProject,
		MoveProject: MoveProject,
		ProjectOf: ProjectOf,
		CopyProposal: CopyProposal,
		ListCorpora: ListCorpora,
		ReadCorpus: ReadCorpus,
		ReadCorpusZip: ReadCorpusZip,
		CreateCorpus: CreateCorpus,
		ReplaceCorpus: ReplaceCorpus,
		RenameCorpus: RenameCorpus,
		ReadCorpusIndex: ReadCorpusIndex,
		WriteCorpusIndex: WriteCorpusIndex,
		CopyCorpus: CopyCorpus,
		TrashCorpus: TrashCorpus,
		TrashProposal: TrashProposal,
		ListTrash: ListTrash,
		Migrate: Migrate,
	};
}


module.exports = {
	Open: Open,
	DEFAULT_PROJECT: DEFAULT_PROJECT,
	PROPOSAL_LETTER: PROPOSAL_LETTER,
	CORPUS_LETTER: CORPUS_LETTER,
	PROJECT_LETTER: PROJECT_LETTER,
	MASTER_FILE: MASTER_FILE,
	NewId: NewId,
	IsNewId: IsNewId,
};
