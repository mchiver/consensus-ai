'use strict';

// Identity by token and by its absence, and the settings' checks (Name, Scope, Port, States, Participants, the Clerk
// section), Migrate, Clean, HasClerk and Trust.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const PARTICIPANTS = require( '../src/Participants.js' );


TEST( 'default settings hold the user as owner and the llm, with no token and no call', function ()
{
	let settings = PARTICIPANTS.DefaultSettings( 3500 );
	ASSERT.equal( settings.Port, 3500 );
	ASSERT.equal( settings.Scope, 'Local' );
	ASSERT.equal( settings.Name, require( 'os' ).hostname() );
	ASSERT.equal( PARTICIPANTS.DefaultSettings( 3500, 'Public' ).Scope, 'Public' );
	ASSERT.equal( PARTICIPANTS.DefaultSettings( 3500, '0.0.0.0' ).Scope, 'Local' );
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


TEST( 'validation names the problems: participants, tokens, Name, Scope and Port', function ()
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
	ASSERT.match( PARTICIPANTS.Validate( Object.assign( {}, settings, { Scope: '' } ) )[ 0 ], /Scope must be one of None, Local, Public/ );
	ASSERT.match( PARTICIPANTS.Validate( Object.assign( {}, settings, { Scope: 'local' } ) )[ 0 ], /Scope must be/ );
	ASSERT.match( PARTICIPANTS.Validate( Object.assign( {}, settings, { Name: ' ' } ) )[ 0 ], /Name must be a name/ );
	ASSERT.deepEqual( PARTICIPANTS.Validate( Object.assign( {}, settings, { Scope: 'Public', Port: 0 } ) ), [] );
	ASSERT.deepEqual( PARTICIPANTS.Validate( { Participants: settings.Participants } ), [] );
	ASSERT.deepEqual( PARTICIPANTS.Validate( { Participants: 'nobody' } ), [ 'Participants must be a list', 'no participant has the owner role' ] );
	ASSERT.deepEqual( PARTICIPANTS.Validate( null ), [ 'the settings are not an object' ] );
} );


TEST( 'States: the settings\' list, or the defaults; a bad list is named', function ()
{
	let settings = PARTICIPANTS.DefaultSettings( 3500 );
	ASSERT.deepEqual( settings.States, [ 'Draft', 'Plan', 'Working', 'Finished' ] );
	ASSERT.deepEqual( PARTICIPANTS.States( settings ), [ 'Draft', 'Plan', 'Working', 'Finished' ] );
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


TEST( 'a settings file from before: Host becomes Scope, a missing Scope is Local, a missing Name is the machine\'s', function ()
{
	let local = { Host: '127.0.0.1', Port: 3500, Participants: [ { Name: 'user', Role: 'owner' } ] };
	ASSERT.deepEqual( PARTICIPANTS.Migrate( local ), [ 'Host "127.0.0.1" became Scope Local', 'Name set to ' + require( 'os' ).hostname() ] );
	ASSERT.deepEqual( [ local.Scope, 'Host' in local, local.Name ], [ 'Local', false, require( 'os' ).hostname() ] );
	let everywhere = { Host: '0.0.0.0', Name: 'cube4' };
	ASSERT.deepEqual( PARTICIPANTS.Migrate( everywhere ), [ 'Host "0.0.0.0" became Scope Public' ] );
	ASSERT.equal( everywhere.Scope, 'Public' );
	ASSERT.equal( PARTICIPANTS.Migrate( { Host: 'localhost', Name: 'x' } )[ 0 ], 'Host "localhost" became Scope Local' );
	let bare = { Name: 'x' };
	ASSERT.deepEqual( PARTICIPANTS.Migrate( bare ), [ 'Scope set to Local' ] );
	ASSERT.deepEqual( PARTICIPANTS.Migrate( bare ), [] );
	ASSERT.deepEqual( PARTICIPANTS.Migrate( { Name: 'x', Scope: 'Public' } ), [] );
	ASSERT.deepEqual( PARTICIPANTS.Migrate( { Name: 'x', Scope: 'public' } ), [ 'Scope set to Local' ] );
	ASSERT.deepEqual( [ PARTICIPANTS.HostOf( 'None' ), PARTICIPANTS.HostOf( 'Local' ), PARTICIPANTS.HostOf( 'Public' ), PARTICIPANTS.HostOf( 'x' ) ], [ null, '127.0.0.1', '0.0.0.0', '127.0.0.1' ] );
	ASSERT.deepEqual( [ PARTICIPANTS.Scope( {} ), PARTICIPANTS.Scope( { Scope: 'None' } ), PARTICIPANTS.Scope( null ) ], [ 'Local', 'None', 'Local' ] );
} );


TEST( 'Clean keeps the known fields only, trims, and drops empty tokens and displays', function ()
{
	let clean = PARTICIPANTS.Clean( {
		Port: 3501,
		Name: ' cube4 ',
		Scope: ' Public ',
		States: [ ' Draft ', 'Done' ],
		Participants: [ { Name: ' user ', Display: '', Role: 'owner', Token: '  ', Call: { Kind: 'x' } }, { Name: 'llm', Display: 'LLM', Role: 'llm', Token: ' tok-0123456789abcdef ' } ],
		Workers: [ { Name: 'gone' } ],
		Corpus: {},
	} );
	ASSERT.deepEqual( clean, {
		Port: 3501,
		Name: 'cube4',
		Scope: 'Public',
		States: [ 'Draft', 'Done' ],
		Participants: [ { Name: 'user', Role: 'owner' }, { Name: 'llm', Display: 'LLM', Role: 'llm', Token: 'tok-0123456789abcdef' } ],
	} );
	ASSERT.deepEqual( PARTICIPANTS.Validate( clean ), [] );
	ASSERT.deepEqual( PARTICIPANTS.Clean( null ), {} );
} );


TEST( 'the Clerk section (plan User Management, Step 1): checked, cleaned, dropped when empty; HasClerk and Trust', function ()
{
	let settings = PARTICIPANTS.DefaultSettings( 3500, 'Public' );
	ASSERT.deepEqual( PARTICIPANTS.Validate( Object.assign( {}, settings, { Clerk: { PublishableKey: 'pk_test_1', SecretKey: 'sk_test_1', WebhookSecret: 'whsec_1', AdminEmail: 'andre@example.com' } } ) ), [] );
	ASSERT.deepEqual( PARTICIPANTS.Validate( Object.assign( {}, settings, { Clerk: {} } ) ), [] );
	ASSERT.deepEqual( PARTICIPANTS.Validate( Object.assign( {}, settings, { Clerk: null } ) ), [] );
	ASSERT.deepEqual( PARTICIPANTS.Validate( Object.assign( {}, settings, { Clerk: 'keys' } ) ), [ 'Clerk must be an object with PublishableKey, SecretKey, WebhookSecret, AdminEmail as text' ] );
	let problems = PARTICIPANTS.Validate( Object.assign( {}, settings, { Clerk: { PublishableKey: 'sk_x', SecretKey: 7, WebhookSecret: 'nope', AdminEmail: 'andre' } } ) );
	ASSERT.deepEqual( problems, [ 'Clerk PublishableKey starts with pk_', 'Clerk SecretKey must be text', 'Clerk WebhookSecret starts with whsec_', 'Clerk AdminEmail must be an email address' ] );
	// Clean: the four texts trimmed, the rest dropped; all empty or null, the section goes; a wrong shape is left for Validate
	let clean = PARTICIPANTS.Clean( Object.assign( {}, settings, { Clerk: { PublishableKey: ' pk_a ', SecretKey: '', WebhookSecret: null, AdminEmail: 'a@b.co', Extra: 1 } } ) );
	ASSERT.deepEqual( clean.Clerk, { PublishableKey: 'pk_a', AdminEmail: 'a@b.co' } );
	ASSERT.equal( 'Clerk' in PARTICIPANTS.Clean( Object.assign( {}, settings, { Clerk: { PublishableKey: ' ', SecretKey: '' } } ) ), false );
	ASSERT.equal( 'Clerk' in PARTICIPANTS.Clean( Object.assign( {}, settings, { Clerk: null } ) ), false );
	ASSERT.equal( 'Clerk' in PARTICIPANTS.Clean( settings ), false );
	ASSERT.equal( PARTICIPANTS.Clean( Object.assign( {}, settings, { Clerk: 'keys' } ) ).Clerk, 'keys' );
	// HasClerk and Trust
	ASSERT.equal( PARTICIPANTS.HasClerk( settings ), false );
	ASSERT.equal( PARTICIPANTS.HasClerk( { Clerk: { PublishableKey: 'pk_a' } } ), false );
	ASSERT.equal( PARTICIPANTS.HasClerk( { Clerk: { PublishableKey: 'pk_a', SecretKey: 'sk_a' } } ), true );
	ASSERT.equal( PARTICIPANTS.Trust( settings ), 'trusted' );
	ASSERT.equal( PARTICIPANTS.Trust( Object.assign( {}, settings, { Clerk: { PublishableKey: 'pk_a', SecretKey: 'sk_a' } } ) ), 'clerk' );
	ASSERT.equal( PARTICIPANTS.Trust( PARTICIPANTS.DefaultSettings( 3500 ) ), 'local' );
	ASSERT.equal( PARTICIPANTS.Trust( PARTICIPANTS.DefaultSettings( 3500, 'None' ) ), 'none' );
	ASSERT.equal( PARTICIPANTS.Trust( { Scope: 'Local', Clerk: { PublishableKey: 'pk_a', SecretKey: 'sk_a' } } ), 'local' );
} );
