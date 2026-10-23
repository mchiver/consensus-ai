'use strict';

// The interface definition (plan MCP Server, Step 1): every route the API had maps to an operation, every operation
// is whole (a name, a description, parameters, an action from the route table), the names are unique, the path's
// parameters are declared, and Perform runs an operation as a participant, a Refusal carrying its status.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const OPERATIONS = require( '../src/Operations.js' );
const ROLES = require( '../src/Roles.js' );

// The routes of the API as they were before the move, each the operation that serves it now.
const ROUTES = [
	[ 'GET', '/me', 'me' ],
	[ 'GET', '/settings', 'read_settings' ],
	[ 'PUT', '/settings', 'write_settings' ],
	[ 'GET', '/plans', 'list_plans' ],
	[ 'POST', '/plans', 'create_plan' ],
	[ 'GET', '/plans/:id', 'read_plan' ],
	[ 'GET', '/plans/:id/report', 'report' ],
	[ 'GET', '/plans/:id/report.md', 'report_markdown' ],
	[ 'PUT', '/plans/:id', 'rename_plan' ],
	[ 'PUT', '/plans/:id/text', 'write_text' ],
	[ 'DELETE', '/plans/:id', 'delete_plan' ],
	[ 'GET', '/trash', 'list_trash' ],
	[ 'DELETE', '/trash', 'empty_trash' ],
	[ 'PUT', '/plans/:id/state', 'set_state' ],
	[ 'GET', '/projects', 'list_projects' ],
	[ 'POST', '/projects', 'create_project' ],
	[ 'PUT', '/projects/:pid', 'update_project' ],
	[ 'DELETE', '/projects/:pid', 'delete_project' ],
	[ 'POST', '/projects/:pid/move', 'move_project' ],
	[ 'GET', '/projects/:pid/export', 'export_project' ],
	[ 'GET', '/items/:id/export', 'export_item' ],
	[ 'POST', '/projects/import', 'import_project' ],
	[ 'POST', '/projects/:pid/folders', 'create_folder' ],
	[ 'PUT', '/projects/:pid/folders/:fid', 'rename_folder' ],
	[ 'DELETE', '/projects/:pid/folders/:fid', 'delete_folder' ],
	[ 'POST', '/items/:id/move', 'move_item' ],
	[ 'POST', '/items/:id/copy', 'copy_item' ],
	[ 'POST', '/items/:id/archive', 'archive_item' ],
	[ 'POST', '/items/:id/restore', 'restore_item' ],
	[ 'GET', '/plans/:id/revisions', 'list_revisions' ],
	[ 'GET', '/plans/:id/revisions/:n', 'read_revision' ],
	[ 'GET', '/plans/:id/threads', 'list_threads' ],
	[ 'POST', '/plans/:id/threads', 'thread' ],
	[ 'POST', '/plans/:id/threads/:tid/replies', 'reply' ],
	[ 'POST', '/plans/:id/threads/:tid/anchor', 'reanchor' ],
	[ 'POST', '/plans/:id/threads/:tid/resolve', 'resolve' ],
	[ 'DELETE', '/plans/:id/threads/:tid', 'delete_thread' ],
	[ 'POST', '/plans/:id/threads/:tid/apply', 'apply' ],
	[ 'GET', '/waiting', 'waiting' ],
	[ 'GET', '/tasks', 'list_tasks' ],
	[ 'GET', '/llms', 'list_llms' ],
	[ 'POST', '/llms', 'create_llm' ],
	[ 'POST', '/llms/check', 'check_llm' ],
	[ 'PUT', '/llms/:id', 'update_llm' ],
	[ 'POST', '/llms/:id/check', 'check_saved_llm' ],
	[ 'DELETE', '/llms/:id', 'delete_llm' ],
	[ 'GET', '/runs/lists', 'run_lists' ],
	[ 'POST', '/runs/package', 'package_run' ],
	[ 'POST', '/runs', 'start_run' ],
	[ 'GET', '/runs', 'list_runs' ],
	[ 'GET', '/runs/:id', 'read_run' ],
	[ 'POST', '/runs/:id/stop', 'stop_run' ],
	[ 'DELETE', '/runs/:id', 'delete_run' ],
	[ 'GET', '/users', 'list_users' ],
	[ 'POST', '/users', 'create_user' ],
	[ 'GET', '/users/:id', 'read_user' ],
	[ 'PUT', '/users/:id', 'update_user' ],
	[ 'DELETE', '/users/:id', 'delete_user' ],
	[ 'POST', '/users/:id/tokens', 'mint_token' ],
	[ 'DELETE', '/users/:id/tokens/:name', 'revoke_token' ],
	[ 'GET', '/users/:id/activity', 'activity' ],
	[ 'PUT', '/projects/:pid/roles', 'set_roles' ],
];

