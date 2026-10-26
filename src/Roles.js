'use strict';

// Roles - what an account may do in a project (plan User Management, Step 3; the roles are Accounts and Roles'):
// the four project roles, applied through the project's role folders (project.json's Roles: { Owners, Members,
// Service, Watchers }, each a list of account ids, an account in one at most), the actions the API's routes come to,
// and which role allows which. The owner account of a Local server, and the Administrator for the server's own
// routes, pass every check; everyone else is what their role folder says. The license kinds (plan Clerk, Step 5)
// sit here too: a role needs a plan, and a plan has a rank.
//
//   ROLES                       [ 'Owners', 'Members', 'Service', 'Watchers' ]
//   ACTIONS                     read, write, resolve, state, manage, roles, press (a project's), admin (the server's),
//                               self (an account's own page), list (a list the route narrows), open (everyone's)
//   Empty()                     the four empty lists
//   Clean( Roles )              the lists as given, ids trimmed, an id once over all four (the first folder wins)
//   RoleOf( Project, Id )       the role folder holding the account, or null
//   Allows( Role, Action )      whether the role allows the action
//   MayPress( Role, Writes )    whether the role presses a task of that Writes level
//   Reason( Role, Action )      the refusal, in plain words
//   Rule( Method, Path )        { Action, Source: 'param' | 'plan' | 'item' | 'body' | 'query' | null, Id }: what a route
//                               comes to and where its project is found (Id the captured id, when the path holds one)
//   PLANS                       [ 'personal', 'professional' ]: the license kinds (plan Rearchitecturation, Step 6: the tiers
//                               Personal and Professional), professional above personal; no role needs one (plan The Server,
//                               Step 4: the Server runs under its Administrator's license)
//   PlanRank( Plan )            0 for none or an unknown plan, 1 for personal, 2 for professional

const ROLES = [ 'Owners', 'Members', 'Service', 'Watchers' ];
const PLANS = [ 'personal', 'professional' ];

const ALLOWED = {
	Owners: [ 'read', 'write', 'resolve', 'state', 'manage', 'roles', 'press' ],
	Members: [ 'read', 'write', 'resolve', 'press' ],
	Service: [ 'read', 'write' ],
	Watchers: [ 'read', 'press' ],
};

const ONE_OF = { Owners: 'an Owner', Members: 'a Member', Service: 'a Service account', Watchers: 'a Watcher' };

const ACTION_WORDS = {
	read: 'reads',
	write: 'writes',
	resolve: 'resolves threads',
	state: 'sets a plan\'s state',
	manage: 'manages the project',
	roles: 'assigns roles',
	press: 'presses a task',
};

// The routes, first match wins: [ methods, path pattern, action, where the project is ]. The id captured by the
// pattern is the project's (param), a plan's (plan) or an item's (item); body and query name the field Project.
const RULES = [
	[ 'GET', /^\/(me|tasks|llms|users|runs|runs\/run-[^/]+)$/, 'open', null ],
	[ 'POST', /^\/mcp$/, 'open', null ],	// the MCP transport (plan MCP Server, Step 2): each operation is checked on its own action inside
	[ 'GET', /^\/instructions$/, 'open', null ],	// the instructions as an operation (Step 3)
	[ 'GET', /^\/(projects|plans|waiting)$/, 'list', null ],
	[ 'GET', /^\/trash$/, 'admin', null ],
	[ 'GET|PUT', /^\/settings$/, 'admin', null ],
	[ 'POST|PUT|DELETE', /^\/llms(\/.*)?$/, 'admin', null ],
	[ 'DELETE', /^\/trash$/, 'admin', null ],
	[ 'POST', /^\/projects$/, 'admin', null ],
	[ 'POST', /^\/projects\/import$/, 'admin', null ],
	[ 'DELETE', /^\/projects\/([^/]+)$/, 'admin', null ],
	[ 'POST', /^\/projects\/([^/]+)\/move$/, 'admin', null ],
	[ 'POST', /^\/users$/, 'admin', null ],
	[ 'DELETE', /^\/users\/([^/]+)$/, 'admin', null ],
	[ 'GET|PUT|POST|DELETE', /^\/users\/([^/]+)(\/.*)?$/, 'self', null ],
	[ 'PUT', /^\/projects\/([^/]+)\/mount$/, 'admin', null ],	// the registry entry's switch (plan Rearchitecturation, Step 5)
	[ 'PUT', /^\/projects\/([^/]+)\/roles$/, 'roles', 'param' ],
	[ 'GET', /^\/projects\/([^/]+)\/export$/, 'read', 'param' ],
	[ 'PUT|POST|DELETE', /^\/projects\/([^/]+)(\/.*)?$/, 'manage', 'param' ],
	[ 'GET', /^\/items\/([^/]+)\/export$/, 'read', 'item' ],
	[ 'POST', /^\/items\/([^/]+)\/.*$/, 'manage', 'item' ],
	[ 'POST', /^\/plans$/, 'write', 'body' ],
	[ 'GET', /^\/plans\/([^/]+)(\/.*)?$/, 'read', 'plan' ],
	[ 'PUT', /^\/plans\/([^/]+)$/, 'manage', 'plan' ],
	[ 'DELETE', /^\/plans\/([^/]+)$/, 'manage', 'plan' ],
	[ 'PUT', /^\/plans\/([^/]+)\/state$/, 'state', 'plan' ],
	[ 'PUT', /^\/plans\/([^/]+)\/text$/, 'write', 'plan' ],
	[ 'POST', /^\/plans\/([^/]+)\/threads\/[^/]+\/resolve$/, 'resolve', 'plan' ],
	[ 'DELETE', /^\/plans\/([^/]+)\/threads\/[^/]+$/, 'manage', 'plan' ],
	[ 'POST', /^\/plans\/([^/]+)\/threads(\/.*)?$/, 'write', 'plan' ],
	[ 'GET', /^\/runs\/lists$/, 'read', 'query' ],
	[ 'POST', /^\/runs\/package$/, 'read', 'body' ],
	[ 'POST', /^\/runs$/, 'press', 'body' ],
	[ 'POST|DELETE', /^\/runs\/[^/]+(\/.*)?$/, 'open', null ],
];


