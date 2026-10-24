'use strict';

// Tasks - what a button asks of an LLM (plan LLM Tasks, Step 1). A task is a record of the settings (consensus.json,
// the Tasks list), edited in the Settings popup: defined per server, enabled per project (project.json's Tasks, the
// enabled ids; absent means all, so a task added later is on everywhere).
//
//   { Id, Name, Package: { Instructions, Readme, Documents, Plan, Threads, Files, Project, Box }, Writes, Prompt }
//   Name     what the button says and the run record carries
//   Package  what the one-shot is given, six switches: the server's instructions, the project's Readme, the other
//            Context documents, the plan at hand (its title, id and state), the threads waiting on the presser, the
//            project's folder as the run's working folder, Project (Step 4, off unless set): the project's shape, every
//            plan and document as a title, id, state and tally and the last runs, and Box (Step 2, off unless set): a
//            text box for the person's instructions, sent as Text with the run and put under "Your instructions"
//            after the prompt
//   Writes   the permission: none, consensus or files, each including the ones before; the run token carries it
//            (Participants.js), the API refuses every write of a none run, and Tools.js gives a local model the tools
//            of the level
//   Prompt   the task's instructions, under "Your task: <Name>" in the package (Package.js)
// Consensus ships Answer, Enhance (Step 2), Work, Explain (Step 4) and Session; a settings file with no Tasks gets the
// shipped set at start (Prepare). TasksVersion in the settings says which
// shipped tasks a file has been given: a file below the version gets the shipped tasks that came after its version
// (Since), once, each after the nearest shipped one before it, so one removed stays removed.

const IDS = require( './Ids.js' );

const PACKAGE_ITEMS = [ 'Instructions', 'Readme', 'Documents', 'Plan', 'Threads', 'Files', 'Project', 'Box' ];
const OFF_BY_DEFAULT = [ 'Project', 'Box' ];
const TASKS_VERSION = 3;		// 1: Answer, Work, Session (Step 1); 2: Enhance (Step 2); 3: Explain (Step 4)
const WRITES = [ 'none', 'consensus', 'files' ];
const DEFAULT_WRITES = 'consensus';

const WRITES_LINES = {
	none: 'none. This run reads only: the API refuses every write, and there are no file-writing tools.',
	consensus: 'consensus. You may change Consensus (reply, apply, open a thread, set a state), not the project\'s files.',
	files: 'files. You may change Consensus and the project\'s files, and run the commands the project allows.',
};

const PROMPTS = {
	Answer: [
		'Take your turn on the plan at hand, as the agent instructions say under "Your turn in Consensus": read the plan',
		'and the threads waiting on you through the API, reply on the contested ones, apply the resolved ones one revision',
		'each, and re-anchor any thread left detached. Everything you contribute goes into Consensus through the API;',
		'when you are done, print a short summary of what you did.',
	].join( '\n' ),
	Enhance: [
		'Replace the plan\'s text with a detailed plan: keep what the sketch decides, develop what it only names, and keep',
		'its shape. Post the new text as one revision through the API (PUT /api/plans/<id>/text with the current Revision)',
		'and open a contested thread on the passage for each thing that is unclear or needs the person\'s decision; leave the',
		'threads already waiting to Answer. When you are done, print a short summary of what you wrote and asked.',
	].join( '\n' ),
	Work: [
		'Build the plan at hand in this folder, as the agent instructions say under "The build loop": every thread of the',
		'plan is applied; set the plan Working, implement what the plan says and only that, run the tests, and post the',
		'build log as one contested whole-document thread on the plan, naming your model. Do not commit, branch or push:',
		'git is the owner\'s. When you are done, print a short summary of what you built.',
	].join( '\n' ),
	Explain: [
		'Answer the question under "Your instructions" about this project, for the person who asked it. Use what is',
		'packaged here and read what the question needs: a plan\'s text, threads and revisions, the run records, the files,',
		'through the API or the tools you have. Answer in plain markdown, naming plans and threads by their titles and',
		'people by their names, and say when you could not find something. Post nothing: your answer is your output.',
	].join( '\n' ),
	Session: '',
};

