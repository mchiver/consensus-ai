#!/usr/bin/env node
'use strict';

// docs - the website in docs/ (the plan "Documentation"): the landing page, the user guide and the screenshots,
// published as it is to the S3 bucket.
//   node bin/docs.js build         renders guide/*.md into template.html, copies Bootstrap, checks every link and image
//   node bin/docs.js screenshots   makes every picture of docs/images/ from a seeded server and the desktop
//   node bin/docs.js publish       build, then `aws s3 sync docs/ s3://consensus-ai.liquicode.com --delete`
// Build( { Folder } ) and Screenshots( { Folder } ) are exported for the test, which runs them over a copy of docs/.

const FS = require( 'fs' );
const OS = require( 'os' );
const PATH = require( 'path' );
const CHILD_PROCESS = require( 'child_process' );
const MARKED = require( 'marked' );

const DOCS_FOLDER = PATH.join( __dirname, '..', 'docs' );
const BOOTSTRAP_CSS = PATH.join( __dirname, '..', 'node_modules', 'bootstrap', 'dist', 'css', 'bootstrap.min.css' );
const BUCKET = 's3://consensus-ai.liquicode.com';

// A link the check leaves alone: another site, mail, data, a fragment of the same page.
const EXTERNAL = /^(https?:|mailto:|data:|javascript:|#)/i;

// The screenshots: the window, the llm participant's token on the seeded server, the demo project's export, and the
// desktop's DevTools port.
const WIDTH = 1440;
const HEIGHT = 900;
const THEMES = [ 'light', 'dark' ];
const LLM_TOKEN = 'docs-llm-token-0123456789abcdef';
const DEMO_FILE = 'recipe-box.json';
const DESKTOP_PORT = 9333;
// The server's data folder and the desktop's workspace while the pictures are made: a git-ignored folder in the
// checkout, so the paths the pictures show are the project's, not the machine's temporary folder; removed after.
const DEMO_ROOT = PATH.join( __dirname, '..', '~docs-demo' );
const SIDEBAR_WIDTH = '340px';
const THREADS_WIDTH = '480px';


//---------------------------------------------------------------------
// Markdown: headings get an id so the navigation and other pages can link to them, and an image whose dark
// variant exists beside it (`name.png` and `name-dark.png`) becomes a figure that shows one per theme.

function slug( Text )
{
	return String( Text ).toLowerCase().replace( /[^a-z0-9]+/g, '-' ).replace( /^-|-$/g, '' );
}


function make_renderer( PageFolder )
{
	return {
		heading: function ( Token )
		{
			let text = this.parser.parseInline( Token.tokens );
			return '<h' + Token.depth + ' id="' + slug( Token.text ) + '">' + text + '</h' + Token.depth + '>\n';
		},
		// A paragraph that is only an image is the image: a figure does not belong in a paragraph.
		paragraph: function ( Token )
		{
			if ( Token.tokens.length === 1 && Token.tokens[ 0 ].type === 'image' )
			{
				return this.parser.parseInline( Token.tokens ) + '\n';
			}
			return '<p>' + this.parser.parseInline( Token.tokens ) + '</p>\n';
		},
		image: function ( Token )
		{
			let alt = escape_html( Token.text || '' );
			let dark = Token.href.replace( /\.(png|jpg|svg)$/i, '-dark.$1' );
			if ( dark === Token.href || !FS.existsSync( PATH.resolve( PageFolder, dark ) ) )
			{
				return '<img src="' + Token.href + '" alt="' + alt + '">';
			}
			let caption = Token.text ? '<figcaption>' + alt + '</figcaption>' : '';
			return '<figure class="shot">'
				+ '<img class="light-only" src="' + Token.href + '" alt="' + alt + '">'
				+ '<img class="dark-only" src="' + dark + '" alt="' + alt + '">'
				+ caption + '</figure>';
		},
	};
}


function escape_html( Text )
{
	return String( Text ).replace( /&/g, '&amp;' ).replace( /</g, '&lt;' ).replace( /"/g, '&quot;' );
}


function fill( Template, Values )
{
	let html = Template;
	Object.keys( Values ).forEach( function ( Name )
	{
		html = html.split( '{{ ' + Name + ' }}' ).join( Values[ Name ] );
	} );
	return html;
}


//---------------------------------------------------------------------
// Every .html file under the folder (the template excepted: its paths are the guide's), with every relative href
// and src checked against the files.

function html_files( Folder )
{
	let files = [];
	FS.readdirSync( Folder, { withFileTypes: true } ).forEach( function ( Entry )
	{
		let path = PATH.join( Folder, Entry.name );
		if ( Entry.isDirectory() )
		{
			files = files.concat( html_files( path ) );
		}
		else if ( Entry.name.endsWith( '.html' ) && Entry.name !== 'template.html' )
		{
			files.push( path );
		}
	} );
	return files;
}


function check_links( Folder )
{
	let problems = [];
	html_files( Folder ).forEach( function ( File )
	{
		let html = FS.readFileSync( File, 'utf8' );
		let pattern = /\b(href|src)="([^"]*)"/g;
		let match = pattern.exec( html );
		while ( match )
		{
			let target = match[ 2 ];
			if ( target && !EXTERNAL.test( target ) )
			{
				let clean = target.split( '#' )[ 0 ].split( '?' )[ 0 ];
				let resolved = clean.startsWith( '/' ) ? PATH.join( Folder, clean ) : PATH.resolve( PATH.dirname( File ), clean );
				if ( clean && !FS.existsSync( resolved ) )
				{
					problems.push( PATH.relative( Folder, File ) + ': ' + target + ' is not there' );
				}
			}
			match = pattern.exec( html );
		}
	} );
	return problems;
}


