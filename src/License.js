'use strict';

// License - the machine's current user and the tier it gives (plan The Server, Step 1; moved from desktop/License.js,
// plan Rearchitecturation, Step 6). One user is signed in on a machine at a time: the record lives in the config folder
// (~/.consensus/user.json by default), read and written by the Desktop and the Server alike. A sign-in's session
// token, verified against the instance's keys as a server verifies it (src/Clerk.js), writes the record whole,
// replacing whoever was there; Sign out removes it. The record is refreshed at each sign-in and at each check while
// online (the page hands its token over at every load); after CACHE_DAYS with no check the user is signed out.
//
//   user.json = { Email, Clerk, Display, Plan, Until, Checked }   Plan null: a sign-in with no license (Registered)
//
//   TIERS                              [ 'unlicensed', 'registered', 'personal', 'professional' ]
//   TITLES                             the tiers as the page says them
//   CACHE_DAYS                         14
//   FILE                               'user.json'
//   FilePath( Config )                 <config>/user.json
//   Read( Config )                     the record, or null when missing or unreadable
//   Write( Config, Record )            the file written whole (a temporary file renamed into place)
//   Remove( Config )                   the file removed; answers whether it was there
//   Verify( Token, { Settings?, Jwks?, Now? } )   the record from a session token, or null when it does not verify (async)
//   Clean( Record )                    the record's fields checked, or null when it is not a record
//   Lapsed( Record, Now? )             whether CACHE_DAYS have passed since the record's Checked (the user is signed out)
//   Tier( Record, Now? )               { Tier, Rank, Plan, Email, Display, Days, Until, Checked, Lapsed }: the tier now;
//                                      Days the days the check has left (null when unlicensed); Lapsed why the tier is
//                                      below the record's plan ('checked' | 'until' | null)
//   Line( Record, Now? )               the About line: "Personal, checked 3 days ago: 11 days left offline" and the rest
//   Rank( Tier )                       0 for unlicensed up to 3 for professional
//   AtLeast( Record, Tier, Now? )      whether the record gives that tier or above
//   Authority( Record, AdminEmail, Now? )  whether the Server may start under the current user (plan The Server, Step 2):
//                                      { Ok, Tier, Public, Claim, Administrator, Reason }. The Server runs under its
//                                      Administrator: with no AdminEmail yet, a Personal or Professional user may start
//                                      it and becomes the Administrator (Claim: the email to record); with one, only that
//                                      user, at their tier; Public whether the tier allows public addresses (Professional)

const FS = require( 'fs' );
const PATH = require( 'path' );
const CLERK = require( './Clerk.js' );
const ROLES = require( './Roles.js' );

const CACHE_DAYS = 14;
const DAY = 24 * 60 * 60 * 1000;
const FILE = 'user.json';
const TIERS = [ 'unlicensed', 'registered' ].concat( ROLES.PLANS );
const TITLES = { unlicensed: 'Unlicensed', registered: 'Registered', personal: 'Personal', professional: 'Professional' };


//---------------------------------------------------------------------
// Helpers

function now_of( Now )
{
	if ( Now === undefined || Now === null )
	{
		return Date.now();
	}
	if ( Now instanceof Date )
	{
		return Now.getTime();
	}
	return Number( Now );
}


function text_or_null( value )
{
	if ( typeof value !== 'string' )
	{
		return null;
	}
	let trimmed = value.trim();
	return trimmed ? trimmed : null;
}


function days_ago( Checked, Now )
{
	return Math.floor( ( now_of( Now ) - Date.parse( Checked ) ) / DAY );
}


//---------------------------------------------------------------------
// The file

function FilePath( Config )
{
	return PATH.join( Config, FILE );
}


function Clean( Record )
{
	if ( !Record || typeof Record !== 'object' || Array.isArray( Record ) )
	{
		return null;
	}
	let clerk_id = text_or_null( Record.Clerk );
	let checked = text_or_null( Record.Checked );
	if ( !clerk_id || !checked || !Number.isFinite( Date.parse( checked ) ) )
	{
		return null;
	}
	let plan = ROLES.PlanRank( Record.Plan ) ? Record.Plan : null;
	return {
		Email: text_or_null( Record.Email ),
		Clerk: clerk_id,
		Display: text_or_null( Record.Display ),
		Plan: plan,
		Until: plan ? text_or_null( Record.Until ) : null,
		Checked: checked,
	};
}


