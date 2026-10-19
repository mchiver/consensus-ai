'use strict';

// The sign-in through Clerk in a real browser against the development instance (plan User Management, Step 4;
// plan Clerk, Step 3): a temporary server with the development keys and Scope Public in its settings (it still
// listens on 127.0.0.1), so a bare request is refused and the page shows Clerk's sign-in box; a Clerk test user
// (an address ending +clerk_test@example.com, made through the Backend API when missing) signs in with the fixed
// code 424242; the page reloads as that person, with the user button in the title bar and the account written to
// the registry with a login made from the email. It runs only when the environment names the development keys,
// CONSENSUS_CLERK_PUBLISHABLE and CONSENSUS_CLERK_SECRET, and is skipped with a note otherwise, so the suite stays
// green on any machine. The keys never go into the repository.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const FS = require( 'fs' );
const OS = require( 'os' );
const PATH = require( 'path' );
const SERVER = require( '../src/Server.js' );
const CDP = require( './support/Cdp.js' );

const PUBLISHABLE = ( process.env.CONSENSUS_CLERK_PUBLISHABLE || '' ).trim();
const SECRET = ( process.env.CONSENSUS_CLERK_SECRET || '' ).trim();
const SKIP = ( PUBLISHABLE && SECRET ) ? false : 'CONSENSUS_CLERK_PUBLISHABLE and CONSENSUS_CLERK_SECRET are not set: no development instance to sign in to';
const EMAIL = 'consensus-smoke+clerk_test@example.com';
const CODE = '424242';
const LOGIN = 'consensus-smoke-clerk_test';


function count_of( selector )
{
	return 'document.querySelectorAll( ' + JSON.stringify( selector ) + ' ).length';
}


function text_of( selector )
{
	return '( document.querySelector( ' + JSON.stringify( selector ) + ' ) || { textContent: "" } ).textContent.trim()';
}


async function json( method, url, body, headers )
{
	let options = { method: method, headers: Object.assign( { 'Content-Type': 'application/json' }, headers || {} ) };
	if ( body !== undefined )
	{
		options.body = JSON.stringify( body );
	}
	let response = await fetch( url, options );
	return { Status: response.status, Body: await response.json() };
}


TEST( 'a person signs in through Clerk in the page: the sign-in box on a refused request, the test code, the page reloaded as the person, the account written', { skip: SKIP, timeout: 180000 }, async function ()
{
	// The test user at Clerk, made once through the Backend API (422: it exists already).
	let made = await json( 'POST', 'https://api.clerk.com/v1/users', { email_address: [ EMAIL ], first_name: 'Smoke', last_name: 'Test', skip_password_requirement: true }, { Authorization: 'Bearer ' + SECRET } );
	ASSERT.ok( made.Status === 200 || made.Status === 422, 'the test user at Clerk: ' + made.Status + ' ' + JSON.stringify( made.Body ).slice( 0, 200 ) );
	let running = await SERVER.Start( { Data: FS.mkdtempSync( PATH.join( OS.tmpdir(), 'consensus-clerk-smoke-' ) ), Port: 0 } );
	let browser = null;
	try
	{
		// The keys and Scope Public in the settings: a bare request is refused from here on.
		let settings = ( await json( 'GET', running.Url + '/api/settings' ) ).Body.Settings;
		let saved = await json( 'PUT', running.Url + '/api/settings', Object.assign( {}, settings, { Scope: 'Public', Clerk: { PublishableKey: PUBLISHABLE, SecretKey: SECRET, WebhookSecret: '', AdminEmail: '' } } ) );
		ASSERT.equal( saved.Status, 200, JSON.stringify( saved.Body ) );
		ASSERT.deepEqual( await json( 'GET', running.Url + '/api/me' ), { Status: 401, Body: { Error: 'sign in' } } );
		ASSERT.equal( ( await json( 'GET', running.Url + '/api/clerk' ) ).Body.On, true );
		// The page at localhost (a development instance accepts it as an origin): the sign-in box, Clerk's form in it.
		browser = await CDP.StartBrowser();
		let page = await browser.OpenPage( 'http://localhost:' + running.Address.Port + '/' );
		await page.WaitFor( count_of( '#sign-in-popup' ) + ' === 1', 30000 );
		await page.WaitFor( count_of( '#sign-in-mount input[name="identifier"]' ) + ' === 1', 60000 );
		await page.Click( '#sign-in-mount input[name="identifier"]' );
		await page.Type( EMAIL );
		await page.Press( 'Enter' );
		await page.WaitFor( count_of( '#sign-in-mount input[autocomplete="one-time-code"], #sign-in-mount input[name="code"]' ) + ' >= 1', 60000 );
		await page.Click( '#sign-in-mount input[autocomplete="one-time-code"], #sign-in-mount input[name="code"]' );
		await page.Type( CODE );
		// A finished sign-in reloads the page as the person: the user button, the root's line, the registry record.
		await page.WaitFor( count_of( '#user-button' ) + ' === 1', 60000 );
		await page.WaitFor( text_of( '.root-head .me' ) + '.indexOf( ' + JSON.stringify( LOGIN ) + ' ) >= 0 || ' + text_of( '.root-head .me' ) + '.indexOf( "Smoke Test" ) >= 0', 30000 );
		let record = running.Users.List().find( function ( one ) { return one.Email && one.Email.toLowerCase() === EMAIL; } );
		ASSERT.ok( record, 'the account written to the registry' );
		ASSERT.deepEqual( [ record.Type, record.Login, record.Display, !!record.Clerk ], [ 'user', LOGIN, 'Smoke Test', true ] );
		ASSERT.equal( await page.Evaluate( count_of( '#sign-in-popup' ) ), 0 );
		ASSERT.equal( await page.Evaluate( count_of( '#users-list .user-row' ) ), 2, 'the Users fold: the owner and the person' );
	}
	finally
	{
		if ( browser )
		{
			await browser.Close();
		}
		await running.Close();
	}
} );
