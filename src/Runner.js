'use strict';

// Runner - a one-shot from a request (plan Run Shapes, Step 3): what the desktop's main process did over the
// connected server's API, done in the server over its own store: the lists the packaging popup checks, the package
// (Package.js) from the connection's checks, and the start of a run (Runs.js) in the project's folder, posting as the
// presser through the connection (plan User Management, Step 2: the run token the server mints, Tokens, names the
// connection as the Service, so the run's posts read "<connection> by <owner>"). A run reaches this server at its own
// address (Url), so a run is always on this machine.
//
//   Runner( { Store, Settings, Runs, Url, Tokens } ) -> { Lists( Request ), Package( Request, Token? ), Start( Request, By ) }
//   Url(): this server's address, what a run's tools and prompt reach it at; null when it does not listen.
//   Lists( { Project, Plan?, Llm? } ) -> { Documents, Threads, Speaker } | { Error }
//   Package( { Llm, Kind, Project, Plan?, Overrides? }, Token? ) -> { Prompt, Llm, Project, Plan, Folder, Speaker } | { Error }
//     Token: the run's token value; none for a preview, whose prompt says a token is made at the start.
//   Start( Request, By ) -> { Run } | { Error, Status }

const FS = require( 'fs' );
const PACKAGE = require( './Package.js' );
const LLMS = require( './Llms.js' );
const TOOLS = require( './Tools.js' );
const RULES = require( './Rules.js' );
const PARTICIPANTS = require( './Participants.js' );
const INSTRUCTIONS = require( './Instructions.js' );


