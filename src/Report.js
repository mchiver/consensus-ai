'use strict';

// Report - a plan, its Subplans and all their threads flattened into one document (plan Printing and Reporting):
// a record of both sides, the final revision of each plan only, every author and timestamp shown. Compose reads
// the plan tree from the store into a report; Markdown writes it as one markdown document; Html as one complete
// page with a print stylesheet, the Read view's markdown styles and each anchored passage marked and numbered, so
// the browser's print, or the desktop's print to PDF, is the PDF. The server makes no PDF itself.
//
//   Compose( Store, Settings, PlanId ) -> { Report } | { Error, Status }
//   Markdown( Report ) -> string
//   Html( Report ) -> string
//   MarkHtml( Html, Marks ) -> the rendered text with <mark class="anchor <state>"> around each passage
//
// The threads of a plan are numbered in the order of their passages in the text, the whole-document threads
// first, then the detached ones last; deleted threads are gone with their text and are not in the report.

const FS = require( 'fs' );
const PATH = require( 'path' );
const MARKED = require( 'marked' );
const ANCHORS = require( './Anchors.js' );
const RULES = require( './Rules.js' );
const PARTICIPANTS = require( './Participants.js' );
const TREE = require( './Tree.js' );

const STYLE_FILE = PATH.join( __dirname, '..', 'public', 'css', 'report.css' );
const BLOCK_TAGS = [ 'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'ul', 'ol', 'blockquote', 'pre', 'table', 'tr', 'hr', 'br', 'td', 'th', 'dd', 'dt' ];
const TAG = /<\/?([a-zA-Z0-9]+)[^>]*>/g;
const ENTITY = /&#x([0-9a-fA-F]+);|&#([0-9]+);|&(quot|lt|gt|nbsp|amp);|&#39;/g;
const NAMED_ENTITIES = { quot: '"', lt: '<', gt: '>', nbsp: ' ', amp: '&' };

let style_cache = null;


//---------------------------------------------------------------------
// Compose: the report of the plan PlanId and the Subplans under it, in the tree's order and depth.

async function Compose( Store, Settings, PlanId )
{
	let read = await Store.ReadPlan( PlanId );
	if ( !read )
	{
		return { Error: 'no such plan', Status: 404 };
	}
	if ( read.Plan.Kind === 'document' || read.Plan.Kind === 'context' )
	{
		return { Error: 'a document has no threads to report; a report is of a plan', Status: 400 };
	}
	let project = await Store.ProjectOf( PlanId );
	let participants = PARTICIPANTS.PublicList( Settings );
	let items = project ? ( project.Items || [] ) : [];
	let placed = TREE.Find( items, PlanId );
	if ( !placed && project )
	{
		items = project.Archive || [];
		placed = TREE.Find( items, PlanId );
	}
	let plans = [];
	await add_plan( Store, participants, plans, read, placed ? placed.Node : null, 0 );
	let report = {
		Title: read.Plan.Title,
		Made: new Date().toISOString(),
		Zone: time_zone(),
		Server: ( Settings && Settings.Name ) || '',
		Project: project ? project.Name : '',
		Path: await path_of( Store, items, PlanId ),
		Archived: !!read.Plan.Archived,
		Participants: participants_in( plans, participants ),
		Plans: plans,
	};
	return { Report: report };
}


// One plan into the list, then each Subplan under it, one level deeper.
async function add_plan( Store, participants, plans, read, node, depth )
{
	plans.push( make_section( read, participants, depth ) );
	let children = ( node && Array.isArray( node.Items ) ) ? node.Items : [];
	for ( let child of children )
	{
		if ( child.Kind !== 'plan' )
		{
			continue;
		}
		let child_read = await Store.ReadPlan( child.Id );
		if ( child_read )
		{
			await add_plan( Store, participants, plans, child_read, child, depth + 1 );
		}
	}
}


// A plan's section: its record, text, tally and threads in reading order with their numbers and passages.
function make_section( read, participants, depth )
{
	let plain = ANCHORS.PlainText( read.Text );
	let threads = read.Threads.map( function ( thread )
	{
		let found = thread.Anchor ? ANCHORS.Find( plain, thread.Anchor ) : null;
		return {
			Thread: thread,
			Found: found,
			Detached: !!thread.Anchor && !found,
			State: state_of( thread ),
		};
	} );
	threads.sort( compare_threads );
	threads.forEach( function ( entry, index ) { entry.Number = index + 1; } );
	return {
		Depth: depth,
		Plan: read.Plan,
		Text: read.Text,
		Plain: plain,
		Tally: RULES.Tally( read.Plan, read.Threads, participants ),
		Threads: threads,
	};
}


// Whole-document threads first, then the passages in the order of the text, then the detached ones, each group
// in the order the threads were made.
function compare_threads( a, b )
{
	let group_a = group_of( a );
	let group_b = group_of( b );
	if ( group_a !== group_b )
	{
		return group_a - group_b;
	}
	if ( group_a === 1 && a.Found.Start !== b.Found.Start )
	{
		return a.Found.Start - b.Found.Start;
	}
	return String( a.Thread.Created ).localeCompare( String( b.Thread.Created ) );
}


function group_of( entry )
{
	if ( !entry.Thread.Anchor )
	{
		return 0;
	}
	return entry.Found ? 1 : 2;
}


// One word per thread, as the page shows it: contested | reopened | resolved | applied.
function state_of( thread )
{
	if ( thread.Status === 'contested' )
	{
		return thread.Reopened ? 'reopened' : 'contested';
	}
	return RULES.IsWaiting( thread ) ? 'resolved' : 'applied';
}


// The names of the folders and plans from the project's root down to the plan, the plan included: a folder's node
// carries its Name, a plan's only its id, so its title is read.
async function path_of( Store, items, id )
{
	let names = [];
	for ( let node of chain_of( items, id ) )
	{
		if ( node.Kind === 'folder' )
		{
			names.push( node.Name );
			continue;
		}
		let read = await Store.ReadPlan( node.Id );
		names.push( read ? read.Plan.Title : node.Id );
	}
	return names;
}


function chain_of( items, id )
{
	let chain = [];
	function search( list )
	{
		for ( let node of list )
		{
			chain.push( node );
			if ( node.Id === id )
			{
				return true;
			}
			if ( Array.isArray( node.Items ) && search( node.Items ) )
			{
				return true;
			}
			chain.pop();
		}
		return false;
	}
	search( items );
	return chain;
}


// The participants who wrote, resolved or applied anything in the report, with their display names and roles.
function participants_in( plans, participants )
{
	let names = new Set();
	for ( let section of plans )
	{
		for ( let entry of section.Threads )
		{
			for ( let reply of entry.Thread.Replies || [] )
			{
				names.add( reply.By );
			}
			if ( entry.Thread.Resolved )
			{
				names.add( entry.Thread.Resolved.By );
			}
			if ( entry.Thread.Applied )
			{
				names.add( entry.Thread.Applied.By );
			}
		}
	}
	return Array.from( names ).map( function ( name )
	{
		let known = participants.find( function ( participant ) { return participant.Name === name; } );
		return { Name: name, Display: known ? known.Display : name, Role: known ? known.Role : '' };
	} );
}


function time_zone()
{
	try
	{
		return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
	}
	catch ( error )
	{
		return '';
	}
}


//---------------------------------------------------------------------
// The words shared by both forms.

// A timestamp in full, in the server's zone: 2026-10-18 09:41:07.
function stamp( value )
{
	if ( !value )
	{
		return '';
	}
	let date = new Date( value );
	if ( isNaN( date.getTime() ) )
	{
		return String( value );
	}
	function two( number ) { return String( number ).padStart( 2, '0' ); }
	return date.getFullYear() + '-' + two( date.getMonth() + 1 ) + '-' + two( date.getDate() )
		+ ' ' + two( date.getHours() ) + ':' + two( date.getMinutes() ) + ':' + two( date.getSeconds() );
}


function display_of( report, name )
{
	let known = report.Participants.find( function ( participant ) { return participant.Name === name; } );
	return known ? known.Display : name;
}


function anchor_words( entry )
{
	if ( !entry.Thread.Anchor )
	{
		return 'the whole document';
	}
	return '“' + entry.Thread.Anchor.Text + '”' + ( entry.Detached ? ' (detached: these words are no longer in the text)' : '' );
}


function counts_line( tally )
{
	let parts = [ tally.Total + ( tally.Total === 1 ? ' thread' : ' threads' ) ];
	if ( tally.Total )
	{
		parts.push( tally.Applied + ' applied' );
		parts.push( tally.Resolved + ' resolved' );
		parts.push( tally.Contested + ' contested' + ( tally.Reopened ? ' (' + tally.Reopened + ' reopened)' : '' ) );
		if ( tally.Detached )
		{
			parts.push( tally.Detached + ' detached' );
		}
	}
	return parts.join( ', ' );
}


//---------------------------------------------------------------------
// Markdown: the report as one markdown document; the plans' texts as they are, the threads as lists.

function Markdown( Report )
{
	let out = [];
	let first = Report.Plans[ 0 ];
	out.push( '# Report: ' + Report.Title );
	out.push( '' );
	out.push( '- Project: ' + Report.Project + ( Report.Path.length ? ' / ' + Report.Path.join( ' / ' ) : '' ) + ( Report.Server ? ' on ' + Report.Server : '' ) );
	out.push( '- State: ' + first.Plan.State + ( Report.Archived ? ' (archived)' : '' ) + ', revision ' + first.Plan.Revision );
	out.push( '- Created ' + stamp( first.Plan.Created ) + ', last updated ' + stamp( first.Plan.Updated ) );
	out.push( '- Participants: ' + ( Report.Participants.map( function ( p ) { return p.Display + ( p.Role ? ' (' + p.Role + ')' : '' ); } ).join( ', ' ) || 'none yet' ) );
	out.push( '- Threads: ' + counts_line( first.Tally ) + ( Report.Plans.length > 1 ? '; ' + ( Report.Plans.length - 1 ) + ' Subplan' + ( Report.Plans.length > 2 ? 's' : '' ) : '' ) );
	out.push( '- Report made ' + stamp( Report.Made ) + ( Report.Zone ? ' (' + Report.Zone + ')' : '' ) );
	out.push( '' );
	for ( let section of Report.Plans )
	{
		out.push( '---' );
		out.push( '' );
		if ( section.Depth > 0 )
		{
			out.push( '#'.repeat( Math.min( 6, section.Depth + 1 ) ) + ' Subplan: ' + section.Plan.Title );
			out.push( '' );
			out.push( '- State: ' + section.Plan.State + ', revision ' + section.Plan.Revision + '; created ' + stamp( section.Plan.Created ) + ', last updated ' + stamp( section.Plan.Updated ) );
			out.push( '- Threads: ' + counts_line( section.Tally ) );
			out.push( '' );
		}
		out.push( section.Text.replace( /\s+$/, '' ) );
		out.push( '' );
		out.push( '---' );
		out.push( '' );
		out.push( '#'.repeat( Math.min( 6, section.Depth + 2 ) ) + ' Threads of ' + section.Plan.Title );
		out.push( '' );
		if ( !section.Threads.length )
		{
			out.push( 'No threads.' );
			out.push( '' );
		}
		for ( let entry of section.Threads )
		{
			out.push( entry.Number + '. ' + anchor_words( entry ) + ' — ' + entry.State );
			for ( let reply of entry.Thread.Replies || [] )
			{
				out.push( '    - **' + display_of( Report, reply.By ) + '** ' + stamp( reply.At ) + ':' );
				for ( let line of String( reply.Text || '' ).split( '\n' ) )
				{
					out.push( '      ' + line );
				}
			}
			if ( entry.Thread.Resolved )
			{
				out.push( '    - Resolved by ' + display_of( Report, entry.Thread.Resolved.By ) + ' ' + stamp( entry.Thread.Resolved.At ) );
			}
			if ( entry.Thread.Applied )
			{
				out.push( '    - Applied by ' + display_of( Report, entry.Thread.Applied.By ) + ' ' + stamp( entry.Thread.Applied.At ) + ' at revision ' + entry.Thread.Applied.Revision + ': ' + String( entry.Thread.Applied.Outcome || '' ).replace( /\s+/g, ' ' ) );
			}
		}
		out.push( '' );
	}
	return out.join( '\n' );
}


//---------------------------------------------------------------------
// Html: one complete page. The title page, then each plan: its heading, text (the passages marked and numbered)
// and threads. The stylesheet is inlined from public/css/report.css so the page stands alone when saved.

function Html( Report )
{
	let first = Report.Plans[ 0 ];
	let parts = [];
	parts.push( '<section class="title-page">' );
	parts.push( '<div class="kicker">Consensus report</div>' );
	parts.push( '<h1>' + escape_html( Report.Title ) + '</h1>' );
	parts.push( '<dl class="facts">' );
	parts.push( fact( 'Project', escape_html( Report.Project ) + ( Report.Path.length ? ' <span class="path">/ ' + Report.Path.map( escape_html ).join( ' / ' ) + '</span>' : '' ) + ( Report.Server ? ' <span class="muted">on ' + escape_html( Report.Server ) + '</span>' : '' ) ) );
	parts.push( fact( 'State', escape_html( first.Plan.State ) + ( Report.Archived ? ' (archived)' : '' ) + ', revision ' + first.Plan.Revision ) );
	parts.push( fact( 'Created', stamp( first.Plan.Created ) ) );
	parts.push( fact( 'Last updated', stamp( first.Plan.Updated ) ) );
	parts.push( fact( 'Participants', Report.Participants.map( function ( p ) { return '<span class="who">' + escape_html( p.Display ) + '</span>' + ( p.Role ? ' <span class="muted">(' + escape_html( p.Role ) + ( p.Name !== p.Display ? ', ' + escape_html( p.Name ) : '' ) + ')</span>' : '' ); } ).join( ', ' ) || 'none yet' ) );
	parts.push( fact( 'Threads', escape_html( counts_line( first.Tally ) ) + ( Report.Plans.length > 1 ? '; ' + ( Report.Plans.length - 1 ) + ' Subplan' + ( Report.Plans.length > 2 ? 's' : '' ) : '' ) ) );
	parts.push( fact( 'Report made', stamp( Report.Made ) + ( Report.Zone ? ' <span class="muted">(' + escape_html( Report.Zone ) + ')</span>' : '' ) ) );
	parts.push( '</dl>' );
	if ( Report.Plans.length > 1 )
	{
		parts.push( '<h2 class="contents-title">Contents</h2><ol class="contents">' );
		for ( let section of Report.Plans )
		{
			parts.push( '<li class="depth-' + section.Depth + '"><a href="#plan-' + escape_html( section.Plan.Id ) + '">' + escape_html( section.Plan.Title ) + '</a> <span class="muted">' + escape_html( counts_line( section.Tally ) ) + '</span></li>' );
		}
		parts.push( '</ol>' );
	}
	parts.push( '</section>' );
	for ( let section of Report.Plans )
	{
		parts.push( section_html( Report, section ) );
	}
	return page_html( Report, parts.join( '\n' ) );
}


function fact( label, value )
{
	return '<dt>' + label + '</dt><dd>' + value + '</dd>';
}


function section_html( Report, section )
{
	let out = [];
	let level = Math.min( 4, section.Depth + 1 );
	out.push( '<section class="plan depth-' + section.Depth + '" id="plan-' + escape_html( section.Plan.Id ) + '">' );
	if ( section.Depth > 0 )
	{
		out.push( '<header class="plan-head">' );
		out.push( '<div class="kicker">Subplan</div>' );
		out.push( '<h' + level + '>' + escape_html( section.Plan.Title ) + '</h' + level + '>' );
		out.push( '<div class="plan-facts">' + escape_html( section.Plan.State ) + ', revision ' + section.Plan.Revision + ' &middot; created ' + stamp( section.Plan.Created ) + ' &middot; last updated ' + stamp( section.Plan.Updated ) + ' &middot; ' + escape_html( counts_line( section.Tally ) ) + '</div>' );
		out.push( '</header>' );
	}
	let marks = section.Threads.filter( function ( entry ) { return entry.Found; } ).map( function ( entry )
	{
		return { Start: entry.Found.Start, End: entry.Found.End, Number: entry.Number, State: entry.State };
	} );
	out.push( '<div class="text markdown">' + MarkHtml( MARKED.parse( section.Text || '' ), marks ) + '</div>' );
	out.push( '<section class="threads">' );
	out.push( '<h' + Math.min( 6, level + 1 ) + ' class="threads-title">Threads' + ( section.Depth > 0 ? ' of ' + escape_html( section.Plan.Title ) : '' ) + '</h' + Math.min( 6, level + 1 ) + '>' );
	if ( !section.Threads.length )
	{
		out.push( '<p class="muted">No threads.</p>' );
	}
	for ( let entry of section.Threads )
	{
		out.push( thread_html( Report, entry ) );
	}
	out.push( '</section>' );
	out.push( '</section>' );
	return out.join( '\n' );
}


function thread_html( Report, entry )
{
	let thread = entry.Thread;
	let out = [];
	out.push( '<article class="thread ' + entry.State + ( entry.Detached ? ' detached' : '' ) + '" id="thread-' + escape_html( thread.Id ) + '">' );
	out.push( '<header class="thread-head"><span class="number">' + entry.Number + '</span> <span class="anchor-words">' + escape_html( anchor_words( entry ) ) + '</span> <span class="badge ' + entry.State + '">' + entry.State + '</span></header>' );
	for ( let reply of thread.Replies || [] )
	{
		out.push( '<div class="reply"><div class="reply-head"><span class="who">' + escape_html( display_of( Report, reply.By ) ) + '</span> <time datetime="' + escape_html( reply.At || '' ) + '">' + stamp( reply.At ) + '</time></div><div class="reply-text markdown">' + MARKED.parse( String( reply.Text || '' ) ) + '</div></div>' );
	}
	if ( thread.Resolved )
	{
		out.push( '<div class="record">Resolved by <span class="who">' + escape_html( display_of( Report, thread.Resolved.By ) ) + '</span> <time datetime="' + escape_html( thread.Resolved.At || '' ) + '">' + stamp( thread.Resolved.At ) + '</time></div>' );
	}
	if ( thread.Applied )
	{
		out.push( '<div class="record">Applied by <span class="who">' + escape_html( display_of( Report, thread.Applied.By ) ) + '</span> <time datetime="' + escape_html( thread.Applied.At || '' ) + '">' + stamp( thread.Applied.At ) + '</time> at revision ' + thread.Applied.Revision + ': <span class="outcome">' + escape_html( thread.Applied.Outcome || '' ) + '</span></div>' );
	}
	out.push( '</article>' );
	return out.join( '\n' );
}


function page_html( Report, body )
{
	let safe_title = escape_html( Report.Title );
	return [
		'<!DOCTYPE html>',
		'<html lang="en">',
		'<head>',
		'<meta charset="utf-8">',
		'<meta name="viewport" content="width=device-width, initial-scale=1">',
		'<title>' + safe_title + ' - Consensus report</title>',
		'<style>' + style() + '</style>',
		'</head>',
		'<body>',
		'<div class="controls">',
		'<span class="controls-title">' + safe_title + '</span>',
		'<button type="button" id="print-button" title="print, or save as PDF">Print</button>',
		'<button type="button" id="theme-button" title="light or dark, for reading on screen">Theme</button>',
		'<button type="button" id="browser-button" title="the same report in your browser, for its own preview and print" hidden>View in Browser</button>',
		'<a id="markdown-link" href="report.md" title="the same report as markdown">Markdown</a>',
		'<span class="controls-note" id="print-note"></span>',
		'</div>',
		'<main class="report" data-title="' + safe_title + '">',
		body,
		'</main>',
		'<script>' + script() + '</script>',
		'</body>',
		'</html>',
	].join( '\n' );
}


// The page's few behaviours: Print (the desktop's print to PDF when the window offers it, else the browser's
// print), View in Browser (the desktop only: the report at its server's own address in the system browser), and
// the theme toggle for the screen; the print is always black on white.
function script()
{
	return [
		'( function () {',
		'\tvar root = document.documentElement;',
		'\tvar note = document.getElementById( "print-note" );',
		'\tif ( window.matchMedia && window.matchMedia( "(prefers-color-scheme: dark)" ).matches ) { root.dataset.theme = "dark"; }',
		'\tdocument.getElementById( "theme-button" ).addEventListener( "click", function () { root.dataset.theme = ( root.dataset.theme === "dark" ) ? "light" : "dark"; } );',
		'\tdocument.getElementById( "print-button" ).addEventListener( "click", async function () {',
		'\t\tvar desktop = window.ConsensusDesktop;',
		'\t\tif ( desktop && typeof desktop.PrintToPdf === "function" ) {',
		'\t\t\tnote.textContent = "";',
		'\t\t\tvar result = await desktop.PrintToPdf( document.querySelector( "main.report" ).dataset.title );',
		'\t\t\tif ( result && result.Path ) { note.textContent = "written to " + result.Path; }',
		'\t\t\telse if ( result && result.Error ) { note.textContent = result.Error; }',
		'\t\t\treturn;',
		'\t\t}',
		'\t\twindow.print();',
		'\t} );',
		'\tvar browser_button = document.getElementById( "browser-button" );',
		'\tif ( window.ConsensusDesktop && typeof window.ConsensusDesktop.ViewInBrowser === "function" ) {',
		'\t\tbrowser_button.hidden = false;',
		'\t\tbrowser_button.addEventListener( "click", async function () {',
		'\t\t\tvar result = await window.ConsensusDesktop.ViewInBrowser();',
		'\t\t\tnote.textContent = ( result && result.Error ) ? result.Error : "";',
		'\t\t} );',
		'\t}',
		'} )();',
	].join( '\n' );
}


function style()
{
	if ( style_cache === null )
	{
		style_cache = FS.readFileSync( STYLE_FILE, 'utf8' );
	}
	return style_cache;
}


//---------------------------------------------------------------------
// MarkHtml: the rendered text with each passage wrapped in <mark>, the passages given as ranges of the plain
// text the server's Anchors see (PlainText's rules: block tags break, other tags vanish, entities decode,
// whitespace collapses). A passage that crosses tags is wrapped piece by piece, so the HTML stays well formed;
// where passages overlap, a piece carries every number and the state of the last one. Each passage's last piece
// is followed by its number.

function MarkHtml( Html, Marks )
{
	if ( !Marks || !Marks.length )
	{
		return Html;
	}
	let map = map_html( Html );
	// each mark as an HTML span [From, To)
	let spans = [];
	for ( let mark of Marks )
	{
		if ( mark.Start < 0 || mark.End > map.Plain.length || mark.End <= mark.Start )
		{
			continue;
		}
		spans.push( { From: map.Starts[ mark.Start ], To: map.Ends[ mark.End - 1 ], Number: mark.Number, State: mark.State } );
	}
	if ( !spans.length )
	{
		return Html;
	}
	// the cut points: every span's edges and every tag's edges inside the marked stretch
	let cuts = new Set( [ 0, Html.length ] );
	for ( let span of spans )
	{
		cuts.add( span.From );
		cuts.add( span.To );
	}
	let tags = [];
	let regex = new RegExp( TAG.source, 'g' );
	let match = regex.exec( Html );
	while ( match )
	{
		tags.push( { From: match.index, To: match.index + match[ 0 ].length } );
		cuts.add( match.index );
		cuts.add( match.index + match[ 0 ].length );
		match = regex.exec( Html );
	}
	let points = Array.from( cuts ).sort( function ( a, b ) { return a - b; } );
	let out = '';
	let ended = new Set();
	for ( let index = 0; index + 1 < points.length; index++ )
	{
		let from = points[ index ];
		let to = points[ index + 1 ];
		let piece = Html.slice( from, to );
		let inside_tag = tags.some( function ( tag ) { return tag.From <= from && to <= tag.To; } );
		let active = inside_tag ? [] : spans.filter( function ( span ) { return span.From <= from && to <= span.To; } );
		if ( active.length && piece.trim() )
		{
			let last = active[ active.length - 1 ];
			let numbers = active.map( function ( span ) { return span.Number; } ).join( ' ' );
			out += '<mark class="anchor ' + last.State + ( active.length > 1 ? ' several' : '' ) + '" data-numbers="' + numbers + '">' + piece + '</mark>';
		}
		else
		{
			out += piece;
		}
		// a passage's number, once, after the last piece of it
		for ( let span of spans )
		{
			if ( span.To <= to && !ended.has( span ) && ( to >= span.To ) )
			{
				ended.add( span );
				out += '<sup class="passage-number ' + span.State + '" title="thread ' + span.Number + '">' + span.Number + '</sup>';
			}
		}
	}
	return out;
}


// The plain text of an HTML string, each character with the span of the HTML that made it, by PlainText's rules.
function map_html( Html )
{
	let raw = [];
	let regex = new RegExp( TAG.source + '|' + ENTITY.source, 'g' );
	let at = 0;
	let match = regex.exec( Html );
	while ( match )
	{
		for ( let index = at; index < match.index; index++ )
		{
			raw.push( { Char: Html[ index ], From: index, To: index + 1 } );
		}
		let from = match.index;
		let to = match.index + match[ 0 ].length;
		if ( match[ 0 ][ 0 ] === '<' )
		{
			if ( BLOCK_TAGS.includes( match[ 1 ].toLowerCase() ) )
			{
				raw.push( { Char: '\n', From: from, To: to } );
			}
		}
		else
		{
			let decoded = decode_entity( match );
			for ( let character of decoded )
			{
				raw.push( { Char: character, From: from, To: to } );
			}
		}
		at = to;
		match = regex.exec( Html );
	}
	for ( let index = at; index < Html.length; index++ )
	{
		raw.push( { Char: Html[ index ], From: index, To: index + 1 } );
	}
	// whitespace runs become one space, carrying the first character's span; the ends are trimmed
	let map = { Plain: '', Starts: [], Ends: [] };
	let space = null;
	for ( let item of raw )
	{
		if ( /\s/.test( item.Char ) )
		{
			if ( map.Plain.length && !space )
			{
				space = item;
			}
			continue;
		}
		if ( space )
		{
			map.Plain += ' ';
			map.Starts.push( space.From );
			map.Ends.push( space.To );
			space = null;
		}
		map.Plain += item.Char;
		map.Starts.push( item.From );
		map.Ends.push( item.To );
	}
	return map;
}


// The TAG group is 1; the ENTITY groups follow it: hex 2, decimal 3, named 4; &#39; has no group.
function decode_entity( match )
{
	if ( match[ 2 ] )
	{
		return String.fromCodePoint( parseInt( match[ 2 ], 16 ) );
	}
	if ( match[ 3 ] )
	{
		return String.fromCodePoint( parseInt( match[ 3 ], 10 ) );
	}
	if ( match[ 4 ] )
	{
		return NAMED_ENTITIES[ match[ 4 ] ];
	}
	return "'";
}


function escape_html( text )
{
	return String( text === undefined || text === null ? '' : text ).replace( /&/g, '&amp;' ).replace( /</g, '&lt;' ).replace( />/g, '&gt;' ).replace( /"/g, '&quot;' );
}


module.exports = {
	Compose: Compose,
	Markdown: Markdown,
	Html: Html,
	MarkHtml: MarkHtml,
	Stamp: stamp,
};
