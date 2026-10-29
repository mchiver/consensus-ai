'use strict';

// Stored - the page's remembered state (plan UI Tweaks V), by name, with two scopes:
//   per server   what names content on a server (the open project, the folds, the LLMs fold): key
//                "consensus.<server>.<name>", where <server> is the root's address without its scheme (plan Run
//                Shapes, Step 5: Read and Write take the root, roots.js); in a browser the page's origin is the
//                server, so the key is "consensus.<name>".
//   shared       the look (hidden panes, highlight, widths): key "consensus.<name>", whatever the server.
// In the desktop the keys live in desktop.json (Remembered), handed over at boot and written back through the
// preload's Remember: the page's origin gets a new port at every start, so its localStorage would not survive a
// restart. In a browser they live in localStorage. A blocked or empty storage reads as the fallback and writes
// nothing; nothing else depends on it.
// The look (plan Project settings, Step 2): the shared keys of the look (the margins, the highlight, the editor, the
// preview and Source mode, show-updated, the hidden panes, the widths) are not kept here: they are the View the
// window's server answers in /api/me (the project's in the Desktop, the Server's on a Server; src/View.js), handed in
// with SetView, read from it and written back through the save SetView was given when the page may change it (the
// Administrator and the Managers on a Server), else kept for this page alone. Until it comes they read as the
// fallback; when it comes the page hears a "consensus-view" event on window and takes the look again.
//
//   window.ConsensusStored = { Read( Name, Fallback, Root ), Write( Name, Value, Root ), Remove( Name, Root ),
//                              SetView( Values, Writable, Save, Mark ), ViewMark(), ViewWritable() }
//   Root: a root (its Url names the server), or false for the shared scope.

