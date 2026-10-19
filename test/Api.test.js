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
const REPO = require( './support/Repo.js' );

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
		headers[ 'X-Consensus-Service' ] = 'llm';
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
	// The llm of these tests is a service acting for the owner (plan User Management, Step 2): the header names it.
	token = null;
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
	FS.writeFileSync( PATH.join( older, 'consensus.json' ), JSON.stringify( { Port: 0, Host: '0.0.0.0', Owner: settings.Owner } ) );
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
	ASSERT.deepEqual( again.Settings.Owner, { Name: 'user', Display: 'User' } );
	await again.Close();
	// settings with problems stop the start
	let broken = temporary_folder();
	FS.writeFileSync( PATH.join( broken, 'consensus.json' ), JSON.stringify( { Port: 0, States: [] } ) );
	await ASSERT.rejects( SERVER.Start( { Data: broken, Port: 0 } ), /States must be a list of one or more names/ );
} );


TEST( 'instructions: plain text, This server first with the address the request reached, no token and the service header, then the guide', async function ()
{
	let response = await fetch( running.Url + '/instructions' );
	ASSERT.equal( response.status, 200 );
	ASSERT.match( response.headers.get( 'content-type' ), /^text\/plain; charset=utf-8/ );
	let text = await response.text();
	ASSERT.ok( text.startsWith( '# This server\n' ) );
	ASSERT.ok( text.includes( '- API: ' + running.Url + '/api\n' ) );
	ASSERT.ok( text.includes( '- No token: a request with none is the owner, User, on this server.\n' ) );
	ASSERT.ok( text.includes( '"X-Consensus-Service: <your name>"' ) );
	ASSERT.ok( text.includes( 'reads "<your name> by User"' ) );
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


TEST( 'identity: no header is the owner, the service header names the service acting for the owner, a wrong token is refused', async function ()
{
	let owner = await call( 'GET', '/api/me' );
	ASSERT.equal( owner.Status, 200 );
	ASSERT.deepEqual( owner.Body.Me, { Name: 'user', Display: 'User', Role: 'owner', Speaker: 'user' } );
	ASSERT.deepEqual( owner.Body.Participants, [ { Name: 'user', Display: 'User', Role: 'owner' } ] );
	ASSERT.equal( owner.Body.Participants.some( function ( participant ) { return 'Token' in participant; } ), false );
	ASSERT.equal( owner.Body.Version, require( '../package.json' ).version );
	let llm = await call( 'GET', '/api/me', undefined, true );
	ASSERT.deepEqual( llm.Body.Me, { Name: 'user', Display: 'User', Role: 'owner', Speaker: 'llm by user', Service: 'llm' } );
	ASSERT.deepEqual( llm.Body.Participants, [ { Name: 'user', Display: 'User', Role: 'owner' }, { Name: 'llm by user', Display: 'llm by User', Role: 'llm' } ] );
	let wrong = await call( 'GET', '/api/me', undefined, 'Bearer nope' );
	ASSERT.equal( wrong.Status, 401 );
	ASSERT.equal( wrong.Body.Error, 'unknown token' );
} );


TEST( 'settings: the Clerk section (plan User Management, Step 1) is kept, checked and dropped when empty', async function ()
{
	let read = ( await call( 'GET', '/api/settings' ) ).Body.Settings;
	ASSERT.equal( 'Clerk' in read, false );
	let keyed = Object.assign( {}, read, { Clerk: { PublishableKey: ' pk_test_1 ', SecretKey: 'sk_test_1', WebhookSecret: '', AdminEmail: 'andre@example.com' } } );
	let written = await call( 'PUT', '/api/settings', { Settings: keyed } );
	ASSERT.equal( written.Status, 200 );
	ASSERT.equal( written.Body.Restart, false );
	ASSERT.deepEqual( written.Body.Settings.Clerk, { PublishableKey: 'pk_test_1', SecretKey: 'sk_test_1', AdminEmail: 'andre@example.com' } );
	ASSERT.deepEqual( JSON.parse( FS.readFileSync( running.Store.SettingsPath(), 'utf8' ) ).Clerk, { PublishableKey: 'pk_test_1', SecretKey: 'sk_test_1', AdminEmail: 'andre@example.com' } );
	// a problem: nothing written
	let bad = await call( 'PUT', '/api/settings', { Settings: Object.assign( {}, read, { Clerk: { PublishableKey: 'pk_x', AdminEmail: 'nobody' } } ) } );
	ASSERT.equal( bad.Status, 400 );
	ASSERT.deepEqual( bad.Body.Problems, [ 'Clerk AdminEmail must be an email address' ] );
	ASSERT.deepEqual( ( await call( 'GET', '/api/settings' ) ).Body.Settings.Clerk, { PublishableKey: 'pk_test_1', SecretKey: 'sk_test_1', AdminEmail: 'andre@example.com' } );
	// emptied: the section leaves the file
	let emptied = await call( 'PUT', '/api/settings', { Settings: Object.assign( {}, read, { Clerk: { PublishableKey: '', SecretKey: '', WebhookSecret: '', AdminEmail: '' } } ) } );
	ASSERT.equal( emptied.Status, 200 );
	ASSERT.equal( 'Clerk' in emptied.Body.Settings, false );
	ASSERT.equal( 'Clerk' in JSON.parse( FS.readFileSync( running.Store.SettingsPath(), 'utf8' ) ), false );
} );


TEST( 'settings: the owner reads and writes consensus.json; problems are refused; Scope and Port wait for a restart; other fields stay', async function ()
{
	// a service acting for the owner reads them too (plan User Management, Step 2: every request is the owner)
	ASSERT.equal( ( await call( 'GET', '/api/settings', undefined, true ) ).Status, 200 );
	let read = await call( 'GET', '/api/settings' );
	ASSERT.equal( read.Status, 200 );
	ASSERT.equal( read.Body.Path, running.Store.SettingsPath() );
	ASSERT.deepEqual( read.Body.Settings.States, [ 'Draft', 'Plan', 'Working', 'Finished' ] );
	ASSERT.deepEqual( read.Body.Settings.Owner, { Name: 'user', Display: 'User' } );

	// problems: none written
	let bad = await call( 'PUT', '/api/settings', { Settings: Object.assign( {}, read.Body.Settings, { Owner: { Display: 'X' } } ) } );
	ASSERT.equal( bad.Status, 400 );
	ASSERT.deepEqual( bad.Body.Problems, [ 'Owner must have a Name' ] );
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

	// written: the states, the owner's display; the file and the running server follow at once
	let member_token = PARTICIPANTS.NewToken();
	// the desktop's fields in the same file (plan Run Shapes) are not the modal's to write: they stay
	await running.Store.WriteSettings( Object.assign( {}, read.Body.Settings, { Servers: [ { Name: 'cube4', Url: 'http://cube4:3500' } ] } ) );
	running.Settings.Servers = [ { Name: 'cube4', Url: 'http://cube4:3500' } ];
	let fresh = {
		Port: read.Body.Settings.Port,
		Scope: read.Body.Settings.Scope,
		Name: 'renamed',
		States: [ 'Draft', 'Plan', 'Working', 'Finished', 'Shelved' ],
		Owner: { Name: 'user', Display: 'Owner' },
		Workers: [ { Name: 'gone' } ],
	};
	let written = await call( 'PUT', '/api/settings', { Settings: fresh } );
	ASSERT.equal( written.Status, 200 );
	ASSERT.equal( written.Body.Restart, false );
	ASSERT.equal( 'Workers' in written.Body.Settings, false );
	ASSERT.deepEqual( written.Body.Settings.Servers, [ { Name: 'cube4', Url: 'http://cube4:3500' } ] );
	ASSERT.equal( ( await call( 'GET', '/api/me' ) ).Body.Server, 'renamed' );
	ASSERT.deepEqual( ( await call( 'GET', '/api/me' ) ).Body.States, fresh.States );
	ASSERT.deepEqual( ( await call( 'GET', '/api/me' ) ).Body.Me, { Name: 'user', Display: 'Owner', Role: 'owner', Speaker: 'user' } );
	ASSERT.equal( ( await call( 'GET', '/api/me', undefined, 'Bearer ' + member_token ) ).Status, 401 );
	let on_disk = JSON.parse( FS.readFileSync( running.Store.SettingsPath(), 'utf8' ) );
	ASSERT.deepEqual( on_disk.States, fresh.States );
	ASSERT.deepEqual( on_disk.Owner, { Name: 'user', Display: 'Owner' } );
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
	ASSERT.deepEqual( thread.Turn, [] );
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


TEST( 'the owner resolves, a service acting for the owner too; a reply to a resolved thread reopens it', async function ()
{
	let plan = await create( 'Resolve' );
	let thread = await discussed_thread( plan.Id, 'one list item', 'Outcome: the item is reworded.' );
	let resolved = await call( 'POST', '/api/plans/' + plan.Id + '/threads/' + thread.Id + '/resolve' );
	ASSERT.equal( resolved.Status, 200 );
	ASSERT.equal( resolved.Body.Thread.Status, 'resolved' );
	ASSERT.equal( resolved.Body.Thread.State, 'resolved' );
	ASSERT.equal( resolved.Body.Thread.Resolved.By, 'user' );
	ASSERT.deepEqual( resolved.Body.Thread.Turn, [ 'llm by user' ] );
	ASSERT.equal( ( await call( 'POST', '/api/plans/' + plan.Id + '/threads/' + thread.Id + '/resolve' ) ).Status, 409 );
	ASSERT.equal( ( await call( 'POST', '/api/plans/' + plan.Id + '/threads/' + thread.Id + '/resolve', undefined, true ) ).Status, 409 );
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


TEST( 'reply and resolve: the owner\'s reply becomes the outcome in one request', async function ()
{
	let plan = await create( 'Reply and resolve' );
	let thread = await discussed_thread( plan.Id, 'one list item', 'Question: keep it, or drop it? I would keep it.' );
	let path = '/api/plans/' + plan.Id + '/threads/' + thread.Id + '/replies';
	let read = await call( 'GET', '/api/plans/' + plan.Id );
	ASSERT.equal( thread_of_body( read, thread.Id ).Replies.length, 2 );
	let both = await call( 'POST', path, { Text: 'Drop it.', Resolve: true } );
	ASSERT.equal( both.Status, 201 );
	ASSERT.equal( both.Body.Resolved, true );
	ASSERT.equal( both.Body.Thread.Status, 'resolved' );
	ASSERT.equal( both.Body.Thread.Resolved.By, 'user' );
	ASSERT.deepEqual( both.Body.Thread.Turn, [ 'llm by user' ] );
	let replies = both.Body.Thread.Replies;
	ASSERT.deepEqual( [ replies[ replies.length - 1 ].By, replies[ replies.length - 1 ].Text ], [ 'user', 'Drop it.' ] );
	// a plain reply is as it was: it reopens the resolved thread
	let plain = await call( 'POST', path, { Text: 'On second thought.' } );
	ASSERT.equal( plain.Body.Resolved, false );
	ASSERT.equal( plain.Body.Thread.Status, 'contested' );
} );


TEST( 'comment and resolve: the owner posts a thread already resolved, its comment the outcome', async function ()
{
	let plan = await create( 'Comment and resolve' );
	let path = '/api/plans/' + plan.Id + '/threads';
	let posted = await call( 'POST', path, { Text: 'Drop the last line.', Resolve: true } );
	ASSERT.equal( posted.Status, 201 );
	ASSERT.equal( posted.Body.Thread.Status, 'resolved' );
	ASSERT.equal( posted.Body.Thread.Resolved.By, 'user' );
	ASSERT.deepEqual( posted.Body.Thread.Turn, [] );
	ASSERT.equal( posted.Body.Thread.Replies.length, 1 );
	// without Resolve, a new thread is contested as before
	let plain = await call( 'POST', path, { Text: 'Why this line?' } );
	ASSERT.equal( plain.Body.Thread.Status, 'contested' );
} );


function thread_of_body( read, thread_id )
{
	return read.Body.Threads.find( function ( thread ) { return thread.Id === thread_id; } );
}


TEST( 'a thread is deleted, applied or not, by the owner or a service acting for the owner; the revision it made keeps its text', async function ()
{
	let plan = await create( 'Delete a thread' );
	let thread = await discussed_thread( plan.Id, 'one list item', 'Outcome: the item is reworded.' );
	await call( 'POST', '/api/plans/' + plan.Id + '/threads/' + thread.Id + '/resolve' );
	let applied = await call( 'POST', '/api/plans/' + plan.Id + '/threads/' + thread.Id + '/apply', { Text: TEXT.replace( 'one list item', 'one reworded item' ), Revision: 1, Outcome: 'reworded' }, true );
	ASSERT.equal( applied.Status, 200 );
	let other = ( await call( 'POST', '/api/plans/' + plan.Id + '/threads', { Text: 'A second thread.' } ) ).Body.Thread;
	let path = '/api/plans/' + plan.Id + '/threads/' + thread.Id;
	let deleted = await call( 'DELETE', path, undefined, true );
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
	ASSERT.deepEqual( [ applied.Body.Thread.Applied.By, applied.Body.Thread.Applied.Service, applied.Body.Thread.Applied.Token ], [ 'user', 'llm', undefined ] );
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
	ASSERT.deepEqual( [ revisions.Body.Revisions[ 1 ].By, revisions.Body.Revisions[ 1 ].Service ], [ 'user', 'llm' ] );
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
	ASSERT.equal( llm.Body.Me.Speaker, 'llm by user' );
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
	// Empty Trash: every trashed item gone for good
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


TEST( 'an LLM connection is made, each a speaker "<Name> by <owner>", with no token of its own', async function ()
{
	let made = await call( 'POST', '/api/llms', { Name: 'echo', Kind: 'claude-cli', Command: process.execPath, Arguments: ECHO_ARGUMENTS, Timeout: 30, Id: 'llm-chosen', Token: 'chosen-token-0123456789' } );
	ASSERT.equal( made.Status, 201 );
	let echo = made.Body.Llm;
	ASSERT.match( echo.Id, /^llm-/ );
	ASSERT.notEqual( echo.Id, 'llm-chosen' );
	ASSERT.equal( 'Token' in echo, false );
	ASSERT.equal( echo.Speaker, 'echo by User' );
	ASSERT.equal( echo.Running, null );
	// the file has it, with no token; the speaker is listed, with the connection's id
	ASSERT.equal( 'Token' in JSON.parse( FS.readFileSync( running.Store.SettingsPath(), 'utf8' ) ).Llms[ 0 ], false );
	let me = await call( 'GET', '/api/me' );
	ASSERT.deepEqual( me.Body.Participants.find( function ( one ) { return one.Name === 'echo by user'; } ), { Name: 'echo by user', Display: 'echo by User', Role: 'llm', Llm: echo.Id } );
	// everyone sees the list and, every request being the owner, the whole record
	let listed = await call( 'GET', '/api/llms', undefined, true );
	ASSERT.equal( listed.Status, 200 );
	ASSERT.deepEqual( [ listed.Body.Llms[ 0 ].Id, listed.Body.Llms[ 0 ].Name, listed.Body.Llms[ 0 ].Speaker, listed.Body.Llms[ 0 ].Command, listed.Body.Llms[ 0 ].Running ], [ echo.Id, 'echo', 'echo by User', process.execPath, null ] );
	ASSERT.deepEqual( listed.Body.Kinds, [ 'claude-cli', 'ollama' ] );
	ASSERT.equal( typeof listed.Body.DefaultPrompts.Session, 'string' );
	// changed in place, the id kept, a token given ignored; a second one with the same name is refused; a bad name too
	let changed = await call( 'PUT', '/api/llms/' + echo.Id, { Timeout: 45, Token: 'ignored-0123456789abc' } );
	ASSERT.equal( changed.Status, 200 );
	ASSERT.deepEqual( [ changed.Body.Llm.Id, changed.Body.Llm.Timeout, changed.Body.Llm.Command, 'Token' in changed.Body.Llm ], [ echo.Id, 45, process.execPath, false ] );
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
} );


TEST( 'a run is asked of a connection, packaged from the project and the plan with a run token the server mints, run in the project\'s folder as the presser through the connection, its record read by everyone and its changes heard', async function ()
{
	let echo = ( await call( 'GET', '/api/llms' ) ).Body.Llms[ 0 ];
	let plan = await create( 'A plan to review' );
	let thread = ( await call( 'POST', '/api/plans/' + plan.Id + '/threads', { Anchor: { Text: 'a claim' }, Text: 'Is this so?' } ) ).Body.Thread;
	// the lists: the waiting threads of the connection, the other documents
	let lists = await call( 'GET', '/api/runs/lists?Project=' + home + '&Plan=' + plan.Id + '&Llm=' + echo.Id, undefined, true );
	ASSERT.equal( lists.Status, 200 );
	ASSERT.equal( lists.Body.Speaker, 'echo by User' );
	ASSERT.deepEqual( lists.Body.Threads.map( function ( one ) { return one.Id; } ), [ thread.Id ] );
	ASSERT.match( lists.Body.Threads[ 0 ].Last, /^user: Is this so\?/ );
	ASSERT.equal( Array.isArray( lists.Body.Documents ), true );
	ASSERT.equal( ( await call( 'GET', '/api/runs/lists?Project=prj-nothing' ) ).Status, 400 );
	// the package: the byline, a token promised for the run (the preview has none), this server's address, the plan and the folder
	let packaged = await call( 'POST', '/api/runs/package', { Llm: echo.Id, Task: 'answer', Project: home, Plan: plan.Id } );
	ASSERT.equal( packaged.Status, 200 );
	ASSERT.equal( packaged.Body.Speaker, 'echo by User' );
	ASSERT.match( packaged.Body.Prompt, /^# Answer: a one-shot from Consensus\n/ );
	ASSERT.match( packaged.Body.Prompt, /- Task: Answer\n- Writes: consensus\./ );
	ASSERT.match( packaged.Body.Prompt, /You act for User, the owner of the Consensus server below, run once by that server ".*" through its LLM connection "echo": what you post reads "echo by User"\./ );
	ASSERT.match( packaged.Body.Prompt, new RegExp( '- Consensus API: ' + running.Url + '/api' ) );
	ASSERT.match( packaged.Body.Prompt, /Bearer <token>": made by the server when the run starts/ );
	ASSERT.match( packaged.Body.Prompt, /## Agent instructions\n\n`{3,}\n# This server/ );
	ASSERT.match( packaged.Body.Prompt, /- No token: a request with none is the owner, User, on this server\./ );
	ASSERT.match( packaged.Body.Prompt, /## Threads of the plan waiting on echo by User/ );
	ASSERT.match( packaged.Body.Prompt, new RegExp( '### Thread ' + thread.Id + ' \\(contested' ) );
	ASSERT.equal( packaged.Body.Folder, ( await project_named( home ) ).Path );
	ASSERT.match( ( await call( 'POST', '/api/runs/package', { Llm: echo.Id, Task: 'answer', Project: home } ) ).Body.Error, /needs a plan/ );
	ASSERT.match( ( await call( 'POST', '/api/runs/package', { Llm: echo.Id, Task: 'nope', Project: home } ) ).Body.Error, /no task with the id nope/ );
	ASSERT.match( ( await call( 'POST', '/api/runs/package', { Llm: 'llm-nothing', Task: 'session', Project: home } ) ).Body.Error, /no LLM connection/ );
	// the owner starts it and hears it over the events
	let events = listen_events();
	await new Promise( function ( resolve ) { setTimeout( resolve, 100 ); } );
	let started = await call( 'POST', '/api/runs', { Llm: echo.Id, Task: 'answer', Project: home, Plan: plan.Id } );
	ASSERT.equal( started.Status, 201 );
	ASSERT.match( started.Body.Run.Id, /^run-/ );
	ASSERT.deepEqual( [ started.Body.Run.Status, started.Body.Run.By, started.Body.Run.Service, started.Body.Run.Token, started.Body.Run.Task, started.Body.Run.Writes, started.Body.Run.Prompt ], [ 'running', 'user', 'echo', 'Answer run', { Id: 'answer', Name: 'Answer' }, 'consensus', undefined ] );
	ASSERT.equal( running.Tokens.Count(), 1 );
	ASSERT.equal( ( await call( 'GET', '/api/llms', undefined, true ) ).Body.Llms[ 0 ].Running.Id, started.Body.Run.Id );
	ASSERT.equal( ( await call( 'POST', '/api/runs', { Llm: echo.Id, Task: 'session', Project: home } ) ).Status, 409 );
	let done = await run_settled( started.Body.Run.Id );
	ASSERT.equal( done.Status, 'done' );
	ASSERT.match( done.Output, /^got: # Answer: a one-shot from Consensus/ );
	ASSERT.deepEqual( done.Project, { Id: home, Name: ( await project_named( home ) ).Name, Path: ( await project_named( home ) ).Path } );
	ASSERT.deepEqual( done.Plan, { Id: plan.Id, Title: 'A plan to review' } );
	// the run's prompt carries the run's token, which the preview did not; the token is gone with the run
	ASSERT.match( done.Prompt, /Bearer <token>": [0-9a-f]{48}\n/ );
	ASSERT.match( done.Prompt, /What you post reads "echo by User"/ );
	ASSERT.notEqual( done.Prompt, packaged.Body.Prompt );
	ASSERT.equal( running.Tokens.Count(), 0 );
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
	// deleted: its speaker is gone with it
	ASSERT.deepEqual( ( await call( 'DELETE', '/api/llms/' + echo.Id ) ).Body, { Deleted: echo.Id } );
	ASSERT.equal( ( await call( 'GET', '/api/me' ) ).Body.Participants.some( function ( one ) { return one.Name === 'echo by user'; } ), false );
	ASSERT.deepEqual( ( await call( 'GET', '/api/llms' ) ).Body.Llms, [] );
} );


TEST( 'the tasks (plan LLM Tasks, Step 1): listed, edited in the settings, enabled per project, packaged by their switches, and a run token carries the task\'s Writes', async function ()
{
	let listed = await call( 'GET', '/api/tasks', undefined, true );
	ASSERT.equal( listed.Status, 200 );
	ASSERT.deepEqual( listed.Body.Tasks.map( function ( one ) { return one.Id; } ), [ 'answer', 'enhance', 'work', 'explain', 'session' ] );
	ASSERT.deepEqual( listed.Body.Writes, [ 'none', 'consensus', 'files' ] );
	ASSERT.deepEqual( listed.Body.Package, [ 'Instructions', 'Readme', 'Documents', 'Plan', 'Threads', 'Files', 'Project', 'Box' ] );
	ASSERT.deepEqual( listed.Body.Off, [ 'Project', 'Box' ] );
	ASSERT.equal( listed.Body.Defaults[ 2 ].Name, 'Work' );
	// a task added through the settings, its id made by the server; a bad list is refused and nothing written
	let settings = ( await call( 'GET', '/api/settings' ) ).Body.Settings;
	let tasks = settings.Tasks.concat( [ { Name: 'Describe', Writes: 'none', Package: { Instructions: true, Readme: true, Documents: true, Plan: false, Threads: false, Files: false }, Prompt: 'Describe the project.' } ] );
	let saved = await call( 'PUT', '/api/settings', { Settings: Object.assign( {}, settings, { Tasks: tasks } ) } );
	ASSERT.equal( saved.Status, 200 );
	ASSERT.equal( saved.Body.Settings.Tasks.length, 6 );
	let explain = saved.Body.Settings.Tasks[ 5 ];
	ASSERT.match( explain.Id, /^tsk-/ );
	ASSERT.deepEqual( [ explain.Name, explain.Writes, explain.Package.Plan, explain.Package.Project, explain.Package.Box ], [ 'Describe', 'none', false, false, false ] );
	ASSERT.equal( JSON.parse( FS.readFileSync( running.Store.SettingsPath(), 'utf8' ) ).Tasks.length, 6 );
	ASSERT.equal( JSON.parse( FS.readFileSync( running.Store.SettingsPath(), 'utf8' ) ).TasksVersion, 3 );
	let refused = await call( 'PUT', '/api/settings', { Settings: Object.assign( {}, settings, { Tasks: tasks.concat( [ { Name: 'Describe' } ] ) } ) } );
	ASSERT.equal( refused.Status, 400 );
	ASSERT.deepEqual( refused.Body.Problems, [ 'task "Describe" is named twice' ] );
	ASSERT.equal( ( await call( 'GET', '/api/tasks' ) ).Body.Tasks.length, 6 );
	// enabled per project: the list of ids (trimmed, once each), or null for all
	ASSERT.deepEqual( ( await call( 'PUT', '/api/projects/' + home, { Tasks: [ 'work', explain.Id, 'work', ' ' ] } ) ).Body.Project.Tasks, [ 'work', explain.Id ] );
	ASSERT.deepEqual( ( await call( 'GET', '/api/tasks?Project=' + home ) ).Body.Tasks.map( function ( one ) { return one.Id; } ), [ 'work', explain.Id ] );
	let echo = ( await call( 'POST', '/api/llms', { Name: 'echo2', Kind: 'claude-cli', Command: process.execPath, Arguments: ECHO_ARGUMENTS, Timeout: 30 } ) ).Body.Llm;
	let plan = await create( 'A plan to explain' );
	ASSERT.match( ( await call( 'POST', '/api/runs/package', { Llm: echo.Id, Task: 'answer', Project: home, Plan: plan.Id } ) ).Body.Error, /"Answer" is not enabled in the project/ );
	ASSERT.match( ( await call( 'POST', '/api/runs/package', { Llm: echo.Id, Project: home, Plan: plan.Id } ) ).Body.Error, /a Task is needed: one of answer, enhance, work, explain, session/ );
	// Describe packages no plan and no folder, and says it reads only
	let packaged = await call( 'POST', '/api/runs/package', { Llm: echo.Id, Task: explain.Id, Project: home } );
	ASSERT.equal( packaged.Status, 200 );
	ASSERT.match( packaged.Body.Prompt, /^# Describe: a one-shot from Consensus/ );
	ASSERT.match( packaged.Body.Prompt, /- Writes: none\. This run reads only/ );
	ASSERT.match( packaged.Body.Prompt, /## Your task: Describe\n\nDescribe the project\./ );
	ASSERT.equal( packaged.Body.Prompt.includes( '## The project' ), false );
	ASSERT.equal( packaged.Body.Prompt.includes( 'The plan at hand' ), false );
	ASSERT.equal( packaged.Body.Folder, null );
	ASSERT.equal( ( await call( 'GET', '/api/tasks?Project=prj-nothing' ) ).Status, 404 );
	ASSERT.equal( ( await call( 'PUT', '/api/projects/' + home, { Tasks: null } ) ).Body.Project.Tasks, undefined );
	ASSERT.equal( ( await call( 'GET', '/api/tasks?Project=' + home ) ).Body.Tasks.length, 6 );
	// a run token with Writes none reads, and is refused every write; a consensus one replies
	let read_only = running.Tokens.Mint( { Service: 'echo2', Name: 'Explain run', Project: home, Writes: 'none' } );
	let me = await call( 'GET', '/api/me', undefined, 'Bearer ' + read_only );
	ASSERT.deepEqual( [ me.Body.Me.Token, me.Body.Me.Writes ], [ 'Explain run', 'none' ] );
	ASSERT.equal( ( await call( 'GET', '/api/plans/' + plan.Id, undefined, 'Bearer ' + read_only ) ).Status, 200 );
	let write = await call( 'POST', '/api/plans/' + plan.Id + '/threads', { Text: 'I would like to say' }, 'Bearer ' + read_only );
	ASSERT.deepEqual( [ write.Status, write.Body.Error ], [ 403, 'this run reads only' ] );
	ASSERT.equal( ( await call( 'PUT', '/api/plans/' + plan.Id + '/state', { State: 'Plan' }, 'Bearer ' + read_only ) ).Status, 403 );
	let writing = running.Tokens.Mint( { Service: 'echo2', Name: 'Answer run', Project: home, Writes: 'consensus' } );
	ASSERT.equal( ( await call( 'POST', '/api/plans/' + plan.Id + '/threads', { Text: 'Said.' }, 'Bearer ' + writing ) ).Status, 201 );
	ASSERT.equal( 'Writes' in ( await call( 'GET', '/api/me' ) ).Body.Me, false );
	running.Tokens.Drop( read_only );
	running.Tokens.Drop( writing );
	// a Work run's record names the task and its level; the token is named after the task
	let started = await call( 'POST', '/api/runs', { Llm: echo.Id, Task: 'work', Project: home, Plan: plan.Id } );
	ASSERT.equal( started.Status, 201 );
	ASSERT.deepEqual( [ started.Body.Run.Task, started.Body.Run.Writes, started.Body.Run.Token ], [ { Id: 'work', Name: 'Work' }, 'files', 'Work run' ] );
	let done = await run_settled( started.Body.Run.Id );
	ASSERT.match( done.Output, /^got: # Work: a one-shot from Consensus/ );
	ASSERT.match( done.Prompt, /- Writes: files\./ );
	ASSERT.equal( running.Tokens.Count(), 0 );
	// back to the shipped five
	ASSERT.equal( ( await call( 'PUT', '/api/settings', { Settings: Object.assign( {}, settings, { Tasks: settings.Tasks } ) } ) ).Body.Settings.Tasks.length, 5 );
	ASSERT.deepEqual( ( await call( 'DELETE', '/api/llms/' + echo.Id ) ).Body, { Deleted: echo.Id } );
} );


// A stand-in for an Enhance run (plan LLM Tasks, Step 2): it reads the package from its standard input, takes the API
// address, the token, the plan id and the person's instructions from it, and posts a new text and one thread as the run.
const ENHANCE_STAND_IN = [
	"let t = '';",
	"process.stdin.on( 'data', function ( c ) { t += c; } );",
	"process.stdin.on( 'end', async function ()",
	"{",
	"\tlet api = /- Consensus API: (\\S+)/.exec( t )[ 1 ];",
	"\tlet token = /Bearer <token>\": ([0-9a-f]{48})/.exec( t )[ 1 ];",
	"\tlet plan = /The plan at hand: .* \\((pln-[^)]+)\\)/.exec( t )[ 1 ];",
	"\tlet asked = /## Your instructions\\n\\n([^\\n]+)/.exec( t )[ 1 ];",
	"\tlet headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };",
	"\tlet current = await ( await fetch( api + '/plans/' + plan, { headers: headers } ) ).json();",
	"\tlet text = '# A sketch\\n\\n## Enhanced\\n\\nAs asked: ' + asked + '\\n';",
	"\tlet written = await ( await fetch( api + '/plans/' + plan + '/text', { method: 'PUT', headers: headers, body: JSON.stringify( { Text: text, Revision: current.Plan.Revision } ) } ) ).json();",
	"\tlet thread = await ( await fetch( api + '/plans/' + plan + '/threads', { method: 'POST', headers: headers, body: JSON.stringify( { Anchor: { Text: 'As asked' }, Text: 'How many sections exactly?' } ) } ) ).json();",
	"\tprocess.stdout.write( 'wrote revision ' + written.Plan.Revision + ' and asked in ' + thread.Thread.Id + ( t.includes( '## Threads' ) ? ' (threads were packaged)' : '' ) );",
	"} );",
].join( '\n' );


TEST( 'Enhance (plan LLM Tasks, Step 2) runs end to end: the box\'s text is packaged under Your instructions, no threads are, and the run posts a revision and a thread on its token as the connection by the owner', async function ()
{
	let stand_in = PATH.join( temporary_folder(), 'enhance.js' );
	FS.writeFileSync( stand_in, ENHANCE_STAND_IN );
	let echo = ( await call( 'POST', '/api/llms', { Name: 'enhancer', Kind: 'claude-cli', Command: process.execPath, Arguments: [ stand_in ], Timeout: 60 } ) ).Body.Llm;
	let plan = await create( 'A sketch', '# A sketch\n\nA few words.\n' );
	let waiting = ( await call( 'POST', '/api/plans/' + plan.Id + '/threads', { Anchor: { Text: 'A few words' }, Text: 'Is this enough?' } ) ).Body.Thread;
	// the preview carries the text and names the task
	let packaged = await call( 'POST', '/api/runs/package', { Llm: echo.Id, Task: 'enhance', Project: home, Plan: plan.Id, Text: 'Three sections, please.' } );
	ASSERT.equal( packaged.Status, 200 );
	ASSERT.deepEqual( [ packaged.Body.Task, packaged.Body.Text, packaged.Body.Folder ], [ { Id: 'enhance', Name: 'Enhance' }, 'Three sections, please.', null ] );
	ASSERT.match( packaged.Body.Prompt, /## Your task: Enhance\n\nReplace the plan's text/ );
	ASSERT.match( packaged.Body.Prompt, /## Your instructions\n\nThree sections, please\./ );
	ASSERT.equal( packaged.Body.Prompt.includes( '## Threads' ), false );
	// the run
	let started = await call( 'POST', '/api/runs', { Llm: echo.Id, Task: 'enhance', Project: home, Plan: plan.Id, Text: 'Three sections, please.' } );
	ASSERT.equal( started.Status, 201 );
	ASSERT.deepEqual( [ started.Body.Run.Task, started.Body.Run.Text, started.Body.Run.Token ], [ { Id: 'enhance', Name: 'Enhance' }, 'Three sections, please.', 'Enhance run' ] );
	let done = await run_settled( started.Body.Run.Id );
	ASSERT.equal( done.Status, 'done', done.Output );
	ASSERT.match( done.Output, /^wrote revision 2 and asked in thr-/ );
	ASSERT.equal( done.Output.includes( 'threads were packaged' ), false );
	let read = ( await call( 'GET', '/api/plans/' + plan.Id ) ).Body;
	ASSERT.equal( read.Plan.Revision, 2 );
	ASSERT.match( read.Text, /## Enhanced\n\nAs asked: Three sections, please\./ );
	let revisions = ( await call( 'GET', '/api/plans/' + plan.Id + '/revisions' ) ).Body.Revisions;
	ASSERT.deepEqual( [ revisions[ 1 ].By, revisions[ 1 ].Service, revisions[ 1 ].Token, revisions[ 1 ].Reason ], [ 'user', 'enhancer', 'Enhance run', 'edit' ] );
	let asked = read.Threads.find( function ( one ) { return one.Id !== waiting.Id; } );
	ASSERT.deepEqual( [ asked.Status, asked.Replies[ 0 ].By, asked.Replies[ 0 ].Service, asked.Replies[ 0 ].Token, asked.Anchor.Text ], [ 'contested', 'user', 'enhancer', 'Enhance run', 'As asked' ] );
	ASSERT.equal( running.Tokens.Count(), 0 );
	ASSERT.deepEqual( ( await call( 'DELETE', '/api/llms/' + echo.Id ) ).Body, { Deleted: echo.Id } );
} );

TEST( 'the desktop\'s workspaces from before are moved into their projects at start, and the list dropped; a connection in the file gets its id and no token', async function ()
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
		ASSERT.equal( 'Token' in written.Llms[ 0 ], false );
		ASSERT.match( written.Llms[ 0 ].Id, /^llm-/ );
		ASSERT.equal( ( await ( await fetch( second.Url + '/api/me' ) ).json() ).Participants.some( function ( one ) { return one.Name === 'claude-cli by user'; } ), true );
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


// A stand-in for a Work run (plan LLM Tasks, Step 3): it reads the package from its standard input, writes a file in
// the project's folder (its working folder) and posts a build log, a whole-document thread, as the run.
const WORK_STAND_IN = [
	"let t = '';",
	"process.stdin.on( 'data', function ( c ) { t += c; } );",
	"process.stdin.on( 'end', async function ()",
	"{",
	"\tlet api = /- Consensus API: (\\S+)/.exec( t )[ 1 ];",
	"\tlet token = /Bearer <token>\": ([0-9a-f]{48})/.exec( t )[ 1 ];",
	"\tlet plan = /The plan at hand: .* \\((pln-[^)]+)\\)/.exec( t )[ 1 ];",
	"\trequire( 'fs' ).writeFileSync( 'built.txt', 'built\\n' );",
	"\tlet headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };",
	"\tlet thread = await ( await fetch( api + '/plans/' + plan + '/threads', { method: 'POST', headers: headers, body: JSON.stringify( { Text: '**Build log.** Made built.txt.' } ) } ) ).json();",
	"\tprocess.stdout.write( 'posted ' + thread.Thread.Id );",
	"} );",
].join( '\n' );


TEST( 'the Work options (plan LLM Tasks, Step 3): Git sync pulls before a run that writes files and refuses one outside a checkout; Auto-commit commits and pushes the build log the owner resolves, the thread keeping the record', { skip: REPO.Present() ? false : 'git is not on this machine' }, async function ()
{
	let repo = REPO.Checkout();
	let project = ( await call( 'POST', '/api/projects', { Name: 'Synced', Path: repo.Clone } ) ).Body.Project;
	// the options are the project's; false is dropped from the file
	let set = await call( 'PUT', '/api/projects/' + project.Id, { GitSync: true, AutoCommit: true } );
	ASSERT.equal( set.Status, 200 );
	ASSERT.deepEqual( [ set.Body.Project.GitSync, set.Body.Project.AutoCommit ], [ true, true ] );
	let unset = await call( 'PUT', '/api/projects/' + project.Id, { AutoCommit: false } );
	ASSERT.deepEqual( [ 'AutoCommit' in unset.Body.Project, unset.Body.Project.GitSync ], [ false, true ] );
	await call( 'PUT', '/api/projects/' + project.Id, { AutoCommit: true } );
	ASSERT.deepEqual( [ ( await project_named( project.Id ) ).GitSync, ( await project_named( project.Id ) ).AutoCommit ], [ true, true ] );
	// the run: a commit from elsewhere is pulled first, the stand-in writes a file and posts the build log
	let stand_in = PATH.join( temporary_folder(), 'work.js' );
	FS.writeFileSync( stand_in, WORK_STAND_IN );
	let worker = ( await call( 'POST', '/api/llms', { Name: 'worker', Kind: 'claude-cli', Command: process.execPath, Arguments: [ stand_in ], Timeout: 60 } ) ).Body.Llm;
	let plan = ( await call( 'POST', '/api/plans', { Title: 'Build a thing', Text: '# Build a thing\n\nMake built.txt.\n', Project: project.Id } ) ).Body.Plan;
	REPO.PushFromElsewhere( repo, 'elsewhere.txt', 'from elsewhere\n' );
	let started = await call( 'POST', '/api/runs', { Llm: worker.Id, Task: 'work', Project: project.Id, Plan: plan.Id } );
	ASSERT.equal( started.Status, 201, JSON.stringify( started.Body ) );
	let done = await run_settled( started.Body.Run.Id );
	ASSERT.equal( done.Status, 'done', done.Output );
	ASSERT.match( done.Git.Pull, /elsewhere\.txt/ );
	ASSERT.equal( FS.existsSync( PATH.join( repo.Clone, 'elsewhere.txt' ) ), true );
	ASSERT.equal( FS.existsSync( PATH.join( repo.Clone, 'built.txt' ) ), true );
	let read = ( await call( 'GET', '/api/plans/' + plan.Id ) ).Body;
	let log = read.Threads[ 0 ];
	ASSERT.deepEqual( [ log.Anchor, log.Replies[ 0 ].Service, log.Replies[ 0 ].Token ], [ null, 'worker', 'Work run' ] );
	// a thread of the owner's own is no build log: resolved without a record
	let note = ( await call( 'POST', '/api/plans/' + plan.Id + '/threads', { Text: 'A note.', Resolve: true } ) ).Body.Thread;
	ASSERT.equal( note.Git, undefined );
	// the owner resolves the build log: committed with the plan's title and the log, and pushed
	let resolved = await call( 'POST', '/api/plans/' + plan.Id + '/threads/' + log.Id + '/resolve' );
	ASSERT.equal( resolved.Status, 200 );
	let record = resolved.Body.Thread.Git;
	ASSERT.match( record.Commit, /^[0-9a-f]{7,}$/ );
	ASSERT.deepEqual( [ record.Branch, record.Pushed, record.Error ], [ 'main', true, null ] );
	ASSERT.equal( REPO.Sh( repo.Bare, [ 'log', '-1', '--format=%s%n%n%b', 'main' ] ), 'Build a thing\n\n**Build log.** Made built.txt.' );
	// the record itself is written after the commit, so it lands in the next one
	ASSERT.equal( REPO.Sh( repo.Clone, [ 'status', '--porcelain' ] ), 'M .consensus/content/' + plan.Id + '/threads.json' );
	let kept = ( await call( 'GET', '/api/plans/' + plan.Id ) ).Body.Threads.find( function ( one ) { return one.Id === log.Id; } );
	ASSERT.deepEqual( kept.Git, record );
	// reopened and resolved again on a project whose .consensus is ignored: nothing to commit, no error
	FS.writeFileSync( PATH.join( repo.Clone, '.gitignore' ), '.consensus/\n' );
	REPO.Sh( repo.Clone, [ 'rm', '-r', '-q', '--cached', '.consensus' ] );
	REPO.Sh( repo.Clone, [ 'add', '-A' ] );
	REPO.Sh( repo.Clone, [ 'commit', '-q', '-m', 'ignore .consensus' ] );
	await call( 'POST', '/api/plans/' + plan.Id + '/threads/' + log.Id + '/replies', { Text: 'One more look.' } );
	let again = await call( 'POST', '/api/plans/' + plan.Id + '/threads/' + log.Id + '/replies', { Text: 'Fine.', Resolve: true } );
	ASSERT.equal( again.Status, 201 );
	ASSERT.deepEqual( [ again.Body.Thread.Git.Commit, again.Body.Thread.Git.Error, again.Body.Thread.Git.Pushed ], [ null, null, null ] );
	// a project that is no checkout, Git sync on: the run is refused before it starts
	let plain = ( await call( 'POST', '/api/projects', { Name: 'Plain', Path: temporary_folder() } ) ).Body.Project;
	await call( 'PUT', '/api/projects/' + plain.Id, { GitSync: true } );
	let elsewhere = ( await call( 'POST', '/api/plans', { Title: 'Elsewhere', Text: '# Elsewhere\n', Project: plain.Id } ) ).Body.Plan;
	let refused = await call( 'POST', '/api/runs', { Llm: worker.Id, Task: 'work', Project: plain.Id, Plan: elsewhere.Id } );
	ASSERT.equal( refused.Status, 400 );
	ASSERT.match( refused.Body.Error, /^git pull failed in .*not a git repository/ );
	ASSERT.equal( running.Tokens.Count(), 0 );
	ASSERT.deepEqual( ( await call( 'DELETE', '/api/llms/' + worker.Id ) ).Body, { Deleted: worker.Id } );
} );


// A stand-in for an Explain run (plan LLM Tasks, Step 4): it reads the package, finds the project's shape, reads the
// first plan listed through the API on its token, answers from it, and tries a write, which the token refuses.
const EXPLAIN_STAND_IN = [
	"let t = '';",
	"process.stdin.on( 'data', function ( c ) { t += c; } );",
	"process.stdin.on( 'end', async function ()",
	"{",
	"\tlet api = /- Consensus API: (\\S+)/.exec( t )[ 1 ];",
	"\tlet token = /Bearer <token>\": ([0-9a-f]{48})/.exec( t )[ 1 ];",
	"\tlet listed = /## The project\\n[^]*?\\n- (.+?) \\((pln-[^)]+)\\): /.exec( t );",
	"\tlet asked = /## Your instructions\\n\\n([^\\n]+)/.exec( t )[ 1 ];",
	"\tlet headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };",
	"\tlet read = await ( await fetch( api + '/plans/' + listed[ 2 ], { headers: headers } ) ).json();",
	"\tlet refused = await fetch( api + '/plans/' + listed[ 2 ] + '/threads', { method: 'POST', headers: headers, body: JSON.stringify( { Text: 'May I?' } ) } );",
	"\tprocess.stdout.write( '**' + asked + '** The plan \"' + read.Plan.Title + '\" has ' + read.Threads.length + ' thread(s) and is in state ' + read.Plan.State + '; a write was refused ' + refused.status + ( t.includes( '## Runs' ) ? '; runs listed' : '' ) + '.' );",
	"} );",
].join( '\n' );


TEST( 'Explain (plan LLM Tasks, Step 4) runs end to end: the project\'s shape is packaged, the run reads a plan on its token and is refused a write, the answer is its output, and the conversation is listed, filtered and cleared', async function ()
{
	let stand_in = PATH.join( temporary_folder(), 'explain.js' );
	FS.writeFileSync( stand_in, EXPLAIN_STAND_IN );
	let explainer = ( await call( 'POST', '/api/llms', { Name: 'explainer', Kind: 'claude-cli', Command: process.execPath, Arguments: [ stand_in ], Timeout: 60 } ) ).Body.Llm;
	let plan = await create( 'Explained plan', '# Explained plan\n\nA few words to ask about.\n' );
	await call( 'POST', '/api/plans/' + plan.Id + '/threads', { Anchor: { Text: 'A few words' }, Text: 'Why so few?' } );
	await call( 'PUT', '/api/plans/' + plan.Id + '/state', { State: 'Plan' } );
	// the preview: the shape and the runs, no plan at hand, the folder (Files is on)
	let packaged = await call( 'POST', '/api/runs/package', { Llm: explainer.Id, Task: 'explain', Project: home, Text: 'What is the plan?' } );
	ASSERT.equal( packaged.Status, 200 );
	ASSERT.match( packaged.Body.Prompt, new RegExp( '## The project\\n\\n[^]*- Explained plan \\(' + plan.Id + '\\): Plan, contested 1, resolved 0, applied 0' ) );
	ASSERT.match( packaged.Body.Prompt, /## Runs\n/ );
	ASSERT.match( packaged.Body.Prompt, /- Writes: none\. This run reads only/ );
	ASSERT.equal( packaged.Body.Prompt.includes( 'The plan at hand' ), false );
	ASSERT.notEqual( packaged.Body.Folder, null );
	// the run: the record names the task, the question and the level; nothing is posted
	let started = await call( 'POST', '/api/runs', { Llm: explainer.Id, Task: 'explain', Project: home, Text: 'What is the plan?' } );
	ASSERT.equal( started.Status, 201, JSON.stringify( started.Body ) );
	ASSERT.deepEqual( [ started.Body.Run.Task, started.Body.Run.Writes, started.Body.Run.Text, started.Body.Run.Token, started.Body.Run.By ], [ { Id: 'explain', Name: 'Explain' }, 'none', 'What is the plan?', 'Explain run', 'user' ] );
	let done = await run_settled( started.Body.Run.Id );
	ASSERT.equal( done.Status, 'done', done.Output );
	ASSERT.match( done.Output, /^\*\*What is the plan\?\*\* The plan ".+" has \d+ thread\(s\) and is in state \w+; a write was refused 403; runs listed\.$/ );
	ASSERT.equal( ( await call( 'GET', '/api/plans/' + plan.Id ) ).Body.Threads.length, 1 );
	ASSERT.equal( running.Tokens.Count(), 0 );
	// the conversation: the person's Explain runs of the project, filtered by project, task and asker
	let mine = ( await call( 'GET', '/api/runs?Project=' + home + '&Task=explain&By=user' ) ).Body.Runs;
	ASSERT.deepEqual( mine.map( function ( run ) { return run.Id; } ), [ done.Id ] );
	ASSERT.equal( ( await call( 'GET', '/api/runs?Project=' + home + '&Task=explain&By=nobody' ) ).Body.Runs.length, 0 );
	ASSERT.equal( ( await call( 'GET', '/api/runs?Project=prj-none&Task=explain' ) ).Body.Runs.length, 0 );
	ASSERT.equal( ( await call( 'GET', '/api/runs?Task=explain' ) ).Body.Runs.length, 1 );
	// Clear: the record deleted, once
	ASSERT.deepEqual( ( await call( 'DELETE', '/api/runs/' + done.Id ) ).Body, { Deleted: done.Id } );
	ASSERT.equal( ( await call( 'GET', '/api/runs/' + done.Id ) ).Status, 404 );
	ASSERT.equal( ( await call( 'DELETE', '/api/runs/' + done.Id ) ).Status, 404 );
	ASSERT.equal( ( await call( 'GET', '/api/runs?Task=explain' ) ).Body.Runs.length, 0 );
	ASSERT.deepEqual( ( await call( 'DELETE', '/api/llms/' + explainer.Id ) ).Body, { Deleted: explainer.Id } );
} );
