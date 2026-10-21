'use strict';

// Every carried-over rule and every default of the plan, as a case. The rules among many parties are plan
// Multiuser's (Step 1): resolve by the starter or an Owner, the waiting rule over the parties, apply by write
// access, the State by Owners; a resolved thread waits on the LLM speakers, never on a person (2026-10-22).

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const RULES = require( '../src/Rules.js' );

// The speakers the rules run over: the server's owner, its LLM connection, and the people and services seen.
const PARTICIPANTS = [
	{ Name: 'user', Display: 'User', Role: 'owner', Owner: true },
	{ Name: 'llm', Display: 'LLM', Role: 'llm' },
];
const ANN_SPEAKER = { Name: 'ann', Display: 'Ann', Role: 'user' };
const OLGA_SPEAKER = { Name: 'olga', Display: 'Olga', Role: 'user', Owner: true };
const MANY = PARTICIPANTS.concat( [ ANN_SPEAKER, OLGA_SPEAKER ] );

// The accounts that act, as Identify builds them, their project role found by the API.
const OWNER = { Name: 'user', Display: 'User', Role: 'owner' };
const LLM = { Name: 'user', Display: 'User', Role: 'owner', Service: 'llm' };
const OLGA = { Name: 'olga', Display: 'Olga', Role: 'user', ProjectRole: 'Owners' };
const MEMBER = { Name: 'ann', Display: 'Ann', Role: 'user', ProjectRole: 'Members' };
const SERVICE = { Name: 'nightly', Display: 'nightly', Role: 'service', ProjectRole: 'Service' };
const WATCHER = { Name: 'wim', Display: 'Wim', Role: 'user', ProjectRole: 'Watchers' };
const NOBODY = { Name: 'zed', Display: 'Zed', Role: 'user' };


function thread( overrides )
{
	return Object.assign( {
		Id: 't1', Anchor: { Text: 'words' }, Detached: false, Status: 'contested', Reopened: false,
		Resolved: null, Applied: null, Replies: [ { Id: 'r1', By: 'user', At: '2026-09-24T00:00:00Z', Text: 'a comment' } ],
	}, overrides || {} );
}


function plan( overrides )
{
	return Object.assign( { Id: 'p', Title: 'P', State: 'Plan', Revision: 3 }, overrides || {} );
}


//---------------------------------------------------------------------

TEST( 'a contested thread waits on its parties, the starter, the Owners, the repliers and the LLM speakers, except the last replier', function ()
{
	ASSERT.deepEqual( RULES.Turn( thread(), PARTICIPANTS ), [ 'llm' ] );
	let answered = thread( { Replies: [ { By: 'user', Text: 'q' }, { By: 'llm', Text: 'a' } ] } );
	ASSERT.deepEqual( RULES.Turn( answered, PARTICIPANTS ), [ 'user' ] );
	// a Member who has not joined in is a bystander; an Owner is always a party
	ASSERT.deepEqual( RULES.Turn( answered, MANY ), [ 'user', 'olga' ] );
	// a Member who replied is a party from then on
	let joined = thread( { Replies: [ { By: 'user', Text: 'q' }, { By: 'ann', Text: 'me too' }, { By: 'llm', Text: 'a' } ] } );
	ASSERT.deepEqual( RULES.Turn( joined, MANY ), [ 'user', 'ann', 'olga' ] );
	// a thread a Member started waits on the Owners and the LLM, not on the other Members
	let anns = thread( { Replies: [ { By: 'ann', Text: 'q' } ] } );
	ASSERT.deepEqual( RULES.Turn( anns, MANY.concat( [ { Name: 'bob', Role: 'user' } ] ) ), [ 'user', 'llm', 'olga' ] );
	// the byline is the speaker: the owner's reply through a connection leaves the owner waited on
	let through = thread( { Replies: [ { By: 'user', Text: 'q' }, { By: 'user', Service: 'llm', Text: 'a' } ] } );
	ASSERT.deepEqual( RULES.Turn( through, [ PARTICIPANTS[ 0 ], { Name: 'llm by user', Role: 'llm' } ] ), [ 'user' ] );
} );


TEST( 'a resolved, unapplied thread waits on the LLM speakers that apply it, never on a person', function ()
{
	let resolved = thread( { Status: 'resolved', Resolved: { By: 'user', At: 'now' } } );
	ASSERT.deepEqual( RULES.Turn( resolved, PARTICIPANTS ), [ 'llm' ] );
	ASSERT.deepEqual( RULES.Turn( resolved, MANY ), [ 'llm' ] );
	ASSERT.deepEqual( RULES.Turn( resolved, PARTICIPANTS.concat( [ { Name: 'claude by user', Role: 'llm' } ] ) ), [ 'llm', 'claude by user' ] );
	let anns = thread( { Status: 'resolved', Resolved: { By: 'olga', At: 'now' }, Replies: [ { By: 'ann', Text: 'q' }, { By: 'llm', Text: 'a' } ] } );
	ASSERT.deepEqual( RULES.Turn( anns, MANY ), [ 'llm' ] );
	// no LLM about: it waits on nobody until something applies it, and the resolved count says so
	ASSERT.deepEqual( RULES.Turn( resolved, [ PARTICIPANTS[ 0 ], OLGA_SPEAKER ] ), [] );
} );


