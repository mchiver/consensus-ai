'use strict';

// Roots - the servers the page shows (plan Run Shapes, Step 5), each a root of the tree with its own participants,
// projects, LLM connections and events. In the desktop the roots are handed in window.ConsensusDesktop.Roots: this
// machine's server (Key "local", named by the config's Name) or a Host (Key its Name), each reached
// through the desktop's forwarding at /servers/<key>. In a browser there is one root, the page's own origin, Key ""
// and today's routes. What is one at a time (the open item, the view, the selection) is State's, which names its root.
// The Desktop's window shows one project (plan Rearchitecturation, Step 2): window.ConsensusDesktop.Project names it
// ({ Id, Name, Path?, Key }), Single() is true, and the one root's StoredKey (the folder, or the Host's address and
// the project id) keys the remembered state in place of the server's address, which changes port at every start.
//
//   root = { Key, Name, Url, Kind: 'local' | 'server' | 'browser', Version, Base, StoredKey, Me, Participants, States,
//            Plans, Projects, Live, Error, Loaded }
//   Roots  { List, Project, Of( key ), HashFor( root, path ), Address( root ), LoadMe( root ), LoadList( root ),
//            Listen( root, on_change, on_status ), ByProject( id ), ByPlan( id ), Several(), Single() }

angular.module( 'Consensus' ).factory( 'Roots', [ '$rootScope', 'Client', function ( $rootScope, Client )
{
	let roots = { List: [] };


	function make( info )
	{
		let key = String( info.Key || '' );
		return {
			Key: key,
			Name: info.Name || window.location.host,
			Url: info.Url || '',
			Kind: info.Kind || ( key ? 'server' : 'browser' ),
			Version: info.Version || null,
			Base: key ? '/servers/' + encodeURIComponent( key ) : '',
			StoredKey: info.StoredKey || null,
			Me: null,
			Participants: [],
			States: [],
			Plans: [],
			Projects: [],
			Live: false,
			Error: null,
			Loaded: false,
			Sequence: 0,
		};
	}


	let given = ( window.ConsensusDesktop && Array.isArray( window.ConsensusDesktop.Roots ) ) ? window.ConsensusDesktop.Roots : [ { Key: '', Name: window.location.host, Url: '' } ];
	roots.List = given.map( make );
	// The window's one project (the Desktop), or null for a page of many.
	roots.Project = ( window.ConsensusDesktop && window.ConsensusDesktop.Project && window.ConsensusDesktop.Project.Id ) ? window.ConsensusDesktop.Project : null;
	// The Client (plan Client Edition, Step 3): its page leaves out every Server's configuration.
	roots.Client = !!( window.ConsensusDesktop && window.ConsensusDesktop.Client === true );
	// The edition the page runs in (plan Review 2026-10-29, Step 3): the bridge's Edition, 'desktop', 'sidecar',
	// 'client' or 'server'; null in a browser.
	roots.Edition = ( window.ConsensusDesktop && typeof window.ConsensusDesktop.Edition === 'string' ) ? window.ConsensusDesktop.Edition : null;
	// The application's name, in the title bar, the window's title and About; plain Consensus in a browser.
	roots.Product = product_name();
	document.title = roots.Product;


	function product_name()
	{
		let names = { desktop: 'Consensus Desktop', sidecar: 'Consensus Sidecar', client: 'Consensus Client', server: 'Consensus Server' };
		if ( roots.Edition && names[ roots.Edition ] )
		{
			return names[ roots.Edition ];
		}
		if ( window.ConsensusDesktop )
		{
			return 'Consensus Desktop';
		}
		return 'Consensus';
	}


	function Of( Key )
	{
		let key = String( Key || '' );
		return roots.List.find( function ( root ) { return root.Key === key; } ) || null;
	}


	// The route to an item of a root: a browser's one root keeps today's routes; a named root goes under /s/<key>.
	function HashFor( Root, Path )
	{
		return '#' + ( ( Root && Root.Key ) ? '/s/' + encodeURIComponent( Root.Key ) : '' ) + Path;
	}


	// The root's address without its scheme: the per-server key of the remembered state (stored.js); '' in a browser;
	// the root's StoredKey when it has one (the Desktop's one project).
	function Address( Root )
	{
		if ( Root && Root.StoredKey )
		{
			return String( Root.StoredKey );
		}
		return String( ( Root && Root.Url ) || '' ).replace( /^https?:\/\//, '' ).replace( /\/+$/, '' );
	}


	function Several()
	{
		return roots.List.length > 1;
	}


	// One project in the window: the Desktop (plan Rearchitecturation, Step 2).
	function Single()
	{
		return !!roots.Project;
	}


	function digest()
	{
		$rootScope.$applyAsync();
	}


	async function LoadMe( Root )
	{
		try
		{
			let view_mark = ( window.ConsensusStored && typeof window.ConsensusStored.ViewMark === 'function' ) ? window.ConsensusStored.ViewMark() : undefined;
			let answer = await Client.Get( Root, '/api/me' );
			Root.Me = answer.Me;
			Root.Sidecar = !!answer.Sidecar;		// plan The Server, Step 4: the Desktop's sidecar mode: no LLMs, Users or roles
			Root.People = !!answer.People;		// plan The Server, Step 5: a Server: people sign in whatever its Scope
			Root.Admin = !!answer.Admin;			// plan User Management, Step 3: the Administrator, and the account's roles by project
			Root.Manage = !!( answer.Manage || answer.Admin );	// plan The Server, Step 2: the Administrator or a Manager
			Root.Roles = answer.Roles || {};
			Root.Participants = answer.Participants;
			Root.States = answer.States || [];
			Root.Version = answer.Version || Root.Version;
			// the look (plan Project settings, Step 2): the window's server's View, the project's or the Server's
			if ( Root === roots.List[ 0 ] && answer.View && window.ConsensusStored && typeof window.ConsensusStored.SetView === 'function' )
			{
				window.ConsensusStored.SetView( answer.View, answer.ViewWritable === true, function ( changes )
				{
					return Client.Put( Root, '/api/view', { View: changes } );
				}, view_mark );
			}
			if ( answer.Server && Root.Kind === 'browser' )
			{
				Root.Name = answer.Server;
			}
			Root.Error = null;
		}
		catch ( error )
		{
			Root.Error = error.message;
		}
		digest();
	}


	// The plans (for the counts) and the projects with their trees (for the sidebar), together; each project
	// marked with its root. Loads overlap when changes come quickly: an older answer arriving after a newer one is
	// dropped, so the list never goes back.
	async function LoadList( Root )
	{
		Root.Sequence += 1;
		let sequence = Root.Sequence;
		let answers = null;
		try
		{
			answers = await Promise.all( [ Client.Get( Root, '/api/plans' ), Client.Get( Root, '/api/projects' ) ] );
		}
		catch ( error )
		{
			Root.Error = error.message;
			digest();
			return;
		}
		if ( sequence !== Root.Sequence )
		{
			return;
		}
		Root.Plans = answers[ 0 ].Plans;
		Root.Projects = answers[ 1 ].Projects.map( function ( project ) { project.Root = Root.Key; return project; } );
		Root.Loaded = true;
		Root.Error = null;
		digest();
	}


	function Listen( Root, OnChange, OnStatus )
	{
		return Client.Listen( Root, OnChange, function ( live )
		{
			Root.Live = live;
			OnStatus( live );
		} );
	}


	function ByProject( Id )
	{
		return roots.List.find( function ( root ) { return root.Projects.some( function ( project ) { return project.Id === Id; } ); } ) || null;
	}


	function ByPlan( Id )
	{
		return roots.List.find( function ( root ) { return root.Plans.some( function ( plan ) { return plan.Id === Id; } ); } ) || null;
	}


	roots.Of = Of;
	roots.HashFor = HashFor;
	roots.Address = Address;
	roots.Several = Several;
	roots.Single = Single;
	roots.LoadMe = LoadMe;
	roots.LoadList = LoadList;
	roots.Listen = Listen;
	roots.ByProject = ByProject;
	roots.ByPlan = ByPlan;
	return roots;
} ] );
