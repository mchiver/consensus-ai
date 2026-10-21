'use strict';

// Rules - the consensus rules as pure functions over a plan, its threads and the participants.
// Nothing here touches a file or a request; every rule is asserted in test/Rules.test.js.
//
//   thread = { Id, Anchor, Detached, Status: 'contested' | 'resolved', Reopened, Resolved, Applied, Replies }
//   plan = { Id, Title, State, Revision }   State is one of the settings' States, changed by an Owner (plan Multiuser)
//   speaker = { Name, Display, Role: 'owner' | 'user' | 'llm', Owner? }   Name is the key the byline makes
//   (Participants.Speaker): an account's name, or "<Service> by <By>" for an LLM connection, an agent session or a
//   service acting for it (plan User Management, Step 2). Role owner is the server's owner account, user a person's
//   or a Service account's own name, llm a byline with a service in it: the ones that answer. Owner marks the
//   server's owner and the accounts in the project's Owners folder (plan Multiuser).
//   who = an account as Identify builds it: { Name, Role: 'owner' | 'user' | 'service', ProjectRole?, Service?, Token? }
//   A reply, a resolve, an apply and a revision carry By, Service? and Token?.
//
// A thread's life: Contested -> Resolved (waiting to be applied) -> Applied. A reply to a resolved or applied
// thread reopens it (contested, marked reopened); an applied change stays applied, and after the thread is
// resolved again it is waiting to be applied again, since the resolution is newer than the applied record.
// A plan's State does not depend on its threads.
//
// Plan Multiuser (its six decisions taken 2026-10-19): a thread is resolved by the one who started it or an Owner,
// with no vote; it waits on its parties, not on bystanders; anyone with write access applies it; the plan's State
// is an Owner's.

const ROLES = require( './Roles.js' );


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
// Turn: the names a thread waits on (plan Multiuser: the parties, not the bystanders).
//   contested            the starter, the Owners, everyone who has replied in it, and the LLM speakers (a connection,
//                        an agent session or a service acting for a person: the ones that answer), minus the one who
//                        replied last. A person who has not joined in is not waited on. The byline is the speaker:
//                        a run's reply as the owner through a connection is a different speaker from the owner, so
//                        the owner is still waited on.
//   resolved             the starter and the Owners, so that someone who cares sees it applied (waiting to be applied)
//   applied              nobody

function Turn( Thread, Participants )
{
	let replies = Thread.Replies || [];
	if ( Thread.Status === 'contested' )
	{
		let spoke = new Set( replies.map( SpeakerOf ) );
		let last_by = SpeakerOf( replies[ replies.length - 1 ] );
		return Participants.filter( function ( participant )
		{
			return participant.Name !== last_by && ( is_owner( participant ) || participant.Role === 'llm' || spoke.has( participant.Name ) );
		} ).map( name_of );
	}
	if ( IsWaiting( Thread ) )
	{
		let starter = SpeakerOf( replies[ 0 ] );
		return Participants.filter( function ( participant ) { return is_owner( participant ) || participant.Name === starter; } ).map( name_of );
	}
	return [];
}


// An Owner among the speakers: the server's owner account, or an account in the project's Owners folder.
function is_owner( participant )
{
	return participant.Role === 'owner' || !!participant.Owner;
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
// StateLine: the one line at the top, for the participant reading it. "waiting on you" counts every thread waiting
// on them, the resolved ones they are to apply as well as the contested ones (plan Multiuser).

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
// Who may do what. Each answers { Ok, Reason }. The server's owner account passes every check; anyone else is what
// their role in the project allows (Roles.js), the role the API found and put on the account as ProjectRole.

// The project role an account acts with: the one the API found, or Owners for the server's owner.
function project_role( Who )
{
	return Who.ProjectRole || ( ( Who.Role === 'owner' ) ? 'Owners' : null );
}


function is_project_owner( Who )
{
	return Who.Role === 'owner' || project_role( Who ) === 'Owners';
}


// A thread is resolved by the one who started it, or by an Owner of the project (plan Multiuser): the one who asked
// knows when it is answered; an Owner closes any thread so that a starter who has gone quiet does not hold the plan.
function may_resolve( Who, Thread )
{
	if ( is_project_owner( Who ) )
	{
		return true;
	}
	return ROLES.Allows( project_role( Who ), 'resolve' ) && Thread.Replies.length > 0 && Thread.Replies[ 0 ].By === Who.Name;
}


function CanResolve( Who, Thread )
{
	if ( !Who || !may_resolve( Who, Thread ) )
	{
		return { Ok: false, Reason: ( Who && project_role( Who ) === 'Members' ) ? 'a Member resolves the threads they started' : 'a thread is resolved by the one who started it, or an Owner' };
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


// Anyone with write access to the project applies a resolved thread (plan Multiuser): an Owner, a Member or a
// Service account, in person or through an agent session holding their token.
function MayApply( Who )
{
	if ( !Who )
	{
		return { Ok: false, Reason: 'unknown participant' };
	}
	if ( Who.Role !== 'owner' && !ROLES.Allows( project_role( Who ), 'write' ) )
	{
		return { Ok: false, Reason: 'applying a thread takes write access: an Owner, a Member or a Service account' };
	}
	return { Ok: true };
}


function CanApply( Who, Thread )
{
	let may = MayApply( Who );
	if ( !may.Ok )
	{
		return may;
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
	if ( !Who || !is_project_owner( Who ) )
	{
		return { Ok: false, Reason: 'only the owner deletes a thread' };
	}
	return { Ok: true };
}


// A plan's State is an Owner's (plan Multiuser): Draft to Plan is the Owner's acceptance of the text, Plan to Working
// the word to build, Working to Finished the acceptance of the build. Members move the text through their threads.
function MaySetState( Who )
{
	if ( !Who || !is_project_owner( Who ) )
	{
		return { Ok: false, Reason: 'only an Owner sets a plan\'s State' };
	}
	return { Ok: true };
}


// The value: any of the settings' States.
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
// WaitingOn: the threads waiting on one speaker. Person, when given, is the account the speaker acts for (a run or an
// agent session through a connection): it also serves the resolved threads waiting on that person, since Answer
// applies them as the presser (plan Multiuser); the contested ones waiting on the person are the person's own to answer.

function WaitingOn( Name, Threads, Participants, Person )
{
	return Threads.filter( function ( thread )
	{
		let turn = Turn( thread, Participants );
		return turn.includes( Name ) || ( !!Person && IsWaiting( thread ) && turn.includes( Person ) );
	} );
}


//---------------------------------------------------------------------
// Filter: threads by the page's filter names.
//   all | contested | resolved (waiting to be applied) | applied | reopened | detached | mine (WaitingOn's Name and Person)

function Filter( Threads, Status, Participants, Name, Person )
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
			return WaitingOn( Name, Threads, Participants || [], Person );
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
	MayApply: MayApply,
	CanApply: CanApply,
	CanDeleteThread: CanDeleteThread,
	MaySetState: MaySetState,
	CanSetState: CanSetState,
	ReplyEffect: ReplyEffect,
	ResolveEffect: ResolveEffect,
	ApplyEffect: ApplyEffect,
	WaitingOn: WaitingOn,
	Filter: Filter,
};
