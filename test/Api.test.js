'use strict';

// The API, started on port 0 over a temporary folder and driven with fetch.
// Nothing here spawns bin/consensus.js and nothing reads ~data.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const FS = require( 'fs' );
const OS = require( 'os' );
const PATH = require( 'path' );
const HTTP = require( 'http' );
const SERVER = require( '../src/Server.js' );
const PARTICIPANTS = require( '../src/Participants.js' );

const TEXT = [
	'# A plan',
	'',
	'The first paragraph makes a claim about **anchors** and how they survive.',
	'',
	'- one list item',
	'- another list item to comment on',
	'',
	'A closing paragraph.',
	'',
].join( '\n' );

let running = null;
let token = null;


function temporary_folder()
{
	return FS.mkdtempSync( PATH.join( OS.tmpdir(), 'consensus-api-' ) );
}


async function call( method, path, body, as_llm )
{
	let headers = {};
	if ( body !== undefined )
	{
		headers[ 'Content-Type' ] = 'application/json';
	}
	if ( as_llm === true )
	{
		headers.Authorization = 'Bearer ' + token;
	}
	else if ( typeof as_llm === 'string' )
	{
		headers.Authorization = as_llm;
	}
	let response = await fetch( running.Url + path, { method: method, headers: headers, body: ( body === undefined ) ? undefined : JSON.stringify( body ) } );
	let json = await response.json();
	return { Status: response.status, Body: json };
}


async function create( title, text )
{
	let result = await call( 'POST', '/api/plans', { Title: title, Text: ( text === undefined ) ? TEXT : text } );
	ASSERT.equal( result.Status, 201 );
	return result.Body.Plan;
}


// A thread by the owner on the given words, answered by the llm with an outcome.
async function discussed_thread( id, words, outcome )
{
	let thread = ( await call( 'POST', '/api/plans/' + id + '/threads', { Anchor: { Text: words }, Text: 'Please reconsider this.' } ) ).Body.Thread;
	await call( 'POST', '/api/plans/' + id + '/threads/' + thread.Id + '/replies', { Text: outcome }, true );
	return thread;
}


async function project_named( id )
{
	return ( await call( 'GET', '/api/projects' ) ).Body.Projects.find( function ( candidate ) { return candidate.Id === id; } );
}


// A project's items after its Context folder, which is always first.
function after_context( project )
{
	return project.Items.slice( 1 );
}


let home = null;		// the first project's id (plan Run Shapes, Step 2: a prj- id, in a folder of its own)


TEST.before( async function ()
{
	running = await SERVER.Start( { Data: temporary_folder(), Port: 0 } );
	home = ( await running.Store.ListProjects() )[ 0 ].Id;
	// The llm needs no token in the file; these tests play it over the API, so it gets one in memory.
	token = PARTICIPANTS.NewToken();
	running.Settings.Participants[ 1 ].Token = token;
} );


TEST.after( async function ()
{
	await running.Close();
} );


//---------------------------------------------------------------------

TEST( 'start writes the settings with Scope Local and listens on 127.0.0.1; the settings\' Scope or the option changes that; None starts no server', async function ()
{
	ASSERT.equal( running.SettingsWritten, true );
	ASSERT.equal( running.Scope, 'Local' );
	ASSERT.equal( running.Address.Host, '127.0.0.1' );
	ASSERT.equal( running.Address.Local, true );
	ASSERT.equal( running.Settings.Scope, 'Local' );
	ASSERT.equal( running.Settings.Name, require( 'os' ).hostname() );
	ASSERT.equal( FS.existsSync( running.Store.SettingsPath() ), true );
	ASSERT.equal( ( await call( 'GET', '/api/me' ) ).Body.Server, running.Settings.Name );
	// every interface, from the option; reached here at 127.0.0.1; the option does not change the file
	let everywhere = await SERVER.Start( { Config: temporary_folder(), Port: 0, Scope: 'Public' } );
	ASSERT.deepEqual( [ everywhere.Scope, everywhere.Address.Host, everywhere.Address.Local, everywhere.Settings.Scope ], [ 'Public', '0.0.0.0', false, 'Public' ] );
	ASSERT.equal( everywhere.Url, 'http://127.0.0.1:' + everywhere.Address.Port );
	ASSERT.equal( ( await fetch( everywhere.Url + '/api/me' ) ).status, 200 );
	await everywhere.Close();
	// from the settings' Scope; and a file from before, its Host turned into a Scope
	let folder = temporary_folder();
	let settings = PARTICIPANTS.DefaultSettings( 0, 'Public' );
	FS.writeFileSync( PATH.join( folder, 'consensus.json' ), JSON.stringify( settings ) );
	let from_settings = await SERVER.Start( { Config: folder, Port: 0 } );
	ASSERT.deepEqual( [ from_settings.Scope, from_settings.Address.Host, from_settings.Address.Local ], [ 'Public', '0.0.0.0', false ] );
	await from_settings.Close();
	let older = temporary_folder();
	FS.writeFileSync( PATH.join( older, 'consensus.json' ), JSON.stringify( { Port: 0, Host: '0.0.0.0', Participants: settings.Participants } ) );
	let migrated = await SERVER.Start( { Config: older, Port: 0 } );
	ASSERT.deepEqual( [ migrated.Scope, migrated.Settings.Scope, 'Host' in migrated.Settings, migrated.Settings.Name ], [ 'Public', 'Public', false, require( 'os' ).hostname() ] );
	ASSERT.equal( JSON.parse( FS.readFileSync( PATH.join( older, 'consensus.json' ), 'utf8' ) ).Scope, 'Public' );
	await migrated.Close();
	// Scope None: the settings and the store, no server; the option overrides the file for this start only
	let none = await SERVER.Start( { Config: folder, Port: 0, Scope: 'None' } );
	ASSERT.deepEqual( [ none.Scope, none.Server, none.Address, none.Url, none.Settings.Scope ], [ 'None', null, null, null, 'Public' ] );
	await none.Close();
	let again = await SERVER.Start( { Data: running.Store.Folder, Port: 0 } );
	ASSERT.equal( again.SettingsWritten, false );
	ASSERT.deepEqual( again.Settings.Participants[ 1 ], { Name: 'llm', Display: 'LLM', Role: 'llm' } );
	await again.Close();
	// settings with problems stop the start
	let broken = temporary_folder();
	FS.writeFileSync( PATH.join( broken, 'consensus.json' ), JSON.stringify( { Port: 0, Participants: [] } ) );
	await ASSERT.rejects( SERVER.Start( { Data: broken, Port: 0 } ), /no participant has the owner role/ );
} );


TEST( 'instructions: plain text, This server first with the address the request reached and the llm token, then the guide', async function ()
{
	let response = await fetch( running.Url + '/instructions' );
	ASSERT.equal( response.status, 200 );
	ASSERT.match( response.headers.get( 'content-type' ), /^text\/plain; charset=utf-8/ );
	let text = await response.text();
	ASSERT.ok( text.startsWith( '# This server\n' ) );
	ASSERT.ok( text.includes( '- API: ' + running.Url + '/api\n' ) );
	ASSERT.ok( text.includes( token ) );
	let guide = FS.readFileSync( PATH.join( __dirname, '..', '.guides', 'build-with-consensus.md' ), 'utf8' );
	ASSERT.ok( text.endsWith( guide ) );
	// the address is the one the request reached, as its Host header names it
	let by_name = await new Promise( function ( resolve, reject )
	{
		let request = HTTP.get( { host: '127.0.0.1', port: running.Address.Port, path: '/instructions', headers: { Host: 'consensus.example:8080' } }, function ( answer )
		{
			let body = '';
			answer.on( 'data', function ( chunk ) { body += chunk; } );
			answer.on( 'end', function () { resolve( body ); } );
		} );
		request.on( 'error', reject );
	} );
	ASSERT.ok( by_name.includes( '- API: http://consensus.example:8080/api\n' ) );
} );


TEST( 'identity: no header is the owner, the token is the llm, a wrong token is refused', async function ()
{
	let owner = await call( 'GET', '/api/me' );
	ASSERT.equal( owner.Status, 200 );
	ASSERT.deepEqual( owner.Body.Me, { Name: 'user', Display: 'User', Role: 'owner' } );
	ASSERT.equal( owner.Body.Participants.some( function ( participant ) { return 'Token' in participant; } ), false );
	ASSERT.equal( owner.Body.Version, require( '../package.json' ).version );
	let llm = await call( 'GET', '/api/me', undefined, true );
	ASSERT.equal( llm.Body.Me.Name, 'llm' );
	let wrong = await call( 'GET', '/api/me', undefined, 'Bearer nope' );
	ASSERT.equal( wrong.Status, 401 );
	ASSERT.equal( wrong.Body.Error, 'unknown token' );
} );


