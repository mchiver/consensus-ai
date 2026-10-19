'use strict';

// Git - the git actions the Work options ask for (plan LLM Tasks, Step 3): the pull before a run that writes files
// and the commit and push when the owner resolves a build log, each behind a switch of the project (GitSync,
// AutoCommit) and tied to a press; nothing here runs on its own. git runs without a shell in the project's folder,
// never prompts (GIT_TERMINAL_PROMPT=0) and is killed after the limit; every answer carries git's own words.
//
//   Git( { Spawn?, Timeout? } ) -> { Pull( Path ), Commit( Path, Message ), Push( Path ), Branch( Path ) }
//   Pull( Path )            -> { Ok, Output }
//   Commit( Path, Message ) -> { Ok, Commit, Branch, Nothing, Output }  Commit the short hash, Nothing true when the tree was clean
//   Push( Path )            -> { Ok, Output }
//   Branch( Path )          -> { Ok, Branch, Output }
//   Timeout: seconds per git command, 60 by default.

const CHILD_PROCESS = require( 'child_process' );

const DEFAULT_TIMEOUT = 60;


function Git( Options )
{
	let options = Options || {};
	let spawn = options.Spawn || CHILD_PROCESS.spawn;
	let timeout = ( options.Timeout || DEFAULT_TIMEOUT ) * 1000;


	// One git command in the folder: { Code, Output }, Output being stdout then stderr, trimmed; a git that cannot
	// start or takes too long answers Code null with the reason.
	function run( path, args, input )
	{
		return new Promise( function ( resolve )
		{
			let child = null;
			let output = '';
			let errors = '';
			let settled = false;
			let timer = null;

			function settle( code, note )
			{
				if ( settled )
				{
					return;
				}
				settled = true;
				clearTimeout( timer );
				let text = ( output + ( errors ? ( output ? '\n' : '' ) + errors : '' ) ).trim();
				resolve( { Code: code, Output: note ? ( text ? text + '\n' + note : note ) : text } );
			}

			try
			{
				child = spawn( 'git', args, { cwd: path, windowsHide: true, stdio: [ 'pipe', 'pipe', 'pipe' ], env: Object.assign( {}, process.env, { GIT_TERMINAL_PROMPT: '0' } ) } );
			}
			catch ( error )
			{
				settle( null, 'could not run git: ' + error.message );
				return;
			}
			timer = setTimeout( function ()
			{
				child.kill();
				settle( null, 'git ' + args[ 0 ] + ' took longer than ' + ( timeout / 1000 ) + ' seconds' );
			}, timeout );
			child.stdout.on( 'data', function ( chunk ) { output += String( chunk ); } );
			child.stderr.on( 'data', function ( chunk ) { errors += String( chunk ); } );
			child.on( 'error', function ( error ) { settle( null, 'could not run git: ' + error.message ); } );
			child.on( 'close', function ( code ) { settle( code ); } );
			child.stdin.on( 'error', function () {} );
			child.stdin.end( input || '', 'utf8' );
		} );
	}


	async function Pull( Path )
	{
		let result = await run( Path, [ 'pull', '--no-rebase' ] );
		return { Ok: result.Code === 0, Output: result.Output };
	}


	async function Branch( Path )
	{
		let result = await run( Path, [ 'rev-parse', '--abbrev-ref', 'HEAD' ] );
		return { Ok: result.Code === 0, Branch: ( result.Code === 0 ) ? result.Output.trim() : null, Output: result.Output };
	}


	// The working tree staged and committed with the message; a clean tree is no error, just Nothing.
	async function Commit( Path, Message )
	{
		let branch = await Branch( Path );
		if ( !branch.Ok )
		{
			return { Ok: false, Commit: null, Branch: null, Nothing: false, Output: branch.Output };
		}
		let added = await run( Path, [ 'add', '-A' ] );
		if ( added.Code !== 0 )
		{
			return { Ok: false, Commit: null, Branch: branch.Branch, Nothing: false, Output: added.Output };
		}
		let status = await run( Path, [ 'status', '--porcelain' ] );
		if ( status.Code === 0 && !status.Output.trim() )
		{
			return { Ok: true, Commit: null, Branch: branch.Branch, Nothing: true, Output: 'nothing to commit, working tree clean' };
		}
		let committed = await run( Path, [ 'commit', '-q', '-F', '-' ], String( Message || '' ) );
		if ( committed.Code !== 0 )
		{
			return { Ok: false, Commit: null, Branch: branch.Branch, Nothing: false, Output: committed.Output };
		}
		let hash = await run( Path, [ 'rev-parse', '--short', 'HEAD' ] );
		return { Ok: true, Commit: ( hash.Code === 0 ) ? hash.Output.trim() : null, Branch: branch.Branch, Nothing: false, Output: committed.Output };
	}


	async function Push( Path )
	{
		let result = await run( Path, [ 'push', '-q' ] );
		return { Ok: result.Code === 0, Output: result.Output };
	}


	return {
		Pull: Pull,
		Commit: Commit,
		Push: Push,
		Branch: Branch,
	};
}


module.exports = {
	Git: Git,
	DEFAULT_TIMEOUT: DEFAULT_TIMEOUT,
};
