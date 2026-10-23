'use strict';

// Step 4 of Consensus Desktop (plan Step 4: Local Models), in the server since plan Run Shapes, Step 3: the tools a local
// model gets (Tools.js) over a temporary folder and a Consensus started in the test, the tool loop (Ollama.js) against a
// fake Ollama answering a scripted sequence, and an ollama connection's run through Runs.js.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const FS = require( 'fs' );
const OS = require( 'os' );
const PATH = require( 'path' );
const HTTP = require( 'http' );
const LLMS = require( '../src/Llms.js' );
const STORE = require( '../src/Store.js' );
const FILES = require( '../src/Files.js' );
const TOOLS = require( '../src/Tools.js' );
const OLLAMA = require( '../src/Ollama.js' );
const RUNS = require( '../src/Runs.js' );
const LLM = require( '../src/Llm.js' );
const SERVER = require( '../src/Server.js' );

const TOKEN = 'test-llm-token-step-4';

let folders = [];


function temporary_folder( prefix )
{
	let folder = FS.mkdtempSync( PATH.join( OS.tmpdir(), prefix ) );
	folders.push( folder );
	return folder;
}


TEST.after( function ()
{
	for ( let folder of folders )
	{
		FS.rmSync( folder, { recursive: true, force: true, maxRetries: 5 } );
	}
} );


// A place folder with a few files.
function make_place()
{
	let folder = temporary_folder( 'desktop-tools-' );
	FS.mkdirSync( PATH.join( folder, 'src' ) );
	FS.mkdirSync( PATH.join( folder, 'node_modules', 'dep' ), { recursive: true } );
	FS.mkdirSync( PATH.join( folder, '~data' ) );
	FS.writeFileSync( PATH.join( folder, 'src', 'a.js' ), 'let a = 1;\nfunction one()\n{\n\treturn a;\n}\n' );
	FS.writeFileSync( PATH.join( folder, 'src', 'b.js' ), 'let b = 2;\nfunction two()\n{\n\treturn b + b;\n}\n' );
	FS.writeFileSync( PATH.join( folder, 'readme.md' ), '# Here\n\nTwo files.\n' );
	FS.writeFileSync( PATH.join( folder, 'node_modules', 'dep', 'index.js' ), 'let a = 0;\n' );
	FS.writeFileSync( PATH.join( folder, '~data', 'secret.json' ), '{ "a": 1 }\n' );
	FS.writeFileSync( PATH.join( folder, 'tool.js' ), 'process.stdout.write( process.cwd() );\nif ( process.argv[ 2 ] === "fail" ) { process.stderr.write( "bad" ); process.exit( 2 ); }\n' );
	return { Path: folder.replace( /\\/g, '/' ), Include: [], Exclude: STORE.DEFAULT_EXCLUDE.slice(), Commands: [ 'node --version', 'node tool.js' ] };
}


//---------------------------------------------------------------------
// Allowed and Within

TEST( 'a run may execute a listed command, exactly or with arguments after it, and nothing that chains', function ()
{
	let commands = [ 'npm test', 'node --test' ];
	ASSERT.equal( TOOLS.Allowed( 'npm test', commands ), true );
	ASSERT.equal( TOOLS.Allowed( 'node --test test/Tools.test.js', commands ), true );
	ASSERT.equal( TOOLS.Allowed( 'npm', commands ), false );
	ASSERT.equal( TOOLS.Allowed( 'npm testing', commands ), false );
	ASSERT.equal( TOOLS.Allowed( 'npm test && rm -rf /', commands ), false );
	ASSERT.equal( TOOLS.Allowed( 'npm test | tee out', commands ), false );
	ASSERT.equal( TOOLS.Allowed( 'npm test > out', commands ), false );
	ASSERT.equal( TOOLS.Allowed( 'npm test; dir', commands ), false );
	ASSERT.equal( TOOLS.Allowed( 'npm test $(dir)', commands ), false );
	ASSERT.equal( TOOLS.Allowed( '', commands ), false );
	ASSERT.equal( TOOLS.Allowed( 'npm test', [] ), false );
	ASSERT.equal( TOOLS.Allowed( 'npm test', [ 'npm test | x' ] ), false );
	// Context and Rounds on a connection
	let llm = LLMS.Fill( { Name: 'o', Kind: 'ollama', Model: 'm' } );
	ASSERT.equal( llm.Context, LLMS.DEFAULT_CONTEXT );
	ASSERT.equal( llm.Rounds, LLMS.DEFAULT_ROUNDS );
	ASSERT.equal( LLMS.Fill( { Name: 'o', Context: '8192', Rounds: 5.5 } ).Context, 8192 );
	ASSERT.equal( LLMS.Fill( { Name: 'o', Context: -1, Rounds: 'x' } ).Rounds, LLMS.DEFAULT_ROUNDS );
} );


