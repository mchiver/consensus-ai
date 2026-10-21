// LivePreview - the markdown rendered in place in the CodeMirror editor (plan Markdown Editor, Step 1), the way
// Obsidian's Live Preview does: off the lines the selection touches, the syntax is hidden and the constructs are
// styled or replaced by widgets; on those lines the source shows. An ES module beside anchormap.js: the bundle
// imports it and puts it on window.CodeMirror6.LivePreview, and test/LivePreview.test.js imports it in node.
//
//   Plan( Source, Revealed, Tree ) -> [ { From, To, Kind, ... } ]   the decorations to make, sorted by From
//       Revealed  the line numbers (1-based) whose source shows; a fenced code block or a table that holds one of
//                 them shows whole
//       Tree      the Lezer markdown tree of Source (the editor's; parsed here with the anchor map's parser when
//                 not given, as the node test does)
//   Extension( Options ) -> the editor extensions: a state field of decorations over the whole document, rebuilt when
//                 the document changes, the revealed lines change or the anchors change (a field, not a view plugin,
//                 because the table and image widgets are block decorations), and the handlers (Ctrl+click opens a
//                 link). Options (plan UI Tweaks IX, for the table widget's anchors): Anchors, the editor's anchor
//                 field (mirror.js: { Decorations, Selected }); Wrap( Element, Markdown, Threads, SelectedId ), the
//                 Read view's rendering with the marks (Render.Show); OnAnchorClick( Ids ), a mousedown on a mark.
//
// The kinds: line (Class: h1 to h6, quote, code-line), hide (a range replaced by nothing), escape (the backslash),
// bullet (a list mark replaced by a bullet), check (a task marker replaced by a checkbox; Checked), link (a mark
// over the link's text; Url), code (a mark over inline code), fence-start (the opening fence line; Language),
// fence-end (the closing fence line), setext (a setext underline), rule (a horizontal rule's line), table (the
// whole table; Text) and image (the image's source; Url, Alt). The block kinds cover whole lines.

import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import { StateField, Facet } from '@codemirror/state';
import { syntaxTree, ensureSyntaxTree } from '@codemirror/language';
import { Parser, Build, PlainRange } from './anchormap.js';

const HEADINGS = { ATXHeading1: 'h1', ATXHeading2: 'h2', ATXHeading3: 'h3', ATXHeading4: 'h4', ATXHeading5: 'h5', ATXHeading6: 'h6', SetextHeading1: 'h1', SetextHeading2: 'h2' };
const MARKS = new Set( [ 'EmphasisMark', 'StrikethroughMark' ] );
const PARSE_BUDGET = 100;		// milliseconds given to finish the tree before the decorations are built
// What Extension was given, as a facet of the editor's state (each editor its own: the revisions view makes editors too).
const OPTIONS = Facet.define( { combine: function ( values ) { return values.length ? values[ 0 ] : {}; } } );


//---------------------------------------------------------------------
// The plan: a walk of the tree.

export function Plan( Source, Revealed, Tree )
{
	let source = Source || '';
	let tree = Tree || Parser().parse( source );
	let context = {
		Source: source,
		Starts: line_starts( source ),
		Revealed: new Set( Revealed || [] ),
		Items: [],
	};
	tree.iterate( { enter: function ( node ) { return enter( node, context ); } } );
	context.Items.sort( function ( a, b ) { return a.From - b.From || a.To - b.To; } );
	return context.Items;
}


function line_starts( source )
{
	let starts = [ 0 ];
	for ( let index = 0; index < source.length; index++ )
	{
		if ( source[ index ] === '\n' )
		{
			starts.push( index + 1 );
		}
	}
	return starts;
}


// The 1-based line number holding a position.
function line_of( context, position )
{
	let low = 0;
	let high = context.Starts.length - 1;
	while ( low < high )
	{
		let middle = ( low + high + 1 ) >> 1;
		if ( context.Starts[ middle ] <= position )
		{
			low = middle;
		}
		else
		{
			high = middle - 1;
		}
	}
	return low + 1;
}


function line_start( context, number )
{
	return context.Starts[ number - 1 ];
}


function line_end( context, number )
{
	let next = context.Starts[ number ];
	return ( next === undefined ) ? context.Source.length : next - 1;
}


function is_revealed( context, position )
{
	return context.Revealed.has( line_of( context, position ) );
}


