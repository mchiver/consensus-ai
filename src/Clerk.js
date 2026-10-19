'use strict';

// Clerk - the sign-in of a shared server (plan Clerk, Steps 2 and 4; plan User Management, Step 4). Clerk identifies
// people, Consensus keeps the registry (Users.js) and the roles. Nothing here needs a package: a Clerk session token
// is an RS256 JWT, verified with Node's own crypto against the instance's published keys (the JWKS at
// https://<frontend api>/.well-known/jwks.json, the Frontend API host decoded from the publishable key, whose base64
// part reads "<host>$"); a webhook is signed the Svix way (HMAC-SHA256 over "<id>.<timestamp>.<body>" with the
// secret decoded from its whsec_ form). The settings' Clerk section is read live, so keys saved in the popup count at
// once; On() is whether both keys are there.
//
//   Clerk( { Settings, Users, Jwks?, FetchUser?, Now? } ) -> {
//     On(), FrontendApi(), Config() -> { On, PublishableKey, FrontendApi } (never the secret),
//     Verify( Token, Host? ) -> the claims | null  (async): the signature against the key the token names, exp and
//       nbf with a minute's leeway, the issuer, and azp against Host (the request's Host header) when both are there,
//     Identify( Token, Host? ) -> record | null  (async): the registry record of the token's subject; a subject the
//       registry lacks is fetched once from Clerk's Backend API with the secret key and written (Adopt),
//     Adopt( { Clerk, Email, First?, Last?, Username? } ) -> { Record, Made } | null: the record by Clerk id brought
//       up (Made updated or kept), else the hand-made record with that email completed with the Clerk id (completed),
//       else a new user with a login made from the email and no role (created),
//     LoginFrom( Email ) -> a free login: the local part lowercased, other characters to a dash, a number while taken,
//     VerifyWebhook( Headers, Body ) -> true | false: the svix-id, svix-timestamp and svix-signature headers over the
//       raw body, the timestamp within five minutes,
//     Handle( Event ) -> { Type, Record?, Removed?, Line }: user.created and user.updated adopt; user.deleted and
//       organizationMembership.deleted remove the record (Removed, the roles are the API's to clear);
//       organizationMembership.created adopts the member; organization.created is logged; anything else ignored }
//   Jwks (tests): a function answering the JWKS keys list instead of the fetch; FetchUser( id ): the Clerk user
//   object instead of the Backend API; Now: the clock in milliseconds.

const CRYPTO = require( 'crypto' );
const PARTICIPANTS = require( './Participants.js' );

const LEEWAY = 60;	// seconds either way on exp and nbf
const WEBHOOK_WINDOW = 5 * 60;	// seconds a webhook's timestamp may be off
const JWKS_INTERVAL = 60 * 1000;	// the keys are read again for an unknown key id, once a minute at most
const BACKEND_API = 'https://api.clerk.com/v1';
const FETCH_TIMEOUT = 10 * 1000;
const LOGIN_LIMIT = 40;
const HOST = /^[a-z0-9.-]+$/i;
const WEBHOOK_PREFIX = 'whsec_';


