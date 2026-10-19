'use strict';

// roles-folder - a project's Users folder (plan User Management, Step 3; the roles are Accounts and Roles'): a fixed
// folder after the Context folder holding exactly Owners, Members, Service and Watchers, each listing the accounts
// in it by display name. An account is dragged in from the server's Users fold (users-fold's drag-account), dragged
// between the four to change role, and taken out with the × on its row; an account is in one folder at most. The
// Owners of the project and the Administrator do the placing; everyone else sees the folders. Written through
// PUT /api/projects/:pid/roles.
//
// Interface:
//   <roles-folder project="..." root="..."></roles-folder>
//   project  the project as the page lists it, with its Roles
//   root     the root (roots.js); its accounts through Users.For( root )

const DRAG_ACCOUNT_TYPE_DROP = 'application/x-consensus-account';

angular.module( 'Consensus' ).component( 'rolesFolder', {
	templateUrl: '/components/roles-folder/roles-folder.html',
	bindings: { project: '<', root: '<' },
	controller: [ '$scope', 'Users', 'Roots', 'Client', function ( $scope, Users, Roots, Client )
	{
		const ROLES = [ 'Owners', 'Members', 'Service', 'Watchers' ];
		const TITLES = {
			Owners: 'full access: resolves any thread, sets states, manages the project and its roles',
			Members: 'reads and writes: edits, replies, resolves the threads they started, presses the tasks',
			Service: 'Service accounts: read and write through the API, press no task',
			Watchers: 'read the project and its threads, press the tasks that write nothing',
		};

		let controller = this;
		controller.Roles = ROLES;
		controller.Showing = false;
		controller.Open = {};		// role -> whether its folder is open
		controller.Error = null;
		controller.Busy = false;


		controller.Toggle = function ( event )
		{
			event.stopPropagation();
			controller.Showing = !controller.Showing;
		};


		controller.ToggleRole = function ( role, event )
		{
			event.stopPropagation();
			controller.Open[ role ] = !controller.Open[ role ];
		};


		controller.Title = function ( role )
		{
			return TITLES[ role ];
		};


		controller.Ids = function ( role )
		{
			let folders = ( controller.project && controller.project.Roles ) || {};
			return Array.isArray( folders[ role ] ) ? folders[ role ] : [];
		};


		controller.Count = function ()
		{
			let count = 0;
			for ( let role of ROLES )
			{
				count += controller.Ids( role ).length;
			}
			return count;
		};


		controller.Display = function ( id )
		{
			return Users.Display( controller.root, id );
		};


		controller.AccountHash = function ( id )
		{
			return Roots.HashFor( controller.root, '/u/' + encodeURIComponent( id ) );
		};


		// The Owners of the project and the Administrator place accounts.
		controller.MayPlace = function ()
		{
			let root = controller.root;
			let me = root ? root.Me : null;
			if ( !me )
			{
				return false;
			}
			if ( me.Role === 'owner' || me.Admin === true || root.Admin === true )
			{
				return true;
			}
			let roles = root.Roles || {};
			return roles[ controller.project.Id ] === 'Owners';
		};


		// Place( id, role ): the account goes into the folder (null: out of every folder); the project is written.
		controller.Place = async function ( id, role )
		{
			if ( !controller.MayPlace() || controller.Busy )
			{
				return;
			}
			let next = {};
			for ( let name of ROLES )
			{
				next[ name ] = controller.Ids( name ).filter( function ( one ) { return one !== id; } );
			}
			if ( role )
			{
				next[ role ].push( id );
			}
			controller.Busy = true;
			controller.Error = null;
			try
			{
				await Client.Put( controller.root, '/api/projects/' + encodeURIComponent( controller.project.Id ) + '/roles', next );
				controller.Showing = true;
				if ( role )
				{
					controller.Open[ role ] = true;
				}
				await Roots.LoadList( controller.root );
			}
			catch ( error )
			{
				controller.Error = ( error.Body && error.Body.Error ) || error.message;
			}
			controller.Busy = false;
			$scope.$applyAsync();
		};
	} ],
} )


//---------------------------------------------------------------------
// role-drop="'Owners'" on-role-drop="Handler( Id, Role )": a role folder's head takes an account dragged from the
// Users fold or from another role folder.

.directive( 'roleDrop', [ function ()
{
	return {
		restrict: 'A',
		link: function ( scope, element, attributes )
		{
			let node = element[ 0 ];

			function dragged( event )
			{
				return Array.from( event.dataTransfer.types ).includes( DRAG_ACCOUNT_TYPE_DROP );
			}

			node.addEventListener( 'dragover', function ( event )
			{
				if ( !dragged( event ) )
				{
					return;
				}
				event.preventDefault();
				event.stopPropagation();
				event.dataTransfer.dropEffect = 'move';
				node.classList.add( 'drop-into' );
			} );
			node.addEventListener( 'dragleave', function ()
			{
				node.classList.remove( 'drop-into' );
			} );
			node.addEventListener( 'drop', function ( event )
			{
				node.classList.remove( 'drop-into' );
				if ( !dragged( event ) )
				{
					return;
				}
				event.preventDefault();
				event.stopPropagation();
				let id = event.dataTransfer.getData( DRAG_ACCOUNT_TYPE_DROP );
				scope.$apply( function () { scope.$eval( attributes.onRoleDrop, { Id: id, Role: scope.$eval( attributes.roleDrop ) } ); } );
			} );
		},
	};
} ] );
