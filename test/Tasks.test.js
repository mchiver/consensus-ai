'use strict';

// The tasks (plan LLM Tasks, Step 1): the records filled, the shipped set, the migration of a settings file from
// before, the problems named, enabling per project, and the settings' Clean and Validate through Participants.js.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const TASKS = require( '../src/Tasks.js' );
const PARTICIPANTS = require( '../src/Participants.js' );
const LLMS = require( '../src/Llms.js' );


TEST( 'a task is filled with an id, every switch and a level; the shipped set is Answer, Work and Session', function ()
{
	let filled = TASKS.Fill( { Name: ' Explain ', Package: { Threads: false }, Writes: 'none', Prompt: 'Explain it.' } );
	ASSERT.match( filled.Id, /^tsk-[0-9a-z]{3}-[0-9a-z]{3}-[0-9a-z]{3}$/ );
	ASSERT.deepEqual( filled, { Id: filled.Id, Name: 'Explain', Package: { Instructions: true, Readme: true, Documents: true, Plan: true, Threads: false, Files: true }, Writes: 'none', Prompt: 'Explain it.' } );
	ASSERT.equal( TASKS.Fill( { Id: 'x', Writes: 'everything' } ).Writes, 'consensus' );
	ASSERT.equal( TASKS.Fill( null ).Name, '' );
	let defaults = TASKS.Defaults();
	ASSERT.deepEqual( defaults.map( function ( task ) { return [ task.Id, task.Name, task.Writes ]; } ), [ [ 'answer', 'Answer', 'consensus' ], [ 'work', 'Work', 'files' ], [ 'session', 'Session', 'files' ] ] );
	ASSERT.deepEqual( defaults[ 0 ].Package, { Instructions: true, Readme: true, Documents: true, Plan: true, Threads: true, Files: true } );
	ASSERT.equal( defaults[ 1 ].Package.Threads, false );
	ASSERT.deepEqual( [ defaults[ 2 ].Package.Plan, defaults[ 2 ].Package.Threads, defaults[ 2 ].Prompt ], [ false, false, '' ] );
	ASSERT.match( defaults[ 0 ].Prompt, /the threads waiting on you/ );
	ASSERT.equal( TASKS.DefaultOf( 'work' ).Prompt, TASKS.PROMPTS.Work );
	ASSERT.equal( TASKS.DefaultOf( 'nope' ), null );
	// a fresh copy each time
	defaults[ 0 ].Name = 'changed';
	ASSERT.equal( TASKS.Defaults()[ 0 ].Name, 'Answer' );
	ASSERT.match( TASKS.WritesLine( 'none' ), /^none\. This run reads only/ );
	ASSERT.match( TASKS.WritesLine( 'files' ), /^files\./ );
	ASSERT.match( TASKS.WritesLine( 'what' ), /^consensus\./ );
} );


TEST( 'a settings file from before: the Tasks list made, a connection\'s own Review and Build prompts moved onto Answer and Work, the Checks dropped', function ()
{
	let settings = { Name: 's', Scope: 'Local', Owner: { Name: 'user' }, Llms: [
		{ Id: 'llm-1', Name: 'a', Kind: 'claude-cli', Checks: { Readme: false }, Prompts: { Review: TASKS.OLD_PROMPTS.Review, Build: 'Build it my way.', Session: 'Be brief.' } },
		{ Id: 'llm-2', Name: 'b', Kind: 'claude-cli', Prompts: { Review: 'Review it my way.', Build: 'Another build.' } },
	] };
	ASSERT.deepEqual( PARTICIPANTS.Migrate( settings ), [
		'Tasks set to the default set: Answer, Work, Session',
		'the Review prompt of the LLM connection "b" became the Answer task\'s',
		'the Build prompt of the LLM connection "a" became the Work task\'s',
		'the Checks and the Review and Build prompts of the LLM connections a, b dropped: the package and the prompt are the task\'s',
	] );
	ASSERT.equal( TASKS.ById( settings, 'answer' ).Prompt, 'Review it my way.' );
	ASSERT.equal( TASKS.ById( settings, 'work' ).Prompt, 'Build it my way.' );
	ASSERT.equal( TASKS.ById( settings, 'session' ).Prompt, '' );
	ASSERT.deepEqual( settings.Llms[ 0 ].Prompts, { Session: 'Be brief.' } );
	ASSERT.equal( 'Checks' in settings.Llms[ 0 ], false );
	ASSERT.deepEqual( settings.Llms[ 1 ].Prompts, {} );
	// filled by Llms: the Session prompt only, no Checks
	let filled = LLMS.Fill( settings.Llms[ 1 ] );
	ASSERT.deepEqual( filled.Prompts, { Session: '' } );
	ASSERT.equal( 'Checks' in filled, false );
	// a second start changes nothing; a list present is kept, each filled
	ASSERT.deepEqual( PARTICIPANTS.Migrate( settings ), [] );
	let kept = { Name: 's', Scope: 'Local', Owner: { Name: 'user' }, Tasks: [ { Id: 'mine', Name: 'Mine', Writes: 'none' } ] };
	ASSERT.deepEqual( PARTICIPANTS.Migrate( kept ), [] );
	ASSERT.deepEqual( kept.Tasks[ 0 ].Package, { Instructions: true, Readme: true, Documents: true, Plan: true, Threads: true, Files: true } );
	// the defaults with no connections
	let bare = { Name: 's', Scope: 'Local', Owner: { Name: 'user' } };
	PARTICIPANTS.Migrate( bare );
	ASSERT.equal( bare.Tasks.length, 3 );
	ASSERT.equal( bare.Tasks[ 0 ].Prompt, TASKS.PROMPTS.Answer );
} );


