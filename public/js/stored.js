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
//
//   window.ConsensusStored = { Read( Name, Fallback, Root ), Write( Name, Value, Root ), Remove( Name, Root ), ServerKey() }
//   Root: a root (its Url names the server), true for the page's own server, or false for the shared scope.

( function ()
{
	const PREFIX = 'consensus.';
	let desktop = ( window.ConsensusDesktop && typeof window.ConsensusDesktop.Remember === 'function' ) ? window.ConsensusDesktop : null;
	let remembered = desktop ? Object.assign( {}, desktop.Remembered || {} ) : null;


	// The connected server's part of a key: its address without the scheme, or '' in a browser.
	function ServerKey()
	{
		let desktop = window.ConsensusDesktop || null;
		let url = ( desktop && desktop.Server && desktop.Server.Url ) ? String( desktop.Server.Url ) : '';
		return url.replace( /^https?:\/\//, '' ).replace( /\/+$/, '' );
	}


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
		else if ( per_server )
		{
			server = ServerKey();
		}
		return PREFIX + ( server ? server + '.' : '' ) + name;
	}


	// The value as json text, so what comes back is always a copy of what was written.
	function Read( Name, Fallback, PerServer )
	{
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


	window.ConsensusStored = { Read: Read, Write: Write, Remove: Remove, ServerKey: ServerKey };
} )();
