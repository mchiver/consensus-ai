'use strict';

// users-fold - the accounts of a server (plan User Management, Step 3): the Users heading with its menu (New user,
// New Service account: the Administrator's), the inline form for a new account, and the list, one row per account
// linking to its page (#/u/<id>); a row can be dragged into a project's role folder (roles-folder). On a Local
// server the fold holds the owner alone, whose page is where the owner's own tokens are minted.
//
// Interface:
//   <users-fold root="..." first="..."></users-fold>
//   root   the root (roots.js); its accounts through Users.For( root )
//   first  true on the first root, which carries the ids the tests look for
//   drag-account="<id>" on a row: the drag the role folders take

const DRAG_ACCOUNT_TYPE = 'application/x-consensus-account';

angular.module( 'Consensus' ).component( 'usersFold', {
	templateUrl: '/components/users-fold/users-fold.html',
	bindings: { root: '<', first: '<' },
	controller: [ '$window', '$rootScope', 'Tree', 'Users', 'Roots', 'Menus', 'Client', function ( $window, $rootScope, Tree, Users, Roots, Menus, Client )
	{
		const SHOWN_KEY = 'users-shown';		// whether the fold is open, per server (stored.js)

		let controller = this;
		controller.Tree = Tree;
		controller.Users = Users;
		controller.HashFor = Roots.HashFor;
		controller.Showing = true;
		controller.Creating = null;		// { Kind: 'user' | 'service', Login, Display, Email, Problem, Busy }


		controller.$onInit = function ()
		{
			controller.Showing = window.ConsensusStored.Read( SHOWN_KEY, true, controller.root ) !== false;
		};


		controller.Items = function ()
		{
			return Users.For( controller.root );
		};


		controller.Toggle = function ()
		{
			controller.Showing = !controller.Showing;
			window.ConsensusStored.Write( SHOWN_KEY, controller.Showing, controller.root );
		};


		// The fold's menu (new accounts) is the Administrator's and the Managers' (plan The Server, Step 2).
		controller.IsAdmin = function ()
		{
			let me = controller.root ? controller.root.Me : null;
			return !!me && ( me.Role === 'owner' || me.Admin === true || me.Manager === true );
		};


		controller.MenuKey = function ()
		{
			return { Id: 'users:' + controller.root.Key };
		};


		controller.OpenMenu = function ( event )
		{
			let admin = controller.IsAdmin();
			Menus.Show( [
				{ Label: 'New user', Icon: 'plus', Act: function () { start( 'user' ); }, Disabled: !admin },
				{ Label: 'New Service account', Icon: 'plus', Act: function () { start( 'service' ); }, Disabled: !admin },
			], event, 'users:' + controller.root.Key );
		};


		function start( kind )
		{
			controller.Showing = true;
			controller.Creating = { Kind: kind, Login: '', Display: '', Email: '', Problem: null, Busy: false };
			$rootScope.$applyAsync();
		}


		controller.Cancel = function ()
		{
			controller.Creating = null;
		};


		// The new account posted; its page opens.
		controller.Create = async function ()
		{
			let creating = controller.Creating;
			if ( !creating || creating.Busy || !creating.Login.trim() )
			{
				return;
			}
			creating.Busy = true;
			creating.Problem = null;
			try
			{
				let body = { Type: creating.Kind, Login: creating.Login.trim(), Display: creating.Display.trim() || undefined, Email: ( creating.Kind === 'user' ) ? creating.Email.trim() : undefined };
				let answer = await Client.Post( controller.root, '/api/users', body );
				controller.Creating = null;
				await Users.For( controller.root ).Reload();
				$window.location.hash = Roots.HashFor( controller.root, '/u/' + encodeURIComponent( answer.User.Id ) );
			}
			catch ( error )
			{
				creating.Problem = ( error.Body && error.Body.Error ) || error.message;
				creating.Busy = false;
			}
			$rootScope.$applyAsync();
		};


		controller.Key = function ( event )
		{
			if ( event.key === 'Escape' )
			{
				controller.Cancel();
			}
		};
	} ],
} )


//---------------------------------------------------------------------
// drag-account="<id>": a user row can be dragged into a project's role folder (roles-folder).

.directive( 'dragAccount', [ function ()
{
	return {
		restrict: 'A',
		link: function ( scope, element, attributes )
		{
			let node = element[ 0 ];
			node.setAttribute( 'draggable', 'true' );
			node.addEventListener( 'dragstart', function ( event )
			{
				event.stopPropagation();
				event.dataTransfer.clearData();
				event.dataTransfer.setData( DRAG_ACCOUNT_TYPE, scope.$eval( attributes.dragAccount ) );
				event.dataTransfer.effectAllowed = 'move';
			} );
		},
	};
} ] );