TEST( 'settings: the owner reads and writes consensus.json; problems are refused; Scope and Port wait for a restart; other fields stay', async function ()
{
	ASSERT.equal( ( await call( 'GET', '/api/settings', undefined, true ) ).Status, 403 );
	ASSERT.equal( ( await call( 'PUT', '/api/settings', { Settings: {} }, true ) ).Status, 403 );
	let read = await call( 'GET', '/api/settings' );
	ASSERT.equal( read.Status, 200 );
	ASSERT.equal( read.Body.Path, running.Store.SettingsPath() );
	ASSERT.deepEqual( read.Body.Settings.States, [ 'Draft', 'Plan', 'Working', 'Finished' ] );
	ASSERT.equal( read.Body.Settings.Participants[ 1 ].Token, token );

	// problems: none written
	let bad = await call( 'PUT', '/api/settings', { Settings: Object.assign( {}, read.Body.Settings, { Participants: [ { Name: 'x', Role: 'member' } ] } ) } );
	ASSERT.equal( bad.Status, 400 );
	ASSERT.deepEqual( bad.Body.Problems, [ 'no participant has the owner role' ] );
	let plan = await create( 'In a state' );
	await call( 'PUT', '/api/plans/' + plan.Id + '/state', { State: 'Working' } );
	// the settings' list is the default for a new project; a project's own list (plan Run Shapes, Step 2) refuses a state in use
	let in_use = await call( 'PUT', '/api/projects/' + home, { States: [ 'Draft', 'Finished' ] } );
	ASSERT.equal( in_use.Status, 400 );
	ASSERT.match( in_use.Body.Error, /"Working" is used by the plan "In a state"/ );
	ASSERT.equal( ( await call( 'PUT', '/api/settings', { Settings: Object.assign( {}, read.Body.Settings, { States: [ 'Draft', 'Finished' ] } ) } ) ).Status, 200 );
	ASSERT.deepEqual( ( await call( 'GET', '/api/me' ) ).Body.States, [ 'Draft', 'Finished' ] );
	ASSERT.equal( ( await call( 'PUT', '/api/settings', { Settings: read.Body.Settings } ) ).Status, 200 );
	ASSERT.deepEqual( ( await call( 'GET', '/api/me' ) ).Body.States, [ 'Draft', 'Plan', 'Working', 'Finished' ] );

	// written: the states, a member with a token, the display; the file and the running server follow at once
	let member_token = PARTICIPANTS.NewToken();
	// the desktop's fields in the same file (plan Run Shapes) are not the modal's to write: they stay
	await running.Store.WriteSettings( Object.assign( {}, read.Body.Settings, { Servers: [ { Name: 'cube4', Url: 'http://cube4:3500' } ] } ) );
	running.Settings.Servers = [ { Name: 'cube4', Url: 'http://cube4:3500' } ];
	let fresh = {
		Port: read.Body.Settings.Port,
		Scope: read.Body.Settings.Scope,
		Name: 'renamed',
		States: [ 'Draft', 'Plan', 'Working', 'Finished', 'Shelved' ],
		Participants: [ { Name: 'user', Display: 'Owner', Role: 'owner' }, { Name: 'llm', Display: 'LLM', Role: 'llm', Token: token }, { Name: 'ann', Display: 'Ann', Role: 'member', Token: member_token } ],
		Workers: [ { Name: 'gone' } ],
	};
	let written = await call( 'PUT', '/api/settings', { Settings: fresh } );
	ASSERT.equal( written.Status, 200 );
	ASSERT.equal( written.Body.Restart, false );
	ASSERT.equal( 'Workers' in written.Body.Settings, false );
	ASSERT.deepEqual( written.Body.Settings.Servers, [ { Name: 'cube4', Url: 'http://cube4:3500' } ] );
	ASSERT.equal( ( await call( 'GET', '/api/me' ) ).Body.Server, 'renamed' );
	ASSERT.deepEqual( ( await call( 'GET', '/api/me' ) ).Body.States, fresh.States );
	ASSERT.deepEqual( ( await call( 'GET', '/api/me' ) ).Body.Me, { Name: 'user', Display: 'Owner', Role: 'owner' } );
	ASSERT.equal( ( await call( 'GET', '/api/me', undefined, 'Bearer ' + member_token ) ).Body.Me.Name, 'ann' );
	let on_disk = JSON.parse( FS.readFileSync( running.Store.SettingsPath(), 'utf8' ) );
	ASSERT.deepEqual( on_disk.States, fresh.States );
	ASSERT.equal( on_disk.Participants[ 2 ].Token, member_token );
	ASSERT.deepEqual( on_disk.Servers, [ { Name: 'cube4', Url: 'http://cube4:3500' } ] );
	ASSERT.equal( ( await call( 'PUT', '/api/plans/' + plan.Id + '/state', { State: 'Shelved' } ) ).Status, 400 );
	let project_states = await call( 'PUT', '/api/projects/' + home, { States: fresh.States } );
	ASSERT.equal( project_states.Status, 200 );
	ASSERT.deepEqual( project_states.Body.Project.States, fresh.States );
	ASSERT.equal( ( await call( 'PUT', '/api/plans/' + plan.Id + '/state', { State: 'Shelved' } ) ).Status, 200 );

	// a new Port or Scope asks for a restart; the file has it, the server still listens where it did
	let moved = await call( 'PUT', '/api/settings', { Settings: Object.assign( {}, fresh, { Port: 3999 } ) } );
	ASSERT.equal( moved.Body.Restart, true );
	ASSERT.equal( JSON.parse( FS.readFileSync( running.Store.SettingsPath(), 'utf8' ) ).Port, 3999 );
	ASSERT.equal( ( await fetch( running.Url + '/api/me' ) ).status, 200 );
	let scoped = await call( 'PUT', '/api/settings', { Settings: Object.assign( {}, fresh, { Port: 3999, Scope: 'Public' } ) } );
	ASSERT.deepEqual( [ scoped.Body.Restart, scoped.Body.Settings.Scope ], [ true, 'Public' ] );
	ASSERT.equal( ( await call( 'PUT', '/api/settings', { Settings: Object.assign( {}, fresh, { Scope: 'everywhere' } ) } ) ).Body.Problems[ 0 ], 'Scope must be one of None, Local, Public' );

	// back to what the other tests expect
	let back = await call( 'PUT', '/api/settings', { Settings: Object.assign( {}, read.Body.Settings, { States: fresh.States } ) } );
	ASSERT.equal( back.Status, 200 );
	ASSERT.equal( ( await call( 'GET', '/api/me', undefined, 'Bearer ' + member_token ) ).Status, 401 );
} );


TEST( 'a plan is created, listed with its tally, read, and retitled', async function ()
{
	let plan = await create( 'First plan' );
	ASSERT.equal( plan.State, 'Draft' );
	ASSERT.equal( plan.Revision, 1 );
	ASSERT.equal( plan.StateLine, 'no threads yet' );
	let list = await call( 'GET', '/api/plans' );
	ASSERT.ok( list.Body.Plans.some( function ( candidate ) { return candidate.Id === plan.Id; } ) );
	let read = await call( 'GET', '/api/plans/' + plan.Id );
	ASSERT.equal( read.Status, 200 );
	ASSERT.equal( read.Body.Text, TEXT );
	ASSERT.deepEqual( read.Body.Threads, [] );
	ASSERT.equal( read.Body.Plan.Tally.Total, 0 );
	ASSERT.equal( read.Body.Context, false );
	let retitled = await call( 'PUT', '/api/plans/' + plan.Id, { Title: 'Renamed' } );
	ASSERT.equal( retitled.Body.Plan.Title, 'Renamed' );
	ASSERT.equal( retitled.Body.Plan.Id, plan.Id );
	ASSERT.equal( ( await call( 'POST', '/api/plans', { Text: 'no title' } ) ).Status, 400 );
	ASSERT.equal( ( await call( 'GET', '/api/plans/none' ) ).Status, 404 );
	ASSERT.equal( ( await call( 'GET', '/api/nothing' ) ).Status, 404 );
	ASSERT.equal( ( await call( 'GET', '/api/search?q=x' ) ).Status, 404 );
	ASSERT.equal( ( await call( 'POST', '/api/plans/' + plan.Id + '/send' ) ).Status, 404 );
} );


TEST( 'a thread anchors to visible text, or to the whole document; missing words are refused', async function ()
{
	let plan = await create( 'Threads' );
	let anchored = await call( 'POST', '/api/plans/' + plan.Id + '/threads', { Anchor: { Text: 'anchors and how they survive' }, Text: 'Do they?' } );
	ASSERT.equal( anchored.Status, 201 );
	let thread = anchored.Body.Thread;
	ASSERT.equal( thread.Status, 'contested' );
	ASSERT.equal( thread.Anchor.Text, 'anchors and how they survive' );
	ASSERT.equal( thread.Anchor.Prefix.length > 0, true );
	ASSERT.equal( thread.Found.Method, 'exact' );
	ASSERT.deepEqual( thread.Turn, [ 'llm' ] );
	ASSERT.equal( thread.WaitingOnMe, false );
	ASSERT.equal( thread.Replies.length, 1 );
	ASSERT.equal( thread.Replies[ 0 ].By, 'user' );
	let whole = await call( 'POST', '/api/plans/' + plan.Id + '/threads', { Anchor: null, Text: 'On the whole thing.' }, true );
	ASSERT.equal( whole.Body.Thread.Anchor, null );
	ASSERT.equal( whole.Body.Thread.Found, null );
	ASSERT.deepEqual( whole.Body.Thread.Turn, [ 'user' ] );
	let missing = await call( 'POST', '/api/plans/' + plan.Id + '/threads', { Anchor: { Text: 'words that are not there' }, Text: 'x' } );
	ASSERT.equal( missing.Status, 400 );
	ASSERT.equal( ( await call( 'POST', '/api/plans/' + plan.Id + '/threads', { Text: '  ' } ) ).Status, 400 );
	let read = await call( 'GET', '/api/plans/' + plan.Id );
	ASSERT.equal( read.Body.Plan.Tally.Contested, 2 );
	ASSERT.equal( read.Body.Plan.StateLine, '2 contested, waiting on you 1' );
	let filtered = await call( 'GET', '/api/plans/' + plan.Id + '/threads?status=mine', undefined, true );
	ASSERT.deepEqual( filtered.Body.Threads.map( function ( candidate ) { return candidate.Id; } ), [ thread.Id ] );
	ASSERT.equal( ( await call( 'GET', '/api/plans/' + plan.Id + '/threads?status=bogus' ) ).Status, 400 );
} );


TEST( 'only the owner resolves; a reply to a resolved thread reopens it', async function ()
{
	let plan = await create( 'Resolve' );
	let thread = await discussed_thread( plan.Id, 'one list item', 'Outcome: the item is reworded.' );
	let by_llm = await call( 'POST', '/api/plans/' + plan.Id + '/threads/' + thread.Id + '/resolve', undefined, true );
	ASSERT.equal( by_llm.Status, 403 );
	let resolved = await call( 'POST', '/api/plans/' + plan.Id + '/threads/' + thread.Id + '/resolve' );
	ASSERT.equal( resolved.Status, 200 );
	ASSERT.equal( resolved.Body.Thread.Status, 'resolved' );
	ASSERT.equal( resolved.Body.Thread.State, 'resolved' );
	ASSERT.equal( resolved.Body.Thread.Resolved.By, 'user' );
	ASSERT.deepEqual( resolved.Body.Thread.Turn, [ 'llm' ] );
	ASSERT.equal( ( await call( 'POST', '/api/plans/' + plan.Id + '/threads/' + thread.Id + '/resolve' ) ).Status, 409 );
	let read = await call( 'GET', '/api/plans/' + plan.Id );
	ASSERT.equal( read.Body.Plan.StateLine, '1 resolved' );
	let reply = await call( 'POST', '/api/plans/' + plan.Id + '/threads/' + thread.Id + '/replies', { Text: 'Wait, one more thing.' } );
	ASSERT.equal( reply.Status, 201 );
	ASSERT.equal( reply.Body.Reopened, true );
	ASSERT.equal( reply.Body.Thread.Status, 'contested' );
	ASSERT.equal( reply.Body.Thread.Reopened, true );
	ASSERT.equal( reply.Body.Thread.Resolved, null );
	let reopened = await call( 'GET', '/api/plans/' + plan.Id + '/threads?status=reopened' );
	ASSERT.equal( reopened.Body.Threads.length, 1 );
	ASSERT.equal( ( await call( 'GET', '/api/plans/' + plan.Id ) ).Body.Plan.StateLine, '1 contested, 1 reopened' );
	ASSERT.equal( ( await call( 'GET', '/api/plans/' + plan.Id, undefined, true ) ).Body.Plan.StateLine, '1 contested, waiting on you 1, 1 reopened' );
	ASSERT.equal( ( await call( 'POST', '/api/plans/' + plan.Id + '/threads/none/replies', { Text: 'x' } ) ).Status, 404 );
} );


TEST( 'reply and resolve: the owner\'s reply becomes the outcome in one request; no one else may', async function ()
{
	let plan = await create( 'Reply and resolve' );
	let thread = await discussed_thread( plan.Id, 'one list item', 'Question: keep it, or drop it? I would keep it.' );
	let path = '/api/plans/' + plan.Id + '/threads/' + thread.Id + '/replies';
	let by_llm = await call( 'POST', path, { Text: 'Keep it.', Resolve: true }, true );
	ASSERT.equal( by_llm.Status, 403 );
	let read = await call( 'GET', '/api/plans/' + plan.Id );
	ASSERT.equal( thread_of_body( read, thread.Id ).Replies.length, 2 );
	let both = await call( 'POST', path, { Text: 'Drop it.', Resolve: true } );
	ASSERT.equal( both.Status, 201 );
	ASSERT.equal( both.Body.Resolved, true );
	ASSERT.equal( both.Body.Thread.Status, 'resolved' );
	ASSERT.equal( both.Body.Thread.Resolved.By, 'user' );
	ASSERT.deepEqual( both.Body.Thread.Turn, [ 'llm' ] );
	let replies = both.Body.Thread.Replies;
	ASSERT.deepEqual( [ replies[ replies.length - 1 ].By, replies[ replies.length - 1 ].Text ], [ 'user', 'Drop it.' ] );
	// a plain reply is as it was: it reopens the resolved thread
	let plain = await call( 'POST', path, { Text: 'On second thought.' } );
	ASSERT.equal( plain.Body.Resolved, false );
	ASSERT.equal( plain.Body.Thread.Status, 'contested' );
} );


