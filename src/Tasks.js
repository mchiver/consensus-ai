'use strict';

// Tasks - what a button asks of an LLM (plan LLM Tasks, Step 1). A task is a record of the settings (consensus.json,
// the Tasks list), edited in the Settings popup: defined per server, enabled per project (project.json's Tasks, the
// enabled ids; absent means all, so a task added later is on everywhere).
//
//   { Id, Name, Package: { Instructions, Readme, Documents, Plan, Threads, Files }, Writes, Prompt }
//   Name     what the button says and the run record carries
//   Package  what the one-shot is given, six switches: the server's instructions, the project's Readme, the other
//            Context documents, the plan at hand (its title, id and state), the threads waiting on the presser, and
//            the project's folder as the run's working folder
//   Writes   the permission: none, consensus or files, each including the ones before; the run token carries it
//            (Participants.js), the API refuses every write of a none run, and Tools.js gives a local model the tools
//            of the level
//   Prompt   the task's instructions, under "Your task: <Name>" in the package (Package.js)
// Consensus ships Answer, Work and Session, the Review, Build and Session of before; at the first start the
// connections' Review and Build prompts become Answer's and Work's when they differ from the old defaults, and the
// connections' Checks are dropped (Migrate).

const IDS = require( './Ids.js' );

const PACKAGE_ITEMS = [ 'Instructions', 'Readme', 'Documents', 'Plan', 'Threads', 'Files' ];
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
	Work: [
		'Build the plan at hand in this folder, as the agent instructions say under "The build loop": every thread of the',
		'plan is applied; set the plan Working, implement what the plan says and only that, run the tests, and post the',
		'build log as one contested whole-document thread on the plan, naming your model. Do not commit, branch or push:',
		'git is the owner\'s. When you are done, print a short summary of what you built.',
	].join( '\n' ),
	Session: '',
};

// The connections' default prompts of before (Package.js until plan LLM Tasks): a connection's prompt that differs
// from these was the owner's own, and becomes the task's.
const OLD_PROMPTS = {
	Review: [
		'Take the llm participant\'s turn on the plan at hand, as the agent instructions say under "Your turn in Consensus":',
		'read the plan and the threads waiting on you through the API, reply on the contested ones, apply the resolved ones',
		'one revision each, and re-anchor any thread left detached. Everything you contribute goes into Consensus through',
		'the API; when you are done, print a short summary of what you did.',
	].join( '\n' ),
	Build: PROMPTS.Work,
};

const DEFAULT_TASKS = [
	{ Id: 'answer', Name: 'Answer', Package: { Instructions: true, Readme: true, Documents: true, Plan: true, Threads: true, Files: true }, Writes: 'consensus', Prompt: PROMPTS.Answer },
	{ Id: 'work', Name: 'Work', Package: { Instructions: true, Readme: true, Documents: true, Plan: true, Threads: false, Files: true }, Writes: 'files', Prompt: PROMPTS.Work },
	{ Id: 'session', Name: 'Session', Package: { Instructions: true, Readme: true, Documents: true, Plan: false, Threads: false, Files: true }, Writes: 'files', Prompt: PROMPTS.Session },
];


function text_of( value )
{
	return ( value === undefined || value === null ) ? '' : String( value );
}


//---------------------------------------------------------------------
// Fill: one task with every field present. A missing switch is on; a missing Writes is consensus.

function Fill( Task )
{
	let given = ( Task && typeof Task === 'object' ) ? Task : {};
	let package_ = {};
	for ( let item of PACKAGE_ITEMS )
	{
		package_[ item ] = ( given.Package && typeof given.Package === 'object' && given.Package[ item ] !== undefined ) ? !!given.Package[ item ] : true;
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
// Migrate( Settings ): the Tasks list made at the first start, the connections' own Review and Build prompts moved
// onto Answer and Work (the first connection whose prompt differs from the old default wins), and the connections'
// Checks, Review and Build prompts dropped. Returns the lines to log; none when nothing changed.

function Migrate( Settings )
{
	let lines = [];
	let llms = ( Settings && Array.isArray( Settings.Llms ) ) ? Settings.Llms.filter( function ( llm ) { return llm && typeof llm === 'object'; } ) : [];
	if ( !Array.isArray( Settings.Tasks ) )
	{
		Settings.Tasks = Defaults();
		lines.push( 'Tasks set to the default set: ' + Settings.Tasks.map( function ( task ) { return task.Name; } ).join( ', ' ) );
		let moved = { Review: 'answer', Build: 'work' };
		for ( let name of Object.keys( moved ) )
		{
			let own = llms.find( function ( llm ) { return llm.Prompts && typeof llm.Prompts[ name ] === 'string' && llm.Prompts[ name ].trim() && llm.Prompts[ name ] !== OLD_PROMPTS[ name ]; } );
			if ( own )
			{
				let task = Settings.Tasks.find( function ( one ) { return one.Id === moved[ name ]; } );
				task.Prompt = own.Prompts[ name ];
				lines.push( 'the ' + name + ' prompt of the LLM connection "' + ( own.Name || '?' ) + '" became the ' + task.Name + ' task\'s' );
			}
		}
	}
	else
	{
		Settings.Tasks = Settings.Tasks.map( Fill );
	}
	let stripped = [];
	for ( let llm of llms )
	{
		let had = false;
		if ( llm.Checks !== undefined )
		{
			delete llm.Checks;
			had = true;
		}
		if ( llm.Prompts && typeof llm.Prompts === 'object' )
		{
			for ( let name of [ 'Review', 'Build' ] )
			{
				if ( llm.Prompts[ name ] !== undefined )
				{
					delete llm.Prompts[ name ];
					had = true;
				}
			}
		}
		if ( had )
		{
			stripped.push( llm.Name || '?' );
		}
	}
	if ( stripped.length )
	{
		lines.push( 'the Checks and the Review and Build prompts of the LLM connection' + ( stripped.length > 1 ? 's ' : ' ' ) + stripped.join( ', ' ) + ' dropped: the package and the prompt are the task\'s' );
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
	WRITES: WRITES,
	DEFAULT_WRITES: DEFAULT_WRITES,
	PROMPTS: PROMPTS,
	OLD_PROMPTS: OLD_PROMPTS,
	DEFAULT_TASKS: DEFAULT_TASKS,
	Fill: Fill,
	Defaults: Defaults,
	DefaultOf: DefaultOf,
	Migrate: Migrate,
	Problems: Problems,
	Clean: Clean,
	ById: ById,
	Enabled: Enabled,
	IsEnabled: IsEnabled,
	WritesLine: WritesLine,
};