TEST( 'the problems are named, and the settings\' Clean and Validate carry the Tasks', function ()
{
	ASSERT.deepEqual( TASKS.Problems( { Tasks: TASKS.Defaults() } ), [] );
	ASSERT.deepEqual( TASKS.Problems( { Tasks: 'x' } ), [ 'Tasks must be a list' ] );
	ASSERT.deepEqual( TASKS.Problems( { Tasks: [ null ] } ), [ 'a task is not an object' ] );
	ASSERT.deepEqual( TASKS.Problems( { Tasks: [ TASKS.Fill( { Id: 'a', Name: 'A' } ), TASKS.Fill( { Id: 'a', Name: 'A' } ) ] } ), [ 'task "A" is named twice', 'task "A": the Id is missing or used twice' ] );
	ASSERT.deepEqual( TASKS.Problems( { Tasks: [ { Id: 'a', Name: '', Writes: 'all', Package: {}, Prompt: 1 } ] } ), [
		'a task has no Name',
		'task "?": Writes is "all", not one of none, consensus, files',
		'task "?": the Package must switch each of Instructions, Readme, Documents, Plan, Threads, Files',
		'task "?": the Prompt must be text',
	] );
	let settings = PARTICIPANTS.DefaultSettings( 0 );
	ASSERT.deepEqual( PARTICIPANTS.Validate( Object.assign( {}, settings, { Tasks: 'x' } ) ), [ 'Tasks must be a list' ] );
	let clean = PARTICIPANTS.Clean( { Name: 's', Tasks: [ { Id: ' answer ', Name: ' Answer ', Writes: 'consensus', Prompt: 'p' }, { Name: 'New' } ] } );
	ASSERT.deepEqual( [ clean.Tasks[ 0 ].Id, clean.Tasks[ 0 ].Name, clean.Tasks[ 0 ].Package.Files ], [ 'answer', 'Answer', true ] );
	ASSERT.match( clean.Tasks[ 1 ].Id, /^tsk-/ );
	ASSERT.deepEqual( PARTICIPANTS.Validate( clean ), [] );
	ASSERT.deepEqual( PARTICIPANTS.Clean( { Tasks: 'x' } ).Tasks, [] );
	ASSERT.equal( 'Tasks' in PARTICIPANTS.Clean( { Name: 's' } ), false );
} );


TEST( 'a project enables the tasks it lists; no list enables them all', function ()
{
	let settings = { Tasks: TASKS.Defaults() };
	ASSERT.deepEqual( TASKS.Enabled( settings, { Id: 'p' } ).map( function ( task ) { return task.Id; } ), [ 'answer', 'work', 'session' ] );
	ASSERT.deepEqual( TASKS.Enabled( settings, { Id: 'p', Tasks: [ 'session', 'answer', 'gone' ] } ).map( function ( task ) { return task.Id; } ), [ 'answer', 'session' ] );
	ASSERT.deepEqual( TASKS.Enabled( settings, { Id: 'p', Tasks: [] } ), [] );
	ASSERT.equal( TASKS.IsEnabled( settings, { Tasks: [ 'work' ] }, 'answer' ), false );
	ASSERT.equal( TASKS.IsEnabled( settings, null, 'answer' ), true );
	ASSERT.deepEqual( TASKS.Enabled( {}, null ), [] );
} );