// A block (a fenced code block, a table) shows its source whole when any of its lines is revealed.
function block_revealed( context, from, to )
{
	let first = line_of( context, from );
	let last = line_of( context, to );
	for ( let number = first; number <= last; number++ )
	{
		if ( context.Revealed.has( number ) )
		{
			return true;
		}
	}
	return false;
}


function add( context, item )
{
	context.Items.push( item );
}


function add_line( context, number, class_name )
{
	add( context, { From: line_start( context, number ), To: line_start( context, number ), Kind: 'line', Class: class_name } );
}


// A hidden range, unless its line is revealed.
function hide( context, from, to )
{
	if ( to > from && !is_revealed( context, from ) )
	{
		add( context, { From: from, To: to, Kind: 'hide' } );
	}
}


// The mark and the one space after it, when there is one.
function with_space( context, to )
{
	return ( context.Source[ to ] === ' ' ) ? to + 1 : to;
}


function enter( node, context )
{
	let name = node.name;
	let source = context.Source;

	if ( HEADINGS[ name ] )
	{
		let heading = node.node;
		let marks = heading.getChildren( 'HeaderMark' );
		if ( name.startsWith( 'Setext' ) )
		{
			add_line( context, line_of( context, node.from ), HEADINGS[ name ] );
			let underline = marks[ 0 ];
			if ( underline )
			{
				let number = line_of( context, underline.from );
				if ( !context.Revealed.has( number ) && !is_revealed( context, node.from ) )
				{
					add( context, { From: line_start( context, number ), To: line_end( context, number ), Kind: 'setext' } );
				}
			}
			return;
		}
		add_line( context, line_of( context, node.from ), HEADINGS[ name ] );
		for ( let mark of marks )
		{
			if ( mark.from === node.from )
			{
				hide( context, mark.from, with_space( context, mark.to ) );
			}
			else
			{
				// a closing run of #: hidden with the space before it
				hide( context, ( source[ mark.from - 1 ] === ' ' ) ? mark.from - 1 : mark.from, mark.to );
			}
		}
		return;
	}

	if ( MARKS.has( name ) )
	{
		hide( context, node.from, node.to );
		return;
	}

	if ( name === 'InlineCode' )
	{
		let marks = node.node.getChildren( 'CodeMark' );
		if ( marks.length === 2 )
		{
			hide( context, marks[ 0 ].from, marks[ 0 ].to );
			hide( context, marks[ 1 ].from, marks[ 1 ].to );
			add( context, { From: marks[ 0 ].to, To: marks[ 1 ].from, Kind: 'code' } );
		}
		return false;
	}

	if ( name === 'Link' )
	{
		let link = node.node;
		let url = link.getChild( 'URL' );
		let marks = link.getChildren( 'LinkMark' );
		if ( !url || marks.length < 2 )
		{
			// a reference link stays as it is
			return;
		}
		add( context, { From: marks[ 0 ].to, To: marks[ 1 ].from, Kind: 'link', Url: source.slice( url.from, url.to ) } );
		hide( context, marks[ 0 ].from, marks[ 0 ].to );
		hide( context, marks[ 1 ].from, node.to );
		// the children are not entered: a hidden range inside the hidden tail would nest two replacements
		return false;
	}

	if ( name === 'Autolink' )
	{
		let text = source.slice( node.from, node.to ).replace( /^<|>$/g, '' );
		add( context, { From: node.from, To: node.to, Kind: 'link', Url: text } );
		return false;
	}

	if ( name === 'Image' )
	{
		let image = node.node;
		let url = image.getChild( 'URL' );
		let marks = image.getChildren( 'LinkMark' );
		if ( url && marks.length >= 2 && !is_revealed( context, node.from ) )
		{
			add( context, { From: node.from, To: node.to, Kind: 'image', Url: source.slice( url.from, url.to ), Alt: source.slice( marks[ 0 ].to, marks[ 1 ].from ) } );
		}
		return false;
	}

	if ( name === 'ListMark' )
	{
		let item = node.node.parent;
		let list = item ? item.parent : null;
		if ( list && list.name === 'BulletList' && !is_revealed( context, node.from ) )
		{
			add( context, { From: node.from, To: node.to, Kind: 'bullet' } );
		}
		return;
	}

	if ( name === 'TaskMarker' )
	{
		if ( !is_revealed( context, node.from ) )
		{
			add( context, { From: node.from, To: node.to, Kind: 'check', Checked: /x/i.test( source.slice( node.from, node.to ) ) } );
		}
		return;
	}

	if ( name === 'Blockquote' )
	{
		let first = line_of( context, node.from );
		let last = line_of( context, node.to );
		for ( let number = first; number <= last; number++ )
		{
			add_line( context, number, 'quote' );
		}
		return;
	}

	if ( name === 'QuoteMark' )
	{
		hide( context, node.from, with_space( context, node.to ) );
		return;
	}

	if ( name === 'FencedCode' )
	{
		fenced_code( node.node, context );
		return false;
	}

	if ( name === 'CodeBlock' )
	{
		let first = line_of( context, node.from );
		let last = line_of( context, node.to );
		for ( let number = first; number <= last; number++ )
		{
			add_line( context, number, 'code-line' );
		}
		return false;
	}

	if ( name === 'HorizontalRule' )
	{
		if ( !is_revealed( context, node.from ) )
		{
			let number = line_of( context, node.from );
			add( context, { From: line_start( context, number ), To: line_end( context, number ), Kind: 'rule' } );
		}
		return false;
	}

	if ( name === 'Table' )
	{
		if ( !block_revealed( context, node.from, node.to ) )
		{
			let first = line_of( context, node.from );
			let last = line_of( context, node.to );
			add( context, { From: line_start( context, first ), To: line_end( context, last ), Kind: 'table', Text: source.slice( line_start( context, first ), line_end( context, last ) ) } );
		}
		return false;
	}

	if ( name === 'Escape' )
	{
		hide( context, node.from, node.from + 1 );
		return false;
	}

	// HTML, entities, hard breaks, link references and footnotes stay as they are
	if ( name === 'HTMLBlock' || name === 'HTMLTag' || name === 'LinkReference' )
	{
		return false;
	}
	return undefined;
}