TEST( 'an applied thread waits on nobody', function ()
{
	let applied = thread( { Status: 'resolved', Applied: { By: 'llm', At: 'now', Revision: 4, Outcome: 'done' } } );
	ASSERT.deepEqual( RULES.Turn( applied, PARTICIPANTS ), [] );
} );


TEST( 'the starter or an Owner resolves, and only a contested thread with a reply', function ()
{
	ASSERT.equal( RULES.CanResolve( OWNER, thread() ).Ok, true );
	ASSERT.equal( RULES.CanResolve( LLM, thread() ).Ok, true );
	ASSERT.equal( RULES.CanResolve( OLGA, thread() ).Ok, true );
	ASSERT.equal( RULES.CanResolve( MEMBER, thread() ).Ok, false );
	ASSERT.equal( RULES.CanResolve( MEMBER, thread() ).Reason, 'a Member resolves the threads they started' );
	ASSERT.equal( RULES.CanResolve( MEMBER, thread( { Replies: [ { By: 'ann', Text: 'mine' } ] } ) ).Ok, true );
	ASSERT.equal( RULES.CanResolve( SERVICE, thread( { Replies: [ { By: 'nightly', Text: 'its own' } ] } ) ).Ok, false );
	ASSERT.equal( RULES.CanResolve( WATCHER, thread() ).Ok, false );
	ASSERT.equal( RULES.CanResolve( NOBODY, thread() ).Ok, false );
	ASSERT.equal( RULES.CanResolve( NOBODY, thread() ).Reason, 'a thread is resolved by the one who started it, or an Owner' );
	ASSERT.equal( RULES.CanResolve( null, thread() ).Ok, false );
	ASSERT.equal( RULES.CanResolve( OWNER, thread( { Status: 'resolved' } ) ).Ok, false );
	ASSERT.equal( RULES.CanResolve( OWNER, thread( { Replies: [] } ) ).Ok, false );
} );


TEST( 'resolving marks resolved and clears reopened', function ()
{
	let effect = RULES.ResolveEffect( OWNER, 'at' );
	ASSERT.deepEqual( effect, { Status: 'resolved', Reopened: false, Resolved: { By: 'user', At: 'at' } } );
} );


TEST( 'anyone with write access applies, but only a resolved, unapplied thread', function ()
{
	let resolved = thread( { Status: 'resolved' } );
	ASSERT.equal( RULES.CanApply( LLM, resolved ).Ok, true );
	ASSERT.equal( RULES.CanApply( OWNER, resolved ).Ok, true );
	ASSERT.equal( RULES.CanApply( OLGA, resolved ).Ok, true );
	ASSERT.equal( RULES.CanApply( MEMBER, resolved ).Ok, true );
	ASSERT.equal( RULES.CanApply( SERVICE, resolved ).Ok, true );
	ASSERT.equal( RULES.CanApply( WATCHER, resolved ).Ok, false );
	ASSERT.equal( RULES.MayApply( WATCHER ).Reason, 'applying a thread takes write access: an Owner, a Member or a Service account' );
	ASSERT.equal( RULES.CanApply( NOBODY, resolved ).Ok, false );
	ASSERT.equal( RULES.CanApply( LLM, thread() ).Ok, false );
	ASSERT.equal( RULES.CanApply( LLM, thread( { Status: 'resolved', Applied: { By: 'llm' } } ) ).Ok, false );
	ASSERT.equal( RULES.CanApply( null, resolved ).Ok, false );
	ASSERT.equal( RULES.MayApply( null ).Ok, false );
} );


TEST( 'only an Owner deletes a thread', function ()
{
	ASSERT.equal( RULES.CanDeleteThread( OWNER ).Ok, true );
	ASSERT.equal( RULES.CanDeleteThread( LLM ).Ok, true );
	ASSERT.equal( RULES.CanDeleteThread( OLGA ).Ok, true );
	ASSERT.equal( RULES.CanDeleteThread( MEMBER ).Ok, false );
	ASSERT.equal( RULES.CanDeleteThread( null ).Ok, false );
} );


