'use strict';

// Store - the data folder. Plain files, one folder per proposal, whole-file atomic writes,
// and a queue per proposal so two requests never interleave their writes.
//
//   <folder>/consensus.json                   settings
//   <folder>/proposals/<id>/proposal.json     { Id, Title, Status, Created, Updated, Revision, Approved }
//   <folder>/proposals/<id>/proposal.md       the text at revision Revision
//   <folder>/proposals/<id>/threads.json      [ thread ]
//   <folder>/proposals/<id>/revisions/0001.md, 0001.json
//   <folder>/proposals/<id>/index.json        search chunks
//   <folder>/trash/<id>/                      a deleted proposal, moved whole

const FS = require( 'fs' );
const PATH = require( 'path' );
const CRYPTO = require( 'crypto' );

const SETTINGS_FILE = 'consensus.json';
const PROPOSALS_FOLDER = 'proposals';
const TRASH_FOLDER = 'trash';
const REVISIONS_FOLDER = 'revisions';


//---------------------------------------------------------------------
// Open: a store over a data folder, created if missing.

function Open( Folder )
{
	let folder = PATH.resolve( Folder );
	FS.mkdirSync( PATH.join( folder, PROPOSALS_FOLDER ), { recursive: true } );
	FS.mkdirSync( PATH.join( folder, TRASH_FOLDER ), { recursive: true } );
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
		await FS.promises.rename( temporary, file );
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


	async function CreateProposal( Parameters )
	{
		let id = await unique_id( Parameters.Title );
		let now = new Date().toISOString();
		let proposal = {
			Id: id,
			Title: Parameters.Title,
			Status: 'contested',
			Created: now,
			Updated: now,
			Revision: 1,
			Approved: null,
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
			}
		}
		proposals.sort( by_updated_descending );
		return proposals;
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
		ReadIndex: ReadIndex,
		WriteIndex: WriteIndex,
		TrashProposal: TrashProposal,
		ListTrash: ListTrash,
	};
}


module.exports = {
	Open: Open,
};
