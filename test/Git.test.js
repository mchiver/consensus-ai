'use strict';

// Git.js (plan LLM Tasks, Step 3: the Work options) over a temporary checkout with a bare remote (test/support/Repo.js):
// pull, commit, nothing to commit, push, and a folder that is no checkout. Skipped with a note when git is not on
// the machine.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const FS = require( 'fs' );
const OS = require( 'os' );
const PATH = require( 'path' );
const GIT = require( '../src/Git.js' );
const REPO = require( './support/Repo.js' );

const SKIP = REPO.Present() ? false : 'git is not on this machine';


TEST( 'commit stages and commits the tree with the message, a clean tree is Nothing, push reaches the remote, pull brings what was pushed from elsewhere', { skip: SKIP }, async function ()
{
	let repo = REPO.Checkout();
	let git = GIT.Git();
	FS.writeFileSync( PATH.join( repo.Clone, 'built.txt' ), 'built\n' );
	let committed = await git.Commit( repo.Clone, 'A plan\n\nThe build log.\n' );
	ASSERT.equal( committed.Ok, true, committed.Output );
	ASSERT.match( committed.Commit, /^[0-9a-f]{7,}$/ );
	ASSERT.deepEqual( [ committed.Branch, committed.Nothing ], [ 'main', false ] );
	ASSERT.equal( REPO.Sh( repo.Clone, [ 'log', '-1', '--format=%s%n%n%b' ] ), 'A plan\n\nThe build log.' );
	let again = await git.Commit( repo.Clone, 'nothing' );
	ASSERT.deepEqual( [ again.Ok, again.Commit, again.Nothing ], [ true, null, true ] );
	let pushed = await git.Push( repo.Clone );
	ASSERT.equal( pushed.Ok, true, pushed.Output );
	ASSERT.equal( REPO.Sh( repo.Bare, [ 'log', '-1', '--format=%s', 'main' ] ), 'A plan' );
	let quiet = await git.Pull( repo.Clone );
	ASSERT.equal( quiet.Ok, true, quiet.Output );
	ASSERT.match( quiet.Output, /up to date/i );
	REPO.PushFromElsewhere( repo, 'elsewhere.txt', 'from elsewhere\n' );
	let pulled = await git.Pull( repo.Clone );
	ASSERT.equal( pulled.Ok, true, pulled.Output );
	ASSERT.match( pulled.Output, /elsewhere\.txt/ );
	ASSERT.match( FS.readFileSync( PATH.join( repo.Clone, 'elsewhere.txt' ), 'utf8' ), /^from elsewhere/ );
	ASSERT.deepEqual( await git.Branch( repo.Clone ), { Ok: true, Branch: 'main', Output: 'main' } );
	FS.rmSync( repo.Root, { recursive: true, force: true } );
} );


TEST( 'a folder that is no checkout: pull and commit are refused with git\'s words; a git that cannot start says so', { skip: SKIP }, async function ()
{
	let plain = FS.mkdtempSync( PATH.join( OS.tmpdir(), 'consensus-plain-' ) );
	let git = GIT.Git();
	let pulled = await git.Pull( plain );
	ASSERT.equal( pulled.Ok, false );
	ASSERT.match( pulled.Output, /not a git repository/i );
	let committed = await git.Commit( plain, 'x' );
	ASSERT.deepEqual( [ committed.Ok, committed.Commit, committed.Branch ], [ false, null, null ] );
	ASSERT.match( committed.Output, /not a git repository/i );
	let broken = GIT.Git( { Spawn: function () { throw new Error( 'no git here' ); } } );
	let failed = await broken.Pull( plain );
	ASSERT.deepEqual( failed, { Ok: false, Output: 'could not run git: no git here' } );
	FS.rmSync( plain, { recursive: true, force: true } );
} );
