'use strict';

// The tasks (plan LLM Tasks, Step 1): the records filled, the shipped set, a settings file prepared at start, the
// problems named, enabling per project, and the settings' Clean and Validate through Participants.js.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const TASKS = require( '../src/Tasks.js' );
const PARTICIPANTS = require( '../src/Participants.js' );
const LLMS = require( '../src/Llms.js' );


TEST( 'a task is filled with an id, every switch (Project and Box off) and a level; the shipped set is Answer, Enhance, Work, Explain and Session', function ()
{
	let filled = TASKS.Fill( { Name: ' Explain ', Package: { Threads: false }, Writes: 'none', Prompt: 'Explain it.' } );
	ASSERT.match( filled.Id, /^tsk-[0-9a-z]{3}-[0-9a-z]{3}-[0-9a-z]{3}$/ );
	ASSERT.deepEqual( filled, { Id: filled.Id, Name: 'Explain', Package: { Instructions: true, Readme: true, Documents: true, Plan: true, Threads: false, Files: true, Project: false, Box: false }, Writes: 'none', Prompt: 'Explain it.' } );
	ASSERT.equal( TASKS.Fill( { Id: 'x', Writes: 'everything' } ).Writes, 'consensus' );
	ASSERT.equal( TASKS.Fill( null ).Name, '' );
	let defaults = TASKS.Defaults();
	ASSERT.deepEqual( defaults.map( function ( task ) { return [ task.Id, task.Name, task.Writes ]; } ), [ [ 'answer', 'Answer', 'consensus' ], [ 'enhance', 'Enhance', 'consensus' ], [ 'work', 'Work', 'files' ], [ 'explain', 'Explain', 'none' ], [ 'session', 'Session', 'files' ] ] );
	ASSERT.deepEqual( defaults[ 0 ].Package, { Instructions: true, Readme: true, Documents: true, Plan: true, Threads: true, Files: true, Project: false, Box: false } );
	ASSERT.deepEqual( defaults[ 1 ].Package, { Instructions: true, Readme: true, Documents: true, Plan: true, Threads: false, Files: false, Project: false, Box: true } );
	ASSERT.deepEqual( defaults[ 3 ].Package, { Instructions: true, Readme: true, Documents: true, Plan: false, Threads: false, Files: true, Project: true, Box: true } );
	ASSERT.match( defaults[ 3 ].Prompt, /Post nothing: your answer is your output/ );
	ASSERT.equal( 'Since' in defaults[ 3 ], false );
	ASSERT.match( defaults[ 1 ].Prompt, /Replace the plan's text with a detailed plan/ );
	ASSERT.equal( defaults[ 2 ].Package.Threads, false );
	ASSERT.deepEqual( [ defaults[ 4 ].Package.Plan, defaults[ 4 ].Package.Threads, defaults[ 4 ].Prompt ], [ false, false, '' ] );
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


TEST( 'Prepare: a settings file with no Tasks gets the shipped set; a list below TasksVersion gets the shipped tasks that came after it, once', function ()
{
	let settings = { Name: 's', Scope: 'Local', Owner: { Name: 'user' } };
	ASSERT.deepEqual( TASKS.Prepare( settings ), [ 'Tasks set to the default set: Answer, Enhance, Work, Explain, Session' ] );
	ASSERT.deepEqual( settings.Tasks.map( function ( task ) { return task.Id; } ), [ 'answer', 'enhance', 'work', 'explain', 'session' ] );
	ASSERT.equal( settings.Tasks[ 0 ].Prompt, TASKS.PROMPTS.Answer );
	ASSERT.equal( TASKS.ById( settings, 'session' ).Prompt, '' );
	ASSERT.equal( settings.TasksVersion, TASKS.TASKS_VERSION );
	// a second start changes nothing; a list present at the version is kept, each filled
	ASSERT.deepEqual( TASKS.Prepare( settings ), [] );
	let kept = { Name: 's', Scope: 'Local', Owner: { Name: 'user' }, TasksVersion: TASKS.TASKS_VERSION, Tasks: [ { Id: 'mine', Name: 'Mine', Writes: 'none' } ] };
	ASSERT.deepEqual( TASKS.Prepare( kept ), [] );
	ASSERT.deepEqual( kept.Tasks[ 0 ].Package, { Instructions: true, Readme: true, Documents: true, Plan: true, Threads: true, Files: true, Project: false, Box: false } );
	// a Step 1 file (no version): the tasks shipped since (Enhance after Answer, Explain after Work) are added, once; Session, shipped
	// at version 1 and missing, was removed and stays removed
	let older = { Name: 's', Scope: 'Local', Owner: { Name: 'user' }, Tasks: [ { Id: 'answer', Name: 'Answer' }, { Id: 'work', Name: 'Work' }, { Id: 'mine', Name: 'Mine' } ] };
	ASSERT.deepEqual( TASKS.Prepare( older ), [ 'the shipped task Enhance added (Tasks version 2)', 'the shipped task Explain added (Tasks version 3)' ] );
	ASSERT.deepEqual( older.Tasks.map( function ( task ) { return task.Id; } ), [ 'answer', 'enhance', 'work', 'explain', 'mine' ] );
	ASSERT.equal( older.TasksVersion, 3 );
	ASSERT.deepEqual( TASKS.Prepare( older ), [] );
	// a Step 2 file that removed Enhance keeps it removed and gets Explain, after the nearest shipped task present
	let trimmed = { Name: 's', Scope: 'Local', Owner: { Name: 'user' }, TasksVersion: 2, Tasks: [ { Id: 'answer', Name: 'Answer' } ] };
	ASSERT.deepEqual( TASKS.Prepare( trimmed ), [ 'the shipped task Explain added (Tasks version 3)' ] );
	ASSERT.deepEqual( trimmed.Tasks.map( function ( task ) { return task.Id; } ), [ 'answer', 'explain' ] );
	let current = { Name: 's', Scope: 'Local', Owner: { Name: 'user' }, TasksVersion: 3, Tasks: [ { Id: 'answer', Name: 'Answer' } ] };
	ASSERT.deepEqual( TASKS.Prepare( current ), [] );
	ASSERT.equal( current.Tasks.length, 1 );
	let empty = { Name: 's', Scope: 'Local', Owner: { Name: 'user' }, Tasks: [] };
	ASSERT.equal( TASKS.Prepare( empty ).length, 2 );
	ASSERT.deepEqual( empty.Tasks.map( function ( task ) { return task.Id; } ), [ 'enhance', 'explain' ] );
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
		'task "?": the Package must switch each of Instructions, Readme, Documents, Plan, Threads, Files, Project, Box',
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
	ASSERT.deepEqual( TASKS.Enabled( settings, { Id: 'p' } ).map( function ( task ) { return task.Id; } ), [ 'answer', 'enhance', 'work', 'explain', 'session' ] );
	ASSERT.deepEqual( TASKS.Enabled( settings, { Id: 'p', Tasks: [ 'session', 'answer', 'gone' ] } ).map( function ( task ) { return task.Id; } ), [ 'answer', 'session' ] );
	ASSERT.deepEqual( TASKS.Enabled( settings, { Id: 'p', Tasks: [] } ), [] );
	ASSERT.equal( TASKS.IsEnabled( settings, { Tasks: [ 'work' ] }, 'answer' ), false );
	ASSERT.equal( TASKS.IsEnabled( settings, null, 'answer' ), true );
	ASSERT.deepEqual( TASKS.Enabled( {}, null ), [] );
} );