function Empty()
{
	let roles = {};
	for ( let role of ROLES )
	{
		roles[ role ] = [];
	}
	return roles;
}


function Clean( Roles )
{
	let given = ( Roles && typeof Roles === 'object' ) ? Roles : {};
	let clean = Empty();
	let seen = new Set();
	for ( let role of ROLES )
	{
		for ( let id of ( Array.isArray( given[ role ] ) ? given[ role ] : [] ) )
		{
			let trimmed = String( id || '' ).trim();
			if ( trimmed && !seen.has( trimmed ) )
			{
				seen.add( trimmed );
				clean[ role ].push( trimmed );
			}
		}
	}
	return clean;
}


function RoleOf( Project, Id )
{
	let roles = ( Project && Project.Roles && typeof Project.Roles === 'object' ) ? Project.Roles : {};
	for ( let role of ROLES )
	{
		if ( Array.isArray( roles[ role ] ) && roles[ role ].includes( Id ) )
		{
			return role;
		}
	}
	return null;
}


function Allows( Role, Action )
{
	return !!( ALLOWED[ Role ] && ALLOWED[ Role ].includes( Action ) );
}


function PlanRank( Plan )
{
	return PLANS.indexOf( Plan ) + 1;
}


// Which tasks a role may press is read from the task's Writes level: none is every role's, consensus and files are
// Owners' and Members'; a Service account presses none.
function MayPress( Role, Writes )
{
	if ( Role === 'Owners' || Role === 'Members' )
	{
		return true;
	}
	if ( Role === 'Watchers' )
	{
		return Writes === 'none';
	}
	return false;
}


function Reason( Role, Action )
{
	if ( !Role )
	{
		return 'no role in this project';
	}
	if ( Role === 'Watchers' && Action !== 'press' )
	{
		return 'a Watcher reads only';
	}
	if ( Action === 'press' )
	{
		return ( Role === 'Service' ) ? 'a Service account presses no task' : 'a Watcher presses the tasks that write nothing';
	}
	return ONE_OF[ Role ] + ' never ' + ( ACTION_WORDS[ Action ] || Action );
}


function Rule( Method, Path )
{
	let method = String( Method || 'GET' ).toUpperCase();
	let path = String( Path || '' ).replace( /\/+$/, '' ) || '/';
	for ( let rule of RULES )
	{
		if ( !rule[ 0 ].split( '|' ).includes( method ) )
		{
			continue;
		}
		let match = rule[ 1 ].exec( path );
		if ( match )
		{
			return { Action: rule[ 2 ], Source: rule[ 3 ], Id: ( rule[ 3 ] === 'param' || rule[ 3 ] === 'plan' || rule[ 3 ] === 'item' ) ? decodeURIComponent( match[ 1 ] ) : null };
		}
	}
	return { Action: 'admin', Source: null, Id: null };
}


module.exports = {
	ROLES: ROLES,
	ALLOWED: ALLOWED,
	PLANS: PLANS,
	PlanRank: PlanRank,
	Empty: Empty,
	Clean: Clean,
	RoleOf: RoleOf,
	Allows: Allows,
	MayPress: MayPress,
	Reason: Reason,
	Rule: Rule,
};
