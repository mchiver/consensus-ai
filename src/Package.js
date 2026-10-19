'use strict';

// Package - the one-shot prompt (plan Consensus Desktop, Step 3; in the server since plan Run Shapes, Step 3; from a
// task's record since plan LLM Tasks, Step 1): one text built from the items the task's Package switches on, in a
// fixed order, each under a heading, then the task's Prompt, the person's instructions when the task has a Box
// (Step 2), and the connection's Session Prompt at the end. Pure: the pieces are fetched by the caller (Runner.js).
//
//   Build( {
//     Task: { Name, Package: { Instructions, Readme, Documents, Plan, Threads, Files, Project, Box }, Writes, Prompt },
//     Text?: the person's instructions from the box,
//     Llm: { Name, Prompts: { Session } },
//     Server: { Url, Name },  Project: { Id, Name },  Plan: { Id, Title, State } | null,  Folder: path | null,
//     Owner: { Name, Display },  Service: the connection's name (the byline is "<Service> by <Owner Display>"),
//     Token?: the run's token; null for a run that needs none (ollama), undefined for a preview,
//     Instructions: text | null,  InstructionsTitle?: 'Agent instructions',  DocumentsHint?: how to read one,
//     Readme: { Id, Title, Text } | null,  Documents: [ { Id, Title } ],
//     Threads: [ { Id, Status, Anchor, Replies: [ { By, At, Text } ] } ],
//     Shape?: { Items: [ { Id, Title, Kind, State, Tally: { Contested, Resolved, Applied }, Archived } ], Runs: [ { Task, By, Started, Status, Plan } ] }
//             the project's shape (Step 4, the Project switch),  ShapeHint?: how to read a plan,
//   } ) -> text

const TASKS = require( './Tasks.js' );


//---------------------------------------------------------------------

function heading( lines, title )
{
	if ( lines.length )
	{
		lines.push( '' );
		lines.push( '' );
	}
	lines.push( '## ' + title );
	lines.push( '' );
}


function fence_for( text )
{
	let longest = 3;
	let found = /`{3,}/g;
	let match = null;
	while ( ( match = found.exec( text || '' ) ) !== null )
	{
		longest = Math.max( longest, match[ 0 ].length + 1 );
	}
	return '`'.repeat( longest );
}


function push_text( lines, text )
{
	let fence = fence_for( text );
	lines.push( fence );
	lines.push( String( text || '' ).replace( /\s+$/, '' ) );
	lines.push( fence );
}


function push_thread( lines, thread )
{
	let where = thread.Anchor ? 'on "' + thread.Anchor.Text + '"' : 'on the whole document';
	lines.push( '### Thread ' + thread.Id + ' (' + ( thread.Status || 'contested' ) + ', ' + where + ')' );
	lines.push( '' );
	for ( let reply of thread.Replies || [] )
	{
		lines.push( '**' + reply.By + '** (' + ( reply.At || '' ) + '):' );
		lines.push( '' );
		lines.push( String( reply.Text || '' ).replace( /\s+$/, '' ) );
		lines.push( '' );
	}
}


// The project's shape (Step 4): every plan and document as a line, then the last runs.
function push_shape( lines, request )
{
	let shape = request.Shape;
	let name = request.Project ? request.Project.Name : 'the project';
	heading( lines, 'The project' );
	lines.push( 'Every plan and document of ' + name + ', as a title, id, state and tally. ' + ( request.ShapeHint || 'Read one through the API: GET /api/plans/<id> (its text and threads), /api/plans/<id>/revisions, /api/plans/<id>/report.md.' ) );
	lines.push( '' );
	for ( let item of shape.Items || [] )
	{
		let words = ( item.Kind === 'plan' ) ? ( item.State || 'no state' ) + ', ' + tally_words( item.Tally ) : 'a document';
		lines.push( '- ' + item.Title + ' (' + item.Id + '): ' + words + ( item.Archived ? ', archived' : '' ) );
	}
	if ( !( shape.Items || [] ).length )
	{
		lines.push( 'None.' );
	}
	heading( lines, 'Runs' );
	lines.push( 'The last runs on ' + name + ', newest first: the task, who asked, when, the status and the plan.' );
	lines.push( '' );
	for ( let run of shape.Runs || [] )
	{
		lines.push( '- ' + run.Task + ' by ' + run.By + ' at ' + run.Started + ': ' + run.Status + ( run.Plan ? ', on ' + run.Plan : '' ) );
	}
	if ( !( shape.Runs || [] ).length )
	{
		lines.push( 'None.' );
	}
}


