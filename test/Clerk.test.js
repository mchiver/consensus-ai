'use strict';

// Clerk (plan User Management, Step 4; plan Clerk, Steps 2 and 4) over a generated RSA key pair standing in for the
// instance: a session token verified with its claims, the refusals (expired, another key, another issuer, another
// azp, no such key id, a wrong algorithm), the keys read again for an unknown key id; the subject matched to a
// record or fetched once and written; the login made from an email; the webhook signature good, bad and stale; and
// the registry writes each webhook event causes. Plan Clerk, Step 5: the built-in key, the person and the license
// from the claims, a Local session the owner's.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const FS = require( 'fs' );
const OS = require( 'os' );
const PATH = require( 'path' );
const CRYPTO = require( 'crypto' );
const CLERK = require( '../src/Clerk.js' );
const USERS = require( '../src/Users.js' );

const PAIR = CRYPTO.generateKeyPairSync( 'rsa', { modulusLength: 2048 } );
const OTHER = CRYPTO.generateKeyPairSync( 'rsa', { modulusLength: 2048 } );
const JWK = Object.assign( PAIR.publicKey.export( { format: 'jwk' } ), { kid: 'key-1', use: 'sig', alg: 'RS256' } );
const JWK_OTHER = Object.assign( OTHER.publicKey.export( { format: 'jwk' } ), { kid: 'key-2', use: 'sig', alg: 'RS256' } );
const HOST = 'clerk.example.test';
const WEBHOOK_KEY = 'a-webhook-secret-of-some-length';
const SECTION = { PublishableKey: 'pk_test_' + Buffer.from( HOST + '$' ).toString( 'base64' ), SecretKey: 'sk_test_secret', WebhookSecret: 'whsec_' + Buffer.from( WEBHOOK_KEY ).toString( 'base64' ), AdminEmail: 'ann@example.com' };


