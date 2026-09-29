'use strict';

// Consensus's side of the workers (plans Workers and Review): the worker routes with a worker's token, destinations,
// a project's workspace, review jobs from queue to carried-out answer, reviews of one thread, and the thread and plan
// actions. A worker is played here with fetch.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const FS = require( 'fs' );
const OS = require( 'os' );
const PATH = require( 'path' );
const SERVER = require( '../src/Server.js' );
const PARTICIPANTS = require( '../src/Participants.js' );
const WORKERS = require( '../src/Workers.js' );

const WORKER_TOKEN = 'worker-token-0123456789abcdef';
const OTHER_TOKEN = 'other-token-0123456789abcdef';
const TEXT = [
	'# Worker plan',
	'',
	'The first paragraph says what the worker does.',
	'',
	'A closing paragraph.',
	'',
].join( '\n' );

let running = null;
let skew = 0;	// added to the workers' clock: a worker goes quiet without the test waiting a minute
let llm_answer = null;
let llm_prompts = [];


function fake_caller()
{
	return async function ( Prompt )
	{
		llm_prompts.push( Prompt );
		return await llm_answer( Prompt );
	};
}


async function call( method, path, body, authorization )
{
	let headers = {};
	if ( body !== undefined )
	{
		headers[ 'Content-Type' ] = 'application/json';
	}
	if ( authorization )
	{
		headers.Authorization = authorization;
	}
	let response = await fetch( running.Url + path, { method: method, headers: headers, body: ( body === undefined ) ? undefined : JSON.stringify( body ) } );
	let json = await response.json();
	return { Status: response.status, Body: json };
}


function as_worker( method, path, body, token )
{
	return call( method, path, body, 'Bearer ' + ( token || WORKER_TOKEN ) );
}


async function project_named( name )
{
	let made = await call( 'POST', '/api/projects', { Name: name } );
	ASSERT.equal( made.Status, 201 );
	return made.Body.Project;
}


async function plan_in( project, title )
{
	let made = await call( 'POST', '/api/proposals', { Title: title, Text: TEXT, Project: project.Id } );
	ASSERT.equal( made.Status, 201 );
	return made.Body.Proposal;
}


async function wait_idle( id )
{
	for ( let attempt = 0; attempt < 300; attempt++ )
	{
		let read = await call( 'GET', '/api/proposals/' + id );
		if ( !read.Body.Llm.Running )
		{
			return read;
		}
		await new Promise( function ( resolve ) { setTimeout( resolve, 20 ); } );
	}
	throw new Error( 'the session did not end' );
}


async function hello()
{
	let said = await as_worker( 'POST', '/api/workers/hello', {
		Workspaces: [ { Name: 'Code', Build: true } ],
		Inference: [ { Name: 'Claude', Type: 'claude-cli' }, { Name: 'Ollama', Type: 'ollama', Models: [ 'a-model', 'b-model' ] } ],
	} );
	ASSERT.equal( said.Status, 200 );
}


TEST.before( async function ()
{
	let folder = FS.mkdtempSync( PATH.join( OS.tmpdir(), 'consensus-workers-' ) );
	let settings = PARTICIPANTS.DefaultSettings( 0 );
	settings.Host = '127.0.0.1';
	settings.Workers = [ { Name: 'Box', Token: WORKER_TOKEN }, { Name: 'Quiet', Token: OTHER_TOKEN } ];
	FS.writeFileSync( PATH.join( folder, 'consensus.json' ), JSON.stringify( settings, null, '\t' ) );
	running = await SERVER.Start( { Data: folder, Port: 0, Caller: fake_caller, Workers: { WaitSeconds: 1, Now: function () { return Date.now() + skew; } } } );
} );


TEST.after( async function ()
{
	await running.Close();
} );


//---------------------------------------------------------------------

