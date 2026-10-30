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
// none is, so the token carries the organization's license. The page's own server is the browser's one root (Base
// ''), or in the desktop the desktop's own server, reached through the page server under /servers/local (plan Clerk,
// Step 7); since plan The Server, Step 5, a desktop window connected to a Server (client mode) signs in to that
// Server the same way, and a desktop window with no server has no session. The Sidecar app (plan Sidecar Edition,
// Step 3) never signs anyone in: it has no session.
// The Desktop (plan Client Edition, Step 2, as the Client; the Desktop since plan Review 2026-10-29, Step 5.1, the
// editions cut: Edition desktop) has no server of its own and no current user: the person signs in through our Clerk
// instance, whose configuration the Desktop hands in (ConsensusDesktop.Clerk, so nothing is asked of a Server first),
// the sign-in always Required; Every is true, so the session token goes with every call to every Server, which
// authorizes that identity project by project. Clerk's session stays in the window's own storage. Signed in, a
// Server's refusal is that Server's (its root shows it) and never the box.
//
// In the Client, the Server's window and the Desktop (plan Rearchitecturation, Step 6; the Desktop since plan Review
// 2026-10-29, Step 5.2) a sign-in's token goes to the app
// (ConsensusDesktop.SetLicense), at every load while signed in, which verifies it and writes it as the machine's
// current user (plan The Server, Step 1: <config>/user.json, kept 14 days from the last check, so it holds offline); a
// sign-out removes it. The tiers are unlicensed (no sign-in), registered (a sign-in with no license), personal and
// professional. The Desktop needs Personal (plan Review 2026-10-29, Step 5.2, the Personal check): signed in below
// it, the session keeps a license refusal (Error license, Plan personal) and Admitted() is false, so the page shows the
// sign-in box with the license message and Sign out in place of the Servers and loads no root; the gate is the
// session's plan (Plan()), never the machine's current user, which the Desktop writes for the Server beside it alone.
// The token to the app (plan Review 2026-10-29, Step 5.3): in the Client and the Desktop every token Clerk gives is
// handed to the app (ConsensusDesktop.SetToken), at the start, before every call and on a timer while signed in (Clerk
// refreshes the token about once a minute), null at a sign-out; the app's own address adds it to an agent's requests.
//
//   Session { Key, Base (the own server's root key and base, null when there is none), Every (the Desktop: every root's calls carry the token),
//             On, Loaded, Required, Asked, Refusal, Closed (a Server's closed gate: its reason), Error, Config, Pricing, Ready (a promise: loaded), License (the
//             Desktop's cached tier { Tier, Days, Line } or null),
//             Token(), SignedIn(), User(), Plan(), Tier(), Licensed( plan ), Admitted(), Needed( body ), Open(), SignOut(),
//             MountSignIn( element ), MountUserButton( element ), Unmount( element, kind ) }