TEST( 'a path a tool names is within the folder, or refused with the reason', function ()
{
	let place = make_place();
	let within = FILES.Within( place.Path, place.Include, place.Exclude, 'src/a.js' );
	ASSERT.equal( within.Ok, true );
	ASSERT.equal( within.Relative, 'src/a.js' );
	ASSERT.equal( within.Absolute, PATH.join( place.Path, 'src', 'a.js' ) );
	ASSERT.equal( FILES.Within( place.Path, [], [], 'src\\b.js' ).Relative, 'src/b.js' );
	ASSERT.equal( FILES.Within( place.Path, [], [], PATH.join( place.Path, 'src', 'b.js' ) ).Relative, 'src/b.js' );
	ASSERT.match( FILES.Within( place.Path, [], [], '../outside.js' ).Error, /outside the folder/ );
	ASSERT.match( FILES.Within( place.Path, [], [], PATH.join( OS.tmpdir(), 'elsewhere.js' ) ).Error, /outside the folder/ );
	ASSERT.match( FILES.Within( place.Path, [], [], '' ).Error, /a Path is needed/ );
	ASSERT.match( FILES.Within( place.Path, [], [], '.' ).Error, /outside the folder/ );
	ASSERT.match( FILES.Within( place.Path, place.Include, place.Exclude, 'node_modules/dep/index.js' ).Error, /folder the folder excludes/ );
	ASSERT.match( FILES.Within( place.Path, place.Include, place.Exclude, '~data/secret.json' ).Error, /folder the folder excludes/ );
	ASSERT.match( FILES.Within( place.Path, [], [ '*.md' ], 'readme.md' ).Error, /file the folder excludes/ );
	ASSERT.match( FILES.Within( place.Path, [ 'src/**' ], [], 'readme.md' ).Error, /not a file the folder includes/ );
	ASSERT.equal( FILES.Within( place.Path, [ 'src/**' ], [], 'src/new.js' ).Ok, true );
} );


//---------------------------------------------------------------------
// The file tools

