'use strict';

// Mcp - the Model Context Protocol over the interface definition (plan MCP Server, Step 2), with no transport in it
// and no library: JSON-RPC 2.0 messages in, replies out, every operation of Operations.js a tool. The methods we
// serve: initialize, notifications/initialized, ping, tools/list and tools/call; anything else is -32601. A tool call
// is the operation performed as the participant the transport identified, after the transport's Authorize has checked
// its action against the participant's role, and its answer is the operation's JSON as text (an Answer's body as it
// is); a Refusal is an error result (isError) with the sentence; a batch (an array) is answered as an array.
// Project is a project's id or its name wherever an operation takes one.
//
//   Mcp( { Operations, Store?, Authorize? } ) -> { Tools(), Handle( Message, Participant ) }
//     Operations  Operations.Operations( Context ), or anything with List, Get( Name ) and Perform( Name, Participant, Arguments )
//     Store       the store, for a project named rather than identified (ListProjects); without it a name is passed on
//     Authorize   async ( Participant, Operation, Arguments ): throws a Refusal when the participant may not; none
//                 when the transport has nothing to check
//     Tools()                        the definition in MCP's form: [ { name, description, inputSchema } ]
//     Handle( Message, Participant ) the reply to one message (null for a notification), or an array for a batch
//   PROTOCOL_VERSION, PROTOCOL_VERSIONS   the version answered, and those answered as the client asks

const OPERATIONS = require( './Operations.js' );
const VERSION = require( '../package.json' ).version;

const PROTOCOL_VERSIONS = [ '2025-06-18', '2025-03-26', '2024-11-05' ];
const PROTOCOL_VERSION = PROTOCOL_VERSIONS[ 0 ];
const TYPES = { string: 'string', integer: 'integer', boolean: 'boolean', object: 'object', array: 'array' };
const SERVER_NAME = 'Consensus';

const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;


