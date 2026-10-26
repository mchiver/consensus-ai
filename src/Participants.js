'use strict';

// Participants - who is calling, from the settings and the request (plan User Management, Step 2).
// An account is the principal. A bare request is the owner account (until plan Clerk brings the session): the
// browser, an agent session, a script, each saying who it is with the header "X-Consensus-Service: <name>" (letters,
// digits, dot, dash and colon), or saying nothing. A run started by the server carries "Authorization: Bearer <run
// token>", a token the server made for that run and keeps in memory (RunTokens): the request is the presser (Step 3:
// the account on the token, the owner before) with the connection's name as its Service. A user token (Step 3), one
// minted on an account's page and kept hashed in Users.json, is that account, the token's name as its Token. Any
// other token is refused.
// A record of what a request did carries three fields: By (the account), Service and Token (the token's name); the
// speaker the rules run over is the byline, "<Service> by <By>", or By alone (Speaker, SpeakerOf); the page shows
// "<Service> by <Display>" (Byline). A plan's speakers are the owner, one per LLM connection, the Owners of the plan's
// project and everyone seen in its threads (Speakers, SeenSpeakers), so the waiting rule keeps working with no
// participants list; each is { Name, Display, Role: 'owner' | 'user' | 'llm', Owner? } (plan Multiuser: Owner marks
// the server's owner and the project's Owners; a byline with a service in it is an llm speaker, a bare name a person's
// or a Service account's own).
// The settings (consensus.json) are checked here too: Name, Port, Scope, States, Owner ({ Name, Display }),
// and the optional Clerk section (Step 1: PublishableKey, WebhookSecret, AdminEmail; SecretKey gone since plan The
// Server, Step 2: an old file's is dropped by Clean);
// the Tasks list (plan LLM Tasks, Step 1) is checked and cleaned by Tasks.js through the same calls, and a
// run token carries its task's Writes, which Identify hands on as the account's Writes (null for any other request).
// Scope (None, Local, Public) says whether the server listens and for whom; Trust says what a Scope comes to: local,
// clerk (Public: people sign in through Clerk with a license, plan Clerk Step 5; a bare request is refused), or none.
// An account carries its Plan (User or Host, plan Clerk Step 5), the license its last sign-in showed.

const CRYPTO = require( 'crypto' );
const OS = require( 'os' );
const TASKS = require( './Tasks.js' );

const DEFAULT_STATES = [ 'Draft', 'Plan', 'Working', 'Finished' ];
const SCOPES = [ 'None', 'Local', 'Public' ];
const DEFAULT_SCOPE = 'Local';
const SCOPE_HOSTS = { None: null, Local: '127.0.0.1', Public: '0.0.0.0' };
const SETTINGS_FIELDS = [ 'Name', 'Port', 'Scope', 'States', 'Owner', 'Clerk', 'Tasks' ];
const DEFAULT_OWNER = { Name: 'user', Display: 'User' };
const SERVICE_HEADER = 'X-Consensus-Service';
const SERVICE_PATTERN = /^[A-Za-z0-9.:-]{1,40}$/;
const CLERK_FIELDS = [ 'PublishableKey', 'WebhookSecret', 'AdminEmail' ];
const CLERK_PREFIXES = { PublishableKey: 'pk_', WebhookSecret: 'whsec_' };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;


//---------------------------------------------------------------------
// DefaultSettings: written at first start. The owner is "user", shown as "User".

function DefaultSettings( Port, Scope )
{
	return {
		Name: OS.hostname(),
		Port: Port,
		Scope: SCOPES.includes( Scope ) ? Scope : DEFAULT_SCOPE,
		States: DEFAULT_STATES.slice(),
		Owner: { Name: DEFAULT_OWNER.Name, Display: DEFAULT_OWNER.Display },
	};
}


function NewToken()
{
	return CRYPTO.randomBytes( 24 ).toString( 'hex' );
}


// Owner( Settings ): the owner account's { Name, Display }, the defaults when the file has none.
function Owner( Settings )
{
	let owner = ( Settings && Settings.Owner && typeof Settings.Owner === 'object' ) ? Settings.Owner : {};
	let name = ( typeof owner.Name === 'string' && owner.Name.trim() ) ? owner.Name.trim() : DEFAULT_OWNER.Name;
	let display = ( typeof owner.Display === 'string' && owner.Display.trim() ) ? owner.Display.trim() : ( ( name === DEFAULT_OWNER.Name ) ? DEFAULT_OWNER.Display : name );
	return { Name: name, Display: display };
}