TEST( 'Validate: a Name without "/", a Token of 16 or more, none shared with a participant', function ()
{
	ASSERT.deepEqual( WORKERS.Validate( {} ), [] );
	ASSERT.deepEqual( WORKERS.Validate( { Workers: 'no' } ), [ 'Workers must be a list' ] );
	let problems = WORKERS.Validate( {
		Participants: [ { Name: 'llm', Token: WORKER_TOKEN } ],
		Workers: [ { Name: 'A/B', Token: 'short' }, { Name: 'Box', Token: WORKER_TOKEN }, { Name: 'Box', Token: WORKER_TOKEN }, {} ],
	} );
	ASSERT.ok( problems.some( function ( line ) { return /holds no "\/"/.test( line ); } ) );
	ASSERT.ok( problems.some( function ( line ) { return /Token of 16/.test( line ); } ) );
	ASSERT.ok( problems.some( function ( line ) { return /named twice/.test( line ); } ) );
	ASSERT.ok( problems.some( function ( line ) { return /shares its Token/.test( line ); } ) );
	ASSERT.ok( problems.some( function ( line ) { return /also the participant "llm"/.test( line ); } ) );
	ASSERT.ok( problems.some( function ( line ) { return /has no Name/.test( line ); } ) );
} );


TEST( 'the worker routes take a worker\'s token only; hello makes it online with its destinations', async function ()
{
	let none = await call( 'POST', '/api/workers/hello', {} );
	ASSERT.equal( none.Status, 401 );
	let participant = await call( 'GET', '/api/workers/jobs', undefined, 'Bearer nobody-has-this-token' );
	ASSERT.equal( participant.Status, 401 );

	await hello();
	let listed = ( await call( 'GET', '/api/workers' ) ).Body.Workers;
	let box = listed.find( function ( worker ) { return worker.Name === 'Box'; } );
	ASSERT.equal( box.Online, true );
	ASSERT.deepEqual( box.Workspaces, [ { Name: 'Code', Build: true } ] );
	let quiet = listed.find( function ( worker ) { return worker.Name === 'Quiet'; } );
	ASSERT.equal( quiet.Online, false );

	let destinations = ( await call( 'GET', '/api/llm/destinations' ) ).Body.Destinations;
	let claude = destinations.find( function ( destination ) { return destination.Name === 'Box / Claude'; } );
	ASSERT.deepEqual( claude, { Name: 'Box / Claude', Kind: 'claude-cli', Model: null, Worker: 'Box', Offline: false } );
	let models = await call( 'GET', '/api/llm/models?destination=' + encodeURIComponent( 'Box / Ollama' ) );
	ASSERT.deepEqual( models.Body.Models, [ 'a-model', 'b-model' ] );

	let empty = await as_worker( 'GET', '/api/workers/jobs' );
	ASSERT.equal( empty.Status, 200 );
	ASSERT.deepEqual( empty.Body, {} );
} );


TEST( 'a project\'s workspace: only one a worker offers, owner only, and it shows on the project', async function ()
{
	await hello();
	let project = await project_named( 'Workspace project' );
	let wrong = await call( 'PUT', '/api/projects/' + project.Id + '/workspace', { Worker: 'Box', Name: 'Nope' } );
	ASSERT.equal( wrong.Status, 400 );
	let set = await call( 'PUT', '/api/projects/' + project.Id + '/workspace', { Worker: 'Box', Name: 'Code' } );
	ASSERT.equal( set.Status, 200 );
	let shown = ( await call( 'GET', '/api/projects' ) ).Body.Projects.find( function ( candidate ) { return candidate.Id === project.Id; } );
	ASSERT.deepEqual( shown.Workspace, { Worker: 'Box', Name: 'Code', Online: true, Offered: true, Build: true } );
	let cleared = await call( 'PUT', '/api/projects/' + project.Id + '/workspace', { Worker: null } );
	ASSERT.equal( cleared.Status, 200 );
	shown = ( await call( 'GET', '/api/projects' ) ).Body.Projects.find( function ( candidate ) { return candidate.Id === project.Id; } );
	ASSERT.equal( shown.Workspace, null );
} );


