'use strict';

// Identity (plan User Management, Step 2): every request is the owner account, saying who it is with the service
// header, or a run on its run token; the speakers the rules run over; the settings' checks (Name, Scope, Port,
// States, Owner, the Clerk section), Migrate, Clean, HasClerk and Trust.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const PARTICIPANTS = require( '../src/Participants.js' );


TEST( 'default settings hold the owner, "user" shown as "User", and no participants list', function ()
{
	let settings = PARTICIPANTS.DefaultSettings( 3500 );
	ASSERT.equal( settings.Port, 3500 );
	ASSERT.equal( settings.Scope, 'Local' );
	ASSERT.equal( settings.Name, require( 'os' ).hostname() );
	ASSERT.equal( PARTICIPANTS.DefaultSettings( 3500, 'Public' ).Scope, 'Public' );
	ASSERT.equal( PARTICIPANTS.DefaultSettings( 3500, '0.0.0.0' ).Scope, 'Local' );
	ASSERT.deepEqual( settings.Owner, { Name: 'user', Display: 'User' } );
	ASSERT.equal( 'Participants' in settings, false );
	ASSERT.match( PARTICIPANTS.NewToken(), /^[0-9a-f]{48}$/ );
	ASSERT.deepEqual( PARTICIPANTS.Validate( settings ), [] );
	ASSERT.deepEqual( PARTICIPANTS.Owner( settings ), { Name: 'user', Display: 'User' } );
	ASSERT.deepEqual( PARTICIPANTS.Owner( {} ), { Name: 'user', Display: 'User' } );
	ASSERT.deepEqual( PARTICIPANTS.Owner( { Owner: { Name: 'andre' } } ), { Name: 'andre', Display: 'andre' } );
	ASSERT.deepEqual( PARTICIPANTS.Owner( { Owner: { Name: ' andre ', Display: ' Andre ' } } ), { Name: 'andre', Display: 'Andre' } );
} );


TEST( 'every request is the owner: no header is the owner plain, the service header names the service, a run token names the run, anything else is nobody', function ()
{
	let settings = PARTICIPANTS.DefaultSettings( 3500 );
	let tokens = PARTICIPANTS.RunTokens();
	let plain = PARTICIPANTS.Identify( settings, {}, tokens );
	ASSERT.deepEqual( plain, { Name: 'user', Display: 'User', Role: 'owner', Service: null, Token: null, Speaker: 'user' } );
	ASSERT.deepEqual( PARTICIPANTS.Identify( settings, { Authorization: '' }, tokens ).Speaker, 'user' );
	ASSERT.deepEqual( PARTICIPANTS.Identify( settings, undefined, null ).Speaker, 'user' );
	let agent = PARTICIPANTS.Identify( settings, { Service: ' Claude-CLI ' }, tokens );
	ASSERT.deepEqual( agent, { Name: 'user', Display: 'User', Role: 'owner', Service: 'Claude-CLI', Token: null, Speaker: 'Claude-CLI by user' } );
	// a bad service name is ignored
	ASSERT.equal( PARTICIPANTS.Identify( settings, { Service: 'not a name' }, tokens ).Service, null );
	ASSERT.equal( PARTICIPANTS.Identify( settings, { Service: 'x'.repeat( 41 ) }, tokens ).Service, null );
	ASSERT.equal( PARTICIPANTS.ServiceOf( 'ollama-kimi:cloud' ), 'ollama-kimi:cloud' );
	ASSERT.equal( PARTICIPANTS.ServiceOf( '' ), null );
	// a run token: the owner through the connection, the token's name as Token; the header is not read for a run
	let value = tokens.Mint( { Service: 'claude-cli', Name: 'Review run', Project: 'prj-1' } );
	ASSERT.match( value, /^[0-9a-f]{48}$/ );
	let run = PARTICIPANTS.Identify( settings, { Authorization: 'Bearer ' + value, Service: 'other' }, tokens );
	ASSERT.deepEqual( run, { Name: 'user', Display: 'User', Role: 'owner', Service: 'claude-cli', Token: 'Review run', Speaker: 'claude-cli by user' } );
	ASSERT.equal( PARTICIPANTS.Identify( settings, { Authorization: 'bearer ' + value }, tokens ).Token, 'Review run' );
	ASSERT.equal( tokens.Count(), 1 );
	tokens.Drop( value );
	ASSERT.equal( tokens.Count(), 0 );
	ASSERT.equal( PARTICIPANTS.Identify( settings, { Authorization: 'Bearer ' + value }, tokens ), null );
	ASSERT.equal( PARTICIPANTS.Identify( settings, { Authorization: 'Bearer wrong' }, tokens ), null );
	ASSERT.equal( PARTICIPANTS.Identify( settings, { Authorization: 'Bearer wrong' }, null ), null );
	ASSERT.equal( PARTICIPANTS.Identify( settings, { Authorization: 'Basic abc' }, tokens ), null );
	ASSERT.equal( PARTICIPANTS.Identify( settings, { Authorization: 'Bearer ' }, tokens ), null );
	// the public view: the empty fields left out
	ASSERT.deepEqual( PARTICIPANTS.Public( plain ), { Name: 'user', Display: 'User', Role: 'owner', Speaker: 'user' } );
	ASSERT.deepEqual( PARTICIPANTS.Public( agent ), { Name: 'user', Display: 'User', Role: 'owner', Speaker: 'Claude-CLI by user', Service: 'Claude-CLI' } );
	ASSERT.equal( PARTICIPANTS.Public( null ), null );
} );


