'use strict';

// Store - the config folder and the project folders (plan Run Shapes, Step 2). Plain files, whole-file atomic writes,
// and a queue per plan so two requests never interleave their writes. The config folder holds the settings; each
// project is a folder of its own (a repository, as a rule) with a .consensus sub-folder that is the project:
//
//   <config>/consensus.json                            settings; its Projects: [ { Path, Mounted, Llm, Tasks, Roles } ] lists the project
//                                                      folders, in display order, Mounted (plan Rearchitecturation, Step 1) saying whether
//                                                      the Server exposes it; Llm, Tasks and Roles: { Owners, Members, Service, Watchers }
//                                                      (account ids, plan User Management, Step 3) are the Server's for that project
//   <project>/.consensus/project.json                  { Id, Name, Context, ContextFolder, Created, Updated, Version, Items: [ node ],
//                                                      Archive: [ node ], States, Include, Exclude, Commands, GitSync, AutoCommit }  (see Tree.js)
//                                                      Context: the id of the project's Readme; ContextFolder: the id of the Context
//                                                      folder that holds it, first in Items; Archive: the archived plans, whole
//   <project>/.consensus/content/<id>/content.json     { Id, Title, Kind: 'plan' | 'document', State, Created, Updated, Revision, Head }
//   <project>/.consensus/content/<id>/content.md       the text at revision Revision
//   <project>/.consensus/content/<id>/threads.json     [ thread ]
//   <project>/.consensus/content/<id>/revisions/0001.md, 0001.json    the text, and { Id, Parent, Merged?, Revision, By, Service?, Token?, At, Reason, Thread?, Note? }
//   <project>/.consensus/archive/<id>/                 an archived item, moved whole; read, never written, until restored
//   <project>/.consensus/trash/<id>/                   a deleted item, moved whole
//
// Ids are global (Ids.js): pln-…, doc-… a plan (ctx-… a Readme made before plan Consensus Desktop), prj-… a project,
// fld-… a folder, rev-… a revision. Every project has a prj- id: the Default project's id "default" ended with Step 2.
//
// Prepare, at start, registers the project folders the settings list. A project folder the settings list and the disk
// lacks is skipped, with a line, and kept in the list (Missing). Prepare with { Project: path } (plan Run Shapes, Step 4:
// `consensus <path>`) registers that folder's project alone, making its .consensus when missing, and puts it first in
// the list (Isolated gives its id).
//
// Open( Folder, { ReadOnly: true } ) (plan Rearchitecturation, Step 1) is the Desktop's opening of the Server Host's config:
// the settings and the registry are read and never written (WriteSettings refuses with a plain error, Prepare registers
// the listed folders, makes no Default project and writes nothing); a folder with no consensus.json gives empty lists.
//
// Plan Project settings, Step 1: project.json goes into source control with the project, so it holds nothing of one
// machine's Server: a project's Roles, Llm and Tasks live on its registry entry in consensus.json. A project comes back
// with them joined from the entry (as Mounted is), and WriteProject puts them back there, never in the file. A
// project.json that still holds them (or a stray Mounted) has them moved to the entry when it is registered on a
// writable config; read-only (the Desktop's sidecar) a project has none, and the file's are written back untouched.

const FS = require( 'fs' );
const PATH = require( 'path' );
const TREE = require( './Tree.js' );
const IDS = require( './Ids.js' );
const ATOMIC = require( './Atomic.js' );

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
const DEFAULT_STATES = [ 'Draft', 'Plan', 'Working', 'Finished' ];
const DEFAULT_EXCLUDE = [ '~*/**', 'node_modules/**', '.git/**' ];
const SERVER_FIELDS = [ 'Roles', 'Llm', 'Tasks' ];
const ROLE_NAMES = [ 'Owners', 'Members', 'Service', 'Watchers' ];


//---------------------------------------------------------------------
// Open: a store over a config folder, created if missing. The project folders join at Prepare.

