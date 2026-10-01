'use strict';

// Store - the data folder. Plain files, one folder per proposal, whole-file atomic writes,
// and a queue per proposal so two requests never interleave their writes.
//
//   <folder>/consensus.json                   settings
//   <folder>/proposals/<id>/proposal.json     { Id, Title, Kind: 'plan' | 'document', State, Created, Updated, Revision,
//                                             Head }  Head: the Id of the revision at Revision
//   <folder>/proposals/<id>/proposal.md       the text at revision Revision
//   <folder>/proposals/<id>/threads.json      [ thread ]
//   <folder>/proposals/<id>/revisions/0001.md, 0001.json    the text, and { Id, Parent, Merged?, Revision, By, At, Reason,
//                                             Thread?, Note? }  Parent: the Id of the revision the text was made from
//   <folder>/projects.json                    { Projects: [ { Id, Name } ] }  every project's name, in display order
//   <folder>/projects/<id>/project.json       { Id, Context, ContextFolder, Created, Updated, Version, Items: [ node ] }
//                                             (see Tree.js)  Context: the id of the project's Readme;
//                                             ContextFolder: the id of the Context folder that holds it, first in Items
//   <folder>/trash/<id>/                      a deleted proposal, moved whole (or a corpus from before Step 1)
//
// Ids are global (Ids.js): pln-…, doc-… a proposal (ctx-… a Readme made before plan Consensus Desktop),
// prj-… a project (the Default project is 'default'), fld-… a folder, rev-… a revision.
//
// Prepare, at start, also migrates a data folder from before plan Consensus Desktop, Step 1: each project's context
// proposal becomes its Readme in a new Context folder (a Readme still titled Context is renamed), corpora go to the
// trash, and the LLM's files (usage.json, runs.json, index.json) are removed.

const FS = require( 'fs' );
const PATH = require( 'path' );
const TREE = require( './Tree.js' );
const IDS = require( './Ids.js' );

