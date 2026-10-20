'use strict';

// Session - the browser's sign-in through Clerk (plan User Management, Step 4; plan Clerk, Steps 3 and 5). The page
// asks its own server GET /api/clerk once: On (the server listens), Required (a Public server: everyone signs in),
// the publishable key and the Frontend API host of the instance, and the pricing page. ClerkJS is loaded from that
// host only when it is needed: when the sign-in is Required, when a sign-in is remembered in this browser, or when
// the Settings popup's Sign in button asks (Open), so a free Local server loads nothing from Clerk. Loaded, every
// call to the page's own server carries the session token as Authorization: Bearer (Client asks Token() before each
// call, and Clerk refreshes the token in the background); a 401 from that server marks the session Required, a 401
// "license" keeps the refusal (the plan wanted), and the sign-in box (sign-in-box) shows Clerk's form or the license
// message; the title bar mounts Clerk's user button, whose menu holds sign out. A sign-in or a sign-out reloads the
// page, so every list is read again as the new account. The person's organization is made active at sign-in when
// none is, so the token carries the organization's license. The desktop never signs in through Clerk (its page is
// served from 127.0.0.1 and its saved servers hold tokens), so in the desktop the session is off.
//
//   Session { On, Loaded, Required, Asked, Refusal, Error, Config, Pricing, Ready (a promise: loaded),
//             Token(), SignedIn(), User(), Plan(), Licensed( plan ), Needed( body ), Open(), SignOut(),
//             MountSignIn( element ), MountUserButton( element ), Unmount( element, kind ) }

angular.module( 'Consensus.Client' ).factory( 'Session', [ '$rootScope', function ( $rootScope )
{
	const SCRIPT = '/npm/@clerk/clerk-js@5/dist/clerk.browser.js';
	const PLANS = [ 'User', 'Host' ];	// Roles.js's PLANS: the rank is the index plus one
	const REMEMBERED = 'consensus-signed-in';
	let session = { On: false, Loaded: false, Required: false, Asked: false, Refusal: null, Error: null, Config: null, Pricing: null, Ready: null };
	let clerk = null;
	let loading = null;
	let was_signed_in = false;


	function remembered()
	{
		try
		{
			return localStorage.getItem( REMEMBERED ) === '1';
		}
		catch ( error )
		{
			return false;
		}
	}


	function remember( signed_in )
	{
		try
		{
			if ( signed_in )
			{
				localStorage.setItem( REMEMBERED, '1' );
			}
			else
			{
				localStorage.removeItem( REMEMBERED );
			}
		}
		catch ( error )
		{
			// No storage: the next page load asks the server again.
		}
	}


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


	// The configuration, once; ClerkJS when the server requires a sign-in or this browser remembers one.
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
		session.Pricing = config.Pricing || null;
		session.On = !!( config.On && config.PublishableKey && config.FrontendApi );
		if ( session.On && ( config.Required || remembered() ) )
		{
			await load_clerk();
		}
		session.Loaded = true;
		$rootScope.$applyAsync();
	}


	// ClerkJS loaded and started, once.
	function load_clerk()
	{
		if ( !loading )
		{
			loading = start_clerk();
		}
		return loading;
	}


	async function start_clerk()
	{
		try
		{
			await load_script( session.Config.FrontendApi, session.Config.PublishableKey );
			clerk = window.Clerk;
			await clerk.load();
			was_signed_in = !!clerk.user;
			remember( was_signed_in );
			await activate_organization();
			clerk.addListener( on_change );
		}
		catch ( error )
		{
			console.error( error );
			clerk = null;
			session.Error = error.message;
		}
	}


	// The person's organization made active when none is, so the token carries the organization's license.
	async function activate_organization()
	{
		if ( !clerk.user || clerk.organization )
		{
			return;
		}
		let memberships = clerk.user.organizationMemberships || [];
		if ( memberships.length )
		{
			await clerk.setActive( { organization: memberships[ 0 ].organization.id } );
		}
	}


	// Clerk's resources changed: a sign-in while the page waited for one, or a sign-out, reloads the page.
	function on_change( resources )
	{
		let signed_in = !!( resources && resources.user );
		if ( signed_in !== was_signed_in )
		{
			was_signed_in = signed_in;
			remember( signed_in );
			window.location.reload();
		}
	}


	// The session token for a call to the page's own server, or null when there is no session.
	async function Token()
	{
		await session.Ready;
		if ( loading )
		{
			await loading;
		}
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


	// One license as the metadata holds it: { Plan, Until } or the plan as a string; null when not valid now.
	function license_of( given )
	{
		let license = ( typeof given === 'string' ) ? { Plan: given } : given;
		if ( !license || typeof license !== 'object' || !PLANS.includes( license.Plan ) )
		{
			return null;
		}
		if ( license.Until )
		{
			let stamp = ( typeof license.Until === 'number' ) ? license.Until * 1000 : Date.parse( String( license.Until ) );
			if ( !Number.isFinite( stamp ) || stamp < Date.now() )
			{
				return null;
			}
		}
		return license;
	}


	// The signed-in person's plan: the higher of their own license and their active organization's, or null.
	function Plan()
	{
		if ( !clerk || !clerk.user )
		{
			return null;
		}
		let own = license_of( ( clerk.user.publicMetadata || {} ).license );
		let organization = clerk.organization ? license_of( ( clerk.organization.publicMetadata || {} ).license ) : null;
		let best = null;
		for ( let license of [ own, organization ] )
		{
			if ( license && ( !best || PLANS.indexOf( license.Plan ) > PLANS.indexOf( best.Plan ) ) )
			{
				best = license;
			}
		}
		return best ? best.Plan : null;
	}


	function Licensed( Wanted )
	{
		return PLANS.indexOf( Plan() ) >= PLANS.indexOf( Wanted ) && PLANS.includes( Wanted );
	}


	// The server refused a request with 401: the sign-in box shows (when Clerk is on); a "license" refusal is kept
	// with the plan wanted, so the box says so instead of asking for a sign-in again.
	function Needed( Body )
	{
		if ( !session.On )
		{
			return;
		}
		session.Required = true;
		session.Refusal = ( Body && Body.Error === 'license' ) ? Body : null;
		load_clerk();
		$rootScope.$applyAsync();
	}


	// The Settings popup's Sign in: ClerkJS loaded now and the box shown.
	async function Open()
	{
		await session.Ready;
		if ( !session.On )
		{
			return;
		}
		session.Asked = true;
		$rootScope.$applyAsync();
		await load_clerk();
		$rootScope.$applyAsync();
	}


	async function SignOut()
	{
		if ( clerk )
		{
			await clerk.signOut();
		}
	}


	async function MountSignIn( Element )
	{
		await session.Ready;
		if ( loading )
		{
			await loading;
		}
		if ( clerk && Element.isConnected )
		{
			clerk.mountSignIn( Element, {} );
		}
	}


	async function MountUserButton( Element )
	{
		await session.Ready;
		if ( loading )
		{
			await loading;
		}
		if ( clerk && Element.isConnected )
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
	session.Plan = Plan;
	session.Licensed = Licensed;
	session.Needed = Needed;
	session.Open = Open;
	session.SignOut = SignOut;
	session.MountSignIn = MountSignIn;
	session.MountUserButton = MountUserButton;
	session.Unmount = Unmount;
	return session;
} ] );
