'use strict';

// Store - the config folder and the project folders (plan Run Shapes, Step 2). Plain files, whole-file atomic writes,
// and a queue per plan so two requests never interleave their writes. The config folder holds the settings; each
// project is a folder of its own (a repository, as a rule) with a .consensus sub-folder that is the project:
//
//   <config>/consensus.json                            settings; its Projects: [ { Path } ] lists the project folders, in display order
//   <project>/.consensus/project.json                  { Id, Name, Context, ContextFolder, Created, Updated, Version, Items: [ node ],
//                                                      Archive: [ node ], States, Include, Exclude, Commands }  (see Tree.js)
//                                                      Context: the id of the project's Readme; ContextFolder: the id of the Context
//                                                      folder that holds it, first in Items; Archive: the archived plans, whole
//   <project>/.consensus/content/<id>/content.json     { Id, Title, Kind: 'plan' | 'document', State, Created, Updated, Revision, Head }
//   <project>/.consensus/content/<id>/content.md       the text at revision Revision
//   <project>/.consensus/content/<id>/threads.json     [ thread ]
//   <project>/.consensus/content/<id>/revisions/0001.md, 0001.json    the text, and { Id, Parent, Merged?, Revision, By, At, Reason, Thread?, Note? }
//   <project>/.consensus/archive/<id>/                 an archived item, moved whole; read, never written, until restored
//   <project>/.consensus/trash/<id>/                   a deleted item, moved whole
//
// Ids are global (Ids.js): pln-…, doc-… a plan (ctx-… a Readme made before plan Consensus Desktop), prj-… a project,
// fld-… a folder, rev-… a revision. Every project has a prj- id: the Default project's id "default" ended with Step 2.
//
// Prepare, at start, migrates a config folder from before Step 2 (projects.json, projects/<id>/project.json, proposals/<id>/,
// trash/, all in the config folder) into a folder per project under <config>/projects/<name>/, and a data folder from
// before plan Consensus Desktop, Step 1, on the way (each project's context plan becomes its Readme in a Context
// folder, corpora go to the trash, the LLM's files are removed). A project folder the settings list and the disk lacks
// is skipped, with a line, and kept in the list (Missing). Prepare with { Project: path } (plan Run Shapes, Step 4:
// `consensus <path>`) registers that folder's project alone, making its .consensus when missing, and puts it first in
// the list (Isolated gives its id).

const FS = require( 'fs' );
const PATH = require( 'path' );
const TREE = require( './Tree.js' );
const IDS = require( './Ids.js' );

const SETTINGS_FILE = 'consensus.json';
const HOME_FOLDER = '.consensus';
const PROJECT_FILE = 'project.json';
const CONTENT_FOLDER = 'content';
const ARCHIVE_FOLDER = 'archive';
const TRASH_FOLDER = 'trash';
const REVISIONS_FOLDER = 'revisions';
const PROJECTS_FOLDER = 'projects';
const DEFAULT_PROJECT_NAME = 'Default';
const CONTEXT_FOLDER_NAME = 'Context';
const CONTEXT_TITLE = 'Readme';
const OLD_CONTEXT_TITLE = 'Context';
const DEFAULT_STATES = [ 'Draft', 'Plan', 'Working', 'Finished' ];
const DEFAULT_EXCLUDE = [ '~*/**', 'node_modules/**', '.git/**' ];
const RENAME_ATTEMPTS = 10;
const RENAME_DELAY_MS = 20;

// The layout before Step 2, inside the config folder.
const OLD_MASTER_FILE = 'projects.json';
const OLD_PROPOSALS_FOLDER = 'proposals';
const OLD_CORPORA_FOLDER = 'corpora';
const OLD_RETIRED_FILES = [ 'usage.json' ];
const OLD_RETIRED_PROPOSAL_FILES = [ 'runs.json', 'index.json' ];


//---------------------------------------------------------------------
// Open: a store over a config folder, created if missing. The project folders join at Prepare.

