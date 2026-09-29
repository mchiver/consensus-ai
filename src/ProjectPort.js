'use strict';

// ProjectPort - a whole project out to one json object, and back in (the plan "Project Import and Export").
//
//   export = { Format: 'consensus-project', Version: 1, Exported,
//              Project: { Id, Name, Created, Updated, Context, Items },
//              Proposals: [ { Proposal, Text, Threads, Revisions: [ { Revision, By, At, Reason, Thread?, Note?, Text } ] } ],
//              Corpora: [ corpus.json ],
//              ContextServers: [ { Name, Url, Corpus: [ name ], Inference: [ { Name, Type, Model } ] } ] }
//
// No token is ever written to an export. Search indexes, LLM runs, usage, the trash and attached zips stay behind.
//
// An import depends only on whether the export's project Id is here:
//   not here   the project comes in as it is, every id intact
//   here       the owner chooses a Mode:
//     copy     a new project, "Copy of <name> (imported <yyyy-mm-dd>)", every id in it new
//     merge    into the project here: newer revisions, threads, replies, resolve / apply records and tree nodes
//              are added; nothing here is removed

const TREE = require( './Tree.js' );
const ANCHORS = require( './Anchors.js' );
const IDS = require( './Ids.js' );

const FORMAT = 'consensus-project';
const VERSION = 1;
const MODES = [ 'copy', 'merge' ];
const COPY_PREFIX = 'Copy of ';
const SAFE_ID = /^[a-z0-9-]+$/;
const PROPOSAL_KINDS = [ 'plan', 'document', 'context' ];
const WAITING_REASON = 'waiting for its zip to be attached again';
const MERGE_BY = 'consensus';
const SYSTEM_NAMES = [ MERGE_BY ];


//---------------------------------------------------------------------
// Nodes: every node under Items that is not a folder, with its parent's id (null at the root), in tree order.

function nodes_of( items, parent, list )
{
	let found = list || [];
	for ( let node of items )
	{
		if ( node.Kind !== 'folder' )
		{
			found.push( { Node: node, Parent: parent } );
		}
		if ( Array.isArray( node.Items ) )
		{
			nodes_of( node.Items, node.Id, found );
		}
	}
	return found;
}


// Every node under Items, folders too, with its parent's id, in tree order (a parent before its children).
function all_nodes_of( items, parent, list )
{
	let found = list || [];
	for ( let node of items )
	{
		found.push( { Node: node, Parent: parent } );
		if ( Array.isArray( node.Items ) )
		{
			all_nodes_of( node.Items, node.Id, found );
		}
	}
	return found;
}


function clone( value )
{
	return JSON.parse( JSON.stringify( value ) );
}


//=====================================================================
// Export


// Export: the project Id as one json object, or null when there is no such project. ContextServers (optional) is
// asked for a linked corpus's files and for what each server offers.
async function Export( Store, Id, ContextServers )
{
	let project = await Store.ReadProject( Id );
	if ( !project )
	{
		return null;
	}
	let proposals = [];
	let corpora = [];
	let servers = [];

	let proposal_ids = [];
	if ( project.Context )
	{
		proposal_ids.push( project.Context );
	}
	for ( let entry of nodes_of( project.Items, null ) )
	{
		if ( entry.Node.Kind === 'corpus' )
		{
			let corpus = await export_corpus( Store, entry.Node.Id, ContextServers );
			if ( corpus )
			{
				corpora.push( corpus );
				if ( corpus.Link && !servers.includes( corpus.Link.Server ) )
				{
					servers.push( corpus.Link.Server );
				}
			}
			continue;
		}
		proposal_ids.push( entry.Node.Id );
	}

	for ( let id of proposal_ids )
	{
		let whole = await Store.Queue( id, function () { return read_whole( Store, id ); } );
		if ( !whole )
		{
			continue;
		}
		proposals.push( whole );
		for ( let server of await run_servers( Store, id ) )
		{
			if ( !servers.includes( server ) )
			{
				servers.push( server );
			}
		}
	}

	return {
		Format: FORMAT,
		Version: VERSION,
		Exported: new Date().toISOString(),
		Project: { Id: project.Id, Name: project.Name, Created: project.Created, Updated: project.Updated, Context: project.Context, Items: project.Items },
		Proposals: proposals,
		Corpora: corpora,
		ContextServers: servers.map( function ( name ) { return server_entry( ContextServers, name ); } ),
	};
}


