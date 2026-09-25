'use strict';

// Store - the data folder. Plain files, one folder per proposal, whole-file atomic writes,
// and a queue per proposal so two requests never interleave their writes.
//
//   <folder>/consensus.json                   settings
//   <folder>/usage.json                       the LLM's tokens, per day and model
//   <folder>/proposals/<id>/proposal.json     { Id, Title, Kind: 'plan' | 'document', State, Created, Updated, Revision }
//   <folder>/proposals/<id>/proposal.md       the text at revision Revision
//   <folder>/proposals/<id>/threads.json      [ thread ]
//   <folder>/proposals/<id>/revisions/0001.md, 0001.json
//   <folder>/proposals/<id>/index.json        search chunks
//   <folder>/projects/<id>/project.json       { Id, Name, Created, Updated, Version, Items: [ node ] } (see Tree.js)
//   <folder>/corpora/<id>/corpus.json, corpus.zip, index.json    an uploaded zip, its files and search chunks
//   <folder>/trash/<id>/                      a deleted proposal or corpus, moved whole

const FS = require( 'fs' );
const PATH = require( 'path' );
const CRYPTO = require( 'crypto' );
const TREE = require( './Tree.js' );

const SETTINGS_FILE = 'consensus.json';
const USAGE_FILE = 'usage.json';
const PROPOSALS_FOLDER = 'proposals';
const TRASH_FOLDER = 'trash';
const REVISIONS_FOLDER = 'revisions';
const PROJECTS_FOLDER = 'projects';
const CORPORA_FOLDER = 'corpora';
const DEFAULT_PROJECT = 'default';
const RENAME_ATTEMPTS = 10;
const RENAME_DELAY_MS = 20;


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


	// Parameters: { Title, Text, By, Kind: 'plan' | 'document', State }  A document has no State.
	async function CreateProposal( Parameters )
	{
		let id = await unique_id( Parameters.Title );
		let now = new Date().toISOString();
		let kind = Parameters.Kind || 'plan';
		let proposal = {
			Id: id,
			Title: Parameters.Title,
			Kind: kind,
			State: ( kind === 'document' ) ? null : Parameters.State,
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


	async function unique_id( title )
	{
		let slug = String( title || 'proposal' ).toLowerCase().replace( /[^a-z0-9]+/g, '-' ).replace( /^-+|-+$/g, '' ).slice( 0, 48 );
		if ( !slug )
		{
			slug = 'proposal';
		}
		while ( true )
		{
			let id = slug + '-' + CRYPTO.randomBytes( 3 ).toString( 'hex' );
			let exists = FS.existsSync( proposal_folder( id ) ) || FS.existsSync( PATH.join( folder, TRASH_FOLDER, id ) );
			if ( !exists )
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


	// A new revision of the text. Parameters: { Text, By, Reason: 'edit' | 'apply', Thread? }
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
	// Projects: each is one project.json holding its tree. The Default project always exists.

	function project_file( id )
	{
		return PATH.join( folder, PROJECTS_FOLDER, id, 'project.json' );
	}


	async function ListProjects()
	{
		let ids = await FS.promises.readdir( PATH.join( folder, PROJECTS_FOLDER ) );
		let projects = [];
		for ( let id of ids )
		{
			let project = await read_json_or_null( project_file( id ) );
			if ( project )
			{
				projects.push( project );
			}
		}
		projects.sort( by_default_then_name );
		return projects;
	}


	function by_default_then_name( a, b )
	{
		if ( a.Id === DEFAULT_PROJECT || b.Id === DEFAULT_PROJECT )
		{
			return ( a.Id === DEFAULT_PROJECT ) ? -1 : 1;
		}
		return a.Name.localeCompare( b.Name );
	}


	async function ReadProject( Id )
	{
		if ( !/^[a-z0-9-]+$/.test( String( Id ) ) )
		{
			return null;
		}
		return await read_json_or_null( project_file( Id ) );
	}


	// Parameters: { Name, Id? }  Id only for the Default project.
	async function CreateProject( Parameters )
	{
		let id = Parameters.Id || await unique_project_id( Parameters.Name );
		let now = new Date().toISOString();
		let project = { Id: id, Name: Parameters.Name, Created: now, Updated: now, Version: 1, Items: [] };
		await FS.promises.mkdir( PATH.dirname( project_file( id ) ), { recursive: true } );
		await write_json( project_file( id ), project );
		return project;
	}


	async function unique_project_id( name )
	{
		let slug = String( name || 'project' ).toLowerCase().replace( /[^a-z0-9]+/g, '-' ).replace( /^-+|-+$/g, '' ).slice( 0, 48 );
		if ( !slug )
		{
			slug = 'project';
		}
		while ( true )
		{
			let id = slug + '-' + CRYPTO.randomBytes( 3 ).toString( 'hex' );
			if ( !FS.existsSync( PATH.dirname( project_file( id ) ) ) )
			{
				return id;
			}
		}
	}


	// Writes a changed project: its Version goes up by one and Updated is now. Returns the project as written.
	async function WriteProject( Project )
	{
		Project.Version = ( Project.Version || 0 ) + 1;
		Project.Updated = new Date().toISOString();
		await write_json( project_file( Project.Id ), Project );
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
		return true;
	}


	// The project whose tree holds the item Id, or null.
	async function ProjectOf( Id )
	{
		for ( let project of await ListProjects() )
		{
			if ( TREE.Find( project.Items, Id ) )
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
		let id = await unique_corpus_id( Parameters.Name );
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
		let id = await unique_corpus_id( name );
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


	async function unique_corpus_id( name )
	{
		let slug = String( name || 'corpus' ).toLowerCase().replace( /[^a-z0-9]+/g, '-' ).replace( /^-+|-+$/g, '' ).slice( 0, 48 ) || 'corpus';
		while ( true )
		{
			let id = slug + '-' + CRYPTO.randomBytes( 3 ).toString( 'hex' );
			let taken = FS.existsSync( corpus_folder( id ) ) || FS.existsSync( proposal_folder( id ) ) || FS.existsSync( PATH.join( folder, TRASH_FOLDER, id ) );
			if ( !taken )
			{
				return id;
			}
		}
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
		let id = await unique_id( title );
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
		let kinds = {};
		for ( let proposal of await ListProposals() )
		{
			kinds[ proposal.Id ] = proposal.Kind || 'plan';
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
		ListRevisions: ListRevisions,
		ReadRevision: ReadRevision,
		ReadIndex: ReadIndex,
		WriteIndex: WriteIndex,
		ListProjects: ListProjects,
		ReadProject: ReadProject,
		CreateProject: CreateProject,
		WriteProject: WriteProject,
		DeleteProject: DeleteProject,
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
};
