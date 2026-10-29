'use strict';

// CurrentUser - the machine's current user as an application sees it (plan The Server, Step 1; one module since plan
// Review 2026-10-29, Step 2, in place of the copies in desktop/main.js and server/main.js): <config>/user.json
// (src/License.js), shared by the Desktop and the Server and read at each use, since another window or application may
// sign someone in; a record not checked for CACHE_DAYS is removed and the user signed out.
//
//   Make( ConfigFolder )               the functions over a config folder, given as a path or a function answering one
//     Read()                           the record, or null (a lapsed one removed and logged)
//     Tier()                           { Tier, Rank, Plan, Email, Display, Days, Until, Checked, Lapsed, Line }: the tier now
//     SetLicense( Token, Settings )    a sign-in's session token verified against Clerk (Settings the server's, for its
//                                      keys) and written whole as the current user; answers { Tier, Record, Before } or
//                                      { Tier, Error } with the user unchanged
//     Clear()                          the current user removed; the tier then

const LICENSE = require( '../src/License.js' );


function Make( ConfigFolder )
{
	function folder()
	{
		return ( typeof ConfigFolder === 'function' ) ? ConfigFolder() : ConfigFolder;
	}


	function Read()
	{
		let record = LICENSE.Read( folder() );
		if ( record && LICENSE.Lapsed( record ) )
		{
			LICENSE.Remove( folder() );
			console.log( 'signed out: ' + ( record.Email || record.Display || 'the current user' ) + ', not checked for ' + LICENSE.CACHE_DAYS + ' days' );
			return null;
		}
		return record;
	}


	function Tier()
	{
		let record = Read();
		let tier = LICENSE.Tier( record );
		return { Tier: tier.Tier, Rank: tier.Rank, Plan: tier.Plan, Email: tier.Email, Display: tier.Display, Days: tier.Days, Until: tier.Until, Checked: tier.Checked, Lapsed: tier.Lapsed, Line: LICENSE.Line( record ) };
	}


	async function SetLicense( Token, Settings )
	{
		let record = null;
		try
		{
			record = await LICENSE.Verify( String( Token || '' ), { Settings: Settings || {} } );
		}
		catch ( error )
		{
			return { Tier: Tier(), Error: 'the sign-in could not be verified: ' + error.message };
		}
		if ( !record )
		{
			return { Tier: Tier(), Error: 'the sign-in could not be verified' };
		}
		let before = LICENSE.Read( folder() );
		LICENSE.Write( folder(), record );
		console.log( 'signed in: ' + LICENSE.Line( record ) );
		return { Tier: Tier(), Record: record, Before: before };
	}


	function Clear()
	{
		LICENSE.Remove( folder() );
		console.log( 'signed out' );
		return Tier();
	}


	return { Read: Read, Tier: Tier, SetLicense: SetLicense, Clear: Clear };
}


module.exports = {
	Make: Make,
};
