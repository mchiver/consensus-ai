'use strict';

// Rules - the consensus rules as pure functions over a plan, its threads and the participants.
// Nothing here touches a file or a request; every rule is asserted in test/Rules.test.js.
//
//   thread = { Id, Anchor, Detached, Status: 'contested' | 'resolved', Reopened, Resolved, Applied, Replies }
//   plan = { Id, Title, State, Revision }   State is one of the settings' States, changed by anyone at any time
//   speaker = { Name, Display, Role: 'owner' | 'llm' }   Name is the key the byline makes (Participants.Speaker): the
//   owner account's name, or "<Service> by <By>" for an LLM connection, an agent session or a service acting for it
//   (plan User Management, Step 2). A reply, a resolve, an apply and a revision carry By, Service? and Token?.
//
// A thread's life: Contested -> Resolved (waiting to be applied) -> Applied. A reply to a resolved or applied
// thread reopens it (contested, marked reopened); an applied change stays applied, and after the thread is
// resolved again it is waiting to be applied again, since the resolution is newer than the applied record.
// A plan's State does not depend on its threads.


//---------------------------------------------------------------------
// States

function IsWaiting( Thread )
{
	if ( Thread.Status !== 'resolved' )
	{
		return false;
	}
	if ( !Thread.Applied )
	{
		return true;
	}
	return !!( Thread.Resolved && Thread.Applied.At < Thread.Resolved.At );
}


function IsApplied( Thread )
{
	return Thread.Status === 'resolved' && !IsWaiting( Thread );
}


//---------------------------------------------------------------------
// Turn: the names a thread waits on.
//   contested            every speaker except the one who replied last (the byline: a run's reply as the owner
//                        through a connection is a different speaker from the owner, so the owner is still waited on)
//   resolved             every speaker but the owner account: the LLMs and services (waiting to be applied)
//   applied              nobody

function Turn( Thread, Participants )
{
	if ( Thread.Status === 'contested' )
	{
		let last_reply = Thread.Replies[ Thread.Replies.length - 1 ];
		let last_by = SpeakerOf( last_reply );
		return Participants.filter( function ( participant ) { return participant.Name !== last_by; } ).map( name_of );
	}
	if ( IsWaiting( Thread ) )
	{
		return Participants.filter( is_not_owner ).map( name_of );
	}
	return [];
}


function is_not_owner( participant )
{
	return participant.Role !== 'owner';
}


// SpeakerOf: the key of who made a record: "<Service> by <By>", or By alone.
function SpeakerOf( Record )
{
	if ( !Record || !Record.By )
	{
		return null;
	}
	return Record.Service ? Record.Service + ' by ' + Record.By : Record.By;
}


// Stamp: the three fields and the time a record carries: By the account, Service and Token when the request had them.
function Stamp( Who, At )
{
	let stamp = { By: Who.Name };
	if ( Who.Service )
	{
		stamp.Service = Who.Service;
	}
	if ( Who.Token )
	{
		stamp.Token = Who.Token;
	}
	stamp.At = At;
	return stamp;
}


function name_of( participant )
{
	return participant.Name;
}


//---------------------------------------------------------------------
// Tally: what a plan's threads add up to, and who each count waits on.

function Tally( Plan, Threads, Participants )
{
	let tally = { Total: Threads.length, Contested: 0, Reopened: 0, Resolved: 0, Applied: 0, Detached: 0, WaitingOn: {} };
	for ( let participant of Participants )
	{
		tally.WaitingOn[ participant.Name ] = 0;
	}
	for ( let thread of Threads )
	{
		if ( thread.Status === 'contested' )
		{
			tally.Contested++;
			if ( thread.Reopened )
			{
				tally.Reopened++;
			}
		}
		else if ( IsWaiting( thread ) )
		{
			tally.Resolved++;
		}
		else
		{
			tally.Applied++;
		}
		if ( thread.Detached )
		{
			tally.Detached++;
		}
		for ( let name of Turn( thread, Participants ) )
		{
			tally.WaitingOn[ name ] = ( tally.WaitingOn[ name ] || 0 ) + 1;
		}
	}
	return tally;
}


//---------------------------------------------------------------------
// StateLine: the one line at the top, for the participant reading it.

function StateLine( Tally_, Name )
{
	if ( Tally_.Total === 0 )
	{
		return 'no threads yet';
	}
	let parts = [];
	if ( Tally_.Contested > 0 )
	{
		let part = Tally_.Contested + ' contested';
		let mine = Tally_.WaitingOn[ Name ] || 0;
		if ( mine > 0 )
		{
			part += ', waiting on you ' + mine;
		}
		if ( Tally_.Reopened > 0 )
		{
			part += ', ' + Tally_.Reopened + ' reopened';
		}
		parts.push( part );
	}
	if ( Tally_.Resolved > 0 )
	{
		parts.push( Tally_.Resolved + ' resolved' );
	}
	if ( Tally_.Applied > 0 )
	{
		parts.push( Tally_.Applied + ' applied' );
	}
	if ( Tally_.Detached > 0 )
	{
		parts.push( Tally_.Detached + ' detached' );
	}
	return parts.join( ' · ' );
}


