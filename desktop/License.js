'use strict';

// License - the Desktop's tier (plan Rearchitecturation, Step 6), without Electron. The Desktop signs in through Clerk
// in its page; the session token's license claim, verified against the instance's keys as a server verifies it
// (src/Clerk.js), is written to desktop.json as License: { Plan, Until, Checked }. The Desktop is personal or
// professional while Checked is within CACHE_DAYS and Until has not passed, and free otherwise: when the cache lapses
// it falls back to free with a line in About, and nothing a person saved is ever locked away. Free needs no account.
//
//   TIERS                              [ 'free', 'personal', 'professional' ]: Roles.js's PLANS with free first
//   CACHE_DAYS                         14
//   Verify( Token, { Jwks?, Now? } )   the record { Plan, Until, Checked } from a session token, or null when the token
//                                      does not verify or carries no valid license (async)
//   Record( License, Now? )            the record from a license { Plan, Until } as the server reads it
//   Tier( License, Now? )              { Tier, Plan, Days, Until, Checked, Lapsed }: the tier the Desktop is at now; Days the
//                                      days the cache has left (null when free); Lapsed why it is free though a license
//                                      was cached ('checked' | 'until' | null)
//   Line( License, Now? )              the About line: "Personal, checked 3 days ago: 11 days left offline" and the rest
//   Rank( Tier )                       0 for free, then the plan's rank
//   AtLeast( License, Tier, Now? )     whether the Desktop is at that tier or above

const CLERK = require( '../src/Clerk.js' );
const ROLES = require( '../src/Roles.js' );

const CACHE_DAYS = 14;
const DAY = 24 * 60 * 60 * 1000;
const TIERS = [ 'free' ].concat( ROLES.PLANS );
const TITLES = { free: 'Free', personal: 'Personal', professional: 'Professional' };


function now_of( Now )
{
	return ( Now === undefined || Now === null ) ? Date.now() : ( ( Now instanceof Date ) ? Now.getTime() : Number( Now ) );
}


function Rank( Tier )
{
	let at = TIERS.indexOf( Tier );
	return ( at < 0 ) ? 0 : at;
}


function Record( License, Now )
{
	if ( !License || !ROLES.PlanRank( License.Plan ) )
	{
		return null;
	}
	return { Plan: License.Plan, Until: License.Until || null, Checked: new Date( now_of( Now ) ).toISOString() };
}


// The token verified as a server verifies it: the signature against the instance's keys, exp and nbf, the issuer;
// azp is not checked (the Desktop's page has no host to match). Options.Jwks stands in for the keys in tests.
async function Verify( Token, Options )
{
	let options = Options || {};
	let clerk = CLERK.Clerk( { Settings: options.Settings || {}, Users: null, Jwks: options.Jwks || null, Now: options.Now ? function () { return now_of( options.Now ); } : null } );
	let claims = await clerk.Verify( String( Token || '' ), null );
	if ( !claims )
	{
		return null;
	}
	return Record( clerk.License( claims ), options.Now );
}


function Tier( License, Now )
{
	let now = now_of( Now );
	let none = { Tier: 'free', Plan: null, Days: null, Until: null, Checked: null, Lapsed: null };
	if ( !License || typeof License !== 'object' || !ROLES.PlanRank( License.Plan ) )
	{
		return none;
	}
	let checked = Date.parse( String( License.Checked || '' ) );
	if ( !Number.isFinite( checked ) )
	{
		return none;
	}
	let left = CACHE_DAYS - ( now - checked ) / DAY;
	let base = { Plan: License.Plan, Until: License.Until || null, Checked: new Date( checked ).toISOString() };
	if ( left <= 0 )
	{
		return Object.assign( none, base, { Lapsed: 'checked' } );
	}
	if ( License.Until )
	{
		let until = Date.parse( String( License.Until ) );
		if ( !Number.isFinite( until ) || until <= now )
		{
			return Object.assign( none, base, { Lapsed: 'until' } );
		}
	}
	return Object.assign( {}, base, { Tier: License.Plan, Days: Math.ceil( left ), Lapsed: null } );
}


function AtLeast( License, Wanted, Now )
{
	return Rank( Tier( License, Now ).Tier ) >= Rank( Wanted );
}


function Line( License, Now )
{
	let tier = Tier( License, Now );
	if ( tier.Tier !== 'free' )
	{
		let ago = Math.floor( ( now_of( Now ) - Date.parse( tier.Checked ) ) / DAY );
		return TITLES[ tier.Tier ] + ', checked ' + ( ago === 0 ? 'today' : ( ago === 1 ? 'a day ago' : ago + ' days ago' ) ) + ': ' + tier.Days + ( tier.Days === 1 ? ' day' : ' days' ) + ' left offline' + ( tier.Until ? ', the license until ' + tier.Until.slice( 0, 10 ) : '' );
	}
	if ( tier.Lapsed === 'checked' )
	{
		return 'Free: the ' + TITLES[ tier.Plan ] + ' license last checked on ' + tier.Checked.slice( 0, 10 ) + ' is more than ' + CACHE_DAYS + ' days old; sign in again to renew it';
	}
	if ( tier.Lapsed === 'until' )
	{
		return 'Free: the ' + TITLES[ tier.Plan ] + ' license ran out on ' + String( tier.Until ).slice( 0, 10 );
	}
	return 'Free: no license; sign in with a Consensus-AI account that holds one';
}


module.exports = {
	TIERS: TIERS,
	TITLES: TITLES,
	CACHE_DAYS: CACHE_DAYS,
	Verify: Verify,
	Record: Record,
	Tier: Tier,
	Line: Line,
	Rank: Rank,
	AtLeast: AtLeast,
};