//---------------------------------------------------------------------
// Build: the guide's pages into the template, Bootstrap beside the stylesheet, and the check.
// Returns { Pages: [ file ], Problems: [ text ] }.

function Build( Options )
{
	let folder = ( Options && Options.Folder ) || DOCS_FOLDER;
	let guide = PATH.join( folder, 'guide' );
	let pages = JSON.parse( FS.readFileSync( PATH.join( guide, 'pages.json' ), 'utf8' ) );
	let template = FS.readFileSync( PATH.join( folder, 'template.html' ), 'utf8' );
	let marked = new MARKED.Marked( { renderer: make_renderer( guide ) } );
	let written = [];

	pages.forEach( function ( Page, Index )
	{
		let markdown = FS.readFileSync( PATH.join( guide, Page.File ), 'utf8' );
		let html_name = Page.File.replace( /\.md$/, '.html' );
		let navigation = pages.map( function ( Other )
		{
			let other_name = Other.File.replace( /\.md$/, '.html' );
			let active = ( Other === Page ) ? ' active' : '';
			return '<a class="guide-link' + active + '" href="' + other_name + '">' + escape_html( Other.Title ) + '</a>';
		} ).join( '\n\t\t\t\t' );
		let previous = ( Index > 0 ) ? pages[ Index - 1 ] : null;
		let next = ( Index < pages.length - 1 ) ? pages[ Index + 1 ] : null;
		let html = fill( template, {
			Title: escape_html( Page.Title ),
			Content: marked.parse( markdown ),
			Navigation: navigation,
			Previous: previous ? '<a class="guide-previous" href="' + previous.File.replace( /\.md$/, '.html' ) + '">&larr; ' + escape_html( previous.Title ) + '</a>' : '<span></span>',
			Next: next ? '<a class="guide-next" href="' + next.File.replace( /\.md$/, '.html' ) + '">Next: ' + escape_html( next.Title ) + ' &rarr;</a>' : '<a class="guide-next" href="../index.html">Back to the start &rarr;</a>',
		} );
		FS.writeFileSync( PATH.join( guide, html_name ), html );
		written.push( 'guide/' + html_name );
	} );

	FS.mkdirSync( PATH.join( folder, 'css' ), { recursive: true } );
	FS.copyFileSync( BOOTSTRAP_CSS, PATH.join( folder, 'css', 'bootstrap.min.css' ) );

	return { Pages: written, Problems: check_links( folder ) };
}


//---------------------------------------------------------------------
// Publish: build, then the AWS CLI's sync with the machine's default profile. Nothing of AWS is kept here.

function Publish()
{
	let report = Build();
	if ( report.Problems.length )
	{
		throw new Error( 'not published: ' + report.Problems.join( '; ' ) );
	}
	let result = CHILD_PROCESS.spawnSync( 'aws', [ 's3', 'sync', DOCS_FOLDER, BUCKET, '--delete' ], { stdio: 'inherit', shell: true } );
	if ( result.status !== 0 )
	{
		throw new Error( 'aws s3 sync ended with ' + result.status );
	}
	return;
}


//=====================================================================
// Screenshots
//=====================================================================

function wait( Ms )
{
	return new Promise( function ( Resolve ) { setTimeout( Resolve, Ms ); } );
}


// A request to the seeded server, as the owner (no token) or as the llm participant.
async function api( Url, Method, Path, Body, AsLlm )
{
	let headers = {};
	if ( Body !== undefined )
	{
		headers[ 'Content-Type' ] = 'application/json';
	}
	if ( AsLlm )
	{
		headers.Authorization = 'Bearer ' + LLM_TOKEN;
	}
	let response = await fetch( Url + Path, { method: Method, headers: headers, body: ( Body === undefined ) ? undefined : JSON.stringify( Body ) } );
	let json = await response.json();
	if ( !response.ok )
	{
		throw new Error( Method + ' ' + Path + ' answered ' + response.status + ': ' + json.Error );
	}
	return json;
}


