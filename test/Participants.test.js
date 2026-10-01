'use strict';

// Identity by token and by its absence, and the settings' checks (Host, Port, States, Participants) and Clean.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const PARTICIPANTS = require( '../src/Participants.js' );


TEST( 'default settings hold the user as owner and the llm, with no token and no call', function ()
{
	let settings = PARTICIPANTS.DefaultSettings( 3500 );
	ASSERT.equal( settings.Port, 3500 );
	ASSERT.equal( settings.Host, '127.0.0.1' );
	ASSERT.equal( PARTICIPANTS.DefaultSettings( 3500, '0.0.0.0' ).Host, '0.0.0.0' );
	ASSERT.equal( settings.Participants.length, 2 );
	ASSERT.deepEqual( settings.Participants[ 0 ], { Name: 'user', Display: 'User', Role: 'owner' } );
	ASSERT.deepEqual( settings.Participants[ 1 ], { Name: 'llm', Display: 'LLM', Role: 'llm' } );
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
	settings.Participants[ 1 ].Token = PARTICIPANTS.NewToken();
	let list = PARTICIPANTS.PublicList( settings );
	ASSERT.deepEqual( list, [ { Name: 'user', Display: 'User', Role: 'owner' }, { Name: 'llm', Display: 'LLM', Role: 'llm' } ] );
	ASSERT.equal( PARTICIPANTS.Public( null ), null );
	ASSERT.deepEqual( PARTICIPANTS.Public( { Name: 'x', Role: 'member' } ), { Name: 'x', Display: 'x', Role: 'member' } );
} );


TEST( 'validation names the problems: participants, tokens, Host and Port', function ()
{
	ASSERT.deepEqual( PARTICIPANTS.Validate( { Participants: [ { Name: 'a', Role: 'member' } ] } ), [ 'no participant has the owner role' ] );
	let problems = PARTICIPANTS.Validate( { Participants: [ { Name: 'a', Role: 'owner' }, { Name: 'a', Role: 'king' }, { Role: 'llm' } ] } );
	ASSERT.equal( problems.length, 3 );
	ASSERT.match( problems[ 0 ], /used twice/ );
	ASSERT.match( problems[ 1 ], /role "king"/ );
	ASSERT.match( problems[ 2 ], /no Name/ );

	let tokens = PARTICIPANTS.Validate( { Participants: [
		{ Name: 'u', Role: 'owner' },
		{ Name: 'l', Role: 'llm', Token: 'short' },
		{ Name: 'm', Role: 'member', Token: 'a-token-long-enough-0123' },
		{ Name: 'n', Role: 'member', Token: 'a-token-long-enough-0123' },
	] } );
	ASSERT.equal( tokens.length, 2 );
	ASSERT.match( tokens[ 0 ], /"l": a Token is a string of 16 characters or more/ );
	ASSERT.match( tokens[ 1 ], /"n" shares its Token/ );

	let settings = PARTICIPANTS.DefaultSettings( 3500 );
	ASSERT.match( PARTICIPANTS.Validate( Object.assign( {}, settings, { Port: 70000 } ) )[ 0 ], /Port must be/ );
	ASSERT.match( PARTICIPANTS.Validate( Object.assign( {}, settings, { Port: '3500' } ) )[ 0 ], /Port must be/ );
	ASSERT.match( PARTICIPANTS.Validate( Object.assign( {}, settings, { Host: '' } ) )[ 0 ], /Host must be/ );
	ASSERT.match( PARTICIPANTS.Validate( Object.assign( {}, settings, { Host: 'a b' } ) )[ 0 ], /Host must be/ );
	ASSERT.deepEqual( PARTICIPANTS.Validate( Object.assign( {}, settings, { Host: '0.0.0.0', Port: 0 } ) ), [] );
	ASSERT.deepEqual( PARTICIPANTS.Validate( { Participants: 'nobody' } ), [ 'Participants must be a list', 'no participant has the owner role' ] );
	ASSERT.deepEqual( PARTICIPANTS.Validate( null ), [ 'the settings are not an object' ] );
} );


TEST( 'States: the settings\' list, or the defaults; a bad list is named', function ()
{
	let settings = PARTICIPANTS.DefaultSettings( 3500 );
	ASSERT.deepEqual( settings.States, [ 'Proposal', 'Plan', 'Working', 'Finished' ] );
	ASSERT.deepEqual( PARTICIPANTS.States( settings ), [ 'Proposal', 'Plan', 'Working', 'Finished' ] );
	ASSERT.deepEqual( PARTICIPANTS.States( { States: [ 'Draft', 'Done' ] } ), [ 'Draft', 'Done' ] );
	ASSERT.deepEqual( PARTICIPANTS.States( {} ), PARTICIPANTS.DEFAULT_STATES );
	function problems( states )
	{
		return PARTICIPANTS.Validate( Object.assign( {}, settings, { States: states } ) );
	}
	ASSERT.deepEqual( problems( [ 'Draft', 'Done' ] ), [] );
	ASSERT.match( problems( [] )[ 0 ], /States must be a list/ );
	ASSERT.match( problems( 'Plan' )[ 0 ], /States must be a list/ );
	ASSERT.match( problems( [ 'Plan', '' ] )[ 0 ], /States must be a list/ );
	ASSERT.match( problems( [ ' Plan' ] )[ 0 ], /States must be a list/ );
	ASSERT.match( problems( [ 'Plan', 'Plan' ] )[ 0 ], /twice/ );
} );


TEST( 'Clean keeps the known fields only, trims, and drops empty tokens and displays', function ()
{
	let clean = PARTICIPANTS.Clean( {
		Port: 3501,
		Host: ' cube4 ',
		States: [ ' Draft ', 'Done' ],
		Participants: [ { Name: ' user ', Display: '', Role: 'owner', Token: '  ', Call: { Kind: 'x' } }, { Name: 'llm', Display: 'LLM', Role: 'llm', Token: ' tok-0123456789abcdef ' } ],
		Workers: [ { Name: 'gone' } ],
		Corpus: {},
	} );
	ASSERT.deepEqual( clean, {
		Port: 3501,
		Host: 'cube4',
		States: [ 'Draft', 'Done' ],
		Participants: [ { Name: 'user', Role: 'owner' }, { Name: 'llm', Display: 'LLM', Role: 'llm', Token: 'tok-0123456789abcdef' } ],
	} );
	ASSERT.deepEqual( PARTICIPANTS.Validate( clean ), [] );
	ASSERT.deepEqual( PARTICIPANTS.Clean( null ), {} );
} );
