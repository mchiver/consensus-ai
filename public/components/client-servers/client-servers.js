'use strict';

// client-servers - the Desktop's Servers popup (plan Client Edition, Step 2, as the Client's; the Desktop's since plan
// Review 2026-10-29, Step 5.1, the editions cut, the component keeping its name): the Servers the person added, each with its
// name (renamed in place), its address, and whether it answers now (offline with the reason); Remove takes it out of
// the list and changes nothing on the Server; Add server takes an address, which the Client tries (GET /api/me with
// the person's session token) and saves under the Server's own name. A change reloads every window on the new list.
// Opened from the application menu (Servers…) and a Server's row menu, and at once when someone signed in has no
// Servers yet. Shown only in the Desktop (window.ConsensusDesktop.Edition desktop).
//
// Interface:
//   <client-servers></client-servers>
//   ClientServers { Available, Open, Show(), Close() }: the popup's state, for the menus
//   reads Roots.Of( name ) (Live, Error) and Session (the token for Add server, SignedIn()); calls
//   window.ConsensusDesktop.Servers, AddServer, RenameServer and RemoveServer

angular.module( 'Consensus' ).factory( 'ClientServers', [ '$window', function ( $window )
{
	let bridge = $window.ConsensusDesktop;
	let available = !!( bridge && bridge.Edition === 'desktop' && typeof bridge.AddServer === 'function' );
	let panel = {
		Available: available,
		Open: false,
	};

	panel.Show = function ()
	{
		if ( available )
		{
			panel.Open = true;
		}
	};

	panel.Close = function ()
	{
		panel.Open = false;
	};

	return panel;
} ] )


.component( 'clientServers', {
	templateUrl: '/components/client-servers/client-servers.html',
	controller: [ '$scope', '$window', 'ClientServers', 'Roots', 'Session', function ( $scope, $window, ClientServers, Roots, Session )
	{
		let controller = this;
		controller.Panel = ClientServers;
		controller.Servers = [];		// [ { Name, Url, NewName } ]
		controller.Url = '';
		controller.Busy = false;
		controller.Error = '';
		controller.Removing = null;		// the name asked about


		function bridge()
		{
			return $window.ConsensusDesktop;
		}


		async function load()
		{
			let answer = await bridge().Servers();
			controller.Servers = ( answer.Servers || [] ).map( function ( server ) { return { Name: server.Name, Url: server.Url, NewName: server.Name }; } );
			$scope.$applyAsync();
		}


		// Opened: the list read afresh, the form empty.
		$scope.$watch( function () { return ClientServers.Open; }, function ( open )
		{
			if ( open )
			{
				controller.Url = '';
				controller.Error = '';
				controller.Removing = null;
				load();
			}
		} );


		// Signed in with no Servers yet: the popup opens by itself, once.
		if ( ClientServers.Available )
		{
			Session.Ready.then( function ()
			{
				if ( Session.SignedIn() && Roots.List.length === 0 )
				{
					ClientServers.Show();
					$scope.$applyAsync();
				}
			} );
		}


		// Live, offline with the reason, or refused by the Server (its Error, still Live).
		controller.State = function ( server )
		{
			let root = Roots.Of( server.Name );
			if ( !root )
			{
				return '';
			}
			if ( root.Error )
			{
				return ( root.Live ? '' : 'offline: ' ) + root.Error;
			}
			return root.Live ? 'online' : 'offline';
		};


		controller.Online = function ( server )
		{
			let root = Roots.Of( server.Name );
			return !!( root && root.Live && !root.Error );
		};


		async function act( work )
		{
			if ( controller.Busy )
			{
				return;
			}
			controller.Busy = true;
			controller.Error = '';
			$scope.$applyAsync();
			let answer = null;
			try
			{
				answer = await work();
			}
			catch ( error )
			{
				answer = { Error: error.message };
			}
			controller.Busy = false;
			if ( answer && answer.Error )
			{
				controller.Error = answer.Error;
			}
			$scope.$applyAsync();
			return answer;
		}


		// Add server: tried with the person's token, saved under the Server's name; the windows reload on success.
		controller.Add = function ()
		{
			let url = String( controller.Url || '' ).trim();
			if ( !url )
			{
				return;
			}
			return act( async function ()
			{
				let token = await Session.Token();
				return bridge().AddServer( { Url: url, Token: token } );
			} );
		};


		controller.Rename = function ( server )
		{
			let name = String( server.NewName || '' ).trim();
			if ( !name || name === server.Name )
			{
				server.NewName = server.Name;
				return;
			}
			return act( function () { return bridge().RenameServer( { Name: server.Name, To: name } ); } ).then( function ( answer )
			{
				if ( answer && answer.Error )
				{
					server.NewName = server.Name;
				}
			} );
		};


		controller.AskRemove = function ( server )
		{
			controller.Removing = server.Name;
		};


		controller.Remove = function ( server )
		{
			controller.Removing = null;
			return act( function () { return bridge().RemoveServer( server.Name ); } );
		};


		controller.Key = function ( event )
		{
			if ( event.key === 'Escape' )
			{
				ClientServers.Close();
			}
		};
	} ],
} );
