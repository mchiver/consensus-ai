'use strict';

// Every carried-over rule and every default of the plan, as a case.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const RULES = require( '../src/Rules.js' );

const PARTICIPANTS = [
	{ Name: 'user', Display: 'User', Role: 'owner' },
	{ Name: 'llm', Display: 'LLM', Role: 'llm' },
];
const OWNER = PARTICIPANTS[ 0 ];
const LLM = PARTICIPANTS[ 1 ];
const MEMBER = { Name: 'ann', Display: 'Ann', Role: 'member' };


function thread( overrides )
{
	return Object.assign( {
		Id: 't1', Anchor: { Text: 'words' }, Detached: false, Status: 'contested', Reopened: false,
		Resolved: null, Applied: null, Replies: [ { Id: 'r1', By: 'user', At: '2026-09-24T00:00:00Z', Text: 'a comment' } ],
	}, overrides || {} );
}


function proposal( overrides )
{
	return Object.assign( { Id: 'p', Title: 'P', State: 'Proposal', Revision: 3 }, overrides || {} );
}


//---------------------------------------------------------------------

TEST( 'a contested thread waits on everyone except the last replier', function ()
{
	ASSERT.deepEqual( RULES.Turn( thread(), PARTICIPANTS ), [ 'llm' ] );
	let answered = thread( { Replies: [ { By: 'user', Text: 'q' }, { By: 'llm', Text: 'a' } ] } );
	ASSERT.deepEqual( RULES.Turn( answered, PARTICIPANTS ), [ 'user' ] );
	ASSERT.deepEqual( RULES.Turn( answered, PARTICIPANTS.concat( [ MEMBER ] ) ), [ 'user', 'ann' ] );
} );


TEST( 'a resolved, unapplied thread waits on every llm participant', function ()
{
	let resolved = thread( { Status: 'resolved', Resolved: { By: 'user', At: 'now' } } );
	ASSERT.deepEqual( RULES.Turn( resolved, PARTICIPANTS ), [ 'llm' ] );
	ASSERT.deepEqual( RULES.Turn( resolved, PARTICIPANTS.concat( [ { Name: 'llm2', Role: 'llm' } ] ) ), [ 'llm', 'llm2' ] );
} );


TEST( 'an applied thread waits on nobody', function ()
{
	let applied = thread( { Status: 'resolved', Applied: { By: 'llm', At: 'now', Revision: 4, Outcome: 'done' } } );
	ASSERT.deepEqual( RULES.Turn( applied, PARTICIPANTS ), [] );
} );


TEST( 'only the owner resolves, and only a contested thread with a reply', function ()
{
	ASSERT.equal( RULES.CanResolve( OWNER, thread() ).Ok, true );
	ASSERT.equal( RULES.CanResolve( LLM, thread() ).Ok, false );
	ASSERT.equal( RULES.CanResolve( MEMBER, thread() ).Ok, false );
	ASSERT.equal( RULES.CanResolve( null, thread() ).Ok, false );
	ASSERT.equal( RULES.CanResolve( OWNER, thread( { Status: 'resolved' } ) ).Ok, false );
	ASSERT.equal( RULES.CanResolve( OWNER, thread( { Replies: [] } ) ).Ok, false );
} );


TEST( 'resolving marks resolved and clears reopened', function ()
{
	let effect = RULES.ResolveEffect( OWNER, 'at' );
	ASSERT.deepEqual( effect, { Status: 'resolved', Reopened: false, Resolved: { By: 'user', At: 'at' } } );
} );


TEST( 'any participant applies, but only a resolved, unapplied thread', function ()
{
	let resolved = thread( { Status: 'resolved' } );
	ASSERT.equal( RULES.CanApply( LLM, resolved ).Ok, true );
	ASSERT.equal( RULES.CanApply( OWNER, resolved ).Ok, true );
	ASSERT.equal( RULES.CanApply( MEMBER, resolved ).Ok, true );
	ASSERT.equal( RULES.CanApply( LLM, thread() ).Ok, false );
	ASSERT.equal( RULES.CanApply( LLM, thread( { Status: 'resolved', Applied: { By: 'llm' } } ) ).Ok, false );
	ASSERT.equal( RULES.CanApply( null, resolved ).Ok, false );
} );


TEST( 'only the owner deletes a thread', function ()
{
	ASSERT.equal( RULES.CanDeleteThread( OWNER ).Ok, true );
	ASSERT.equal( RULES.CanDeleteThread( LLM ).Ok, false );
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
	ASSERT.equal( RULES.Tally( proposal(), [ reopened ], PARTICIPANTS ).Reopened, 1 );
	ASSERT.equal( RULES.Tally( proposal(), [ reopened ], PARTICIPANTS ).Applied, 0 );
} );


TEST( 'applying records who, when, the revision and the outcome', function ()
{
	ASSERT.deepEqual( RULES.ApplyEffect( LLM, 'at', 5, 'rev-aaa-bbb-ccc', 'dropped' ), { Applied: { By: 'llm', At: 'at', Revision: 5, RevisionId: 'rev-aaa-bbb-ccc', Outcome: 'dropped' } } );
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


TEST( 'a proposal\'s state is any of the settings\' States (user, 2026-09-25)', function ()
{
	let states = [ 'Proposal', 'Plan', 'Working', 'Finished' ];
	ASSERT.equal( RULES.CanSetState( 'Working', states ).Ok, true );
	ASSERT.equal( RULES.CanSetState( 'Proposal', states ).Ok, true );
	ASSERT.equal( RULES.CanSetState( 'Done', states ).Ok, false );
	ASSERT.match( RULES.CanSetState( 'Done', states ).Reason, /Proposal, Plan, Working, Finished/ );
	ASSERT.equal( RULES.CanSetState( undefined, states ).Ok, false );
	ASSERT.equal( RULES.CanSetState( 3, states ).Ok, false );
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
	let tally = RULES.Tally( proposal(), threads, PARTICIPANTS );
	ASSERT.equal( tally.Total, 5 );
	ASSERT.equal( tally.Contested, 2 );
	ASSERT.equal( tally.Reopened, 1 );
	ASSERT.equal( tally.Resolved, 1 );
	ASSERT.equal( tally.Applied, 2 );
	ASSERT.equal( tally.Detached, 1 );
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
	let tally = RULES.Tally( proposal(), threads, PARTICIPANTS );
	ASSERT.equal( RULES.StateLine( tally, 'user' ), '2 contested, waiting on you 1 · 1 resolved · 1 applied' );
	ASSERT.equal( RULES.StateLine( tally, 'llm' ), '2 contested, waiting on you 2 · 1 resolved · 1 applied' );
	let done = RULES.Tally( proposal(), [ threads[ 3 ] ], PARTICIPANTS );
	ASSERT.equal( RULES.StateLine( done, 'user' ), '1 applied' );
	ASSERT.equal( RULES.StateLine( RULES.Tally( proposal(), [], PARTICIPANTS ), 'user' ), 'no threads yet' );
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
	ASSERT.equal( RULES.Filter( threads, 'nonsense' ), null );
} );