TEST( 'the file tools: glob, grep and read over the folder; write, edit and run when the task writes files; a consensus run gets read-only ones, a none run no Consensus writer', async function ()
{
	let place = make_place();
	let review = TOOLS.Tools( { Writes: 'consensus', Folder: place } );
	ASSERT.deepEqual( review.Definitions.map( function ( d ) { return d.function.name; } ), [ 'glob', 'grep', 'read' ] );
	ASSERT.match( await review.Call( 'write', { Path: 'x', Text: 'y' } ), /no tool named write; the tools are glob, grep, read/ );
	ASSERT.equal( FS.existsSync( PATH.join( place.Path, 'x' ) ), false );
	ASSERT.deepEqual( TOOLS.Tools( { Writes: 'consensus', Folder: null } ).Definitions, [] );
	let read_only = TOOLS.Tools( { Writes: 'none', Folder: place, Server: { Url: 'http://127.0.0.1:1', Token: 't', Project: 'p' } } );
	ASSERT.deepEqual( read_only.Definitions.map( function ( d ) { return d.function.name; } ), [ 'glob', 'grep', 'read', 'list_projects', 'read_plan', 'list_threads', 'list_revisions', 'read_revision', 'waiting' ] );
	ASSERT.match( read_only.Instructions(), /This run reads only/ );
	ASSERT.equal( read_only.Instructions().includes( 'Your turn in Consensus' ), false );
	ASSERT.match( await read_only.Call( 'reply', { Id: 'p', Thread: 't', Text: 'x' } ), /no tool named reply/ );
	let consensus = TOOLS.Tools( { Writes: 'consensus', Folder: place, Server: { Url: 'http://127.0.0.1:1', Token: 't', Project: 'p' } } ).Instructions();
	ASSERT.match( consensus, /Your turn in Consensus/ );
	ASSERT.equal( consensus.includes( 'The build loop' ), false );

	let build = TOOLS.Tools( { Writes: 'files', Folder: place } );
	ASSERT.deepEqual( build.Definitions.map( function ( d ) { return d.function.name; } ), [ 'glob', 'grep', 'read', 'write', 'edit', 'run' ] );
	ASSERT.equal( build.Definitions[ 0 ].type, 'function' );
	ASSERT.equal( build.Definitions[ 0 ].function.parameters.required[ 0 ], 'Pattern' );

	// glob: within the Include and Exclude; the excluded folders never appear
	ASSERT.equal( await build.Call( 'glob', { Pattern: '**/*.js' } ), 'src/a.js\nsrc/b.js\ntool.js' );
	ASSERT.equal( await build.Call( 'glob', { Pattern: '*.md' } ), 'readme.md' );
	ASSERT.match( await build.Call( 'glob', { Pattern: '*.py' } ), /no file of the folder matches/ );
	ASSERT.match( await build.Call( 'glob', {} ), /a Pattern is needed/ );

	// grep
	ASSERT.equal( await build.Call( 'grep', { Pattern: '^let' } ), 'src/a.js:1: let a = 1;\nsrc/b.js:1: let b = 2;' );
	ASSERT.equal( await build.Call( 'grep', { Pattern: 'RETURN', IgnoreCase: true, Glob: 'src/b.js' } ), 'src/b.js:4: \treturn b + b;' );
	ASSERT.match( await build.Call( 'grep', { Pattern: 'nothing here' } ), /no line matches/ );
	ASSERT.match( await build.Call( 'grep', { Pattern: '(' } ), /not a regular expression/ );

	// read, with Offset and Limit
	ASSERT.equal( await build.Call( 'read', { Path: 'src/a.js' } ), '1: let a = 1;\n2: function one()\n3: {\n4: \treturn a;\n5: }\n(lines 1 to 5 of 5)' );
	ASSERT.equal( await build.Call( 'read', { Path: 'src/a.js', Offset: 2, Limit: 2 } ), '2: function one()\n3: {\n(lines 2 to 3 of 5; read on with Offset 4)' );
	ASSERT.match( await build.Call( 'read', { Path: 'src/a.js', Offset: 9 } ), /has 5 lines; Offset 9 is past its end/ );
	ASSERT.match( await build.Call( 'read', { Path: 'src/none.js' } ), /no file src\/none.js/ );
	ASSERT.match( await build.Call( 'read', { Path: '~data/secret.json' } ), /excludes/ );
	ASSERT.match( await build.Call( 'read', { Path: '../../etc' } ), /outside the folder/ );

	// write makes folders; edit needs one match
	ASSERT.equal( await build.Call( 'write', { Path: 'src/deep/c.js', Text: 'let c = 3;\n' } ), 'wrote src/deep/c.js (11 characters)' );
	ASSERT.equal( FS.readFileSync( PATH.join( place.Path, 'src', 'deep', 'c.js' ), 'utf8' ), 'let c = 3;\n' );
	ASSERT.match( await build.Call( 'write', { Path: '../c.js', Text: '' } ), /outside/ );
	ASSERT.equal( await build.Call( 'edit', { Path: 'src/b.js', Old: 'b + b', New: 'b * 2' } ), 'edited src/b.js' );
	ASSERT.match( FS.readFileSync( PATH.join( place.Path, 'src', 'b.js' ), 'utf8' ), /return b \* 2;/ );
	ASSERT.match( await build.Call( 'edit', { Path: 'src/b.js', Old: 'b', New: 'x' } ), /found \d+ times in src\/b.js; make it unique/ );
	ASSERT.match( await build.Call( 'edit', { Path: 'src/b.js', Old: 'zzz', New: 'x' } ), /Old was not found/ );
	ASSERT.match( await build.Call( 'edit', { Path: 'src/b.js', Old: '', New: 'x' } ), /Old is empty/ );
	ASSERT.match( await build.Call( 'edit', { Path: 'src/none.js', Old: 'a', New: 'b' } ), /no file/ );

	// run: a listed command, one with arguments after it, an unlisted one, a chained one
	let ran = await build.Call( 'run', { Command: 'node --version' } );
	ASSERT.match( ran, /^exit 0\nv\d+/ );
	let with_arguments = await build.Call( 'run', { Command: 'node tool.js' } );
	ASSERT.equal( with_arguments, 'exit 0\n' + PATH.resolve( place.Path ) );
	let failing = await build.Call( 'run', { Command: 'node tool.js fail' } );
	ASSERT.equal( failing, 'exit 2\n' + PATH.resolve( place.Path ) + '\n--- stderr ---\nbad' );
	ASSERT.match( await build.Call( 'run', { Command: 'npm test' } ), /not allowed: the folder allows/ );
	ASSERT.match( await build.Call( 'run', { Command: 'node tool.js && dir' } ), /not allowed/ );
	let none = TOOLS.Tools( { Writes: 'files', Folder: { Path: place.Path, Include: [], Exclude: [], Commands: [] } } );
	ASSERT.match( await none.Call( 'run', { Command: 'node tool.js' } ), /allows no command/ );

	// described for the transcript, and the instructions name the tools and the commands
	ASSERT.equal( build.Describe( 'read', { Path: 'src/a.js', Offset: 3 } ), 'read src/a.js from line 3' );
	ASSERT.equal( build.Describe( 'grep', { Pattern: 'x', Glob: '*.js' } ), 'grep "x" in *.js' );
	ASSERT.equal( build.Describe( 'write', { Path: 'p', Text: 'abc' } ), 'write p (3 characters)' );
	ASSERT.equal( build.Describe( 'reply', { Thread: 'thr-1', Text: 'A reply of some length here' } ), 'reply thr-1 "A reply of some length here"' );
	ASSERT.match( build.Instructions(), /- run: Runs one of the project/ );
	ASSERT.match( build.Instructions(), /The commands it allows: node --version, node tool\.js\./ );
	ASSERT.match( build.Instructions(), /The build loop/ );
	ASSERT.doesNotMatch( review.Instructions(), /The build loop/ );
	ASSERT.equal( build.Shown( 'a  b\n\nc' ), 'a b c' );
	ASSERT.equal( build.Shown( 'x'.repeat( 400 ) ).length, 300 + '… (100 more characters)'.length );
} );


//---------------------------------------------------------------------
// The Consensus tools, against a Consensus started here

async function owner( url, method, path, body )
{
	let options = { method: method, headers: {} };
	if ( body !== undefined )
	{
		options.headers[ 'Content-Type' ] = 'application/json';
		options.body = JSON.stringify( body );
	}
	let response = await fetch( url + path, options );
	return { Status: response.status, Body: await response.json() };
}


