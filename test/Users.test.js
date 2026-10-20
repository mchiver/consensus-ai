'use strict';

// The registry (plan User Management, Step 3): Users.json over a temporary folder: the owner's record made at start
// and kept up to the settings, accounts made, changed and deleted, tokens minted once, matched by hash, touched and
// revoked, the Administrator, and the public shape.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const FS = require( 'fs' );
const OS = require( 'os' );
const PATH = require( 'path' );
const USERS = require( '../src/Users.js' );


function fresh()
{
	return USERS.Users( { Folder: FS.mkdtempSync( PATH.join( OS.tmpdir(), 'consensus-users-' ) ) } );
}


TEST( 'the owner\'s record is made at the first start and follows the settings\' Owner; a second start changes nothing', function ()
{
	let users = fresh();
	ASSERT.deepEqual( users.List(), [] );
	ASSERT.deepEqual( users.Migrate( { Owner: { Name: 'user', Display: 'User' } } ), [ 'Users.json made with the owner "user"' ] );
	let owner = users.List()[ 0 ];
	ASSERT.match( owner.Id, /^usr-[0-9a-z]{3}-[0-9a-z]{3}-[0-9a-z]{3}$/ );
	ASSERT.deepEqual( [ owner.Type, owner.Login, owner.Display, owner.Email, owner.Clerk, owner.Tokens ], [ 'owner', 'user', 'User', null, null, [] ] );
	ASSERT.deepEqual( users.Migrate( { Owner: { Name: 'user', Display: 'User' } } ), [] );
	ASSERT.deepEqual( users.Migrate( { Owner: { Name: 'user', Display: 'Andre' } } ), [ 'the owner\'s record brought up to the settings: user, shown as Andre' ] );
	ASSERT.equal( users.Get( owner.Id ).Display, 'Andre' );
	// read back from the file by another instance
	let again = USERS.Users( { Folder: PATH.dirname( users.Path() ) } );
	ASSERT.equal( again.List()[ 0 ].Id, owner.Id );
	ASSERT.equal( JSON.parse( FS.readFileSync( users.Path(), 'utf8' ) ).Users.length, 1 );
	ASSERT.equal( users.IsAdmin( {}, owner ), true );
} );


TEST( 'accounts: a user needs an email and a free login, a Service account a login; changed and deleted, the owner never', function ()
{
	let users = fresh();
	users.Migrate( { Owner: { Name: 'user' } } );
	let ann = users.Create( { Type: 'user', Login: ' ann ', Display: 'Ann', Email: 'ann@example.com' } );
	ASSERT.deepEqual( [ ann.Type, ann.Login, ann.Display, ann.Email ], [ 'user', 'ann', 'Ann', 'ann@example.com' ] );
	let bot = users.Create( { Type: 'service', Login: 'nightly' } );
	ASSERT.deepEqual( [ bot.Type, bot.Display, bot.Email ], [ 'service', 'nightly', null ] );
	ASSERT.throws( function () { users.Create( { Type: 'user', Login: 'Ann', Email: 'x@example.com' } ); }, /the login "Ann" is taken/ );
	ASSERT.throws( function () { users.Create( { Type: 'user', Login: 'carl' } ); }, /a user needs an email address/ );
	ASSERT.throws( function () { users.Create( { Type: 'user', Login: 'no spaces', Email: 'c@example.com' } ); }, /the login is letters/ );
	ASSERT.throws( function () { users.Create( { Type: 'user', Login: 'carl', Email: 'nope' } ); }, /the email must be an email address/ );
	ASSERT.equal( users.ByLogin( 'ANN' ).Id, ann.Id );
	ASSERT.equal( users.Update( ann.Id, { Display: 'Ann B.', Email: 'annb@example.com' } ).Email, 'annb@example.com' );
	ASSERT.throws( function () { users.Update( ann.Id, { Login: 'nightly' } ); }, /taken/ );
	ASSERT.equal( users.Update( ann.Id, { Login: 'ann' } ).Login, 'ann' );
	ASSERT.equal( users.Update( 'usr-none', { Display: 'x' } ), null );
	let owner = users.List()[ 0 ];
	ASSERT.equal( users.Update( owner.Id, { Login: 'other' } ).Login, 'user' );
	ASSERT.equal( users.Delete( owner.Id ), false );
	ASSERT.equal( users.Delete( bot.Id ), true );
	ASSERT.equal( users.Delete( bot.Id ), false );
	ASSERT.deepEqual( users.List().map( function ( record ) { return record.Login; } ), [ 'user', 'ann' ] );
	// the Administrator on a Public server with Clerk: the AdminEmail's account
	let settings = { Clerk: { PublishableKey: 'pk_x', SecretKey: 'sk_x', AdminEmail: 'ANNB@example.com' } };
	ASSERT.equal( users.IsAdmin( settings, users.Get( ann.Id ) ), true );
	ASSERT.equal( users.IsAdmin( {}, users.Get( ann.Id ) ), false );
	ASSERT.equal( users.IsAdmin( settings, null ), false );
} );


TEST( 'tokens: minted with a name and shown once, kept as a hash, matched, touched once a minute, revoked; the public shape shows no hash', function ()
{
	let users = fresh();
	users.Migrate( { Owner: { Name: 'user' } } );
	let ann = users.Create( { Type: 'user', Login: 'ann', Email: 'ann@example.com' } );
	let value = users.MintToken( ann.Id, 'laptop' );
	ASSERT.match( value, /^[0-9a-f]{48}$/ );
	ASSERT.throws( function () { users.MintToken( ann.Id, 'laptop' ); }, /is taken; revoke it first/ );
	ASSERT.throws( function () { users.MintToken( ann.Id, '' ); }, /a token name is/ );
	ASSERT.throws( function () { users.MintToken( 'usr-none', 'x' ); }, /no account/ );
	let record = users.Get( ann.Id );
	ASSERT.equal( record.Tokens.length, 1 );
	ASSERT.notEqual( record.Tokens[ 0 ].Hash, value );
	ASSERT.equal( record.Tokens[ 0 ].LastUsed, null );
	let found = users.ByToken( value );
	ASSERT.deepEqual( [ found.Record.Id, found.Token.Name ], [ ann.Id, 'laptop' ] );
	ASSERT.equal( users.ByToken( ' ' + value + ' ' ).Token.Name, 'laptop' );
	ASSERT.equal( users.ByToken( 'nope' ), null );
	users.Touch( ann.Id, 'laptop' );
	let first = users.Get( ann.Id ).Tokens[ 0 ].LastUsed;
	ASSERT.match( first, /^\d{4}-/ );
	users.Touch( ann.Id, 'laptop' );
	ASSERT.equal( users.Get( ann.Id ).Tokens[ 0 ].LastUsed, first );
	users.Touch( ann.Id, 'nope' );
	let shown = users.Public( users.Get( ann.Id ), true );
	ASSERT.deepEqual( shown.Tokens, [ { Name: 'laptop', Created: record.Tokens[ 0 ].Created, LastUsed: first } ] );
	ASSERT.deepEqual( Object.keys( users.Public( ann, false ) ), [ 'Id', 'Type', 'Login', 'Display', 'Email', 'Clerk', 'Plan', 'Created' ] );
	ASSERT.equal( users.Public( null ), null );
	ASSERT.equal( users.RevokeToken( ann.Id, 'laptop' ), true );
	ASSERT.equal( users.RevokeToken( ann.Id, 'laptop' ), false );
	ASSERT.equal( users.ByToken( value ), null );
	ASSERT.equal( users.RevokeToken( 'usr-none', 'x' ), false );
} );