TEST( 'a reopened, applied thread that is resolved again waits to be applied again', function ()
{
	let again = thread( { Status: 'resolved', Applied: { By: 'llm', At: '2026-09-24T01:00:00Z', Revision: 2, Outcome: 'first' }, Resolved: { By: 'user', At: '2026-09-24T02:00:00Z' } } );
	ASSERT.equal( RULES.IsWaiting( again ), true );
	ASSERT.equal( RULES.IsApplied( again ), false );
	ASSERT.equal( RULES.CanApply( LLM, again ).Ok, true );
	ASSERT.deepEqual( RULES.Turn( again, PARTICIPANTS ), [ 'llm' ] );
	let done = thread( { Status: 'resolved', Resolved: { By: 'user', At: '2026-09-24T02:00:00Z' }, Applied: { By: 'llm', At: '2026-09-24T03:00:00Z', Revision: 3, Outcome: 'second' } } );
	ASSERT.equal( RULES.IsWaiting( done ), false );
	ASSERT.equal( RULES.IsApplied( done ), true );
	ASSERT.deepEqual( RULES.Turn( done, PARTICIPANTS ), [] );
	let reopened = thread( { Status: 'contested', Reopened: true, Applied: { By: 'llm', At: 'x' }, Replies: [ { By: 'user' }, { By: 'llm' }, { By: 'user' } ] } );
	ASSERT.equal( RULES.IsApplied( reopened ), false );
	ASSERT.deepEqual( RULES.Turn( reopened, PARTICIPANTS ), [ 'llm' ] );
	ASSERT.equal( RULES.Tally( plan(), [ reopened ], PARTICIPANTS ).Reopened, 1 );
	ASSERT.equal( RULES.Tally( plan(), [ reopened ], PARTICIPANTS ).Applied, 0 );
} );


TEST( 'applying records who, when, the revision and the outcome', function ()
{
	ASSERT.deepEqual( RULES.ApplyEffect( MEMBER, 'at', 5, 'rev-aaa-bbb-ccc', 'dropped' ), { Applied: { By: 'ann', At: 'at', Revision: 5, RevisionId: 'rev-aaa-bbb-ccc', Outcome: 'dropped' } } );
	ASSERT.deepEqual( RULES.ApplyEffect( LLM, 'at', 5, 'rev-aaa-bbb-ccc', 'dropped' ), { Applied: { By: 'user', Service: 'llm', At: 'at', Revision: 5, RevisionId: 'rev-aaa-bbb-ccc', Outcome: 'dropped' } } );
} );


TEST( 'a reply to a resolved thread reopens it as contested, marked reopened; a reply to a contested thread does not', function ()
{
	let resolved = thread( { Status: 'resolved', Resolved: { By: 'user' } } );
	ASSERT.deepEqual( RULES.ReplyEffect( resolved ), { Reopen: true, Status: 'contested', Reopened: true, Resolved: null } );
	ASSERT.deepEqual( RULES.ReplyEffect( thread() ), { Reopen: false } );
} );


TEST( 'reopening an applied thread keeps its applied record', function ()
{
	let applied = thread( { Status: 'resolved', Applied: { By: 'llm', Revision: 4, Outcome: 'changed' } } );
	let effect = RULES.ReplyEffect( applied );
	ASSERT.equal( effect.Reopen, true );
	ASSERT.equal( 'Applied' in effect, false );
	Object.assign( applied, effect );
	ASSERT.equal( applied.Applied.Revision, 4 );
	ASSERT.equal( applied.Status, 'contested' );
} );


TEST( 'a plan\'s state is any of the settings\' States (user, 2026-09-25), set by an Owner (plan Multiuser)', function ()
{
	let states = [ 'Plan', 'Plan', 'Working', 'Finished' ];
	ASSERT.equal( RULES.CanSetState( 'Working', states ).Ok, true );
	ASSERT.equal( RULES.CanSetState( 'Plan', states ).Ok, true );
	ASSERT.equal( RULES.CanSetState( 'Done', states ).Ok, false );
	ASSERT.match( RULES.CanSetState( 'Done', states ).Reason, /Plan, Plan, Working, Finished/ );
	ASSERT.equal( RULES.CanSetState( undefined, states ).Ok, false );
	ASSERT.equal( RULES.CanSetState( 3, states ).Ok, false );
	ASSERT.equal( RULES.MaySetState( OWNER ).Ok, true );
	ASSERT.equal( RULES.MaySetState( LLM ).Ok, true );
	ASSERT.equal( RULES.MaySetState( OLGA ).Ok, true );
	ASSERT.equal( RULES.MaySetState( MEMBER ).Ok, false );
	ASSERT.equal( RULES.MaySetState( MEMBER ).Reason, 'only an Owner sets a plan\'s State' );
	ASSERT.equal( RULES.MaySetState( SERVICE ).Ok, false );
	ASSERT.equal( RULES.MaySetState( null ).Ok, false );
} );