//---------------------------------------------------------------------
// The service header: a name the program declares for itself, or null when none or unusable.

function ServiceOf( Header )
{
	let value = ( typeof Header === 'string' ) ? Header.trim() : '';
	return SERVICE_PATTERN.test( value ) ? value : null;
}


//---------------------------------------------------------------------
// RunTokens: the tokens the server makes for its runs, in memory, each { Service, Name, Project, Run }.
//   Mint( { Service, Name, Project, Run?, Writes?, Account?, Role? } ) -> the token's value;  Find( value ) -> the record or null;  Drop( value )
//   Account (Step 3): the presser's account fields { Id, Name, Display, Role, Type, Admin }; Role the presser's role in the project.

function RunTokens()
{
	let tokens = {};

	function Mint( Fields )
	{
		let value = NewToken();
		tokens[ value ] = { Service: Fields.Service || null, Name: Fields.Name || 'run', Project: Fields.Project || null, Run: Fields.Run || null, Writes: Fields.Writes || null, Account: Fields.Account || null, Role: Fields.Role || null };
		return value;
	}

	function Find( Value )
	{
		return ( Value && tokens[ Value ] ) ? tokens[ Value ] : null;
	}

	function Drop( Value )
	{
		delete tokens[ Value ];
	}

	function Count()
	{
		return Object.keys( tokens ).length;
	}

	return { Mint: Mint, Find: Find, Drop: Drop, Count: Count };
}


//---------------------------------------------------------------------
// Identify: the account behind a request, or null when its token is unknown.
//   Headers = { Authorization, Service }: the two headers' values.  Tokens: the server's RunTokens, or null.
//   Users (Step 3): the registry (Users.js), or null.
//   account = { Id, Name, Display, Role, Type, Admin, Service, Token, Writes, Speaker, ProjectRole? }: Role and Type
//   owner, user or service (Role 'owner' passes every check); Admin whether the account is the Administrator; Service
//   the header's name or the run's connection; Token the run token's name ("Answer run") or the user token's; Writes
//   the run's level (none, consensus or files; null off a run); Speaker the key the rules run over; ProjectRole the
//   presser's role carried by a run token.

function Identify( Settings, Headers, Tokens, Users )
{
	let headers = ( Headers && typeof Headers === 'object' ) ? Headers : { Authorization: Headers };
	let authorization = ( headers.Authorization || '' ).trim();
	let owner = Owner( Settings );
	if ( !authorization )
	{
		return account_of( owner, ServiceOf( headers.Service ), null, null, Users );
	}
	let match = /^Bearer\s+(.+)$/i.exec( authorization );
	if ( !match )
	{
		return null;
	}
	let value = match[ 1 ].trim();
	let run = Tokens ? Tokens.Find( value ) : null;
	if ( run )
	{
		if ( run.Account )
		{
			return from_run( run );
		}
		return account_of( owner, run.Service, run.Name, run.Writes, Users );
	}
	let found = Users ? Users.ByToken( value ) : null;
	if ( !found )
	{
		return null;
	}
	Users.Touch( found.Record.Id, found.Token.Name );
	return user_account( Settings, Users, found.Record, ServiceOf( headers.Service ), found.Token.Name );
}


function account_of( owner, service, token, writes, users )
{
	let record = users ? users.List().find( function ( one ) { return one.Type === 'owner'; } ) : null;
	let account = { Id: record ? record.Id : null, Name: owner.Name, Display: owner.Display, Role: 'owner', Type: 'owner', Admin: true, Service: service || null, Token: token || null, Writes: writes || null, Plan: record ? ( record.Plan || null ) : null };
	account.Speaker = Speaker( account.Name, account.Service );
	return account;
}


// A user or Service account on its own token (Step 3), or a user on a Clerk session (Step 4: Clerk.js finds the
// record, the API builds the account; token null).
function user_account( settings, users, record, service, token )
{
	let account = { Id: record.Id, Name: record.Login, Display: record.Display, Role: record.Type, Type: record.Type, Admin: users.IsAdmin( settings, record ), Manager: users.IsManager( settings, record ), Service: service || null, Token: token || null, Writes: null, Plan: record.Plan || null };
	account.Speaker = Speaker( account.Name, account.Service );
	return account;
}


// The presser behind a run token that carries the account (Step 3).
function from_run( run )
{
	let account = Object.assign( {}, run.Account, { Service: run.Service || null, Token: run.Name || null, Writes: run.Writes || null, ProjectRole: run.Role || null } );
	account.Speaker = Speaker( account.Name, account.Service );
	return account;
}


