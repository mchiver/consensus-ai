'use strict';

// Render - marked in the page, anchor highlighting over the rendered text nodes, and a selection turned
// into an anchor. The visible text is normalized the way the server's Anchors.PlainText does: whitespace
// runs become one space and the whole is trimmed, so the server's Found positions land on the same characters.

angular.module( 'Consensus.Render', [] ).factory( 'Render', [ function ()
{
	const CONTEXT_LENGTH = 32;
	let last_map = null;


	function Html( Markdown )
	{
		return marked.parse( Markdown || '' );
	}


	//-----------------------------------------------------------------
	// A character map over a container: Plain (the normalized text) and, per character, its text node and offset.

	function map_text( container )
	{
		let map = { Plain: '', Nodes: [], Offsets: [] };
		let walker = document.createTreeWalker( container, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, null );
		let pending_space = false;
		let node = walker.nextNode();
		while ( node )
		{
			if ( node.nodeType === Node.ELEMENT_NODE )
			{
				if ( node.tagName === 'BR' )
				{
					pending_space = ( map.Plain.length > 0 );
				}
				node = walker.nextNode();
				continue;
			}
			let text = node.nodeValue;
			for ( let index = 0; index < text.length; index++ )
			{
				let character = text[ index ];
				if ( /\s/.test( character ) )
				{
					pending_space = ( map.Plain.length > 0 );
					continue;
				}
				if ( pending_space )
				{
					map.Plain += ' ';
					map.Nodes.push( node );
					map.Offsets.push( index );
					pending_space = false;
				}
				map.Plain += character;
				map.Nodes.push( node );
				map.Offsets.push( index );
			}
			node = walker.nextNode();
		}
		return map;
	}


	//-----------------------------------------------------------------
	// Show: render the markdown into the container and wrap each thread's Found range in <mark> elements.

	function Show( Container, Markdown, Threads, SelectedId )
	{
		Container.innerHTML = Html( Markdown );
		let map = map_text( Container );
		let sets = new Array( map.Plain.length );
		for ( let thread of Threads || [] )
		{
			if ( !thread.Found )
			{
				continue;
			}
			for ( let position = thread.Found.Start; position < thread.Found.End && position < sets.length; position++ )
			{
				if ( !sets[ position ] )
				{
					sets[ position ] = [];
				}
				sets[ position ].push( thread );
			}
		}
		wrap_marks( map, sets, SelectedId );
		last_map = map_text( Container );
		return last_map;
	}


	// Every text node is rebuilt as runs of characters sharing the same set of threads.
	function wrap_marks( map, sets, selected_id )
	{
		let by_node = new Map();
		for ( let position = 0; position < map.Plain.length; position++ )
		{
			let node = map.Nodes[ position ];
			if ( !by_node.has( node ) )
			{
				by_node.set( node, [] );
			}
			by_node.get( node ).push( { Offset: map.Offsets[ position ], Threads: sets[ position ] || null } );
		}
		for ( let [ node, characters ] of by_node )
		{
			if ( !characters.some( function ( character ) { return character.Threads; } ) )
			{
				continue;
			}
			let text = node.nodeValue;
			let per_offset = new Array( text.length ).fill( null );
			for ( let character of characters )
			{
				per_offset[ character.Offset ] = character.Threads;
			}
			// whitespace between two marked characters of the same threads belongs to the mark
			for ( let offset = 0; offset < text.length; offset++ )
			{
				if ( per_offset[ offset ] === null && /\s/.test( text[ offset ] ) )
				{
					let before = ( offset > 0 ) ? per_offset[ offset - 1 ] : null;
					let after = next_marked( per_offset, offset );
					if ( before && after && same_threads( before, after ) )
					{
						per_offset[ offset ] = before;
					}
				}
			}
			let fragment = document.createDocumentFragment();
			let run_start = 0;
			for ( let offset = 1; offset <= text.length; offset++ )
			{
				if ( offset === text.length || !same_threads( per_offset[ offset ], per_offset[ run_start ] ) )
				{
					fragment.appendChild( make_run( text.slice( run_start, offset ), per_offset[ run_start ], selected_id ) );
					run_start = offset;
				}
			}
			node.parentNode.replaceChild( fragment, node );
		}
	}


	// The threads of the next marked character; only whitespace lies between two mapped characters.
	function next_marked( per_offset, from )
	{
		for ( let offset = from + 1; offset < per_offset.length; offset++ )
		{
			if ( per_offset[ offset ] !== null )
			{
				return per_offset[ offset ];
			}
		}
		return null;
	}


	function same_threads( a, b )
	{
		if ( a === b )
		{
			return true;
		}
		if ( !a || !b || a.length !== b.length )
		{
			return false;
		}
		for ( let index = 0; index < a.length; index++ )
		{
			if ( a[ index ] !== b[ index ] )
			{
				return false;
			}
		}
		return true;
	}


	function make_run( text, threads, selected_id )
	{
		if ( !threads )
		{
			return document.createTextNode( text );
		}
		let mark = document.createElement( 'mark' );
		mark.className = 'anchor ' + threads[ threads.length - 1 ].State;
		if ( threads.length > 1 )
		{
			mark.classList.add( 'several' );
		}
		if ( threads.some( function ( thread ) { return thread.Id === selected_id; } ) )
		{
			mark.classList.add( 'selected' );
		}
		mark.dataset.threads = threads.map( function ( thread ) { return thread.Id; } ).join( ' ' );
		mark.textContent = text;
		return mark;
	}


	//-----------------------------------------------------------------
	// SelectionAnchor: the current selection inside the container as { Text, Prefix, Suffix }, or null.

	function SelectionAnchor( Container )
	{
		let selection = window.getSelection();
		if ( !selection || selection.rangeCount === 0 || selection.isCollapsed || !last_map )
		{
			return null;
		}
		let range = selection.getRangeAt( 0 );
		if ( !Container.contains( range.startContainer ) || !Container.contains( range.endContainer ) )
		{
			return null;
		}
		let start = position_of( last_map, range.startContainer, range.startOffset, false );
		let end = position_of( last_map, range.endContainer, range.endOffset, true );
		if ( start === null || end === null || end <= start )
		{
			return null;
		}
		let plain = last_map.Plain;
		let text = plain.slice( start, end ).trim();
		if ( !text )
		{
			return null;
		}
		start = plain.indexOf( text, start );
		end = start + text.length;
		return {
			Text: text,
			Prefix: plain.slice( Math.max( 0, start - CONTEXT_LENGTH ), start ),
			Suffix: plain.slice( end, Math.min( plain.length, end + CONTEXT_LENGTH ) ),
		};
	}


	// The normalized position of a DOM point. An element point becomes the first text character inside it.
	function position_of( map, node, offset, is_end )
	{
		if ( node.nodeType !== Node.TEXT_NODE )
		{
			let child = node.childNodes[ is_end ? offset - 1 : offset ];
			if ( !child )
			{
				return is_end ? map.Plain.length : 0;
			}
			if ( child.nodeType === Node.TEXT_NODE )
			{
				return position_of( map, child, is_end ? child.nodeValue.length : 0, is_end );
			}
			let walker = document.createTreeWalker( child, NodeFilter.SHOW_TEXT, null );
			let first = walker.nextNode();
			if ( !first )
			{
				return is_end ? map.Plain.length : 0;
			}
			if ( is_end )
			{
				let last = first;
				let next = walker.nextNode();
				while ( next )
				{
					last = next;
					next = walker.nextNode();
				}
				return position_of( map, last, last.nodeValue.length, true );
			}
			return position_of( map, first, 0, false );
		}
		let best = null;
		for ( let position = 0; position < map.Nodes.length; position++ )
		{
			if ( map.Nodes[ position ] !== node )
			{
				continue;
			}
			if ( is_end )
			{
				if ( map.Offsets[ position ] < offset )
				{
					best = position + 1;
				}
			}
			else if ( map.Offsets[ position ] >= offset )
			{
				return position;
			}
			else
			{
				best = position + 1;
			}
		}
		return best;
	}


	//-----------------------------------------------------------------
	// ScrollToThread: bring a thread's first mark into view.

	function ScrollToThread( Container, ThreadId )
	{
		let marks = Container.querySelectorAll( 'mark.anchor' );
		for ( let mark of marks )
		{
			if ( mark.dataset.threads.split( ' ' ).includes( ThreadId ) )
			{
				mark.scrollIntoView( { block: 'center', behavior: 'smooth' } );
				return true;
			}
		}
		return false;
	}


	//-----------------------------------------------------------------
	// ScrollToText: bring a passage into view by its first words, and flash it.

	function ScrollToText( Container, Text )
	{
		if ( !last_map || !Text )
		{
			return false;
		}
		let words = Text.replace( /^#+\s*/, '' ).replace( /\s+/g, ' ' ).trim().slice( 0, 60 );
		let position = last_map.Plain.indexOf( words );
		while ( position < 0 && words.length > 12 )
		{
			words = words.slice( 0, words.length - 8 );
			position = last_map.Plain.indexOf( words );
		}
		if ( position < 0 )
		{
			return false;
		}
		let node = last_map.Nodes[ position ];
		let element = node.parentNode;
		element.scrollIntoView( { block: 'center', behavior: 'smooth' } );
		element.classList.add( 'flash' );
		setTimeout( function () { element.classList.remove( 'flash' ); }, 1600 );
		return true;
	}


	return {
		Html: Html,
		Show: Show,
		SelectionAnchor: SelectionAnchor,
		ScrollToThread: ScrollToThread,
		ScrollToText: ScrollToText,
	};
} ] );