// A proposal whole: its record, text, threads and every revision with its text; null when there is none.
async function read_whole( Store, id )
{
	let read = await Store.ReadProposal( id );
	if ( !read )
	{
		return null;
	}
	let revisions = [];
	for ( let record of await Store.ListRevisions( id ) )
	{
		let revision = await Store.ReadRevision( id, record.Revision );
		if ( revision )
		{
			revisions.push( revision );
		}
	}
	return { Proposal: read.Proposal, Text: read.Text, Threads: read.Threads, Revisions: revisions };
}


// A corpus as an export carries it: its corpus.json, less nothing but a linked one's Files, which are asked for at
// its server (the stored list when that server does not answer).
async function export_corpus( Store, id, ContextServers )
{
	let corpus = await Store.ReadCorpus( id );
	if ( !corpus )
	{
		return null;
	}
	corpus = clone( corpus );
	if ( corpus.Link && ContextServers )
	{
		try
		{
			let listed = await ContextServers.Files( corpus.Link.Server, corpus.Link.Corpus );
			corpus.Files = listed.map( function ( file ) { return { Path: file.Path, Size: file.Size }; } );
		}
		catch ( error )
		{
			corpus.Files = corpus.Files || [];
		}
	}
	return corpus;
}


// The context servers a proposal's LLM runs were sent to: a run through a server names "<server> / <item>".
async function run_servers( Store, id )
{
	let names = [];
	for ( let run of await Store.ReadRuns( id ) )
	{
		let destination = String( run.Destination || '' );
		let at = destination.indexOf( ' / ' );
		if ( at > 0 )
		{
			names.push( destination.slice( 0, at ) );
		}
	}
	return names;
}


// A context server as an export names it: never its token.
function server_entry( ContextServers, name )
{
	let known = ContextServers ? ContextServers.List().find( function ( server ) { return server.Name === name; } ) : null;
	if ( !known )
	{
		return { Name: name };
	}
	return {
		Name: known.Name,
		Url: known.Url,
		Corpus: known.Corpus.map( function ( item ) { return item.Name; } ),
		Inference: known.Inference.map( function ( item ) { return { Name: item.Name, Type: item.Type, Model: item.Model }; } ),
	};
}


//=====================================================================
// Check: the problems with an export, as sentences; none when it can be imported.