TEST( 'comment and resolve: the owner posts a thread already resolved, its comment the outcome; no one else may', async function ()
{
	let plan = await create( 'Comment and resolve' );
	let path = '/api/plans/' + plan.Id + '/threads';
	let by_llm = await call( 'POST', path, { Text: 'Drop the last line.', Resolve: true }, true );
	ASSERT.equal( by_llm.Status, 403 );
	ASSERT.equal( ( await call( 'GET', path ) ).Body.Threads.length, 0 );
	let posted = await call( 'POST', path, { Text: 'Drop the last line.', Resolve: true } );
	ASSERT.equal( posted.Status, 201 );
	ASSERT.equal( posted.Body.Thread.Status, 'resolved' );
	ASSERT.equal( posted.Body.Thread.Resolved.By, 'user' );
	ASSERT.deepEqual( posted.Body.Thread.Turn, [ 'llm' ] );
	ASSERT.equal( posted.Body.Thread.Replies.length, 1 );
	// without Resolve, a new thread is contested as before
	let plain = await call( 'POST', path, { Text: 'Why this line?' } );
	ASSERT.equal( plain.Body.Thread.Status, 'contested' );
} );


function thread_of_body( read, thread_id )
{
	return read.Body.Threads.find( function ( thread ) { return thread.Id === thread_id; } );
}


TEST( 'only the owner deletes a thread, applied or not; the revision it made keeps its text', async function ()
{
	let plan = await create( 'Delete a thread' );
	let thread = await discussed_thread( plan.Id, 'one list item', 'Outcome: the item is reworded.' );
	await call( 'POST', '/api/plans/' + plan.Id + '/threads/' + thread.Id + '/resolve' );
	let applied = await call( 'POST', '/api/plans/' + plan.Id + '/threads/' + thread.Id + '/apply', { Text: TEXT.replace( 'one list item', 'one reworded item' ), Revision: 1, Outcome: 'reworded' }, true );
	ASSERT.equal( applied.Status, 200 );
	let other = ( await call( 'POST', '/api/plans/' + plan.Id + '/threads', { Text: 'A second thread.' } ) ).Body.Thread;
	let path = '/api/plans/' + plan.Id + '/threads/' + thread.Id;
	ASSERT.equal( ( await call( 'DELETE', path, undefined, true ) ).Status, 403 );
	let deleted = await call( 'DELETE', path );
	ASSERT.equal( deleted.Status, 200 );
	ASSERT.equal( deleted.Body.Deleted, thread.Id );
	ASSERT.equal( ( await call( 'DELETE', path ) ).Status, 404 );
	let read = await call( 'GET', '/api/plans/' + plan.Id );
	ASSERT.deepEqual( read.Body.Threads.map( function ( candidate ) { return candidate.Id; } ), [ other.Id ] );
	ASSERT.match( read.Body.Text, /one reworded item/ );
	let revisions = await call( 'GET', '/api/plans/' + plan.Id + '/revisions' );
	ASSERT.equal( revisions.Body.Revisions[ 1 ].Thread, thread.Id );
	ASSERT.equal( ( await call( 'DELETE', '/api/plans/none/threads/' + other.Id ) ).Status, 404 );
} );


TEST( 'apply: resolved threads only, a text change makes a revision tied to the thread, a stale revision is refused', async function ()
{
	let plan = await create( 'Apply' );
	let thread = await discussed_thread( plan.Id, 'another list item to comment on', 'Outcome: the item says "a reworded list item".' );
	let too_early = await call( 'POST', '/api/plans/' + plan.Id + '/threads/' + thread.Id + '/apply', { Outcome: 'x', Revision: 1 }, true );
	ASSERT.equal( too_early.Status, 409 );
	await call( 'POST', '/api/plans/' + plan.Id + '/threads/' + thread.Id + '/resolve' );
	let new_text = TEXT.replace( 'another list item to comment on', 'a reworded list item' );
	let stale = await call( 'POST', '/api/plans/' + plan.Id + '/threads/' + thread.Id + '/apply', { Text: new_text, Outcome: 'reworded', Revision: 7 }, true );
	ASSERT.equal( stale.Status, 409 );
	ASSERT.equal( stale.Body.Revision, 1 );
	ASSERT.equal( ( await call( 'POST', '/api/plans/' + plan.Id + '/threads/' + thread.Id + '/apply', { Text: new_text, Revision: 1 }, true ) ).Status, 400 );
	// an anchor not found in the new text is refused before anything is written: no revision, the thread still resolved
	let lost = await call( 'POST', '/api/plans/' + plan.Id + '/threads/' + thread.Id + '/apply', { Text: new_text, Outcome: 'reworded', Revision: 1, Anchor: { Text: '`a reworded list item`' } }, true );
	ASSERT.equal( lost.Status, 400 );
	let unchanged = await call( 'GET', '/api/plans/' + plan.Id );
	ASSERT.equal( unchanged.Body.Plan.Revision, 1 );
	ASSERT.equal( unchanged.Body.Text, TEXT );
	ASSERT.equal( thread_of_body( unchanged, thread.Id ).State, 'resolved' );
	let applied =await call( 'POST', '/api/plans/' + plan.Id + '/threads/' + thread.Id + '/apply', { Text: new_text, Outcome: 'reworded', Revision: 1, Anchor: { Text: 'a reworded list item' } }, true );
	ASSERT.equal( applied.Status, 200 );
	ASSERT.equal( applied.Body.Plan.Revision, 2 );
	ASSERT.equal( applied.Body.Thread.Applied.By, 'llm' );
	ASSERT.equal( applied.Body.Thread.Applied.Revision, 2 );
	ASSERT.equal( applied.Body.Thread.Applied.Outcome, 'reworded' );
	ASSERT.equal( applied.Body.Thread.Anchor.Text, 'a reworded list item' );
	ASSERT.equal( applied.Body.Thread.Found.Method, 'exact' );
	ASSERT.deepEqual( applied.Body.Thread.Turn, [] );
	ASSERT.equal( applied.Body.Plan.StateLine, '1 applied' );
	let revisions = await call( 'GET', '/api/plans/' + plan.Id + '/revisions' );
	ASSERT.equal( revisions.Body.Revisions.length, 2 );
	ASSERT.equal( revisions.Body.Revisions[ 1 ].Reason, 'apply' );
	ASSERT.equal( revisions.Body.Revisions[ 1 ].Thread, thread.Id );
	ASSERT.equal( revisions.Body.Revisions[ 1 ].By, 'llm' );
	let second = await call( 'GET', '/api/plans/' + plan.Id + '/revisions/2' );
	ASSERT.equal( second.Body.Revision.Text, new_text );
	ASSERT.equal( ( await call( 'GET', '/api/plans/' + plan.Id + '/revisions/1' ) ).Body.Revision.Text, TEXT );
	ASSERT.equal( ( await call( 'GET', '/api/plans/' + plan.Id + '/revisions/9' ) ).Status, 404 );
	ASSERT.equal( ( await call( 'POST', '/api/plans/' + plan.Id + '/threads/' + thread.Id + '/apply', { Outcome: 'again', Revision: 2 }, true ) ).Status, 409 );
	// an outcome without a text change makes no revision
	let dropped = await discussed_thread( plan.Id, 'A closing paragraph', 'Outcome: dropped.' );
	await call( 'POST', '/api/plans/' + plan.Id + '/threads/' + dropped.Id + '/resolve' );
	let only_outcome = await call( 'POST', '/api/plans/' + plan.Id + '/threads/' + dropped.Id + '/apply', { Outcome: 'dropped' }, true );
	ASSERT.equal( only_outcome.Status, 200 );
	ASSERT.equal( only_outcome.Body.Plan.Revision, 2 );
	ASSERT.equal( only_outcome.Body.Thread.Applied.Revision, 2 );
} );


TEST( 'anchors follow an applied change: kept, moved by context, or detached and re-anchored', async function ()
{
	let plan = await create( 'Anchors' );
	let kept = await discussed_thread( plan.Id, 'A closing paragraph', 'Outcome: keep.' );
	let moved = await discussed_thread( plan.Id, 'one list item', 'Outcome: reword.' );
	let lost = await discussed_thread( plan.Id, 'another list item to comment on', 'Outcome: remove.' );
	await call( 'POST', '/api/plans/' + plan.Id + '/threads/' + lost.Id + '/resolve' );
	let new_text = TEXT.replace( '- one list item\n', '- one changed item\n' ).replace( '- another list item to comment on\n', '' );
	let applied = await call( 'POST', '/api/plans/' + plan.Id + '/threads/' + lost.Id + '/apply', { Text: new_text, Outcome: 'removed', Revision: 1 }, true );
	ASSERT.equal( applied.Status, 200 );
	let read = await call( 'GET', '/api/plans/' + plan.Id );
	let by_id = {};
	for ( let thread of read.Body.Threads )
	{
		by_id[ thread.Id ] = thread;
	}
	ASSERT.equal( by_id[ kept.Id ].Detached, false );
	ASSERT.equal( by_id[ kept.Id ].Found.Method, 'exact' );
	ASSERT.equal( by_id[ moved.Id ].Detached, false );
	ASSERT.equal( by_id[ moved.Id ].Anchor.Text, 'one changed item' );
	ASSERT.equal( by_id[ moved.Id ].Found.Method, 'exact' );
	ASSERT.equal( by_id[ lost.Id ].Detached, true );
	ASSERT.equal( by_id[ lost.Id ].Found, null );
	ASSERT.equal( read.Body.Plan.Tally.Detached, 1 );
	let detached = await call( 'GET', '/api/plans/' + plan.Id + '/threads?status=detached' );
	ASSERT.deepEqual( detached.Body.Threads.map( function ( thread ) { return thread.Id; } ), [ lost.Id ] );
	ASSERT.equal( ( await call( 'POST', '/api/plans/' + plan.Id + '/threads/' + lost.Id + '/anchor', { Anchor: { Text: 'not present' } } ) ).Status, 400 );
	let re_anchored = await call( 'POST', '/api/plans/' + plan.Id + '/threads/' + lost.Id + '/anchor', { Anchor: { Text: 'A closing paragraph' } } );
	ASSERT.equal( re_anchored.Status, 200 );
	ASSERT.equal( re_anchored.Body.Thread.Detached, false );
	ASSERT.equal( re_anchored.Body.Thread.Found.Method, 'exact' );
} );