function Open( Folder, Options )
{
	let folder = PATH.resolve( Folder );
	let read_only = !!( Options && Options.ReadOnly );
	if ( !read_only )
	{
		FS.mkdirSync( folder, { recursive: true } );
	}
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


	// Whole-file atomic write (src/Atomic.js since plan Review 2026-10-29, Step 2: a temporary file renamed into place,
	// the rename tried again while a reader holds the target).
	async function write_file( file, content )
	{
		await ATOMIC.WriteTextAsync( file, content );
	}


	// A folder moved whole: renamed, or copied and removed when the target is on another drive.
	async function move_folder( source, target )
	{
		await FS.promises.mkdir( PATH.dirname( target ), { recursive: true } );
		try
		{
			await ATOMIC.Rename( source, target );
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
		if ( read_only )
		{
			throw new Error( 'the settings are read-only: ' + SETTINGS_FILE + ' is written by the Server alone' );
		}
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
		if ( settings && !read_only )
		{
			await WriteSettings( settings );
		}
	}


	// The registry entry of a project folder, or null.
	function entry_at( Path )
	{
		let resolved = PATH.resolve( String( Path || '' ) );
		return projects_list().find( function ( entry ) { return PATH.resolve( String( entry.Path || '' ) ) === resolved; } ) || null;
	}


	//-----------------------------------------------------------------
	// Roots: the project folders. register( Path ) reads the folder's project.json and indexes its content.

	function home_path( project_path )
	{
		return PATH.join( PATH.resolve( project_path ), HOME_FOLDER );
	}


	async function register( Path, Lines )
	{
		let home = home_path( Path );
		let project = await read_json_or_null( PATH.join( home, PROJECT_FILE ) );
		if ( !project || typeof project.Id !== 'string' )
		{
			return null;
		}
		if ( !read_only )
		{
			let moved = await move_server_fields( project, PATH.resolve( Path ) );
			if ( moved && Lines )
			{
				Lines.push( moved );
			}
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


	// A project.json written before plan Project settings: its Roles, Llm and Tasks go to the registry entry (where the
	// entry has none of its own), a stray Mounted is dropped, and the file is written without them. Returns the line to
	// log, or null when the file was clean.
	async function move_server_fields( project, path )
	{
		let found = SERVER_FIELDS.concat( [ 'Mounted' ] ).filter( function ( field ) { return project[ field ] !== undefined; } );
		if ( !found.length )
		{
			return null;
		}
		let entry = entry_at( path );
		if ( !entry )
		{
			entry = { Path: path };
			projects_list().push( entry );
		}
		for ( let field of SERVER_FIELDS )
		{
			if ( entry[ field ] === undefined && kept_value( field, project[ field ] ) )
			{
				entry[ field ] = JSON.parse( JSON.stringify( project[ field ] ) );
			}
		}
		for ( let field of found )
		{
			delete project[ field ];
		}
		await write_json( PATH.join( home_path( path ), PROJECT_FILE ), project );
		await write_projects_list();
		return 'project ' + ( project.Name || project.Id ) + ': ' + found.join( ', ' ) + ' moved out of ' + PROJECT_FILE;
	}


	// Whether a Server field's value is worth keeping on the entry: not empty, and Roles with someone in them.
	function kept_value( field, value )
	{
		if ( value === undefined || value === null )
		{
			return false;
		}
		if ( field === 'Roles' )
		{
			return ROLE_NAMES.some( function ( role ) { return Array.isArray( value[ role ] ) && value[ role ].length > 0; } );
		}
		return true;
	}


	// The project's Server fields onto its registry entry (WriteProject); true when the entry changed.
	function keep_server_fields( Project )
	{
		let root = roots[ Project.Id ];
		if ( !root )
		{
			return false;
		}
		let entry = entry_at( root.Path );
		let made = false;
		if ( !entry )
		{
			entry = { Path: root.Path };
			made = true;
		}
		let before = JSON.stringify( entry );
		for ( let field of SERVER_FIELDS )
		{
			if ( kept_value( field, Project[ field ] ) )
			{
				entry[ field ] = JSON.parse( JSON.stringify( Project[ field ] ) );
			}
			else
			{
				delete entry[ field ];
			}
		}
		let changed = JSON.stringify( entry ) !== before;
		if ( made && changed )
		{
			projects_list().push( entry );
		}
		return changed;
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


	// Empty the trash of every project: each item's folder removed for good. Returns how many went.
	async function EmptyTrash()
	{
		let count = 0;
		for ( let project_id of Object.keys( roots ) )
		{
			let trash = PATH.join( roots[ project_id ].Home, TRASH_FOLDER );
			for ( let id of await folder_names( trash ) )
			{
				await FS.promises.rm( PATH.join( trash, id ), { recursive: true, force: true } );
				count++;
			}
		}
		return count;
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
		await write_snapshot( where, 1, Parameters.Text || '', stamped( { Id: head, Parent: null, Revision: 1, By: Parameters.By }, Parameters, { At: now, Reason: 'create' } ) );
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


	// A new revision of the text. Parameters: { Text, By, Service?, Token?, Reason: 'edit' | 'apply', Thread?, Note? }
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
		let record = stamped( { Id: IDS.New( IDS.REVISION ), Parent: plan.Head || null, Revision: revision, By: Parameters.By }, Parameters, { At: now, Reason: Parameters.Reason } );
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


	// A record with the Service and Token of the request that made it, when it had them (plan User Management, Step 2).
	function stamped( head, parameters, tail )
	{
		let record = Object.assign( {}, head );
		if ( parameters.Service )
		{
			record.Service = parameters.Service;
		}
		if ( parameters.Token )
		{
			record.Token = parameters.Token;
		}
		return Object.assign( record, tail );
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
		let entry = root ? entry_at( root.Path ) : null;
		return Object.assign( {}, project, { Path: root ? root.Path : null, Mounted: !!( entry && entry.Mounted === true ) } );
	}


	// SetMounted (plan Rearchitecturation, Step 1): the registry entry's switch, kept in the settings; the project after,
	// or null when Id is not a project. Mounting a project for accounts is Step 5's.
	async function SetMounted( Id, Mounted )
	{
		let root = roots[ Id ];
		if ( !root )
		{
			return null;
		}
		let entry = entry_at( root.Path );
		if ( !entry )
		{
			entry = { Path: root.Path };
			projects_list().push( entry );
		}
		entry.Mounted = ( Mounted === true );
		await write_projects_list();
		return await read_project( Id );
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
		// the Server's fields from the registry entry (plan Project settings, Step 1); none read-only, the sidecar's
		let entry = read_only ? null : entry_at( roots[ id ].Path );
		for ( let field of SERVER_FIELDS )
		{
			delete project[ field ];
			if ( entry && entry[ field ] !== undefined )
			{
				project[ field ] = JSON.parse( JSON.stringify( entry[ field ] ) );
			}
		}
		delete project.Mounted;
		// the role folders (plan User Management, Step 3), empty when the entry has none
		if ( !project.Roles || typeof project.Roles !== 'object' )
		{
			project.Roles = { Owners: [], Members: [], Service: [], Watchers: [] };
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
		return await read_project( id );
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
		let project = await register( path, [] );
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


	// Writes a changed project: its Version goes up by one and Updated is now. Returns the project as written. The
	// Server's fields go to the registry entry (plan Project settings, Step 1), never into the file; read-only (the
	// sidecar) the file keeps whatever of them it had, for the Server to move.
	async function WriteProject( Project )
	{
		Project.Version = ( Project.Version || 0 ) + 1;
		Project.Updated = new Date().toISOString();
		let stored = Object.assign( {}, Project );
		delete stored.Path;
		delete stored.Mounted;
		for ( let field of SERVER_FIELDS )
		{
			delete stored[ field ];
		}
		if ( read_only )
		{
			let on_disk = ( await read_json_or_null( project_file( Project.Id ) ) ) || {};
			for ( let field of SERVER_FIELDS )
			{
				if ( on_disk[ field ] !== undefined )
				{
					stored[ field ] = on_disk[ field ];
				}
			}
		}
		else if ( keep_server_fields( Project ) )
		{
			await write_projects_list();
		}
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
	// Prepare: run at start with the settings. The settings' Projects are registered (a missing folder is skipped, with a line, and kept in the list);
	// a config with no project at all gets a Default one. With Options.Project (Step 4) that folder's project is the
	// only one registered. Returns a line for each thing it did; the settings are written when the list changed.

	async function Prepare( Settings, Options )
	{
		settings = Settings || {};
		let options = Options || {};
		let lines = [];
		let before = JSON.stringify( projects_list() );
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
				project = await register( path, lines );
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
				let project = await register( path, lines );
				if ( project && !entry_at( path ) )
				{
					projects_list().push( { Path: path } );
					lines.push( 'project folder found and listed: ' + path );
				}
			}
		}
		if ( !Object.keys( roots ).length && !read_only )
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
		let project = await register( path, lines );
		if ( !project )
		{
			if ( FS.existsSync( PATH.join( home_path( path ), PROJECT_FILE ) ) )
			{
				throw new Error( 'the project at ' + path + ' could not be read: ' + PATH.join( HOME_FOLDER, PROJECT_FILE ) + ' has no Id' );
			}
			project = await CreateProject( { Name: PATH.basename( path ) || 'project', Path: path } );
			lines.push( 'project ' + project.Name + ' created at ' + path );
		}
		let existing = entry_at( path ) || { Path: path };
		let list = projects_list().filter( function ( entry ) { return entry !== existing; } );
		list.unshift( existing );
		settings.Projects = list;
		isolated = project.Id;
		return lines;
	}


	//-----------------------------------------------------------------

	return {
		Folder: folder,
		ReadOnly: read_only,
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
		SetMounted: SetMounted,
		ProjectOf: ProjectOf,
		Roots: Roots,
		Missing: Missing,
		Isolated: Isolated,
		TrashPlan: TrashPlan,
		ListTrash: ListTrash,
		EmptyTrash: EmptyTrash,
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