// A fenced code block: the fence lines replaced by the box's top (with the language) and bottom, the code lines
// styled; revealed, the lines show as they are, the code lines keeping their background.
function fenced_code( node, context )
{
	let first = line_of( context, node.from );
	let last = line_of( context, node.to );
	let marks = node.getChildren( 'CodeMark' );
	let info = node.getChild( 'CodeInfo' );
	let closed = marks.length === 2 && line_of( context, marks[ 1 ].from ) > first;
	let code_first = first + 1;
	let code_last = closed ? last - 1 : last;
	for ( let number = code_first; number <= code_last; number++ )
	{
		add_line( context, number, 'code-line' );
	}
	if ( block_revealed( context, node.from, node.to ) )
	{
		return;
	}
	let language = info ? context.Source.slice( info.from, info.to ).trim() : '';
	add( context, { From: line_start( context, first ), To: line_end( context, first ), Kind: 'fence-start', Language: language } );
	if ( closed )
	{
		add( context, { From: line_start( context, last ), To: line_end( context, last ), Kind: 'fence-end' } );
	}
}


//---------------------------------------------------------------------
// The widgets.

class BulletWidget extends WidgetType
{
	toDOM()
	{
		let span = document.createElement( 'span' );
		span.className = 'cm-live-bullet';
		span.textContent = '•';
		return span;
	}

	eq()
	{
		return true;
	}
}


class CheckWidget extends WidgetType
{
	constructor( Checked )
	{
		super();
		this.Checked = Checked;
	}

	toDOM( view )
	{
		let widget = this;
		let label = document.createElement( 'span' );
		label.className = 'cm-live-check';
		let input = document.createElement( 'input' );
		input.type = 'checkbox';
		input.checked = widget.Checked;
		input.addEventListener( 'mousedown', function ( event ) { event.preventDefault(); } );
		input.addEventListener( 'click', function ( event )
		{
			event.preventDefault();
			let at = view.posAtDOM( label );
			let marker = view.state.doc.sliceString( at, at + 3 );
			if ( !/^\[[ xX]\]$/.test( marker ) )
			{
				return;
			}
			view.dispatch( { changes: { from: at, to: at + 3, insert: widget.Checked ? '[ ]' : '[x]' } } );
		} );
		label.appendChild( input );
		return label;
	}

	eq( other )
	{
		return other.Checked === this.Checked;
	}

	ignoreEvent()
	{
		return true;
	}
}


class FenceWidget extends WidgetType
{
	constructor( Language, Side )
	{
		super();
		this.Language = Language;
		this.Side = Side;
	}