TEST( 'state: anyone sets any of the States at any time; an edit or a comment leaves it as it is', async function ()
{
	let plan = await create( 'States' );
	let thread = await discussed_thread( plan.Id, 'one list item', 'Outcome: nothing to change.' );
	// with a thread still contested, by the llm
	let working = await call( 'PUT', '/api/plans/' + plan.Id + '/state', { State: 'Working' }, true );
	ASSERT.equal( working.Status, 200 );
	ASSERT.equal( working.Body.Plan.State, 'Working' );
	ASSERT.equal( working.Body.Plan.StateLine, '1 contested' );
	ASSERT.equal( ( await call( 'PUT', '/api/plans/' + plan.Id + '/state', { State: 'Done' } ) ).Status, 400 );
	ASSERT.equal( ( await call( 'PUT', '/api/plans/' + plan.Id + '/state', {} ) ).Status, 400 );
	ASSERT.equal( ( await call( 'PUT', '/api/plans/none/state', { State: 'Plan' } ) ).Status, 404 );
	ASSERT.equal( ( await call( 'POST', '/api/plans/' + plan.Id + '/approve' ) ).Status, 404 );
	let listed = await call( 'GET', '/api/plans?state=Working' );
	ASSERT.deepEqual( listed.Body.Plans.map( function ( candidate ) { return candidate.Id; } ), [ plan.Id ] );
	// a manual edit from a stale revision is refused; from the current one it makes a revision and keeps the state
	let stale = await call( 'PUT', '/api/plans/' + plan.Id + '/text', { Text: TEXT + '\nMore.\n', Revision: 0 } );
	ASSERT.equal( stale.Status, 409 );
	ASSERT.equal( stale.Body.Revision, 1 );
	let edited = await call( 'PUT', '/api/plans/' + plan.Id + '/text', { Text: TEXT + '\nMore.\n', Revision: 1 } );
	ASSERT.equal( edited.Status, 200 );
	ASSERT.equal( edited.Body.Plan.State, 'Working' );
	ASSERT.equal( edited.Body.Plan.Revision, 2 );
	ASSERT.equal( ( await call( 'GET', '/api/plans/' + plan.Id + '/revisions' ) ).Body.Revisions[ 1 ].Reason, 'edit' );
	// a manual edit changes no thread's status
	await call( 'POST', '/api/plans/' + plan.Id + '/threads/' + thread.Id + '/resolve' );
	await call( 'PUT', '/api/plans/' + plan.Id + '/text', { Text: TEXT, Revision: 2 } );
	let after_edit = await call( 'GET', '/api/plans/' + plan.Id );
	ASSERT.equal( after_edit.Body.Threads[ 0 ].Status, 'resolved' );
	// a comment keeps the state too
	await call( 'POST', '/api/plans/' + plan.Id + '/threads', { Anchor: null, Text: 'Another thought.' } );
	ASSERT.equal( ( await call( 'GET', '/api/plans/' + plan.Id ) ).Body.Plan.State, 'Working' );
	// a new plan starts in the first state, or in one it names
	ASSERT.equal( ( await call( 'POST', '/api/plans', { Title: 'Named', Text: TEXT, State: 'Plan' } ) ).Body.Plan.State, 'Plan' );
	ASSERT.equal( ( await call( 'POST', '/api/plans', { Title: 'Bad', Text: TEXT, State: 'Nope' } ) ).Status, 400 );
	let me = await call( 'GET', '/api/me' );
	ASSERT.deepEqual( me.Body.States, [ 'Draft', 'Plan', 'Working', 'Finished', 'Shelved' ] );
} );


TEST( 'waiting lists each participant\'s threads across plans', async function ()
{
	let a = await create( 'Waiting A' );
	let b = await create( 'Waiting B' );
	let asked = ( await call( 'POST', '/api/plans/' + a.Id + '/threads', { Anchor: null, Text: 'A question for the llm.' } ) ).Body.Thread;
	let answered = await discussed_thread( b.Id, 'one list item', 'Outcome: answered.' );
	let llm = await call( 'GET', '/api/waiting', undefined, true );
	ASSERT.equal( llm.Body.Me.Name, 'llm' );
	let llm_threads = llm.Body.Waiting.filter( function ( item ) { return item.Plan.Id === a.Id || item.Plan.Id === b.Id; } );
	ASSERT.deepEqual( llm_threads.map( function ( item ) { return item.Thread.Id; } ), [ asked.Id ] );
	ASSERT.equal( llm_threads[ 0 ].Plan.Title, 'Waiting A' );
	let user = await call( 'GET', '/api/waiting' );
	let user_threads = user.Body.Waiting.filter( function ( item ) { return item.Plan.Id === a.Id || item.Plan.Id === b.Id; } );
	ASSERT.deepEqual( user_threads.map( function ( item ) { return item.Thread.Id; } ), [ answered.Id ] );
	await call( 'POST', '/api/plans/' + b.Id + '/threads/' + answered.Id + '/resolve' );
	let llm_again = await call( 'GET', '/api/waiting', undefined, true );
	let ids = llm_again.Body.Waiting.filter( function ( item ) { return item.Plan.Id === b.Id; } ).map( function ( item ) { return item.Thread.Id; } );
	ASSERT.deepEqual( ids, [ answered.Id ] );
} );


TEST( 'a deleted plan goes to the trash', async function ()
{
	let plan = await create( 'Trash me' );
	ASSERT.equal( ( await call( 'DELETE', '/api/plans/' + plan.Id ) ).Body.Trashed, plan.Id );
	ASSERT.equal( ( await call( 'GET', '/api/plans/' + plan.Id ) ).Status, 404 );
	ASSERT.equal( ( await call( 'DELETE', '/api/plans/' + plan.Id ) ).Status, 404 );
	let trash = await call( 'GET', '/api/trash' );
	ASSERT.ok( trash.Body.Plans.some( function ( candidate ) { return candidate.Id === plan.Id; } ) );
	// Empty Trash: the owner's; every trashed item gone for good
	ASSERT.equal( ( await call( 'DELETE', '/api/trash', undefined, true ) ).Status, 403 );
	let emptied = await call( 'DELETE', '/api/trash' );
	ASSERT.equal( emptied.Status, 200 );
	ASSERT.ok( emptied.Body.Emptied >= 1 );
	ASSERT.deepEqual( ( await call( 'GET', '/api/trash' ) ).Body.Plans, [] );
	ASSERT.equal( ( await call( 'DELETE', '/api/trash' ) ).Body.Emptied, 0 );
} );


TEST( 'every change sends a Server-Sent Event { Plan, Kind }', async function ()
{
	let response = await fetch( running.Url + '/api/events' );
	ASSERT.equal( response.headers.get( 'content-type' ), 'text/event-stream' );
	let reader = response.body.getReader();
	let decoder = new TextDecoder();
	let buffer = '';
	async function next_event()
	{
		while ( true )
		{
			let match = /event: change\ndata: (.*)\n\n/.exec( buffer );
			if ( match )
			{
				buffer = buffer.slice( match.index + match[ 0 ].length );
				return JSON.parse( match[ 1 ] );
			}
			let chunk = await reader.read();
			if ( chunk.done )
			{
				return null;
			}
			buffer += decoder.decode( chunk.value, { stream: true } );
		}
	}
	let plan = await create( 'Events' );
	ASSERT.deepEqual( await next_event(), { Project: home, Kind: 'project' } );
	ASSERT.deepEqual( await next_event(), { Plan: plan.Id, Kind: 'created' } );
	let thread = ( await call( 'POST', '/api/plans/' + plan.Id + '/threads', { Anchor: null, Text: 'Hello?' } ) ).Body.Thread;
	ASSERT.deepEqual( await next_event(), { Plan: plan.Id, Kind: 'thread', Thread: thread.Id } );
	await call( 'POST', '/api/plans/' + plan.Id + '/threads/' + thread.Id + '/replies', { Text: 'Hello.' }, true );
	ASSERT.equal( ( await next_event() ).Kind, 'reply' );
	await call( 'POST', '/api/plans/' + plan.Id + '/threads/' + thread.Id + '/resolve' );
	ASSERT.equal( ( await next_event() ).Kind, 'resolved' );
	await call( 'POST', '/api/plans/' + plan.Id + '/threads/' + thread.Id + '/apply', { Outcome: 'said hello' }, true );
	ASSERT.equal( ( await next_event() ).Kind, 'applied' );
	await call( 'PUT', '/api/plans/' + plan.Id + '/state', { State: 'Plan' } );
	ASSERT.equal( ( await next_event() ).Kind, 'state' );
	await call( 'PUT', '/api/plans/' + plan.Id + '/text', { Text: 'changed', Revision: 1 } );
	ASSERT.equal( ( await next_event() ).Kind, 'text' );
	await call( 'DELETE', '/api/plans/' + plan.Id );
	ASSERT.deepEqual( await next_event(), { Project: home, Kind: 'project' } );
	ASSERT.equal( ( await next_event() ).Kind, 'trashed' );
	let settings = ( await call( 'GET', '/api/settings' ) ).Body.Settings;
	await call( 'PUT', '/api/settings', { Settings: settings } );
	ASSERT.deepEqual( await next_event(), { Settings: true, Kind: 'settings' } );
	await reader.cancel();
} );


//---------------------------------------------------------------------
// Move and copy

TEST( 'items move within a project and into another; a folder never goes inside itself', async function ()
{
	let plan = await create( 'Mover' );
	let project = ( await call( 'POST', '/api/projects', { Name: 'Destination' } ) ).Body.Project;
	let outer = ( await call( 'POST', '/api/projects/' + project.Id + '/folders', { Name: 'Outer' } ) ).Body.Folder;
	let inner = ( await call( 'POST', '/api/projects/' + project.Id + '/folders', { Name: 'Inner', Parent: outer.Id } ) ).Body.Folder;

	let moved = await call( 'POST', '/api/items/' + plan.Id + '/move', { Project: project.Id, Parent: inner.Id } );
	ASSERT.equal( moved.Status, 200 );
	ASSERT.deepEqual( moved.Body.Project.Items[ 1 ].Items[ 0 ].Items, [ { Kind: 'plan', Id: plan.Id } ] );
	let default_items = ( await call( 'GET', '/api/projects' ) ).Body.Projects[ 0 ].Items;
	ASSERT.equal( default_items.some( function ( item ) { return item.Id === plan.Id; } ), false );
	ASSERT.equal( ( await call( 'GET', '/api/plans/' + plan.Id ) ).Body.Project.Id, project.Id );

	// within the project, to its root; then a folder into its own child is refused
	let to_root = await call( 'POST', '/api/items/' + plan.Id + '/move', { Project: project.Id } );
	ASSERT.deepEqual( after_context( to_root.Body.Project ).map( function ( item ) { return item.Id; } ), [ outer.Id, plan.Id ] );
	ASSERT.equal( ( await call( 'POST', '/api/items/' + outer.Id + '/move', { Project: project.Id, Parent: inner.Id } ) ).Status, 400 );
	ASSERT.equal( ( await call( 'POST', '/api/items/' + outer.Id + '/move', { Project: project.Id, Parent: outer.Id } ) ).Status, 400 );

	// a folder moves with everything in it, into another project
	await call( 'POST', '/api/items/' + plan.Id + '/move', { Project: project.Id, Parent: inner.Id } );
	let folder_moved = await call( 'POST', '/api/items/' + outer.Id + '/move', { Project: home } );
	ASSERT.equal( folder_moved.Status, 200 );
	ASSERT.equal( ( await call( 'GET', '/api/plans/' + plan.Id ) ).Body.Project.Id, home );

	// refusals
	ASSERT.equal( ( await call( 'POST', '/api/items/nothing/move', { Project: home } ) ).Status, 404 );
	ASSERT.equal( ( await call( 'POST', '/api/items/' + plan.Id + '/move', {} ) ).Status, 400 );
	ASSERT.equal( ( await call( 'POST', '/api/items/' + plan.Id + '/move', { Project: 'none-000000' } ) ).Status, 404 );
	ASSERT.equal( ( await call( 'POST', '/api/items/' + plan.Id + '/move', { Project: home, Parent: 'fnothing' } ) ).Status, 400 );
} );


