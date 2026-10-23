'use strict';

// The MCP server (plan MCP Server, Step 2): the protocol over the definition (Mcp.Handle with a fake definition),
// the network transport (POST /api/mcp on a server started here) and the stdio relay (bin/mcp.js over pipes).

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const FS = require( 'fs' );
const OS = require( 'os' );
const PATH = require( 'path' );
const CHILD_PROCESS = require( 'child_process' );
const SERVER = require( '../src/Server.js' );
const MCP = require( '../src/Mcp.js' );
const OPERATIONS = require( '../src/Operations.js' );

const RELAY = PATH.join( __dirname, '..', 'bin', 'mcp.js' );


function fake()
{
	let performed = [];
	let operations = {
		List: [
			{ Name: 'read_plan', Method: 'GET', Path: '/plans/:id', Description: 'A plan whole.', Parameters: { Id: { Type: 'string', Required: true, Description: 'the id' } }, Action: 'read', Status: 200 },
			{ Name: 'create_plan', Method: 'POST', Path: '/plans', Description: 'A new plan.', Parameters: { Title: { Type: 'string', Required: true }, Project: { Type: 'string', Description: 'the project' }, Tags: { Type: 'array' }, Draft: { Type: 'boolean' }, Rank: { Type: 'integer' } }, Action: 'write', Status: 201 },
		],
		Get: function ( name )
		{
			return this.List.find( function ( operation ) { return operation.Name === name; } ) || null;
		},
		Perform: async function ( name, participant, args )
		{
			performed.push( { Name: name, By: participant.Name, Args: args } );
			if ( name === 'read_plan' && args.Id === 'pln-missing' )
			{
				throw new OPERATIONS.Refusal( 404, 'no such plan' );
			}
			if ( name === 'read_plan' && args.Id === 'pln-stale' )
			{
				throw new OPERATIONS.Refusal( 409, 'the text changed since revision 3', { Revision: 4 } );
			}
			if ( name === 'read_plan' && args.Id === 'boom' )
			{
				throw new Error( 'boom' );
			}
			if ( name === 'read_plan' && args.Id === 'rpt' )
			{
				return OPERATIONS.Answer( 200, '# Report', 'html' );
			}
			return { Plan: { Id: args.Id || 'pln-new', Title: args.Title || 'A plan' } };
		},
	};
	let store = { ListProjects: async function () { return [ { Id: 'prj-1', Name: 'Consensus' } ]; } };
	let checked = [];
	let authorize = async function ( participant, operation, args )
	{
		checked.push( operation.Name );
		if ( participant.Name === 'ann' && operation.Action === 'write' )
		{
			throw new OPERATIONS.Refusal( 403, 'a Watcher reads' );
		}
	};
	return { Mcp: MCP.Mcp( { Operations: operations, Store: store, Authorize: authorize } ), Performed: performed, Checked: checked };
}


const OWNER = { Name: 'user', Role: 'owner', Speaker: 'user' };
const ANN = { Name: 'ann', Role: 'user', Speaker: 'ann', Id: 'usr-ann' };


function request( id, method, params )
{
	let message = { jsonrpc: '2.0', id: id, method: method };
	if ( params !== undefined )
	{
		message.params = params;
	}
	return message;
}


//---------------------------------------------------------------------
// The protocol

TEST( 'initialize answers the protocol version (the client\'s when it is one we know), the tools capability and the server; initialized is a notification; ping answers', async function ()
{
	let mcp = fake().Mcp;
	let reply = await mcp.Handle( request( 1, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '0' } } ), OWNER );
	ASSERT.equal( reply.jsonrpc, '2.0' );
	ASSERT.equal( reply.id, 1 );
	ASSERT.equal( reply.result.protocolVersion, '2025-03-26' );
	ASSERT.deepEqual( reply.result.capabilities, { tools: {} } );
	ASSERT.equal( reply.result.serverInfo.name, 'Consensus' );
	ASSERT.equal( reply.result.serverInfo.version, require( '../package.json' ).version );
	let unknown = await mcp.Handle( request( 2, 'initialize', { protocolVersion: '1999-01-01' } ), OWNER );
	ASSERT.equal( unknown.result.protocolVersion, MCP.PROTOCOL_VERSION );
	ASSERT.equal( await mcp.Handle( { jsonrpc: '2.0', method: 'notifications/initialized' }, OWNER ), null );
	ASSERT.deepEqual( ( await mcp.Handle( request( 'p', 'ping' ), OWNER ) ).result, {} );
} );