function Check( Exported )
{
	if ( !Exported || typeof Exported !== 'object' )
	{
		return [ 'the export is not a json object' ];
	}
	if ( Exported.Format !== FORMAT )
	{
		return [ 'Format is not "' + FORMAT + '": this is not a Consensus project export' ];
	}
	if ( typeof Exported.Version !== 'number' )
	{
		return [ 'Version is missing' ];
	}
	if ( Exported.Version > VERSION )
	{
		return [ 'Version ' + Exported.Version + ' was made by a newer Consensus; this one reads up to ' + VERSION ];
	}

	let problems = [];
	let project = Exported.Project;
	if ( !project || typeof project !== 'object' )
	{
		return [ 'Project is missing' ];
	}
	if ( !SAFE_ID.test( String( project.Id ) ) )
	{
		problems.push( 'Project.Id is missing or not a plain id' );
	}
	if ( typeof project.Name !== 'string' || !project.Name.trim() )
	{
		problems.push( 'Project.Name is missing' );
	}
	let tree_problems = TREE.Validate( project.Items );
	for ( let problem of tree_problems )
	{
		problems.push( 'Project.Items: ' + problem );
	}
	if ( !Array.isArray( Exported.Proposals ) )
	{
		problems.push( 'Proposals is not a list' );
	}
	if ( !Array.isArray( Exported.Corpora ) )
	{
		problems.push( 'Corpora is not a list' );
	}
	if ( problems.length )
	{
		return problems;
	}

	let proposals = {};
	for ( let whole of Exported.Proposals )
	{
		let problem = whole_problem( whole );
		if ( problem )
		{
			problems.push( problem );
			continue;
		}
		proposals[ whole.Proposal.Id ] = whole.Proposal;
	}
	let corpora = {};
	for ( let corpus of Exported.Corpora )
	{
		if ( !corpus || !SAFE_ID.test( String( corpus.Id ) ) || typeof corpus.Name !== 'string' || !Array.isArray( corpus.Files ) )
		{
			problems.push( 'a corpus has no plain Id, Name or Files' );
			continue;
		}
		corpora[ corpus.Id ] = corpus;
	}
	for ( let entry of all_nodes_of( project.Items, null ) )
	{
		let node = entry.Node;
		if ( !SAFE_ID.test( node.Id ) )
		{
			problems.push( 'node ' + node.Id + ' is not a plain id' );
			continue;
		}
		if ( node.Kind === 'corpus' && !corpora[ node.Id ] )
		{
			problems.push( 'the tree names corpus ' + node.Id + ', which the file does not hold' );
		}
		if ( ( node.Kind === 'plan' || node.Kind === 'document' ) && !proposals[ node.Id ] )
		{
			problems.push( 'the tree names ' + node.Kind + ' ' + node.Id + ', which the file does not hold' );
		}
	}
	let context = proposals[ project.Context ];
	if ( !context || context.Kind !== 'context' )
	{
		problems.push( 'Project.Context is not a proposal of Kind context in the file' );
	}
	return problems;
}


function whole_problem( whole )
{
	if ( !whole || !whole.Proposal || !SAFE_ID.test( String( whole.Proposal.Id ) ) )
	{
		return 'a proposal has no plain Id';
	}
	let id = whole.Proposal.Id;
	if ( !PROPOSAL_KINDS.includes( whole.Proposal.Kind ) )
	{
		return 'proposal ' + id + ' has no known Kind';
	}
	if ( typeof whole.Text !== 'string' || !Array.isArray( whole.Threads ) || !Array.isArray( whole.Revisions ) || !whole.Revisions.length )
	{
		return 'proposal ' + id + ' needs Text, Threads and Revisions';
	}
	for ( let revision of whole.Revisions )
	{
		if ( !revision || !Number.isInteger( revision.Revision ) || revision.Revision < 1 || typeof revision.Text !== 'string' )
		{
			return 'proposal ' + id + ' has a revision with no number or no Text';
		}
	}
	return null;
}


//=====================================================================
// Merge: a proposal here and the file's, as one. Revisions are matched by their global Id (the plan Global Ids),
// never by number: those not here are appended, numbered after the ones here, keeping their Id and Parent.
//   the file's current revision descends from the one here   the history goes on to the file's
//   the one here descends from the file's (or is it)          the file is behind; the text here stays
//   neither                                                   a conflict: a merge revision (Parent: the one here,
//                                                             Merged: the file's) takes the newer text by At
// Returns { Whole, Diverged, Revisions, Threads, Replies }: Diverged is the number here of the revision both sides
// were edited from, on a conflict, else null; the counts are what the file added. Now and New_Id may be given (the
// tests fix them); otherwise the clock and Ids.New.


