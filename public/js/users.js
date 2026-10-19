'use strict';

// Users - the accounts of a server (plan User Management, Step 3): the registry's public list from /api/users, read
// per root at start and again when the server says it changed ({ Kind: 'users' } over the events), for the Users
// fold in the sidebar, the user pages and the role folders of a project.
//
//   Users      { For( root ) -> { Loaded, Users, Admin, Reload() }, UserById( id ), Display( root, id ) }
//   route      #/u/<account id>, under #/s/<root> for a named root

angular.module( 'Consensus' ).factory( 'Users', [ '$rootScope', 'Client', 'Roots', function ( $rootScope, Client, Roots )
{
	let per_root = {};		// root key -> the root's accounts


	function make( root )
	{
		let items = {
			Root: root,
			Loaded: false,
			Users: [],
			Admin: false,		// whether the account asking is the Administrator
		};


		async function Reload()
		{
			try
			{
				let answer = await Client.Get( root, '/api/users' );
				items.Users = ( answer.Users || [] ).map( function ( user ) { user.Root = root.Key; return user; } );
				items.Admin = !!answer.Admin;
			}
			catch ( error )
			{
				items.Users = [];
				items.Admin = false;
			}
			items.Loaded = true;
			$rootScope.$applyAsync();
		}


		items.Reload = Reload;
		return items;
	}


	function For( Root )
	{
		let root = Root || Roots.List[ 0 ];
		let key = root ? root.Key : '';
		if ( !per_root[ key ] )
		{
			per_root[ key ] = make( root );
		}
		return per_root[ key ];
	}


	// An account by id, on any root.
	function UserById( Id )
	{
		for ( let key of Object.keys( per_root ) )
		{
			let found = per_root[ key ].Users.find( function ( user ) { return user.Id === Id; } );
			if ( found )
			{
				return found;
			}
		}
		return null;
	}


	// An account's display name on a root, or its id while the list is not loaded.
	function Display( Root, Id )
	{
		let found = For( Root ).Users.find( function ( user ) { return user.Id === Id; } );
		return found ? found.Display : Id;
	}


	return {
		For: For,
		UserById: UserById,
		Display: Display,
	};
} ] );