function Runner( Options )
{
	let store = Options.Store;
	let settings = Options.Settings;
	let runs = Options.Runs;
	let tokens = Options.Tokens || null;
	let url_of = Options.Url || function () { return null; };

	const TASK_NAMES = { review: 'Review run', build: 'Build run', session: 'Session run' };


	function documents_of( project )
	{
		let documents = [];
		let context_folder = ( project.Items || [] ).find( function ( node ) { return node.Id === project.ContextFolder; } );
		for ( let node of ( context_folder ? context_folder.Items : [] ) || [] )
		{
			if ( node.Kind === 'document' && node.Id !== project.Context )
			{
				documents.push( { Id: node.Id, Title: node.Title } );
			}
		}
		return documents;
	}


	// The first words of a thread's last reply, for the packaging popup's list.
	function last_words( thread )
	{
		let replies = thread.Replies || [];
		let last = replies.length ? replies[ replies.length - 1 ] : null;
		if ( !last )
		{
			return '';
		}
		let words = String( last.Text || '' ).replace( /\s+/g, ' ' ).trim();
		return last.By + ': ' + ( ( words.length > 90 ) ? words.slice( 0, 90 ) + '…' : words );
	}


	// The threads of a plan waiting on the speaker (a connection's key), or on any speaker but the owner when none is named.
	function waiting_threads( read, participant )
	{
		let all = PARTICIPANTS.SeenSpeakers( settings, read.Threads || [] );
		let llm_names = all.filter( function ( one ) { return one.Role !== 'owner'; } ).map( function ( one ) { return one.Name; } );
		return ( read.Threads || [] ).filter( function ( thread )
		{
			let turn = RULES.Turn( thread, all );
			if ( participant )
			{
				return turn.includes( participant );
			}
			return turn.some( function ( name ) { return llm_names.includes( name ); } );
		} );
	}


	async function project_of( id )
	{
		if ( !id )
		{
			return null;
		}
		return await store.ReadProject( id );
	}


	// The project's folder as a run works in it, or null when the folder is not on this machine.
	function folder_of( project )
	{
		if ( !project.Path || !FS.existsSync( project.Path ) )
		{
			return null;
		}
		return { Path: project.Path, Include: project.Include || [], Exclude: project.Exclude || [], Commands: project.Commands || [] };
	}


	//-----------------------------------------------------------------
	// Lists: the other Context documents of the project, and the threads of the plan waiting on the connection.

	async function Lists( Request )
	{
		let request = Request || {};
		let project = await project_of( request.Project );
		if ( !project )
		{
			return { Error: 'no project with the id ' + request.Project };
		}
		let llm = request.Llm ? LLMS.ById( settings, request.Llm ) : null;
		let participant = llm ? LLMS.SpeakerName( llm, settings ) : null;
		let threads = [];
		if ( request.Plan )
		{
			let read = await store.ReadPlan( request.Plan );
			if ( !read )
			{
				return { Error: 'no plan with the id ' + request.Plan };
			}
			for ( let thread of waiting_threads( read, participant ) )
			{
				threads.push( { Id: thread.Id, Status: thread.Status, Anchor: thread.Anchor ? thread.Anchor.Text : null, Last: last_words( thread ) } );
			}
		}
		return { Documents: documents_of( project ), Threads: threads, Speaker: llm ? LLMS.SpeakerDisplay( llm, settings ) : null };
	}


	//-----------------------------------------------------------------
	// Package: the prompt of a run, from the connection's checks; Overrides are the popup's unsaved fields.

	async function Package( Request, Token )
	{
		let request = Request || {};
		let llm = LLMS.ById( settings, request.Llm );
		if ( !llm )
		{
			return { Error: 'no LLM connection with the id ' + request.Llm };
		}
		if ( request.Overrides && typeof request.Overrides === 'object' )
		{
			llm = LLMS.Fill( Object.assign( {}, llm, request.Overrides, { Id: llm.Id, Name: llm.Name } ) );
		}
		if ( !PACKAGE.KINDS.includes( request.Kind ) )
		{
			return { Error: 'the Kind is one of ' + PACKAGE.KINDS.join( ', ' ) };
		}
		let url = url_of();
		if ( !url )
		{
			return { Error: 'this server does not listen (Scope None): a run could not reach it' };
		}
		let project = await project_of( request.Project );
		if ( !project )
		{
			return { Error: 'no project with the id ' + request.Project };
		}
		let folder = folder_of( project );
		if ( request.Kind === 'build' && !folder )
		{
			return { Error: 'a build needs the project\'s folder on this machine' + ( project.Path ? ': ' + project.Path + ' is missing' : '' ) };
		}
		let participant = LLMS.SpeakerName( llm, settings );
		let is_ollama = ( llm.Kind === 'ollama' );
		let readme = null;
		if ( llm.Checks.Readme && project.Context )
		{
			let read = await store.ReadPlan( project.Context );
			if ( read )
			{
				readme = { Id: project.Context, Title: read.Plan.Title, Text: read.Text };
			}
		}
		let instructions = null;
		if ( llm.Checks.Instructions )
		{
			if ( is_ollama )
			{
				instructions = TOOLS.Tools( { Kind: request.Kind, Folder: folder, Server: { Url: url, Token: Token || null, Project: project.Id } } ).Instructions();
			}
			else
			{
				instructions = INSTRUCTIONS.Make( settings, url, await INSTRUCTIONS.Guide(), { Service: llm.Name, Token: Token || null } );
			}
		}
		let plan = null;
		let threads = [];
		if ( request.Plan )
		{
			let read = await store.ReadPlan( request.Plan );
			if ( !read || read.Plan.Kind !== 'plan' )
			{
				return { Error: 'no plan with the id ' + request.Plan };
			}
			plan = { Id: read.Plan.Id, Title: read.Plan.Title, State: read.Plan.State };
			threads = waiting_threads( read, participant ).filter( function ( thread ) { return !llm.Unchecked.Threads.includes( thread.Id ); } );
		}
		else if ( request.Kind !== 'session' )
		{
			return { Error: 'a ' + request.Kind + ' needs a plan: select one in the tree' };
		}
		let prompt = PACKAGE.Build( {
			Kind: request.Kind,
			Llm: llm,
			Server: { Url: url, Name: settings.Name },
			Project: { Id: project.Id, Name: project.Name },
			Plan: plan,
			Folder: folder ? folder.Path : null,
			Owner: PARTICIPANTS.Owner( settings ),
			Service: llm.Name,
			Token: is_ollama ? null : Token,
			Instructions: instructions,
			InstructionsTitle: is_ollama ? 'Tool instructions' : 'Agent instructions',
			DocumentsHint: is_ollama ? 'Read one with the read_document tool.' : undefined,
			Readme: readme,
			Documents: documents_of( project ).filter( function ( document ) { return !llm.Unchecked.Documents.includes( document.Id ); } ),
			Threads: threads,
		} );
		return { Prompt: prompt, Llm: llm, Project: { Id: project.Id, Name: project.Name, Path: project.Path || null }, Plan: plan, Folder: folder, Speaker: LLMS.SpeakerDisplay( llm, settings ) };
	}


	//-----------------------------------------------------------------
	// Start: the run's token minted (named after the task), the package made with it, the run begun, By the presser's
	// account name; the token is dropped if the run cannot start, and by Runs when it ends.

	async function Start( Request, By )
	{
		let request = Request || {};
		let llm = LLMS.ById( settings, request.Llm );
		let token = null;
		if ( llm && tokens )
		{
			token = { Value: tokens.Mint( { Service: llm.Name, Name: TASK_NAMES[ request.Kind ] || 'run', Project: request.Project || null } ), Name: TASK_NAMES[ request.Kind ] || 'run' };
		}
		let made = await Package( request, token ? token.Value : null );
		if ( made.Error )
		{
			drop( token );
			return { Error: made.Error, Status: 400 };
		}
		let server = null;
		if ( made.Llm.Kind === 'ollama' )
		{
			server = { Url: url_of(), Token: token ? token.Value : null, Project: made.Project.Id };
		}
		try
		{
			let run = runs.Start( { Llm: made.Llm, Kind: request.Kind, By: By || null, Token: token, Project: made.Project, Plan: made.Plan, Folder: made.Folder, Prompt: made.Prompt, Server: server } );
			return { Run: run };
		}
		catch ( error )
		{
			drop( token );
			return { Error: error.message, Status: /already running/.test( error.message ) ? 409 : 400 };
		}
	}


	function drop( token )
	{
		if ( token && tokens )
		{
			tokens.Drop( token.Value );
		}
	}


	return {
		Lists: Lists,
		Package: Package,
		Start: Start,
	};
}


module.exports = {
	Runner: Runner,
};