function Merge( Here, File, Now, New_Id )
{
	let result = { Whole: null, Diverged: null, Revisions: 0, Threads: 0, Replies: 0 };
	let now = Now || new Date().toISOString();
	let revisions = sorted_revisions( Here.Revisions ).map( clone );
	let by_id = {};
	for ( let revision of revisions )
	{
		by_id[ revision.Id ] = revision;
	}
	let here_head = revisions[ revisions.length - 1 ];
	let file_revisions = sorted_revisions( File.Revisions );
	let file_head = file_revisions[ file_revisions.length - 1 ];

	let next = here_head.Revision + 1;
	for ( let revision of file_revisions )
	{
		if ( by_id[ revision.Id ] )
		{
			continue;
		}
		let added = clone( revision );
		added.Revision = next;
		next += 1;
		revisions.push( added );
		by_id[ added.Id ] = added;
		result.Revisions += 1;
	}

	let proposal = clone( Here.Proposal );
	let text = Here.Text;
	let behind = ( file_head.Id === here_head.Id ) || ancestors_of( by_id, here_head.Id ).has( file_head.Id );
	if ( !behind )
	{
		if ( ancestors_of( by_id, file_head.Id ).has( here_head.Id ) )
		{
			text = File.Text;
			proposal.Head = file_head.Id;
			take_record( proposal, File.Proposal );
		}
		else
		{
			let newer = ( file_head.At > here_head.At ) ? file_head : here_head;
			let merge = { Id: New_Id || IDS.New( IDS.REVISION ), Parent: here_head.Id, Merged: file_head.Id, Revision: next, By: MERGE_BY, At: now, Reason: 'merge', Text: by_id[ newer.Id ].Text };
			revisions.push( merge );
			by_id[ merge.Id ] = merge;
			text = merge.Text;
			proposal.Head = merge.Id;
			if ( newer === file_head )
			{
				take_record( proposal, File.Proposal );
			}
			result.Diverged = common_number( by_id, here_head.Id, file_head.Id );
		}
		proposal.Revision = revisions[ revisions.length - 1 ].Revision;
		proposal.Updated = now;
	}

	let threads = clone( Here.Threads );
	for ( let file_thread of File.Threads )
	{
		let thread = threads.find( function ( candidate ) { return candidate.Id === file_thread.Id; } );
		if ( !thread )
		{
			thread = clone( file_thread );
			renumber_applied( thread, by_id );
			threads.push( thread );
			result.Threads += 1;
			continue;
		}
		for ( let reply of file_thread.Replies || [] )
		{
			if ( !thread.Replies.some( function ( candidate ) { return candidate.Id === reply.Id; } ) )
			{
				thread.Replies.push( clone( reply ) );
				result.Replies += 1;
			}
		}
		thread.Replies.sort( by_at );
		if ( file_thread.Resolved && !thread.Resolved )
		{
			thread.Resolved = clone( file_thread.Resolved );
			thread.Status = file_thread.Status;
			thread.Reopened = file_thread.Reopened;
		}
		if ( file_thread.Applied && !thread.Applied )
		{
			thread.Applied = clone( file_thread.Applied );
			renumber_applied( thread, by_id );
		}
	}
	mark_detached( threads, text );

	result.Whole = { Proposal: proposal, Text: text, Threads: threads, Revisions: revisions };
	return result;
}


// The revision problems that keep a merge from matching by Id: the first revision with no Id, as a sentence, or null.
function MissingRevisionId( Whole )
{
	for ( let revision of Whole.Revisions )
	{
		if ( !revision.Id )
		{
			return 'revision ' + revision.Revision + ' of "' + Whole.Proposal.Title + '" has no Id: merging needs the revision ids of the plan Global Ids';
		}
	}
	return null;
}


// A newer head brings its title and state along.
function take_record( proposal, from )
{
	proposal.Title = from.Title;
	proposal.State = from.State;
}


// Every revision Id is descended from, following Parent and Merged.
function ancestors_of( by_id, id )
{
	let seen = new Set();
	let waiting = [ id ];
	while ( waiting.length )
	{
		let revision = by_id[ waiting.pop() ];
		if ( !revision )
		{
			continue;
		}
		for ( let parent of [ revision.Parent, revision.Merged ] )
		{
			if ( parent && !seen.has( parent ) )
			{
				seen.add( parent );
				waiting.push( parent );
			}
		}
	}
	return seen;
}


// The number here of the newest revision both heads descend from, or null.
function common_number( by_id, here_id, file_id )
{
	let here_side = ancestors_of( by_id, here_id );
	let best = null;
	for ( let id of ancestors_of( by_id, file_id ) )
	{
		if ( here_side.has( id ) && ( best === null || by_id[ id ].Revision > best ) )
		{
			best = by_id[ id ].Revision;
		}
	}
	return best;
}