TEST( 'the speaker is the byline: the key, the display, the owner and the connections, and everyone seen in the threads', function ()
{
	let settings = { Name: 'cube4', Owner: { Name: 'user', Display: 'Andre' }, Llms: [ { Id: 'llm-1', Name: 'Claude-CLI' }, { Id: 'llm-2', Name: 'ollama-kimi' } ] };
	ASSERT.equal( PARTICIPANTS.Speaker( 'user', null ), 'user' );
	ASSERT.equal( PARTICIPANTS.Speaker( 'user', 'Claude-CLI' ), 'Claude-CLI by user' );
	ASSERT.equal( PARTICIPANTS.SpeakerOf( { By: 'user', Service: 'Claude-CLI', Token: 'Review run' } ), 'Claude-CLI by user' );
	ASSERT.equal( PARTICIPANTS.SpeakerOf( { By: 'llm' } ), 'llm' );
	ASSERT.equal( PARTICIPANTS.SpeakerOf( null ), null );
	ASSERT.equal( PARTICIPANTS.Byline( settings, { By: 'user', Service: 'Claude-CLI' } ), 'Claude-CLI by Andre' );
	ASSERT.equal( PARTICIPANTS.Byline( settings, { By: 'user' } ), 'Andre' );
	ASSERT.equal( PARTICIPANTS.Byline( settings, { By: 'llm' } ), 'llm' );
	ASSERT.equal( PARTICIPANTS.Byline( settings, { By: 'Claude-CLI@Cube12' } ), 'Claude-CLI@Cube12' );
	ASSERT.deepEqual( PARTICIPANTS.Speakers( settings ), [
		{ Name: 'user', Display: 'Andre', Role: 'owner' },
		{ Name: 'Claude-CLI by user', Display: 'Claude-CLI by Andre', Role: 'llm', Llm: 'llm-1' },
		{ Name: 'ollama-kimi by user', Display: 'ollama-kimi by Andre', Role: 'llm', Llm: 'llm-2' },
	] );
	let threads = [
		{ Replies: [ { By: 'user', Text: 'a' }, { By: 'llm', Text: 'b' }, { By: 'user', Service: 'Claude-CLI', Text: 'c' } ], Resolved: { By: 'user' }, Applied: { By: 'user', Service: 'Codex' } },
		{ Replies: [ { By: 'Claude-CLI@Cube12', Text: 'd' } ], Resolved: null, Applied: null },
	];
	ASSERT.deepEqual( PARTICIPANTS.SeenSpeakers( settings, threads ).map( function ( one ) { return one.Name + ' = ' + one.Display + ' (' + one.Role + ')'; } ), [
		'user = Andre (owner)',
		'Claude-CLI by user = Claude-CLI by Andre (llm)',
		'ollama-kimi by user = ollama-kimi by Andre (llm)',
		'llm = llm (llm)',
		'Codex by user = Codex by Andre (llm)',
		'Claude-CLI@Cube12 = Claude-CLI@Cube12 (llm)',
	] );
	ASSERT.equal( PARTICIPANTS.SeenSpeakers( settings, [] ).length, 3 );
	ASSERT.equal( PARTICIPANTS.SeenSpeakers( { Owner: { Name: 'user' } }, null ).length, 1 );
} );