TEST( 'an item goes just before another; a project moves in the order', async function ()
{
	let project = ( await call( 'POST', '/api/projects', { Name: 'Ordering' } ) ).Body.Project;
	let a = await create( 'A' );
	let b = await create( 'B' );
	let c = await create( 'C' );
	for ( let plan of [ a, b, c ] )
	{
		await call( 'POST', '/api/items/' + plan.Id + '/move', { Project: project.Id } );
	}
	function ids( body ) { return after_context( body.Project ).map( function ( item ) { return item.Id; } ); }
	// C just before A, then A to the end, within the root
	let moved = await call( 'POST', '/api/items/' + c.Id + '/move', { Project: project.Id, Before: a.Id } );
	ASSERT.deepEqual( ids( moved.Body ), [ c.Id, a.Id, b.Id ] );
	moved = await call( 'POST', '/api/items/' + a.Id + '/move', { Project: project.Id } );
	ASSERT.deepEqual( ids( moved.Body ), [ c.Id, b.Id, a.Id ] );
	// into a folder, just before what it holds
	let folder = ( await call( 'POST', '/api/projects/' + project.Id + '/folders', { Name: 'Box' } ) ).Body.Folder;
	await call( 'POST', '/api/items/' + b.Id + '/move', { Project: project.Id, Parent: folder.Id } );
	moved = await call( 'POST', '/api/items/' + c.Id + '/move', { Project: project.Id, Parent: folder.Id, Before: b.Id } );
	let box = moved.Body.Project.Items.find( function ( item ) { return item.Id === folder.Id; } );
	ASSERT.deepEqual( box.Items.map( function ( item ) { return item.Id; } ), [ c.Id, b.Id ] );
	ASSERT.equal( ( await call( 'POST', '/api/items/' + c.Id + '/move', { Project: project.Id, Before: c.Id } ) ).Status, 400 );

	// the project, before Default, then back to the end
	let order = await call( 'POST', '/api/projects/' + project.Id + '/move', { Before: home } );
	ASSERT.equal( order.Status, 200 );
	ASSERT.equal( order.Body.Projects[ 0 ].Id, project.Id );
	order = await call( 'POST', '/api/projects/' + project.Id + '/move', {} );
	ASSERT.equal( order.Body.Projects[ order.Body.Projects.length - 1 ].Id, project.Id );
	ASSERT.equal( ( await call( 'GET', '/api/projects' ) ).Body.Projects[ 0 ].Id, home );
	ASSERT.equal( ( await call( 'POST', '/api/projects/none/move', {} ) ).Status, 404 );
	ASSERT.equal( ( await call( 'POST', '/api/projects/' + project.Id + '/move', { Before: 'none' } ) ).Status, 400 );
} );


TEST( 'a copied plan carries its text, threads and revisions; a copied folder copies everything in it', async function ()
{
	let plan = await create( 'Original' );
	let thread = await discussed_thread( plan.Id, 'one list item', 'Outcome: keep it.' );
	await call( 'PUT', '/api/plans/' + plan.Id + '/text', { Text: TEXT + '\nEdited.\n', Revision: 1 } );
	let project = ( await call( 'POST', '/api/projects', { Name: 'Copies' } ) ).Body.Project;

	let copied = await call( 'POST', '/api/items/' + plan.Id + '/copy', { Project: project.Id } );
	ASSERT.equal( copied.Status, 201 );
	let copy_id = copied.Body.Node.Id;
	ASSERT.notEqual( copy_id, plan.Id );
	let copy = ( await call( 'GET', '/api/plans/' + copy_id ) ).Body;
	ASSERT.equal( copy.Plan.Title, 'Original (copy)' );
	ASSERT.equal( copy.Plan.Revision, 2 );
	ASSERT.equal( copy.Text, TEXT + '\nEdited.\n' );
	ASSERT.deepEqual( copy.Threads.map( function ( t ) { return t.Id; } ), [ thread.Id ] );
	ASSERT.equal( copy.Threads[ 0 ].Replies.length, 2 );
	ASSERT.equal( copy.Project.Id, project.Id );
	ASSERT.equal( ( await call( 'GET', '/api/plans/' + copy_id + '/revisions' ) ).Body.Revisions.length, 2 );
	// the original is where it was, unchanged
	ASSERT.equal( ( await call( 'GET', '/api/plans/' + plan.Id ) ).Body.Project.Id, home );

	// a folder with a plan in it
	let folder = ( await call( 'POST', '/api/projects/' + project.Id + '/folders', { Name: 'Bundle' } ) ).Body.Folder;
	await call( 'POST', '/api/items/' + copy_id + '/move', { Project: project.Id, Parent: folder.Id } );
	let folder_copy = await call( 'POST', '/api/items/' + folder.Id + '/copy', { Project: home } );
	ASSERT.equal( folder_copy.Status, 201 );
	let node = folder_copy.Body.Node;
	ASSERT.equal( node.Kind, 'folder' );
	ASSERT.equal( node.Name, 'Bundle' );
	ASSERT.notEqual( node.Id, folder.Id );
	ASSERT.equal( node.Items.length, 1 );
	ASSERT.notEqual( node.Items[ 0 ].Id, copy_id );
	ASSERT.equal( ( await call( 'GET', '/api/plans/' + node.Items[ 0 ].Id ) ).Body.Plan.Title, 'Original (copy) (copy)' );
	ASSERT.equal( ( await call( 'POST', '/api/items/nothing/copy', { Project: home } ) ).Status, 404 );
} );


//---------------------------------------------------------------------
// Documents and the Context folder

TEST( 'a Document is edited and kept like a Plan, has no threads and no state, and lives in the Context folder', async function ()
{
	let made = await call( 'POST', '/api/plans', { Title: 'Glossary', Text: '# Glossary\n\nA quokka is a small wallaby that smiles.\n', Kind: 'document' } );
	ASSERT.equal( made.Status, 201 );
	let document = made.Body.Plan;
	ASSERT.equal( document.Kind, 'document' );
	ASSERT.equal( document.State, null );
	ASSERT.equal( document.StateLine, 'a document' );
	ASSERT.equal( ( await call( 'POST', '/api/plans', { Title: 'X', Text: '', Kind: 'document', State: 'Plan' } ) ).Status, 400 );
	ASSERT.equal( ( await call( 'POST', '/api/plans', { Title: 'X', Text: '', Kind: 'poem' } ) ).Status, 400 );
	// in its project's Context folder, after the Readme
	let default_project = ( await call( 'GET', '/api/projects' ) ).Body.Projects[ 0 ];
	let context_folder = default_project.Items[ 0 ];
	ASSERT.equal( context_folder.Id, default_project.ContextFolder );
	ASSERT.equal( context_folder.Items[ 0 ].Id, default_project.Context.Id );
	ASSERT.equal( context_folder.Items.find( function ( item ) { return item.Id === document.Id; } ).Kind, 'document' );
	ASSERT.equal( default_project.Items.some( function ( item ) { return item.Id === document.Id; } ), false );
	// no threads, no state
	let thread = await call( 'POST', '/api/plans/' + document.Id + '/threads', { Anchor: null, Text: 'A comment?' } );
	ASSERT.equal( thread.Status, 409 );
	ASSERT.match( thread.Body.Error, /no threads/ );
	ASSERT.equal( ( await call( 'PUT', '/api/plans/' + document.Id + '/state', { State: 'Plan' } ) ).Status, 409 );
	// edits make revisions; it is renamed, copied within the Context folder, and trashed like any item
	let edited = await call( 'PUT', '/api/plans/' + document.Id + '/text', { Text: '# Glossary\n\nA quokka is a small wallaby that smiles for photographs.\n', Revision: 1 } );
	ASSERT.equal( edited.Status, 200 );
	ASSERT.equal( edited.Body.Plan.Revision, 2 );
	ASSERT.equal( ( await call( 'PUT', '/api/plans/' + document.Id, { Title: 'Terms' } ) ).Body.Plan.Title, 'Terms' );
	let copied = await call( 'POST', '/api/items/' + document.Id + '/copy', { Project: home, Parent: default_project.ContextFolder } );
	ASSERT.equal( copied.Status, 201 );
	ASSERT.equal( ( await call( 'POST', '/api/items/' + document.Id + '/copy', { Project: home } ) ).Status, 400 );
	ASSERT.equal( ( await call( 'DELETE', '/api/plans/' + copied.Body.Node.Id ) ).Status, 200 );
} );


TEST( 'the Context folder: first in every project, holding the Readme; never renamed, moved, copied or deleted; documents only, and documents nowhere else', async function ()
{
	let project = ( await call( 'POST', '/api/projects', { Name: 'Contextual' } ) ).Body.Project;
	ASSERT.equal( project.Items[ 0 ].Id, project.ContextFolder );
	ASSERT.equal( project.Items[ 0 ].Name, 'Context' );
	ASSERT.deepEqual( project.Items[ 0 ].Items, [ { Kind: 'document', Id: project.Context } ] );
	let shown = await project_named( project.Id );
	ASSERT.deepEqual( shown.Context, { Id: project.Context, Empty: true } );
	ASSERT.equal( shown.ContextFolder, project.ContextFolder );
	ASSERT.equal( shown.Items[ 0 ].Items[ 0 ].Title, 'Readme' );
	let read = await call( 'GET', '/api/plans/' + project.Context );
	ASSERT.equal( read.Body.Context, true );
	ASSERT.equal( read.Body.Plan.Kind, 'document' );
	ASSERT.equal( read.Body.Project.Id, project.Id );
	await call( 'PUT', '/api/plans/' + project.Context + '/text', { Text: '# Contextual\n\nWhat this is.\n', Revision: 1 } );
	ASSERT.equal( ( await project_named( project.Id ) ).Context.Empty, false );

	// the folder and the document stay as they are
	let folder_path = '/api/projects/' + project.Id + '/folders/' + project.ContextFolder;
	ASSERT.equal( ( await call( 'PUT', folder_path, { Name: 'Other' } ) ).Status, 409 );
	ASSERT.equal( ( await call( 'DELETE', folder_path ) ).Status, 409 );
	ASSERT.equal( ( await call( 'POST', '/api/items/' + project.ContextFolder + '/move', { Project: home } ) ).Status, 409 );
	ASSERT.equal( ( await call( 'POST', '/api/items/' + project.ContextFolder + '/copy', { Project: home } ) ).Status, 409 );
	ASSERT.equal( ( await call( 'PUT', '/api/plans/' + project.Context, { Title: 'Renamed' } ) ).Status, 409 );
	ASSERT.equal( ( await call( 'DELETE', '/api/plans/' + project.Context ) ).Status, 409 );
	ASSERT.equal( ( await call( 'POST', '/api/items/' + project.Context + '/move', { Project: project.Id } ) ).Status, 409 );
	ASSERT.equal( ( await call( 'POST', '/api/items/' + project.Context + '/copy', { Project: project.Id, Parent: project.ContextFolder } ) ).Status, 409 );

	// documents only in the Context folder; nothing else in it
	let specs = ( await call( 'POST', '/api/projects/' + project.Id + '/folders', { Name: 'Specs' } ) ).Body.Folder;
	ASSERT.equal( ( await call( 'POST', '/api/projects/' + project.Id + '/folders', { Name: 'Inside', Parent: project.ContextFolder } ) ).Status, 400 );
	ASSERT.equal( ( await call( 'POST', '/api/plans', { Title: 'Plan there', Text: TEXT, Project: project.Id, Parent: project.ContextFolder } ) ).Status, 400 );
	ASSERT.equal( ( await call( 'POST', '/api/plans', { Title: 'Doc elsewhere', Text: '', Kind: 'document', Project: project.Id, Parent: specs.Id } ) ).Status, 400 );
	let notes = ( await call( 'POST', '/api/plans', { Title: 'Notes', Text: '# Notes\n', Kind: 'document', Project: project.Id } ) ).Body.Plan;
	let plan = ( await call( 'POST', '/api/plans', { Title: 'A plan', Text: TEXT, Project: project.Id, Parent: specs.Id } ) ).Body.Plan;
	let tree = await project_named( project.Id );
	ASSERT.deepEqual( tree.Items[ 0 ].Items.map( function ( item ) { return item.Id; } ), [ project.Context, notes.Id ] );
	ASSERT.equal( ( await call( 'POST', '/api/items/' + notes.Id + '/move', { Project: project.Id, Parent: specs.Id } ) ).Status, 400 );
	ASSERT.equal( ( await call( 'POST', '/api/items/' + notes.Id + '/move', { Project: project.Id } ) ).Status, 400 );
	ASSERT.equal( ( await call( 'POST', '/api/items/' + plan.Id + '/move', { Project: project.Id, Parent: project.ContextFolder } ) ).Status, 400 );
	ASSERT.equal( ( await call( 'POST', '/api/items/' + specs.Id + '/move', { Project: project.Id, Parent: project.ContextFolder } ) ).Status, 400 );
	// a document moved to another project lands in that project's Context folder
	let other = ( await call( 'POST', '/api/projects', { Name: 'Other side' } ) ).Body.Project;
	let moved = await call( 'POST', '/api/items/' + notes.Id + '/move', { Project: other.Id, Parent: other.ContextFolder } );
	ASSERT.equal( moved.Status, 200 );
	ASSERT.deepEqual( moved.Body.Project.Items[ 0 ].Items.map( function ( item ) { return item.Id; } ), [ other.Context, notes.Id ] );
	ASSERT.equal( ( await call( 'POST', '/api/items/' + notes.Id + '/move', { Project: project.Id } ) ).Status, 400 );

	// a project with only its Context folder is empty, and deleted with its Readme
	await call( 'DELETE', '/api/plans/' + plan.Id );
	await call( 'DELETE', '/api/projects/' + project.Id + '/folders/' + specs.Id );
	ASSERT.equal( ( await call( 'DELETE', '/api/projects/' + project.Id ) ).Status, 200 );
	ASSERT.equal( ( await call( 'GET', '/api/plans/' + project.Context ) ).Status, 404 );
} );


