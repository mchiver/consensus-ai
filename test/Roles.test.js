'use strict';

// The roles (plan User Management, Step 3; Accounts and Roles): the four folders, what each allows, which tasks a
// role presses, the refusals in plain words, and the route table every API route is checked against.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const ROLES = require( '../src/Roles.js' );


TEST( 'the role folders: empty, cleaned to one folder per account, and read', function ()
{
	ASSERT.deepEqual( ROLES.Empty(), { Owners: [], Members: [], Service: [], Watchers: [] } );
	let clean = ROLES.Clean( { Owners: [ ' usr-1 ', 'usr-2' ], Members: [ 'usr-2', '', 'usr-3' ], Watchers: [ 'usr-1', 'usr-4' ], Other: [ 'x' ] } );
	ASSERT.deepEqual( clean, { Owners: [ 'usr-1', 'usr-2' ], Members: [ 'usr-3' ], Service: [], Watchers: [ 'usr-4' ] } );
	ASSERT.deepEqual( ROLES.Clean( null ), ROLES.Empty() );
	let project = { Roles: clean };
	ASSERT.deepEqual( [ ROLES.RoleOf( project, 'usr-1' ), ROLES.RoleOf( project, 'usr-3' ), ROLES.RoleOf( project, 'usr-4' ), ROLES.RoleOf( project, 'usr-9' ), ROLES.RoleOf( {}, 'usr-1' ) ], [ 'Owners', 'Members', 'Watchers', null, null ] );
} );


TEST( 'what each role allows, which tasks it presses, and the refusals', function ()
{
	let table = {};
	for ( let role of ROLES.ROLES )
	{
		table[ role ] = [ 'read', 'write', 'resolve', 'state', 'manage', 'roles', 'press' ].filter( function ( action ) { return ROLES.Allows( role, action ); } );
	}
	ASSERT.deepEqual( table, {
		Owners: [ 'read', 'write', 'resolve', 'state', 'manage', 'roles', 'press' ],
		Members: [ 'read', 'write', 'resolve', 'press' ],
		Service: [ 'read', 'write' ],
		Watchers: [ 'read', 'press' ],
	} );
	ASSERT.equal( ROLES.Allows( null, 'read' ), false );
	ASSERT.equal( ROLES.Allows( 'Owners', 'admin' ), false );
	ASSERT.deepEqual( [ 'none', 'consensus', 'files' ].map( function ( writes ) { return ROLES.MayPress( 'Watchers', writes ); } ), [ true, false, false ] );
	ASSERT.deepEqual( [ 'none', 'consensus', 'files' ].map( function ( writes ) { return ROLES.MayPress( 'Members', writes ); } ), [ true, true, true ] );
	ASSERT.deepEqual( [ ROLES.MayPress( 'Owners', 'files' ), ROLES.MayPress( 'Service', 'none' ), ROLES.MayPress( null, 'none' ) ], [ true, false, false ] );
	ASSERT.equal( ROLES.Reason( null, 'read' ), 'no role in this project' );
	ASSERT.equal( ROLES.Reason( 'Watchers', 'write' ), 'a Watcher reads only' );
	ASSERT.equal( ROLES.Reason( 'Watchers', 'press' ), 'a Watcher presses the tasks that write nothing' );
	ASSERT.equal( ROLES.Reason( 'Service', 'press' ), 'a Service account presses no task' );
	ASSERT.equal( ROLES.Reason( 'Members', 'state' ), 'a Member never sets a plan\'s state' );
	ASSERT.equal( ROLES.Reason( 'Members', 'manage' ), 'a Member never manages the project' );
	ASSERT.equal( ROLES.Reason( 'Service', 'roles' ), 'a Service account never assigns roles' );
} );