const ACTIONS = [ 'read', 'write', 'resolve', 'state', 'manage', 'roles', 'press', 'admin', 'self', 'list', 'open' ];
const PARAM_NAMES = { id: 'Id', pid: 'Project', fid: 'Folder', tid: 'Thread', n: 'Revision', name: 'Name' };


function fake_context( more )
{
	let sent = [];
	let store = {
		ListTrash: async function () { return [ { Id: 'pln-1' } ]; },
		SettingsPath: function () { return 'C:/config/consensus.json'; },
	};
	return Object.assign( { Store: store, Settings: { Name: 'Test' }, Events: { Send: function ( event ) { sent.push( event ); } }, Sent: sent }, more || {} );
}


TEST( 'every route of the API maps to an operation, by method and path, and nothing else is defined', function ()
{
	let operations = OPERATIONS.Operations( fake_context() );
	let by_route = {};
	for ( let operation of operations.List )
	{
		by_route[ operation.Method + ' ' + operation.Path ] = operation.Name;
	}
	for ( let route of ROUTES )
	{
		ASSERT.equal( by_route[ route[ 0 ] + ' ' + route[ 1 ] ], route[ 2 ], route[ 0 ] + ' ' + route[ 1 ] );
	}
	ASSERT.equal( operations.List.length, ROUTES.length );
	ASSERT.equal( new Set( operations.List.map( function ( operation ) { return operation.Name; } ) ).size, ROUTES.length );
} );


TEST( 'every operation is whole: a lower_case name, a description, parameters with types, the path\'s parameters declared and required, an action from the route table, a status', function ()
{
	let operations = OPERATIONS.Operations( fake_context() );
	for ( let operation of operations.List )
	{
		ASSERT.match( operation.Name, /^[a-z]+(_[a-z]+)*$/, operation.Name );
		ASSERT.equal( typeof operation.Description, 'string', operation.Name );
		ASSERT.ok( operation.Description.length > 20, operation.Name + ' describes itself' );
		ASSERT.equal( typeof operation.Parameters, 'object', operation.Name );
		for ( let field of Object.keys( operation.Parameters ) )
		{
			ASSERT.match( field, /^[A-Z][A-Za-z]*$/, operation.Name + ' parameter ' + field );
			ASSERT.ok( [ 'string', 'integer', 'boolean', 'object', 'array' ].includes( operation.Parameters[ field ].Type ), operation.Name + ' ' + field + ' has a type' );
		}
		for ( let match of operation.Path.matchAll( /:([a-z]+)/g ) )
		{
			let name = PARAM_NAMES[ match[ 1 ] ];
			ASSERT.ok( name, operation.Name + ' names its :' + match[ 1 ] );
			ASSERT.ok( operation.Parameters[ name ], operation.Name + ' declares ' + name );
			ASSERT.equal( operation.Parameters[ name ].Required, true, operation.Name + ' requires ' + name );
		}
		ASSERT.ok( ACTIONS.includes( operation.Action ), operation.Name + ' action ' + operation.Action );
		ASSERT.equal( operation.Action, ROLES.Rule( operation.Method, operation.Path.replace( /:[a-z]+/g, 'run-x' ) ).Action, operation.Name );
		ASSERT.ok( operation.Status === 200 || operation.Status === 201, operation.Name );
		ASSERT.equal( typeof operation.Perform, 'function', operation.Name );
	}
} );