//---------------------------------------------------------------------
// The demo project, "Recipe Box": a Readme, a document, a folder of plans, a plan with a contested, a resolved and
// an applied thread and a Subplan, and a finished plan with its build log. Made once through the API and kept as
// an export in docs/demo/, which every run imports.

const README = '# Recipe Box\n\nA small app for the recipes we cook every week: pick the week\'s recipes, and the shopping list writes itself.\n\n'
	+ 'Decided so far: a web page and a phone layout from the same code; recipes are markdown files in a folder; no accounts, one household per install.\n';

const DESIGN_NOTES = '# Design notes\n\nThe phone layout comes first: the list is used in the store, one-handed.\n\nUnits are kept as written in the recipe; adding up happens only when the units agree.\n';

const SHOPPING_LIST = '# Shopping list\n\n'
	+ 'The shopping list is made from the recipes picked for the week: one list per week, grouped by aisle, with each item checked off as it goes into the basket.\n\n'
	+ '## What goes on it\n\n'
	+ '- Every ingredient of every recipe picked for the week, added up across recipes.\n'
	+ '- Pantry staples are left off unless the pantry says they are out.\n'
	+ '- An item added by hand stays on the list until it is checked off.\n\n'
	+ '## On the phone\n\n'
	+ 'The list is one screen. A tap checks an item off; a swipe removes it. Checked items drop to the bottom.\n';

const SHOPPING_LIST_APPLIED = SHOPPING_LIST.replace(
	'- Pantry staples are left off unless the pantry says they are out.',
	'- Pantry staples are on the list too, marked as staples, until the pantry is tracked.' );

const QUANTITIES = '# Quantities\n\nWhen two recipes want the same ingredient, the list shows one line with the quantities added up: 200 g and 300 g make 500 g. '
	+ 'Quantities in different units stay on two lines until the units are settled.\n';

const SEARCH = '# Search\n\n'
	+ 'Search finds a recipe by its title, by an ingredient, or by a word of its method. Results come as you type, best match first.\n\n'
	+ '## Rules\n\n'
	+ '- A title match outranks an ingredient match, which outranks a method match.\n'
	+ '- Search ignores case and accents.\n'
	+ '- An empty search shows every recipe, newest first.\n';

const BUILD_LOG = '**Build log** (Claude Code, Claude Opus 5.5)\n\n'
	+ 'Built `src/Search.js` (the index and the ranking), `public/js/search.js` (the box and the live results) and the search page. '
	+ 'Title, ingredient and method matches are ranked as the plan says; case and accents are folded.\n\n'
	+ 'Checked with `test/Search.test.js`: 14 tests, all passing, including the empty search and an accented ingredient.\n';