TEST( 'tools/list renders the definition in MCP\'s form: every operation a tool, its parameters the input schema with their types and the required ones, Project an id or a name', async function ()
{
	let mcp = fake().Mcp;
	let reply = await mcp.Handle( request( 3, 'tools/list' ), OWNER );
	let tools = reply.result.tools;
	ASSERT.deepEqual( tools.map( function ( tool ) { return tool.name; } ), [ 'read_plan', 'create_plan' ] );
	ASSERT.equal( tools[ 0 ].description, 'A plan whole.' );
	ASSERT.deepEqual( tools[ 0 ].inputSchema, { type: 'object', properties: { Id: { type: 'string', description: 'the id' } }, required: [ 'Id' ] } );
	let create = tools[ 1 ].inputSchema;
	ASSERT.deepEqual( create.required, [ 'Title' ] );
	ASSERT.deepEqual( create.properties.Tags, { type: 'array', items: { type: 'string' } } );
	ASSERT.deepEqual( create.properties.Draft, { type: 'boolean' } );
	ASSERT.deepEqual( create.properties.Rank, { type: 'integer' } );
	ASSERT.equal( create.properties.Project.description, 'the project; an id or a name' );
	ASSERT.deepEqual( mcp.Tools(), tools );
} );


TEST( 'tools/call performs the operation as the participant and answers its JSON as text; a Refusal is an error result with the sentence and its extras; an Answer is its body; a project\'s name becomes its id; the transport\'s authorize is asked first', async function ()
{
	let made = fake();
	let mcp = made.Mcp;
	let reply = await mcp.Handle( request( 4, 'tools/call', { name: 'read_plan', arguments: { Id: 'pln-1' } } ), OWNER );
	ASSERT.equal( reply.id, 4 );
	ASSERT.equal( reply.result.isError, undefined );
	ASSERT.deepEqual( reply.result.content.length, 1 );
	ASSERT.equal( reply.result.content[ 0 ].type, 'text' );
	ASSERT.deepEqual( JSON.parse( reply.result.content[ 0 ].text ), { Plan: { Id: 'pln-1', Title: 'A plan' } } );
	ASSERT.deepEqual( made.Performed[ 0 ], { Name: 'read_plan', By: 'user', Args: { Id: 'pln-1' } } );
	ASSERT.deepEqual( made.Checked, [ 'read_plan' ] );
	let missing = await mcp.Handle( request( 5, 'tools/call', { name: 'read_plan', arguments: { Id: 'pln-missing' } } ), OWNER );
	ASSERT.equal( missing.result.isError, true );
	ASSERT.equal( missing.result.content[ 0 ].text, 'no such plan' );
	let stale = await mcp.Handle( request( 6, 'tools/call', { name: 'read_plan', arguments: { Id: 'pln-stale' } } ), OWNER );
	ASSERT.equal( stale.result.content[ 0 ].text, 'the text changed since revision 3 {"Revision":4}' );
	let report = await mcp.Handle( request( 7, 'tools/call', { name: 'read_plan', arguments: { Id: 'rpt' } } ), OWNER );
	ASSERT.equal( report.result.content[ 0 ].text, '# Report' );
	// the project by its name, or by its id, or a name no project has as it was given
	await mcp.Handle( request( 8, 'tools/call', { name: 'create_plan', arguments: { Title: 'T', Project: 'Consensus' } } ), OWNER );
	ASSERT.equal( made.Performed[ made.Performed.length - 1 ].Args.Project, 'prj-1' );
	await mcp.Handle( request( 9, 'tools/call', { name: 'create_plan', arguments: { Title: 'T', Project: 'prj-1' } } ), OWNER );
	ASSERT.equal( made.Performed[ made.Performed.length - 1 ].Args.Project, 'prj-1' );
	await mcp.Handle( request( 10, 'tools/call', { name: 'create_plan', arguments: { Title: 'T', Project: 'Nowhere' } } ), OWNER );
	ASSERT.equal( made.Performed[ made.Performed.length - 1 ].Args.Project, 'Nowhere' );
	// the transport's authorize refuses before the operation runs
	let before = made.Performed.length;
	let refused = await mcp.Handle( request( 11, 'tools/call', { name: 'create_plan', arguments: { Title: 'T' } } ), ANN );
	ASSERT.equal( refused.result.isError, true );
	ASSERT.equal( refused.result.content[ 0 ].text, 'a Watcher reads' );
	ASSERT.equal( made.Performed.length, before );
	let read = await mcp.Handle( request( 12, 'tools/call', { name: 'read_plan', arguments: { Id: 'pln-2' } } ), ANN );
	ASSERT.equal( read.result.isError, undefined );
	ASSERT.equal( made.Performed[ made.Performed.length - 1 ].By, 'ann' );
	// no arguments at all
	let bare = await mcp.Handle( request( 13, 'tools/call', { name: 'read_plan' } ), OWNER );
	ASSERT.equal( bare.result.isError, undefined );
} );


