'use strict';

// The sign-in through Clerk in a real browser against the development instance (plan User Management, Step 4;
// plan Clerk, Steps 3 and 5): a temporary server started Public from a settings file with the development keys (it
// still listens on 127.0.0.1), so a bare request is refused and the page shows Clerk's sign-in box; a Clerk test user
// (an address ending +clerk_test@example.com, made through the Backend API when missing, given a User license in its
// public metadata) signs in with the fixed code 424242; the page reloads as that person, with the user button in the
// title bar and the account written to the registry with a login made from the email. The license reaches the
// server only once the instance's session token template carries it (plan Clerk, Step 6), so the record's Plan is
// not asserted. It runs only when the environment names the development keys,
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


// The code typed as key presses with a pause, the way a person types it into Clerk's boxes; then the sign-in is given
// a moment, and Clerk's own error text, when it shows one, goes into the failure.
async function type_code( Page )
{
	for ( let digit of CODE )
	{
		await Page.Press( digit );
		await new Promise( function ( Resolve ) { setTimeout( Resolve, 120 ); } );
	}
}


async function clerk_error( Page )
{
	return await Page.Evaluate( '( function () { let error = document.querySelector( ".cl-formFieldErrorText, .cl-alertText, [data-localization-key$=\\"error\\"]" ); return error ? error.textContent.trim() : ""; } )()' );
}