TEST( 'validation names the problems: Owner, Name, Scope and Port', function ()
{
	let settings = PARTICIPANTS.DefaultSettings( 3500 );
	ASSERT.match( PARTICIPANTS.Validate( Object.assign( {}, settings, { Port: 70000 } ) )[ 0 ], /Port must be/ );
	ASSERT.match( PARTICIPANTS.Validate( Object.assign( {}, settings, { Port: '3500' } ) )[ 0 ], /Port must be/ );
	ASSERT.match( PARTICIPANTS.Validate( Object.assign( {}, settings, { Scope: '' } ) )[ 0 ], /Scope must be one of None, Local, Public/ );
	ASSERT.match( PARTICIPANTS.Validate( Object.assign( {}, settings, { Scope: 'local' } ) )[ 0 ], /Scope must be/ );
	ASSERT.match( PARTICIPANTS.Validate( Object.assign( {}, settings, { Name: ' ' } ) )[ 0 ], /Name must be a name/ );
	ASSERT.deepEqual( PARTICIPANTS.Validate( Object.assign( {}, settings, { Scope: 'Public', Port: 0 } ) ), [] );
	ASSERT.deepEqual( PARTICIPANTS.Validate( Object.assign( {}, settings, { Owner: 'me' } ) ), [ 'Owner must be an object with a Name and a Display' ] );
	ASSERT.deepEqual( PARTICIPANTS.Validate( Object.assign( {}, settings, { Owner: { Display: 'Me' } } ) ), [ 'Owner must have a Name' ] );
	ASSERT.deepEqual( PARTICIPANTS.Validate( Object.assign( {}, settings, { Owner: { Name: 'me', Display: 7 } } ) ), [ 'Owner Display must be text' ] );
	ASSERT.deepEqual( PARTICIPANTS.Validate( Object.assign( {}, settings, { Owner: { Name: 'me' } } ) ), [] );
	ASSERT.deepEqual( PARTICIPANTS.Validate( { Name: 'x' } ), [] );
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


TEST( 'a settings file from before: Host becomes Scope, a missing Scope is Local, a missing Name is the machine\'s, the participants become the Owner, the connections lose their tokens', function ()
{
	let local = { Host: '127.0.0.1', Port: 3500, Participants: [ { Name: 'user', Role: 'owner' } ] };
	ASSERT.deepEqual( PARTICIPANTS.Migrate( local ), [ 'Host "127.0.0.1" became Scope Local', 'Name set to ' + require( 'os' ).hostname(), 'Participants became Owner "user"' ] );
	ASSERT.deepEqual( [ local.Scope, 'Host' in local, local.Name, local.Owner, 'Participants' in local ], [ 'Local', false, require( 'os' ).hostname(), { Name: 'user', Display: 'User' }, false ] );
	let everywhere = { Host: '0.0.0.0', Name: 'cube4', Owner: { Name: 'user', Display: 'User' } };
	ASSERT.deepEqual( PARTICIPANTS.Migrate( everywhere ), [ 'Host "0.0.0.0" became Scope Public' ] );
	ASSERT.equal( everywhere.Scope, 'Public' );
	ASSERT.equal( PARTICIPANTS.Migrate( { Host: 'localhost', Name: 'x', Owner: { Name: 'u' } } )[ 0 ], 'Host "localhost" became Scope Local' );
	let bare = { Name: 'x' };
	ASSERT.deepEqual( PARTICIPANTS.Migrate( bare ), [ 'Scope set to Local', 'Owner set to "user"' ] );
	ASSERT.deepEqual( bare.Owner, { Name: 'user', Display: 'User' } );
	ASSERT.deepEqual( PARTICIPANTS.Migrate( bare ), [] );
	ASSERT.deepEqual( PARTICIPANTS.Migrate( { Name: 'x', Scope: 'Public', Owner: { Name: 'u' } } ), [] );
	ASSERT.deepEqual( PARTICIPANTS.Migrate( { Name: 'x', Scope: 'public', Owner: { Name: 'u' } } ), [ 'Scope set to Local' ] );
	// the full list of before: the owner's name and display kept, the llm and the members dropped, the tokens gone
	let full = { Name: 'cube4', Scope: 'Local', Participants: [ { Name: 'andre', Display: 'Andre', Role: 'owner', Token: 'x' }, { Name: 'llm', Display: 'LLM', Role: 'llm', Token: 'the-llm-token-0123456789' }, { Name: 'ann', Role: 'member', Token: 'a-token-long-enough-0123' } ], Llms: [ { Id: 'llm-1', Name: 'claude-cli', Token: 'tok-0123456789abcdef' }, { Id: 'llm-2', Name: 'o' } ] };
	ASSERT.deepEqual( PARTICIPANTS.Migrate( full ), [
		'Participants became Owner "andre"; llm, ann dropped (an LLM is never a user; members come through Clerk)',
		'the Token of the LLM connection claude-cli dropped: the server makes one per run',
	] );
	ASSERT.deepEqual( full.Owner, { Name: 'andre', Display: 'Andre' } );
	ASSERT.equal( 'Participants' in full, false );
	ASSERT.equal( 'Token' in full.Llms[ 0 ], false );
	ASSERT.deepEqual( PARTICIPANTS.Migrate( full ), [] );
	// an Owner already there is kept over the participants' owner
	let both = { Name: 'x', Scope: 'Local', Owner: { Name: 'kept' }, Participants: [ { Name: 'user', Role: 'owner' } ] };
	ASSERT.deepEqual( PARTICIPANTS.Migrate( both ), [ 'Participants became Owner "kept"' ] );
	ASSERT.deepEqual( [ PARTICIPANTS.HostOf( 'None' ), PARTICIPANTS.HostOf( 'Local' ), PARTICIPANTS.HostOf( 'Public' ), PARTICIPANTS.HostOf( 'x' ) ], [ null, '127.0.0.1', '0.0.0.0', '127.0.0.1' ] );
	ASSERT.deepEqual( [ PARTICIPANTS.Scope( {} ), PARTICIPANTS.Scope( { Scope: 'None' } ), PARTICIPANTS.Scope( null ) ], [ 'Local', 'None', 'Local' ] );
} );


TEST( 'Clean keeps the known fields only, trims, and keeps the Owner to its Name and Display', function ()
{
	let clean = PARTICIPANTS.Clean( {
		Port: 3501,
		Name: ' cube4 ',
		Scope: ' Public ',
		States: [ ' Draft ', 'Done' ],
		Owner: { Name: ' user ', Display: ' ', Role: 'owner', Token: 'x' },
		Participants: [ { Name: 'llm', Role: 'llm' } ],
		Workers: [ { Name: 'gone' } ],
		Corpus: {},
	} );
	ASSERT.deepEqual( clean, {
		Port: 3501,
		Name: 'cube4',
		Scope: 'Public',
		States: [ 'Draft', 'Done' ],
		Owner: { Name: 'user' },
	} );
	ASSERT.deepEqual( PARTICIPANTS.Validate( clean ), [] );
	ASSERT.deepEqual( PARTICIPANTS.Clean( { Owner: { Name: 'andre', Display: ' Andre ' } } ).Owner, { Name: 'andre', Display: 'Andre' } );
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