function Open( Folder )
{
	let folder = PATH.resolve( Folder );
	FS.mkdirSync( folder, { recursive: true } );
	let queues = {};
	let roots = {};		// project id -> { Id, Path, Home }
	let homes = {};		// plan id -> { Project, Archived }
	let missing = [];	// [ { Path, Error } ]
	let isolated = null;	// the project id when Prepare was given one project (Step 4), else null
	let settings = null;


	//-----------------------------------------------------------------
	// Files

	function home_of( project_id )
	{
		let root = roots[ project_id ];
		if ( !root )
		{
			throw new Error( 'no such project: ' + project_id );
		}
		return root.Home;
	}


	function content_folder( id )
	{
		let home = homes[ id ];
		if ( !home || !roots[ home.Project ] )
		{
			return null;
		}
		return PATH.join( roots[ home.Project ].Home, home.Archived ? ARCHIVE_FOLDER : CONTENT_FOLDER, id );
	}


	function project_file( project_id )
	{
		return PATH.join( home_of( project_id ), PROJECT_FILE );
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
			if ( error.code === 'ENOENT' || error.code === 'ENOTDIR' )
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


	// A folder moved whole: renamed, or copied and removed when the target is on another drive.
	async function move_folder( source, target )
	{
		await FS.promises.mkdir( PATH.dirname( target ), { recursive: true } );
		try
		{
			await rename_with_retry( source, target );
		}
		catch ( error )
		{
			if ( error.code !== 'EXDEV' )
			{
				throw error;
			}
			await FS.promises.cp( source, target, { recursive: true } );
			await FS.promises.rm( source, { recursive: true, force: true } );
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


	async function folder_names( parent )
	{
		try
		{
			return await FS.promises.readdir( parent );
		}
		catch ( error )
		{
			if ( error.code === 'ENOENT' )
			{
				return [];
			}
			throw error;
		}
	}


	//-----------------------------------------------------------------
	// Queue: writes to one plan run one after another.

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


	// The settings' Projects list, as Prepare left it; the store keeps it in step with the roots and writes it.
	function projects_list()
	{
		if ( !settings )
		{
			settings = {};
		}
		if ( !Array.isArray( settings.Projects ) )
		{
			settings.Projects = [];
		}
		return settings.Projects;
	}


	async function write_projects_list()
	{
		if ( settings )
		{
			await WriteSettings( settings );
		}
	}


	//-----------------------------------------------------------------
	// Roots: the project folders. register( Path ) reads the folder's project.json and indexes its content.

	function home_path( project_path )
	{
		return PATH.join( PATH.resolve( project_path ), HOME_FOLDER );
	}


	async function register( Path )
	{
		let home = home_path( Path );
		let project = await read_json_or_null( PATH.join( home, PROJECT_FILE ) );
		if ( !project || typeof project.Id !== 'string' )
		{
			return null;
		}
		roots[ project.Id ] = { Id: project.Id, Path: PATH.resolve( Path ), Home: home };
		for ( let id of await folder_names( PATH.join( home, CONTENT_FOLDER ) ) )
		{
			homes[ id ] = { Project: project.Id, Archived: false };
		}
		for ( let id of await folder_names( PATH.join( home, ARCHIVE_FOLDER ) ) )
		{
			homes[ id ] = { Project: project.Id, Archived: true };
		}
		return project;
	}


	function unregister( project_id )
	{
		for ( let id of Object.keys( homes ) )
		{
			if ( homes[ id ].Project === project_id )
			{
				delete homes[ id ];
			}
		}
		delete roots[ project_id ];
	}


	function Roots()
	{
		return Object.keys( roots ).map( function ( id ) { return { Id: id, Path: roots[ id ].Path }; } );
	}


	function Missing()
	{
		return missing.slice();
	}


	function Isolated()
	{
		return isolated;
	}


	// A folder name for a project under <config>/projects/, from its name; a taken one gets a number.
	function default_project_path( name )
	{
		let base = String( name || '' ).replace( /[^A-Za-z0-9._ -]+/g, '-' ).replace( /^[\s.-]+|[\s.-]+$/g, '' ) || 'project';
		let candidate = PATH.join( folder, PROJECTS_FOLDER, base );
		for ( let number = 2; FS.existsSync( candidate ); number++ )
		{
			candidate = PATH.join( folder, PROJECTS_FOLDER, base + '-' + number );
		}
		return candidate;
	}


	//-----------------------------------------------------------------
	// Plans

	async function ListPlans()
	{
		let plans = [];
		for ( let id of Object.keys( homes ) )
		{
			if ( homes[ id ].Archived )
			{
				continue;
			}
			let plan = await read_json_or_null( PATH.join( content_folder( id ), 'content.json' ) );
			if ( plan )
			{
				plans.push( plan );
			}
		}
		plans.sort( by_updated_descending );
		return plans;
	}


	function by_updated_descending( a, b )
	{
		if ( a.Updated === b.Updated )
		{
			return 0;
		}
		return ( a.Updated < b.Updated ) ? 1 : -1;
	}


	async function read_record( id )
	{
		let where = content_folder( id );
		return where ? await read_json_or_null( PATH.join( where, 'content.json' ) ) : null;
	}


	// An archived plan reads with Archived: true.
	async function ReadPlan( Id )
	{
		let plan = await read_record( Id );
		if ( !plan )
		{
			return null;
		}
		let where = content_folder( Id );
		let text = await FS.promises.readFile( PATH.join( where, 'content.md' ), 'utf8' );
		let threads = await read_json_or_null( PATH.join( where, 'threads.json' ) );
		if ( homes[ Id ].Archived )
		{
			plan.Archived = true;
		}
		return { Plan: plan, Text: text, Threads: threads || [] };
	}


	function archived_error( id )
	{
		let error = new Error( 'the item ' + id + ' is archived: restore it first' );
		error.code = 'ARCHIVED';
		error.status = 409;
		return error;
	}


	// A plan's folder for a write: never an archived one.
	function writable_folder( id )
	{
		let where = content_folder( id );
		if ( where && homes[ id ].Archived )
		{
			throw archived_error( id );
		}
		return where;
	}


	// Parameters: { Project, Title, Text, By, Kind: 'plan' | 'document', State }  Only a plan has a State.
	async function CreatePlan( Parameters )
	{
		let home = home_of( Parameters.Project );
		let kind = Parameters.Kind || 'plan';
		let id = unique_id( IDS.ForPlan( kind ) );
		let now = new Date().toISOString();
		let head = IDS.New( IDS.REVISION );
		let plan = {
			Id: id,
			Title: Parameters.Title,
			Kind: kind,
			State: ( kind === 'plan' ) ? Parameters.State : null,
			Created: now,
			Updated: now,
			Revision: 1,
			Head: head,
		};
		homes[ id ] = { Project: Parameters.Project, Archived: false };
		let where = PATH.join( home, CONTENT_FOLDER, id );
		await FS.promises.mkdir( PATH.join( where, REVISIONS_FOLDER ), { recursive: true } );
		await write_snapshot( where, 1, Parameters.Text || '', { Id: head, Parent: null, Revision: 1, By: Parameters.By, At: now, Reason: 'create' } );
		await write_file( PATH.join( where, 'content.md' ), Parameters.Text || '' );
		await write_json( PATH.join( where, 'threads.json' ), [] );
		await write_json( PATH.join( where, 'content.json' ), plan );
		return plan;
	}


	// A new global id of Kind, used by nothing in any project folder.
	function unique_id( Kind )
	{
		while ( true )
		{
			let id = IDS.New( Kind );
			if ( !homes[ id ] && !roots[ id ] && !in_any_trash( id ) )
			{
				return id;
			}
		}
	}


	function in_any_trash( id )
	{
		return Object.keys( roots ).some( function ( project_id ) { return FS.existsSync( PATH.join( roots[ project_id ].Home, TRASH_FOLDER, id ) ); } );
	}


	// Changes to content.json other than the text: title, state.
	async function UpdatePlan( Id, Changes )
	{
		let where = writable_folder( Id );
		let plan = where ? await read_json_or_null( PATH.join( where, 'content.json' ) ) : null;
		if ( !plan )
		{
			return null;
		}
		for ( let key of Object.keys( Changes ) )
		{
			plan[ key ] = Changes[ key ];
		}
		plan.Updated = new Date().toISOString();
		await write_json( PATH.join( where, 'content.json' ), plan );
		return plan;
	}


	// A new revision of the text. Parameters: { Text, By, Reason: 'edit' | 'apply', Thread?, Note? }
	// Note: a sentence saying why, kept with the revision.
	async function WriteText( Id, Parameters )
	{
		let where = writable_folder( Id );
		let plan = where ? await read_json_or_null( PATH.join( where, 'content.json' ) ) : null;
		if ( !plan )
		{
			return null;
		}
		let now = new Date().toISOString();
		let revision = plan.Revision + 1;
		let record = { Id: IDS.New( IDS.REVISION ), Parent: plan.Head || null, Revision: revision, By: Parameters.By, At: now, Reason: Parameters.Reason };
		if ( Parameters.Thread )
		{
			record.Thread = Parameters.Thread;
		}
		if ( Parameters.Note )
		{
			record.Note = Parameters.Note;
		}
		await write_snapshot( where, revision, Parameters.Text, record );
		await write_file( PATH.join( where, 'content.md' ), Parameters.Text );
		plan.Revision = revision;
		plan.Head = record.Id;
		plan.Updated = now;
		await write_json( PATH.join( where, 'content.json' ), plan );
		return plan;
	}


	async function write_snapshot( where, revision, text, record )
	{
		let name = String( revision ).padStart( 4, '0' );
		await write_file( PATH.join( where, REVISIONS_FOLDER, name + '.md' ), text );
		await write_json( PATH.join( where, REVISIONS_FOLDER, name + '.json' ), record );
	}


	async function WriteThreads( Id, Threads )
	{
		let where = writable_folder( Id );
		if ( !where )
		{
			throw new Error( 'no such plan: ' + Id );
		}
		await write_json( PATH.join( where, 'threads.json' ), Threads );
	}


	async function ListRevisions( Id )
	{
		let where = content_folder( Id );
		if ( !where )
		{
			return [];
		}
		let revisions_folder = PATH.join( where, REVISIONS_FOLDER );
		let names = await folder_names( revisions_folder );
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
		let where = content_folder( Id );
		if ( !where )
		{
			return null;
		}
		let name = String( Revision ).padStart( 4, '0' );
		let revisions_folder = PATH.join( where, REVISIONS_FOLDER );
		let record = await read_json_or_null( PATH.join( revisions_folder, name + '.json' ) );
		if ( !record )
		{
			return null;
		}
		record.Text = await FS.promises.readFile( PATH.join( revisions_folder, name + '.md' ), 'utf8' );
		return record;
	}


	// A plan whole, as an import brings it, under its own Id, into Project (needed for an id not here yet):
	// Whole = { Plan, Text, Threads, Revisions: [ { Revision, By, At, Reason, Thread?, Note?, Text } ] }. The
	// folder is made when missing; what is there is written over.
	async function WriteWholePlan( Whole, Project )
	{
		let id = Whole.Plan.Id;
		let where = writable_folder( id );
		if ( !where )
		{
			let home = home_of( Project );
			homes[ id ] = { Project: Project, Archived: false };
			where = PATH.join( home, CONTENT_FOLDER, id );
		}
		await FS.promises.mkdir( PATH.join( where, REVISIONS_FOLDER ), { recursive: true } );
		for ( let revision of Whole.Revisions )
		{
			let record = Object.assign( {}, revision );
			delete record.Text;
			await write_snapshot( where, revision.Revision, revision.Text, record );
		}
		await write_file( PATH.join( where, 'content.md' ), Whole.Text );
		await write_json( PATH.join( where, 'threads.json' ), Whole.Threads );
		await write_json( PATH.join( where, 'content.json' ), Whole.Plan );
		return Whole.Plan;
	}


	// A copy of a plan, whole: text, threads and revisions, under a new id, titled "<title> (copy)", in Project
	// (its own project when not given). Returns the new plan, or null.
	async function CopyPlan( Id, Project )
	{
		let source = await read_record( Id );
		if ( !source )
		{
			return null;
		}
		let project = Project || homes[ Id ].Project;
		let home = home_of( project );
		let title = source.Title + ' (copy)';
		let id = unique_id( IDS.ForPlan( source.Kind ) );
		let where = PATH.join( home, CONTENT_FOLDER, id );
		await FS.promises.cp( content_folder( Id ), where, { recursive: true } );
		homes[ id ] = { Project: project, Archived: false };
		let now = new Date().toISOString();
		let plan = Object.assign( {}, source, { Id: id, Title: title, Created: now, Updated: now } );
		await write_json( PATH.join( where, 'content.json' ), plan );
		return plan;
	}


	// A plan's folder moved into another project (an item moved between projects). Returns false when there is
	// no such plan, or it is archived.
	async function MovePlan( Id, Project )
	{
		let where = content_folder( Id );
		if ( !where || homes[ Id ].Archived )
		{
			return false;
		}
		let home = home_of( Project );
		if ( homes[ Id ].Project === Project )
		{
			return true;
		}
		await move_folder( where, PATH.join( home, CONTENT_FOLDER, Id ) );
		homes[ Id ] = { Project: Project, Archived: false };
		return true;
	}


	//-----------------------------------------------------------------
	// Archive: an item's folder moved to its project's archive/, read-only there, and back.

	async function ArchivePlan( Id )
	{
		let where = content_folder( Id );
		if ( !where || homes[ Id ].Archived )
		{
			return false;
		}
		await move_folder( where, PATH.join( roots[ homes[ Id ].Project ].Home, ARCHIVE_FOLDER, Id ) );
		homes[ Id ].Archived = true;
		return true;
	}


	async function RestorePlan( Id )
	{
		let where = content_folder( Id );
		if ( !where || !homes[ Id ].Archived )
		{
			return false;
		}
		await move_folder( where, PATH.join( roots[ homes[ Id ].Project ].Home, CONTENT_FOLDER, Id ) );
		homes[ Id ].Archived = false;
		return true;
	}


	//-----------------------------------------------------------------
	// Projects: each is a folder with its .consensus (project.json holding the tree); the settings' Projects list
	// gives the display order. A project comes back with its Path.

	function with_path( project )
	{
		let root = roots[ project.Id ];
		return Object.assign( {}, project, { Path: root ? root.Path : null } );
	}


	async function read_project( id )
	{
		if ( !roots[ id ] )
		{
			return null;
		}
		let project = await read_json_or_null( project_file( id ) );
		if ( !project )
		{
			return null;
		}
		if ( !Array.isArray( project.Archive ) )
		{
			project.Archive = [];
		}
		return with_path( project );
	}


	// In the settings' order; a listed folder that is not registered (missing) is left out.
	async function ListProjects()
	{
		let projects = [];
		let seen = new Set();
		for ( let entry of projects_list() )
		{
			let root = root_at( entry.Path );
			if ( !root || seen.has( root.Id ) )
			{
				continue;
			}
			seen.add( root.Id );
			let project = await read_project( root.Id );
			if ( project )
			{
				projects.push( project );
			}
		}
		for ( let id of Object.keys( roots ) )
		{
			if ( !seen.has( id ) )
			{
				let project = await read_project( id );
				if ( project )
				{
					projects.push( project );
				}
			}
		}
		return projects;
	}


	function root_at( Path )
	{
		let resolved = PATH.resolve( String( Path || '' ) );
		for ( let id of Object.keys( roots ) )
		{
			if ( roots[ id ].Path === resolved )
			{
				return roots[ id ];
			}
		}
		return null;
	}


	async function ReadProject( Id )
	{
		if ( !/^[a-z0-9-]+$/.test( String( Id ) ) )
		{
			return null;
		}
		return await read_project( Id );
	}


	// Parameters: { Name, Path?, Id?, Context?, ContextFolder?, Items?, States? }  Path: the project's folder, made when
	// missing, <config>/projects/<name>/ by default; Id for an imported project. A new project goes to the end of the
	// order, with its Readme (empty until someone writes it) in its Context folder, first in its tree, and the settings'
	// States; an imported one brings its Context (the id of a document written after), its ContextFolder and its Items.
	async function CreateProject( Parameters )
	{
		let id = Parameters.Id || unique_id( IDS.PROJECT );
		let path = Parameters.Path ? PATH.resolve( Parameters.Path ) : default_project_path( Parameters.Name );
		let home = home_path( path );
		if ( FS.existsSync( PATH.join( home, PROJECT_FILE ) ) )
		{
			throw new Error( 'the folder already holds a project: ' + path );
		}
		let now = new Date().toISOString();
		await FS.promises.mkdir( PATH.join( home, CONTENT_FOLDER ), { recursive: true } );
		roots[ id ] = { Id: id, Path: path, Home: home };
		let context_id = Parameters.Context || ( await create_context( id ) ).Id;
		let items = Parameters.Items || [];
		let context_folder = ensure_context_folder( items, context_id, Parameters.ContextFolder );
		let states = ( Array.isArray( Parameters.States ) && Parameters.States.length ) ? Parameters.States.slice() : default_states();
		let project = {
			Id: id,
			Name: Parameters.Name,
			Context: context_id,
			ContextFolder: context_folder,
			Created: now,
			Updated: now,
			Version: 1,
			Items: items,
			Archive: [],
			States: states,
			Include: [],
			Exclude: DEFAULT_EXCLUDE.slice(),
			Commands: [],
		};
		await write_json( PATH.join( home, PROJECT_FILE ), project );
		if ( !root_at( path ) || !projects_list().some( function ( entry ) { return PATH.resolve( entry.Path ) === path; } ) )
		{
			projects_list().push( { Path: path } );
			await write_projects_list();
		}
		return with_path( project );
	}


	function default_states()
	{
		if ( settings && Array.isArray( settings.States ) && settings.States.length )
		{
			return settings.States.slice();
		}
		return DEFAULT_STATES.slice();
	}


	// OpenProject: a folder that holds a project already (its .consensus/project.json) joins the roots and the list.
	// Returns the project, or null when the folder holds none.
	async function OpenProject( Path )
	{
		let path = PATH.resolve( Path );
		let known = root_at( path );
		if ( known )
		{
			return await read_project( known.Id );
		}
		let project = await register( path );
		if ( !project )
		{
			return null;
		}
		if ( !projects_list().some( function ( entry ) { return PATH.resolve( entry.Path ) === path; } ) )
		{
			projects_list().push( { Path: path } );
			await write_projects_list();
		}
		return await read_project( project.Id );
	}


	// A project's Readme: a document titled Readme, in its Context folder, with no text yet.
	async function create_context( project_id )
	{
		return await CreatePlan( { Project: project_id, Title: CONTEXT_TITLE, Text: '', By: 'consensus', Kind: 'document' } );
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


	// Writes a changed project: its Version goes up by one and Updated is now. Returns the project as written.
	async function WriteProject( Project )
	{
		Project.Version = ( Project.Version || 0 ) + 1;
		Project.Updated = new Date().toISOString();
		let stored = Object.assign( {}, Project );
		delete stored.Path;
		await write_json( project_file( Project.Id ), stored );
		return with_path( Project );
	}


	// The project's .consensus is removed, and the folder leaves the list; the folder around it stays.
	async function DeleteProject( Id )
	{
		let root = roots[ Id ];
		if ( !root )
		{
			return false;
		}
		await FS.promises.rm( root.Home, { recursive: true, force: true } );
		unregister( Id );
		settings.Projects = projects_list().filter( function ( entry ) { return PATH.resolve( entry.Path ) !== root.Path; } );
		await write_projects_list();
		return true;
	}


	// Moves a project in the display order: before the project Before, or to the end when Before is null.
	// Returns false when either is not a project.
	async function MoveProject( Id, Before )
	{
		let list = projects_list();
		let root = roots[ Id ];
		let before_root = ( Before === null || Before === undefined ) ? null : roots[ Before ];
		if ( !root || ( Before !== null && Before !== undefined && !before_root ) )
		{
			return false;
		}
		if ( Before === Id )
		{
			return true;
		}
		let index = list.findIndex( function ( entry ) { return PATH.resolve( entry.Path ) === root.Path; } );
		let moved = ( index >= 0 ) ? list.splice( index, 1 )[ 0 ] : { Path: root.Path };
		let at = before_root ? list.findIndex( function ( entry ) { return PATH.resolve( entry.Path ) === before_root.Path; } ) : -1;
		list.splice( ( at < 0 ) ? list.length : at, 0, moved );
		await write_projects_list();
		return true;
	}


	// The project whose tree holds the item Id, or whose Readme or archive it is in, or null.
	async function ProjectOf( Id )
	{
		if ( homes[ Id ] )
		{
			return await read_project( homes[ Id ].Project );
		}
		for ( let project of await ListProjects() )
		{
			if ( TREE.Find( project.Items, Id ) || TREE.Find( project.Archive, Id ) )
			{
				return project;
			}
		}
		return null;
	}


	//-----------------------------------------------------------------
	// Trash: a deleted item goes to its project's trash, whole.

	async function TrashPlan( Id )
	{
		let where = content_folder( Id );
		if ( !where )
		{
			return false;
		}
		await move_folder( where, PATH.join( roots[ homes[ Id ].Project ].Home, TRASH_FOLDER, Id ) );
		delete homes[ Id ];
		return true;
	}


	async function ListTrash()
	{
		let plans = [];
		for ( let project_id of Object.keys( roots ) )
		{
			let trash = PATH.join( roots[ project_id ].Home, TRASH_FOLDER );
			for ( let id of await folder_names( trash ) )
			{
				let plan = await read_json_or_null( PATH.join( trash, id, 'content.json' ) );
				if ( plan )
				{
					plan.Project = project_id;
					plans.push( plan );
					continue;
				}
				let corpus = await read_json_or_null( PATH.join( trash, id, 'corpus.json' ) );
				if ( corpus )
				{
					plans.push( { Id: corpus.Id, Kind: 'corpus', Title: corpus.Name, Updated: corpus.Updated, Project: project_id } );
				}
			}
		}
		plans.sort( by_updated_descending );
		return plans;
	}


	//-----------------------------------------------------------------
	// Prepare: run at start with the settings. A config folder from before Step 2 is migrated into project folders
	// (below); the settings' Projects are registered (a missing folder is skipped, with a line, and kept in the list);
	// a config with no project at all gets a Default one. With Options.Project (Step 4) that folder's project is the
	// only one registered. Returns a line for each thing it did; the settings are written when the list changed.

	async function Prepare( Settings, Options )
	{
		settings = Settings || {};
		let options = Options || {};
		let lines = [];
		let before = JSON.stringify( projects_list() );
		lines = lines.concat( await migrate_old_layout() );
		missing = [];
		isolated = null;
		if ( options.Project )
		{
			lines = lines.concat( await prepare_one( options.Project ) );
		}
		for ( let entry of ( options.Project ? [] : projects_list() ) )
		{
			let path = PATH.resolve( String( entry.Path || '' ) );
			if ( root_at( path ) )
			{
				continue;
			}
			let project = null;
			let problem = null;
			try
			{
				project = await register( path );
			}
			catch ( error )
			{
				problem = error.message;
			}
			if ( !project )
			{
				problem = problem || ( FS.existsSync( path ) ? 'no ' + HOME_FOLDER + '/' + PROJECT_FILE + ' in it' : 'the folder is not there' );
				missing.push( { Path: path, Error: problem } );
				lines.push( 'project folder skipped: ' + path + ' (' + problem + ')' );
			}
		}
		// A project folder under <config>/projects/ that the list does not name (a list rewritten by hand) joins it.
		for ( let name of ( options.Project ? [] : await folder_names( PATH.join( folder, PROJECTS_FOLDER ) ) ) )
		{
			let path = PATH.join( folder, PROJECTS_FOLDER, name );
			if ( !root_at( path ) && FS.existsSync( PATH.join( home_path( path ), PROJECT_FILE ) ) )
			{
				let project = await register( path );
				if ( project )
				{
					projects_list().push( { Path: path } );
					lines.push( 'project folder found and listed: ' + path );
				}
			}
		}
		if ( !Object.keys( roots ).length )
		{
			let made = await CreateProject( { Name: DEFAULT_PROJECT_NAME } );
			lines.push( 'project ' + made.Name + ' created at ' + made.Path );
		}
		if ( JSON.stringify( projects_list() ) !== before )
		{
			await write_projects_list();
		}
		return lines;
	}


	// One project only (plan Run Shapes, Step 4: `consensus <path>`): the folder's project is registered and no other, a
	// folder without a .consensus gets one, named after the folder, and the folder goes to the front of the settings' list
	// (the most recent first; the list keeps every other folder as it was). A folder that is not there is refused.
	async function prepare_one( Path )
	{
		let path = PATH.resolve( String( Path ) );
		let stat = FS.existsSync( path ) ? FS.statSync( path ) : null;
		if ( !stat || !stat.isDirectory() )
		{
			throw new Error( 'no such folder: ' + path );
		}
		let lines = [];
		let project = await register( path );
		if ( !project )
		{
			if ( FS.existsSync( PATH.join( home_path( path ), PROJECT_FILE ) ) )
			{
				throw new Error( 'the project at ' + path + ' could not be read: ' + PATH.join( HOME_FOLDER, PROJECT_FILE ) + ' has no Id' );
			}
			project = await CreateProject( { Name: PATH.basename( path ) || 'project', Path: path } );
			lines.push( 'project ' + project.Name + ' created at ' + path );
		}
		let list = projects_list().filter( function ( entry ) { return PATH.resolve( String( entry.Path || '' ) ) !== path; } );
		list.unshift( { Path: path } );
		settings.Projects = list;
		isolated = project.Id;
		return lines;
	}


	//-----------------------------------------------------------------
	// The migration from the layout before Step 2: every project of the config folder's projects/<id>/project.json
	// moves, with its plans, into <config>/projects/<name>/.consensus/ (a project is named in projects.json, or
	// in its project.json), under a prj- id when it had "default"; a plan in no tree goes to the first project's
	// trash, as does the old trash. On the way, a project from before Consensus Desktop gets its Context folder, loses
	// its corpora and the LLM's files. The settings' Workspaces follow the renamed project id.

	function old_plan_folder( id )
	{
		return PATH.join( folder, OLD_PROPOSALS_FOLDER, id );
	}


	async function migrate_old_layout()
	{
		let lines = [];
		let old_projects = PATH.join( folder, PROJECTS_FOLDER );
		let candidates = [];
		for ( let id of await folder_names( old_projects ) )
		{
			let file = PATH.join( old_projects, id, PROJECT_FILE );
			if ( FS.existsSync( file ) )
			{
				candidates.push( { Id: id, Project: await read_json_or_null( file ) } );
			}
		}
		let has_old = candidates.length || FS.existsSync( PATH.join( folder, OLD_MASTER_FILE ) ) || FS.existsSync( PATH.join( folder, OLD_PROPOSALS_FOLDER ) );
		if ( !has_old )
		{
			return lines;
		}
		// The old project folders out of the way first: a new folder is named after the project, and "default" and
		// "Default" are one folder on Windows.
		let staging = PATH.join( folder, '.migrating' );
		for ( let candidate of candidates )
		{
			await move_folder( PATH.join( old_projects, candidate.Id ), PATH.join( staging, candidate.Id ) );
		}
		let master = await read_json_or_null( PATH.join( folder, OLD_MASTER_FILE ) );
		let listed = ( master && Array.isArray( master.Projects ) ) ? master.Projects : [];
		// The old order: the master's, then the rest, Default first and by name.
		let ordered = [];
		for ( let entry of listed )
		{
			let candidate = candidates.find( function ( one ) { return one.Id === entry.Id; } );
			if ( candidate )
			{
				candidate.Name = entry.Name;
				ordered.push( candidate );
			}
		}
		let rest = candidates.filter( function ( one ) { return !ordered.includes( one ); } );
		rest.forEach( function ( one ) { one.Name = ( one.Project && one.Project.Name ) || ( ( one.Id === 'default' ) ? DEFAULT_PROJECT_NAME : one.Id ); } );
		rest.sort( function ( a, b ) { return ( a.Id === 'default' ) ? -1 : ( b.Id === 'default' ) ? 1 : a.Name.localeCompare( b.Name ); } );
		ordered = ordered.concat( rest );
		let placed = new Set();
		let first_home = null;
		let id_map = {};
		for ( let candidate of ordered )
		{
			let old = candidate.Project || {};
			let id = ( candidate.Id === 'default' || !IDS.Is( candidate.Id, IDS.PROJECT ) ) ? IDS.New( IDS.PROJECT ) : candidate.Id;
			id_map[ candidate.Id ] = id;
			let path = default_project_path( candidate.Name );
			let home = home_path( path );
			await FS.promises.mkdir( PATH.join( home, CONTENT_FOLDER ), { recursive: true } );
			await FS.promises.mkdir( PATH.join( home, TRASH_FOLDER ), { recursive: true } );
			let items = Array.isArray( old.Items ) ? old.Items : [];
			// From before Consensus Desktop: corpora out of the tree and into the trash, a Readme titled Context renamed.
			for ( let corpus_id of strip_corpora( items ) )
			{
				let corpus_home = PATH.join( staging, candidate.Id, OLD_CORPORA_FOLDER, corpus_id );
				if ( FS.existsSync( corpus_home ) )
				{
					await move_folder( corpus_home, PATH.join( home, TRASH_FOLDER, corpus_id ) );
				}
			}
			let context_id = old.Context;
			if ( !context_id || !FS.existsSync( old_plan_folder( context_id ) ) )
			{
				roots[ id ] = { Id: id, Path: path, Home: home };
				context_id = ( await create_context( id ) ).Id;
				lines.push( 'projects/' + candidate.Id + ': a new Readme, ' + context_id );
			}
			let context_folder = ensure_context_folder( items, context_id, old.ContextFolder );
			let project = {
				Id: id,
				Name: candidate.Name,
				Context: context_id,
				ContextFolder: context_folder,
				Created: old.Created || new Date().toISOString(),
				Updated: old.Updated || new Date().toISOString(),
				Version: old.Version || 1,
				Items: items,
				Archive: [],
				States: default_states(),
				Include: [],
				Exclude: DEFAULT_EXCLUDE.slice(),
				Commands: [],
			};
			let moved = 0;
			let ids = TREE.ItemIds( items );
			if ( !ids.includes( context_id ) )
			{
				ids.push( context_id );
			}
			for ( let plan_id of ids )
			{
				if ( placed.has( plan_id ) )
				{
					continue;
				}
				if ( await move_old_plan( plan_id, PATH.join( home, CONTENT_FOLDER, plan_id ) ) )
				{
					placed.add( plan_id );
					moved++;
				}
			}
			await write_json( PATH.join( home, PROJECT_FILE ), project );
			roots[ id ] = { Id: id, Path: path, Home: home };
			projects_list().push( { Path: path } );
			first_home = first_home || home;
			lines.push( 'project ' + candidate.Name + ' moved to ' + path + ' (' + moved + ' items' + ( ( id !== candidate.Id ) ? ', its id now ' + id : '' ) + ')' );
		}
		// Plans in no tree, and the old trash, into the first project's trash.
		if ( first_home )
		{
			let strays = 0;
			for ( let plan_id of await folder_names( PATH.join( folder, OLD_PROPOSALS_FOLDER ) ) )
			{
				if ( !placed.has( plan_id ) && await move_old_plan( plan_id, PATH.join( first_home, TRASH_FOLDER, plan_id ) ) )
				{
					strays++;
				}
			}
			for ( let trashed_id of await folder_names( PATH.join( folder, TRASH_FOLDER ) ) )
			{
				let source = PATH.join( folder, TRASH_FOLDER, trashed_id );
				if ( FS.existsSync( PATH.join( source, 'proposal.json' ) ) )
				{
					await move_old_plan( trashed_id, PATH.join( first_home, TRASH_FOLDER, trashed_id ), source );
				}
				else
				{
					await move_folder( source, PATH.join( first_home, TRASH_FOLDER, trashed_id ) );
				}
			}
			if ( strays )
			{
				lines.push( strays + ' items in no project went to the trash' );
			}
		}
		for ( let name of OLD_RETIRED_FILES.concat( [ OLD_MASTER_FILE ] ) )
		{
			await FS.promises.rm( PATH.join( folder, name ), { force: true } );
		}
		await FS.promises.rm( PATH.join( folder, OLD_PROPOSALS_FOLDER ), { recursive: true, force: true } );
		await FS.promises.rm( PATH.join( folder, TRASH_FOLDER ), { recursive: true, force: true } );
		await FS.promises.rm( staging, { recursive: true, force: true } );
		// The settings' workspaces name their project by id.
		if ( settings && Array.isArray( settings.Workspaces ) )
		{
			for ( let workspace of settings.Workspaces )
			{
				if ( workspace && id_map[ workspace.Project ] )
				{
					workspace.Project = id_map[ workspace.Project ];
				}
			}
		}
		// The roots made here are read again as the list is registered (register indexes the content).
		for ( let id of Object.keys( roots ) )
		{
			await register( roots[ id ].Path );
		}
		return lines;
	}


	// An old plan folder (proposal.json, proposal.md, threads.json, revisions/, retired files) moved and renamed
	// into the new layout at target. Returns false when there is no such plan.
	async function move_old_plan( id, target, source )
	{
		let from = source || old_plan_folder( id );
		let record = await read_json_or_null( PATH.join( from, 'proposal.json' ) );
		if ( !record )
		{
			return false;
		}
		for ( let name of OLD_RETIRED_PROPOSAL_FILES )
		{
			await FS.promises.rm( PATH.join( from, name ), { force: true } );
		}
		if ( record.Kind === 'context' || record.Title === OLD_CONTEXT_TITLE )
		{
			record.Kind = 'document';
			record.State = null;
			record.Title = CONTEXT_TITLE;
		}
		await move_folder( from, target );
		await FS.promises.rename( PATH.join( target, 'proposal.md' ), PATH.join( target, 'content.md' ) );
		await FS.promises.rm( PATH.join( target, 'proposal.json' ), { force: true } );
		await write_json( PATH.join( target, 'content.json' ), record );
		return true;
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
		ListPlans: ListPlans,
		ReadPlan: ReadPlan,
		CreatePlan: CreatePlan,
		UpdatePlan: UpdatePlan,
		WriteText: WriteText,
		WriteThreads: WriteThreads,
		ListRevisions: ListRevisions,
		ReadRevision: ReadRevision,
		WriteWholePlan: WriteWholePlan,
		CopyPlan: CopyPlan,
		MovePlan: MovePlan,
		ArchivePlan: ArchivePlan,
		RestorePlan: RestorePlan,
		ListProjects: ListProjects,
		ReadProject: ReadProject,
		CreateProject: CreateProject,
		OpenProject: OpenProject,
		WriteProject: WriteProject,
		DeleteProject: DeleteProject,
		MoveProject: MoveProject,
		ProjectOf: ProjectOf,
		Roots: Roots,
		Missing: Missing,
		Isolated: Isolated,
		TrashPlan: TrashPlan,
		ListTrash: ListTrash,
		Prepare: Prepare,
	};
}


module.exports = {
	Open: Open,
	HOME_FOLDER: HOME_FOLDER,
	PROJECTS_FOLDER: PROJECTS_FOLDER,
	DEFAULT_PROJECT_NAME: DEFAULT_PROJECT_NAME,
	DEFAULT_STATES: DEFAULT_STATES,
	DEFAULT_EXCLUDE: DEFAULT_EXCLUDE,
	CONTEXT_TITLE: CONTEXT_TITLE,
};
