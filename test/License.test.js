'use strict';

// License.test - the machine's current user and the four tiers (plan The Server, Step 1; src/License.js).

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert' );
const CRYPTO = require( 'crypto' );
const FS = require( 'fs' );
const OS = require( 'os' );
const PATH = require( 'path' );
const LICENSE = require( '../src/License.js' );

const DAY = 24 * 60 * 60 * 1000;


//---------------------------------------------------------------------
// Helpers

function temporary_folder( prefix )
{
	return FS.mkdtempSync( PATH.join( OS.tmpdir(), prefix ) );
}


function base64url( value )
{
	return Buffer.from( value ).toString( 'base64' ).replace( /=+$/, '' ).replace( /\+/g, '-' ).replace( /\//g, '_' );
}


// A Clerk instance of our own: a key pair, the settings naming its host, and a token maker.
function instance()
{
	let pair = CRYPTO.generateKeyPairSync( 'rsa', { modulusLength: 2048 } );
	let jwk = Object.assign( pair.publicKey.export( { format: 'jwk' } ), { kid: 'key-1', use: 'sig', alg: 'RS256' } );
	let host = 'clerk.example.test';
	let settings = { Clerk: { PublishableKey: 'pk_test_' + Buffer.from( host + '$' ).toString( 'base64' ) } };
	function token( Claims, Key )
	{
		let seconds = Math.floor( Date.now() / 1000 );
		let payload = Object.assign( { iss: 'https://' + host, sub: 'user_1', exp: seconds + 60, nbf: seconds - 5, iat: seconds - 5 }, Claims || {} );
		let input = base64url( JSON.stringify( { alg: 'RS256', kid: 'key-1', typ: 'JWT' } ) ) + '.' + base64url( JSON.stringify( payload ) );
		return input + '.' + base64url( CRYPTO.sign( 'RSA-SHA256', Buffer.from( input ), Key || pair.privateKey ) );
	}
	return { Options: { Settings: settings, Jwks: function () { return [ jwk ]; } }, Token: token };
}


//---------------------------------------------------------------------
// The sign-in

TEST( 'a session token verified against the instance\'s keys gives the user record: the license, or none (Registered); the old plan names not read; a bad token is null', async function ()
{
	let clerk = instance();
	let now = Date.now();
	let record = await LICENSE.Verify( clerk.Token( { email: 'ann@example.com', first: 'Ann', last: 'Lee', license: { Plan: 'personal' } } ), clerk.Options );
	ASSERT.deepEqual( [ record.Email, record.Clerk, record.Display, record.Plan, record.Until ], [ 'ann@example.com', 'user_1', 'Ann Lee', 'personal', null ] );
	ASSERT.ok( Math.abs( Date.parse( record.Checked ) - now ) < 5000 );
	let professional = await LICENSE.Verify( clerk.Token( { license: 'personal', org_license: { Plan: 'professional', Until: '2099-01-01' } } ), clerk.Options );
	ASSERT.deepEqual( [ professional.Plan, professional.Until ], [ 'professional', '2099-01-01T00:00:00.000Z' ] );
	// a sign-in with no license is a record still: the Registered tier
	let registered = await LICENSE.Verify( clerk.Token( { email: 'bo@example.com' } ), clerk.Options );
	ASSERT.deepEqual( [ registered.Email, registered.Display, registered.Plan, registered.Until ], [ 'bo@example.com', 'bo@example.com', null, null ] );
	ASSERT.equal( ( await LICENSE.Verify( clerk.Token( { license: 'Host' } ), clerk.Options ) ).Plan, null, 'the old names are not read' );
	ASSERT.equal( ( await LICENSE.Verify( clerk.Token( { username: 'cy' } ), clerk.Options ) ).Display, 'cy' );
	let other = CRYPTO.generateKeyPairSync( 'rsa', { modulusLength: 2048 } );
	ASSERT.equal( await LICENSE.Verify( clerk.Token( { license: 'personal' }, other.privateKey ), clerk.Options ), null, 'another key' );
	ASSERT.equal( await LICENSE.Verify( 'not a token', clerk.Options ), null );
} );


//---------------------------------------------------------------------
// The file

TEST( 'user.json: written whole and read back, a later sign-in replaces the first, Remove signs out; a bad file or record reads as null', function ()
{
	let folder = temporary_folder( 'license-user-' );
	ASSERT.equal( LICENSE.FilePath( folder ), PATH.join( folder, 'user.json' ) );
	ASSERT.equal( LICENSE.Read( folder ), null );
	let first = { Email: 'ann@example.com', Clerk: 'user_1', Display: 'Ann', Plan: 'personal', Until: null, Checked: '2026-10-26T10:00:00.000Z' };
	ASSERT.deepEqual( LICENSE.Write( folder, first ), first );
	ASSERT.deepEqual( LICENSE.Read( folder ), first );
	let second = { Email: 'bo@example.com', Clerk: 'user_2', Display: 'Bo', Plan: null, Until: null, Checked: '2026-10-26T11:00:00.000Z' };
	LICENSE.Write( folder, Object.assign( { Extra: true }, second ) );
	ASSERT.deepEqual( LICENSE.Read( folder ), second, 'one user at a time, written whole' );
	ASSERT.equal( FS.readdirSync( folder ).some( function ( name ) { return name.endsWith( '.tmp' ); } ), false );
	ASSERT.equal( LICENSE.Remove( folder ), true );
	ASSERT.equal( LICENSE.Read( folder ), null );
	ASSERT.equal( LICENSE.Remove( folder ), false );
	// what is not a record
	ASSERT.throws( function () { LICENSE.Write( folder, { Plan: 'personal' } ); } );
	FS.writeFileSync( LICENSE.FilePath( folder ), 'not json' );
	ASSERT.equal( LICENSE.Read( folder ), null );
	ASSERT.equal( LICENSE.Clean( { Clerk: 'user_1', Checked: 'yesterday' } ), null );
	ASSERT.deepEqual( LICENSE.Clean( { Clerk: 'user_1', Checked: first.Checked, Plan: 'Host', Until: '2099-01-01' } ), { Email: null, Clerk: 'user_1', Display: null, Plan: null, Until: null, Checked: first.Checked } );
	// a folder that is not there yet is made
	let nested = PATH.join( folder, 'a', 'b' );
	LICENSE.Write( nested, first );
	ASSERT.deepEqual( LICENSE.Read( nested ), first );
} );


//---------------------------------------------------------------------
// The tier

TEST( 'the four tiers: Unlicensed with no record or 14 days unchecked (signed out), Registered with no license or one run out, Personal and Professional; Rank and AtLeast; the About line', function ()
{
	let now = Date.parse( '2026-10-26T10:00:00.000Z' );
	let checked = new Date( now ).toISOString();
	let fresh = { Email: 'ann@example.com', Clerk: 'user_1', Display: 'Ann', Plan: 'personal', Until: null, Checked: checked };
	let registered = Object.assign( {}, fresh, { Plan: null } );
	let ending = Object.assign( {}, fresh, { Plan: 'professional', Until: new Date( now + 2 * DAY ).toISOString() } );
	ASSERT.deepEqual( LICENSE.TIERS, [ 'unlicensed', 'registered', 'personal', 'professional' ] );
	ASSERT.deepEqual( LICENSE.TIERS.map( LICENSE.Rank ), [ 0, 1, 2, 3 ] );
	ASSERT.equal( LICENSE.Rank( 'free' ), 0 );

	ASSERT.deepEqual( LICENSE.Tier( null, now ), { Tier: 'unlicensed', Rank: 0, Plan: null, Email: null, Display: null, Days: null, Until: null, Checked: null, Lapsed: null } );
	ASSERT.deepEqual( LICENSE.Tier( fresh, now ), { Tier: 'personal', Rank: 2, Plan: 'personal', Email: 'ann@example.com', Display: 'Ann', Days: 14, Until: null, Checked: checked, Lapsed: null } );
	ASSERT.deepEqual( [ LICENSE.Tier( fresh, now + 13 * DAY ).Tier, LICENSE.Tier( fresh, now + 13 * DAY ).Days ], [ 'personal', 1 ] );
	// 14 days with no check: signed out
	ASSERT.equal( LICENSE.Lapsed( fresh, now + 13 * DAY ), false );
	ASSERT.equal( LICENSE.Lapsed( fresh, now + 14 * DAY ), true );
	ASSERT.deepEqual( [ LICENSE.Tier( fresh, now + 14 * DAY ).Tier, LICENSE.Tier( fresh, now + 14 * DAY ).Lapsed, LICENSE.Tier( fresh, now + 14 * DAY ).Email ], [ 'unlicensed', 'checked', null ] );
	ASSERT.equal( LICENSE.Tier( registered, now + 14 * DAY ).Tier, 'unlicensed' );
	// signed in with no license, or a license run out: Registered
	ASSERT.deepEqual( [ LICENSE.Tier( registered, now ).Tier, LICENSE.Tier( registered, now ).Rank, LICENSE.Tier( registered, now ).Days ], [ 'registered', 1, 14 ] );
	ASSERT.equal( LICENSE.Tier( ending, now + DAY ).Tier, 'professional' );
	ASSERT.deepEqual( [ LICENSE.Tier( ending, now + 3 * DAY ).Tier, LICENSE.Tier( ending, now + 3 * DAY ).Lapsed ], [ 'registered', 'until' ] );

	ASSERT.deepEqual(
		[ LICENSE.AtLeast( fresh, 'personal', now ), LICENSE.AtLeast( fresh, 'professional', now ), LICENSE.AtLeast( ending, 'professional', now ), LICENSE.AtLeast( registered, 'registered', now ), LICENSE.AtLeast( registered, 'personal', now ), LICENSE.AtLeast( null, 'unlicensed', now ), LICENSE.AtLeast( null, 'registered', now ) ],
		[ true, false, true, true, false, true, false ] );

	ASSERT.equal( LICENSE.Line( fresh, now ), 'Personal (ann@example.com), checked today: 14 days left offline' );
	ASSERT.equal( LICENSE.Line( fresh, now + 3 * DAY + 1000 ), 'Personal (ann@example.com), checked 3 days ago: 11 days left offline' );
	ASSERT.equal( LICENSE.Line( ending, now + DAY ), 'Professional (ann@example.com), checked a day ago: 13 days left offline, the license until ' + ending.Until.slice( 0, 10 ) );
	ASSERT.equal( LICENSE.Line( registered, now ), 'Registered (ann@example.com): signed in with no license, checked today' );
	ASSERT.equal( LICENSE.Line( ending, now + 3 * DAY ), 'Registered (ann@example.com): the Professional license ran out on ' + ending.Until.slice( 0, 10 ) );
	ASSERT.equal( LICENSE.Line( fresh, now + 20 * DAY ), 'Unlicensed: the sign-in last checked on 2026-10-26 is more than 14 days old; sign in again' );
	ASSERT.equal( LICENSE.Line( null, now ), 'Unlicensed: not signed in; sign in with a Consensus-AI account' );
} );
