'use strict';

// Participants - who is calling, from the settings and the request.
// A request carrying "Authorization: Bearer <token>" is the participant holding that token.
// A request without one is the participant with the owner role (the browser, on this workstation).
// The llm participant needs no token: Consensus calls it (see Llm.js). A token lets any participant use the API.
// Identity is this one small component: user management with sign-in replaces it later.

const CRYPTO = require( 'crypto' );
const LLM = require( './Llm.js' );

const ROLES = [ 'owner', 'llm', 'member' ];


//---------------------------------------------------------------------
// DefaultSettings: written at first start. Two participants, the user (owner) and the llm, called through Claude Code.

function DefaultSettings( Port )
{
	return {
		Port: Port,
		Participants: [
			{ Name: 'user', Display: 'User', Role: 'owner' },
			{ Name: 'llm', Display: 'LLM', Role: 'llm', Call: { Kind: 'claude-cli', Command: 'claude' } },
		],
	};
}


function NewToken()
{
	return CRYPTO.randomBytes( 24 ).toString( 'hex' );
}


//---------------------------------------------------------------------
// Identify: the participant behind an Authorization header value, or null when the token is unknown.

function Identify( Settings, Authorization )
{
	let participants = ( Settings && Settings.Participants ) || [];
	let header = ( Authorization || '' ).trim();
	if ( !header )
	{
		return participants.find( is_owner ) || null;
	}
	let match = /^Bearer\s+(.+)$/i.exec( header );
	if ( !match )
	{
		return null;
	}
	let token = match[ 1 ].trim();
	return participants.find( function ( participant ) { return participant.Token && participant.Token === token; } ) || null;
}


function is_owner( participant )
{
	return participant.Role === 'owner';
}


//---------------------------------------------------------------------
// Public: a participant as others see it, without the token.

function Public( Participant )
{
	if ( !Participant )
	{
		return null;
	}
	return { Name: Participant.Name, Display: Participant.Display || Participant.Name, Role: Participant.Role };
}


function PublicList( Settings )
{
	return ( ( Settings && Settings.Participants ) || [] ).map( Public );
}


//---------------------------------------------------------------------
// Validate: the settings' participant list is usable.

function Validate( Settings )
{
	let problems = [];
	let participants = ( Settings && Settings.Participants ) || [];
	let names = new Set();
	for ( let participant of participants )
	{
		if ( !participant.Name )
		{
			problems.push( 'a participant has no Name' );
			continue;
		}
		if ( names.has( participant.Name ) )
		{
			problems.push( 'participant name "' + participant.Name + '" is used twice' );
		}
		names.add( participant.Name );
		if ( !ROLES.includes( participant.Role ) )
		{
			problems.push( 'participant "' + participant.Name + '" has role "' + participant.Role + '", not one of ' + ROLES.join( ', ' ) );
		}
		if ( participant.Call )
		{
			if ( participant.Role !== 'llm' )
			{
				problems.push( 'participant "' + participant.Name + '" has a Call but is not an llm' );
			}
			for ( let problem of LLM.Validate( participant.Call ) )
			{
				problems.push( 'participant "' + participant.Name + '": ' + problem );
			}
		}
	}
	if ( !participants.some( is_owner ) )
	{
		problems.push( 'no participant has the owner role' );
	}
	if ( participants.filter( function ( participant ) { return !!participant.Call; } ).length > 1 )
	{
		problems.push( 'only one participant can have a Call' );
	}
	return problems;
}


module.exports = {
	ROLES: ROLES,
	DefaultSettings: DefaultSettings,
	NewToken: NewToken,
	Identify: Identify,
	Public: Public,
	PublicList: PublicList,
	Validate: Validate,
};