angular.module( 'Consensus.Client' ).factory( 'Session', [ '$rootScope', function ( $rootScope )
{
	const SCRIPT = '/npm/@clerk/clerk-js@5/dist/clerk.browser.js';
	const PLANS = [ 'personal', 'professional' ];	// Roles.js's PLANS: the rank is the index plus one (plan Rearchitecturation, Step 6)
	const REMEMBERED = 'consensus-signed-in';
	const SESSION_WAIT = 4000;	// milliseconds given to a remembered session to arrive after ClerkJS loads
	const TOKEN_REFRESH = 50000;	// milliseconds between the tokens handed to the app while signed in (Clerk's live about a minute)
	const DESKTOP = !!( window.ConsensusDesktop && window.ConsensusDesktop.Edition === 'desktop' );
	let own = own_root();
	let session = { Key: own ? own.Key : null, Base: own ? own.Base : null, On: false, Loaded: false, Required: false, Asked: false, Refusal: null, Closed: null, Error: null, Config: null, Pricing: null, Ready: null, Every: DESKTOP, License: ( window.ConsensusDesktop && window.ConsensusDesktop.License ) ? window.ConsensusDesktop.License : null };
	let clerk = null;
	let loading = null;
	let was_signed_in = false;
	let retried = false;
	let handed = undefined;		// the token the app has (Step 5.3), so the same one is not sent twice


	// The page's own server: the browser's one root, or the window's one Server (the Client); the Desktop has none.
	function own_root()
	{
		if ( !window.ConsensusDesktop )
		{
			return { Key: '', Base: '' };
		}
		if ( window.ConsensusDesktop.Sidecar === true )
		{
			return null;
		}
		if ( DESKTOP )
		{
			return { Key: null, Base: '' };
		}
		let roots = Array.isArray( window.ConsensusDesktop.Roots ) ? window.ConsensusDesktop.Roots : [];
		let local = roots.find( function ( root ) { return root && root.Kind === 'local' && root.Key; } );
		// a window on a Server (plan The Server, Step 5: the Client since the editions cut) signs in to that Server
		let own = local || ( ( roots.length === 1 && roots[ 0 ] && roots[ 0 ].Kind === 'server' && roots[ 0 ].Key ) ? roots[ 0 ] : null );
		return own ? { Key: String( own.Key ), Base: '/servers/' + encodeURIComponent( String( own.Key ) ) } : null;
	}


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


	// ClerkJS is a UMD bundle: with Monaco's AMD loader on the page it would register itself as an anonymous AMD
	// module and never set window.Clerk, so define.amd is hidden while the script loads and put back after.
	function load_script( host, key )
	{
		return new Promise( function ( resolve, reject )
		{
			let amd = ( window.define && window.define.amd ) ? window.define.amd : null;
			function restore()
			{
				if ( amd && window.define )
				{
					window.define.amd = amd;
				}
			}
			if ( amd )
			{
				window.define.amd = undefined;
			}
			let script = document.createElement( 'script' );
			script.async = true;
			script.crossOrigin = 'anonymous';
			script.setAttribute( 'data-clerk-publishable-key', key );
			script.src = 'https://' + host + SCRIPT;
			script.onload = function () { restore(); resolve(); };
			script.onerror = function () { restore(); reject( new Error( 'ClerkJS did not load from ' + host ) ); };
			document.head.appendChild( script );
		} );
	}


	// The configuration, once; ClerkJS when the server requires a sign-in or this browser remembers one.
	async function load()
	{
		if ( session.Base === null )
		{
			session.Loaded = true;
			return;
		}
		let config = { On: false };
		if ( DESKTOP )
		{
			config = window.ConsensusDesktop.Clerk || { On: false };
			session.Required = true;
		}
		else
		{
			try
			{
				let response = await fetch( session.Base + '/api/clerk' );
				if ( response.ok )
				{
					config = await response.json();
				}
			}
			catch ( error )
			{
				config = { On: false };
			}
		}
		session.Config = config;
		session.Pricing = config.Pricing || null;
		session.On = !!( config.On && config.PublishableKey && config.FrontendApi );
		if ( session.On && ( config.Required || signed_in_hint() || remembered() ) )
		{
			await load_clerk();
		}
		// the Desktop signed out (plan Client Edition, Step 5): the page's route leaves the address before Clerk's form
		// is mounted, since the form reads the hash as its own step and sends the window to Clerk's hosted page
		if ( DESKTOP && !SignedIn() && window.location.hash )
		{
			window.history.replaceState( null, '', window.location.pathname + window.location.search );
		}
		session.Loaded = true;
		$rootScope.$applyAsync();
	}


	// Whether a Clerk session exists, read without loading ClerkJS: Clerk's __client_uat cookie holds the time of the
	// last sign-in, zero when signed out. It survives Clerk's own after-sign-in navigation, so a server where a
	// sign-in is optional (a Local server, Required false) still loads ClerkJS and shows the person after they sign in.
	function signed_in_hint()
	{
		let match = ( typeof document !== 'undefined' ) ? document.cookie.match( /(?:^|;\s*)__client_uat=([^;]*)/ ) : null;
		return !!( match && Number( match[ 1 ] ) > 0 );
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
			// ClerkJS already on the page (a stand-in in the tests) is taken as it is
			if ( !window.Clerk )
			{
				await load_script( session.Config.FrontendApi, session.Config.PublishableKey );
			}
			clerk = window.Clerk;
			await clerk.load();
			if ( remembered() && !( clerk.user && clerk.session ) )
			{
				await wait_for_session( SESSION_WAIT );
			}
			was_signed_in = !!clerk.user;
			remember( was_signed_in );
			await activate_organization();
			clerk.addListener( on_change );
			check_tier();
			await report_license();
			await refresh_token();
			if ( clerk.user && token_bridge() )
			{
				setInterval( refresh_token, TOKEN_REFRESH );
			}
		}
		catch ( error )
		{
			console.error( error );
			clerk = null;
			session.Error = error.message;
		}
	}


	// The session can arrive a moment after load() resolves: when this browser remembers a sign-in, the page waits for
	// Clerk to hold the session and the user, up to a limit, before its first calls go out.
	function wait_for_session( limit )
	{
		return new Promise( function ( resolve )
		{
			let start = Date.now();
			function poll()
			{
				if ( ( clerk.user && clerk.session ) || Date.now() - start >= limit )
				{
					resolve();
					return;
				}
				setTimeout( poll, 100 );
			}
			poll();
		} );
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


	// Clerk's resources changed: a sign-in while the page waited for one, or a sign-out, reloads the page; in the
	// Desktop a sign-out clears the cached license first.
	function on_change( resources )
	{
		let signed_in = !!( resources && resources.user );
		if ( signed_in !== was_signed_in )
		{
			was_signed_in = signed_in;
			remember( signed_in );
			let bridge = license_bridge();
			if ( !signed_in )
			{
				hand_token( null );
			}
			if ( !signed_in && bridge && typeof bridge.ClearLicense === 'function' )
			{
				Promise.resolve( bridge.ClearLicense() ).catch( function () {} ).then( function () { window.location.reload(); } );
				return;
			}
			window.location.reload();
		}
	}


	// The app's license cache (plan Rearchitecturation, Step 6): a signed-in session's token goes to the app, which
	// verifies it and answers the tier it is at now.
	// The application the page runs in, which keeps the machine's current user: the Desktop or the Server application
	// (plan The Server, Step 3; since plan Review 2026-10-29, Step 3, the Server gives the same ConsensusDesktop bridge,
	// Edition server, the Client since Step 5.1 and the Desktop since Step 5.2), null in a plain browser or the Sidecar, which
	// has no current user.
	function license_bridge()
	{
		return window.ConsensusDesktop || null;
	}


	async function report_license()
	{
		let bridge = license_bridge();
		if ( !bridge || typeof bridge.SetLicense !== 'function' || !clerk || !clerk.session )
		{
			return;
		}
		try
		{
			let token = await clerk.session.getToken();
			let answer = token ? await bridge.SetLicense( token ) : null;
			if ( answer && answer.Tier )
			{
				session.License = answer;
				$rootScope.$applyAsync();
			}
		}
		catch ( error )
		{
			console.error( error );
		}
	}


	// The app the page runs in when it has an address of its own to hand the token to (the Client and the Desktop, plan
	// Review 2026-10-29, Step 5.3), or null.
	function token_bridge()
	{
		return ( window.ConsensusDesktop && typeof window.ConsensusDesktop.SetToken === 'function' ) ? window.ConsensusDesktop : null;
	}


	// A token to the app, once per token: the latest one Clerk gave, or null at a sign-out.
	function hand_token( token )
	{
		let bridge = token_bridge();
		if ( !bridge || token === handed )
		{
			return;
		}
		handed = token;
		try
		{
			bridge.SetToken( token );
		}
		catch ( error )
		{
			// the app is not listening; nothing else depends on it
		}
	}


	// The token as Clerk holds it now, handed to the app: at the start and on the timer.
	async function refresh_token()
	{
		if ( !token_bridge() )
		{
			return;
		}
		if ( !clerk || !clerk.session )
		{
			hand_token( null );
			return;
		}
		try
		{
			hand_token( await clerk.session.getToken() );
		}
		catch ( error )
		{
			// kept as it was; the next refresh tries again
		}
	}


	// The session token for a call to the page's own server, or null when there is no session; every token goes to the
	// app too (Step 5.3).
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
			let token = await clerk.session.getToken();
			hand_token( token );
			return token;
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


	// The tier: in an app with a current user (the Client, the Server's window) the cached license's (free when none),
	// elsewhere the signed-in person's plan or free.
	function Tier()
	{
		if ( window.ConsensusDesktop && !DESKTOP )
		{
			return ( session.License && session.License.Tier ) ? session.License.Tier : 'unlicensed';
		}
		if ( Plan() )
		{
			return Plan();
		}
		return SignedIn() ? 'registered' : 'unlicensed';
	}


	function Licensed( Wanted )
	{
		return PLANS.indexOf( Tier() ) >= PLANS.indexOf( Wanted ) && PLANS.includes( Wanted );
	}


	// The Desktop's gate (plan Review 2026-10-29, Step 5.2): signed in below Personal, the session keeps the refusal the
	// sign-in box shows (the license message and Sign out), as a Server's 401 "license" would be kept.
	function check_tier()
	{
		if ( DESKTOP && clerk && clerk.user && !Licensed( 'personal' ) )
		{
			session.Refusal = { Error: 'license', Plan: 'personal' };
		}
	}


	// Whether the page is open to the person: in the Desktop a sign-in at Personal or above, elsewhere always (a Server's
	// refusal is its own root's).
	function Admitted()
	{
		if ( !DESKTOP )
		{
			return true;
		}
		return SignedIn() && !session.Refusal && Licensed( 'personal' );
	}


	// The server refused a request with 401: the sign-in box shows (when Clerk is on); a "license" refusal is kept
	// with the plan wanted, so the box says so instead of asking for a sign-in again.
	function Needed( Body )
	{
		if ( !session.On )
		{
			return;
		}
		// Refused while Clerk holds a session: the call went out before the token was there. Once per page, the page
		// reads everything again (app.js listens), instead of asking a signed-in person to sign in.
		if ( clerk && clerk.user && clerk.session && !retried && !( Body && ( Body.Error === 'license' || Body.Error === 'closed' ) ) )
		{
			retried = true;
			$rootScope.$broadcast( 'session-ready' );
			return;
		}
		// the Desktop, signed in: a Server that refuses the person says so on its own root, the others go on
		if ( DESKTOP && clerk && clerk.user )
		{
			return;
		}
		session.Required = true;
		// a refusal shown with Sign out: a license below what is needed, or a Server's gate closed to this person
		session.Refusal = ( Body && ( Body.Error === 'license' || Body.Error === 'closed' ) ) ? Body : null;
		// the Server's gate (plan The Server, Step 3): why it is closed, said above the sign-in
		session.Closed = ( Body && Body.Closed && Body.Reason ) ? Body.Reason : null;
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
	session.Tier = Tier;
	session.Licensed = Licensed;
	session.Admitted = Admitted;
	session.Needed = Needed;
	session.Open = Open;
	session.SignOut = SignOut;
	session.MountSignIn = MountSignIn;
	session.MountUserButton = MountUserButton;
	session.Unmount = Unmount;
	return session;
} ] );