TEST( 'the protocol\'s errors: an unknown method, an unknown tool, a message that is no request, an internal error; a batch is answered as an array, its notifications left out', async function ()
{
	let mcp = fake().Mcp;
	let unknown = await mcp.Handle( request( 1, 'resources/list' ), OWNER );
	ASSERT.deepEqual( unknown, { jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'unknown method: resources/list' } } );
	let tool = await mcp.Handle( request( 2, 'tools/call', { name: 'nothing', arguments: {} } ), OWNER );
	ASSERT.deepEqual( tool.error, { code: -32602, message: 'unknown tool: nothing' } );
	let bad = await mcp.Handle( { id: 3, method: 'ping' }, OWNER );
	ASSERT.deepEqual( bad.error, { code: -32600, message: 'not a JSON-RPC 2.0 request' } );
	ASSERT.equal( bad.id, 3 );
	ASSERT.equal( ( await mcp.Handle( 'text', OWNER ) ).id, null );
	let internal = await mcp.Handle( request( 4, 'tools/call', { name: 'read_plan', arguments: { Id: 'boom' } } ), OWNER );
	ASSERT.deepEqual( internal.error, { code: -32603, message: 'internal error: boom' } );
	// a notification that fails answers nothing; an unknown notification nothing
	ASSERT.equal( await mcp.Handle( { jsonrpc: '2.0', method: 'tools/call', params: { name: 'read_plan', arguments: { Id: 'boom' } } }, OWNER ), null );
	ASSERT.equal( await mcp.Handle( { jsonrpc: '2.0', method: 'notifications/cancelled' }, OWNER ), null );
	let batch = await mcp.Handle( [ request( 5, 'ping' ), { jsonrpc: '2.0', method: 'notifications/initialized' }, request( 6, 'tools/list' ) ], OWNER );
	ASSERT.equal( batch.length, 2 );
	ASSERT.deepEqual( batch[ 0 ], { jsonrpc: '2.0', id: 5, result: {} } );
	ASSERT.equal( batch[ 1 ].id, 6 );
	ASSERT.deepEqual( await mcp.Handle( [ { jsonrpc: '2.0', method: 'notifications/initialized' } ], OWNER ), [] );
	ASSERT.equal( ( await mcp.Handle( [], OWNER ) ).error.code, -32600 );
} );


//---------------------------------------------------------------------
// The transports, over a server started here

function temporary_folder()
{
	return FS.mkdtempSync( PATH.join( OS.tmpdir(), 'consensus-mcp-' ) );
}


async function post( url, body, headers )
{
	let response = await fetch( url + '/api/mcp', { method: 'POST', headers: Object.assign( { 'Content-Type': 'application/json' }, headers || { 'X-Consensus-Service': 'Relay' } ), body: ( typeof body === 'string' ) ? body : JSON.stringify( body ) } );
	let text = await response.text();
	return { Status: response.status, Body: text ? JSON.parse( text ) : null };
}


async function api( url, method, path, body )
{
	let headers = { 'X-Consensus-Service': 'Relay' };
	if ( body !== undefined )
	{
		headers[ 'Content-Type' ] = 'application/json';
	}
	let response = await fetch( url + path, { method: method, headers: headers, body: ( body === undefined ) ? undefined : JSON.stringify( body ) } );
	return { Status: response.status, Body: await response.json() };
}