async function seed_demo( Url )
{
	let project = ( await api( Url, 'POST', '/api/projects', { Name: 'Recipe Box' } ) ).Project;
	let readme = ( await api( Url, 'GET', '/api/proposals/' + project.Context ) ).Proposal;
	await api( Url, 'PUT', '/api/proposals/' + project.Context + '/text', { Text: README, Revision: readme.Revision } );
	await api( Url, 'POST', '/api/proposals', { Title: 'Design notes', Text: DESIGN_NOTES, Kind: 'document', Project: project.Id } );
	let folder = ( await api( Url, 'POST', '/api/projects/' + project.Id + '/folders', { Name: 'Plans' } ) ).Folder;
	let search = ( await api( Url, 'POST', '/api/proposals', { Title: 'Search', Text: SEARCH, Project: project.Id, Parent: folder.Id } ) ).Proposal;
	let shopping = ( await api( Url, 'POST', '/api/proposals', { Title: 'Shopping list', Text: SHOPPING_LIST, Project: project.Id, Parent: folder.Id } ) ).Proposal;
	await api( Url, 'POST', '/api/proposals', { Title: 'Quantities', Text: QUANTITIES, Project: project.Id, Parent: shopping.Id } );

	// Search: finished, with its build log applied.
	let log = ( await api( Url, 'POST', '/api/proposals/' + search.Id + '/threads', { Text: BUILD_LOG, Anchor: null }, true ) ).Thread;
	await api( Url, 'POST', '/api/proposals/' + search.Id + '/threads/' + log.Id + '/resolve', {} );
	await api( Url, 'POST', '/api/proposals/' + search.Id + '/threads/' + log.Id + '/apply', { Outcome: 'The build was accepted as reported; no text change.' }, true );
	await api( Url, 'PUT', '/api/proposals/' + search.Id + '/state', { State: 'Finished' } );

	// Shopping list: an applied thread, a resolved one, and a contested one waiting on the owner.
	let staples = ( await api( Url, 'POST', '/api/proposals/' + shopping.Id + '/threads', { Text: 'We do not track the pantry yet, so "unless the pantry says they are out" cannot work. Leave staples on the list, but marked.', Anchor: { Text: 'Pantry staples are left off unless the pantry says they are out.' } } ) ).Thread;
	await api( Url, 'POST', '/api/proposals/' + shopping.Id + '/threads/' + staples.Id + '/replies', { Text: 'Agreed. The wording I will apply: "Pantry staples are on the list too, marked as staples, until the pantry is tracked."' }, true );
	await api( Url, 'POST', '/api/proposals/' + shopping.Id + '/threads/' + staples.Id + '/resolve', {} );
	await api( Url, 'POST', '/api/proposals/' + shopping.Id + '/threads/' + staples.Id + '/apply', { Outcome: 'Staples stay on the list, marked, until the pantry is tracked.', Revision: 1, Text: SHOPPING_LIST_APPLIED, Anchor: { Text: 'Pantry staples are on the list too, marked as staples, until the pantry is tracked.' } }, true );

	let swipe = ( await api( Url, 'POST', '/api/proposals/' + shopping.Id + '/threads', { Text: 'A swipe is too easy to do by accident, in a store, with one hand.', Anchor: { Text: 'a swipe removes it' } } ) ).Thread;
	await api( Url, 'POST', '/api/proposals/' + shopping.Id + '/threads/' + swipe.Id + '/replies', { Text: 'Agreed: a swipe asks first. The wording I will apply: "A tap checks an item off; a swipe, confirmed, removes it."' }, true );
	await api( Url, 'POST', '/api/proposals/' + shopping.Id + '/threads/' + swipe.Id + '/resolve', {} );

	let aisles = ( await api( Url, 'POST', '/api/proposals/' + shopping.Id + '/threads', { Text: 'Whose aisles? Every store is laid out differently.', Anchor: { Text: 'grouped by aisle' } } ) ).Thread;
	await api( Url, 'POST', '/api/proposals/' + shopping.Id + '/threads/' + aisles.Id + '/replies', { Text: 'The store\'s, once the app knows one. Until then I recommend grouping by the recipe\'s own sections: produce, dairy, meat, dry goods. A store layout would be a plan of its own. Shall I write that in?' }, true );

	let exported = await api( Url, 'GET', '/api/projects/' + project.Id + '/export' );
	return exported;
}


// The demo project on the server: imported from docs/demo/, or seeded and exported there when the file is missing.
// Returns the project's id and the ids of the plans the pictures open.
async function demo_project( Url, Folder, Log )
{
	let file = PATH.join( Folder, 'demo', DEMO_FILE );
	let exported = null;
	if ( FS.existsSync( file ) )
	{
		exported = JSON.parse( FS.readFileSync( file, 'utf8' ) );
		await api( Url, 'POST', '/api/projects/import', { Export: exported } );
	}
	else
	{
		exported = await seed_demo( Url );
		FS.mkdirSync( PATH.dirname( file ), { recursive: true } );
		FS.writeFileSync( file, JSON.stringify( exported, null, '\t' ) );
		Log( 'demo project seeded and exported to ' + PATH.relative( Folder, file ) );
	}
	let projects = ( await api( Url, 'GET', '/api/projects' ) ).Projects;
	let project = projects.find( function ( Candidate ) { return Candidate.Name === 'Recipe Box'; } );
	let plans = {};
	( function walk( Items )
	{
		( Items || [] ).forEach( function ( Node )
		{
			if ( Node.Kind === 'plan' || Node.Kind === 'document' )
			{
				plans[ Node.Title ] = Node.Id;
			}
			walk( Node.Items );
		} );
	} )( project.Items );
	return { Id: project.Id, Context: project.Context.Id || project.Context, Plans: plans };
}


//---------------------------------------------------------------------
// One picture: the page at WIDTH x HEIGHT, or the part of it an element fills (Clip), to images/<name>[-dark].png.

async function capture( Page, Folder, Name, Theme, Clip )
{
	let file = PATH.join( Folder, 'images', Name + ( Theme === 'dark' ? '-dark' : '' ) + '.png' );
	let options = { format: 'png' };
	if ( Clip )
	{
		let box = await Page.Evaluate( '( function () { let e = document.querySelector( ' + JSON.stringify( Clip.Selector ) + ' ); if ( !e ) { return null; } let r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; } )()' );
		if ( !box )
		{
			throw new Error( 'nothing matches ' + Clip.Selector + ' for ' + Name );
		}
		options.clip = { x: box.x, y: box.y, width: box.width + ( Clip.Widen || 0 ), height: Math.min( box.height, Clip.Height || box.height ), scale: 1 };
	}
	let result = await Page.Send( 'Page.captureScreenshot', options );
	FS.writeFileSync( file, Buffer.from( result.data, 'base64' ) );
	return file;
}