function Read( Config )
{
	let parsed = null;
	try
	{
		parsed = JSON.parse( FS.readFileSync( FilePath( Config ), 'utf8' ) );
	}
	catch ( error )
	{
		return null;
	}
	return Clean( parsed );
}


function Write( Config, Record )
{
	let record = Clean( Record );
	if ( !record )
	{
		throw new Error( 'not a user record' );
	}
	FS.mkdirSync( Config, { recursive: true } );
	let path = FilePath( Config );
	let temporary = path + '.' + process.pid + '.tmp';
	FS.writeFileSync( temporary, JSON.stringify( record, null, '\t' ) + '\n' );
	FS.renameSync( temporary, path );
	return record;
}


function Remove( Config )
{
	try
	{
		FS.unlinkSync( FilePath( Config ) );
		return true;
	}
	catch ( error )
	{
		return false;
	}
}


//---------------------------------------------------------------------
// The sign-in

function FromClaims( Claims, License, Now )
{
	if ( !Claims || typeof Claims.sub !== 'string' || !Claims.sub )
	{
		return null;
	}
	let names = [ text_or_null( Claims.first ), text_or_null( Claims.last ) ].filter( Boolean ).join( ' ' );
	let email = text_or_null( Claims.email );
	let display = names || text_or_null( Claims.username ) || email;
	let licensed = License && ROLES.PlanRank( License.Plan );
	return Clean( {
		Email: email,
		Clerk: Claims.sub,
		Display: display,
		Plan: licensed ? License.Plan : null,
		Until: licensed ? ( License.Until || null ) : null,
		Checked: new Date( now_of( Now ) ).toISOString(),
	} );
}


// The token verified as a server verifies it: the signature against the instance's keys, exp and nbf, the issuer;
// azp is not checked (the Desktop's page has no host to match). Options.Jwks stands in for the keys in tests.
async function Verify( Token, Options )
{
	let options = Options || {};
	let clock = null;
	if ( options.Now )
	{
		clock = function () { return now_of( options.Now ); };
	}
	let clerk = CLERK.Clerk( { Settings: options.Settings || {}, Users: null, Jwks: options.Jwks || null, Now: clock } );
	let claims = await clerk.Verify( String( Token || '' ), null );
	if ( !claims )
	{
		return null;
	}
	return FromClaims( claims, clerk.License( claims ), options.Now );
}


//---------------------------------------------------------------------
// The tier

function Rank( Tier )
{
	let at = TIERS.indexOf( Tier );
	return ( at < 0 ) ? 0 : at;
}


function Lapsed( Record, Now )
{
	let record = Clean( Record );
	if ( !record )
	{
		return false;
	}
	return ( now_of( Now ) - Date.parse( record.Checked ) ) >= CACHE_DAYS * DAY;
}


function Tier( Record, Now )
{
	let now = now_of( Now );
	let record = Clean( Record );
	let answer = { Tier: 'unlicensed', Rank: 0, Plan: null, Email: null, Display: null, Days: null, Until: null, Checked: null, Lapsed: null };
	if ( !record )
	{
		return answer;
	}
	answer.Plan = record.Plan;
	answer.Until = record.Until;
	answer.Checked = record.Checked;
	if ( Lapsed( record, now ) )
	{
		answer.Lapsed = 'checked';
		return answer;
	}
	answer.Email = record.Email;
	answer.Display = record.Display;
	answer.Days = Math.ceil( CACHE_DAYS - ( now - Date.parse( record.Checked ) ) / DAY );
	answer.Tier = 'registered';
	if ( record.Plan )
	{
		let until = record.Until ? Date.parse( record.Until ) : null;
		if ( record.Until && ( !Number.isFinite( until ) || until <= now ) )
		{
			answer.Lapsed = 'until';
		}
		else
		{
			answer.Tier = record.Plan;
		}
	}
	answer.Rank = Rank( answer.Tier );
	return answer;
}