const SETTINGS_FILE = 'consensus.json';
const MASTER_FILE = 'projects.json';
const MASTER_QUEUE = 'projects.json';
const PROPOSALS_FOLDER = 'proposals';
const TRASH_FOLDER = 'trash';
const REVISIONS_FOLDER = 'revisions';
const PROJECTS_FOLDER = 'projects';
const CORPORA_FOLDER = 'corpora';
const DEFAULT_PROJECT = 'default';
const CONTEXT_FOLDER_NAME = 'Context';
const CONTEXT_TITLE = 'Readme';
const OLD_CONTEXT_TITLE = 'Context';
const RETIRED_FILES = [ 'usage.json' ];
const RETIRED_PROPOSAL_FILES = [ 'runs.json', 'index.json' ];
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


	// Parameters: { Title, Text, By, Kind: 'plan' | 'document', State }  Only a plan has a State.
	async function CreateProposal( Parameters )
	{
		let kind = Parameters.Kind || 'plan';
		let id = unique_id( IDS.ForProposal( kind ) );
		let now = new Date().toISOString();
		let head = IDS.New( IDS.REVISION );
		let proposal = {
			Id: id,
			Title: Parameters.Title,
			Kind: kind,
			State: ( kind === 'plan' ) ? Parameters.State : null,
			Created: now,
			Updated: now,
			Revision: 1,
			Head: head,
		};
		await FS.promises.mkdir( PATH.join( proposal_folder( id ), REVISIONS_FOLDER ), { recursive: true } );
		await write_snapshot( id, 1, Parameters.Text || '', { Id: head, Parent: null, Revision: 1, By: Parameters.By, At: now, Reason: 'create' } );
		await write_file( PATH.join( proposal_folder( id ), 'proposal.md' ), Parameters.Text || '' );
		await write_json( PATH.join( proposal_folder( id ), 'threads.json' ), [] );
		await write_json( PATH.join( proposal_folder( id ), 'proposal.json' ), proposal );
		return proposal;
	}


	// A new global id of Kind, used by nothing in the data folder.
	function unique_id( Kind )
	{
		while ( true )
		{
			let id = IDS.New( Kind );
			let taken = FS.existsSync( proposal_folder( id ) ) || FS.existsSync( PATH.join( folder, TRASH_FOLDER, id ) ) || FS.existsSync( PATH.dirname( project_file( id ) ) );
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


	// A new revision of the text. Parameters: { Text, By, Reason: 'edit' | 'apply', Thread?, Note? }
	// Note: a sentence saying why, kept with the revision.
	async function WriteText( Id, Parameters )
	{
		let proposal = await read_json_or_null( PATH.join( proposal_folder( Id ), 'proposal.json' ) );
		if ( !proposal )
		{
			return null;
		}
		let now = new Date().toISOString();
		let revision = proposal.Revision + 1;
		let record = { Id: IDS.New( IDS.REVISION ), Parent: proposal.Head || null, Revision: revision, By: Parameters.By, At: now, Reason: Parameters.Reason };
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
		proposal.Head = record.Id;
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


	// A proposal whole, as an import brings it, under its own Id: Whole = { Proposal, Text, Threads, Revisions:
	// [ { Revision, By, At, Reason, Thread?, Note?, Text } ] }. The folder is made when missing; what is there is
	// written over.
	async function WriteWholeProposal( Whole )
	{
		let id = Whole.Proposal.Id;
		await FS.promises.mkdir( PATH.join( proposal_folder( id ), REVISIONS_FOLDER ), { recursive: true } );
		for ( let revision of Whole.Revisions )
		{
			let record = Object.assign( {}, revision );
			delete record.Text;
			await write_snapshot( id, revision.Revision, revision.Text, record );
		}
		await write_file( PATH.join( proposal_folder( id ), 'proposal.md' ), Whole.Text );
		await write_json( PATH.join( proposal_folder( id ), 'threads.json' ), Whole.Threads );
		await write_json( PATH.join( proposal_folder( id ), 'proposal.json' ), Whole.Proposal );
		return Whole.Proposal;
	}


	// A copy of a proposal, whole: text, threads and revisions, under a new id, titled "<title> (copy)".
	// Returns the new proposal, or null.
	async function CopyProposal( Id )
	{
		let source = await read_json_or_null( PATH.join( proposal_folder( Id ), 'proposal.json' ) );
		if ( !source )
		{
			return null;
		}
		let title = source.Title + ' (copy)';
		let id = unique_id( IDS.ForProposal( source.Kind ) );
		await FS.promises.cp( proposal_folder( Id ), proposal_folder( id ), { recursive: true } );
		let now = new Date().toISOString();
		let proposal = Object.assign( {}, source, { Id: id, Title: title, Created: now, Updated: now } );
		await write_json( PATH.join( proposal_folder( id ), 'proposal.json' ), proposal );
		return proposal;
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


	// Parameters: { Name, Id?, Context?, ContextFolder?, Items? }  Id for the Default project, or an imported one. A new
	// project goes to the end of the order, with its Readme (empty until someone writes it) in its Context
	// folder, first in its tree; an imported one brings its Context (the id of a document already written), its
	// ContextFolder and its Items, and gets the folder made when the tree lacks it.
	async function CreateProject( Parameters )
	{
		let id = Parameters.Id || unique_id( IDS.PROJECT );
		let now = new Date().toISOString();
		let context_id = Parameters.Context || ( await create_context() ).Id;
		let items = Parameters.Items || [];
		let context_folder = ensure_context_folder( items, context_id, Parameters.ContextFolder );
		let project = { Id: id, Context: context_id, ContextFolder: context_folder, Created: now, Updated: now, Version: 1, Items: items };
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


	// A project's Readme: a document titled Readme, in its Context folder, with no text yet.
	async function create_context()
	{
		return await CreateProposal( { Title: CONTEXT_TITLE, Text: '', By: 'consensus', Kind: 'document' } );
	}


	// The Context folder in Items, first, holding the Readme: the one named by ContextFolder when the tree
	// has it (an import), else a new one, with the document moved into it from wherever the tree had it. Returns the
	// folder's id.
	function ensure_context_folder( items, context_id, context_folder )
	{
		let found = context_folder ? TREE.Find( items, context_folder ) : null;
		let folder_node = ( found && found.Node.Kind === 'folder' ) ? found.Node : null;
		if ( !folder_node )
		{
			folder_node = { Kind: 'folder', Id: IDS.New( IDS.FOLDER ), Name: CONTEXT_FOLDER_NAME, Items: [] };
			items.unshift( folder_node );
		}
		else if ( items[ 0 ] !== folder_node )
		{
			TREE.Remove( items, folder_node.Id );
			items.unshift( folder_node );
		}
		let document = TREE.Find( items, context_id );
		if ( document && document.Siblings !== folder_node.Items )
		{
			TREE.Remove( items, context_id );
			document = null;
		}
		if ( !document )
		{
			folder_node.Items.unshift( { Kind: 'document', Id: context_id } );
		}
		// Any other document outside the folder (an older tree, or an import from before) goes in after it.
		for ( let id of TREE.ItemIds( items ) )
		{
			let found = TREE.Find( items, id );
			if ( found && found.Node.Kind === 'document' && found.Siblings !== folder_node.Items )
			{
				TREE.Remove( items, id );
				folder_node.Items.push( found.Node );
			}
		}
		return folder_node.Id;
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


	// The project whose tree holds the item Id, or whose Readme it is, or null.
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
	// Prepare: a new data folder gets its Default project (with its Context folder and document), and a data folder
	// from before plan Consensus Desktop is migrated (below). Run at start. Returns a line for each thing it did.

	async function Prepare()
	{
		let lines = [];
		if ( !await ReadProject( DEFAULT_PROJECT ) )
		{
			await CreateProject( { Id: DEFAULT_PROJECT, Name: 'Default' } );
			lines.push( 'projects/' + DEFAULT_PROJECT + ': created' );
		}
		return lines.concat( await migrate() );
	}


	// Migrate: each project without a ContextFolder gets one, first in its tree, holding its Readme (the
	// context proposal, now of Kind document); corpus nodes leave the tree and their folders go to the trash. The
	// LLM's files are removed. Nothing happens to a project that has its Context folder already.
	async function migrate()
	{
		let lines = [];
		for ( let project of await ListProjects() )
		{
			if ( project.ContextFolder )
			{
				continue;
			}
			let stored = await read_json_or_null( project_file( project.Id ) );
			if ( !stored )
			{
				continue;
			}
			if ( !stored.Context || !await read_json_or_null( PATH.join( proposal_folder( stored.Context ), 'proposal.json' ) ) )
			{
				stored.Context = ( await create_context() ).Id;
				lines.push( 'projects/' + project.Id + ': a new Readme, ' + stored.Context );
			}
			let context = await read_json_or_null( PATH.join( proposal_folder( stored.Context ), 'proposal.json' ) );
			if ( context.Kind !== 'document' )
			{
				context.Kind = 'document';
				context.State = null;
				await write_json( PATH.join( proposal_folder( stored.Context ), 'proposal.json' ), context );
			}
			let corpora = strip_corpora( stored.Items );
			for ( let id of corpora )
			{
				let home = PATH.join( PATH.dirname( project_file( project.Id ) ), CORPORA_FOLDER, id );
				if ( FS.existsSync( home ) )
				{
					await rename_with_retry( home, PATH.join( folder, TRASH_FOLDER, id ) );
				}
			}
			stored.ContextFolder = ensure_context_folder( stored.Items, stored.Context );
			delete stored.Workspace;
			await write_json( project_file( project.Id ), stored );
			lines.push( 'projects/' + project.Id + ': the Context folder made, ' + stored.ContextFolder + ( corpora.length ? ', ' + corpora.length + ' corpora to the trash' : '' ) );
		}
		// A Readme still titled Context (from before the thread that renamed it, on plan Consensus Desktop, Step 2).
		for ( let project of await ListProjects() )
		{
			let context = project.Context ? await read_json_or_null( PATH.join( proposal_folder( project.Context ), 'proposal.json' ) ) : null;
			if ( context && context.Title === OLD_CONTEXT_TITLE )
			{
				context.Title = CONTEXT_TITLE;
				context.Updated = new Date().toISOString();
				await write_json( PATH.join( proposal_folder( project.Context ), 'proposal.json' ), context );
				lines.push( 'projects/' + project.Id + ': the Context document renamed Readme' );
			}
		}
		for ( let name of RETIRED_FILES )
		{
			let file = PATH.join( folder, name );
			if ( FS.existsSync( file ) )
			{
				await FS.promises.rm( file, { force: true } );
				lines.push( name + ': removed' );
			}
		}
		let removed = 0;
		for ( let id of await FS.promises.readdir( PATH.join( folder, PROPOSALS_FOLDER ) ) )
		{
			for ( let name of RETIRED_PROPOSAL_FILES )
			{
				let file = PATH.join( proposal_folder( id ), name );
				if ( FS.existsSync( file ) )
				{
					await FS.promises.rm( file, { force: true } );
					removed++;
				}
			}
		}
		if ( removed )
		{
			lines.push( 'proposals: ' + removed + ' runs.json and index.json files removed' );
		}
		return lines;
	}


	// Takes every corpus node out of the tree, at any depth, and returns their ids.
	function strip_corpora( items )
	{
		let ids = [];
		for ( let index = items.length - 1; index >= 0; index-- )
		{
			let node = items[ index ];
			if ( node.Kind === 'corpus' )
			{
				ids.push( node.Id );
				items.splice( index, 1 );
				continue;
			}
			if ( Array.isArray( node.Items ) )
			{
				ids = ids.concat( strip_corpora( node.Items ) );
			}
		}
		return ids;
	}


	//-----------------------------------------------------------------

	return {
		Folder: folder,
		Queue: Queue,
		ReadSettings: ReadSettings,
		WriteSettings: WriteSettings,
		SettingsPath: SettingsPath,
		ListProposals: ListProposals,
		ReadProposal: ReadProposal,
		CreateProposal: CreateProposal,
		UpdateProposal: UpdateProposal,
		WriteText: WriteText,
		WriteThreads: WriteThreads,
		ListRevisions: ListRevisions,
		ReadRevision: ReadRevision,
		WriteWholeProposal: WriteWholeProposal,
		ListProjects: ListProjects,
		ReadProject: ReadProject,
		CreateProject: CreateProject,
		WriteProject: WriteProject,
		DeleteProject: DeleteProject,
		MoveProject: MoveProject,
		ProjectOf: ProjectOf,
		CopyProposal: CopyProposal,
		TrashProposal: TrashProposal,
		ListTrash: ListTrash,
		Prepare: Prepare,
	};
}


module.exports = {
	Open: Open,
	DEFAULT_PROJECT: DEFAULT_PROJECT,
	MASTER_FILE: MASTER_FILE,
	CONTEXT_FOLDER_NAME: CONTEXT_FOLDER_NAME,
	CONTEXT_TITLE: CONTEXT_TITLE,
};
