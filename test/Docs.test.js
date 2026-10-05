'use strict';

// The website (the plan "Documentation"): the build renders every page of pages.json into the template, every
// internal link and image resolves, and the landing page and each guide page hold the header and the footer. The
// screenshot script runs over a copy of docs/ with its images emptied, and every listed picture must be written;
// it needs the installed Chrome or Edge, as the page's test does, and Electron for the desktop's pictures.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const FS = require( 'fs' );
const OS = require( 'os' );
const PATH = require( 'path' );
const DOCS = require( '../bin/docs.js' );

const PAGE_PICTURES = [ 'first-start', 'plan', 'threads', 'tree', 'menu', 'comment', 'edit', 'revisions', 'tabs', 'build-log', 'waiting', 'settings' ];
const DESKTOP_PICTURES = [ 'desktop-connect', 'desktop-llm', 'desktop-run' ];

let copy = null;


TEST.before( function ()
{
	copy = FS.mkdtempSync( PATH.join( OS.tmpdir(), 'consensus-docs-test-' ) );
	FS.cpSync( DOCS.DOCS_FOLDER, copy, { recursive: true } );
} );


TEST.after( function ()
{
	if ( copy )
	{
		FS.rmSync( copy, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 } );
	}
} );


//---------------------------------------------------------------------

TEST( 'the build renders every page into the template, with the header and the footer, and every link resolves', function ()
{
	let pages = JSON.parse( FS.readFileSync( PATH.join( copy, 'guide', 'pages.json' ), 'utf8' ) );
	let report = DOCS.Build( { Folder: copy } );
	ASSERT.equal( report.Pages.length, pages.length );
	ASSERT.deepEqual( report.Problems, [] );
	ASSERT.equal( FS.existsSync( PATH.join( copy, 'css', 'bootstrap.min.css' ) ), true );
	let rendered = [ 'index.html' ].concat( report.Pages );
	rendered.forEach( function ( File )
	{
		let html = FS.readFileSync( PATH.join( copy, File ), 'utf8' );
		ASSERT.match( html, /<header class="site-header">/, File + ' has the header' );
		ASSERT.match( html, /<footer class="site-footer">/, File + ' has the footer' );
		ASSERT.match( html, /data-theme-toggle/, File + ' has the theme toggle' );
	} );
	ASSERT.match( FS.readFileSync( PATH.join( copy, '404.html' ), 'utf8' ), /<header class="site-header">/ );
	// A guide page: its title, its navigation with itself active, and its screenshots as per-theme figures.
	let threads = FS.readFileSync( PATH.join( copy, 'guide', 'threads.html' ), 'utf8' );
	ASSERT.match( threads, /<title>Threads - Consensus-AI guide<\/title>/ );
	ASSERT.match( threads, /<a class="guide-link active" href="threads.html">Threads<\/a>/ );
	ASSERT.match( threads, /<h2 id="the-three-states">The three states<\/h2>/ );
	ASSERT.match( threads, /<figure class="shot"><img class="light-only" src="..\/images\/plan.png"[^>]*><img class="dark-only" src="..\/images\/plan-dark.png"/ );
	ASSERT.doesNotMatch( threads, /<p><figure/ );
	ASSERT.match( threads, /<a class="guide-next" href="editing.html">/ );
	// A missing image is a problem the check names.
	FS.rmSync( PATH.join( copy, 'images', 'waiting.png' ) );
	ASSERT.deepEqual( DOCS.CheckLinks( copy ), [ PATH.join( 'guide', 'threads.html' ) + ': ../images/waiting.png is not there' ] );
} );


TEST( 'the screenshot script writes every listed picture, in both themes, and the build is clean with them', async function ()
{
	let images = PATH.join( copy, 'images' );
	FS.readdirSync( images ).forEach( function ( Name )
	{
		if ( Name.endsWith( '.png' ) )
		{
			FS.rmSync( PATH.join( images, Name ) );
		}
	} );
	let files = await DOCS.Screenshots( { Folder: copy } );
	let expected = [];
	PAGE_PICTURES.concat( DESKTOP_PICTURES ).forEach( function ( Name )
	{
		expected.push( Name + '.png', Name + '-dark.png' );
	} );
	ASSERT.equal( files.length, expected.length );
	expected.forEach( function ( Name )
	{
		let file = PATH.join( images, Name );
		ASSERT.equal( FS.existsSync( file ), true, Name + ' was written' );
		ASSERT.equal( FS.statSync( file ).size > 1000, true, Name + ' is a picture' );
	} );
	ASSERT.equal( FS.existsSync( PATH.join( copy, 'demo', 'recipe-box.json' ) ), true );
	ASSERT.equal( FS.existsSync( PATH.join( DOCS.DOCS_FOLDER, '..', '~docs-demo' ) ), false, 'the demo folder is removed' );
	ASSERT.deepEqual( DOCS.Build( { Folder: copy } ).Problems, [] );
} );
