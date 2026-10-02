'use strict';

// Package - the one-shot prompt (plan Consensus Desktop, Step 3): one text built from the items checked on an LLM
// connection, in a fixed order, each under a heading, then the prompt of the button pressed (Review or Build;
// Session has none) and the connection's Session Prompt at the end. Pure: the pieces are fetched by the caller.
//
//   Build( {
//     Kind: 'review' | 'build' | 'session',
//     Llm: { Name, Checks: { Instructions, Readme, Documents, Threads }, Prompts: { Review, Build, Session } },
//     Server: { Url },  Project: { Id, Name },  Plan: { Id, Title, State } | null,  Workspace: { Name, Path } | null,
//     Participant: 'llm',
//     Instructions: text | null,  InstructionsTitle?: 'Agent instructions',  DocumentsHint?: how to read one,
//     Readme: { Id, Title, Text } | null,  Documents: [ { Id, Title } ],
//     Threads: [ { Id, Status, Anchor, Replies: [ { By, At, Text } ] } ],
//   } ) -> text

const KINDS = [ 'review', 'build', 'session' ];

const CHECK_ITEMS = [ 'Instructions', 'Readme', 'Documents', 'Threads' ];

const DEFAULT_CHECKS = { Instructions: true, Readme: true, Documents: true, Threads: true };

const DEFAULT_PROMPTS = {
	Review: [
		'Take the llm participant\'s turn on the plan at hand, as the agent instructions say under "Your turn in Consensus":',
		'read the plan and the threads waiting on you through the API, reply on the contested ones, apply the resolved ones',
		'one revision each, and re-anchor any thread left detached. Everything you contribute goes into Consensus through',
		'the API; when you are done, print a short summary of what you did.',
	].join( '\n' ),
	Build: [
		'Build the plan at hand in this folder, as the agent instructions say under "The build loop": every thread of the',
		'plan is applied; set the plan Working, implement what the plan says and only that, run the tests, and post the',
		'build log as one contested whole-document thread on the plan, naming your model. Do not commit, branch or push:',
		'git is the owner\'s. When you are done, print a short summary of what you built.',
	].join( '\n' ),
	Session: '',
};


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


//---------------------------------------------------------------------
// Build: the whole prompt.

function Build( Request )
{
	let request = Request || {};
	let kind = KINDS.includes( request.Kind ) ? request.Kind : 'session';
	let llm = request.Llm || {};
	let checks = Object.assign( {}, DEFAULT_CHECKS, llm.Checks || {} );
	let prompts = Object.assign( {}, DEFAULT_PROMPTS, llm.Prompts || {} );
	let participant = request.Participant || 'llm';
	let lines = [];

	lines.push( '# A ' + kind + ' one-shot from Consensus Desktop' );
	lines.push( '' );
	lines.push( 'You are the `' + participant + '` participant of the Consensus server below, run once by Consensus Desktop' + ( llm.Name ? ' through its LLM connection "' + llm.Name + '"' : '' ) + '.' );
	heading( lines, 'This run' );
	lines.push( '- Kind: ' + kind );
	if ( request.Server && request.Server.Url )
	{
		lines.push( '- Consensus API: ' + String( request.Server.Url ).replace( /\/+$/, '' ) + '/api' );
	}
	if ( request.Project )
	{
		lines.push( '- Project: ' + request.Project.Name + ' (' + request.Project.Id + ')' );
	}
	if ( request.Plan )
	{
		lines.push( '- The plan at hand: ' + request.Plan.Title + ' (' + request.Plan.Id + ')' + ( request.Plan.State ? ', state ' + request.Plan.State : '' ) );
	}
	else
	{
		lines.push( '- No plan is selected.' );
	}
	if ( request.Workspace )
	{
		lines.push( '- Workspace: ' + request.Workspace.Name + ', the folder ' + request.Workspace.Path + ' (this run\'s working folder)' );
	}
	else
	{
		lines.push( '- No workspace: this run has no folder of files.' );
	}

	if ( checks.Instructions && request.Instructions )
	{
		heading( lines, request.InstructionsTitle || 'Agent instructions' );
		push_text( lines, request.Instructions );
	}
	if ( checks.Readme && request.Readme )
	{
		heading( lines, 'Readme of ' + ( request.Project ? request.Project.Name : 'the project' ) + ' (' + request.Readme.Id + ')' );
		push_text( lines, request.Readme.Text );
	}
	if ( checks.Documents && request.Documents && request.Documents.length )
	{
		heading( lines, 'Other documents of the Context folder' );
		lines.push( request.DocumentsHint || 'Read one through the API: GET /api/proposals/<id>.' );
		lines.push( '' );
		for ( let document of request.Documents )
		{
			lines.push( '- ' + document.Title + ' (' + document.Id + ')' );
		}
	}
	if ( checks.Threads && request.Plan )
	{
		let threads = request.Threads || [];
		heading( lines, 'Threads of the plan waiting on ' + participant );
		if ( !threads.length )
		{
			lines.push( 'None.' );
		}
		for ( let thread of threads )
		{
			push_thread( lines, thread );
		}
	}
	if ( kind === 'review' && prompts.Review )
	{
		heading( lines, 'Your task: review' );
		lines.push( prompts.Review.replace( /\s+$/, '' ) );
	}
	if ( kind === 'build' && prompts.Build )
	{
		heading( lines, 'Your task: build' );
		lines.push( prompts.Build.replace( /\s+$/, '' ) );
	}
	if ( prompts.Session && String( prompts.Session ).trim() )
	{
		heading( lines, ( kind === 'session' ) ? 'Your task' : 'Further instructions' );
		lines.push( String( prompts.Session ).replace( /\s+$/, '' ) );
	}
	return lines.join( '\n' ) + '\n';
}


module.exports = {
	KINDS: KINDS,
	CHECK_ITEMS: CHECK_ITEMS,
	DEFAULT_CHECKS: DEFAULT_CHECKS,
	DEFAULT_PROMPTS: DEFAULT_PROMPTS,
	Build: Build,
};