TEST( 'the tally counts contested, reopened, resolved, applied and detached, and who each waits on', function ()
{
	let threads = [
		thread( { Id: 'a' } ),
		thread( { Id: 'b', Reopened: true, Replies: [ { By: 'user' }, { By: 'llm' } ] } ),
		thread( { Id: 'c', Status: 'resolved' } ),
		thread( { Id: 'd', Status: 'resolved', Applied: { By: 'llm' } } ),
		thread( { Id: 'e', Detached: true, Status: 'resolved', Applied: { By: 'llm' } } ),
	];
	let tally = RULES.Tally( plan(), threads, PARTICIPANTS );
	ASSERT.equal( tally.Total, 5 );
	ASSERT.equal( tally.Contested, 2 );
	ASSERT.equal( tally.Reopened, 1 );
	ASSERT.equal( tally.Resolved, 1 );
	ASSERT.equal( tally.Applied, 2 );
	ASSERT.equal( tally.Detached, 1 );
	// the owner is waited on by b (the llm replied last); the llm by a and by c (resolved, its to apply)
	ASSERT.deepEqual( tally.WaitingOn, { user: 1, llm: 2 } );
	ASSERT.equal( 'Approvable' in tally, false );
} );


TEST( 'the state line says what to do next', function ()
{
	let threads = [
		thread( { Id: 'a' } ),
		thread( { Id: 'b', Replies: [ { By: 'user' }, { By: 'llm' } ] } ),
		thread( { Id: 'c', Status: 'resolved' } ),
		thread( { Id: 'd', Status: 'resolved', Applied: { By: 'llm' } } ),
	];
	let tally = RULES.Tally( plan(), threads, PARTICIPANTS );
	ASSERT.equal( RULES.StateLine( tally, 'user' ), 'waiting on you 1 · 2 contested · 1 resolved · 1 applied' );
	ASSERT.equal( RULES.StateLine( tally, 'llm' ), 'waiting on you 2 · 2 contested · 1 resolved · 1 applied' );
	ASSERT.equal( RULES.StateLine( RULES.Tally( plan(), [ thread( { Reopened: true } ) ], PARTICIPANTS ), 'llm' ), 'waiting on you 1 · 1 contested, 1 reopened' );
	let done = RULES.Tally( plan(), [ threads[ 3 ] ], PARTICIPANTS );
	ASSERT.equal( RULES.StateLine( done, 'user' ), '1 applied' );
	ASSERT.equal( RULES.StateLine( RULES.Tally( plan(), [], PARTICIPANTS ), 'user' ), 'no threads yet' );
} );


TEST( 'waiting on a name lists that participant\'s threads', function ()
{
	let threads = [
		thread( { Id: 'a' } ),
		thread( { Id: 'b', Replies: [ { By: 'user' }, { By: 'llm' } ] } ),
		thread( { Id: 'c', Status: 'resolved' } ),
	];
	ASSERT.deepEqual( RULES.WaitingOn( 'llm', threads, PARTICIPANTS ).map( function ( t ) { return t.Id; } ), [ 'a', 'c' ] );
	ASSERT.deepEqual( RULES.WaitingOn( 'user', threads, PARTICIPANTS ).map( function ( t ) { return t.Id; } ), [ 'b' ] );
} );


TEST( 'threads filter by status', function ()
{
	let threads = [
		thread( { Id: 'a' } ),
		thread( { Id: 'b', Reopened: true } ),
		thread( { Id: 'c', Status: 'resolved' } ),
		thread( { Id: 'd', Status: 'resolved', Applied: { By: 'llm' }, Detached: true } ),
	];
	function ids( status ) { return RULES.Filter( threads, status, PARTICIPANTS, 'llm' ).map( function ( t ) { return t.Id; } ); }
	ASSERT.deepEqual( ids( 'all' ), [ 'a', 'b', 'c', 'd' ] );
	ASSERT.deepEqual( ids( undefined ), [ 'a', 'b', 'c', 'd' ] );
	ASSERT.deepEqual( ids( 'contested' ), [ 'a', 'b' ] );
	ASSERT.deepEqual( ids( 'resolved' ), [ 'c' ] );
	ASSERT.equal( RULES.Filter( threads, 'consensus' ), null );
	ASSERT.equal( RULES.Filter( threads, 'waiting' ), null );
	ASSERT.deepEqual( ids( 'applied' ), [ 'd' ] );
	ASSERT.deepEqual( ids( 'reopened' ), [ 'b' ] );
	ASSERT.deepEqual( ids( 'detached' ), [ 'd' ] );
	ASSERT.deepEqual( ids( 'mine' ), [ 'a', 'b', 'c' ] );
	ASSERT.deepEqual( RULES.Filter( threads, 'mine', PARTICIPANTS, 'user' ).map( function ( t ) { return t.Id; } ), [] );
	ASSERT.equal( RULES.Filter( threads, 'nonsense' ), null );
} );