// A thread's Applied record names its revision here: the number that its RevisionId has here.
function renumber_applied( thread, by_id )
{
	if ( thread.Applied && thread.Applied.RevisionId && by_id[ thread.Applied.RevisionId ] )
	{
		thread.Applied.Revision = by_id[ thread.Applied.RevisionId ].Revision;
	}
}


function sorted_revisions( revisions )
{
	return revisions.slice().sort( function ( a, b ) { return a.Revision - b.Revision; } );
}


function by_at( a, b )
{
	if ( a.At === b.At )
	{
		return 0;
	}
	return ( a.At < b.At ) ? -1 : 1;
}


// Each anchored thread is found again in the text, or marked detached.
function mark_detached( threads, text )
{
	let found = ANCHORS.Refind( threads, text );
	for ( let index = 0; index < threads.length; index++ )
	{
		if ( threads[ index ].Anchor )
		{
			threads[ index ].Detached = found[ index ].Detached;
		}
	}
}


//=====================================================================
// Import


// Import: the export into this server. Options = { Mode, Preview }. Context = { ContextServers?, Participants:
// [ name ], ChangeProject( id, change ) } where ChangeProject edits a project's tree through its queue.
// Returns { Problems } for a file that cannot be imported (or a project that is here, with no Mode), { Preview }
// with Preview, else { Report }.
async function Import( Store, Exported, Options, Context )
{
	let options = Options || {};
	let problems = Check( Exported );
	if ( options.Mode !== undefined && options.Mode !== null && !MODES.includes( options.Mode ) )
	{
		problems.push( 'Mode must be one of ' + MODES.join( ', ' ) );
	}
	if ( problems.length )
	{
		return { Problems: problems };
	}

	let here = await Store.ReadProject( Exported.Project.Id );
	let copy_name = COPY_PREFIX + Exported.Project.Name + ' (imported ' + today() + ')';
	if ( options.Preview )
	{
		return {
			Preview: {
				Project: { Id: Exported.Project.Id, Name: Exported.Project.Name, Exists: !!here, NameHere: here ? here.Name : null },
				Modes: here ? MODES : [],
				CopyName: copy_name,
			},
		};
	}
	if ( here && !options.Mode )
	{
		return { Problems: [ 'the project "' + here.Name + '" is already here: choose Mode copy or merge' ] };
	}

	let context = Context || {};
	let report = {
		Project: { Id: null, Name: null, Mode: null },
		Made: { Plans: 0, Documents: 0, Threads: 0, Corpora: 0 },
		Merged: [],
		Diverged: [],
		Corpora: [],
		ContextServers: [],
		UnknownParticipants: [],
		Written: [],
		WrittenCorpora: [],
	};
	if ( options.Mode === 'copy' )
	{
		await import_copy( Store, Exported, copy_name, report, context );
	}
	else if ( here )
	{
		let problem = await merge_problem( Store, Exported, here );
		if ( problem )
		{
			return { Problems: [ problem ] };
		}
		await import_merge( Store, Exported, here, report, context );
	}
	else
	{
		let taken = await taken_ids( Store, Exported );
		if ( taken.length )
		{
			return { Problems: [ 'the file holds ' + taken.join( ', ' ) + ', already here in another project: import it with Mode copy' ] };
		}
		await import_new( Store, Exported, report, context );
	}
	report.ContextServers = await check_servers( Exported.ContextServers || [], context.ContextServers );
	report.UnknownParticipants = unknown_names( records_of( Exported ), context.Participants || [] );
	return { Report: report };
}


// Today as yyyy-mm-dd, in the server's time zone.
function today()
{
	let now = new Date();
	let month = String( now.getMonth() + 1 ).padStart( 2, '0' );
	let day = String( now.getDate() ).padStart( 2, '0' );
	return now.getFullYear() + '-' + month + '-' + day;
}


// The file's proposals that come in: its context and those its tree names.
function records_of( Exported )
{
	let wanted = new Set( [ Exported.Project.Context ] );
	for ( let entry of nodes_of( Exported.Project.Items, null ) )
	{
		if ( entry.Node.Kind !== 'corpus' )
		{
			wanted.add( entry.Node.Id );
		}
	}
	return Exported.Proposals.filter( function ( whole ) { return wanted.has( whole.Proposal.Id ); } );
}


