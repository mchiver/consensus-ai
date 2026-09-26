'use strict';

// Which files of a corpus are let in: Include, Exclude and .gitignore files (Filter.js), and what an attached zip
// gives (Corpus.js): any file let in is read unless too large or binary, whatever its name.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const FILTER = require( '../src/Filter.js' );
const CORPUS = require( '../src/Corpus.js' );
const MAKER = require( './support/ZipMaker.js' );


TEST( 'filter: Exclude wins, .gitignore files apply below their folder, an empty Include means all', function ()
{
	let why = FILTER.Make( {
		Include: [],
		Exclude: [ '.git/**', 'docs/draft.md' ],
		Gitignores: [ { Base: '', Text: '*.log\nbuild/\n' }, { Base: 'src', Text: 'secret.txt\n' } ],
	} );
	ASSERT.equal( why( 'readme.md' ), null );
	ASSERT.equal( why( 'LICENSE' ), null );
	ASSERT.equal( why( '.git/config' ), 'left out by Exclude' );
	ASSERT.equal( why( 'docs/draft.md' ), 'left out by Exclude' );
	ASSERT.equal( why( 'server.log' ), 'left out by .gitignore' );
	ASSERT.equal( why( 'build/out.js' ), 'left out by .gitignore' );
	ASSERT.equal( why( 'src/secret.txt' ), 'left out by src/.gitignore' );
	ASSERT.equal( why( 'notes/secret.txt' ), null );

	let only_source = FILTER.Make( { Include: [ 'src/**', '' ], Exclude: [ '*.test.js' ] } );
	ASSERT.equal( only_source( 'src/app.js' ), null );
	ASSERT.equal( only_source( 'readme.md' ), 'not in Include' );
	ASSERT.equal( only_source( 'src/app.test.js' ), 'left out by Exclude' );
	ASSERT.deepEqual( FILTER.Patterns( [ ' a ', '', 'b' ] ), [ 'a', 'b' ] );
} );


TEST( 'an attached zip: no list of types; its .gitignore files and the entry\'s Include and Exclude apply', async function ()
{
	let zip = MAKER.Make( [
		{ Name: 'repo/.gitignore', Data: 'dist/\n' },
		{ Name: 'repo/LICENSE', Data: 'Free to use.' },
		{ Name: 'repo/main.go', Data: 'package main' },
		{ Name: 'repo/dist/bundle.js', Data: 'built' },
		{ Name: 'repo/logo.png', Data: 'png\u0000' },
		{ Name: 'repo/notes.md', Data: '# Notes' },
	] );
	let limits = CORPUS.Limits( {} );
	ASSERT.deepEqual( limits, { MaxZipMegabytes: 50, MaxFileKilobytes: 512 } );
	let all = await CORPUS.Extract( zip, limits );
	let reasons = {};
	for ( let file of all.Files )
	{
		reasons[ file.Path ] = file.Indexed ? 'indexed' : file.Reason;
	}
	ASSERT.deepEqual( reasons, {
		'repo/.gitignore': 'indexed',
		'repo/LICENSE': 'indexed',
		'repo/dist/bundle.js': 'left out by repo/.gitignore',
		'repo/logo.png': 'binary (holds a NUL byte)',
		'repo/main.go': 'indexed',
		'repo/notes.md': 'indexed',
	} );
	let narrowed = await CORPUS.Extract( zip, limits, { Include: [ '**/*.md', '**/*.go' ], Exclude: [ 'repo/notes.md' ] } );
	ASSERT.deepEqual( Object.keys( narrowed.Texts ), [ 'repo/main.go' ] );
	ASSERT.equal( narrowed.Files.find( function ( file ) { return file.Path === 'repo/notes.md'; } ).Reason, 'left out by Exclude' );
	ASSERT.equal( narrowed.Files.find( function ( file ) { return file.Path === 'repo/LICENSE'; } ).Reason, 'not in Include' );
} );