TEST( 'the network transport: POST /api/mcp takes a JSON-RPC message as the request\'s participant, every operation a tool, a call checked on its action and posted with the byline; a notification is 202; a body that is not JSON is the parse error; a batch answers an array; GET is 405; an unknown token is refused as on every route', async function ()
{
	let running = await SERVER.Start( { Data: temporary_folder(), Port: 0 } );
	try
	{
		let url = running.Url;
		let initialized = await post( url, request( 1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } } ) );
		ASSERT.equal( initialized.Status, 200 );
		ASSERT.equal( initialized.Body.result.protocolVersion, '2025-06-18' );
		ASSERT.equal( ( await post( url, { jsonrpc: '2.0', method: 'notifications/initialized' } ) ).Status, 202 );
		let listed = await post( url, request( 2, 'tools/list' ) );
		let names = listed.Body.result.tools.map( function ( tool ) { return tool.name; } );
		ASSERT.equal( names.length, OPERATIONS.Definition().length );
		ASSERT.ok( names.includes( 'read_plan' ) && names.includes( 'reply' ) && names.includes( 'mint_token' ) );
		// a project by name, a plan made and a thread posted through the protocol, as the service for the owner
		let projects = await post( url, request( 3, 'tools/call', { name: 'list_projects', arguments: {} } ) );
		let project = JSON.parse( projects.Body.result.content[ 0 ].text ).Projects[ 0 ];
		let created = await post( url, request( 4, 'tools/call', { name: 'create_plan', arguments: { Title: 'Over MCP', Text: '# Over MCP\n\nA line to discuss.\n', Project: project.Name } } ) );
		ASSERT.equal( created.Body.result.isError, undefined, JSON.stringify( created.Body ) );
		let plan = JSON.parse( created.Body.result.content[ 0 ].text ).Plan;
		ASSERT.equal( plan.Title, 'Over MCP' );
		let posted = await post( url, request( 5, 'tools/call', { name: 'thread', arguments: { Id: plan.Id, Text: 'Why this line?', Anchor: { Text: 'A line to discuss.' } } } ) );
		let thread = JSON.parse( posted.Body.result.content[ 0 ].text ).Thread;
		ASSERT.equal( thread.Anchor.Text, 'A line to discuss.' );
		ASSERT.deepEqual( [ thread.Replies[ 0 ].By, thread.Replies[ 0 ].Service ], [ 'user', 'Relay' ] );
		let read = ( await api( url, 'GET', '/api/plans/' + plan.Id ) ).Body;
		ASSERT.equal( read.Threads.length, 1 );
		ASSERT.equal( read.Threads[ 0 ].Replies[ 0 ].Service, 'Relay' );
		// a refusal is an error result, not a protocol error
		let missing = await post( url, request( 6, 'tools/call', { name: 'read_plan', arguments: { Id: 'pln-none' } } ) );
		ASSERT.equal( missing.Status, 200 );
		ASSERT.equal( missing.Body.result.isError, true );
		ASSERT.equal( missing.Body.result.content[ 0 ].text, 'no such plan' );
		// the report comes as its page
		let report = await post( url, request( 7, 'tools/call', { name: 'report', arguments: { Id: plan.Id } } ) );
		ASSERT.match( report.Body.result.content[ 0 ].text, /<html/ );
		// a batch, the parse error, the method, the token
		let batch = await post( url, [ request( 8, 'ping' ), request( 9, 'ping' ) ] );
		ASSERT.equal( batch.Body.length, 2 );
		let broken = await post( url, '{ not json' );
		ASSERT.equal( broken.Status, 200 );
		ASSERT.deepEqual( broken.Body.error, { code: -32700, message: 'the body is not JSON' } );
		let got = await fetch( url + '/api/mcp', { headers: { 'X-Consensus-Service': 'Relay' } } );
		ASSERT.equal( got.status, 405 );
		ASSERT.equal( got.headers.get( 'allow' ), 'POST' );
		let refused = await post( url, request( 10, 'ping' ), { Authorization: 'Bearer not-a-token' } );
		ASSERT.equal( refused.Status, 401 );
		ASSERT.equal( refused.Body.Error, 'unknown token' );
	}
	finally
	{
		await running.Close();
	}
} );


// The relay as a client runs it: lines in, lines out, over pipes.
function relay( args )
{
	let child = CHILD_PROCESS.spawn( process.execPath, [ RELAY ].concat( args ), { stdio: [ 'pipe', 'pipe', 'pipe' ] } );
	let out = '';
	let err = '';
	child.stdout.on( 'data', function ( chunk ) { out += chunk; } );
	child.stderr.on( 'data', function ( chunk ) { err += chunk; } );
	let exited = new Promise( function ( resolve ) { child.on( 'exit', function ( code ) { resolve( code ); } ); } );
	return {
		Send: function ( message ) { child.stdin.write( ( ( typeof message === 'string' ) ? message : JSON.stringify( message ) ) + '\n' ); },
		Lines: function () { return out.split( '\n' ).filter( function ( line ) { return line.trim(); } ).map( function ( line ) { return JSON.parse( line ); } ); },
		Until: async function ( count )
		{
			let waited = 0;
			while ( out.split( '\n' ).filter( function ( line ) { return line.trim(); } ).length < count && waited < 20000 )
			{
				await new Promise( function ( resolve ) { setTimeout( resolve, 50 ); } );
				waited += 50;
			}
		},
		End: async function () { child.stdin.end(); return await exited; },
		Errors: function () { return err; },
	};
}


