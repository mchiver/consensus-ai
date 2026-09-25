'use strict';

// Rules - the consensus rules as pure functions over a proposal, its threads and the participants.
// Nothing here touches a file or a request; every rule is asserted in test/Rules.test.js.
//
//   thread = { Id, Anchor, Detached, Status: 'contested' | 'resolved', Reopened, Resolved, Applied, Replies }
//   proposal = { Id, Title, State, Revision }   State is one of the settings' States, changed by anyone at any time
//   participant = { Name, Display, Role: 'owner' | 'llm' | 'member' }
//
// A thread's life: Contested -> Resolved (waiting to be applied) -> Applied. A reply to a resolved or applied
// thread reopens it (contested, marked reopened); an applied change stays applied, and after the thread is
// resolved again it is waiting to be applied again, since the resolution is newer than the applied record.
// A proposal's State does not depend on its threads.


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
//   contested            every participant except the one who replied last
//   resolved             every participant with the llm role (waiting to be applied)
//   applied              nobody

function Turn( Thread, Participants )
{
	if ( Thread.Status === 'contested' )
	{
		let last_reply = Thread.Replies[ Thread.Replies.length - 1 ];
		let last_by = last_reply ? last_reply.By : null;
		return Participants.filter( function ( participant ) { return participant.Name !== last_by; } ).map( name_of );
	}
	if ( IsWaiting( Thread ) )
	{
		return Participants.filter( is_llm ).map( name_of );
	}
	return [];
}


function is_llm( participant )
{
	return participant.Role === 'llm';
}


function name_of( participant )
{
	return participant.Name;
}


//---------------------------------------------------------------------
// Tally: what a proposal's threads add up to, and who each count waits on.

function Tally( Proposal, Threads, Participants )
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

function CanResolve( Who, Thread )
{
	if ( !Who || Who.Role !== 'owner' )
	{
		return { Ok: false, Reason: 'only the owner resolves a thread' };
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


// A proposal's state: any of the settings' States, by anyone, at any time.
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
	return { Status: 'resolved', Reopened: false, Resolved: { By: Who.Name, At: At } };
}


function ApplyEffect( Who, At, Revision, Outcome )
{
	return { Applied: { By: Who.Name, At: At, Revision: Revision, Outcome: Outcome } };
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
	Tally: Tally,
	StateLine: StateLine,
	CanResolve: CanResolve,
	CanApply: CanApply,
	CanSetState: CanSetState,
	ReplyEffect: ReplyEffect,
	ResolveEffect: ResolveEffect,
	ApplyEffect: ApplyEffect,
	WaitingOn: WaitingOn,
	Filter: Filter,
};