function Clerk( Options )
{
	let options = Options || {};
	let settings = options.Settings || {};
	let users = options.Users || null;
	let jwks = ( typeof options.Jwks === 'function' ) ? options.Jwks : null;
	let fetch_user = ( typeof options.FetchUser === 'function' ) ? options.FetchUser : null;
	let now = ( typeof options.Now === 'function' ) ? options.Now : Date.now;
	let keys = {};			// key id -> KeyObject
	let keys_read_at = 0;


	function section()
	{
		return ( settings.Clerk && typeof settings.Clerk === 'object' ) ? settings.Clerk : {};
	}


	function On()
	{
		return PARTICIPANTS.HasClerk( settings );
	}


	// The Frontend API host the publishable key names: pk_test_<base64 of "<host>$"> or pk_live_….
	function FrontendApi()
	{
		let key = ( typeof section().PublishableKey === 'string' ) ? section().PublishableKey.trim() : '';
		let encoded = key.split( '_' ).slice( 2 ).join( '_' );
		if ( !encoded )
		{
			return null;
		}
		let decoded = Buffer.from( encoded, 'base64' ).toString( 'utf8' ).replace( /\$$/, '' ).trim();
		return HOST.test( decoded ) ? decoded.toLowerCase() : null;
	}


	function Config()
	{
		let on = On();
		return { On: on, PublishableKey: on ? section().PublishableKey.trim() : null, FrontendApi: on ? FrontendApi() : null };
	}


	//-----------------------------------------------------------------
	// The session token

	function base64url( text )
	{
		return Buffer.from( String( text || '' ).replace( /-/g, '+' ).replace( /_/g, '/' ), 'base64' );
	}


	function decode( token )
	{
		let parts = String( token || '' ).split( '.' );
		if ( parts.length !== 3 )
		{
			return null;
		}
		try
		{
			let header = JSON.parse( base64url( parts[ 0 ] ).toString( 'utf8' ) );
			let payload = JSON.parse( base64url( parts[ 1 ] ).toString( 'utf8' ) );
			if ( !header || typeof header !== 'object' || !payload || typeof payload !== 'object' )
			{
				return null;
			}
			return { Header: header, Payload: payload, Signature: base64url( parts[ 2 ] ), Input: parts[ 0 ] + '.' + parts[ 1 ] };
		}
		catch ( error )
		{
			return null;
		}
	}


	// Looks like a JWT: three base64url parts. The API asks before it spends a verification on a token.
	function Looks( Token )
	{
		return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test( String( Token || '' ) );
	}


	async function read_keys()
	{
		let list = null;
		if ( jwks )
		{
			list = await jwks();
		}
		else
		{
			let host = FrontendApi();
			if ( !host )
			{
				return;
			}
			let response = await fetch( 'https://' + host + '/.well-known/jwks.json', { signal: AbortSignal.timeout( FETCH_TIMEOUT ) } );
			if ( !response.ok )
			{
				return;
			}
			list = ( await response.json() ).keys;
		}
		if ( list && !Array.isArray( list ) && Array.isArray( list.keys ) )
		{
			list = list.keys;
		}
		let read = {};
		for ( let jwk of ( Array.isArray( list ) ? list : [] ) )
		{
			try
			{
				read[ jwk.kid ] = CRYPTO.createPublicKey( { key: jwk, format: 'jwk' } );
			}
			catch ( error )
			{
				// A key of another kind: left out.
			}
		}
		keys = read;
	}


	// The key a token names, read from the instance when the cache lacks it (once a minute at most).
	async function key_for( kid )
	{
		if ( keys[ kid ] )
		{
			return keys[ kid ];
		}
		if ( now() - keys_read_at < JWKS_INTERVAL )
		{
			return null;
		}
		keys_read_at = now();
		try
		{
			await read_keys();
		}
		catch ( error )
		{
			return null;
		}
		return keys[ kid ] || null;
	}


	async function Verify( Token, Host )
	{
		if ( !On() )
		{
			return null;
		}
		let decoded = decode( Token );
		if ( !decoded || decoded.Header.alg !== 'RS256' || !decoded.Header.kid )
		{
			return null;
		}
		let key = await key_for( decoded.Header.kid );
		if ( !key )
		{
			return null;
		}
		let valid = false;
		try
		{
			valid = CRYPTO.verify( 'RSA-SHA256', Buffer.from( decoded.Input ), key, decoded.Signature );
		}
		catch ( error )
		{
			valid = false;
		}
		if ( !valid )
		{
			return null;
		}
		let claims = decoded.Payload;
		let seconds = now() / 1000;
		if ( typeof claims.exp !== 'number' || seconds > claims.exp + LEEWAY )
		{
			return null;
		}
		if ( typeof claims.nbf === 'number' && seconds < claims.nbf - LEEWAY )
		{
			return null;
		}
		if ( claims.iss !== 'https://' + FrontendApi() )
		{
			return null;
		}
		if ( claims.azp && Host && !same_host( claims.azp, Host ) )
		{
			return null;
		}
		return claims;
	}


	function same_host( origin, host )
	{
		try
		{
			return new URL( origin ).host.toLowerCase() === String( host ).trim().toLowerCase();
		}
		catch ( error )
		{
			return false;
		}
	}


	//-----------------------------------------------------------------
	// The registry

	function by_clerk( id )
	{
		if ( !users || !id )
		{
			return null;
		}
		return users.List().find( function ( record ) { return record.Clerk === id; } ) || null;
	}


	function by_email( email )
	{
		if ( !users || !email )
		{
			return null;
		}
		let wanted = String( email ).trim().toLowerCase();
		return users.List().find( function ( record ) { return record.Type === 'user' && !record.Clerk && record.Email && record.Email.toLowerCase() === wanted; } ) || null;
	}


	function LoginFrom( Email )
	{
		let local = String( Email || '' ).split( '@' )[ 0 ].toLowerCase();
		let base = local.replace( /[^a-z0-9._-]+/g, '-' ).replace( /^[-._]+|[-._]+$/g, '' ).slice( 0, LOGIN_LIMIT ) || 'user';
		let candidate = base;
		let number = 2;
		while ( users && users.ByLogin( candidate ) )
		{
			let suffix = '-' + number;
			candidate = base.slice( 0, LOGIN_LIMIT - suffix.length ) + suffix;
			number += 1;
		}
		return candidate;
	}


	function display_of( profile )
	{
		let names = [ profile.First, profile.Last ].map( function ( one ) { return ( typeof one === 'string' ) ? one.trim() : ''; } ).filter( function ( one ) { return one; } );
		if ( names.length )
		{
			return names.join( ' ' );
		}
		return ( typeof profile.Username === 'string' && profile.Username.trim() ) ? profile.Username.trim() : '';
	}


	function Adopt( Profile )
	{
		let profile = Profile || {};
		if ( !users || !profile.Clerk )
		{
			return null;
		}
		let email = ( typeof profile.Email === 'string' && profile.Email.trim() ) ? profile.Email.trim() : null;
		let display = display_of( profile );
		let record = by_clerk( profile.Clerk );
		if ( record )
		{
			let changes = {};
			if ( email && record.Type === 'user' && record.Email !== email )
			{
				changes.Email = email;
			}
			if ( display && record.Display !== display )
			{
				changes.Display = display;
			}
			if ( Object.keys( changes ).length )
			{
				record = users.Update( record.Id, changes );
				return { Record: record, Made: 'updated' };
			}
			return { Record: record, Made: 'kept' };
		}
		record = by_email( email );
		if ( record )
		{
			let changes = { Clerk: profile.Clerk };
			if ( display && record.Display === record.Login )
			{
				changes.Display = display;
			}
			return { Record: users.Update( record.Id, changes ), Made: 'completed' };
		}
		if ( !email )
		{
			return null;
		}
		let login = LoginFrom( email );
		record = users.Create( { Type: 'user', Login: login, Display: display || login, Email: email } );
		return { Record: users.Update( record.Id, { Clerk: profile.Clerk } ), Made: 'created' };
	}


	// A Clerk user object (the Backend API's and the user webhooks') as a profile.
	function profile_of( user )
	{
		let given = ( user && typeof user === 'object' ) ? user : {};
		let addresses = Array.isArray( given.email_addresses ) ? given.email_addresses : [];
		let primary = addresses.find( function ( one ) { return one.id === given.primary_email_address_id; } ) || addresses[ 0 ] || null;
		return { Clerk: given.id || null, Email: primary ? primary.email_address : null, First: given.first_name, Last: given.last_name, Username: given.username };
	}


	async function read_user( id )
	{
		try
		{
			if ( fetch_user )
			{
				return await fetch_user( id );
			}
			let response = await fetch( BACKEND_API + '/users/' + encodeURIComponent( id ), { headers: { Authorization: 'Bearer ' + section().SecretKey.trim() }, signal: AbortSignal.timeout( FETCH_TIMEOUT ) } );
			if ( !response.ok )
			{
				return null;
			}
			return await response.json();
		}
		catch ( error )
		{
			return null;
		}
	}


	async function Identify( Token, Host )
	{
		let claims = await Verify( Token, Host );
		if ( !claims || typeof claims.sub !== 'string' || !claims.sub )
		{
			return null;
		}
		let record = by_clerk( claims.sub );
		if ( record )
		{
			return record;
		}
		let user = await read_user( claims.sub );
		if ( !user || user.id !== claims.sub )
		{
			return null;
		}
		let adopted = Adopt( profile_of( user ) );
		return adopted ? adopted.Record : null;
	}


	//-----------------------------------------------------------------
	// The webhook

	function header_of( headers, name )
	{
		let given = ( headers && typeof headers === 'object' ) ? headers : {};
		for ( let key of Object.keys( given ) )
		{
			if ( key.toLowerCase() === name )
			{
				return String( given[ key ] || '' );
			}
		}
		return '';
	}


	function VerifyWebhook( Headers, Body )
	{
		let secret = ( typeof section().WebhookSecret === 'string' ) ? section().WebhookSecret.trim() : '';
		if ( !secret.startsWith( WEBHOOK_PREFIX ) )
		{
			return false;
		}
		let id = header_of( Headers, 'svix-id' );
		let timestamp = header_of( Headers, 'svix-timestamp' );
		let signatures = header_of( Headers, 'svix-signature' );
		if ( !id || !timestamp || !signatures )
		{
			return false;
		}
		let seconds = parseInt( timestamp, 10 );
		if ( !Number.isFinite( seconds ) || Math.abs( now() / 1000 - seconds ) > WEBHOOK_WINDOW )
		{
			return false;
		}
		let key = Buffer.from( secret.slice( WEBHOOK_PREFIX.length ), 'base64' );
		let expected = CRYPTO.createHmac( 'sha256', key ).update( id + '.' + timestamp + '.' + String( Body || '' ) ).digest();
		for ( let part of signatures.split( ' ' ) )
		{
			let pair = part.split( ',' );
			if ( pair[ 0 ] !== 'v1' || !pair[ 1 ] )
			{
				continue;
			}
			let given = Buffer.from( pair[ 1 ], 'base64' );
			if ( given.length === expected.length && CRYPTO.timingSafeEqual( given, expected ) )
			{
				return true;
			}
		}
		return false;
	}


	function remove( clerk_id )
	{
		let record = by_clerk( clerk_id );
		if ( !record || record.Type === 'owner' )
		{
			return null;
		}
		users.Delete( record.Id );
		return record;
	}


	function Handle( Event )
	{
		let event = ( Event && typeof Event === 'object' ) ? Event : {};
		let type = String( event.type || '' );
		let data = ( event.data && typeof event.data === 'object' ) ? event.data : {};
		let member = ( data.public_user_data && typeof data.public_user_data === 'object' ) ? data.public_user_data : {};
		if ( type === 'user.created' || type === 'user.updated' )
		{
			let adopted = Adopt( profile_of( data ) );
			return { Type: type, Record: adopted ? adopted.Record : null, Line: adopted ? ( type + ': ' + adopted.Record.Login + ' ' + adopted.Made ) : ( type + ': no email, nothing written' ) };
		}
		if ( type === 'user.deleted' )
		{
			let removed = remove( data.id );
			return { Type: type, Removed: removed, Line: removed ? ( type + ': ' + removed.Login + ' removed' ) : ( type + ': no such account' ) };
		}
		if ( type === 'organizationMembership.created' )
		{
			let adopted = Adopt( { Clerk: member.user_id, Email: member.identifier, First: member.first_name, Last: member.last_name } );
			return { Type: type, Record: adopted ? adopted.Record : null, Line: adopted ? ( type + ': ' + adopted.Record.Login + ' ' + adopted.Made ) : ( type + ': no email, nothing written' ) };
		}
		if ( type === 'organizationMembership.deleted' )
		{
			let removed = remove( member.user_id );
			return { Type: type, Removed: removed, Line: removed ? ( type + ': ' + removed.Login + ' removed' ) : ( type + ': no such account' ) };
		}
		if ( type === 'organization.created' )
		{
			return { Type: type, Line: type + ': ' + JSON.stringify( data.name || data.id || '?' ) };
		}
		return { Type: type, Line: ( type || 'event' ) + ': ignored' };
	}


	return {
		On: On,
		FrontendApi: FrontendApi,
		Config: Config,
		Looks: Looks,
		Verify: Verify,
		Identify: Identify,
		Adopt: Adopt,
		LoginFrom: LoginFrom,
		VerifyWebhook: VerifyWebhook,
		Handle: Handle,
	};
}


module.exports = {
	Clerk: Clerk,
	LEEWAY: LEEWAY,
	WEBHOOK_WINDOW: WEBHOOK_WINDOW,
	BACKEND_API: BACKEND_API,
};
