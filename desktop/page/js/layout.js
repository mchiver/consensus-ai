'use strict';

// Layout - the splitters: sidebar, threads pane, and the preview beside the editor.
// Widths live in CSS variables and are remembered (stored.js, shared by every server; plan UI Tweaks V).

( function ()
{
	const MINIMUM = 160;
	const MAXIMUM = 900;
	const VARIABLES = { sidebar: '--sidebar-width', threads: '--threads-width', preview: '--preview-width' };

	function restore()
	{
		for ( let name of Object.keys( VARIABLES ) )
		{
			let saved = window.ConsensusStored.Read( 'width.' + name, null, false );
			if ( saved )
			{
				document.documentElement.style.setProperty( VARIABLES[ name ], saved );
			}
		}
	}


	function set_width( name, width )
	{
		let clamped = Math.max( MINIMUM, Math.min( MAXIMUM, width ) );
		document.documentElement.style.setProperty( VARIABLES[ name ], clamped + 'px' );
		window.ConsensusStored.Write( 'width.' + name, clamped + 'px', false );
	}


	// The width a pointer position means for each splitter: from the left edge, or from the right edge of its parent.
	function width_for( name, splitter, client_x )
	{
		if ( name === 'sidebar' )
		{
			return client_x;
		}
		if ( name === 'threads' )
		{
			return window.innerWidth - client_x;
		}
		let parent_rect = splitter.parentNode.getBoundingClientRect();
		return parent_rect.right - client_x;
	}


	function attach( splitter )
	{
		let name = splitter.dataset.splitter;
		splitter.addEventListener( 'mousedown', function ( down )
		{
			down.preventDefault();
			splitter.classList.add( 'dragging' );
			document.body.style.cursor = 'col-resize';
			document.body.style.userSelect = 'none';
			function move( event )
			{
				set_width( name, width_for( name, splitter, event.clientX ) );
			}
			function up()
			{
				splitter.classList.remove( 'dragging' );
				document.body.style.cursor = '';
				document.body.style.userSelect = '';
				window.removeEventListener( 'mousemove', move );
				window.removeEventListener( 'mouseup', up );
			}
			window.addEventListener( 'mousemove', move );
			window.addEventListener( 'mouseup', up );
		} );
	}


	restore();
	document.addEventListener( 'DOMContentLoaded', function ()
	{
		for ( let splitter of document.querySelectorAll( '.splitter' ) )
		{
			attach( splitter );
		}
	} );
} )();