// Since: the TasksVersion that shipped the task; a file below it lacks the task because it never had it.
const DEFAULT_TASKS = [
	{ Id: 'answer', Name: 'Answer', Since: 1, Package: { Instructions: true, Readme: true, Documents: true, Plan: true, Threads: true, Files: true, Project: false, Box: false }, Writes: 'consensus', Prompt: PROMPTS.Answer },
	{ Id: 'enhance', Name: 'Enhance', Since: 2, Package: { Instructions: true, Readme: true, Documents: true, Plan: true, Threads: false, Files: false, Project: false, Box: true }, Writes: 'consensus', Prompt: PROMPTS.Enhance },
	{ Id: 'work', Name: 'Work', Since: 1, Package: { Instructions: true, Readme: true, Documents: true, Plan: true, Threads: false, Files: true, Project: false, Box: false }, Writes: 'files', Prompt: PROMPTS.Work },
	{ Id: 'explain', Name: 'Explain', Since: 3, Package: { Instructions: true, Readme: true, Documents: true, Plan: false, Threads: false, Files: true, Project: true, Box: true }, Writes: 'none', Prompt: PROMPTS.Explain },
	{ Id: 'session', Name: 'Session', Since: 1, Package: { Instructions: true, Readme: true, Documents: true, Plan: false, Threads: false, Files: true, Project: false, Box: false }, Writes: 'files', Prompt: PROMPTS.Session },
];


function text_of( value )
{
	return ( value === undefined || value === null ) ? '' : String( value );
}


//---------------------------------------------------------------------
// Fill: one task with every field present. A missing switch is on (Box off); a missing Writes is consensus.

function Fill( Task )
{
	let given = ( Task && typeof Task === 'object' ) ? Task : {};
	let package_ = {};
	for ( let item of PACKAGE_ITEMS )
	{
		package_[ item ] = ( given.Package && typeof given.Package === 'object' && given.Package[ item ] !== undefined ) ? !!given.Package[ item ] : !OFF_BY_DEFAULT.includes( item );
	}
	return {
		Id: text_of( given.Id ).trim() || IDS.New( IDS.TASK ),
		Name: text_of( given.Name ).trim(),
		Package: package_,
		Writes: WRITES.includes( given.Writes ) ? given.Writes : DEFAULT_WRITES,
		Prompt: text_of( given.Prompt ),
	};
}


// Defaults(): the shipped set, a fresh copy. DefaultOf( Id ): the shipped record with that id, or null.
function Defaults()
{
	return DEFAULT_TASKS.map( Fill );
}


function DefaultOf( Id )
{
	let found = DEFAULT_TASKS.find( function ( task ) { return task.Id === Id; } );
	return found ? Fill( found ) : null;
}


//---------------------------------------------------------------------
// Prepare( Settings ): the Tasks list made at the first start; a list below TasksVersion gets the shipped tasks that
// came after its version and it lacks, each after the nearest shipped one before it (or first). Returns the lines to
// log; none when nothing changed.

function Prepare( Settings )
{
	let lines = [];
	if ( !Array.isArray( Settings.Tasks ) )
	{
		Settings.Tasks = Defaults();
		Settings.TasksVersion = TASKS_VERSION;
		lines.push( 'Tasks set to the default set: ' + Settings.Tasks.map( function ( task ) { return task.Name; } ).join( ', ' ) );
		return lines;
	}
	Settings.Tasks = Settings.Tasks.map( Fill );
	let version = Number( Settings.TasksVersion ) || 1;
	if ( version < TASKS_VERSION )
	{
		let before = null;
		for ( let shipped of DEFAULT_TASKS )
		{
			let present = Settings.Tasks.some( function ( task ) { return task.Id === shipped.Id; } );
			if ( !present && ( shipped.Since || 1 ) > version )
			{
				let at = before ? Settings.Tasks.findIndex( function ( task ) { return task.Id === before; } ) + 1 : 0;
				Settings.Tasks.splice( at, 0, Fill( shipped ) );
				lines.push( 'the shipped task ' + shipped.Name + ' added (Tasks version ' + shipped.Since + ')' );
				present = true;
			}
			if ( present )
			{
				before = shipped.Id;
			}
		}
		Settings.TasksVersion = TASKS_VERSION;
	}
	return lines;
}


