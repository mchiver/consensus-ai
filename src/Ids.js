'use strict';

// Ids - global ids: `<kind>-xxx-xxx-xxx`, three lowercase letters for the kind, then groups of three base36
// characters from the crypto random source (the plan Global Ids). Only what Project Import and Export needs so
// far: a revision's id.

const CRYPTO = require( 'crypto' );

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
const GROUP_LENGTH = 3;
const GROUPS = 3;
const REVISION = 'rev';


//---------------------------------------------------------------------
// New: a new id of Kind.

function New( Kind )
{
	let groups = [];
	for ( let group = 0; group < GROUPS; group++ )
	{
		let characters = '';
		for ( let index = 0; index < GROUP_LENGTH; index++ )
		{
			characters += DIGITS[ CRYPTO.randomInt( DIGITS.length ) ];
		}
		groups.push( characters );
	}
	return Kind + '-' + groups.join( '-' );
}


//---------------------------------------------------------------------

module.exports = {
	REVISION: REVISION,
	New: New,
};