// Public: an account as the API shows it; the empty fields left out.
function Public( Account )
{
	if ( !Account )
	{
		return null;
	}
	let shown = { Name: Account.Name, Display: Account.Display || Account.Name, Role: Account.Role, Type: Account.Type || 'owner', Admin: !!Account.Admin, Speaker: Account.Speaker || Speaker( Account.Name, Account.Service ) };
	if ( Account.Id )
	{
		shown.Id = Account.Id;
	}
	if ( Account.Manager === true )
	{
		shown.Manager = true;		// plan The Server, Step 2
	}
	if ( Account.Service )
	{
		shown.Service = Account.Service;
	}
	if ( Account.Token )
	{
		shown.Token = Account.Token;
	}
	if ( Account.Writes )
	{
		shown.Writes = Account.Writes;
	}
	if ( Account.Plan )
	{
		shown.Plan = Account.Plan;
	}
	return shown;
}


//---------------------------------------------------------------------
// Speakers: the byline is the speaker. Speaker( By, Service ) is the key; SpeakerOf( record ) reads it off a reply,
// a resolve, an apply or a revision; Byline( Settings, record ) is what the page shows.

function Speaker( By, Service )
{
	return Service ? Service + ' by ' + By : By;
}


function SpeakerOf( Record )
{
	if ( !Record || !Record.By )
	{
		return null;
	}
	return Speaker( Record.By, Record.Service || null );
}


function display_of( Settings, Name )
{
	let owner = Owner( Settings );
	return ( Name === owner.Name ) ? owner.Display : Name;
}


function Byline( Settings, Record )
{
	if ( !Record || !Record.By )
	{
		return '';
	}
	return Record.Service ? Record.Service + ' by ' + display_of( Settings, Record.By ) : display_of( Settings, Record.By );
}


// Speakers( Settings ): the owner and one speaker per LLM connection, each { Name (the key), Display, Role, Llm? }.
function Speakers( Settings )
{
	let owner = Owner( Settings );
	let list = [ { Name: owner.Name, Display: owner.Display, Role: 'owner', Owner: true } ];
	let llms = ( Settings && Array.isArray( Settings.Llms ) ) ? Settings.Llms : [];
	for ( let llm of llms )
	{
		if ( llm && llm.Name )
		{
			list.push( { Name: Speaker( owner.Name, llm.Name ), Display: Byline( Settings, { By: owner.Name, Service: llm.Name } ), Role: 'llm', Llm: llm.Id } );
		}
	}
	return list;
}