//---------------------------------------------------------------------
// Projects

TEST( 'projects: Default holds new plans; a project and its folders are created, renamed and deleted when empty', async function ()
{
	let listed = await call( 'GET', '/api/projects' );
	ASSERT.equal( listed.Status, 200 );
	ASSERT.equal( listed.Body.Projects[ 0 ].Id, home );
	ASSERT.equal( listed.Body.Projects[ 0 ].Name, 'Default' );

	let loose = await create( 'Loose' );
	let default_project = ( await call( 'GET', '/api/projects' ) ).Body.Projects[ 0 ];
	let node = default_project.Items.find( function ( item ) { return item.Id === loose.Id; } );
	ASSERT.equal( node.Kind, 'plan' );
	ASSERT.equal( node.Title, 'Loose' );
	ASSERT.equal( node.State, 'Draft' );
	ASSERT.equal( node.StateLine, 'no threads yet' );
	ASSERT.equal( ( await call( 'GET', '/api/plans/' + loose.Id ) ).Body.Project.Id, home );

	let made = await call( 'POST', '/api/projects', { Name: 'Consensus' } );
	ASSERT.equal( made.Status, 201 );
	let project = made.Body.Project;
	ASSERT.equal( project.Version, 1 );
	ASSERT.equal( ( await call( 'POST', '/api/projects', { Name: ' ' } ) ).Status, 400 );

	let folder = await call( 'POST', '/api/projects/' + project.Id + '/folders', { Name: 'Specs', Version: 1 } );
	ASSERT.equal( folder.Status, 201 );
	ASSERT.match( folder.Body.Folder.Id, /^fld-[0-9a-z]{3}-[0-9a-z]{3}-[0-9a-z]{3}$/ );
	ASSERT.equal( folder.Body.Project.Version, 2 );
	let stale = await call( 'POST', '/api/projects/' + project.Id + '/folders', { Name: 'Late', Version: 1 } );
	ASSERT.equal( stale.Status, 409 );
	ASSERT.equal( stale.Body.Version, 2 );
	ASSERT.equal( ( await call( 'POST', '/api/projects/' + project.Id + '/folders', { Name: 'Inner', Parent: 'fnothing' } ) ).Status, 400 );
	ASSERT.equal( ( await call( 'POST', '/api/projects/none-000000/folders', { Name: 'X' } ) ).Status, 404 );

	// a plan created into the folder
	let placed = await call( 'POST', '/api/plans', { Title: 'Placed', Text: TEXT, Project: project.Id, Parent: folder.Body.Folder.Id } );
	ASSERT.equal( placed.Status, 201 );
	ASSERT.equal( placed.Body.Project, project.Id );
	ASSERT.equal( ( await call( 'POST', '/api/plans', { Title: 'Nowhere', Text: TEXT, Project: 'none-000000' } ) ).Status, 404 );
	ASSERT.equal( ( await call( 'POST', '/api/plans', { Title: 'Nowhere', Text: TEXT, Kind: 'document', Project: project.Id, Parent: placed.Body.Plan.Id } ) ).Status, 400 );
	let read = await project_named( project.Id );
	ASSERT.equal( read.Items[ 1 ].Kind, 'folder' );
	ASSERT.equal( read.Items[ 1 ].Items[ 0 ].Title, 'Placed' );
	ASSERT.equal( read.Items[ 1 ].Items[ 0 ].Created, placed.Body.Plan.Created );
	ASSERT.equal( typeof read.Items[ 1 ].Items[ 0 ].Updated, 'string' );

	// renames
	let renamed = await call( 'PUT', '/api/projects/' + project.Id, { Name: 'Consensus work' } );
	ASSERT.equal( renamed.Body.Project.Name, 'Consensus work' );
	let folder_renamed = await call( 'PUT', '/api/projects/' + project.Id + '/folders/' + folder.Body.Folder.Id, { Name: 'Specifications' } );
	ASSERT.equal( folder_renamed.Body.Project.Items[ 1 ].Name, 'Specifications' );
	ASSERT.equal( ( await call( 'PUT', '/api/projects/' + project.Id + '/folders/fnothing', { Name: 'X' } ) ).Status, 404 );

	// deletes: only when empty, never Default; a trashed plan leaves its project
	ASSERT.equal( ( await call( 'DELETE', '/api/projects/' + project.Id + '/folders/' + folder.Body.Folder.Id ) ).Status, 409 );
	ASSERT.equal( ( await call( 'DELETE', '/api/projects/' + project.Id ) ).Status, 409 );
	ASSERT.equal( ( await call( 'DELETE', '/api/projects/' + home ) ).Status, 409 );
	await call( 'DELETE', '/api/plans/' + placed.Body.Plan.Id );
	ASSERT.equal( ( await call( 'DELETE', '/api/projects/' + project.Id + '/folders/' + folder.Body.Folder.Id ) ).Status, 200 );
	ASSERT.equal( ( await call( 'DELETE', '/api/projects/' + project.Id ) ).Status, 200 );
	ASSERT.equal( ( await call( 'DELETE', '/api/projects/' + project.Id ) ).Status, 404 );
	ASSERT.equal( ( await call( 'GET', '/api/projects' ) ).Body.Projects.some( function ( candidate ) { return candidate.Id === project.Id; } ), false );
} );


//---------------------------------------------------------------------

TEST( 'subplans: a plan holds plans; they move, copy and go to the trash with it', async function ()
{
	let project = ( await call( 'POST', '/api/projects', { Name: 'Subplans' } ) ).Body.Project;
	let made = async function ( title, parent, kind, body_text )
	{
		let result = await call( 'POST', '/api/plans', { Title: title, Text: body_text || ( '# ' + title + '\n\nThe text of ' + title + '.\n' ), Kind: kind || 'plan', Project: project.Id, Parent: parent } );
		return result;
	};
	let top = ( await made( 'Top' ) ).Body.Plan;
	let middle = await made( 'Middle', top.Id );
	ASSERT.equal( middle.Status, 201 );
	middle = middle.Body.Plan;
	let bottom = ( await made( 'Bottom', middle.Id ) ).Body.Plan;
	let side = ( await made( 'Side', top.Id ) ).Body.Plan;

	// only plans go under a plan
	ASSERT.equal( ( await made( 'Doc', top.Id, 'document' ) ).Status, 400 );
	let doc = ( await made( 'Doc', null, 'document' ) ).Body.Plan;
	ASSERT.equal( ( await call( 'POST', '/api/items/' + doc.Id + '/move', { Project: project.Id, Parent: top.Id } ) ).Status, 400 );
	ASSERT.equal( ( await call( 'POST', '/api/items/' + top.Id + '/move', { Project: project.Id, Parent: bottom.Id } ) ).Status, 400 );

	// the tree shows them nested
	let listed = await project_named( project.Id );
	let top_node = listed.Items.find( function ( node ) { return node.Id === top.Id; } );
	ASSERT.deepEqual( top_node.Items.map( function ( node ) { return node.Title; } ), [ 'Middle', 'Side' ] );
	ASSERT.equal( top_node.Items[ 0 ].Items[ 0 ].Title, 'Bottom' );
	ASSERT.equal( top_node.Items[ 1 ].Items, undefined );

	// a plan dragged onto a plan becomes its subplan; dragged out, it is not
	let loose = ( await made( 'Loose' ) ).Body.Plan;
	ASSERT.equal( ( await call( 'POST', '/api/items/' + loose.Id + '/move', { Project: project.Id, Parent: side.Id } ) ).Status, 200 );
	ASSERT.equal( ( await call( 'POST', '/api/items/' + loose.Id + '/move', { Project: project.Id, Parent: null } ) ).Status, 200 );

	// a copy carries its subplans, with new ids
	let copied = await call( 'POST', '/api/items/' + middle.Id + '/copy', { Project: project.Id } );
	ASSERT.equal( copied.Status, 201 );
	ASSERT.equal( copied.Body.Node.Items.length, 1 );
	ASSERT.notEqual( copied.Body.Node.Items[ 0 ].Id, bottom.Id );
	ASSERT.equal( ( await call( 'GET', '/api/plans/' + copied.Body.Node.Items[ 0 ].Id ) ).Body.Plan.Title.startsWith( 'Bottom' ), true );

	// the trash takes a plan's subplans with it
	let trashed = await call( 'DELETE', '/api/plans/' + top.Id );
	ASSERT.equal( trashed.Status, 200 );
	ASSERT.deepEqual( trashed.Body.Subplans.slice().sort(), [ middle.Id, bottom.Id, side.Id ].sort() );
	ASSERT.equal( ( await call( 'GET', '/api/plans/' + bottom.Id ) ).Status, 404 );
	listed = await project_named( project.Id );
	ASSERT.equal( listed.Items.some( function ( node ) { return node.Id === top.Id; } ), false );
} );


//---------------------------------------------------------------------
// Plan Run Shapes, Step 2: projects as folders, Archive and Restore, a project's own lists.