TEST( 'a review sent to a worker: queued as a job, its tools and steps answered, its answer carried out', async function ()
{
	await hello();
	let project = await project_named( 'Review project' );
	let plan = await plan_in( project, 'Reviewed plan' );
	let id = plan.Id;
	let question = ( await call( 'POST', '/api/proposals/' + id + '/threads', { Anchor: { Text: 'A closing paragraph.' }, Text: 'Is this needed?' } ) ).Body.Thread;

	let no_workspace = await call( 'POST', '/api/proposals/' + id + '/session', { Destination: 'Box / Claude' } );
	ASSERT.equal( no_workspace.Status, 409 );
	ASSERT.match( no_workspace.Body.Error, /names no workspace/ );
	await call( 'PUT', '/api/projects/' + project.Id + '/workspace', { Worker: 'Box', Name: 'Code' } );

	let sent = await call( 'POST', '/api/proposals/' + id + '/session', { Destination: 'Box / Claude' } );
	ASSERT.equal( sent.Status, 202 );
	ASSERT.deepEqual( sent.Body.Threads, [ question.Id ] );
	let again = await call( 'POST', '/api/proposals/' + id + '/session', { Destination: 'Box / Claude' } );
	ASSERT.equal( again.Status, 409 );

	let taken = await as_worker( 'GET', '/api/workers/jobs' );
	let job = taken.Body.Job;
	ASSERT.equal( job.Kind, 'Review' );
	ASSERT.equal( job.Proposal, id );
	ASSERT.equal( job.Workspace, 'Code' );
	ASSERT.equal( job.Inference, 'Claude' );
	ASSERT.deepEqual( job.Project, { Id: project.Id, Name: 'Review project' } );
	ASSERT.match( job.Prompt, /# Your tools/ );
	ASSERT.doesNotMatch( job.Prompt, /# Asking for more/ );
	ASSERT.match( job.Prompt, /WAITING ON YOU to reply/ );
	ASSERT.ok( job.Schema.properties.Actions );

	let other = await as_worker( 'POST', '/api/workers/jobs/' + job.Id + '/tool', { Tool: 'list_project' }, OTHER_TOKEN );
	ASSERT.equal( other.Status, 404 );
	let bad_tool = await as_worker( 'POST', '/api/workers/jobs/' + job.Id + '/tool', { Tool: 'read_file' } );
	ASSERT.equal( bad_tool.Status, 400 );
	let listed = await as_worker( 'POST', '/api/workers/jobs/' + job.Id + '/tool', { Tool: 'list_project' } );
	ASSERT.match( listed.Body.Result, /plan "Reviewed plan"/ );
	let read = await as_worker( 'POST', '/api/workers/jobs/' + job.Id + '/tool', { Tool: 'read_plan', Plan: 'Reviewed plan' } );
	ASSERT.equal( read.Body.Result, TEXT );
	let step = await as_worker( 'POST', '/api/workers/jobs/' + job.Id + '/step', { Text: 'Read src/Worker.js', Seconds: 0.2 } );
	ASSERT.equal( step.Status, 200 );

	let answered = await as_worker( 'POST', '/api/workers/jobs/' + job.Id + '/answer', {
		Answer: { Actions: [
			{ Thread: question.Id, Kind: 'reply', Reply: 'It closes the plan. Outcome: no change.' },
			{ Kind: 'thread', Text: 'The first paragraph could name the tools.', Anchor: 'The first paragraph' },
			{ Kind: 'thread', Text: 'Not anchored where it says.', Anchor: 'words that are not there' },
			{ Kind: 'plan', Title: 'A Subplan', Text: '# A Subplan\n', Parent: 'Reviewed plan' },
			{ Kind: 'plan', Title: 'Beside it', Text: '# Beside it\n' },
			{ Kind: 'plan', Title: 'Nowhere', Text: '# Nowhere\n', Parent: 'No such folder' },
		] },
		Usage: { Model: 'fake-claude', Input: 500, Output: 50 },
	} );
	ASSERT.equal( answered.Status, 200 );
	ASSERT.equal( answered.Body.Actions, 6 );
	let finished = await as_worker( 'POST', '/api/workers/jobs/' + job.Id + '/answer', { Answer: { Actions: [] } } );
	ASSERT.equal( finished.Status, 409 );

	let after = await wait_idle( id );
	let threads = after.Body.Threads;
	let replied = threads.find( function ( thread ) { return thread.Id === question.Id; } );
	ASSERT.equal( replied.Replies[ 1 ].By, 'llm' );
	let opened = threads.filter( function ( thread ) { return thread.Id !== question.Id; } );
	ASSERT.equal( opened.length, 1 );
	ASSERT.equal( opened[ 0 ].Replies[ 0 ].By, 'llm' );
	ASSERT.equal( opened[ 0 ].Anchor.Text, 'The first paragraph' );
	ASSERT.equal( opened[ 0 ].Status, 'contested' );

	let tree = ( await call( 'GET', '/api/projects' ) ).Body.Projects.find( function ( candidate ) { return candidate.Id === project.Id; } );
	let reviewed = tree.Items.find( function ( item ) { return item.Id === id; } );
	ASSERT.deepEqual( reviewed.Items.map( function ( item ) { return item.Title; } ), [ 'A Subplan' ] );
	ASSERT.ok( tree.Items.some( function ( item ) { return item.Title === 'Beside it' && item.State === 'Proposal'; } ) );
	ASSERT.ok( !JSON.stringify( tree ).includes( 'Nowhere' ) );

	let runs = ( await call( 'GET', '/api/proposals/' + id + '/runs' ) ).Body.Runs;
	let steps = runs[ runs.length - 1 ].Steps.map( function ( one ) { return one.Text; } );
	ASSERT.ok( steps.some( function ( text ) { return /queued the review for Box \/ Claude/.test( text ); } ) );
	ASSERT.ok( steps.some( function ( text ) { return /Box took job/.test( text ); } ) );
	ASSERT.ok( steps.includes( 'Read src/Worker.js' ) );
	ASSERT.ok( steps.some( function ( text ) { return /fake-claude answered on Box: 1 reply, 2 new threads, 3 new plans/.test( text ); } ) );
	let last = steps[ steps.length - 1 ];
	ASSERT.match( last, /made thread thr-/ );
	ASSERT.match( last, /plan "A Subplan"/ );
	ASSERT.match( last, /2 refused/ );
	ASSERT.match( last, /the anchor text was not found/ );
	ASSERT.match( last, /no folder or plan "No such folder"/ );
	ASSERT.ok( runs[ runs.length - 1 ].Finished );
} );


TEST( 'a worker that goes quiet: its job fails, the threads say why, and the session ends', async function ()
{
	await hello();
	let project = await project_named( 'Quiet project' );
	await call( 'PUT', '/api/projects/' + project.Id + '/workspace', { Worker: 'Box', Name: 'Code' } );
	let plan = await plan_in( project, 'Left waiting' );
	let question = ( await call( 'POST', '/api/proposals/' + plan.Id + '/threads', { Text: 'Anyone there?' } ) ).Body.Thread;
	let sent = await call( 'POST', '/api/proposals/' + plan.Id + '/session', { Destination: 'Box / Claude' } );
	ASSERT.equal( sent.Status, 202 );
	let taken = await as_worker( 'GET', '/api/workers/jobs' );
	ASSERT.ok( taken.Body.Job );
	skew = 61000;
	running.Workers.Sweep();
	let after = await wait_idle( plan.Id );
	let thread = after.Body.Threads.find( function ( candidate ) { return candidate.Id === question.Id; } );
	ASSERT.match( thread.CallFailed.Reason, /went offline/ );
	let destinations = ( await call( 'GET', '/api/llm/destinations' ) ).Body.Destinations;
	ASSERT.equal( destinations.find( function ( destination ) { return destination.Name === 'Box / Claude'; } ).Offline, true );
	let refused = await call( 'POST', '/api/proposals/' + plan.Id + '/session', { Destination: 'Box / Claude' } );
	ASSERT.equal( refused.Status, 409 );
	ASSERT.match( refused.Body.Error, /offline/ );
} );


TEST( 'a review of one thread: only that thread is sent and acted on, even one waiting on the owner', async function ()
{
	let project = await project_named( 'Focus project' );
	let plan = await plan_in( project, 'Focused plan' );
	let id = plan.Id;
	let first = ( await call( 'POST', '/api/proposals/' + id + '/threads', { Text: 'First question?' } ) ).Body.Thread;
	let second = ( await call( 'POST', '/api/proposals/' + id + '/threads', { Text: 'Second question?' } ) ).Body.Thread;
	let applied = await call( 'POST', '/api/proposals/' + id + '/threads', { Text: 'Settled.', Resolve: true } );
	await call( 'POST', '/api/proposals/' + id + '/threads/' + applied.Body.Thread.Id + '/apply', { Outcome: 'noted', Revision: 1 }, 'Bearer ' + llm_token() );

	llm_prompts = [];
	llm_answer = async function ()
	{
		return { Answer: { Actions: [
			{ Thread: first.Id, Kind: 'reply', Reply: 'Answered.' },
			{ Thread: second.Id, Kind: 'reply', Reply: 'Not in focus.' },
		] }, Usage: { Model: 'fake', Input: 1, Output: 1 } };
	};
	let sent = await call( 'POST', '/api/proposals/' + id + '/session', { Destination: 'Claude CLI', Options: { Thread: first.Id } } );
	ASSERT.equal( sent.Status, 202 );
	ASSERT.deepEqual( sent.Body.Threads, [ first.Id ] );
	let after = await wait_idle( id );
	ASSERT.match( llm_prompts[ 0 ], /You were asked to review one thread, thr-/ );
	ASSERT.match( llm_prompts[ 0 ], /First question\?/ );
	ASSERT.ok( llm_prompts[ 0 ].includes( '## Thread ' + first.Id ) );
	ASSERT.ok( !llm_prompts[ 0 ].includes( '## Thread ' + second.Id ) );
	ASSERT.equal( after.Body.Threads.find( function ( thread ) { return thread.Id === first.Id; } ).Replies.length, 2 );
	ASSERT.equal( after.Body.Threads.find( function ( thread ) { return thread.Id === second.Id; } ).Replies.length, 1 );

	// Now the first waits on the owner: a review of it still lets the llm reply.
	llm_answer = async function ()
	{
		return { Answer: { Actions: [ { Thread: first.Id, Kind: 'reply', Reply: 'One more thing.' } ] }, Usage: { Model: 'fake', Input: 1, Output: 1 } };
	};
	let again = await call( 'POST', '/api/proposals/' + id + '/session', { Destination: 'Claude CLI', Options: { Thread: first.Id } } );
	ASSERT.equal( again.Status, 202 );
	after = await wait_idle( id );
	ASSERT.equal( after.Body.Threads.find( function ( thread ) { return thread.Id === first.Id; } ).Replies.length, 3 );

	let done = await call( 'POST', '/api/proposals/' + id + '/session', { Destination: 'Claude CLI', Options: { Thread: applied.Body.Thread.Id } } );
	ASSERT.equal( done.Status, 409 );
	let missing = await call( 'POST', '/api/proposals/' + id + '/session', { Destination: 'Claude CLI', Options: { Thread: 'thr-000-000-000' } } );
	ASSERT.equal( missing.Status, 404 );
} );


function llm_token()
{
	let llm = running.Settings.Participants.find( function ( participant ) { return participant.Role === 'llm'; } );
	if ( !llm.Token )
	{
		llm.Token = PARTICIPANTS.NewToken();
	}
	return llm.Token;
}


//---------------------------------------------------------------------
// Build (plan Build)

// The next job or change the worker Box is given, asking until there is one.
async function next_for_box()
{
	for ( let attempt = 0; attempt < 10; attempt++ )
	{
		let given = await as_worker( 'GET', '/api/workers/jobs' );
		if ( given.Body.Job || given.Body.Change )
		{
			return given.Body;
		}
	}
	throw new Error( 'Box was given nothing' );
}


async function read_plan( id )
{
	return ( await call( 'GET', '/api/proposals/' + id ) ).Body;
}


TEST( 'build: ready only with a workspace that builds and every thread applied; its job, its log, its threads', async function ()
{
	await hello();
	let project = await project_named( 'Build project' );
	let plan = await plan_in( project, 'Built plan' );
	let id = plan.Id;
	ASSERT.equal( ( await read_plan( id ) ).Build.Reason, 'the project names no workspace' );
	await call( 'PUT', '/api/projects/' + project.Id + '/workspace', { Worker: 'Box', Name: 'Code' } );
	let open = ( await call( 'POST', '/api/proposals/' + id + '/threads', { Text: 'Settle this first.' } ) ).Body.Thread;
	ASSERT.equal( ( await read_plan( id ) ).Build.Reason, '1 thread is not applied yet' );
	let refused = await call( 'POST', '/api/proposals/' + id + '/build', {} );
	ASSERT.equal( refused.Status, 409 );
	await call( 'POST', '/api/proposals/' + id + '/threads/' + open.Id + '/resolve' );
	await call( 'POST', '/api/proposals/' + id + '/threads/' + open.Id + '/apply', { Outcome: 'settled', Revision: 1 }, 'Bearer ' + llm_token() );
	let view = ( await read_plan( id ) ).Build;
	ASSERT.equal( view.Ready, true );
	ASSERT.deepEqual( view.Destinations, [ { Name: 'Box / Claude', Model: null } ] );
	ASSERT.equal( ( await call( 'POST', '/api/proposals/' + id + '/build', { Destination: 'Box / Ollama' } ) ).Status, 400 );

	let started = await call( 'POST', '/api/proposals/' + id + '/build', { Destination: 'Box / Claude', Model: 'opus' } );
	ASSERT.equal( started.Status, 202 );
	ASSERT.equal( ( await read_plan( id ) ).Proposal.State, 'Working' );
	let given = await next_for_box();
	let job = given.Job;
	ASSERT.equal( job.Kind, 'Build' );
	ASSERT.equal( job.Model, 'opus' );
	ASSERT.equal( job.Workspace, 'Code' );
	ASSERT.match( job.Prompt, /# The plan to build: "Built plan"/ );
	ASSERT.match( job.Prompt, /Do nothing with git/ );
	ASSERT.deepEqual( job.Schema.required, [ 'BuildLog' ] );
	ASSERT.equal( ( await read_plan( id ) ).Build.Reason, 'a review or build of this plan is running' );

	let answered = await as_worker( 'POST', '/api/workers/jobs/' + job.Id + '/answer', {
		Answer: {
			BuildLog: 'Built the worker in src/Worker.js; node --test passes.',
			Context: '# Context\n\nThe plan is built.\n',
			Threads: [ { Text: 'I read "closing" as the end.', Anchor: 'A closing paragraph.' }, { Text: 'Not anchored where it says.', Anchor: 'nowhere at all' } ],
		},
		Usage: { Model: 'claude-builder', Input: 1200, Output: 300 },
	} );
	ASSERT.equal( answered.Status, 200 );
	let after = await wait_idle( id );
	let log = after.Body.Threads.find( function ( thread ) { return thread.Build && thread.Build.Log; } );
	ASSERT.equal( log.Anchor, null );
	ASSERT.equal( log.Status, 'contested' );
	ASSERT.equal( log.Replies[ 0 ].By, 'llm' );
	ASSERT.match( log.Replies[ 0 ].Text, /^\*\*Build log\*\*: job job-[0-9a-z-]+, worker Box, workspace Code, claude-builder, 1,200 in, 300 out\./ );
	ASSERT.match( log.Replies[ 0 ].Text, /node --test passes/ );
	ASSERT.match( log.Replies[ 0 ].Text, /Threads this build opened: thr-/ );
	let questions = after.Body.Threads.filter( function ( thread ) { return thread.Build && !thread.Build.Log; } );
	ASSERT.equal( questions.length, 2 );
	ASSERT.equal( questions[ 0 ].Anchor.Text, 'A closing paragraph.' );
	ASSERT.equal( questions[ 1 ].Anchor, null );
	ASSERT.match( questions[ 1 ].Replies[ 0 ].Text, /was not found in the plan/ );
	ASSERT.equal( after.Body.Build.Ready, true );
	ASSERT.equal( after.Body.Build.SentBack, null );
	let runs = ( await call( 'GET', '/api/proposals/' + id + '/runs' ) ).Body.Runs;
	let steps = runs[ runs.length - 1 ].Steps.map( function ( one ) { return one.Text; } );
	ASSERT.ok( steps.some( function ( text ) { return /queued the build for Box \/ Claude/.test( text ); } ) );
	ASSERT.ok( steps.some( function ( text ) { return /claude-builder built on Box: the build log thr-[0-9a-z-]+, 2 threads opened/.test( text ); } ) );

	// Sent back: a review leaves the log alone; Build again carries the reply, and the new log is a reply on it.
	await call( 'POST', '/api/proposals/' + id + '/threads/' + log.Id + '/replies', { Text: 'The tests do not run on Windows.' } );
	let changed = await next_for_box();
	ASSERT.deepEqual( changed.Change, { Job: job.Id, Change: 'sent back' } );
	let sent_back = await read_plan( id );
	ASSERT.equal( sent_back.Build.SentBack, log.Id );
	ASSERT.equal( sent_back.Llm.Waiting, 0 );
	let again = await call( 'POST', '/api/proposals/' + id + '/build', {} );
	ASSERT.equal( again.Status, 202 );
	let rerun = ( await next_for_box() ).Job;
	ASSERT.equal( rerun.SentBack, log.Id );
	ASSERT.match( rerun.Prompt, /# Sent back/ );
	ASSERT.match( rerun.Prompt, /The tests do not run on Windows\./ );
	ASSERT.match( rerun.Prompt, /node --test passes/ );
	await as_worker( 'POST', '/api/workers/jobs/' + rerun.Id + '/answer', { Answer: { BuildLog: 'The tests run on Windows now.', Context: '' }, Usage: { Model: 'claude-builder', Input: 10, Output: 5 } } );
	after = await wait_idle( id );
	let same = after.Body.Threads.find( function ( thread ) { return thread.Id === log.Id; } );
	ASSERT.equal( same.Replies.length, 3 );
	ASSERT.match( same.Replies[ 2 ].Text, /The tests run on Windows now\./ );
	ASSERT.equal( same.Build.Job, rerun.Id );
	ASSERT.equal( same.Build.Context, '# Context\n\nThe plan is built.\n' );
	ASSERT.equal( after.Body.Threads.filter( function ( thread ) { return thread.Build && thread.Build.Log; } ).length, 1 );

	// Accepted: applied as the outcome alone, the context written, the plan Finished, the worker told.
	let resolved = await call( 'POST', '/api/proposals/' + id + '/threads/' + log.Id + '/resolve' );
	ASSERT.equal( resolved.Status, 200 );
	after = await read_plan( id );
	let accepted = after.Threads.find( function ( thread ) { return thread.Id === log.Id; } );
	ASSERT.equal( accepted.State, 'applied' );
	ASSERT.equal( accepted.Applied.Outcome, 'the build is accepted' );
	ASSERT.equal( after.Proposal.State, 'Finished' );
	ASSERT.equal( after.Proposal.Revision, 1 );
	let projects = ( await call( 'GET', '/api/projects' ) ).Body.Projects;
	let context_id = projects.find( function ( candidate ) { return candidate.Id === project.Id; } ).Context.Id;
	ASSERT.equal( ( await read_plan( context_id ) ).Text, '# Context\n\nThe plan is built.\n' );
	let told = await next_for_box();
	ASSERT.deepEqual( told.Change, { Job: rerun.Id, Change: 'accepted', Proposal: id, Title: 'Built plan' } );
	let after_step = await as_worker( 'POST', '/api/workers/jobs/' + rerun.Id + '/step', { Text: 'Committed 1a2b3c4' } );
	ASSERT.equal( after_step.Status, 200 );
} );


TEST( 'build: a build that fails is said in the run log; one sent back gets the failure as a reply', async function ()
{
	await hello();
	let project = await project_named( 'Failing build' );
	await call( 'PUT', '/api/projects/' + project.Id + '/workspace', { Worker: 'Box', Name: 'Code' } );
	let plan = await plan_in( project, 'Failing plan' );
	ASSERT.equal( ( await call( 'POST', '/api/proposals/' + plan.Id + '/build', {} ) ).Status, 202 );
	let job = ( await next_for_box() ).Job;
	await as_worker( 'POST', '/api/workers/jobs/' + job.Id + '/answer', { Error: 'claude exited 1' } );
	let after = await wait_idle( plan.Id );
	ASSERT.equal( after.Body.Threads.length, 0 );
	let runs = ( await call( 'GET', '/api/proposals/' + plan.Id + '/runs' ) ).Body.Runs;
	ASSERT.ok( runs[ runs.length - 1 ].Steps.some( function ( step ) { return step.Text === 'the build failed on Box: claude exited 1'; } ) );
	let bad = await call( 'POST', '/api/proposals/' + plan.Id + '/build', {} );
	ASSERT.equal( bad.Status, 202 );
	let second = ( await next_for_box() ).Job;
	await as_worker( 'POST', '/api/workers/jobs/' + second.Id + '/answer', { Answer: { Nothing: true } } );
	after = await wait_idle( plan.Id );
	runs = ( await call( 'GET', '/api/proposals/' + plan.Id + '/runs' ) ).Body.Runs;
	ASSERT.ok( runs[ runs.length - 1 ].Steps.some( function ( step ) { return /the build's answer has no BuildLog/.test( step.Text ); } ) );
} );