TEST( 'a person signs in through Clerk in the page: the sign-in box on a refused request, the test code, the page reloaded as the person, the account written', { skip: SKIP, timeout: 180000 }, async function ()
{
	// The test user at Clerk, made once through the Backend API (422: it exists already).
	let made = await json( 'POST', 'https://api.clerk.com/v1/users', { email_address: [ EMAIL ], first_name: 'Smoke', last_name: 'Test', skip_password_requirement: true, public_metadata: { license: { Plan: 'User' } } }, { Authorization: 'Bearer ' + SECRET } );
	ASSERT.ok( made.Status === 200 || made.Status === 422, 'the test user at Clerk: ' + made.Status + ' ' + JSON.stringify( made.Body ).slice( 0, 200 ) );
	// Public from the settings file, with the keys (plan Clerk, Step 5: Public is not saved from a bare request).
	let folder = FS.mkdtempSync( PATH.join( OS.tmpdir(), 'consensus-clerk-smoke-' ) );
	FS.writeFileSync( PATH.join( folder, 'consensus.json' ), JSON.stringify( { Port: 0, Scope: 'Public', Clerk: { PublishableKey: PUBLISHABLE, SecretKey: SECRET } } ) );
	let running = await SERVER.Start( { Config: folder, Port: 0 } );
	let browser = null;
	try
	{
		// A bare request is refused; the page is told to sign in.
		ASSERT.deepEqual( await json( 'GET', running.Url + '/api/me' ), { Status: 401, Body: { Error: 'sign in' } } );
		ASSERT.deepEqual( [ ( await json( 'GET', running.Url + '/api/clerk' ) ).Body.On, ( await json( 'GET', running.Url + '/api/clerk' ) ).Body.Required ], [ true, true ] );
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
		await type_code( page );
		// A finished sign-in reloads the page as the person (a moment given to the reload, so no wait spans it): the
		// user button, the root's line, the registry record.
		await new Promise( function ( Resolve ) { setTimeout( Resolve, 4000 ); } );
		try
		{
			await page.WaitFor( count_of( '#user-button' ) + ' === 1', 60000 );
		}
		catch ( error )
		{
			throw new Error( 'no user button after the code; Clerk says: ' + JSON.stringify( await clerk_error( page ) ) + '; ' + error.message );
		}
		await page.WaitFor( text_of( '.root-head .me' ) + '.indexOf( ' + JSON.stringify( LOGIN ) + ' ) >= 0 || ' + text_of( '.root-head .me' ) + '.indexOf( "Smoke Test" ) >= 0', 30000 );
		let record = running.Users.List().find( function ( one ) { return one.Email && one.Email.toLowerCase() === EMAIL; } );
		ASSERT.ok( record, 'the account written to the registry' );
		ASSERT.deepEqual( [ record.Type, record.Login, record.Display, !!record.Clerk ], [ 'user', LOGIN, 'Smoke Test', true ] );
		ASSERT.equal( await page.Evaluate( count_of( '#sign-in-popup' ) ), 0 );
		// The Users fold lists the person (a user with no role sees the list the route narrows for them).
		await page.WaitFor( count_of( '#users-list .user-row[data-id="' + record.Id + '"]' ) + ' === 1', 15000 );
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


//---------------------------------------------------------------------
// The desktop (plan Clerk, Step 7): the same sign-in inside the desktop window, on the desktop's own server. The
// desktop is started on a temporary config with the development keys and its own user data, over its DevTools port;
// the Settings popup's Sign in button opens Clerk's form, the test user signs in with the code, and the page reloads
// signed in: the user button, the session's plan (User, from the test user's metadata; so Public stays greyed out,
// which needs Host), and the owner's record carrying the Clerk id.

const CHILD_PROCESS = require( 'child_process' );
const DESKTOP_PORT = 9338;
const ROOT = PATH.join( __dirname, '..' );


function wait( Ms )
{
	return new Promise( function ( Resolve ) { setTimeout( Resolve, Ms ); } );
}


async function desktop_target( TimeoutMs )
{
	let limit = Date.now() + ( TimeoutMs || 30000 );
	while ( Date.now() < limit )
	{
		try
		{
			let list = await ( await fetch( 'http://127.0.0.1:' + DESKTOP_PORT + '/json/list' ) ).json();
			let found = list.find( function ( target ) { return target.type === 'page' && /^http:\/\/127\.0\.0\.1/.test( target.url ); } );
			if ( found )
			{
				return found;
			}
		}
		catch ( error )
		{
			// not up yet
		}
		await wait( 250 );
	}
	throw new Error( 'the desktop did not show its page within ' + ( TimeoutMs || 30000 ) + ' ms' );
}


TEST( 'the desktop signs in the same way (plan Clerk, Step 7): the Settings popup\'s Sign in button, the code, the page reloaded as the person, the plan read, Public still greyed out without Host', { skip: SKIP, timeout: 240000 }, async function ()
{
	let electron = require( 'electron' );
	let config = FS.mkdtempSync( PATH.join( OS.tmpdir(), 'consensus-clerk-desktop-config-' ) );
	let user_data = FS.mkdtempSync( PATH.join( OS.tmpdir(), 'consensus-clerk-desktop-user-data-' ) );
	FS.writeFileSync( PATH.join( config, 'consensus.json' ), JSON.stringify( { Port: 0, Scope: 'Local', Clerk: { PublishableKey: PUBLISHABLE, SecretKey: SECRET } } ) );
	let child = CHILD_PROCESS.spawn( electron, [ 'desktop', '--config', config, '--port', '0', '--user-data-dir=' + user_data, '--remote-debugging-port=' + DESKTOP_PORT ], { cwd: ROOT, stdio: 'ignore' } );
	let exited = new Promise( function ( Resolve ) { child.on( 'exit', Resolve ); } );
	try
	{
		let target = await desktop_target();
		ASSERT.doesNotMatch( target.url, /connect\.html/, 'the desktop opened on the connect screen: its own server did not start' );
		let page = await CDP.Attach( target.webSocketDebuggerUrl );
		await page.WaitFor( 'window.ConsensusDesktop !== undefined && ' + count_of( 'title-bar .brand' ) + ' === 1 && document.querySelector( ".connection" ) !== null && document.querySelector( ".connection" ).classList.contains( "live" )', 30000 );
		await page.WaitFor( '( function () { let session = angular.element( document.body ).injector().get( "Session" ); return session.Loaded && session.On && session.Base === "/servers/local"; } )()', 20000 );
		ASSERT.equal( await page.Evaluate( 'typeof window.Clerk' ), 'undefined', 'nothing loaded from Clerk yet' );
		// The Settings popup: Sign in
		await page.Evaluate( 'angular.element( document.body ).scope().$broadcast( "settings-opened" ); true' );
		await page.WaitFor( count_of( '#settings-popup .settings-form' ) + ' === 1 && getComputedStyle( document.getElementById( "settings-sign-in" ) ).display !== "none"', 20000 );
		await page.Evaluate( 'document.getElementById( "settings-sign-in" ).click(); true' );
		await page.WaitFor( count_of( '#sign-in-popup' ) + ' === 1', 30000 );
		await page.WaitFor( count_of( '#sign-in-mount input[name="identifier"]' ) + ' === 1', 60000 );
		await page.Click( '#sign-in-mount input[name="identifier"]' );
		await page.Type( EMAIL );
		await page.Press( 'Enter' );
		await page.WaitFor( count_of( '#sign-in-mount input[autocomplete="one-time-code"], #sign-in-mount input[name="code"]' ) + ' >= 1', 60000 );
		await page.Click( '#sign-in-mount input[autocomplete="one-time-code"], #sign-in-mount input[name="code"]' );
		await type_code( page );
		// Clerk's form navigates to its after-sign-in URL on success (a fresh load); a moment, then the reloaded target.
		await wait( 6000 );
		let again = await desktop_target();
		let reloaded = await CDP.Attach( again.webSocketDebuggerUrl );
		try
		{
			await reloaded.WaitFor( count_of( '#user-button' ) + ' === 1', 60000 );
		}
		catch ( error )
		{
			throw new Error( 'no user button after the code; Clerk says: ' + JSON.stringify( await clerk_error( reloaded ) ) + '; ' + error.message.slice( 0, 150 ) );
		}
		await reloaded.WaitFor( 'angular.element( document.body ).injector().get( "Session" ).SignedIn()', 20000 );
		ASSERT.equal( await reloaded.Evaluate( 'angular.element( document.body ).injector().get( "Session" ).Plan()' ), 'User', 'the test user\'s metadata' );
		ASSERT.equal( await reloaded.Evaluate( 'angular.element( document.body ).injector().get( "Session" ).Licensed( "Host" )' ), false );
		await reloaded.Evaluate( 'angular.element( document.body ).scope().$broadcast( "settings-opened" ); true' );
		await reloaded.WaitFor( count_of( '#settings-popup .settings-form' ) + ' === 1', 20000 );
		ASSERT.equal( await reloaded.Evaluate( '[ ...document.getElementById( "settings-scope" ).options ].find( function ( option ) { return option.textContent.trim() === "Public"; } ).disabled' ), true, 'Public needs Host' );
		ASSERT.equal( await reloaded.Evaluate( 'getComputedStyle( document.getElementById( "settings-sign-in" ) ).display' ), 'none', 'signed in: no Sign in button' );
		// The owner's record carries the Clerk id: a Local session is the owner's
		let users = JSON.parse( FS.readFileSync( PATH.join( config, 'Users.json' ), 'utf8' ) ).Users;
		ASSERT.ok( users.find( function ( one ) { return one.Type === 'owner' && one.Clerk; } ), 'the owner signed in' );
		ASSERT.equal( users.length, 1, 'nothing else written on Local' );
	}
	finally
	{
		child.kill();
		await Promise.race( [ exited, wait( 10000 ) ] );
	}
} );