function corpora_of( Exported )
{
	let wanted = new Set();
	for ( let entry of nodes_of( Exported.Project.Items, null ) )
	{
		if ( entry.Node.Kind === 'corpus' )
		{
			wanted.add( entry.Node.Id );
		}
	}
	return Exported.Corpora.filter( function ( corpus ) { return wanted.has( corpus.Id ); } );
}


// The file's proposal and corpus ids that something here already has.
async function taken_ids( Store, Exported )
{
	let taken = [];
	for ( let whole of records_of( Exported ) )
	{
		if ( await Store.ReadProposal( whole.Proposal.Id ) )
		{
			taken.push( whole.Proposal.Id );
		}
	}
	for ( let corpus of corpora_of( Exported ) )
	{
		if ( await Store.ReadCorpus( corpus.Id ) )
		{
			taken.push( corpus.Id );
		}
	}
	return taken;
}


// A new id no proposal, corpus or project here has.
async function fresh_id( Store, kind )
{
	while ( true )
	{
		let id = IDS.New( kind );
		let taken = await Store.ReadProposal( id ) || await Store.ReadCorpus( id ) || await Store.ReadProject( id );
		if ( !taken )
		{
			return id;
		}
	}
}


//---------------------------------------------------------------------
// New: the project is not here; it comes in with every id intact.

async function import_new( Store, Exported, report, context )
{
	let id_map = {};
	for ( let whole of records_of( Exported ) )
	{
		id_map[ whole.Proposal.Id ] = whole.Proposal.Id;
	}
	for ( let corpus of corpora_of( Exported ) )
	{
		id_map[ corpus.Id ] = corpus.Id;
	}
	await write_project( Store, Exported, Exported.Project.Id, Exported.Project.Name, id_map, {}, report, context );
	report.Project.Mode = 'new';
}


//---------------------------------------------------------------------
// Copy: a new project, "Copy of <name> (imported <date>)", with every id new.

async function import_copy( Store, Exported, name, report, context )
{
	let id_map = {};
	for ( let whole of records_of( Exported ) )
	{
		id_map[ whole.Proposal.Id ] = await fresh_id( Store, IDS.ForProposal( whole.Proposal.Kind ) );
	}
	for ( let corpus of corpora_of( Exported ) )
	{
		id_map[ corpus.Id ] = await fresh_id( Store, IDS.CORPUS );
	}
	let folder_map = {};
	for ( let entry of all_nodes_of( Exported.Project.Items, null ) )
	{
		if ( entry.Node.Kind === 'folder' )
		{
			folder_map[ entry.Node.Id ] = IDS.New( IDS.FOLDER );
		}
	}
	let project_id = await fresh_id( Store, IDS.PROJECT );
	await write_project( Store, Exported, project_id, name, id_map, folder_map, report, context );
	report.Project.Mode = 'copy';
}


// The whole file written as a new project, each item under the id id_map gives it.
async function write_project( Store, Exported, project_id, name, id_map, folder_map, report, context )
{
	for ( let whole of records_of( Exported ) )
	{
		let id = id_map[ whole.Proposal.Id ];
		let written = clone( whole );
		written.Proposal.Id = id;
		await Store.Queue( id, function () { return Store.WriteWholeProposal( written ); } );
		count_made( report, written );
		report.Written.push( id );
	}
	for ( let corpus of corpora_of( Exported ) )
	{
		await write_corpus( Store, corpus, id_map[ corpus.Id ], project_id, report, context.ContextServers );
	}
	let items = map_tree( Exported.Project.Items, id_map, folder_map );
	let project = await Store.CreateProject( { Id: project_id, Name: name, Context: id_map[ Exported.Project.Context ], Items: items } );
	report.Project.Id = project.Id;
	report.Project.Name = project.Name;
}


//---------------------------------------------------------------------
// Merge: into the project here. Nothing here is removed.

// The id a file's proposal is merged into: its own, or the project's context for the file's context.
function merge_target( Exported, here, id )
{
	return ( id === Exported.Project.Context ) ? here.Context : id;
}


