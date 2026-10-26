'use strict';

// Gate.test - whether the Server serves (plan The Server, Step 3; src/Gate.js): the current user's authority in a
// window, the Administrator's record for a headless Server, the claim of the first licensed sign-in, Public needing
// Professional, and the reasons.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const FS = require( 'fs' );
const OS = require( 'os' );
const PATH = require( 'path' );
const GATE = require( '../src/Gate.js' );
const LICENSE = require( '../src/License.js' );
const USERS = require( '../src/Users.js' );


//---------------------------------------------------------------------
// Helpers

function folder()
{
	return FS.mkdtempSync( PATH.join( OS.tmpdir(), 'consensus-gate-' ) );
}


function current( Config, Email, Plan )
{
	LICENSE.Write( Config, { Email: Email, Clerk: 'user_' + Email.split( '@' )[ 0 ], Display: Email, Plan: Plan || null, Until: null, Checked: new Date().toISOString() } );
}


// A gate over a fresh config folder: its registry with the owner, a store that keeps what it is given.
function gate_of( Mode, Scope, Settings )
{
	let config = folder();
	let users = USERS.Users( { Folder: config } );
	users.Prepare( { Owner: { Name: 'user', Display: 'User' } } );
	let written = [];
	let settings = Settings || {};
	let store = { WriteSettings: async function ( Value ) { written.push( JSON.parse( JSON.stringify( Value ) ) ); } };
	let gate = GATE.Gate( { Config: config, Settings: settings, Users: users, Store: store, Scope: Scope || 'Local', Mode: Mode } );
	return { Gate: gate, Config: config, Users: users, Settings: settings, Written: written };
}


//---------------------------------------------------------------------
// The window

TEST( 'a window\'s gate: closed with no current user; the first licensed current user opens it and is recorded as the Administrator; then only that user; Public needs Professional', async function ()
{
	let made = gate_of( 'window' );
	ASSERT.deepEqual( made.Gate.State().Open, false );
	let closed = await made.Gate.Check();
	ASSERT.deepEqual( [ closed.Open, closed.Reason ], [ false, 'the Server needs a Personal or Professional sign-in; the first one becomes its Administrator' ] );
	// a Registered current user: still closed
	current( made.Config, 'cy@example.com', null );
	ASSERT.equal( ( await made.Gate.Check() ).Open, false );
	// a Personal one: open, claimed
	current( made.Config, 'ann@example.com', 'personal' );
	let open = await made.Gate.Check();
	ASSERT.deepEqual( [ open.Open, open.Tier, open.Public, open.Administrator ], [ true, 'personal', false, 'ann@example.com' ] );
	ASSERT.equal( made.Settings.Clerk.AdminEmail, 'ann@example.com' );
	ASSERT.equal( made.Written.length, 1 );
	ASSERT.equal( made.Gate.Open(), true );
	// another current user: closed, naming the Administrator; nothing written
	current( made.Config, 'bo@example.com', 'professional' );
	let other = await made.Gate.Check();
	ASSERT.deepEqual( [ other.Open, other.Reason ], [ false, 'the Server runs under its Administrator: sign in as ann@example.com' ] );
	ASSERT.equal( made.Written.length, 1 );
	// a window's gate does not fall back on the registry
	made.Users.Update( made.Users.List()[ 0 ].Id, { Email: 'ann@example.com', Plan: 'personal' } );
	ASSERT.equal( ( await made.Gate.Check() ).Open, false );
	// Public: Professional only
	let public_gate = gate_of( 'window', 'Public' );
	current( public_gate.Config, 'ann@example.com', 'personal' );
	let refused = await public_gate.Gate.Check();
	ASSERT.deepEqual( [ refused.Open, refused.Reason ], [ false, 'a Public Server needs the Administrator\'s Professional license' ] );
	ASSERT.equal( public_gate.Written.length, 0, 'not claimed' );
	current( public_gate.Config, 'ann@example.com', 'professional' );
	let professional = await public_gate.Gate.Check();
	ASSERT.deepEqual( [ professional.Open, professional.Public, professional.Administrator ], [ true, true, 'ann@example.com' ] );
} );


//---------------------------------------------------------------------
// Headless

TEST( 'a headless gate: the Administrator\'s record and its last plan, or the owner\'s on a Local server with none named; the current user counts too; the reasons name the Administrator', async function ()
{
	// Public, nobody named: waits for the first sign-in
	let first = gate_of( 'headless', 'Public' );
	ASSERT.deepEqual( ( await first.Gate.Check() ).Reason, 'the Server waits for its first sign-in: a Professional license makes the Administrator' );
	// the Administrator named (CONSENSUS_ADMIN or an earlier sign-in): their record and its plan
	let named = gate_of( 'headless', 'Public', { Clerk: { AdminEmail: 'Gina@example.com' } } );
	ASSERT.deepEqual( ( await named.Gate.Check() ).Reason, 'the Server waits for its Administrator, Gina@example.com, to sign in with a Professional license' );
	let gina = named.Users.Create( { Type: 'user', Login: 'gina', Email: 'gina@example.com' } );
	named.Users.Update( gina.Id, { Plan: 'personal' } );
	ASSERT.deepEqual( ( await named.Gate.Check() ).Reason, 'a Public Server needs the Administrator\'s Professional license: Gina@example.com signs in with one' );
	named.Users.Update( gina.Id, { Plan: 'professional' } );
	let open = await named.Gate.Check();
	ASSERT.deepEqual( [ open.Open, open.Tier, open.Administrator ], [ true, 'professional', 'Gina@example.com' ] );
	ASSERT.equal( named.Written.length, 0, 'the Administrator was named already' );
	// Local, nobody named: the owner's record, signed in on Local, opens it and is claimed
	let local = gate_of( 'headless', 'Local' );
	ASSERT.equal( ( await local.Gate.Check() ).Reason, 'the Server waits for its first sign-in: a Personal or Professional license makes the Administrator' );
	local.Users.Update( local.Users.List()[ 0 ].Id, { Email: 'owner@example.com', Plan: 'personal' } );
	let owner = await local.Gate.Check();
	ASSERT.deepEqual( [ owner.Open, owner.Administrator, local.Settings.Clerk.AdminEmail ], [ true, 'owner@example.com', 'owner@example.com' ] );
	// a headless Server on a machine with a current user: that user counts as in a window
	let machine = gate_of( 'headless', 'Local' );
	current( machine.Config, 'ann@example.com', 'personal' );
	ASSERT.deepEqual( [ ( await machine.Gate.Check() ).Open, machine.Settings.Clerk.AdminEmail ], [ true, 'ann@example.com' ] );
} );
