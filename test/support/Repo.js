'use strict';

// A git checkout for the tests of the Work options (plan LLM Tasks, Step 3): a bare remote and a clone of it with
// one commit pushed, the clone's git user set, and a commit pushed from elsewhere for a pull to bring.
//
//   Present()                                 git answers --version on this machine
//   Sh( Folder, Arguments )                   one git command, its stdout trimmed; throws on failure
//   Checkout()                                { Root, Bare, Clone }, the branch main
//   PushFromElsewhere( Repo, Name, Text )     a second clone commits the file and pushes it; the clone is left behind

const FS = require( 'fs' );
const OS = require( 'os' );
const PATH = require( 'path' );
const CHILD_PROCESS = require( 'child_process' );


function Present()
{
	try
	{
		return CHILD_PROCESS.spawnSync( 'git', [ '--version' ], { windowsHide: true } ).status === 0;
	}
	catch ( error )
	{
		return false;
	}
}


function Sh( Folder, Arguments )
{
	let made = CHILD_PROCESS.spawnSync( 'git', Arguments, { cwd: Folder, windowsHide: true, encoding: 'utf8' } );
	if ( made.status !== 0 )
	{
		throw new Error( 'git ' + Arguments.join( ' ' ) + ' failed: ' + made.stderr );
	}
	return made.stdout.trim();
}


function clone_of( bare, folder )
{
	Sh( PATH.dirname( folder ), [ 'clone', '-q', bare, folder ] );
	Sh( folder, [ 'config', 'user.name', 'Test' ] );
	Sh( folder, [ 'config', 'user.email', 'test@example.com' ] );
}


function Checkout()
{
	let root = FS.mkdtempSync( PATH.join( OS.tmpdir(), 'consensus-git-' ) );
	let bare = PATH.join( root, 'bare.git' );
	let clone = PATH.join( root, 'clone' );
	FS.mkdirSync( bare );
	Sh( bare, [ 'init', '--bare', '-q', '-b', 'main' ] );
	clone_of( bare, clone );
	Sh( clone, [ 'checkout', '-q', '-b', 'main' ] );
	FS.writeFileSync( PATH.join( clone, 'readme.md' ), '# A project\n' );
	Sh( clone, [ 'add', '-A' ] );
	Sh( clone, [ 'commit', '-q', '-m', 'first' ] );
	Sh( clone, [ 'push', '-q', '-u', 'origin', 'main' ] );
	return { Root: root, Bare: bare, Clone: clone };
}


function PushFromElsewhere( Repo, Name, Text )
{
	let elsewhere = PATH.join( Repo.Root, 'elsewhere-' + Date.now() );
	clone_of( Repo.Bare, elsewhere );
	FS.writeFileSync( PATH.join( elsewhere, Name ), Text );
	Sh( elsewhere, [ 'add', '-A' ] );
	Sh( elsewhere, [ 'commit', '-q', '-m', 'from elsewhere: ' + Name ] );
	Sh( elsewhere, [ 'push', '-q' ] );
}


module.exports = {
	Present: Present,
	Sh: Sh,
	Checkout: Checkout,
	PushFromElsewhere: PushFromElsewhere,
};
