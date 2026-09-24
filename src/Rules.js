'use strict';

// Rules - the consensus rules as pure functions over a proposal, its threads and the participants.
// Nothing here touches a file or a request; every rule is asserted in test/Rules.test.js.
//
//   thread = { Id, Anchor, Detached, Status: 'contested' | 'consensus', Reopened, Resolved, Applied, Replies }
//   proposal = { Id, Title, Status: 'contested' | 'consensus', Revision, Approved }
//   participant = { Name, Display, Role: 'owner' | 'llm' | 'member' }
//
// A thread's life: contested -> resolved (consensus, waiting to be applied) -> applied. A reply to a resolved
// thread reopens it (contested, marked reopened); an applied change stays applied, and after the thread is
// resolved again it is waiting to be applied again, since the resolution is newer than the applied record.


//---------------------------------------------------------------------
// States

function IsWaiting( Thread )
{
	if ( Thread.Status !== 'consensus' )
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
	return Thread.Status === 'consensus' && !IsWaiting( Thread );
}


//---------------------------------------------------------------------
// Turn: the names a thread waits on.
//   contested            every participant except the one who replied last
//   waiting to be applied every participant with the llm role
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
	let tally = { Total: Threads.length, Contested: 0, Reopened: 0, Waiting: 0, Applied: 0, Detached: 0, WaitingOn: {} };
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
			tally.Waiting++;
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
	tally.Approvable = ( tally.Contested === 0 && tally.Waiting === 0 );
	return tally;
}


//---------------------------------------------------------------------
// StateLine: the one line at the top, for the participant reading it.

function StateLine( Proposal, Tally_, Name )
{
	if ( Proposal.Status === 'consensus' )
	{
		return 'a Plan, approved at revision ' + ( Proposal.Approved ? Proposal.Approved.Revision : Proposal.Revision );
	}
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
	if ( Tally_.Waiting > 0 )
	{
		parts.push( Tally_.Waiting + ' waiting to be applied' );
	}
	if ( Tally_.Applied > 0 )
	{
		parts.push( Tally_.Applied + ' applied' );
	}
	if ( Tally_.Detached > 0 )
	{
		parts.push( Tally_.Detached + ' detached' );
	}
	if ( Tally_.Approvable )
	{
		parts.push( 'ready for approval as a Plan' );
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
	if ( Thread.Status !== 'consensus' )
	{
		return { Ok: false, Reason: 'only a resolved thread is applied' };
	}
	if ( !IsWaiting( Thread ) )
	{
		return { Ok: false, Reason: 'the thread is already applied' };
	}
	return { Ok: true };
}


function CanApprove( Who, Proposal, Threads )
{
	if ( !Who || Who.Role !== 'owner' )
	{
		return { Ok: false, Reason: 'only the owner approves a proposal' };
	}
	if ( Proposal.Status === 'consensus' )
	{
		return { Ok: false, Reason: 'the proposal is already a Plan' };
	}
	let contested = Threads.filter( function ( thread ) { return thread.Status === 'contested'; } ).length;
	if ( contested > 0 )
	{
		return { Ok: false, Reason: contested + ' thread' + ( contested === 1 ? ' is' : 's are' ) + ' still contested' };
	}
	let waiting = Threads.filter( IsWaiting ).length;
	if ( waiting > 0 )
	{
		return { Ok: false, Reason: waiting + ' resolved thread' + ( waiting === 1 ? ' is' : 's are' ) + ' waiting to be applied' };
	}
	return { Ok: true };
}


//---------------------------------------------------------------------
// Effects: what an action changes. Each returns the fields to merge.

// A reply to a resolved thread reopens it: contested again, marked reopened. An applied change stays applied.
function ReplyEffect( Thread )
{
	if ( Thread.Status === 'consensus' )
	{
		return { Reopen: true, Status: 'contested', Reopened: true, Resolved: null };
	}
	return { Reopen: false };
}


// Any text change, new thread or reply sets the proposal back to contested; a Plan returns to the Proposals list.
function EditEffect( Proposal )
{
	return { Status: 'contested', Approved: null };
}


function CommentEffect( Proposal )
{
	return EditEffect( Proposal );
}


function ResolveEffect( Who, At )
{
	return { Status: 'consensus', Reopened: false, Resolved: { By: Who.Name, At: At } };
}


function ApplyEffect( Who, At, Revision, Outcome )
{
	return { Applied: { By: Who.Name, At: At, Revision: Revision, Outcome: Outcome } };
}


function ApproveEffect( Who, At, Proposal )
{
	return { Status: 'consensus', Approved: { By: Who.Name, At: At, Revision: Proposal.Revision } };
}


//---------------------------------------------------------------------
// WaitingOn: the threads waiting on one participant.

function WaitingOn( Name, Threads, Participants )
{
	return Threads.filter( function ( thread ) { return Turn( thread, Participants ).includes( Name ); } );
}


//---------------------------------------------------------------------
// Filter: threads by the page's filter names.
//   all | contested | consensus (resolved, applied or not) | waiting (resolved, unapplied) | applied | reopened | detached | mine

function Filter( Threads, Status, Participants, Name )
{
	switch ( Status || 'all' )
	{
		case 'all':
			return Threads.slice();
		case 'contested':
			return Threads.filter( function ( thread ) { return thread.Status === 'contested'; } );
		case 'consensus':
			return Threads.filter( function ( thread ) { return thread.Status === 'consensus'; } );
		case 'waiting':
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
	CanApprove: CanApprove,
	ReplyEffect: ReplyEffect,
	EditEffect: EditEffect,
	CommentEffect: CommentEffect,
	ResolveEffect: ResolveEffect,
	ApplyEffect: ApplyEffect,
	ApproveEffect: ApproveEffect,
	WaitingOn: WaitingOn,
	Filter: Filter,
};