// Why the file cannot be merged, before anything is written: a proposal in both whose revisions have no Id.
async function merge_problem( Store, Exported, here )
{
	for ( let whole of records_of( Exported ) )
	{
		let there = await read_whole( Store, merge_target( Exported, here, whole.Proposal.Id ) );
		if ( there )
		{
			let problem = MissingRevisionId( whole ) || MissingRevisionId( there );
			if ( problem )
			{
				return problem;
			}
		}
	}
	return null;
}


async function import_merge( Store, Exported, here, report, context )
{
	for ( let whole of records_of( Exported ) )
	{
		// The file's context lands on the project's context, whatever its id.
		let id = merge_target( Exported, here, whole.Proposal.Id );
		let file = clone( whole );
		file.Proposal.Id = id;
		let merged = await Store.Queue( id, async function ()
		{
			let there = await read_whole( Store, id );
			if ( !there )
			{
				await Store.WriteWholeProposal( file );
				return null;
			}
			let result = Merge( there, file );
			await Store.WriteWholeProposal( result.Whole );
			return result;
		} );
		report.Written.push( id );
		if ( !merged )
		{
			count_made( report, file );
			continue;
		}
		report.Merged.push( { Id: id, Title: merged.Whole.Proposal.Title, Revisions: merged.Revisions, Threads: merged.Threads, Replies: merged.Replies } );
		if ( merged.Diverged !== null )
		{
			report.Diverged.push( { Id: id, Title: merged.Whole.Proposal.Title, At: merged.Diverged } );
		}
	}
	for ( let corpus of corpora_of( Exported ) )
	{
		if ( await Store.ReadCorpus( corpus.Id ) )
		{
			report.Corpora.push( { Id: corpus.Id, Name: corpus.Name, Source: corpus.Link ? 'linked' : 'attached', State: 'kept as it is here' } );
			continue;
		}
		await write_corpus( Store, corpus, corpus.Id, here.Id, report, context.ContextServers );
	}
	let result = await context.ChangeProject( here.Id, function ( project )
	{
		add_missing( project.Items, Exported.Project.Items );
	} );
	if ( result && result.Refused )
	{
		throw new Error( result.Refused.Error );
	}
	report.Project.Id = here.Id;
	report.Project.Name = here.Name;
	report.Project.Mode = 'merge';
}


function count_made( report, whole )
{
	if ( whole.Proposal.Kind === 'plan' )
	{
		report.Made.Plans += 1;
	}
	if ( whole.Proposal.Kind === 'document' )
	{
		report.Made.Documents += 1;
	}
	report.Made.Threads += whole.Threads.length;
}


// One corpus from the file written under id in the folder of project_id, and its state for the report. A linked
// one keeps its link and is checked against its server here; an attached one waits for its zip.
async function write_corpus( Store, from_file, id, project_id, report, ContextServers )
{
	let corpus = clone( from_file );
	corpus.Id = id;
	if ( corpus.Link )
	{
		corpus.Files = [];
	}
	else
	{
		corpus.Waiting = true;
		corpus.Files = from_file.Files.map( function ( file ) { return { Path: file.Path, Size: file.Size, Indexed: false, Reason: WAITING_REASON }; } );
	}
	await Store.WriteImportedCorpus( project_id, corpus );
	report.WrittenCorpora.push( id );
	report.Made.Corpora += 1;
	let state = { Id: id, Name: corpus.Name, Source: corpus.Link ? 'linked' : 'attached' };
	if ( corpus.Link )
	{
		Object.assign( state, await check_linked( corpus, from_file.Files, ContextServers ) );
	}
	else
	{
		state.State = 'waiting for its zip: attach it again on the corpus';
	}
	report.Corpora.push( state );
}