	toDOM()
	{
		let div = document.createElement( 'div' );
		div.className = 'cm-live-fence ' + this.Side;
		if ( this.Side === 'start' )
		{
			let label = document.createElement( 'span' );
			label.className = 'cm-live-fence-language';
			label.textContent = this.Language || 'code';
			div.appendChild( label );
		}
		return div;
	}

	eq( other )
	{
		return other.Language === this.Language && other.Side === this.Side;
	}
}


class LineWidget extends WidgetType
{
	constructor( Class )
	{
		super();
		this.Class = Class;
	}

	toDOM()
	{
		let div = document.createElement( 'div' );
		div.className = this.Class;
		return div;
	}

	eq( other )
	{
		return other.Class === this.Class;
	}
}


// The table, rendered by marked; the anchors within it (plan UI Tweaks IX: Anchors in offsets of Text, { From, To, Id,
// State }) are wrapped in the Read view's marks by Options.Wrap, over the table's own anchor map, so an anchored
// passage in a table highlights as elsewhere; a mousedown on a mark is the thread's, any other click edits the table.
class TableWidget extends WidgetType
{
	constructor( Text, Anchors, Selected, Options )
	{
		super();
		this.Text = Text;
		this.Anchors = Anchors || [];
		this.Selected = Selected || null;
		this.Options = Options || {};
	}

	key()
	{
		return this.Anchors.map( function ( anchor ) { return anchor.From + ':' + anchor.To + ':' + anchor.Id + ':' + anchor.State; } ).join( ' ' ) + '|' + this.Selected;
	}

	toDOM( view )
	{
		let options = this.Options;
		let div = document.createElement( 'div' );
		div.className = 'cm-live-table markdown';
		let threads = [];
		if ( this.Anchors.length && typeof options.Wrap === 'function' )
		{
			let map = Build( this.Text );
			for ( let anchor of this.Anchors )
			{
				let plain = PlainRange( map, anchor.From, anchor.To );
				if ( plain )
				{
					threads.push( { Id: anchor.Id, State: anchor.State, Found: { Start: plain.Start, End: plain.End } } );
				}
			}
		}
		if ( threads.length )
		{
			options.Wrap( div, this.Text, threads, this.Selected );
		}
		else
		{
			div.innerHTML = ( typeof globalThis.marked !== 'undefined' ) ? globalThis.marked.parse( this.Text ) : '';
		}
		div.title = 'click to edit the table';
		div.addEventListener( 'mousedown', function ( event )
		{
			event.preventDefault();
			let mark = event.target.closest( '.anchor' );
			if ( mark && typeof options.OnAnchorClick === 'function' )
			{
				let ids = String( mark.dataset.threads || '' ).split( ' ' ).filter( function ( id ) { return !!id; } );
				if ( ids.length )
				{
					options.OnAnchorClick( ids );
					return;
				}
			}
			let at = view.posAtDOM( div );
			view.dispatch( { selection: { anchor: at } } );
			view.focus();
		} );
		return div;
	}

	eq( other )
	{
		return other.Text === this.Text && other.key() === this.key();
	}

	ignoreEvent()
	{
		return true;
	}
}


// The anchors of the editor's field that fall within a table, in offsets of the table's text, and the selected thread.
function table_anchors( state, from, to )
{
	let options = state.facet( OPTIONS );
	let field = options.Anchors ? state.field( options.Anchors, false ) : null;
	if ( !field )
	{
		return { List: [], Selected: null };
	}
	let list = [];
	field.Decorations.between( from, to, function ( start, end, decoration )
	{
		if ( decoration.spec.Anchor && end > from && start < to )
		{
			list.push( { From: Math.max( start, from ) - from, To: Math.min( end, to ) - from, Id: decoration.spec.Anchor.Id, State: decoration.spec.Anchor.State } );
		}
	} );
	return { List: list, Selected: field.Selected };
}


class ImageWidget extends WidgetType
{
	constructor( Url, Alt )
	{
		super();
		this.Url = Url;
		this.Alt = Alt;
	}