function AtLeast( Record, Wanted, Now )
{
	return Tier( Record, Now ).Rank >= Rank( Wanted );
}


function Line( Record, Now )
{
	let tier = Tier( Record, Now );
	if ( tier.Lapsed === 'checked' )
	{
		return 'Unlicensed: the sign-in last checked on ' + tier.Checked.slice( 0, 10 ) + ' is more than ' + CACHE_DAYS + ' days old; sign in again';
	}
	if ( tier.Tier === 'unlicensed' )
	{
		return 'Unlicensed: not signed in; sign in with a Consensus-AI account';
	}
	let who = tier.Email || tier.Display;
	let ago = days_ago( tier.Checked, Now );
	let checked = 'checked ' + ( ago === 0 ? 'today' : ( ago === 1 ? 'a day ago' : ago + ' days ago' ) );
	let left = tier.Days + ( tier.Days === 1 ? ' day' : ' days' ) + ' left offline';
	let prefix = TITLES[ tier.Tier ] + ( who ? ' (' + who + ')' : '' );
	if ( tier.Lapsed === 'until' )
	{
		return prefix + ': the ' + TITLES[ tier.Plan ] + ' license ran out on ' + String( tier.Until ).slice( 0, 10 );
	}
	if ( tier.Tier === 'registered' )
	{
		return prefix + ': signed in with no license, ' + checked;
	}
	return prefix + ', ' + checked + ': ' + left + ( tier.Until ? ', the license until ' + tier.Until.slice( 0, 10 ) : '' );
}


//---------------------------------------------------------------------
// The Server's authority (plan The Server, Step 2)

function Authority( Record, AdminEmail, Now )
{
	let tier = Tier( Record, Now );
	let admin_email = text_or_null( AdminEmail );
	let answer = { Ok: false, Tier: tier.Tier, Public: false, Claim: null, Administrator: admin_email, Reason: null };
	let licensed = tier.Rank >= Rank( 'personal' );
	if ( !admin_email )
	{
		if ( !licensed )
		{
			answer.Reason = 'the Server needs a Personal or Professional sign-in; the first one becomes its Administrator';
			return answer;
		}
		if ( !tier.Email )
		{
			answer.Reason = 'the sign-in carries no email address, which the Administrator is matched by';
			return answer;
		}
		answer.Ok = true;
		answer.Claim = tier.Email;
		answer.Public = tier.Rank >= Rank( 'professional' );
		return answer;
	}
	if ( !tier.Email || tier.Email.toLowerCase() !== admin_email.toLowerCase() )
	{
		answer.Reason = 'the Server runs under its Administrator: sign in as ' + admin_email;
		return answer;
	}
	if ( !licensed )
	{
		answer.Reason = 'the Administrator\'s sign-in is ' + TITLES[ tier.Tier ] + ': the Server needs Personal or Professional';
		return answer;
	}
	answer.Ok = true;
	answer.Public = tier.Rank >= Rank( 'professional' );
	return answer;
}


//---------------------------------------------------------------------
// SameUser: whether two records are the same person at the same plan (a sign-in checked again changes nothing but
// Checked). Null-safe: a first sign-in, with no record before it, is never the same (plan Review 2026-10-29, Step 1).

function SameUser( A, B )
{
	let a = Clean( A );
	let b = Clean( B );
	if ( !a || !b )
	{
		return false;
	}
	return a.Clerk === b.Clerk && a.Plan === b.Plan;
}


module.exports = {
	Authority: Authority,
	SameUser: SameUser,
	TIERS: TIERS,
	TITLES: TITLES,
	CACHE_DAYS: CACHE_DAYS,
	FILE: FILE,
	FilePath: FilePath,
	Read: Read,
	Write: Write,
	Remove: Remove,
	Verify: Verify,
	Clean: Clean,
	Lapsed: Lapsed,
	Tier: Tier,
	Line: Line,
	Rank: Rank,
	AtLeast: AtLeast,
};
