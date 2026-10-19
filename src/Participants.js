'use strict';

// Participants - who is calling, from the settings and the request (plan User Management, Step 2).
// An account is the principal. Until Step 3 brings users and roles, every request on a Local or trusted-network
// server is the owner account: the browser, an agent session, a script, each saying who it is with the header
// "X-Consensus-Service: <name>" (letters, digits, dot, dash and colon), or saying nothing. A run started by the
// server carries "Authorization: Bearer <run token>", a token the server made for that run and keeps in memory
// (RunTokens): the request is the owner with the connection's name as its Service. Any other token is refused.
// A record of what a request did carries three fields: By (the account), Service and Token (the token's name); the
// speaker the rules run over is the byline, "<Service> by <By>", or By alone (Speaker, SpeakerOf); the page shows
// "<Service> by <Display>" (Byline). A plan's speakers are the owner, one per LLM connection, and everyone seen in
// its threads (Speakers, SeenSpeakers), so the waiting rule keeps working with no participants list.
// The settings (consensus.json) are checked here too: Name, Port, Scope, States, Owner ({ Name, Display }, the
// owner participant of before; Migrate moves it in and drops the other participants and the connections' tokens),
// and the optional Clerk section (Step 1: PublishableKey, SecretKey, WebhookSecret, AdminEmail; read by nothing yet).
// Scope (None, Local, Public) says whether the server listens and for whom; Trust says what a Scope and the Clerk
// section come to: local, trusted (Public with no Clerk keys: every request is the owner), clerk, or none.

const CRYPTO = require( 'crypto' );
const OS = require( 'os' );

const DEFAULT_STATES = [ 'Draft', 'Plan', 'Working', 'Finished' ];
const RENAMED_STATE = { From: 'Proposal', To: 'Draft' };	// plan UI Tweaks V: the first state's new name, migrated at start
const SCOPES = [ 'None', 'Local', 'Public' ];
const DEFAULT_SCOPE = 'Local';
const SCOPE_HOSTS = { None: null, Local: '127.0.0.1', Public: '0.0.0.0' };
const LOCAL_HOSTS = [ '127.0.0.1', 'localhost', '::1' ];
const SETTINGS_FIELDS = [ 'Name', 'Port', 'Scope', 'States', 'Owner', 'Clerk' ];
const DEFAULT_OWNER = { Name: 'user', Display: 'User' };
const SERVICE_HEADER = 'X-Consensus-Service';
const SERVICE_PATTERN = /^[A-Za-z0-9.:-]{1,40}$/;
const CLERK_FIELDS = [ 'PublishableKey', 'SecretKey', 'WebhookSecret', 'AdminEmail' ];
const CLERK_PREFIXES = { PublishableKey: 'pk_', SecretKey: 'sk_', WebhookSecret: 'whsec_' };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RETIRED_FIELDS = [ 'Corpus', 'Context', 'Workers' ];	// from before plan Consensus Desktop, Step 1


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
//   Mint( { Service, Name, Project, Run? } ) -> the token's value;  Find( value ) -> the record or null;  Drop( value )