( function ()
{
	const PREFIX = 'consensus.';
	let desktop = ( window.ConsensusDesktop && typeof window.ConsensusDesktop.Remember === 'function' ) ? window.ConsensusDesktop : null;
	let remembered = desktop ? Object.assign( {}, desktop.Remembered || {} ) : null;
	// the look's keys and their View fields; the widths are "<n>px" here and whole pixels in the View
	const VIEW_FIELDS = {
		'margins': 'Margins',
		'highlight': 'Highlight',
		'editor': 'Editor',
		'preview-hidden': 'PreviewHidden',
		'source-mode': 'Source',
		'threads-hidden': 'ThreadsHidden',
		'tree-hidden': 'TreeHidden',
		'show-updated': 'ShowUpdated',
		'width.sidebar': 'SidebarWidth',
		'width.threads': 'ThreadsWidth',
		'width.preview': 'PreviewWidth',
	};
	const SAVE_DELAY_MS = 400;
	let view = { Values: {}, Writable: null, Save: null };	// Writable null: not known until the server answers
	let pending = {};
	let save_timer = null;
	let mark = 0;		// counts the page's own changes of the look, so an answer asked for before one does not undo it
	let own = {};		// the page's own changes when it may not save them: kept over the server's


	// A root with a StoredKey (the Desktop's one project, plan Rearchitecturation, Step 2: the folder, or the Host's
	// address and the project id) is keyed by that in place of its address, which changes port at every start.
	function key_of( name, per_server )
	{
		let server = '';
		if ( per_server && typeof per_server === 'object' && per_server.StoredKey )
		{
			server = String( per_server.StoredKey );
		}
		else if ( per_server && typeof per_server === 'object' )
		{
			server = String( per_server.Url || '' ).replace( /^https?:\/\//, '' ).replace( /\/+$/, '' );
		}
		return PREFIX + ( server ? server + '.' : '' ) + name;
	}


	// The View field a shared key of the look stands for, or null.
	function view_field( Name, PerServer )
	{
		if ( PerServer !== false )
		{
			return null;
		}
		return VIEW_FIELDS[ Name ] || null;
	}


	function is_width( field )
	{
		return /Width$/.test( field );
	}


	function save_pending()
	{
		save_timer = null;
		if ( view.Writable === null )
		{
			return;		// kept until the server says whether the page may save
		}
		let changes = pending;
		pending = {};
		if ( view.Writable && typeof view.Save === 'function' && Object.keys( changes ).length )
		{
			Promise.resolve( view.Save( changes ) ).catch( function () {} );
		}
	}


	// The View as the window's server answered it; Writable says whether this page may change it, Save( changes )
	// sends the changed fields; Mark, ViewMark() taken before the request, says whether the page changed the look since:
	// then the answer is older than the page and its values are not taken.
	function SetView( Values, Writable, Save, Mark )
	{
		let stale = ( Mark !== undefined && Mark !== mark );
		let writable = ( Writable === true );
		if ( writable )
		{
			own = {};
		}
		let values = stale ? view.Values : Object.assign( JSON.parse( JSON.stringify( Values || {} ) ), own );
		view = { Values: values, Writable: writable, Save: Save || null };
		// changes made before the first answer: saved now, or kept for this page alone
		if ( !writable )
		{
			Object.assign( own, pending );
			pending = {};
		}
		else if ( Object.keys( pending ).length && !save_timer )
		{
			save_pending();
		}
		if ( !stale )
		{
			window.dispatchEvent( new CustomEvent( 'consensus-view' ) );
		}
	}


	function ViewMark()
	{
		return mark;
	}


	// a width still waiting when the page goes is sent then
	window.addEventListener( 'pagehide', function ()
	{
		if ( save_timer )
		{
			clearTimeout( save_timer );
			save_pending();
		}
	} );


	function ViewWritable()
	{
		return view.Writable === true;
	}


	// The value as json text, so what comes back is always a copy of what was written.
	function Read( Name, Fallback, PerServer )
	{
		let field = view_field( Name, PerServer );
		if ( field )
		{
			let held = view.Values[ field ];
			if ( held === undefined )
			{
				return Fallback;
			}
			return is_width( field ) ? held + 'px' : held;
		}
		let key = key_of( Name, PerServer );
		try
		{
			let value = null;
			if ( remembered )
			{
				value = ( remembered[ key ] === undefined ) ? null : JSON.stringify( remembered[ key ] );
			}
			else
			{
				value = window.localStorage.getItem( key );
			}
			return ( value === null ) ? Fallback : JSON.parse( value );
		}
		catch ( error )
		{
			return Fallback;
		}
	}


	function Write( Name, Value, PerServer )
	{
		let field = view_field( Name, PerServer );
		if ( field )
		{
			let value = is_width( field ) ? Math.round( parseFloat( Value ) ) : Value;
			view.Values[ field ] = value;
			mark += 1;
			if ( view.Writable === false )
			{
				own[ field ] = value;
				return;
			}
			pending[ field ] = value;
			if ( save_timer )
			{
				clearTimeout( save_timer );
			}
			// a width moves with the pointer, so it is saved once the drag rests; the rest at once
			if ( is_width( field ) )
			{
				save_timer = setTimeout( save_pending, SAVE_DELAY_MS );
			}
			else
			{
				save_pending();
			}
			return;
		}
		let key = key_of( Name, PerServer );
		try
		{
			let text = JSON.stringify( Value );
			if ( remembered )
			{
				remembered[ key ] = JSON.parse( text );
				desktop.Remember( key, remembered[ key ] );
				return;
			}
			window.localStorage.setItem( key, text );
		}
		catch ( error )
		{
			// not remembered; nothing else depends on it
		}
	}


	function Remove( Name, PerServer )
	{
		let key = key_of( Name, PerServer );
		try
		{
			if ( remembered )
			{
				delete remembered[ key ];
				desktop.Remember( key, null );
				return;
			}
			window.localStorage.removeItem( key );
		}
		catch ( error )
		{
			// nothing to remove
		}
	}


	window.ConsensusStored = { Read: Read, Write: Write, Remove: Remove, SetView: SetView, ViewMark: ViewMark, ViewWritable: ViewWritable };
} )();