TEST( 'the actions are the route table\'s: the reads read, the writes write, the server\'s own are the Administrator\'s', function ()
{
	let operations = OPERATIONS.Operations( fake_context() );
	let action_of = function ( name ) { return operations.Get( name ).Action; };
	ASSERT.equal( action_of( 'read_plan' ), 'read' );
	ASSERT.equal( action_of( 'list_threads' ), 'read' );
	ASSERT.equal( action_of( 'thread' ), 'write' );
	ASSERT.equal( action_of( 'reply' ), 'write' );
	ASSERT.equal( action_of( 'apply' ), 'write' );
	ASSERT.equal( action_of( 'write_text' ), 'write' );
	ASSERT.equal( action_of( 'resolve' ), 'resolve' );
	ASSERT.equal( action_of( 'set_state' ), 'state' );
	ASSERT.equal( action_of( 'rename_plan' ), 'manage' );
	ASSERT.equal( action_of( 'delete_thread' ), 'manage' );
	ASSERT.equal( action_of( 'set_roles' ), 'roles' );
	ASSERT.equal( action_of( 'start_run' ), 'press' );
	ASSERT.equal( action_of( 'write_settings' ), 'admin' );
	ASSERT.equal( action_of( 'create_project' ), 'admin' );
	ASSERT.equal( action_of( 'read_user' ), 'self' );
	ASSERT.equal( action_of( 'waiting' ), 'list' );
	ASSERT.equal( action_of( 'me' ), 'open' );
	ASSERT.equal( action_of( 'read_run' ), 'open' );
} );


TEST( 'Perform runs an operation as a participant; a refusal is a Refusal with its status; an unknown name is 404', async function ()
{
	let context = fake_context();
	let operations = OPERATIONS.Operations( context );
	let owner = { Name: 'user', Role: 'owner', Type: 'owner', Admin: true, Speaker: 'user' };
	let watcher = { Name: 'ann', Role: 'user', Type: 'user', Admin: false, Speaker: 'ann', Id: 'usr-1' };
	ASSERT.deepEqual( await operations.Perform( 'list_trash', owner, {} ), { Plans: [ { Id: 'pln-1' } ] } );
	ASSERT.deepEqual( await operations.Perform( 'read_settings', owner, {} ), { Settings: context.Settings, Path: 'C:/config/consensus.json' } );
	await ASSERT.rejects( operations.Perform( 'read_settings', watcher, {} ), function ( error )
	{
		ASSERT.ok( OPERATIONS.IsRefusal( error ) );
		ASSERT.equal( error.Status, 403 );
		ASSERT.equal( error.Error, 'only the Administrator reads the settings' );
		return true;
	} );
	await ASSERT.rejects( operations.Perform( 'empty_trash', watcher, {} ), function ( error )
	{
		ASSERT.equal( error.Status, 403 );
		return true;
	} );
	await ASSERT.rejects( operations.Perform( 'no_such_thing', owner, {} ), function ( error )
	{
		ASSERT.ok( OPERATIONS.IsRefusal( error ) );
		ASSERT.equal( error.Status, 404 );
		return true;
	} );
	ASSERT.equal( operations.Get( 'reply' ).Name, 'reply' );
	ASSERT.equal( operations.Get( 'nothing' ), null );
} );


TEST( 'a Refusal carries its extra fields, and an Answer its status and type', function ()
{
	let refusal = new OPERATIONS.Refusal( 409, 'the text changed since revision 3', { Revision: 4 } );
	ASSERT.ok( OPERATIONS.IsRefusal( refusal ) );
	ASSERT.ok( refusal instanceof Error );
	ASSERT.equal( refusal.message, 'the text changed since revision 3' );
	ASSERT.deepEqual( refusal.Extra, { Revision: 4 } );
	ASSERT.equal( OPERATIONS.IsRefusal( new Error( 'plain' ) ), false );
	let answer = OPERATIONS.Answer( 200, '# Report', 'text/markdown; charset=utf-8' );
	ASSERT.ok( OPERATIONS.IsAnswer( answer ) );
	ASSERT.equal( answer.Type, 'text/markdown; charset=utf-8' );
	ASSERT.equal( OPERATIONS.IsAnswer( { Plans: [] } ), false );
	ASSERT.equal( OPERATIONS.Answer( 201, { Ok: true } ).Type, null );
} );