// Through the sidebar's theme picker when the page has one, so the picker shows it; else the theme module.
async function set_theme( Page, Theme )
{
	let theme = JSON.stringify( Theme );
	await Page.Evaluate( '( function () { let select = document.getElementById( "theme-select" ); if ( select ) { let option = Array.from( select.options ).find( function ( candidate ) { return candidate.label.toLowerCase() === ' + theme + '; } ); if ( option ) { select.value = option.value; select.dispatchEvent( new Event( "change" ) ); return true; } } window.ConsensusTheme.SetTheme( ' + theme + ' ); return true; } )()' );
	await wait( 400 );
}


function count_of( Selector )
{
	return 'document.querySelectorAll( ' + JSON.stringify( Selector ) + ' ).length';
}


function visible( Selector )
{
	return '( function () { let e = document.querySelector( ' + JSON.stringify( Selector ) + ' ); return !!e && e.getBoundingClientRect().height > 0; } )()';
}


// The threads pane starts at Waiting on me; the pictures show every thread.
async function show_all_threads( Page )
{
	await Page.Evaluate( '( function () { let injector = angular.element( document.body ).injector(); injector.get( "State" ).Filter = "all"; injector.get( "$rootScope" ).$apply(); return true; } )()' );
	await wait( 200 );
}


// By the hash: a navigation to the same page fires no load event, so the route is set and the State awaited.
async function open_plan( Page, Url, Id )
{
	await Page.Evaluate( 'location.hash = ' + JSON.stringify( '#/p/' + Id ) + '; true' );
	await Page.WaitFor( 'angular.element( document.body ).injector().get( "State" ).OpenId === ' + JSON.stringify( Id ) + ' && ' + count_of( '#read-view h1' ) + ' === 1', 20000 );
	await Page.WaitFor( 'document.querySelector( ".connection" ) && document.querySelector( ".connection" ).textContent.trim() === "live"', 20000 );
	await show_all_threads( Page );
	await wait( 400 );
}


//---------------------------------------------------------------------
// The pictures of the page, in the order they are made, for one theme. Each takes the page, the server's Url, the
// demo and the output folder, and makes one picture.

const PAGE_PICTURES = [
	{
		Name: 'plan',
		Make: async function ( Page, Url, Demo, Folder, Theme )
		{
			await open_plan( Page, Url, Demo.Plans[ 'Shopping list' ] );
			return capture( Page, Folder, 'plan', Theme );
		},
	},
	{
		Name: 'threads',
		Make: async function ( Page, Url, Demo, Folder, Theme )
		{
			return capture( Page, Folder, 'threads', Theme, { Selector: '.threads' } );
		},
	},
	{
		Name: 'tree',
		Make: async function ( Page, Url, Demo, Folder, Theme )
		{
			return capture( Page, Folder, 'tree', Theme, { Selector: '.sidebar', Height: 470 } );
		},
	},
	{
		Name: 'menu',
		Make: async function ( Page, Url, Demo, Folder, Theme )
		{
			await Page.Evaluate( 'document.querySelector( ".project.open .project-head .row-menu" ).click(); true' );
			await Page.WaitFor( visible( '#popup-menu' ) );
			await wait( 200 );
			let file = await capture( Page, Folder, 'menu', Theme, { Selector: '.sidebar', Height: 470 } );
			await Page.Press( 'Escape' );
			await wait( 200 );
			return file;
		},
	},
	{
		Name: 'comment',
		Make: async function ( Page, Url, Demo, Folder, Theme )
		{
			await Page.Evaluate( '( function () { let p = document.querySelector( "#read-view p:last-of-type" ); let range = document.createRange(); range.selectNodeContents( p ); let selection = window.getSelection(); selection.removeAllRanges(); selection.addRange( range ); document.getElementById( "read-view" ).dispatchEvent( new MouseEvent( "mouseup", { bubbles: true } ) ); return true; } )()' );
			await Page.WaitFor( 'document.getElementById( "comment-button" ).classList.contains( "shown" )' );
			await Page.Click( '#comment-button' );
			await Page.WaitFor( 'document.activeElement && document.activeElement.id === "compose-text"' );
			await Page.Type( 'Should checked items stay where they are instead? Dropping them moves the list under your thumb.' );
			await wait( 300 );
			let file = await capture( Page, Folder, 'comment', Theme );
			await Page.Evaluate( '( function () { let injector = angular.element( document.body ).injector(); injector.get( "State" ).CancelCompose(); injector.get( "$rootScope" ).$apply(); return true; } )()' );
			await wait( 200 );
			return file;
		},
	},
	{
		Name: 'edit',
		Make: async function ( Page, Url, Demo, Folder, Theme )
		{
			// The threads pane is hidden, so the editor and its preview have the room.
			await Page.Click( '#threads-toggle' );
			await Page.Click( '#view-edit' );
			await Page.WaitFor( 'window.monaco && monaco.editor.getEditors().length === 1', 30000 );
			await wait( 800 );
			let file = await capture( Page, Folder, 'edit', Theme );
			await Page.Click( '#view-read' );
			await Page.Click( '#threads-toggle' );
			await wait( 200 );
			return file;
		},
	},
	{
		Name: 'revisions',
		Make: async function ( Page, Url, Demo, Folder, Theme )
		{
			await Page.Click( '#threads-toggle' );
			await Page.Click( '#view-revisions' );
			await Page.WaitFor( visible( '.revisions' ) );
			await wait( 500 );
			let file = await capture( Page, Folder, 'revisions', Theme );
			await Page.Click( '#view-read' );
			await Page.Click( '#threads-toggle' );
			await wait( 200 );
			return file;
		},
	},
	{
		Name: 'tabs',
		Make: async function ( Page, Url, Demo, Folder, Theme )
		{
			await open_plan( Page, Url, Demo.Context );
			await open_plan( Page, Url, Demo.Plans.Search );
			await open_plan( Page, Url, Demo.Plans[ 'Shopping list' ] );
			return capture( Page, Folder, 'tabs', Theme, { Selector: '.tabs-row' } );
		},
	},
	{
		Name: 'build-log',
		Make: async function ( Page, Url, Demo, Folder, Theme )
		{
			await open_plan( Page, Url, Demo.Plans.Search );
			return capture( Page, Folder, 'build-log', Theme, { Selector: '.threads', Height: 470 } );
		},
	},
	{
		Name: 'waiting',
		Make: async function ( Page, Url, Demo, Folder, Theme )
		{
			await Page.Evaluate( 'location.hash = "#/waiting"; true' );
			await Page.WaitFor( visible( '.waiting-view' ), 20000 );
			await wait( 500 );
			return capture( Page, Folder, 'waiting', Theme );
		},
	},
	{
		Name: 'settings',
		Make: async function ( Page, Url, Demo, Folder, Theme )
		{
			await open_plan( Page, Url, Demo.Plans[ 'Shopping list' ] );
			await Page.Click( '#settings-button' );
			await Page.WaitFor( visible( '.settings-popup' ) );
			await wait( 400 );
			let file = await capture( Page, Folder, 'settings', Theme );
			await Page.Click( '#settings-close' );
			await wait( 200 );
			return file;
		},
	},
];


