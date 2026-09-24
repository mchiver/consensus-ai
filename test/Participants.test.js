'use strict';

// Identity by token and by its absence.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const PARTICIPANTS = require( '../src/Participants.js' );


TEST( 'default settings hold the user as owner and the llm called through Claude Code, with no token', function ()
{
	let settings = PARTICIPANTS.DefaultSettings( 3500 );
	ASSERT.equal( settings.Port, 3500 );
	ASSERT.equal( settings.Participants.length, 2 );
	ASSERT.deepEqual( settings.Participants[ 0 ], { Name: 'user', Display: 'User', Role: 'owner' } );
	ASSERT.equal( settings.Participants[ 1 ].Name, 'llm' );
	ASSERT.equal( settings.Participants[ 1 ].Role, 'llm' );
	ASSERT.equal( 'Token' in settings.Participants[ 1 ], false );
	ASSERT.deepEqual( settings.Participants[ 1 ].Call, { Kind: 'claude-cli', Command: 'claude' } );
	ASSERT.match( PARTICIPANTS.NewToken(), /^[0-9a-f]{48}$/ );
	ASSERT.deepEqual( PARTICIPANTS.Validate( settings ), [] );
} );


TEST( 'no header is the owner; a bearer token is its holder; anything else is nobody', function ()
{
	let settings = PARTICIPANTS.DefaultSettings( 3500 );
	let token = PARTICIPANTS.NewToken();
	settings.Participants[ 1 ].Token = token;
	ASSERT.equal( PARTICIPANTS.Identify( settings, undefined ).Name, 'user' );
	ASSERT.equal( PARTICIPANTS.Identify( settings, '' ).Name, 'user' );
	ASSERT.equal( PARTICIPANTS.Identify( settings, 'Bearer ' + token ).Name, 'llm' );
	ASSERT.equal( PARTICIPANTS.Identify( settings, 'bearer ' + token ).Name, 'llm' );
	ASSERT.equal( PARTICIPANTS.Identify( settings, 'Bearer wrong' ), null );
	ASSERT.equal( PARTICIPANTS.Identify( settings, 'Basic abc' ), null );
	ASSERT.equal( PARTICIPANTS.Identify( settings, 'Bearer ' ), null );
	ASSERT.equal( PARTICIPANTS.Identify( { Participants: [] }, undefined ), null );
} );


TEST( 'the public view drops the token', function ()
{
	let settings = PARTICIPANTS.DefaultSettings( 3500 );
	let list = PARTICIPANTS.PublicList( settings );
	ASSERT.deepEqual( list, [ { Name: 'user', Display: 'User', Role: 'owner' }, { Name: 'llm', Display: 'LLM', Role: 'llm' } ] );
	ASSERT.equal( PARTICIPANTS.Public( null ), null );
	ASSERT.deepEqual( PARTICIPANTS.Public( { Name: 'x', Role: 'member' } ), { Name: 'x', Display: 'x', Role: 'member' } );
} );


TEST( 'validation names the problems', function ()
{
	ASSERT.deepEqual( PARTICIPANTS.Validate( { Participants: [ { Name: 'a', Role: 'member' } ] } ), [ 'no participant has the owner role' ] );
	let problems = PARTICIPANTS.Validate( { Participants: [ { Name: 'a', Role: 'owner' }, { Name: 'a', Role: 'king' }, { Role: 'llm' } ] } );
	ASSERT.equal( problems.length, 3 );
	ASSERT.match( problems[ 0 ], /used twice/ );
	ASSERT.match( problems[ 1 ], /role "king"/ );
	ASSERT.match( problems[ 2 ], /no Name/ );

	let calls = PARTICIPANTS.Validate( { Participants: [
		{ Name: 'u', Role: 'owner', Call: { Kind: 'claude-cli' } },
		{ Name: 'l', Role: 'llm', Call: { Kind: 'ollama', Url: 'http://127.0.0.1:11434' } },
		{ Name: 'm', Role: 'llm', Call: { Kind: 'telepathy' } },
	] } );
	ASSERT.equal( calls.length, 4 );
	ASSERT.match( calls[ 0 ], /has a Call but is not an llm/ );
	ASSERT.match( calls[ 1 ], /needs Url and Model/ );
	ASSERT.match( calls[ 2 ], /Kind is "telepathy"/ );
	ASSERT.match( calls[ 3 ], /only one participant/ );
} );