//---------------------------------------------------------------------
// Who may do what. Each answers { Ok, Reason }.

// The project role an account acts with (plan User Management, Step 3): the one the API found, or Owners for the
// server's owner. An Owner resolves any thread; a Member the threads they started (Accounts and Roles).
function project_role( Who )
{
	return Who.ProjectRole || ( ( Who.Role === 'owner' ) ? 'Owners' : null );
}


function may_resolve( Who, Thread )
{
	let role = project_role( Who );
	if ( Who.Role === 'owner' || role === 'Owners' )
	{
		return true;
	}
	return role === 'Members' && Thread.Replies.length > 0 && Thread.Replies[ 0 ].By === Who.Name;
}


function CanResolve( Who, Thread )
{
	if ( !Who || !may_resolve( Who, Thread ) )
	{
		return { Ok: false, Reason: ( Who && project_role( Who ) === 'Members' ) ? 'a Member resolves the threads they started' : 'only the owner resolves a thread' };
	}
	if ( Thread.Status !== 'contested' )
	{
		return { Ok: false, Reason: 'the thread is already resolved' };
	}
	if ( Thread.Replies.length === 0 )
	{
		return { Ok: false, Reason: 'an empty thread has no outcome to resolve' };
	}
	return { Ok: true };
}


function CanApply( Who, Thread )
{
	if ( !Who )
	{
		return { Ok: false, Reason: 'unknown participant' };
	}
	if ( Thread.Status !== 'resolved' )
	{
		return { Ok: false, Reason: 'only a resolved thread is applied' };
	}
	if ( !IsWaiting( Thread ) )
	{
		return { Ok: false, Reason: 'the thread is already applied' };
	}
	return { Ok: true };
}


// Only the owner, or an Owner of the project, deletes a thread, whatever its status; the revisions that applied it
// keep their text.
function CanDeleteThread( Who )
{
	if ( !Who || ( Who.Role !== 'owner' && project_role( Who ) !== 'Owners' ) )
	{
		return { Ok: false, Reason: 'only the owner deletes a thread' };
	}
	return { Ok: true };
}


// A plan's state: any of the settings' States, by anyone, at any time.
function CanSetState( State, States )
{
	if ( typeof State !== 'string' || !States.includes( State ) )
	{
		return { Ok: false, Reason: 'State must be one of ' + States.join( ', ' ) };
	}
	return { Ok: true };
}


//---------------------------------------------------------------------
// Effects: what an action changes. Each returns the fields to merge.

// A reply to a resolved thread reopens it: contested again, marked reopened. An applied change stays applied.
function ReplyEffect( Thread )
{
	if ( Thread.Status === 'resolved' )
	{
		return { Reopen: true, Status: 'contested', Reopened: true, Resolved: null };
	}
	return { Reopen: false };
}


function ResolveEffect( Who, At )
{
	return { Status: 'resolved', Reopened: false, Resolved: Stamp( Who, At ) };
}


function ApplyEffect( Who, At, Revision, RevisionId, Outcome )
{
	return { Applied: Object.assign( Stamp( Who, At ), { Revision: Revision, RevisionId: RevisionId, Outcome: Outcome } ) };
}


//---------------------------------------------------------------------
// WaitingOn: the threads waiting on one participant.

function WaitingOn( Name, Threads, Participants )
{
	return Threads.filter( function ( thread ) { return Turn( thread, Participants ).includes( Name ); } );
}


//---------------------------------------------------------------------
// Filter: threads by the page's filter names.
//   all | contested | resolved (waiting to be applied) | applied | reopened | detached | mine

function Filter( Threads, Status, Participants, Name )
{
	switch ( Status || 'all' )
	{
		case 'all':
			return Threads.slice();
		case 'contested':
			return Threads.filter( function ( thread ) { return thread.Status === 'contested'; } );
		case 'resolved':
			return Threads.filter( IsWaiting );
		case 'applied':
			return Threads.filter( IsApplied );
		case 'reopened':
			return Threads.filter( function ( thread ) { return thread.Status === 'contested' && thread.Reopened; } );
		case 'detached':
			return Threads.filter( function ( thread ) { return !!thread.Detached; } );
		case 'mine':
			return WaitingOn( Name, Threads, Participants || [] );
		default:
			return null;
	}
}


module.exports = {
	IsWaiting: IsWaiting,
	IsApplied: IsApplied,
	Turn: Turn,
	SpeakerOf: SpeakerOf,
	Stamp: Stamp,
	Tally: Tally,
	StateLine: StateLine,
	CanResolve: CanResolve,
	CanApply: CanApply,
	CanDeleteThread: CanDeleteThread,
	CanSetState: CanSetState,
	ReplyEffect: ReplyEffect,
	ResolveEffect: ResolveEffect,
	ApplyEffect: ApplyEffect,
	WaitingOn: WaitingOn,
	Filter: Filter,
};