//---------------------------------------------------------------------
// The desktop's pictures: the connect screen, the LLM page and a finished run, over the desktop started with its own
// user-data folder, connected to the seeded server, with a stand-in command as the LLM.

const REVIEW_STAND_IN = 'let input = "";\n'
	+ 'process.stdin.setEncoding( "utf8" );\n'
	+ 'process.stdin.on( "data", function ( chunk ) { input += chunk; } );\n'
	+ 'process.stdin.on( "end", function () {\n'
	+ '\tconsole.log( "## Review of Shopping list\\n" );\n'
	+ '\tconsole.log( "I read the plan, its three threads and the workspace (" + input.length + " characters of prompt).\\n" );\n'
	+ '\tconsole.log( "- **grouped by aisle**: replied with the recipe-section grouping as the default; a store layout is a plan of its own." );\n'
	+ '\tconsole.log( "- **a swipe removes it**: resolved by the owner; applied as \\"a swipe, confirmed, removes it\\"." );\n'
	+ '\tconsole.log( "- The applied staples thread needs nothing more.\\n" );\n'
	+ '\tconsole.log( "Nothing else waits on me. Your turn." );\n'
	+ '} );\n';


async function wait_for_target( Port, Test, TimeoutMs )
{
	let limit = Date.now() + TimeoutMs;
	while ( Date.now() < limit )
	{
		try
		{
			let targets = await ( await fetch( 'http://127.0.0.1:' + Port + '/json/list' ) ).json();
			let found = targets.find( function ( Target ) { return Target.type === 'page' && Test( Target ); } );
			if ( found )
			{
				return found;
			}
		}
		catch ( error )
		{
			// not listening yet
		}
		await wait( 250 );
	}
	throw new Error( 'the desktop did not show the expected page within ' + TimeoutMs + ' ms' );
}