TEST( 'projects as folders: a Path is taken, a folder holding a project is opened, the last project is never deleted', async function ()
{
	let elsewhere = PATH.join( temporary_folder(), 'a-repo' );
	let made = await call( 'POST', '/api/projects', { Name: 'In a folder', Path: elsewhere } );
	ASSERT.equal( made.Status, 201 );
	ASSERT.equal( made.Body.Project.Path, elsewhere );
	ASSERT.equal( FS.existsSync( PATH.join( elsewhere, '.consensus', 'project.json' ) ), true );
	ASSERT.deepEqual( made.Body.Project.States, ( await call( 'GET', '/api/me' ) ).Body.States );
	// opened again by its folder: the same project, once in the list
	let opened = await call( 'POST', '/api/projects', { Path: elsewhere } );
	ASSERT.equal( opened.Status, 200 );
	ASSERT.equal( opened.Body.Opened, true );
	ASSERT.equal( opened.Body.Project.Id, made.Body.Project.Id );
	ASSERT.equal( ( await call( 'GET', '/api/projects' ) ).Body.Projects.filter( function ( project ) { return project.Id === made.Body.Project.Id; } ).length, 1 );
	ASSERT.equal( ( await call( 'POST', '/api/projects', { Path: temporary_folder() } ) ).Status, 400 );
	// the listing carries Path, States and Archive
	let listed = ( await call( 'GET', '/api/projects' ) ).Body.Projects.find( function ( project ) { return project.Id === made.Body.Project.Id; } );
	ASSERT.equal( listed.Path, elsewhere );
	ASSERT.deepEqual( listed.Archive, [] );
	ASSERT.equal( ( await call( 'DELETE', '/api/projects/' + made.Body.Project.Id ) ).Status, 200 );
	ASSERT.equal( FS.existsSync( PATH.join( elsewhere, '.consensus' ) ), false );
	ASSERT.equal( FS.existsSync( elsewhere ), true );
} );


TEST( 'archive: a plan and its Subplans leave the tree for the Archive, read-only, and Restore puts them back', async function ()
{
	let project = ( await call( 'POST', '/api/projects', { Name: 'Archiving' } ) ).Body.Project;
	let plan = ( await call( 'POST', '/api/plans', { Title: 'Finished work', Text: TEXT, Project: project.Id } ) ).Body.Plan;
	let sub = ( await call( 'POST', '/api/plans', { Title: 'Sub', Text: '# Sub\n', Project: project.Id, Parent: plan.Id } ) ).Body.Plan;
	let other = ( await call( 'POST', '/api/plans', { Title: 'Still open', Text: TEXT, Project: project.Id } ) ).Body.Plan;
	let thread = ( await call( 'POST', '/api/plans/' + plan.Id + '/threads', { Anchor: null, Text: 'Before.' } ) ).Body.Thread;
	let archived = await call( 'POST', '/api/items/' + plan.Id + '/archive', {} );
	ASSERT.equal( archived.Status, 200 );
	ASSERT.equal( archived.Body.Node.Id, plan.Id );
	ASSERT.equal( archived.Body.Node.Items[ 0 ].Id, sub.Id );
	let listed = await project_named( project.Id );
	ASSERT.deepEqual( listed.Items.map( function ( node ) { return node.Id; } ), [ project.ContextFolder, other.Id ] );
	ASSERT.equal( listed.Archive.length, 1 );
	ASSERT.equal( listed.Archive[ 0 ].Title, 'Finished work' );
	ASSERT.equal( listed.Archive[ 0 ].Archived, true );
	ASSERT.equal( listed.Archive[ 0 ].Items[ 0 ].Title, 'Sub' );
	ASSERT.equal( listed.Archive[ 0 ].Tally.Contested, 1 );
	// read, never written
	let read = await call( 'GET', '/api/plans/' + plan.Id );
	ASSERT.equal( read.Status, 200 );
	ASSERT.equal( read.Body.Plan.Archived, true );
	ASSERT.equal( read.Body.Project.Id, project.Id );
	ASSERT.equal( ( await call( 'GET', '/api/plans/' + sub.Id ) ).Body.Plan.Archived, true );
	ASSERT.equal( ( await call( 'GET', '/api/plans/' + plan.Id + '/revisions' ) ).Status, 200 );
	for ( let attempt of [
		call( 'PUT', '/api/plans/' + plan.Id + '/text', { Text: 'x', Revision: 1 } ),
		call( 'PUT', '/api/plans/' + plan.Id + '/state', { State: 'Plan' } ),
		call( 'POST', '/api/plans/' + plan.Id + '/threads', { Anchor: null, Text: 'After?' } ),
		call( 'POST', '/api/plans/' + plan.Id + '/threads/' + thread.Id + '/replies', { Text: 'No.' }, true ),
		call( 'PUT', '/api/plans/' + sub.Id, { Title: 'Renamed' } ),
	] )
	{
		let answer = await attempt;
		ASSERT.equal( answer.Status, 409, JSON.stringify( answer.Body ) );
		ASSERT.match( answer.Body.Error, /is archived/ );
	}
	ASSERT.equal( ( await call( 'GET', '/api/plans' ) ).Body.Plans.some( function ( candidate ) { return candidate.Id === plan.Id; } ), false );
	// not again, not the Readme, not a Subplan on its own, not one that is not archived
	ASSERT.equal( ( await call( 'POST', '/api/items/' + plan.Id + '/archive', {} ) ).Status, 409 );
	ASSERT.equal( ( await call( 'POST', '/api/items/' + project.Context + '/archive', {} ) ).Status, 409 );
	ASSERT.equal( ( await call( 'POST', '/api/items/' + sub.Id + '/restore', {} ) ).Status, 409 );
	ASSERT.equal( ( await call( 'POST', '/api/items/' + other.Id + '/restore', {} ) ).Status, 404 );
	ASSERT.equal( ( await call( 'POST', '/api/items/nothing/archive', {} ) ).Status, 404 );
	ASSERT.equal( ( await call( 'DELETE', '/api/projects/' + project.Id ) ).Status, 409 );
	// restored: at the root, writable again, its Subplan with it
	let restored = await call( 'POST', '/api/items/' + plan.Id + '/restore', {} );
	ASSERT.equal( restored.Status, 200 );
	listed = await project_named( project.Id );
	ASSERT.deepEqual( listed.Items.map( function ( node ) { return node.Id; } ), [ project.ContextFolder, other.Id, plan.Id ] );
	ASSERT.deepEqual( listed.Archive, [] );
	ASSERT.equal( 'Archived' in listed.Items[ 2 ], false );
	ASSERT.equal( ( await call( 'PUT', '/api/plans/' + plan.Id + '/state', { State: 'Plan' } ) ).Status, 200 );
	ASSERT.equal( ( await call( 'GET', '/api/plans/' + sub.Id ) ).Body.Plan.Archived, undefined );
} );


TEST( 'a project\'s own States, Include, Exclude and Commands; a state in use stays; the settings\' list is the default for a new project', async function ()
{
	let project = ( await call( 'POST', '/api/projects', { Name: 'Own states' } ) ).Body.Project;
	let plan = ( await call( 'POST', '/api/plans', { Title: 'Kept', Text: TEXT, Project: project.Id } ) ).Body.Plan;
	ASSERT.equal( plan.State, 'Draft' );
	let changed = await call( 'PUT', '/api/projects/' + project.Id, { States: 'Idea\nDraft\n\nDone', Include: [ 'src/**' ], Exclude: 'node_modules/**', Commands: [ 'npm test' ] } );
	ASSERT.equal( changed.Status, 200, JSON.stringify( changed.Body ) );
	ASSERT.deepEqual( changed.Body.Project.States, [ 'Idea', 'Draft', 'Done' ] );
	ASSERT.deepEqual( [ changed.Body.Project.Include, changed.Body.Project.Exclude, changed.Body.Project.Commands ], [ [ 'src/**' ], [ 'node_modules/**' ], [ 'npm test' ] ] );
	ASSERT.equal( changed.Body.Project.Name, 'Own states' );
	ASSERT.equal( ( await call( 'POST', '/api/plans', { Title: 'New here', Text: TEXT, Project: project.Id } ) ).Body.Plan.State, 'Idea' );
	ASSERT.equal( ( await call( 'PUT', '/api/plans/' + plan.Id + '/state', { State: 'Done' } ) ).Status, 200 );
	ASSERT.equal( ( await call( 'PUT', '/api/plans/' + plan.Id + '/state', { State: 'Working' } ) ).Status, 400 );
	let in_use = await call( 'PUT', '/api/projects/' + project.Id, { States: [ 'Idea', 'Draft' ] } );
	ASSERT.equal( in_use.Status, 400 );
	ASSERT.match( in_use.Body.Error, /"Done" is used by the plan "Kept"/ );
	ASSERT.equal( ( await call( 'PUT', '/api/projects/' + project.Id, { States: [] } ) ).Status, 400 );
	ASSERT.equal( ( await call( 'PUT', '/api/projects/' + project.Id, { States: [ 'A', 'A' ] } ) ).Status, 400 );
	ASSERT.equal( ( await call( 'PUT', '/api/projects/' + project.Id, {} ) ).Status, 400 );
	ASSERT.equal( ( await call( 'PUT', '/api/projects/' + project.Id, { Name: 'Renamed, states kept' } ) ).Body.Project.States.length, 3 );
	// another project is untouched, and a new one takes the settings' list
	ASSERT.deepEqual( ( await project_named( home ) ).States, ( await call( 'GET', '/api/me' ) ).Body.States );
	ASSERT.deepEqual( ( await call( 'POST', '/api/projects', { Name: 'Fresh' } ) ).Body.Project.States, ( await call( 'GET', '/api/me' ) ).Body.States );
} );


//---------------------------------------------------------------------
// Plan Run Shapes, Step 3: the LLM connections and the runs in the server

const ECHO_ARGUMENTS = [ '-e', "let t='';process.stdin.on('data',function(c){t+=c});process.stdin.on('end',function(){process.stdout.write('got: '+t.slice(0,60))})" ];


async function run_settled( id )
{
	let read = null;
	for ( let attempt = 0; attempt < 200 && ( !read || read.Body.Run.Status === 'running' ); attempt++ )
	{
		await new Promise( function ( resolve ) { setTimeout( resolve, 50 ); } );
		read = await call( 'GET', '/api/runs/' + id );
	}
	return read.Body.Run;
}


// The events stream, collected as text until Stop() is called.
function listen_events()
{
	let text = '';
	let request = HTTP.get( running.Url + '/api/events', function ( response )
	{
		response.on( 'data', function ( chunk ) { text += chunk; } );
	} );
	return { Text: function () { return text; }, Stop: function () { request.destroy(); } };
}