	toDOM( view )
	{
		let widget = this;
		let image = document.createElement( 'img' );
		image.className = 'cm-live-image';
		image.src = widget.Url;
		image.alt = widget.Alt;
		image.title = widget.Alt || widget.Url;
		image.addEventListener( 'load', function () { view.requestMeasure(); } );
		image.addEventListener( 'error', function ()
		{
			let span = document.createElement( 'span' );
			span.className = 'cm-live-image-missing';
			span.textContent = widget.Alt || widget.Url;
			span.title = 'the image did not load: ' + widget.Url;
			if ( image.parentNode )
			{
				image.parentNode.replaceChild( span, image );
			}
			view.requestMeasure();
		} );
		return image;
	}

	eq( other )
	{
		return other.Url === this.Url && other.Alt === this.Alt;
	}
}


//---------------------------------------------------------------------
// The decorations from the plan.

function decoration_of( item, state )
{
	switch ( item.Kind )
	{
		case 'line': return Decoration.line( { class: 'cm-live-' + item.Class } );
		case 'hide':
		case 'escape': return Decoration.replace( {} );
		case 'bullet': return Decoration.replace( { widget: new BulletWidget() } );
		case 'check': return Decoration.replace( { widget: new CheckWidget( item.Checked ) } );
		case 'link': return Decoration.mark( { class: 'cm-live-link', attributes: { 'data-url': item.Url, title: item.Url + ' (Ctrl+click opens)' } } );
		case 'code': return Decoration.mark( { class: 'cm-live-code' } );
		case 'fence-start': return Decoration.replace( { widget: new FenceWidget( item.Language, 'start' ), block: true } );
		case 'fence-end': return Decoration.replace( { widget: new FenceWidget( '', 'end' ), block: true } );
		case 'setext': return Decoration.replace( { widget: new LineWidget( 'cm-live-setext' ), block: true } );
		case 'rule': return Decoration.replace( { widget: new LineWidget( 'cm-live-rule' ), block: true } );
		case 'table':
		{
			let anchors = table_anchors( state, item.From, item.To );
			return Decoration.replace( { widget: new TableWidget( item.Text, anchors.List, anchors.Selected, state.facet( OPTIONS ) ), block: true } );
		}
		case 'image': return Decoration.replace( { widget: new ImageWidget( item.Url, item.Alt ) } );
	}
	return null;
}


// The revealed lines of a state: those any selection range touches.
function revealed_lines( state )
{
	let lines = new Set();
	for ( let range of state.selection.ranges )
	{
		let first = state.doc.lineAt( range.from ).number;
		let last = state.doc.lineAt( range.to ).number;
		for ( let number = first; number <= last; number++ )
		{
			lines.add( number );
		}
	}
	return lines;
}


function build( state )
{
	let revealed = revealed_lines( state );
	let tree = ensureSyntaxTree( state, state.doc.length, PARSE_BUDGET ) || syntaxTree( state );
	let items = Plan( state.doc.toString(), revealed, tree );
	let ranges = [];
	for ( let item of items )
	{
		let decoration = decoration_of( item, state );
		if ( decoration )
		{
			ranges.push( decoration.range( item.From, item.To ) );
		}
	}
	return { Decorations: Decoration.set( ranges, true ), Key: Array.from( revealed ).sort( function ( a, b ) { return a - b; } ).join( ',' ) };
}


const FIELD = StateField.define( {
	create: function ( state )
	{
		return build( state );
	},
	update: function ( value, transaction )
	{
		let key = Array.from( revealed_lines( transaction.state ) ).sort( function ( a, b ) { return a - b; } ).join( ',' );
		let anchor_field = transaction.state.facet( OPTIONS ).Anchors;
		let anchors_changed = !!anchor_field && transaction.state.field( anchor_field, false ) !== transaction.startState.field( anchor_field, false );
		if ( !transaction.docChanged && key === value.Key && !anchors_changed )
		{
			return value;
		}
		return build( transaction.state );
	},
	provide: function ( field )
	{
		return EditorView.decorations.from( field, function ( value ) { return value.Decorations; } );
	},
} );


// Ctrl+click (Cmd on a Mac) on a rendered link opens its URL in a new tab; a plain click edits.
const HANDLERS = EditorView.domEventHandlers( {
	click: function ( event )
	{
		let link = event.target.closest( '.cm-live-link' );
		if ( !link || !( event.ctrlKey || event.metaKey ) )
		{
			return false;
		}
		event.preventDefault();
		window.open( link.dataset.url, '_blank', 'noopener' );
		return true;
	},
} );


export function Extension( Options )
{
	return [ OPTIONS.of( Options || {} ), FIELD, HANDLERS ];
}