function RunTokens()
{
	let tokens = {};

	function Mint( Fields )
	{
		let value = NewToken();
		tokens[ value ] = { Service: Fields.Service || null, Name: Fields.Name || 'run', Project: Fields.Project || null, Run: Fields.Run || null };
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
//   account = { Name, Display, Role: 'owner', Service, Token, Speaker }: Service the header's name or the run's
//   connection, Token the run token's name ("Review run"), Speaker the key the rules run over.

function Identify( Settings, Headers, Tokens )
{
	let headers = ( Headers && typeof Headers === 'object' ) ? Headers : { Authorization: Headers };
	let authorization = ( headers.Authorization || '' ).trim();
	let owner = Owner( Settings );
	if ( !authorization )
	{
		return account_of( owner, ServiceOf( headers.Service ), null );
	}
	let match = /^Bearer\s+(.+)$/i.exec( authorization );
	if ( !match )
	{
		return null;
	}
	let run = Tokens ? Tokens.Find( match[ 1 ].trim() ) : null;
	if ( !run )
	{
		return null;
	}
	return account_of( owner, run.Service, run.Name );
}


function account_of( owner, service, token )
{
	let account = { Name: owner.Name, Display: owner.Display, Role: 'owner', Service: service || null, Token: token || null };
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
	let shown = { Name: Account.Name, Display: Account.Display || Account.Name, Role: Account.Role, Speaker: Account.Speaker || Speaker( Account.Name, Account.Service ) };
	if ( Account.Service )
	{
		shown.Service = Account.Service;
	}
	if ( Account.Token )
	{
		shown.Token = Account.Token;
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
	let list = [ { Name: owner.Name, Display: owner.Display, Role: 'owner' } ];
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


// SeenSpeakers( Settings, Threads, Account? ): Speakers and everyone who replied, resolved or applied in the threads,
// and the account asking, so that a service that has not spoken yet is still waited on.
function SeenSpeakers( Settings, Threads, Account )
{
	let list = Speakers( Settings );
	let known = new Set( list.map( function ( one ) { return one.Name; } ) );
	function note( record )
	{
		let key = SpeakerOf( record );
		if ( key && !known.has( key ) )
		{
			known.add( key );
			list.push( { Name: key, Display: Byline( Settings, record ), Role: 'llm' } );
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
// Migrate: a settings file from before, changed in place: Host becomes Scope (a local address Local, any other
// Public), a missing Scope is Local, a missing Name is the machine's; the Participants list becomes Owner (its owner
// entry's Name and Display), the other participants are dropped, and the connections lose their Token (plan User
// Management, Step 2: the server makes one per run). Returns a line for each change.

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
	if ( Settings.Participants !== undefined )
	{
		let list = Array.isArray( Settings.Participants ) ? Settings.Participants.filter( function ( one ) { return one && typeof one === 'object'; } ) : [];
		let owner = list.find( function ( one ) { return one.Role === 'owner'; } ) || null;
		if ( !Settings.Owner || typeof Settings.Owner !== 'object' )
		{
			Settings.Owner = Owner( { Owner: owner ? { Name: owner.Name, Display: owner.Display } : null } );
		}
		let dropped = list.filter( function ( one ) { return one !== owner && one.Name; } ).map( function ( one ) { return one.Name; } );
		delete Settings.Participants;
		lines.push( 'Participants became Owner ' + JSON.stringify( Settings.Owner.Name ) + ( dropped.length ? '; ' + dropped.join( ', ' ) + ' dropped (an LLM is never a user; members come through Clerk)' : '' ) );
	}
	if ( !Settings.Owner || typeof Settings.Owner !== 'object' || typeof Settings.Owner.Name !== 'string' || !Settings.Owner.Name.trim() )
	{
		Settings.Owner = Owner( null );
		lines.push( 'Owner set to ' + JSON.stringify( Settings.Owner.Name ) );
	}
	let llms = Array.isArray( Settings.Llms ) ? Settings.Llms : [];
	let untokened = [];
	for ( let llm of llms )
	{
		if ( llm && typeof llm === 'object' && llm.Token !== undefined )
		{
			delete llm.Token;
			untokened.push( llm.Name || '?' );
		}
	}
	if ( untokened.length )
	{
		lines.push( 'the Token of the LLM connection' + ( untokened.length > 1 ? 's ' : ' ' ) + untokened.join( ', ' ) + ' dropped: the server makes one per run' );
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
// The Clerk section (plan User Management, Step 1): four texts, each may be empty; a key given starts with Clerk's
// prefix, the Admin's email is an email. HasClerk: both keys given. Trust: what a Scope and the section come to.

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


function HasClerk( Settings )
{
	let clerk = ( Settings && Settings.Clerk && typeof Settings.Clerk === 'object' ) ? Settings.Clerk : null;
	if ( !clerk )
	{
		return false;
	}
	let publishable = ( typeof clerk.PublishableKey === 'string' ) && clerk.PublishableKey.trim();
	let secret = ( typeof clerk.SecretKey === 'string' ) && clerk.SecretKey.trim();
	return !!( publishable && secret );
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
	return HasClerk( Settings ) ? 'clerk' : 'trusted';
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
// the Display dropped when empty); the Clerk section to its four texts, trimmed, and dropped when all are empty
// (absent means a trusted network). The result is what Validate checks and what is written.

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
	RENAMED_STATE: RENAMED_STATE,
	SCOPES: SCOPES,
	DEFAULT_SCOPE: DEFAULT_SCOPE,
	SETTINGS_FIELDS: SETTINGS_FIELDS,
	SERVICE_HEADER: SERVICE_HEADER,
	SERVICE_PATTERN: SERVICE_PATTERN,
	CLERK_FIELDS: CLERK_FIELDS,
	HasClerk: HasClerk,
	Trust: Trust,
	DefaultSettings: DefaultSettings,
	Owner: Owner,
	Scope: Scope,
	HostOf: HostOf,
	Migrate: Migrate,
	NewToken: NewToken,
	ServiceOf: ServiceOf,
	RunTokens: RunTokens,
	Identify: Identify,
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
