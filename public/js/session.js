'use strict';

// Session - the browser's sign-in through Clerk (plan User Management, Step 4; plan Clerk, Step 3). The page asks its
// own server GET /api/clerk once. Off, nothing changes: a bare request is the owner, as on a Local or trusted-network
// server. On, ClerkJS is loaded from the instance's Frontend API with the publishable key; every call to the page's
// own server carries the session token as Authorization: Bearer (Client asks Token() before each call, and Clerk
// refreshes the token in the background); a 401 from that server marks the session Required, and the sign-in box
// (sign-in-box) mounts Clerk's form; the title bar mounts Clerk's user button, whose menu holds sign out. A sign-in
// or a sign-out reloads the page, so every list is read again as the new account. The desktop never signs in
// through Clerk (its page is served from 127.0.0.1 and its saved servers hold tokens), so in the desktop the session
// is off.
//
//   Session { On, Loaded, Required, Error, Config, Ready (a promise: loaded), Token(), SignedIn(), User(), Needed(),
//             MountSignIn( element ), MountUserButton( element ), Unmount( element, kind ) }

angular.module( 'Consensus.Client' ).factory( 'Session', [ '$rootScope', function ( $rootScope )
{
	const SCRIPT = '/npm/@clerk/clerk-js@5/dist/clerk.browser.js';
	let session = { On: false, Loaded: false, Required: false, Error: null, Config: null, Ready: null };
	let clerk = null;
	let was_signed_in = false;


	function load_script( host, key )
	{
		return new Promise( function ( resolve, reject )
		{
			let script = document.createElement( 'script' );
			script.async = true;
			script.crossOrigin = 'anonymous';
			script.setAttribute( 'data-clerk-publishable-key', key );
			script.src = 'https://' + host + SCRIPT;
			script.onload = function () { resolve(); };
			script.onerror = function () { reject( new Error( 'ClerkJS did not load from ' + host ) ); };
			document.head.appendChild( script );
		} );
	}


	async function load()
	{
		if ( window.ConsensusDesktop )
		{
			session.Loaded = true;
			return;
		}
		let config = { On: false };
		try
		{
			let response = await fetch( '/api/clerk' );
			if ( response.ok )
			{
				config = await response.json();
			}
		}
		catch ( error )
		{
			config = { On: false };
		}
		session.Config = config;
		session.On = !!( config.On && config.PublishableKey && config.FrontendApi );
		if ( session.On )
		{
			try
			{
				await load_script( config.FrontendApi, config.PublishableKey );
				clerk = window.Clerk;
				await clerk.load();
				was_signed_in = !!clerk.user;
				clerk.addListener( on_change );
			}
			catch ( error )
			{
				console.error( error );
				clerk = null;
				session.Error = error.message;
			}
		}
		session.Loaded = true;
		$rootScope.$applyAsync();
	}


	// Clerk's resources changed: a sign-in while the page waited for one, or a sign-out, reloads the page.
	function on_change( resources )
	{
		let signed_in = !!( resources && resources.user );
		if ( signed_in !== was_signed_in )
		{
			was_signed_in = signed_in;
			window.location.reload();
		}
	}


	// The session token for a call to the page's own server, or null when there is no session.
	async function Token()
	{
		await session.Ready;
		if ( !clerk || !clerk.session )
		{
			return null;
		}
		try
		{
			return await clerk.session.getToken();
		}
		catch ( error )
		{
			return null;
		}
	}


	function SignedIn()
	{
		return !!( clerk && clerk.user );
	}


	function User()
	{
		return clerk ? clerk.user : null;
	}


	// The server refused a bare or stale request: the sign-in box shows (when Clerk is on).
	function Needed()
	{
		if ( session.On && !session.Required )
		{
			session.Required = true;
			$rootScope.$applyAsync();
		}
	}


	function MountSignIn( Element )
	{
		if ( clerk )
		{
			clerk.mountSignIn( Element, {} );
		}
	}


	function MountUserButton( Element )
	{
		if ( clerk )
		{
			clerk.mountUserButton( Element, {} );
		}
	}


	function Unmount( Element, Kind )
	{
		if ( !clerk )
		{
			return;
		}
		try
		{
			if ( Kind === 'user' )
			{
				clerk.unmountUserButton( Element );
			}
			else
			{
				clerk.unmountSignIn( Element );
			}
		}
		catch ( error )
		{
			// Already gone with the element.
		}
	}


	session.Ready = load();
	session.Token = Token;
	session.SignedIn = SignedIn;
	session.User = User;
	session.Needed = Needed;
	session.MountSignIn = MountSignIn;
	session.MountUserButton = MountUserButton;
	session.Unmount = Unmount;
	return session;
} ] );