function tally_words( tally )
{
	let counts = tally || {};
	return 'contested ' + ( counts.Contested || 0 ) + ', resolved ' + ( counts.Resolved || 0 ) + ', applied ' + ( counts.Applied || 0 );
}


//---------------------------------------------------------------------
// Build: the whole prompt.

function Build( Request )
{
	let request = Request || {};
	let task = TASKS.Fill( request.Task || { Name: 'Session', Writes: 'files' } );
	let switches = task.Package;
	let llm = request.Llm || {};
	let session_prompt = ( llm.Prompts && typeof llm.Prompts.Session === 'string' ) ? llm.Prompts.Session : '';
	let owner = request.Owner || { Name: 'user', Display: 'User' };
	let service = request.Service || llm.Name || 'llm';
	let byline = service + ' by ' + ( owner.Display || owner.Name );
	let lines = [];

	let server_name = ( request.Server && request.Server.Name ) ? ' "' + request.Server.Name + '"' : '';
	lines.push( '# ' + task.Name + ': a one-shot from Consensus' );
	lines.push( '' );
	lines.push( 'You act for ' + ( owner.Display || owner.Name ) + ', the owner of the Consensus server below, run once by that server' + server_name + ' through its LLM connection "' + service + '": what you post reads "' + byline + '".' );
	heading( lines, 'This run' );
	lines.push( '- Task: ' + task.Name );
	lines.push( '- Writes: ' + TASKS.WritesLine( task.Writes ) );
	if ( request.Server && request.Server.Url )
	{
		lines.push( '- Consensus API: ' + String( request.Server.Url ).replace( /\/+$/, '' ) + '/api' );
	}
	if ( request.Token )
	{
		lines.push( '- Your token, sent as "Authorization: Bearer <token>": ' + request.Token );
	}
	else if ( request.Token === undefined )
	{
		lines.push( '- Your token, sent as "Authorization: Bearer <token>": made by the server when the run starts (this is a preview).' );
	}
	if ( request.Project )
	{
		lines.push( '- Project: ' + request.Project.Name + ' (' + request.Project.Id + ')' );
	}
	if ( switches.Plan && request.Plan )
	{
		lines.push( '- The plan at hand: ' + request.Plan.Title + ' (' + request.Plan.Id + ')' + ( request.Plan.State ? ', state ' + request.Plan.State : '' ) );
	}
	else if ( switches.Plan )
	{
		lines.push( '- No plan is selected.' );
	}
	if ( switches.Files && request.Folder )
	{
		lines.push( '- The project\'s folder: ' + request.Folder + ' (this run\'s working folder)' );
	}
	else
	{
		lines.push( '- No folder: this run has no files to work in.' );
	}

	if ( switches.Instructions && request.Instructions )
	{
		heading( lines, request.InstructionsTitle || 'Agent instructions' );
		push_text( lines, request.Instructions );
	}
	if ( switches.Readme && request.Readme )
	{
		heading( lines, 'Readme of ' + ( request.Project ? request.Project.Name : 'the project' ) + ' (' + request.Readme.Id + ')' );
		push_text( lines, request.Readme.Text );
	}
	if ( switches.Documents && request.Documents && request.Documents.length )
	{
		heading( lines, 'Other documents of the Context folder' );
		lines.push( request.DocumentsHint || 'Read one through the API: GET /api/plans/<id>.' );
		lines.push( '' );
		for ( let document of request.Documents )
		{
			lines.push( '- ' + document.Title + ' (' + document.Id + ')' );
		}
	}
	if ( switches.Threads && request.Plan )
	{
		let threads = request.Threads || [];
		heading( lines, 'Threads of the plan waiting on ' + byline );
		if ( !threads.length )
		{
			lines.push( 'None.' );
		}
		for ( let thread of threads )
		{
			push_thread( lines, thread );
		}
	}
	if ( switches.Project && request.Shape )
	{
		push_shape( lines, request );
	}
	let prompt = String( task.Prompt || '' ).trim();
	if ( prompt )
	{
		heading( lines, 'Your task: ' + task.Name );
		lines.push( task.Prompt.replace( /\s+$/, '' ) );
	}
	let instructions = switches.Box ? String( request.Text || '' ).trim() : '';
	if ( instructions )
	{
		heading( lines, 'Your instructions' );
		lines.push( instructions );
	}
	if ( session_prompt.trim() )
	{
		heading( lines, ( prompt || instructions ) ? 'Further instructions' : 'Your task' );
		lines.push( session_prompt.replace( /\s+$/, '' ) );
	}
	return lines.join( '\n' ) + '\n';
}


module.exports = {
	Build: Build,
};