async function start_consensus()
{
	let data = temporary_folder( 'desktop-tools-server-' );
	FS.writeFileSync( PATH.join( data, 'consensus.json' ), JSON.stringify( {
		Name: 'test', Port: 0, Scope: 'Local',
		States: [ 'Draft', 'Working', 'Finished' ],
		Owner: { Name: 'user', Display: 'User' },
	} ) );
	return SERVER.Start( { Data: data, Port: 0 } );
}


TEST( 'the Consensus tools: list, read, waiting, reply, apply (the revision supplied), a new thread, the state; another project is refused', async function ()
{
	let target = await start_consensus();
	try
	{
		let url = target.Url;
		let projects = ( await owner( url, 'GET', '/api/projects' ) ).Body.Projects;
		let project = projects[ 0 ];
		let other = ( await owner( url, 'POST', '/api/projects', { Name: 'Other' } ) ).Body.Project;
		let elsewhere = ( await owner( url, 'POST', '/api/plans', { Title: 'Elsewhere', Text: '# E\n', Project: other.Id } ) ).Body.Plan;
		let plan = ( await owner( url, 'POST', '/api/plans', { Title: 'The plan', Text: '# The plan\n\nA first line.\n\nA second line.\n', Project: project.Id } ) ).Body.Plan;
		let document = ( await owner( url, 'POST', '/api/plans', { Title: 'Notes', Text: '# Notes\n\nSome notes.\n', Project: project.Id, Kind: 'document' } ) ).Body.Plan;
		let resolved = ( await owner( url, 'POST', '/api/plans/' + plan.Id + '/threads', { Text: 'Say third.', Anchor: { Text: 'A second line.' }, Resolve: true } ) ).Body.Thread;
		let contested = ( await owner( url, 'POST', '/api/plans/' + plan.Id + '/threads', { Text: 'Why a first line?' } ) ).Body.Thread;

		// the tools call the API on a run token the server made (plan User Management, Step 2)
		let tools = TOOLS.Tools( { Writes: 'consensus', Folder: null, Server: { Url: url, Token: target.Tokens.Mint( { Service: 'llm', Name: 'Review run', Project: project.Id } ), Project: project.Id } } );
		ASSERT.deepEqual( tools.Definitions.map( function ( d ) { return d.function.name; } ), [ 'list_projects', 'read_plan', 'list_threads', 'list_revisions', 'read_revision', 'waiting', 'thread', 'reply', 'reanchor', 'apply', 'write_text', 'set_state', 'create_plan' ] );

		let listed = await tools.Call( 'list_projects', {} );
		ASSERT.match( listed, new RegExp( '^Project ' + project.Name + ' \\(' + project.Id + '\\), its Readme is ' ) );
		ASSERT.match( listed, new RegExp( '- plan The plan \\(' + plan.Id + ', Draft' ) );
		ASSERT.match( listed, new RegExp( '  - document Notes \\(' + document.Id + '\\)' ) );
		ASSERT.doesNotMatch( listed, /Elsewhere/ );

		let read = await tools.Call( 'read_plan', { Id: plan.Id } );
		ASSERT.match( read, new RegExp( '^# The plan \\(' + plan.Id + '\\), state Draft, revision 1\n\n# The plan\n\nA first line.' ) );
		ASSERT.match( read, /## Threads \(2\)/ );
		ASSERT.match( read, new RegExp( '### Thread ' + resolved.Id + ' \\(resolved, on "A second line."\\)\n\nuser \\(.*\\): Say third.' ) );
		ASSERT.match( read, new RegExp( '### Thread ' + contested.Id + ' \\(contested, on the whole document\\)' ) );
		ASSERT.match( await tools.Call( 'read_plan', { Id: elsewhere.Id } ), /is not in this project/ );
		ASSERT.match( await tools.Call( 'read_plan', { Id: 'pln-no-such-one' } ), /read_plan failed: Consensus answered 404/ );
		ASSERT.match( await tools.Call( 'read_plan', {} ), /an id is needed/ );
		ASSERT.match( await tools.Call( 'read_plan', { Id: document.Id } ), new RegExp( '^# Notes \\(' + document.Id + '\\), revision 1\n\n# Notes\n\nSome notes.$' ) );

		let waiting = await tools.Call( 'waiting', {} );
		ASSERT.match( waiting, new RegExp( '^## The plan \\(' + plan.Id + ', revision 1\\)' ) );
		ASSERT.match( waiting, new RegExp( resolved.Id ) );
		ASSERT.match( waiting, new RegExp( contested.Id ) );
		ASSERT.doesNotMatch( waiting, /Elsewhere/ );
		ASSERT.equal( await tools.Call( 'waiting', { Plan: elsewhere.Id } ), 'nothing waits on you in ' + elsewhere.Id );

		ASSERT.equal( await tools.Call( 'reply', { Id: plan.Id, Thread: contested.Id, Text: 'Because it comes first.' } ), 'replied on ' + contested.Id );
		let after_reply = ( await owner( url, 'GET', '/api/plans/' + plan.Id ) ).Body;
		let replied = after_reply.Threads.find( function ( t ) { return t.Id === contested.Id; } );
		ASSERT.deepEqual( [ replied.Replies[ 1 ].By, replied.Replies[ 1 ].Service, replied.Replies[ 1 ].Token ], [ 'user', 'llm', 'Review run' ] );
		ASSERT.equal( replied.Replies[ 1 ].Text, 'Because it comes first.' );
		ASSERT.match( await tools.Call( 'reply', { Id: elsewhere.Id, Thread: 'x', Text: 'no' } ), /not in this project/ );

		// apply: the current revision is supplied; the anchor moves the thread
		let applied = await tools.Call( 'apply', { Id: plan.Id, Thread: resolved.Id, Outcome: 'Said third.', Text: '# The plan\n\nA first line.\n\nA third line.\n', Anchor: 'A third line.' } );
		ASSERT.equal( applied, 'applied ' + resolved.Id + ', the plan is at revision 2' );
		let after_apply = ( await owner( url, 'GET', '/api/plans/' + plan.Id ) ).Body;
		ASSERT.equal( after_apply.Plan.Revision, 2 );
		ASSERT.match( after_apply.Text, /A third line\./ );
		let moved = after_apply.Threads.find( function ( t ) { return t.Id === resolved.Id; } );
		ASSERT.equal( moved.Anchor.Text, 'A third line.' );
		ASSERT.equal( !!moved.Applied, true );
		ASSERT.match( await tools.Call( 'apply', { Id: plan.Id, Thread: resolved.Id, Outcome: 'again' } ), /apply failed: Consensus answered 409/ );
		ASSERT.match( await tools.Call( 'apply', { Id: plan.Id, Thread: contested.Id, Outcome: 'x', Text: 'y', Anchor: 'not in the text' } ), /Consensus answered/ );

		let posted = await tools.Call( 'thread', { Id: plan.Id, Text: 'A point on the first line.', Anchor: 'A first line.' } );
		ASSERT.match( posted, /^posted thread thr-\S+ on "A first line."$/ );
		ASSERT.match( await tools.Call( 'thread', { Id: plan.Id, Text: 'On the whole.' } ), /^posted thread thr-\S+ on the whole document$/ );
		ASSERT.match( await tools.Call( 'thread', { Id: plan.Id, Text: 'x', Anchor: 'nowhere at all' } ), /anchor text was not found/ );
		ASSERT.equal( ( await owner( url, 'GET', '/api/plans/' + plan.Id ) ).Body.Threads.length, 4 );

		// write_text (plan LLM Tasks, Step 2): the whole text as a revision, the current revision supplied; the threads stay
		ASSERT.equal( await tools.Call( 'write_text', { Id: plan.Id, Text: '# The plan\n\nA first line.\n\nA third line.\n\nA fourth line.\n' } ), 'wrote ' + plan.Id + ', the plan is at revision 3' );
		let after_write = ( await owner( url, 'GET', '/api/plans/' + plan.Id ) ).Body;
		ASSERT.equal( after_write.Plan.Revision, 3 );
		ASSERT.match( after_write.Text, /A fourth line\./ );
		ASSERT.equal( after_write.Threads.length, 4 );
		let revisions = ( await owner( url, 'GET', '/api/plans/' + plan.Id + '/revisions' ) ).Body.Revisions;
		ASSERT.deepEqual( [ revisions[ 2 ].By, revisions[ 2 ].Service, revisions[ 2 ].Token, revisions[ 2 ].Reason ], [ 'user', 'llm', 'Review run', 'edit' ] );
		ASSERT.match( await tools.Call( 'write_text', { Id: elsewhere.Id, Text: 'x' } ), /not in this project/ );
		ASSERT.equal( await tools.Call( 'set_state', { Id: plan.Id, State: 'Working' } ), plan.Id + ' is now Working' );
		ASSERT.equal( ( await owner( url, 'GET', '/api/plans/' + plan.Id ) ).Body.Plan.State, 'Working' );
		ASSERT.match( await tools.Call( 'set_state', { Id: plan.Id, State: 'Done' } ), /State must be one of/ );
		ASSERT.match( await tools.Call( 'set_state', { Id: elsewhere.Id, State: 'Working' } ), /not in this project/ );
		ASSERT.match( await tools.Call( 'nothing', {} ), /no tool named nothing/ );
	}
	finally
	{
		await target.Close();
	}
} );


//---------------------------------------------------------------------
// A fake Ollama: answers /api/chat from a scripted list, one entry per request, and keeps what it was sent.

function fake_ollama( script, options )
{
	let settings = options || {};
	let requests = [];
	let server = HTTP.createServer( function ( request, response )
	{
		let body = '';
		request.on( 'data', function ( chunk ) { body += chunk; } );
		request.on( 'end', function ()
		{
			if ( request.url === '/api/tags' )
			{
				response.writeHead( 200, { 'Content-Type': 'application/json' } );
				response.end( JSON.stringify( { models: [ { name: 'fake:latest' }, { name: 'plain:latest' } ] } ) );
				return;
			}
			if ( request.url === '/api/show' )
			{
				let asked = JSON.parse( body );
				response.writeHead( 200, { 'Content-Type': 'application/json' } );
				response.end( JSON.stringify( { capabilities: ( asked.model === 'fake:latest' ) ? [ 'completion', 'tools' ] : [ 'completion' ] } ) );
				return;
			}
			let parsed = JSON.parse( body );
			requests.push( parsed );
			let entry = script[ requests.length - 1 ] || { content: 'nothing scripted' };
			let answer = function ()
			{
				if ( entry.status )
				{
					response.writeHead( entry.status, { 'Content-Type': 'text/plain' } );
					response.end( entry.text || 'no' );
					return;
				}
				let message = { role: 'assistant', content: entry.content || '' };
				if ( entry.calls )
				{
					message.tool_calls = entry.calls.map( function ( call ) { return { function: { name: call[ 0 ], arguments: call[ 1 ] } }; } );
				}
				response.writeHead( 200, { 'Content-Type': 'application/json' } );
				response.end( JSON.stringify( { model: parsed.model, message: message, done: true, prompt_eval_count: 10, eval_count: 5 } ) );
			};
			setTimeout( answer, entry.delay || settings.delay || 0 );
		} );
	} );
	return new Promise( function ( resolve )
	{
		server.listen( 0, '127.0.0.1', function ()
		{
			resolve( { Url: 'http://127.0.0.1:' + server.address().port, Requests: requests, Close: function () { return new Promise( function ( done ) { server.closeAllConnections(); server.close( done ); } ); } } );
		} );
	} );
}


TEST( 'the tool loop: each call the model makes is run and sent back, the text without a call is the answer; the limits end a run', async function ()
{
	let place = make_place();
	let fake = await fake_ollama( [
		{ content: 'Let me look.', calls: [ [ 'glob', { Pattern: '**/*.js' } ] ] },
		{ calls: [ [ 'read', '{ "Path": "src/a.js" }' ], [ 'grep', { Pattern: 'two' } ] ] },
		{ content: 'Two files, a and b.' },
	] );
	try
	{
		let llm = LLMS.Fill( { Name: 'fake', Kind: 'ollama', Url: fake.Url, Model: 'fake:latest', Timeout: 30, Context: 4096, Rounds: 10 } );
		let tools = TOOLS.Tools( { Writes: 'consensus', Folder: place } );
		let transcript = [];
		let result = await OLLAMA.Run( { Llm: llm, Prompt: 'What is here?', Tools: tools, OnProgress: function ( entry ) { transcript.push( entry ); } } );
		ASSERT.equal( result.Answer, 'Two files, a and b.' );
		ASSERT.equal( result.Rounds, 3 );
		ASSERT.deepEqual( result.Usage, { Prompt: 30, Answer: 15 } );
		ASSERT.equal( fake.Requests.length, 3 );
		ASSERT.equal( fake.Requests[ 0 ].model, 'fake:latest' );
		ASSERT.equal( fake.Requests[ 0 ].stream, false );
		ASSERT.deepEqual( fake.Requests[ 0 ].options, { num_ctx: 4096 } );
		ASSERT.deepEqual( fake.Requests[ 0 ].messages, [ { role: 'user', content: 'What is here?' } ] );
		ASSERT.deepEqual( fake.Requests[ 0 ].tools.map( function ( t ) { return t.function.name; } ), [ 'glob', 'grep', 'read' ] );
		// the second request carries the model's message and the tool's result
		let second = fake.Requests[ 1 ].messages;
		ASSERT.equal( second.length, 3 );
		ASSERT.equal( second[ 1 ].role, 'assistant' );
		ASSERT.deepEqual( second[ 2 ], { role: 'tool', content: 'src/a.js\nsrc/b.js\ntool.js', tool_name: 'glob' } );
		let third = fake.Requests[ 2 ].messages;
		ASSERT.equal( third.length, 6 );
		ASSERT.match( third[ 4 ].content, /^1: let a = 1;/ );
		ASSERT.equal( third[ 5 ].tool_name, 'grep' );
		// the transcript's entries, and their markdown
		ASSERT.deepEqual( transcript.map( function ( entry ) { return [ entry.Round, entry.Kind, entry.Described || entry.Text ]; } ), [
			[ 1, 'text', 'Let me look.' ],
			[ 1, 'call', 'glob **/*.js' ],
			[ 2, 'call', 'read src/a.js' ],
			[ 2, 'call', 'grep "two"' ],
			[ 3, 'answer', 'Two files, a and b.' ],
		] );
		ASSERT.equal( transcript[ 1 ].Name, 'glob' );
		ASSERT.deepEqual( transcript[ 1 ].Arguments, { Pattern: '**/*.js' } );
		ASSERT.equal( transcript[ 1 ].Result, 'src/a.js\nsrc/b.js\ntool.js' );
		ASSERT.equal( typeof transcript[ 1 ].Duration, 'number' );
		ASSERT.equal( transcript[ 4 ].Nudged, false );
		let rendered = OLLAMA.Render( transcript );
		ASSERT.match( rendered, /^### Round 1\n\nLet me look.\n\n\*\*glob \*\*\/\*.js\*\* · [\d.]+ s\n\n```\nsrc\/a.js\nsrc\/b.js\ntool.js\n```\n\n### Round 2\n\n\*\*read src\/a.js\*\*/ );
		ASSERT.match( rendered, /### Answer\n\nTwo files, a and b.\n$/ );
		// a long result is clipped in the markdown, a fence inside it is outfenced, a nudged answer says so
		let long = OLLAMA.Render( [ { Round: 1, Kind: 'call', Described: 'read x', Result: 'a```b' + 'y'.repeat( OLLAMA.RESULT_LIMIT ), Duration: 0.1 }, { Round: 2, Kind: 'answer', Text: 'done', Nudged: true } ] );
		ASSERT.match( long, /\n````\na```by+\n````\n… 5 more characters\n\n### Answer \(asked for after 2 rounds\)\n\ndone\n$/ );
	}
	finally
	{
		await fake.Close();
	}

	// the rounds run out: one last request without tools, for the answer
	let looping = await fake_ollama( [
		{ calls: [ [ 'glob', { Pattern: '*' } ] ] },
		{ calls: [ [ 'glob', { Pattern: '*' } ] ] },
		{ content: 'Fine, here is my answer.' },
	] );
	try
	{
		let llm = LLMS.Fill( { Name: 'fake', Kind: 'ollama', Url: looping.Url, Model: 'fake:latest', Rounds: 2 } );
		let result = await OLLAMA.Run( { Llm: llm, Prompt: 'p', Tools: TOOLS.Tools( { Writes: 'consensus', Folder: place } ) } );
		ASSERT.equal( result.Answer, 'Fine, here is my answer.' );
		ASSERT.equal( result.Rounds, 2 );
		ASSERT.equal( looping.Requests.length, 3 );
		ASSERT.equal( fake.Requests.length, 3 );
		ASSERT.equal( looping.Requests[ 2 ].tools, undefined );
		ASSERT.match( looping.Requests[ 2 ].messages[ looping.Requests[ 2 ].messages.length - 1 ].content, /Answer now/ );
	}
	finally
	{
		await looping.Close();
	}

	// a refusal, a timeout, a stop, and a tool the model made up
	let refusing = await fake_ollama( [ { status: 500, text: 'model not found' } ] );
	try
	{
		let llm = LLMS.Fill( { Name: 'fake', Kind: 'ollama', Url: refusing.Url, Model: 'fake:latest' } );
		await ASSERT.rejects( OLLAMA.Run( { Llm: llm, Prompt: 'p', Tools: TOOLS.Tools( {} ) } ), /Ollama refused: 500 model not found/ );
	}
	finally
	{
		await refusing.Close();
	}
	let slow = await fake_ollama( [ { content: 'late', delay: 3000 }, { content: 'late', delay: 3000 } ] );
	try
	{
		let llm = LLMS.Fill( { Name: 'fake', Kind: 'ollama', Url: slow.Url, Model: 'fake:latest', Timeout: 1 } );
		await ASSERT.rejects( OLLAMA.Run( { Llm: llm, Prompt: 'p', Tools: TOOLS.Tools( {} ) } ), /longer than 1 seconds/ );
		let abort = new AbortController();
		setTimeout( function () { abort.abort(); }, 200 );
		await ASSERT.rejects( OLLAMA.Run( { Llm: LLMS.Fill( { Name: 'fake', Kind: 'ollama', Url: slow.Url, Model: 'fake:latest', Timeout: 30 } ), Prompt: 'p', Tools: TOOLS.Tools( {} ), Signal: abort.signal } ), /stopped/ );
	}
	finally
	{
		await slow.Close();
	}
	let gone = await fake_ollama( [] );
	let gone_url = gone.Url;
	await gone.Close();
	await ASSERT.rejects( OLLAMA.Run( { Llm: LLMS.Fill( { Name: 'fake', Kind: 'ollama', Url: gone_url, Model: 'm' } ), Prompt: 'p', Tools: TOOLS.Tools( {} ) } ), /did not answer/ );
	let inventing = await fake_ollama( [ { calls: [ [ 'delete_everything', {} ] ] }, { content: 'ok' } ] );
	try
	{
		let llm = LLMS.Fill( { Name: 'fake', Kind: 'ollama', Url: inventing.Url, Model: 'fake:latest' } );
		let result = await OLLAMA.Run( { Llm: llm, Prompt: 'p', Tools: TOOLS.Tools( { Writes: 'consensus', Folder: place } ) } );
		ASSERT.equal( result.Answer, 'ok' );
		ASSERT.match( inventing.Requests[ 1 ].messages[ 2 ].content, /no tool named delete_everything/ );
	}
	finally
	{
		await inventing.Close();
	}
} );


TEST( 'the check of an ollama connection says whether its model calls tools', async function ()
{
	let fake = await fake_ollama( [] );
	try
	{
		let calls = await LLM.Check( LLMS.Fill( { Name: 'o', Kind: 'ollama', Url: fake.Url, Model: 'fake:latest' } ) );
		ASSERT.equal( calls.Ok, true );
		ASSERT.equal( calls.Result, '2 models: fake:latest, plain:latest; fake:latest calls tools' );
		let plain = await LLM.Check( LLMS.Fill( { Name: 'o', Kind: 'ollama', Url: fake.Url, Model: 'plain:latest' } ) );
		ASSERT.equal( plain.Ok, false );
		ASSERT.match( plain.Error, /does not call tools/ );
		let missing = await LLM.Check( LLMS.Fill( { Name: 'o', Kind: 'ollama', Url: fake.Url, Model: 'none:latest' } ) );
		ASSERT.equal( missing.Ok, false );
		ASSERT.match( missing.Error, /is not among them/ );
	}
	finally
	{
		await fake.Close();
	}
} );


//---------------------------------------------------------------------
// An ollama run through Runs.js

async function settled( runs, id )
{
	let record = null;
	for ( let attempt = 0; attempt < 200 && ( !record || record.Status === 'running' ); attempt++ )
	{
		await new Promise( function ( resolve ) { setTimeout( resolve, 50 ); } );
		record = runs.Read( id );
	}
	return record;
}


TEST( 'an ollama run keeps the transcript, the answer, the rounds and the usage; a stopped one and a timed out one say so', async function ()
{
	let place = make_place();
	let folder = temporary_folder( 'desktop-ollama-runs-' );
	let runs = RUNS.Runs( { Folder: PATH.join( folder, 'runs' ) } );
	let fake = await fake_ollama( [
		{ calls: [ [ 'glob', { Pattern: '*.md' } ] ] },
		{ content: 'One readme.', delay: 400 },		// slow enough that the call is heard before the end
	] );
	try
	{
		let llm = LLMS.Fill( { Name: 'fake', Kind: 'ollama', Url: fake.Url, Model: 'fake:latest', Timeout: 30 } );
		let heard = [];
		runs.OnChange( function ( summary ) { heard.push( summary.Status ); } );
		let started = runs.Start( { Llm: llm, Writes: 'consensus', Project: { Id: 'default', Name: 'Consensus' }, Plan: { Id: 'pln-1', Title: 'Step 4' }, Folder: place, Prompt: 'What is here?' } );
		ASSERT.equal( started.Status, 'running' );
		ASSERT.equal( started.Command, 'ollama fake:latest at ' + fake.Url );
		// a press on the same plan from another connection waits its turn (plan Multiuser, Step 3), and is stopped out of the line
		let other = LLMS.Fill( { Name: 'other', Kind: 'ollama', Url: fake.Url, Model: 'fake:latest', Timeout: 30 } );
		let again = runs.Start( { Llm: other, Writes: 'consensus', Plan: { Id: 'pln-1', Title: 'Step 4' }, Prompt: 'again' } );
		ASSERT.deepEqual( [ again.Status, again.Behind.Id ], [ 'queued', started.Id ] );
		ASSERT.equal( runs.Stop( again.Id ), true );
		let record = await settled( runs, started.Id );
		ASSERT.equal( record.Status, 'done' );
		ASSERT.equal( record.Exit, 0 );
		ASSERT.equal( record.Error, null );
		ASSERT.equal( record.Rounds, 2 );
		ASSERT.deepEqual( record.Usage, { Prompt: 20, Answer: 10 } );
		ASSERT.match( record.Output, /^### Round 1\n\n\*\*glob \*.md\*\* · [\d.]+ s\n\n```\nreadme.md\n```\n\n### Answer\n\nOne readme.\n$/ );
		ASSERT.equal( record.Transcript.length, 2 );
		ASSERT.equal( record.Transcript[ 0 ].Kind, 'call' );
		ASSERT.equal( record.Transcript[ 1 ].Kind, 'answer' );
		ASSERT.equal( record.Prompt, 'What is here?' );
		// every window heard the call as it happened, between the start and the end
		ASSERT.deepEqual( heard, [ 'running', 'queued', 'stopped', 'running', 'done' ] );
		ASSERT.equal( runs.List( llm.Id )[ 0 ].Transcript, undefined );
		ASSERT.equal( runs.List( llm.Id )[ 0 ].Rounds, 2 );
		ASSERT.equal( JSON.parse( FS.readFileSync( PATH.join( folder, 'runs', started.Id + '.json' ), 'utf8' ) ).Rounds, 2 );
	}
	finally
	{
		await fake.Close();
	}

	let slow = await fake_ollama( [ { content: 'late', delay: 3000 }, { content: 'late', delay: 3000 } ] );
	try
	{
		let llm = LLMS.Fill( { Name: 'slow', Kind: 'ollama', Url: slow.Url, Model: 'fake:latest', Timeout: 30 } );
		let stopping = runs.Start( { Llm: llm, Writes: 'files', Prompt: 'p' } );
		ASSERT.equal( runs.Stop( stopping.Id ), true );
		let stopped = await settled( runs, stopping.Id );
		ASSERT.equal( stopped.Status, 'stopped' );
		ASSERT.equal( stopped.Error, 'stopped' );
		let timing = LLMS.Fill( { Name: 'timing', Kind: 'ollama', Url: slow.Url, Model: 'fake:latest', Timeout: 1 } );
		let timed = await settled( runs, runs.Start( { Llm: timing, Writes: 'files', Prompt: 'p' } ).Id );
		ASSERT.equal( timed.Status, 'failed' );
		ASSERT.equal( timed.Error, 'Ollama took longer than 1 seconds' );
	}
	finally
	{
		await slow.Close();
	}
	await runs.Close();
} );