TEST( 'an LLM connection is the owner\'s to make, each a participant named <Name>@<server>, with a token the server makes and shows the owner only', async function ()
{
	ASSERT.equal( ( await call( 'POST', '/api/llms', { Name: 'nope' }, true ) ).Status, 403 );
	let made = await call( 'POST', '/api/llms', { Name: 'echo', Kind: 'claude-cli', Command: process.execPath, Arguments: ECHO_ARGUMENTS, Timeout: 30, Id: 'llm-chosen', Token: 'chosen-token-0123456789' } );
	ASSERT.equal( made.Status, 201 );
	let echo = made.Body.Llm;
	ASSERT.match( echo.Id, /^llm-/ );
	ASSERT.notEqual( echo.Id, 'llm-chosen' );
	ASSERT.notEqual( echo.Token, 'chosen-token-0123456789' );
	ASSERT.equal( echo.Token.length >= 16, true );
	ASSERT.equal( echo.Participant, 'echo@' + running.Settings.Name );
	ASSERT.equal( echo.Running, null );
	// the file has it; the participant is listed, with the connection's id; its token identifies it
	ASSERT.equal( JSON.parse( FS.readFileSync( running.Store.SettingsPath(), 'utf8' ) ).Llms[ 0 ].Token, echo.Token );
	let me = await call( 'GET', '/api/me', undefined, 'Bearer ' + echo.Token );
	ASSERT.deepEqual( me.Body.Me, { Name: echo.Participant, Display: 'echo', Role: 'llm', Llm: echo.Id } );
	ASSERT.deepEqual( me.Body.Participants.find( function ( one ) { return one.Name === echo.Participant; } ), { Name: echo.Participant, Display: 'echo', Role: 'llm', Llm: echo.Id } );
	// everyone sees the list; only the owner the whole record
	let listed = await call( 'GET', '/api/llms', undefined, true );
	ASSERT.equal( listed.Status, 200 );
	ASSERT.deepEqual( listed.Body.Llms, [ { Id: echo.Id, Name: 'echo', Kind: 'claude-cli', Model: '', Participant: echo.Participant, Running: null } ] );
	ASSERT.deepEqual( listed.Body.Kinds, [ 'claude-cli', 'ollama' ] );
	ASSERT.equal( typeof listed.Body.DefaultPrompts.Review, 'string' );
	ASSERT.equal( ( await call( 'GET', '/api/llms' ) ).Body.Llms[ 0 ].Token, echo.Token );
	// changed in place, the id and the token kept; a second one with the same name is refused; a bad name too
	let changed = await call( 'PUT', '/api/llms/' + echo.Id, { Timeout: 45, Token: 'ignored-0123456789abc' } );
	ASSERT.equal( changed.Status, 200 );
	ASSERT.deepEqual( [ changed.Body.Llm.Id, changed.Body.Llm.Timeout, changed.Body.Llm.Command, changed.Body.Llm.Token ], [ echo.Id, 45, process.execPath, echo.Token ] );
	let twice = await call( 'POST', '/api/llms', { Name: 'echo' } );
	ASSERT.equal( twice.Status, 400 );
	ASSERT.deepEqual( twice.Body.Problems, [ 'LLM connection "echo" is named twice' ] );
	ASSERT.match( ( await call( 'POST', '/api/llms', { Name: 'no spaces' } ) ).Body.Error, /letters, digits, dot, dash and colon/ );
	ASSERT.equal( ( await call( 'PUT', '/api/llms/llm-nothing', { Model: 'x' } ) ).Status, 404 );
	// the check, saved or not
	let checked = await call( 'POST', '/api/llms/' + echo.Id + '/check', {} );
	ASSERT.equal( checked.Body.Ok, true );
	ASSERT.match( checked.Body.Result, /--version: v\d+/ );
	let unsaved = await call( 'POST', '/api/llms/check', { Kind: 'claude-cli', Command: PATH.join( OS.tmpdir(), 'no-such-command' ) } );
	ASSERT.equal( unsaved.Body.Ok, false );
	ASSERT.equal( ( await call( 'POST', '/api/llms/check', {}, true ) ).Status, 403 );
} );


TEST( 'a run is asked of a connection by the owner or a member, packaged from the project and the plan, run in the project\'s folder, its record read by everyone and its changes heard', async function ()
{
	let echo = ( await call( 'GET', '/api/llms' ) ).Body.Llms[ 0 ];
	let plan = await create( 'A plan to review' );
	let thread = ( await call( 'POST', '/api/plans/' + plan.Id + '/threads', { Anchor: { Text: 'a claim' }, Text: 'Is this so?' } ) ).Body.Thread;
	// the lists: the waiting threads of the connection, the other documents
	let lists = await call( 'GET', '/api/runs/lists?Project=' + home + '&Plan=' + plan.Id + '&Llm=' + echo.Id, undefined, true );
	ASSERT.equal( lists.Status, 200 );
	ASSERT.equal( lists.Body.Participant, echo.Participant );
	ASSERT.deepEqual( lists.Body.Threads.map( function ( one ) { return one.Id; } ), [ thread.Id ] );
	ASSERT.match( lists.Body.Threads[ 0 ].Last, /^user: Is this so\?/ );
	ASSERT.equal( Array.isArray( lists.Body.Documents ), true );
	ASSERT.equal( ( await call( 'GET', '/api/runs/lists?Project=prj-nothing' ) ).Status, 400 );
	// the package: the connection's participant, the token, this server's address, the plan and the folder
	let packaged = await call( 'POST', '/api/runs/package', { Llm: echo.Id, Kind: 'review', Project: home, Plan: plan.Id } );
	ASSERT.equal( packaged.Status, 200 );
	ASSERT.equal( packaged.Body.Participant, echo.Participant );
	ASSERT.match( packaged.Body.Prompt, new RegExp( 'You are the `' + echo.Participant + '` participant' ) );
	ASSERT.match( packaged.Body.Prompt, new RegExp( '- Consensus API: ' + running.Url + '/api' ) );
	ASSERT.match( packaged.Body.Prompt, new RegExp( 'Bearer <token>": ' + echo.Token ) );
	ASSERT.match( packaged.Body.Prompt, /## Agent instructions\n\n`{3,}\n# This server/ );
	ASSERT.match( packaged.Body.Prompt, new RegExp( '- Token of the `' + echo.Participant + '` participant: ' + echo.Token ) );
	ASSERT.match( packaged.Body.Prompt, new RegExp( '### Thread ' + thread.Id + ' \\(contested' ) );
	ASSERT.equal( packaged.Body.Folder, ( await project_named( home ) ).Path );
	ASSERT.match( ( await call( 'POST', '/api/runs/package', { Llm: echo.Id, Kind: 'review', Project: home } ) ).Body.Error, /needs a plan/ );
	ASSERT.match( ( await call( 'POST', '/api/runs/package', { Llm: echo.Id, Kind: 'nope', Project: home } ) ).Body.Error, /Kind is one of/ );
	ASSERT.match( ( await call( 'POST', '/api/runs/package', { Llm: 'llm-nothing', Kind: 'session', Project: home } ) ).Body.Error, /no LLM connection/ );
	// an llm participant starts no run; the owner does, and hears it over the events
	ASSERT.equal( ( await call( 'POST', '/api/runs', { Llm: echo.Id, Kind: 'review', Project: home, Plan: plan.Id }, true ) ).Status, 403 );
	let events = listen_events();
	await new Promise( function ( resolve ) { setTimeout( resolve, 100 ); } );
	let started = await call( 'POST', '/api/runs', { Llm: echo.Id, Kind: 'review', Project: home, Plan: plan.Id } );
	ASSERT.equal( started.Status, 201 );
	ASSERT.match( started.Body.Run.Id, /^run-/ );
	ASSERT.deepEqual( [ started.Body.Run.Status, started.Body.Run.By, started.Body.Run.Kind, started.Body.Run.Prompt ], [ 'running', 'user', 'review', undefined ] );
	ASSERT.equal( ( await call( 'GET', '/api/llms', undefined, true ) ).Body.Llms[ 0 ].Running.Id, started.Body.Run.Id );
	ASSERT.equal( ( await call( 'POST', '/api/runs', { Llm: echo.Id, Kind: 'session', Project: home } ) ).Status, 409 );
	let done = await run_settled( started.Body.Run.Id );
	ASSERT.equal( done.Status, 'done' );
	ASSERT.match( done.Output, /^got: # A review one-shot from Consensus/ );
	ASSERT.deepEqual( done.Project, { Id: home, Name: ( await project_named( home ) ).Name, Path: ( await project_named( home ) ).Path } );
	ASSERT.deepEqual( done.Plan, { Id: plan.Id, Title: 'A plan to review' } );
	ASSERT.equal( done.Prompt, packaged.Body.Prompt );
	events.Stop();
	ASSERT.match( events.Text(), new RegExp( '"Kind":"run","Run":"' + started.Body.Run.Id + '","Llm":"' + echo.Id + '","Status":"running"' ) );
	ASSERT.match( events.Text(), new RegExp( '"Run":"' + started.Body.Run.Id + '","Llm":"' + echo.Id + '","Status":"done"' ) );
	// the list, as the llm too; the record file in the config folder; a finished run is not stopped
	let listed = await call( 'GET', '/api/runs?Llm=' + echo.Id, undefined, true );
	ASSERT.equal( listed.Body.Runs.length, 1 );
	ASSERT.equal( listed.Body.Runs[ 0 ].Output, undefined );
	ASSERT.equal( listed.Body.Running, null );
	ASSERT.equal( FS.existsSync( PATH.join( running.Store.Folder, 'runs', started.Body.Run.Id + '.json' ) ), true );
	ASSERT.equal( ( await call( 'POST', '/api/runs/' + started.Body.Run.Id + '/stop' ) ).Status, 404 );
	ASSERT.equal( ( await call( 'GET', '/api/runs/run-nothing' ) ).Status, 404 );
	ASSERT.equal( ( await call( 'GET', '/api/runs/../x' ) ).Status, 404 );
	// deleted: its participant is gone with it
	ASSERT.equal( ( await call( 'DELETE', '/api/llms/' + echo.Id, undefined, true ) ).Status, 403 );
	ASSERT.deepEqual( ( await call( 'DELETE', '/api/llms/' + echo.Id ) ).Body, { Deleted: echo.Id } );
	ASSERT.equal( ( await call( 'GET', '/api/me', undefined, 'Bearer ' + echo.Token ) ).Status, 401 );
	ASSERT.deepEqual( ( await call( 'GET', '/api/llms' ) ).Body.Llms, [] );
} );


TEST( 'the desktop\'s workspaces from before are moved into their projects at start, and the list dropped; a connection in the file gets its token', async function ()
{
	let config = temporary_folder();
	let repo = temporary_folder();
	let first = await SERVER.Start( { Config: config, Port: 0 } );
	let made = await ( await fetch( first.Url + '/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify( { Name: 'repo', Path: repo } ) } ) ).json();
	await first.Close();
	let file = PATH.join( config, 'consensus.json' );
	let settings = JSON.parse( FS.readFileSync( file, 'utf8' ) );
	settings.Workspaces = [
		{ Id: 'wks-1', Name: 'repo', Project: 'x', Path: repo.replace( /\\/g, '/' ).toUpperCase(), Include: [ 'src/**' ], Exclude: [], Commands: [ 'npm test' ] },
		{ Id: 'wks-2', Name: 'gone', Project: 'x', Path: PATH.join( config, 'nowhere' ), Include: [], Exclude: [], Commands: [] },
	];
	settings.Llms = [ { Name: 'claude-cli', Kind: 'claude-cli' } ];
	FS.writeFileSync( file, JSON.stringify( settings ) );
	let second = await SERVER.Start( { Config: config, Port: 0 } );
	try
	{
		let project = await second.Store.ReadProject( made.Project.Id );
		ASSERT.deepEqual( [ project.Include, project.Exclude, project.Commands ], [ [ 'src/**' ], [], [ 'npm test' ] ] );
		let written = JSON.parse( FS.readFileSync( file, 'utf8' ) );
		ASSERT.equal( written.Workspaces, undefined );
		ASSERT.equal( written.Llms[ 0 ].Token.length >= 16, true );
		ASSERT.match( written.Llms[ 0 ].Id, /^llm-/ );
		ASSERT.equal( ( await ( await fetch( second.Url + '/api/me' ) ).json() ).Participants.some( function ( one ) { return one.Name === 'claude-cli@' + written.Name; } ), true );
		// a project with lists of its own keeps them
		let again = JSON.parse( FS.readFileSync( file, 'utf8' ) );
		again.Workspaces = [ { Name: 'other', Path: repo, Include: [ 'docs/**' ], Exclude: [], Commands: [] } ];
		FS.writeFileSync( file, JSON.stringify( again ) );
		let lines = await SERVER.MigrateWorkspaces( second.Store, again );
		ASSERT.match( lines[ 0 ], /has lists of its own/ );
		ASSERT.deepEqual( ( await second.Store.ReadProject( made.Project.Id ) ).Include, [ 'src/**' ] );
	}
	finally
	{
		await second.Close();
	}
} );