// SeenSpeakers( Settings, Threads, Account?, Owners? ): Speakers, the project's Owners (each { Name, Display }, plan
// Multiuser), everyone who replied, resolved or applied in the threads, and the account asking, so that a connection
// that has not spoken yet is still waited on.
function SeenSpeakers( Settings, Threads, Account, Owners )
{
	let list = Speakers( Settings );
	let known = new Set( list.map( function ( one ) { return one.Name; } ) );
	for ( let owner of Owners || [] )
	{
		if ( owner && owner.Name && !known.has( owner.Name ) )
		{
			known.add( owner.Name );
			list.push( { Name: owner.Name, Display: owner.Display || owner.Name, Role: 'user', Owner: true } );
		}
	}
	function note( record )
	{
		let key = SpeakerOf( record );
		if ( key && !known.has( key ) )
		{
			known.add( key );
			list.push( { Name: key, Display: Byline( Settings, record ), Role: record.Service ? 'llm' : 'user' } );
		}
	}
	for ( let thread of Threads || [] )
	{
		for ( let reply of thread.Replies || [] )
		{
			note( reply );
		}
		note( thread.Resolved );
		note( thread.Applied );
	}
	if ( Account && Account.Name )
	{
		note( { By: Account.Name, Service: Account.Service || null } );
	}
	return list;
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
// The Clerk section (plan User Management, Step 1): three texts, each may be empty; a key given starts with Clerk's
// prefix, the Admin's email is an email. Trust: what a Scope and the section come to.

function validate_clerk( Clerk )
{
	if ( !Clerk || typeof Clerk !== 'object' || Array.isArray( Clerk ) )
	{
		return [ 'Clerk must be an object with ' + CLERK_FIELDS.join( ', ' ) + ' as text' ];
	}
	let problems = [];
	for ( let field of CLERK_FIELDS )
	{
		let value = Clerk[ field ];
		if ( value === undefined || value === null || value === '' )
		{
			continue;
		}
		if ( typeof value !== 'string' )
		{
			problems.push( 'Clerk ' + field + ' must be text' );
			continue;
		}
		if ( CLERK_PREFIXES[ field ] && !value.startsWith( CLERK_PREFIXES[ field ] ) )
		{
			problems.push( 'Clerk ' + field + ' starts with ' + CLERK_PREFIXES[ field ] );
		}
		if ( field === 'AdminEmail' && !EMAIL.test( value ) )
		{
			problems.push( 'Clerk AdminEmail must be an email address' );
		}
	}
	return problems;
}


function Trust( Settings )
{
	let scope = Scope( Settings );
	if ( scope === 'None' )
	{
		return 'none';
	}
	if ( scope === 'Local' )
	{
		return 'local';
	}
	return 'clerk';
}


//---------------------------------------------------------------------
// Validate: the settings are usable: Name, Scope and Port when given, States, the Owner and the Clerk section when
// given.

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
	if ( Settings.Owner !== undefined )
	{
		let owner = Settings.Owner;
		if ( !owner || typeof owner !== 'object' || Array.isArray( owner ) )
		{
			problems.push( 'Owner must be an object with a Name and a Display' );
		}
		else
		{
			if ( typeof owner.Name !== 'string' || !owner.Name.trim() )
			{
				problems.push( 'Owner must have a Name' );
			}
			if ( owner.Display !== undefined && owner.Display !== null && typeof owner.Display !== 'string' )
			{
				problems.push( 'Owner Display must be text' );
			}
		}
	}
	if ( Settings.Clerk !== undefined && Settings.Clerk !== null )
	{
		problems = problems.concat( validate_clerk( Settings.Clerk ) );
	}
	if ( Settings.Tasks !== undefined )
	{
		problems = problems.concat( TASKS.Problems( Settings ) );
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
// Clean: the settings as the modal sends them, kept to the known fields: the Owner to its Name and Display (trimmed,
// the Display dropped when empty); the Clerk section to its three texts, trimmed, and dropped when all are empty
// (absent means our own instance, whose publishable key is built in; plan Clerk, Step 5). The result is what Validate
// checks and what is written.

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
	if ( clean.Owner && typeof clean.Owner === 'object' && !Array.isArray( clean.Owner ) )
	{
		let kept = { Name: ( typeof clean.Owner.Name === 'string' ) ? clean.Owner.Name.trim() : clean.Owner.Name };
		if ( typeof clean.Owner.Display === 'string' && clean.Owner.Display.trim() )
		{
			kept.Display = clean.Owner.Display.trim();
		}
		clean.Owner = kept;
	}
	if ( clean.Tasks !== undefined )
	{
		clean.Tasks = TASKS.Clean( clean.Tasks );
	}
	if ( clean.Clerk === null )
	{
		delete clean.Clerk;
	}
	else if ( clean.Clerk && typeof clean.Clerk === 'object' && !Array.isArray( clean.Clerk ) )
	{
		let kept_clerk = {};
		for ( let field of CLERK_FIELDS )
		{
			let value = clean.Clerk[ field ];
			if ( typeof value === 'string' && value.trim() )
			{
				kept_clerk[ field ] = value.trim();
			}
		}
		if ( Object.keys( kept_clerk ).length )
		{
			clean.Clerk = kept_clerk;
		}
		else
		{
			delete clean.Clerk;
		}
	}
	return clean;
}


module.exports = {
	DEFAULT_STATES: DEFAULT_STATES,
	SCOPES: SCOPES,
	DEFAULT_SCOPE: DEFAULT_SCOPE,
	SETTINGS_FIELDS: SETTINGS_FIELDS,
	SERVICE_HEADER: SERVICE_HEADER,
	SERVICE_PATTERN: SERVICE_PATTERN,
	CLERK_FIELDS: CLERK_FIELDS,
	Trust: Trust,
	DefaultSettings: DefaultSettings,
	Owner: Owner,
	Scope: Scope,
	HostOf: HostOf,
	NewToken: NewToken,
	ServiceOf: ServiceOf,
	RunTokens: RunTokens,
	Identify: Identify,
	UserAccount: user_account,
	Public: Public,
	Speaker: Speaker,
	SpeakerOf: SpeakerOf,
	Byline: Byline,
	Speakers: Speakers,
	SeenSpeakers: SeenSpeakers,
	Validate: Validate,
	States: States,
	Clean: Clean,
};