async function desktop_pictures( Url, Demo, Folder, Log )
{
	const CDP = require( '../test/support/Cdp.js' );
	let electron = require( 'electron' );
	let user_data = FS.mkdtempSync( PATH.join( OS.tmpdir(), 'consensus-docs-desktop-' ) );
	let workspace = PATH.join( DEMO_ROOT, 'recipe-box' );
	FS.mkdirSync( PATH.join( workspace, 'src' ), { recursive: true } );
	FS.writeFileSync( PATH.join( workspace, 'readme.md' ), '# Recipe Box\n\nThe app the demo project plans.\n' );
	FS.writeFileSync( PATH.join( workspace, 'src', 'Search.js' ), '\'use strict\';\n\n// Search - the index and the ranking (plan Search).\n' );
	FS.writeFileSync( PATH.join( workspace, 'src', 'List.js' ), '\'use strict\';\n\n// List - the shopping list (plan Shopping list).\n' );
	let stand_in = PATH.join( DEMO_ROOT, 'claude-one-shot.js' );
	FS.writeFileSync( stand_in, REVIEW_STAND_IN );
	let settings = {
		Servers: [ { Name: 'Recipe Box server', Url: Url } ],
		Local: { Data: PATH.join( DEMO_ROOT, 'data' ), Port: 3500 },
		Last: null,
		Theme: 'light',
		Scale: 'normal',
		Llms: [ { Id: 'llm-doc-cla-ude', Name: 'Claude Code', Kind: 'claude-cli', Command: process.execPath, Arguments: [ stand_in ], Model: 'opus', Timeout: 120 } ],
		Workspaces: [ { Id: 'wks-doc-rec-ipe', Name: 'recipe-box', Project: Demo.Id, Path: workspace, Include: [], Exclude: [ 'node_modules/**' ], Commands: [ 'npm test' ] } ],
	};
	FS.writeFileSync( PATH.join( user_data, 'desktop.json' ), JSON.stringify( settings, null, '\t' ) );

	let child = CHILD_PROCESS.spawn( electron, [ 'desktop', '--remote-debugging-port=' + DESKTOP_PORT, '--user-data-dir=' + user_data ], { cwd: PATH.join( __dirname, '..' ), stdio: 'ignore' } );
	let exited = new Promise( function ( Resolve ) { child.on( 'exit', Resolve ); } );
	let files = [];
	let page = null;
	try
	{
		let target = await wait_for_target( DESKTOP_PORT, function ( Target ) { return Target.url.includes( 'connect.html' ); }, 60000 );
		page = await CDP.Attach( target.webSocketDebuggerUrl );
		await page.Send( 'Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false } );
		await page.WaitFor( count_of( '.server-row' ) + ' === 1', 20000 );
		await wait( 500 );
		for ( let theme of THEMES )
		{
			await set_theme( page, theme );
			files.push( await capture( page, Folder, 'desktop-connect', theme ) );
			Log( 'desktop-connect ' + theme );
		}
		await set_theme( page, 'light' );

		// Connect: the window loads the page copy; the DevTools target is attached again after the navigation.
		await page.Evaluate( 'window.Desktop.Connect( { Kind: "server", Name: "Recipe Box server" } )' );
		page.Close();
		target = await wait_for_target( DESKTOP_PORT, function ( Target ) { return !Target.url.includes( 'connect.html' ); }, 30000 );
		await wait( 1000 );
		page = await CDP.Attach( target.webSocketDebuggerUrl );
		await page.Send( 'Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false } );
		await page.WaitFor( count_of( '.tree-item' ) + ' > 0', 30000 );
		// The same pane widths as the page's pictures (the desktop's copy keeps its own storage), then a reload.
		await page.Evaluate( 'localStorage.setItem( "consensus.--sidebar-width", ' + JSON.stringify( SIDEBAR_WIDTH ) + ' ); localStorage.setItem( "consensus.--threads-width", ' + JSON.stringify( THREADS_WIDTH ) + ' ); location.reload(); true' );
		await wait( 1500 );
		await page.WaitFor( count_of( '.tree-item' ) + ' > 0', 30000 );
		// The demo project open, with its plan last opened, so the LLM page's picker starts on it.
		await open_plan( page, Url, Demo.Plans[ 'Shopping list' ] );
		await page.Evaluate( 'location.hash = "#/llm/' + Demo.Id + '/llm-doc-cla-ude"; true' );
		await page.WaitFor( '!!document.getElementById( "llm-review-run" ) && !document.getElementById( "llm-review-run" ).disabled', 30000 );
		await wait( 800 );
		for ( let theme of THEMES )
		{
			await set_theme( page, theme );
			files.push( await capture( page, Folder, 'desktop-llm', theme ) );
			Log( 'desktop-llm ' + theme );
		}
		await set_theme( page, 'light' );

		// A review with the stand-in, then its popup.
		await page.Evaluate( 'document.getElementById( "llm-review-run" ).click(); true' );
		// A finished run opens its own popup (a second .run-row, static, inside it); the log's row is clicked if not.
		await page.WaitFor( count_of( '.run-row.done' ) + ' >= 1', 120000 );
		await wait( 500 );
		if ( !( await page.Evaluate( visible( '.run-popup' ) ) ) )
		{
			await page.Evaluate( 'document.querySelector( ".run-row.done" ).click(); true' );
		}
		await page.WaitFor( visible( '.run-popup' ) + ' && document.getElementById( "run-output-rendered" ) && document.getElementById( "run-output-rendered" ).textContent.includes( "Review of" )', 20000 );
		await wait( 600 );
		for ( let theme of THEMES )
		{
			await set_theme( page, theme );
			files.push( await capture( page, Folder, 'desktop-run', theme ) );
			Log( 'desktop-run ' + theme );
		}
	}
	finally
	{
		if ( page )
		{
			page.Close();
		}
		child.kill();
		await Promise.race( [ exited, wait( 5000 ) ] );
		FS.rmSync( user_data, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 } );
	}
	return files;
}


//---------------------------------------------------------------------
// Screenshots( { Folder, Log, Desktop } ): every picture, into Folder/images. A server runs on a temporary data
// folder with the demo project; a headless Chrome or Edge takes the page's pictures in both themes; then the
// desktop's. Returns the files written.

async function Screenshots( Options )
{
	const SERVER = require( '../src/Server.js' );
	const PARTICIPANTS = require( '../src/Participants.js' );
	const CDP = require( '../test/support/Cdp.js' );
	let folder = ( Options && Options.Folder ) || DOCS_FOLDER;
	let log = ( Options && Options.Log ) || function () {};
	let with_desktop = !( Options && Options.Desktop === false );
	FS.mkdirSync( PATH.join( folder, 'images' ), { recursive: true } );

	FS.rmSync( DEMO_ROOT, { recursive: true, force: true } );
	let data = PATH.join( DEMO_ROOT, 'data' );
	FS.mkdirSync( data, { recursive: true } );
	let settings = PARTICIPANTS.DefaultSettings( 3500 );
	settings.Participants[ 1 ].Token = LLM_TOKEN;
	FS.writeFileSync( PATH.join( data, 'consensus.json' ), JSON.stringify( settings, null, '\t' ) );
	// The settings say 3500, as a real one's would; the server itself takes a free port.
	let running = await SERVER.Start( { Data: data, Port: 0 } );
	let browser = null;
	let files = [];
	try
	{
		browser = await CDP.StartBrowser( { Width: WIDTH, Height: HEIGHT } );
		let page = await browser.OpenPage( running.Url + '/' );
		await page.Send( 'Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false } );
		await page.WaitFor( count_of( '.project' ) + ' === 1', 20000 );
		// Wider panes than the defaults, so titles and threads are not cut; the page reads them at load.
		await page.Evaluate( 'localStorage.setItem( "consensus.--sidebar-width", ' + JSON.stringify( SIDEBAR_WIDTH ) + ' ); localStorage.setItem( "consensus.--threads-width", ' + JSON.stringify( THREADS_WIDTH ) + ' ); true' );
		await page.Navigate( running.Url + '/' );
		await page.WaitFor( count_of( '.project' ) + ' === 1', 20000 );
		await wait( 500 );
		for ( let theme of THEMES )
		{
			await set_theme( page, theme );
			files.push( await capture( page, folder, 'first-start', theme ) );
			log( 'first-start ' + theme );
		}

		let demo = await demo_project( running.Url, folder, log );
		for ( let theme of THEMES )
		{
			await set_theme( page, theme );
			for ( let picture of PAGE_PICTURES )
			{
				files.push( await picture.Make( page, running.Url, demo, folder, theme ) );
				log( picture.Name + ' ' + theme );
			}
		}
		if ( with_desktop )
		{
			files = files.concat( await desktop_pictures( running.Url, demo, folder, log ) );
		}
	}
	finally
	{
		if ( browser )
		{
			await browser.Close();
		}
		await running.Close();
		FS.rmSync( DEMO_ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 } );
	}
	return files;
}


//---------------------------------------------------------------------
async function main()
{
	let command = process.argv[ 2 ];
	if ( command === 'build' )
	{
		let report = Build();
		console.log( report.Pages.length + ' guide pages rendered' );
		report.Problems.forEach( function ( Problem ) { console.error( 'problem: ' + Problem ); } );
		if ( report.Problems.length )
		{
			process.exit( 1 );
		}
	}
	else if ( command === 'screenshots' )
	{
		let files = await Screenshots( { Log: console.log, Desktop: !process.argv.includes( '--no-desktop' ) } );
		console.log( files.length + ' pictures written to docs/images/' );
	}
	else if ( command === 'publish' )
	{
		Publish();
		console.log( 'published to ' + BUCKET );
	}
	else
	{
		console.log( 'usage: node bin/docs.js build | screenshots [--no-desktop] | publish' );
		process.exit( command ? 1 : 0 );
	}
	return;
}


if ( require.main === module )
{
	main().catch( function ( error )
	{
		console.error( error.stack || error.message );
		process.exit( 1 );
	} );
}


module.exports = {
	DOCS_FOLDER: DOCS_FOLDER,
	BUCKET: BUCKET,
	PAGE_PICTURES: PAGE_PICTURES,
	Build: Build,
	Publish: Publish,
	Screenshots: Screenshots,
	CheckLinks: check_links,
};