function Mcp( Context )
{
	let operations = Context.Operations;
	let store = Context.Store || null;
	let authorize = Context.Authorize || null;


	//-----------------------------------------------------------------
	// The tools: the definition in MCP's form.

	function Tools()
	{
		return operations.List.map( tool_of );
	}


	function tool_of( operation )
	{
		let properties = {};
		let required = [];
		for ( let field of Object.keys( operation.Parameters || {} ) )
		{
			let parameter = operation.Parameters[ field ];
			let property = { type: TYPES[ parameter.Type ] || 'string' };
			if ( parameter.Type === 'array' )
			{
				property.items = { type: 'string' };
			}
			let description = parameter.Description || '';
			if ( field === 'Project' )
			{
				description = ( description ? description + '; ' : '' ) + 'an id or a name';
			}
			if ( description )
			{
				property.description = description;
			}
			properties[ field ] = property;
			if ( parameter.Required )
			{
				required.push( field );
			}
		}
		let schema = { type: 'object', properties: properties };
		if ( required.length )
		{
			schema.required = required;
		}
		return { name: operation.Name, description: operation.Description, inputSchema: schema };
	}


	//-----------------------------------------------------------------
	// The messages

	async function Handle( Message, Participant )
	{
		if ( Array.isArray( Message ) )
		{
			if ( !Message.length )
			{
				return error_reply( null, INVALID_REQUEST, 'an empty batch' );
			}
			let replies = [];
			for ( let one of Message )
			{
				let reply = await handle_one( one, Participant );
				if ( reply )
				{
					replies.push( reply );
				}
			}
			return replies;
		}
		return await handle_one( Message, Participant );
	}


	async function handle_one( message, participant )
	{
		if ( !message || typeof message !== 'object' || Array.isArray( message ) || message.jsonrpc !== '2.0' || typeof message.method !== 'string' )
		{
			return error_reply( id_of( message ), INVALID_REQUEST, 'not a JSON-RPC 2.0 request' );
		}
		let notification = ( message.id === undefined );
		let reply = null;
		try
		{
			reply = await answer( message, participant );
		}
		catch ( error )
		{
			return notification ? null : error_reply( message.id, INTERNAL_ERROR, 'internal error: ' + error.message );
		}
		if ( notification )
		{
			return null;
		}
		if ( reply && reply.ErrorCode )
		{
			return error_reply( message.id, reply.ErrorCode, reply.Message );
		}
		return { jsonrpc: '2.0', id: message.id, result: reply };
	}


	async function answer( message, participant )
	{
		let params = ( message.params && typeof message.params === 'object' && !Array.isArray( message.params ) ) ? message.params : {};
		switch ( message.method )
		{
			case 'initialize':
				return {
					protocolVersion: PROTOCOL_VERSIONS.includes( params.protocolVersion ) ? params.protocolVersion : PROTOCOL_VERSION,
					capabilities: { tools: {} },
					serverInfo: { name: SERVER_NAME, version: VERSION },
				};
			case 'notifications/initialized':
				return null;
			case 'ping':
				return {};
			case 'tools/list':
				return { tools: Tools() };
			case 'tools/call':
				return await call( params, participant );
			default:
				return { ErrorCode: METHOD_NOT_FOUND, Message: 'unknown method: ' + message.method };
		}
	}


	// A tool call: the operation as the participant, its answer as text; a refusal an error result.
	async function call( params, participant )
	{
		let name = ( typeof params.name === 'string' ) ? params.name : '';
		let operation = operations.Get( name );
		if ( !operation )
		{
			return { ErrorCode: INVALID_PARAMS, Message: 'unknown tool: ' + ( name || '(none)' ) };
		}
		let given = params.arguments;
		let args = ( given && typeof given === 'object' && !Array.isArray( given ) ) ? Object.assign( {}, given ) : {};
		try
		{
			if ( args.Project !== undefined && operation.Parameters && operation.Parameters.Project )
			{
				args.Project = await project_id( args.Project );
			}
			if ( authorize )
			{
				await authorize( participant, operation, args );
			}
			let result = await operations.Perform( name, participant, args );
			return { content: [ { type: 'text', text: text_of( result ) } ] };
		}
		catch ( error )
		{
			if ( OPERATIONS.IsRefusal( error ) )
			{
				return { content: [ { type: 'text', text: refusal_text( error ) } ], isError: true };
			}
			throw error;
		}
	}


	function text_of( result )
	{
		if ( OPERATIONS.IsAnswer( result ) )
		{
			return ( typeof result.Body === 'string' ) ? result.Body : JSON.stringify( result.Body, null, 1 );
		}
		return JSON.stringify( ( result === undefined ) ? null : result, null, 1 );
	}


	function refusal_text( error )
	{
		let text = String( error.Error || error.message || 'refused' );
		if ( error.Extra && Object.keys( error.Extra ).length )
		{
			text += ' ' + JSON.stringify( error.Extra );
		}
		return text;
	}


	// A project given by its name becomes its id; an id, or a name no project has, is passed on as it is.
	async function project_id( given )
	{
		let value = String( given ).trim();
		if ( !store || !value )
		{
			return value;
		}
		let projects = await store.ListProjects();
		let found = projects.find( function ( project ) { return project.Id === value; } ) || projects.find( function ( project ) { return project.Name === value; } );
		return found ? found.Id : value;
	}


	function error_reply( id, code, message )
	{
		return { jsonrpc: '2.0', id: ( id === undefined ) ? null : id, error: { code: code, message: message } };
	}


	function id_of( message )
	{
		return ( message && typeof message === 'object' && !Array.isArray( message ) && message.id !== undefined ) ? message.id : null;
	}


	return {
		Tools: Tools,
		Handle: Handle,
	};
}


module.exports = {
	Mcp: Mcp,
	PROTOCOL_VERSION: PROTOCOL_VERSION,
	PROTOCOL_VERSIONS: PROTOCOL_VERSIONS,
};