TEST( 'the route table: every route comes to an action and says where its project is; an unknown route is the Administrator\'s', function ()
{
	function rule( method, path )
	{
		let found = ROLES.Rule( method, path );
		return [ found.Action, found.Source, found.Id ];
	}
	ASSERT.deepEqual( rule( 'GET', '/me' ), [ 'open', null, null ] );
	ASSERT.deepEqual( rule( 'GET', '/users' ), [ 'open', null, null ] );
	ASSERT.deepEqual( rule( 'GET', '/runs/run-1' ), [ 'open', null, null ] );
	ASSERT.deepEqual( rule( 'GET', '/projects' ), [ 'list', null, null ] );
	ASSERT.deepEqual( rule( 'GET', '/plans' ), [ 'list', null, null ] );
	ASSERT.deepEqual( rule( 'GET', '/waiting' ), [ 'list', null, null ] );
	ASSERT.deepEqual( rule( 'GET', '/settings' ), [ 'admin', null, null ] );
	ASSERT.deepEqual( rule( 'PUT', '/settings' ), [ 'admin', null, null ] );
	ASSERT.deepEqual( rule( 'POST', '/llms' ), [ 'admin', null, null ] );
	ASSERT.deepEqual( rule( 'DELETE', '/llms/llm-1' ), [ 'admin', null, null ] );
	ASSERT.deepEqual( rule( 'GET', '/llms' ), [ 'open', null, null ] );
	ASSERT.deepEqual( rule( 'DELETE', '/trash' ), [ 'admin', null, null ] );
	ASSERT.deepEqual( rule( 'POST', '/projects' ), [ 'admin', null, null ] );
	ASSERT.deepEqual( rule( 'POST', '/projects/import' ), [ 'admin', null, null ] );
	ASSERT.deepEqual( rule( 'DELETE', '/projects/prj-1' ), [ 'admin', null, null ] );
	ASSERT.deepEqual( rule( 'POST', '/projects/prj-1/move' ), [ 'admin', null, null ] );
	ASSERT.deepEqual( rule( 'POST', '/users' ), [ 'admin', null, null ] );
	ASSERT.deepEqual( rule( 'DELETE', '/users/usr-1' ), [ 'admin', null, null ] );
	ASSERT.deepEqual( rule( 'GET', '/users/usr-1' ), [ 'self', null, null ] );
	ASSERT.deepEqual( rule( 'POST', '/users/usr-1/tokens' ), [ 'self', null, null ] );
	ASSERT.deepEqual( rule( 'DELETE', '/users/usr-1/tokens/laptop' ), [ 'self', null, null ] );
	ASSERT.deepEqual( rule( 'PUT', '/projects/prj-1/roles' ), [ 'roles', 'param', 'prj-1' ] );
	ASSERT.deepEqual( rule( 'PUT', '/projects/prj-1' ), [ 'settings', 'param', 'prj-1' ] );
	ASSERT.deepEqual( rule( 'POST', '/projects/prj-1/folders' ), [ 'manage', 'param', 'prj-1' ] );
	ASSERT.deepEqual( rule( 'GET', '/projects/prj-1/export' ), [ 'read', 'param', 'prj-1' ] );
	ASSERT.deepEqual( rule( 'GET', '/items/pln-1/export' ), [ 'read', 'item', 'pln-1' ] );
	ASSERT.deepEqual( rule( 'POST', '/items/pln-1/move' ), [ 'manage', 'item', 'pln-1' ] );
	ASSERT.deepEqual( rule( 'POST', '/plans' ), [ 'write', 'body', null ] );
	ASSERT.deepEqual( rule( 'GET', '/plans/pln-1' ), [ 'read', 'plan', 'pln-1' ] );
	ASSERT.deepEqual( rule( 'GET', '/plans/pln-1/threads' ), [ 'read', 'plan', 'pln-1' ] );
	ASSERT.deepEqual( rule( 'PUT', '/plans/pln-1' ), [ 'manage', 'plan', 'pln-1' ] );
	ASSERT.deepEqual( rule( 'DELETE', '/plans/pln-1' ), [ 'manage', 'plan', 'pln-1' ] );
	ASSERT.deepEqual( rule( 'PUT', '/plans/pln-1/state' ), [ 'state', 'plan', 'pln-1' ] );
	ASSERT.deepEqual( rule( 'PUT', '/plans/pln-1/text' ), [ 'write', 'plan', 'pln-1' ] );
	ASSERT.deepEqual( rule( 'POST', '/plans/pln-1/threads' ), [ 'write', 'plan', 'pln-1' ] );
	ASSERT.deepEqual( rule( 'POST', '/plans/pln-1/threads/thr-1/replies' ), [ 'write', 'plan', 'pln-1' ] );
	ASSERT.deepEqual( rule( 'POST', '/plans/pln-1/threads/thr-1/apply' ), [ 'write', 'plan', 'pln-1' ] );
	ASSERT.deepEqual( rule( 'POST', '/plans/pln-1/threads/thr-1/resolve' ), [ 'resolve', 'plan', 'pln-1' ] );
	ASSERT.deepEqual( rule( 'DELETE', '/plans/pln-1/threads/thr-1' ), [ 'manage', 'plan', 'pln-1' ] );
	ASSERT.deepEqual( rule( 'GET', '/runs/lists' ), [ 'read', 'query', null ] );
	ASSERT.deepEqual( rule( 'POST', '/runs/package' ), [ 'read', 'body', null ] );
	ASSERT.deepEqual( rule( 'POST', '/runs' ), [ 'press', 'body', null ] );
	ASSERT.deepEqual( rule( 'POST', '/runs/run-1/stop' ), [ 'open', null, null ] );
	ASSERT.deepEqual( rule( 'DELETE', '/runs/run-1' ), [ 'open', null, null ] );
	ASSERT.deepEqual( rule( 'GET', '/nowhere' ), [ 'admin', null, null ] );
	ASSERT.deepEqual( rule( 'get', '/plans/pln-1/' ), [ 'read', 'plan', 'pln-1' ] );
} );
