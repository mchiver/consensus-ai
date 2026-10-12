'use strict';

// Participants - who is calling, from the settings and the request.
// A request carrying "Authorization: Bearer <token>" is the participant holding that token.
// A request without one is the participant with the owner role (the browser, on this workstation).
// A token lets any participant use the API: the llm participant is the one an agent session posts as.
// Identity is this one small component: user management with sign-in replaces it later.
// The settings (consensus.json) are checked here too: Name, Port, Scope, States and Participants (plan Consensus
// Desktop, Step 1: the settings modal writes them back through the API). Plan Run Shapes, Step 1: Scope (None, Local,
// Public) says whether the server listens and for whom, in place of Host; Name is the server's; a file from before
// is brought up to date by Migrate.

const CRYPTO = require( 'crypto' );
const OS = require( 'os' );

const ROLES = [ 'owner', 'llm', 'member' ];
const DEFAULT_STATES = [ 'Draft', 'Plan', 'Working', 'Finished' ];
const RENAMED_STATE = { From: 'Proposal', To: 'Draft' };	// plan UI Tweaks V: the first state's new name, migrated at start
const SCOPES = [ 'None', 'Local', 'Public' ];
const DEFAULT_SCOPE = 'Local';
const SCOPE_HOSTS = { None: null, Local: '127.0.0.1', Public: '0.0.0.0' };
const LOCAL_HOSTS = [ '127.0.0.1', 'localhost', '::1' ];
const SETTINGS_FIELDS = [ 'Name', 'Port', 'Scope', 'States', 'Participants' ];
const RETIRED_FIELDS = [ 'Corpus', 'Context', 'Workers' ];	// from before plan Consensus Desktop, Step 1


//---------------------------------------------------------------------
// DefaultSettings: written at first start. Two participants, the user (owner) and the llm.

function DefaultSettings( Port, Scope )
{
	return {
		Name: OS.hostname(),
		Port: Port,
		Scope: SCOPES.includes( Scope ) ? Scope : DEFAULT_SCOPE,
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
// Scope: the settings' Scope, Local when the file has none. HostOf: the address a Scope listens on, null for None.

function Scope( Settings )
{
	return ( Settings && SCOPES.includes( Settings.Scope ) ) ? Settings.Scope : DEFAULT_SCOPE;
}


function HostOf( Scope_ )
{
	return SCOPES.includes( Scope_ ) ? SCOPE_HOSTS[ Scope_ ] : SCOPE_HOSTS[ DEFAULT_SCOPE ];
}


//---------------------------------------------------------------------
// Migrate: a settings file from before plan Run Shapes, changed in place: Host becomes Scope (a local address Local,
// any other Public), a missing Scope is Local, a missing Name is the machine's. Returns a line for each change.

function Migrate( Settings )
{
	let lines = [];
	if ( Settings.Host !== undefined )
	{
		let host = String( Settings.Host || '' ).trim();
		Settings.Scope = ( !host || LOCAL_HOSTS.includes( host ) ) ? 'Local' : 'Public';
		delete Settings.Host;
		lines.push( 'Host ' + JSON.stringify( host ) + ' became Scope ' + Settings.Scope );
	}
	if ( !SCOPES.includes( Settings.Scope ) )
	{
		Settings.Scope = DEFAULT_SCOPE;
		lines.push( 'Scope set to ' + DEFAULT_SCOPE );
	}
	if ( typeof Settings.Name !== 'string' || !Settings.Name.trim() )
	{
		Settings.Name = OS.hostname();
		lines.push( 'Name set to ' + Settings.Name );
	}
	for ( let field of RETIRED_FIELDS )
	{
		if ( Settings[ field ] !== undefined )
		{
			delete Settings[ field ];
			lines.push( field + ' dropped' );
		}
	}
	return lines;
}


//---------------------------------------------------------------------
// Validate: the settings are usable: Name, Scope and Port when given, States, and the participant list.

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
	if ( Settings.Scope !== undefined && !SCOPES.includes( Settings.Scope ) )
	{
		problems.push( 'Scope must be one of ' + SCOPES.join( ', ' ) );
	}
	if ( Settings.Name !== undefined && ( typeof Settings.Name !== 'string' || !Settings.Name.trim() ) )
	{
		problems.push( 'Name must be a name' );
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
	if ( typeof clean.Name === 'string' )
	{
		clean.Name = clean.Name.trim();
	}
	if ( typeof clean.Scope === 'string' )
	{
		clean.Scope = clean.Scope.trim();
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
	RENAMED_STATE: RENAMED_STATE,
	SCOPES: SCOPES,
	DEFAULT_SCOPE: DEFAULT_SCOPE,
	SETTINGS_FIELDS: SETTINGS_FIELDS,
	DefaultSettings: DefaultSettings,
	Scope: Scope,
	HostOf: HostOf,
	Migrate: Migrate,
	NewToken: NewToken,
	Identify: Identify,
	Public: Public,
	PublicList: PublicList,
	Validate: Validate,
	States: States,
	Clean: Clean,
};