TEST( 'the stdio relay: each line goes to the server and its reply comes back on one line; --project fills in the project for a tool that takes one; a notification answers nothing; a line that is not JSON is the parse error; a saved server by name; a server that does not answer is an error that says so', async function ()
{
	let running = await SERVER.Start( { Data: temporary_folder(), Port: 0 } );
	try
	{
		let url = running.Url;
		let project = ( await api( url, 'GET', '/api/projects' ) ).Body.Projects[ 0 ];
		let child = relay( [ '--server', url, '--service', 'Claude-CLI', '--project', project.Name ] );
		child.Send( request( 1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } } ) );
		child.Send( { jsonrpc: '2.0', method: 'notifications/initialized' } );
		child.Send( request( 2, 'tools/call', { name: 'create_plan', arguments: { Title: 'From the relay', Text: '# From the relay\n' } } ) );
		child.Send( '{ not json' );
		child.Send( request( 3, 'ping' ) );
		await child.Until( 4 );
		ASSERT.equal( await child.End(), 0, child.Errors() );
		let lines = child.Lines();
		ASSERT.equal( lines.length, 4, JSON.stringify( lines ) );
		ASSERT.equal( lines[ 0 ].id, 1 );
		ASSERT.equal( lines[ 0 ].result.serverInfo.name, 'Consensus' );
		ASSERT.equal( lines[ 1 ].id, 2 );
		let plan = JSON.parse( lines[ 1 ].result.content[ 0 ].text ).Plan;
		ASSERT.equal( plan.Title, 'From the relay' );
		ASSERT.equal( lines[ 2 ].error.code, -32700 );
		ASSERT.deepEqual( lines[ 3 ], { jsonrpc: '2.0', id: 3, result: {} } );
		// the plan went into the named project, posted as the service for the owner
		let read = ( await api( url, 'GET', '/api/plans/' + plan.Id ) ).Body;
		ASSERT.equal( read.Project.Id, project.Id );
		let revisions = ( await api( url, 'GET', '/api/plans/' + plan.Id + '/revisions' ) ).Body.Revisions;
		ASSERT.deepEqual( [ revisions[ 0 ].By, revisions[ 0 ].Service ], [ 'user', 'Claude-CLI' ] );
		// a saved server by its name, from a config folder of the relay's own
		let config = temporary_folder();
		FS.writeFileSync( PATH.join( config, 'consensus.json' ), JSON.stringify( { Servers: [ { Name: 'here', Url: url } ] } ) );
		let named = relay( [ '--server', 'here', '--config', config ] );
		named.Send( request( 1, 'ping' ) );
		await named.Until( 1 );
		ASSERT.equal( await named.End(), 0, named.Errors() );
		ASSERT.deepEqual( named.Lines(), [ { jsonrpc: '2.0', id: 1, result: {} } ] );
		let unknown = relay( [ '--server', 'nowhere', '--config', config ] );
		ASSERT.equal( await unknown.End(), 2 );
		ASSERT.match( unknown.Errors(), /no saved server named nowhere/ );
	}
	finally
	{
		await running.Close();
	}
	// nothing listens on this port: the request is answered with an error, a notification with a note on stderr
	let dead = relay( [ '--server', 'http://127.0.0.1:9', '--service', 'Nobody' ] );
	dead.Send( request( 1, 'ping' ) );
	dead.Send( { jsonrpc: '2.0', method: 'notifications/initialized' } );
	await dead.Until( 1 );
	ASSERT.equal( await dead.End(), 0 );
	let lines = dead.Lines();
	ASSERT.equal( lines.length, 1 );
	ASSERT.equal( lines[ 0 ].error.code, -32000 );
	ASSERT.match( lines[ 0 ].error.message, /^Consensus at http:\/\/127\.0\.0\.1:9: / );
	ASSERT.match( dead.Errors(), /Consensus at http:\/\/127\.0\.0\.1:9: / );
	ASSERT.equal( await relay( [] ).End(), 2 );
} );