// A linked corpus against its server here: { State, Missing?, Added? }.
async function check_linked( corpus, exported_files, ContextServers )
{
	let server = corpus.Link.Server;
	let known = ContextServers ? ContextServers.List().find( function ( candidate ) { return candidate.Name === server; } ) : null;
	if ( !known )
	{
		return { State: 'offline: no context server named "' + server + '" here; add it to consensus.json with its Url and token, then Refresh' };
	}
	if ( !ContextServers.Has( server, corpus.Link.Corpus ) )
	{
		return { State: 'offline: the context server "' + server + '" ' + ( known.Online ? 'does not offer "' + corpus.Link.Corpus + '"' : 'does not answer' ) };
	}
	try
	{
		let listed = ( await ContextServers.Files( server, corpus.Link.Corpus ) ).map( function ( file ) { return file.Path; } );
		let exported = exported_files.map( function ( file ) { return file.Path; } );
		let missing = exported.filter( function ( path ) { return !listed.includes( path ); } );
		let added = listed.filter( function ( path ) { return !exported.includes( path ); } );
		return { State: ( missing.length || added.length ) ? 'linked; its files differ' : 'linked; its files match', Missing: missing, Added: added };
	}
	catch ( error )
	{
		return { State: 'offline: ' + error.message };
	}
}


// Each context server the export names, against this server's: { Name, Url, Present, Online, MissingInference }.
async function check_servers( exported, ContextServers )
{
	let known = ContextServers ? ContextServers.List() : [];
	return exported.map( function ( entry )
	{
		let here = known.find( function ( server ) { return server.Name === entry.Name; } );
		let wanted = ( entry.Inference || [] ).map( function ( item ) { return item.Name; } );
		let offered = here ? here.Inference.map( function ( item ) { return item.Name; } ) : [];
		return {
			Name: entry.Name,
			Url: entry.Url || null,
			Present: !!here,
			Online: !!( here && here.Online ),
			MissingInference: wanted.filter( function ( name ) { return !offered.includes( name ); } ),
		};
	} );
}


// Participant names in the imported threads and revisions that this server does not know.
function unknown_names( wholes, known )
{
	let unknown = [];
	function note( name )
	{
		if ( name && !known.includes( name ) && !SYSTEM_NAMES.includes( name ) && !unknown.includes( name ) )
		{
			unknown.push( name );
		}
	}
	for ( let whole of wholes )
	{
		for ( let revision of whole.Revisions )
		{
			note( revision.By );
		}
		for ( let thread of whole.Threads )
		{
			for ( let reply of thread.Replies || [] )
			{
				note( reply.By );
			}
			note( thread.Resolved && thread.Resolved.By );
			note( thread.Applied && thread.Applied.By );
		}
	}
	return unknown;
}


// The file's tree with its ids as written: new ids for a copy, the file's own otherwise.
function map_tree( items, id_map, folder_map )
{
	return items.map( function ( node )
	{
		let mapped = { Kind: node.Kind, Id: ( node.Kind === 'folder' ) ? ( folder_map[ node.Id ] || node.Id ) : ( id_map[ node.Id ] || node.Id ) };
		if ( node.Kind === 'folder' )
		{
			mapped.Name = node.Name;
		}
		if ( Array.isArray( node.Items ) )
		{
			mapped.Items = map_tree( node.Items, id_map, folder_map );
		}
		return mapped;
	} );
}


// Every node of Source that Target does not have goes into Target: under its parent from Source when Target has
// that parent and it takes the node, otherwise at the root. A parent comes before its children, so a folder
// brought over takes its children with it.
function add_missing( target, source )
{
	for ( let entry of all_nodes_of( source, null ) )
	{
		let node = entry.Node;
		if ( TREE.Find( target, node.Id ) )
		{
			continue;
		}
		let shallow = { Kind: node.Kind, Id: node.Id };
		if ( node.Kind === 'folder' )
		{
			shallow.Name = node.Name;
			shallow.Items = [];
		}
		let parent = ( entry.Parent && TREE.Find( target, entry.Parent ) ) ? entry.Parent : null;
		if ( !TREE.Insert( target, parent, shallow ) )
		{
			TREE.Insert( target, null, shallow );
		}
	}
}


//---------------------------------------------------------------------

module.exports = {
	FORMAT: FORMAT,
	VERSION: VERSION,
	MODES: MODES,
	Export: Export,
	Check: Check,
	Merge: Merge,
	Import: Import,
};
