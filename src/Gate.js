'use strict';

// Gate - whether the Server serves (plan The Server, Step 3). The Server runs under the authority of its
// Administrator: until a Personal or Professional sign-in stands behind it, the API answers nothing but the sign-in
// (Api.js asks State before every request, and Check again after a Clerk session while closed). Where the
// authority comes from:
//   - the machine's current user (<config>/user.json, src/License.js), when that user is the Administrator, or when
//     there is no Administrator yet and the user is licensed (the user is then recorded as it: Claim);
//   - for a headless Server (Mode 'headless': the Docker image, npm start, consensus serve), which may have no
//     current user, also the Administrator's account in Users.json, the license their last sign-in showed; with no
//     Administrator yet, on a Local server, the owner's record (a sign-in on Local is the owner's).
// A Public Scope needs Professional. CONSENSUS_ADMIN, when set, is already the Administrator (Server.js), so only
// that email opens the gate.
//
//   Gate( { Config, Settings, Users, Store, Scope, Mode: 'window' | 'headless', Events? } ) -> {
//     Check() -> state (async): the gate worked out again, the Administrator recorded when it is claimed,
//     State() -> state: as last checked,
//     Open() -> whether it is open }
//   state = { Open, Tier, Public, Administrator, Reason }

const LICENSE = require( './License.js' );
const ROLES = require( './Roles.js' );

const MODES = [ 'window', 'headless' ];


function Gate( Options )
{
	let options = Options || {};
	let settings = options.Settings || {};
	let users = options.Users || null;
	let store = options.Store || null;
	let events = options.Events || null;
	let scope = options.Scope || 'Local';
	let mode = MODES.includes( options.Mode ) ? options.Mode : 'headless';
	let state = { Open: false, Tier: null, Public: false, Administrator: null, Reason: 'not checked yet' };


	function admin_email()
	{
		let clerk = ( settings.Clerk && typeof settings.Clerk === 'object' ) ? settings.Clerk : {};
		return ( typeof clerk.AdminEmail === 'string' && clerk.AdminEmail.trim() ) ? clerk.AdminEmail.trim() : null;
	}


	// The Administrator's record in the registry, by email; with none named, the owner's on a Local server.
	function admin_record( email )
	{
		if ( !users )
		{
			return null;
		}
		let list = users.List();
		if ( email )
		{
			let wanted = email.toLowerCase();
			return list.find( function ( one ) { return !!one.Email && one.Email.toLowerCase() === wanted; } ) || null;
		}
		if ( scope !== 'Public' )
		{
			return list.find( function ( one ) { return one.Type === 'owner'; } ) || null;
		}
		return null;
	}


	function waiting_reason( email )
	{
		let license = ( scope === 'Public' ) ? 'a Professional license' : 'a Personal or Professional license';
		if ( email )
		{
			return 'the Server waits for its Administrator, ' + email + ', to sign in with ' + license;
		}
		return 'the Server waits for its first sign-in: ' + license + ' makes the Administrator';
	}


	async function Check()
	{
		let email = admin_email();
		let current = options.Config ? LICENSE.Read( options.Config ) : null;
		let authority = LICENSE.Authority( current, email );
		let tier = null;
		let claim = null;
		if ( authority.Ok )
		{
			tier = authority.Tier;
			claim = authority.Claim;
		}
		else if ( mode === 'headless' )
		{
			let record = admin_record( email );
			if ( record && ROLES.PlanRank( record.Plan ) >= ROLES.PlanRank( 'personal' ) )
			{
				tier = record.Plan;
				claim = ( !email && record.Email ) ? record.Email : null;
			}
		}
		let reason = null;
		if ( tier && scope === 'Public' && tier !== 'professional' )
		{
			reason = 'a Public Server needs the Administrator\'s Professional license' + ( email ? ': ' + email + ' signs in with one' : '' );
			tier = null;
			claim = null;
		}
		if ( !tier && !reason )
		{
			reason = ( mode === 'window' && !authority.Ok ) ? authority.Reason : waiting_reason( email );
		}
		if ( tier && claim && store )
		{
			settings.Clerk = Object.assign( {}, settings.Clerk || {}, { AdminEmail: claim } );
			await store.WriteSettings( settings );
			console.log( 'the Administrator is ' + claim + ': the first sign-in with a Personal or Professional license' );
			if ( events )
			{
				events.Send( { Settings: true, Kind: 'settings' } );
			}
			email = claim;
		}
		let was_open = state.Open;
		state = { Open: !!tier, Tier: tier, Public: tier === 'professional', Administrator: email, Reason: tier ? null : reason };
		if ( state.Open !== was_open )
		{
			console.log( state.Open ? ( 'the Server is open: the Administrator ' + ( email || '' ) + ' at ' + LICENSE.TITLES[ tier ] ) : ( 'the Server is closed: ' + state.Reason ) );
		}
		return state;
	}


	function State()
	{
		return state;
	}


	function Open()
	{
		return state.Open;
	}


	return {
		Check: Check,
		State: State,
		Open: Open,
	};
}


module.exports = {
	Gate: Gate,
	MODES: MODES,
};