//---------------------------------------------------------------------
// Problems( Settings ): what is wrong with the Tasks, as sentences; none when they are usable.

function Problems( Settings )
{
	let problems = [];
	let tasks = ( Settings && Settings.Tasks !== undefined ) ? Settings.Tasks : [];
	if ( !Array.isArray( tasks ) )
	{
		return [ 'Tasks must be a list' ];
	}
	let names = new Set();
	let ids = new Set();
	for ( let task of tasks )
	{
		if ( !task || typeof task !== 'object' )
		{
			problems.push( 'a task is not an object' );
			continue;
		}
		let what = 'task "' + ( task.Name || '?' ) + '"';
		if ( typeof task.Name !== 'string' || !task.Name.trim() )
		{
			problems.push( 'a task has no Name' );
		}
		else if ( names.has( task.Name.trim() ) )
		{
			problems.push( what + ' is named twice' );
		}
		names.add( ( task.Name || '' ).trim() );
		if ( typeof task.Id !== 'string' || !task.Id.trim() || ids.has( task.Id ) )
		{
			problems.push( what + ': the Id is missing or used twice' );
		}
		ids.add( task.Id );
		if ( !WRITES.includes( task.Writes ) )
		{
			problems.push( what + ': Writes is "' + task.Writes + '", not one of ' + WRITES.join( ', ' ) );
		}
		if ( !task.Package || typeof task.Package !== 'object' || PACKAGE_ITEMS.some( function ( item ) { return typeof task.Package[ item ] !== 'boolean'; } ) )
		{
			problems.push( what + ': the Package must switch each of ' + PACKAGE_ITEMS.join( ', ' ) );
		}
		if ( typeof task.Prompt !== 'string' )
		{
			problems.push( what + ': the Prompt must be text' );
		}
	}
	return problems;
}


// Clean( Tasks ): the list as the Settings popup sends it, each filled; not a list gives an empty one.
function Clean( Tasks )
{
	return ( Array.isArray( Tasks ) ? Tasks : [] ).map( Fill );
}


//---------------------------------------------------------------------
// ById( Settings, Id ): the task, or null. Enabled( Settings, Project ): the server's tasks the project enables, in
// the list's order; a project with no Tasks list enables them all. IsEnabled( Settings, Project, Id ).

function ById( Settings, Id )
{
	return ( ( Settings && Settings.Tasks ) || [] ).find( function ( task ) { return task.Id === Id; } ) || null;
}


function Enabled( Settings, Project )
{
	let tasks = ( Settings && Array.isArray( Settings.Tasks ) ) ? Settings.Tasks : [];
	if ( !Project || !Array.isArray( Project.Tasks ) )
	{
		return tasks.slice();
	}
	return tasks.filter( function ( task ) { return Project.Tasks.includes( task.Id ); } );
}


function IsEnabled( Settings, Project, Id )
{
	return Enabled( Settings, Project ).some( function ( task ) { return task.Id === Id; } );
}


// WritesLine( Writes ): the sentence a run is told about its level, after "- Writes: ".
function WritesLine( Writes )
{
	return WRITES_LINES[ WRITES.includes( Writes ) ? Writes : DEFAULT_WRITES ];
}


module.exports = {
	PACKAGE_ITEMS: PACKAGE_ITEMS,
	OFF_BY_DEFAULT: OFF_BY_DEFAULT,
	TASKS_VERSION: TASKS_VERSION,
	WRITES: WRITES,
	DEFAULT_WRITES: DEFAULT_WRITES,
	PROMPTS: PROMPTS,
	DEFAULT_TASKS: DEFAULT_TASKS,
	Fill: Fill,
	Defaults: Defaults,
	DefaultOf: DefaultOf,
	Prepare: Prepare,
	Problems: Problems,
	Clean: Clean,
	ById: ById,
	Enabled: Enabled,
	IsEnabled: IsEnabled,
	WritesLine: WritesLine,
};
