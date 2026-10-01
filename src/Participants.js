'use strict';

// Participants - who is calling, from the settings and the request.
// A request carrying "Authorization: Bearer <token>" is the participant holding that token.
// A request without one is the participant with the owner role (the browser, on this workstation).
// A token lets any participant use the API: the llm participant is the one an agent session posts as.
// Identity is this one small component: user management with sign-in replaces it later.
// The settings (consensus.json) are checked here too: Host, Port, States and Participants (plan Consensus Desktop,
// Step 1: the settings modal writes them back through the API).

const CRYPTO = require( 'crypto' );

const ROLES = [ 'owner', 'llm', 'member' ];
const DEFAULT_STATES = [ 'Proposal', 'Plan', 'Working', 'Finished' ];
const DEFAULT_HOST = '127.0.0.1';
const SETTINGS_FIELDS = [ 'Port', 'Host', 'States', 'Participants' ];


//---------------------------------------------------------------------
// DefaultSettings: written at first start. Two participants, the user (owner) and the llm.

function DefaultSettings( Port, Host )
{
	return {
		Port: Port,
		Host: Host || DEFAULT_HOST,
		States: DEFAULT_STATES.slice(),
		Participants: [
			{ Name: 'user', Display: 'User', Role: 'owner' },
			{ Name: 'llm', Display: 'LLM', Role: 'llm' },
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
// Validate: the settings are usable: Host and Port when given, States, and the participant list.

function Validate( Settings )
{
	let problems = [];
	if ( !Settings || typeof Settings !== 'object' )
	{
		return [ 'the settings are not an object' ];
	}
	if ( Settings.Port !== undefined && !( Number.isInteger( Settings.Port ) && Settings.Port >= 0 && Settings.Port <= 65535 ) )
	{
		problems.push( 'Port must be a whole number from 0 to 65535' );
	}
	if ( Settings.Host !== undefined && ( typeof Settings.Host !== 'string' || !Settings.Host.trim() || /\s/.test( Settings.Host ) ) )
	{
		problems.push( 'Host must be an address with no spaces' );
	}
	let participants = Settings.Participants;
	if ( !Array.isArray( participants ) )
	{
		problems.push( 'Participants must be a list' );
		participants = [];
	}
	let names = new Set();
	let tokens = new Set();
	for ( let participant of participants )
	{
		if ( !participant || typeof participant !== 'object' )
		{
			problems.push( 'a participant is not an object' );
			continue;
		}
		if ( !participant.Name || typeof participant.Name !== 'string' )
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
		if ( participant.Token !== undefined && participant.Token !== null )
		{
			if ( typeof participant.Token !== 'string' || participant.Token.length < 16 )
			{
				problems.push( 'participant "' + participant.Name + '": a Token is a string of 16 characters or more' );
			}
			else if ( tokens.has( participant.Token ) )
			{
				problems.push( 'participant "' + participant.Name + '" shares its Token with another participant' );
			}
			tokens.add( participant.Token );
		}
	}
	if ( !participants.some( is_owner ) )
	{
		problems.push( 'no participant has the owner role' );
	}
	if ( Settings.States !== undefined )
	{
		let states = Settings.States;
		let usable = Array.isArray( states ) && states.length > 0 && states.every( function ( state ) { return typeof state === 'string' && state.trim() === state && state.length > 0; } );
		if ( !usable )
		{
			problems.push( 'States must be a list of one or more names' );
		}
		else if ( new Set( states ).size !== states.length )
		{
			problems.push( 'States names a state twice' );
		}
	}
	return problems;
}


//---------------------------------------------------------------------
// States: the names a Plan's state is picked from; the first is where a new Plan starts.

function States( Settings )
{
	if ( Settings && Array.isArray( Settings.States ) && Settings.States.length )
	{
		return Settings.States.slice();
	}
	return DEFAULT_STATES.slice();
}


//---------------------------------------------------------------------
// Clean: the settings as the modal sends them, kept to the known fields, each participant to its own: Name, Display,
// Role and Token (none when empty). The result is what Validate checks and what is written.

function Clean( Settings )
{
	let given = ( Settings && typeof Settings === 'object' ) ? Settings : {};
	let clean = {};
	for ( let field of SETTINGS_FIELDS )
	{
		if ( given[ field ] !== undefined )
		{
			clean[ field ] = given[ field ];
		}
	}
	if ( typeof clean.Host === 'string' )
	{
		clean.Host = clean.Host.trim();
	}
	if ( Array.isArray( clean.States ) )
	{
		clean.States = clean.States.map( function ( state ) { return ( typeof state === 'string' ) ? state.trim() : state; } );
	}
	if ( Array.isArray( clean.Participants ) )
	{
		clean.Participants = clean.Participants.map( function ( participant )
		{
			let one = ( participant && typeof participant === 'object' ) ? participant : {};
			let kept = { Name: ( typeof one.Name === 'string' ) ? one.Name.trim() : one.Name, Display: one.Display, Role: one.Role };
			if ( typeof kept.Display !== 'string' || !kept.Display.trim() )
			{
				delete kept.Display;
			}
			if ( typeof one.Token === 'string' && one.Token.trim() )
			{
				kept.Token = one.Token.trim();
			}
			return kept;
		} );
	}
	return clean;
}


module.exports = {
	ROLES: ROLES,
	DEFAULT_STATES: DEFAULT_STATES,
	DEFAULT_HOST: DEFAULT_HOST,
	SETTINGS_FIELDS: SETTINGS_FIELDS,
	DefaultSettings: DefaultSettings,
	NewToken: NewToken,
	Identify: Identify,
	Public: Public,
	PublicList: PublicList,
	Validate: Validate,
	States: States,
	Clean: Clean,
};