function base64url( value )
{
	return Buffer.from( value ).toString( 'base64' ).replace( /=+$/, '' ).replace( /\+/g, '-' ).replace( /\//g, '_' );
}


// A token signed by the pair (or Key), its claims over the defaults; Header replaces the header.
function sign( Claims, Key, Header )
{
	let seconds = Math.floor( Date.now() / 1000 );
	let payload = Object.assign( { iss: 'https://' + HOST, sub: 'user_1', exp: seconds + 60, nbf: seconds - 5, iat: seconds - 5 }, Claims || {} );
	let header = Header || { alg: 'RS256', kid: 'key-1', typ: 'JWT' };
	let input = base64url( JSON.stringify( header ) ) + '.' + base64url( JSON.stringify( payload ) );
	let signature = CRYPTO.sign( 'RSA-SHA256', Buffer.from( input ), Key || PAIR.privateKey );
	return input + '.' + base64url( signature );
}


function fresh_users()
{
	let users = USERS.Users( { Folder: FS.mkdtempSync( PATH.join( OS.tmpdir(), 'consensus-clerk-' ) ) } );
	users.Prepare( { Owner: { Name: 'user', Display: 'User' } } );
	return users;
}


// A Clerk over the section, the keys list and a clock the test moves; Options adds FetchUser or Users.
function clerk_of( Options )
{
	let options = Options || {};
	let state = { Keys: [ JWK ], Reads: 0, Clock: Date.now() };
	let clerk = CLERK.Clerk( {
		Settings: { Scope: 'Public', Clerk: Object.assign( {}, SECTION, options.Section || {} ) },
		Users: options.Users || null,
		Jwks: function () { state.Reads += 1; return state.Keys; },
		FetchUser: options.FetchUser || null,
		Now: function () { return state.Clock; },
	} );
	return { Clerk: clerk, State: state };
}


function clerk_user( id, email, first, last )
{
	return { id: id, first_name: first, last_name: last, username: null, email_addresses: [ { id: id + '-email', email_address: email } ], primary_email_address_id: id + '-email' };
}


// A webhook's headers for Body, signed with the section's secret; Fields override the id, the timestamp or the secret.
function webhook_headers( Body, Fields )
{
	let fields = Fields || {};
	let id = fields.Id || 'msg_1';
	let timestamp = fields.Timestamp || String( Math.floor( Date.now() / 1000 ) );
	let key = Buffer.from( fields.Key || WEBHOOK_KEY );
	let signature = CRYPTO.createHmac( 'sha256', key ).update( id + '.' + timestamp + '.' + Body ).digest( 'base64' );
	return { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': ( fields.Prefix || '' ) + 'v1,' + signature };
}


//---------------------------------------------------------------------

TEST( 'the publishable key names the Frontend API; Config never carries the secret; without a section the built-in key names our instance; Scope None is off', function ()
{
	let on = clerk_of().Clerk;
	ASSERT.equal( on.On(), true );
	ASSERT.equal( on.FrontendApi(), HOST );
	ASSERT.deepEqual( on.Config(), { On: true, Required: true, PublishableKey: SECTION.PublishableKey, FrontendApi: HOST, Pricing: CLERK.PRICING } );
	ASSERT.equal( JSON.stringify( on.Config() ).includes( 'sk_test' ), false );
	// the section's key alone overrides; a Local server is on but not required
	let local = CLERK.Clerk( { Settings: { Scope: 'Local', Clerk: { PublishableKey: SECTION.PublishableKey } } } );
	ASSERT.deepEqual( [ local.On(), local.Config().Required, local.FrontendApi() ], [ true, false, HOST ] );
	// no section: our instance
	let ours = CLERK.Clerk( { Settings: {} } );
	ASSERT.equal( ours.On(), true );
	ASSERT.match( ours.PublishableKey(), /^pk_(test|live)_[A-Za-z0-9]+$/ );
	ASSERT.match( ours.FrontendApi(), /^[a-z0-9.-]+\.clerk\.accounts\.dev$|^clerk\./ );
	ASSERT.equal( ours.Config().Required, false );
	ASSERT.equal( CLERK.Clerk( { Settings: { Clerk: { PublishableKey: 'pk_test_!!!', SecretKey: 'sk_x' } } } ).FrontendApi(), null );
	ASSERT.equal( CLERK.Clerk( { Settings: { Scope: 'None' } } ).On(), false );
	ASSERT.deepEqual( CLERK.Clerk( { Settings: { Scope: 'None' } } ).Config(), { On: false, Required: false, PublishableKey: null, FrontendApi: null, Pricing: CLERK.PRICING } );
} );


TEST( 'a session token is verified: the signature, exp and nbf with a minute\'s leeway, the issuer and azp; the refusals', async function ()
{
	let made = clerk_of();
	let clerk = made.Clerk;
	let claims = await clerk.Verify( sign( { sub: 'user_1', azp: 'http://localhost:3500' } ), 'localhost:3500' );
	ASSERT.equal( claims.sub, 'user_1' );
	ASSERT.equal( claims.iss, 'https://' + HOST );
	ASSERT.equal( made.State.Reads, 1 );
	let seconds = Math.floor( Date.now() / 1000 );
	ASSERT.equal( await clerk.Verify( sign( { exp: seconds - 120 } ) ), null, 'expired' );
	ASSERT.notEqual( await clerk.Verify( sign( { exp: seconds - 30 } ) ), null, 'within the leeway' );
	ASSERT.equal( await clerk.Verify( sign( { nbf: seconds + 120 } ) ), null, 'not yet' );
	ASSERT.equal( await clerk.Verify( sign( { iss: 'https://other.example.test' } ) ), null, 'another issuer' );
	ASSERT.equal( await clerk.Verify( sign( { azp: 'http://evil.example' } ), 'localhost:3500' ), null, 'another azp' );
	ASSERT.notEqual( await clerk.Verify( sign( { azp: 'http://evil.example' } ) ), null, 'azp unchecked without a host' );
	ASSERT.notEqual( await clerk.Verify( sign( {} ), 'localhost:3500' ), null, 'no azp claim' );
	ASSERT.equal( await clerk.Verify( sign( {}, OTHER.privateKey ) ), null, 'another key under the same key id' );
	ASSERT.equal( await clerk.Verify( sign( {}, PAIR.privateKey, { alg: 'HS256', kid: 'key-1' } ) ), null, 'another algorithm' );
	ASSERT.equal( await clerk.Verify( sign( {}, PAIR.privateKey, { alg: 'none', kid: 'key-1' } ) ), null, 'no algorithm' );
	ASSERT.equal( await clerk.Verify( 'not.a.token' ), null );
	ASSERT.equal( await clerk.Verify( '' ), null );
	let signed = sign( {} );
	ASSERT.equal( await clerk.Verify( signed.slice( 0, -4 ) + 'AAAA' ), null, 'a changed signature' );
	// an unknown key id: the keys are read again, once a minute at most
	let reads = made.State.Reads;
	ASSERT.equal( await clerk.Verify( sign( {}, OTHER.privateKey, { alg: 'RS256', kid: 'key-2' } ) ), null, 'no such key yet' );
	ASSERT.equal( made.State.Reads, reads, 'not read again within the minute' );
	made.State.Keys = [ JWK, JWK_OTHER ];
	made.State.Clock += 61 * 1000;
	ASSERT.equal( ( await clerk.Verify( sign( { sub: 'user_2' }, OTHER.privateKey, { alg: 'RS256', kid: 'key-2' } ) ) ).sub, 'user_2' );
	ASSERT.equal( made.State.Reads, reads + 1 );
	// another instance's token: the issuer is not ours
	ASSERT.equal( await CLERK.Clerk( { Settings: {}, Jwks: function () { return [ JWK ]; } } ).Verify( sign( {} ) ), null );
	ASSERT.equal( await CLERK.Clerk( { Settings: { Scope: 'None', Clerk: SECTION }, Jwks: function () { return [ JWK ]; } } ).Verify( sign( {} ) ), null, 'Scope None verifies nothing' );
	ASSERT.equal( clerk.Looks( signed ), true );
	ASSERT.equal( clerk.Looks( 'abcdef0123456789' ), false );
} );


TEST( 'the subject is the record with that Clerk id; an unknown one is fetched once and written, matched by email to a hand-made record or made with a login from the email', async function ()
{
	let users = fresh_users();
	let bob = users.Create( { Type: 'user', Login: 'bob', Display: 'Bob', Email: 'Bob@example.com' } );
	let fetched = [];
	let people = { user_ann: clerk_user( 'user_ann', 'Ann.A+work@example.com', 'Ann', 'A.' ), user_bob: clerk_user( 'user_bob', 'bob@example.com', 'Bob', 'B.' ), user_none: clerk_user( 'user_none', null, null, null ) };
	let clerk = clerk_of( { Users: users, FetchUser: function ( id ) { fetched.push( id ); return people[ id ] || null; } } ).Clerk;
	// unknown: fetched, made with the login from the email and the names as display, no role anywhere
	let ann = await clerk.Identify( sign( { sub: 'user_ann' } ) );
	ASSERT.deepEqual( [ ann.Type, ann.Login, ann.Display, ann.Email, ann.Clerk ], [ 'user', 'ann.a-work', 'Ann A.', 'Ann.A+work@example.com', 'user_ann' ] );
	ASSERT.deepEqual( fetched, [ 'user_ann' ] );
	ASSERT.equal( ( await clerk.Identify( sign( { sub: 'user_ann' } ) ) ).Id, ann.Id );
	ASSERT.deepEqual( fetched, [ 'user_ann' ], 'not fetched again' );
	ASSERT.equal( users.IsAdmin( { Clerk: SECTION }, ann ), false );
	// the hand-made record completed: the same id, the Clerk id filled in, the display kept
	let same = await clerk.Identify( sign( { sub: 'user_bob' } ) );
	ASSERT.deepEqual( [ same.Id, same.Login, same.Display, same.Clerk ], [ bob.Id, 'bob', 'Bob', 'user_bob' ] );
	ASSERT.equal( users.List().length, 3 );
	// nobody: no such user at Clerk, a user with no email, a bad token
	ASSERT.equal( await clerk.Identify( sign( { sub: 'user_gone' } ) ), null );
	ASSERT.equal( await clerk.Identify( sign( { sub: 'user_none' } ) ), null );
	ASSERT.equal( await clerk.Identify( sign( { sub: 'user_ann' }, OTHER.privateKey ) ), null );
	ASSERT.equal( users.List().length, 3 );
	// the login: lowercased local part, other characters a dash, a number while taken
	ASSERT.equal( clerk.LoginFrom( 'Carl_Z.99@example.com' ), 'carl_z.99' );
	ASSERT.equal( clerk.LoginFrom( 'bob@example.com' ), 'bob-2' );
	ASSERT.equal( clerk.LoginFrom( 'ann.a+work@example.com' ), 'ann.a-work-2' );
	ASSERT.equal( clerk.LoginFrom( '...@example.com' ), 'user-2', 'the owner is user' );
	ASSERT.equal( clerk.LoginFrom( 'x'.repeat( 60 ) + '@example.com' ).length, 40 );
} );


TEST( 'the webhook signature: good, with several signatures listed, bad, stale, missing; the secret\'s whsec_ form', function ()
{
	let clerk = clerk_of().Clerk;
	let body = JSON.stringify( { type: 'user.created', data: { id: 'user_1' } } );
	ASSERT.equal( clerk.VerifyWebhook( webhook_headers( body ), body ), true );
	ASSERT.equal( clerk.VerifyWebhook( webhook_headers( body, { Prefix: 'v1,AAAA v1a,BBBB ' } ), body ), true, 'any listed signature' );
	ASSERT.equal( clerk.VerifyWebhook( webhook_headers( body, { Key: 'another-secret' } ), body ), false );
	ASSERT.equal( clerk.VerifyWebhook( webhook_headers( body ), body + ' ' ), false, 'another body' );
	ASSERT.equal( clerk.VerifyWebhook( webhook_headers( body, { Timestamp: String( Math.floor( Date.now() / 1000 ) - 6 * 60 ) } ), body ), false, 'stale' );
	ASSERT.equal( clerk.VerifyWebhook( webhook_headers( body, { Timestamp: 'soon' } ), body ), false );
	ASSERT.equal( clerk.VerifyWebhook( { 'svix-id': 'msg_1' }, body ), false );
	ASSERT.equal( clerk.VerifyWebhook( {}, body ), false );
	ASSERT.equal( clerk_of( { Section: { WebhookSecret: '' } } ).Clerk.VerifyWebhook( webhook_headers( body ), body ), false, 'no secret, no webhook' );
	// the headers as Node hands them, lower-cased
	let given = webhook_headers( body );
	ASSERT.equal( clerk.VerifyWebhook( { 'Svix-Id': given[ 'svix-id' ], 'Svix-Timestamp': given[ 'svix-timestamp' ], 'Svix-Signature': given[ 'svix-signature' ] }, body ), true );
} );


TEST( 'the registry follows the events: a user created, updated and deleted, a membership created and deleted, an organization logged, the rest ignored', function ()
{
	let users = fresh_users();
	let carl = users.Create( { Type: 'user', Login: 'carl', Email: 'carl@example.com' } );
	let clerk = clerk_of( { Users: users } ).Clerk;
	let created = clerk.Handle( { type: 'user.created', data: clerk_user( 'user_ann', 'ann@example.com', 'Ann', 'A.' ) } );
	ASSERT.deepEqual( [ created.Type, created.Record.Login, created.Record.Display, created.Record.Clerk, created.Line ], [ 'user.created', 'ann', 'Ann A.', 'user_ann', 'user.created: ann created' ] );
	let updated = clerk.Handle( { type: 'user.updated', data: clerk_user( 'user_ann', 'ann.a@example.com', 'Ann', 'Adams' ) } );
	ASSERT.deepEqual( [ updated.Record.Id, updated.Record.Display, updated.Record.Email, updated.Line ], [ created.Record.Id, 'Ann Adams', 'ann.a@example.com', 'user.updated: ann updated' ] );
	ASSERT.equal( clerk.Handle( { type: 'user.updated', data: clerk_user( 'user_ann', 'ann.a@example.com', 'Ann', 'Adams' ) } ).Line, 'user.updated: ann kept' );
	let completed = clerk.Handle( { type: 'user.created', data: clerk_user( 'user_carl', 'CARL@example.com', 'Carl', null ) } );
	ASSERT.deepEqual( [ completed.Record.Id, completed.Record.Clerk, completed.Record.Display, completed.Line ], [ carl.Id, 'user_carl', 'Carl', 'user.created: carl completed' ] );
	ASSERT.equal( clerk.Handle( { type: 'user.created', data: clerk_user( 'user_x', null, null, null ) } ).Line, 'user.created: no email, nothing written' );
	let member = clerk.Handle( { type: 'organizationMembership.created', data: { public_user_data: { user_id: 'user_dee', identifier: 'dee@example.com', first_name: 'Dee', last_name: null } } } );
	ASSERT.deepEqual( [ member.Record.Login, member.Record.Display, member.Record.Clerk, member.Line ], [ 'dee', 'Dee', 'user_dee', 'organizationMembership.created: dee created' ] );
	ASSERT.equal( users.List().length, 4 );
	let left = clerk.Handle( { type: 'organizationMembership.deleted', data: { public_user_data: { user_id: 'user_dee' } } } );
	ASSERT.deepEqual( [ left.Removed.Id, left.Line ], [ member.Record.Id, 'organizationMembership.deleted: dee removed' ] );
	let deleted = clerk.Handle( { type: 'user.deleted', data: { id: 'user_ann', deleted: true } } );
	ASSERT.deepEqual( [ deleted.Removed.Id, deleted.Line ], [ created.Record.Id, 'user.deleted: ann removed' ] );
	ASSERT.equal( clerk.Handle( { type: 'user.deleted', data: { id: 'user_ann' } } ).Line, 'user.deleted: no such account' );
	ASSERT.deepEqual( users.List().map( function ( one ) { return one.Login; } ), [ 'user', 'carl' ] );
	ASSERT.equal( clerk.Handle( { type: 'organization.created', data: { id: 'org_1', name: 'Acme' } } ).Line, 'organization.created: "Acme"' );
	ASSERT.equal( clerk.Handle( { type: 'session.created', data: {} } ).Line, 'session.created: ignored' );
	ASSERT.equal( clerk.Handle( null ).Line, 'event: ignored' );
	// the owner's record is never removed, whatever Clerk id it carries
	let owner = users.List()[ 0 ];
	users.Update( owner.Id, { Clerk: 'user_owner' } );
	ASSERT.equal( clerk.Handle( { type: 'user.deleted', data: { id: 'user_owner' } } ).Removed, null );
} );


TEST( 'the license (plan Clerk, Step 5): the person written from the claims with no secret key, the plan the higher of the user\'s and the organization\'s, an expired one nothing, the plan on the record; a Local session is the owner\'s', async function ()
{
	let users = fresh_users();
	let fetched = [];
	let made = clerk_of( { Users: users, Section: { SecretKey: '' }, FetchUser: function ( id ) { fetched.push( id ); return null; } } );
	let clerk = made.Clerk;
	// License reads the claims the template writes: an object, a string, the higher of the two, an expired one dropped
	ASSERT.deepEqual( clerk.License( { license: { Plan: 'personal' } } ), { Plan: 'personal', Until: null } );
	ASSERT.deepEqual( clerk.License( { license: 'professional' } ), { Plan: 'professional', Until: null } );
	ASSERT.deepEqual( clerk.License( { license: { Plan: 'personal' }, org_license: { Plan: 'professional', Until: '2099-01-01' } } ), { Plan: 'professional', Until: '2099-01-01T00:00:00.000Z' } );
	ASSERT.deepEqual( clerk.License( { license: { Plan: 'professional', Until: '2001-01-01' }, org_license: { Plan: 'personal' } } ), { Plan: 'personal', Until: null } );
	ASSERT.equal( clerk.License( { license: { Plan: 'Gold' } } ), null );
	// the old names (plan Rearchitecturation, Step 6 renamed the plans outright) are not read
	ASSERT.equal( clerk.License( { license: 'Host' } ), null );
	ASSERT.equal( clerk.License( { license: { Plan: 'User' } } ), null );
	ASSERT.equal( clerk.License( { license: 'Professional' } ), null, 'the names are lower case' );
	ASSERT.equal( clerk.License( { license: { Plan: 'personal', Until: 'soon' } } ), null );
	ASSERT.equal( clerk.License( {} ), null );
	ASSERT.equal( clerk.License( null ), null );
	// a person from the claims: written with no fetch, the plan on the record
	let ann = await clerk.Session( sign( { sub: 'user_ann', email: 'Ann@example.com', first: 'Ann', last: 'A.', license: { Plan: 'personal' } } ) );
	ASSERT.deepEqual( [ ann.Record.Login, ann.Record.Display, ann.Record.Email, ann.Record.Clerk, ann.Record.Plan, ann.License.Plan, ann.Claims.sub ], [ 'ann', 'Ann A.', 'Ann@example.com', 'user_ann', 'personal', 'personal', 'user_ann' ] );
	ASSERT.deepEqual( fetched, [] );
	ASSERT.equal( users.Get( ann.Record.Id ).Plan, 'personal' );
	// the plan follows the token: an organization's Host, then none
	ASSERT.equal( ( await clerk.Session( sign( { sub: 'user_ann', org_license: { Plan: 'professional' } } ) ) ).Record.Plan, 'professional' );
	let bare = await clerk.Session( sign( { sub: 'user_ann' } ) );
	ASSERT.deepEqual( [ bare.Record.Id, bare.Record.Plan, bare.License ], [ ann.Record.Id, null, null ] );
	// no email in the claims and no secret key: nobody, nothing written
	ASSERT.equal( await clerk.Session( sign( { sub: 'user_bob' } ) ), null );
	ASSERT.deepEqual( fetched, [ 'user_bob' ], 'the test fetch stands in for the Backend API' );
	ASSERT.equal( users.List().length, 2 );
	ASSERT.equal( await clerk.Identify( sign( { sub: 'user_x', email: 'x@example.com' }, OTHER.privateKey ) ), null );
	// a Local server: the session is the owner's, whose record takes the Clerk id and the plan
	let local_users = fresh_users();
	let local = CLERK.Clerk( { Settings: { Scope: 'Local', Clerk: SECTION }, Users: local_users, Jwks: function () { return [ JWK ]; } } );
	let owner = await local.Session( sign( { sub: 'user_owner', email: 'owner@example.com', license: 'professional' } ) );
	// the record takes the Clerk id, the plan and, since 2026-10-26, the email; Login and Display stay the settings' Owner
	ASSERT.deepEqual( [ owner.Record.Type, owner.Record.Login, owner.Record.Display, owner.Record.Email, owner.Record.Clerk, owner.Record.Plan, owner.License.Plan ], [ 'owner', 'user', 'User', 'owner@example.com', 'user_owner', 'professional', 'professional' ] );
	ASSERT.equal( local_users.List().length, 1, 'nothing else written' );
	ASSERT.equal( local_users.List()[ 0 ].Email, 'owner@example.com', 'written to the registry' );
	// a sign-in whose claims carry no email leaves the one on the record
	ASSERT.equal( ( await local.Session( sign( { sub: 'user_owner', license: 'professional' } ) ) ).Record.Email, 'owner@example.com' );
	ASSERT.equal( ( await local.Session( sign( { sub: 'user_other', email: 'other@example.com' } ) ) ).Record.Type, 'owner', 'any session on Local is the owner' );
	ASSERT.equal( local_users.List()[ 0 ].Plan, null );
} );
