'use strict';

// user-page - an account's page (plan User Management, Step 3): the details (login, display, email, type; the
// Administrator edits them, an account its own display), the projects and the role in each, the tokens (Create
// token with a name, the value shown once with Copy, the list with each one's last use, Revoke), the activity on
// the server (the threads, replies, resolves, applies and revisions the records hold, newest first), and Delete
// (the Administrator's, never the owner). The owner's own page on a Local server is the same page, where the
// owner's tokens are minted. The page is the account's own or the Administrator's; anyone else sees a line.
// Plan The Server, Step 2: a Manager manages as the Administrator does, except the Administrator's and the Managers'
// accounts; the Administrator makes a user a Manager (the Manager switch), and the heading says Administrator,
// Manager or Member.
//
// Interface:
//   <user-page></user-page>
//   reads State.OpenItem ({ Kind: 'u', Id: the account's id, Root }) and State.View ('u'); the accounts through
//   Users; GET /api/users/:id, PUT, DELETE, the tokens routes and /activity; listens to changed (users)

angular.module( 'Consensus' ).component( 'userPage', {
	templateUrl: '/components/user-page/user-page.html',
	controller: [ '$scope', '$window', 'State', 'Client', 'Users', 'Roots', 'Tabs', function ( $scope, $window, State, Client, Users, Roots, Tabs )
	{
		let controller = this;
		controller.State = State;
		controller.Root = null;
		controller.Id = null;
		controller.User = null;			// the record as /api/users/:id shows it, with its tokens
		controller.IsAdmin = false;		// whether the account shown is the Administrator
		controller.IsManager = false;	// whether the account shown is a Manager
		controller.Assigning = { Busy: false, Problem: null };
		controller.Error = null;
		controller.Refused = null;		// another account's page: the line shown instead
		controller.Form = null;			// { Login, Display, Email, Busy, Saved, Problem }
		controller.Token = { Name: '', Busy: false, Problem: null, Shown: null, Copied: false };
		controller.Revoking = null;		// the token name being revoked
		controller.Deleting = false;
		controller.Activity = [];
		controller.ActivityLoaded = false;
		controller.HashFor = Roots.HashFor;


		function current()
		{
			let open = State.OpenItem;
			if ( State.View !== 'u' || !open || open.Kind !== 'u' )
			{
				return null;
			}
			let root = Roots.Of( open.Root ) || State.Root;
			return root ? { Root: root, Id: open.Id } : null;
		}


		async function load()
		{
			let where = current();
			if ( !where )
			{
				return;
			}
			let changed = controller.Id !== where.Id || controller.Root !== where.Root;
			controller.Root = where.Root;
			controller.Id = where.Id;
			if ( changed )
			{
				controller.User = null;
				controller.Form = null;
				controller.Error = null;
				controller.Refused = null;
				controller.Token = { Name: '', Busy: false, Problem: null, Shown: null, Copied: false };
				controller.Revoking = null;
				controller.Deleting = false;
				controller.Activity = [];
				controller.ActivityLoaded = false;
			}
			try
			{
				let answer = await Client.Get( controller.Root, '/api/users/' + encodeURIComponent( controller.Id ) );
				if ( controller.Id !== where.Id )
				{
					return;
				}
				controller.User = answer.User;
				controller.IsAdmin = !!answer.Admin;
				controller.IsManager = !!answer.Manager;
				controller.Refused = null;
				if ( !controller.Form || !controller.Form.Dirty )
				{
					controller.Form = { Login: answer.User.Login, Display: answer.User.Display, Email: answer.User.Email || '', Busy: false, Saved: false, Problem: null, Dirty: false };
				}
			}
			catch ( error )
			{
				controller.Refused = ( error.Body && error.Body.Error ) || error.message;
				controller.User = null;
			}
			$scope.$applyAsync();
			if ( controller.User && !controller.ActivityLoaded )
			{
				load_activity();
			}
		}


		async function load_activity()
		{
			let id = controller.Id;
			try
			{
				let answer = await Client.Get( controller.Root, '/api/users/' + encodeURIComponent( id ) + '/activity' );
				if ( controller.Id === id )
				{
					controller.Activity = answer.Activity || [];
					controller.ActivityLoaded = true;
				}
			}
			catch ( error )
			{
				controller.ActivityLoaded = true;
			}
			$scope.$applyAsync();
		}


		//-----------------------------------------------------------------
		// Who may do what on this page.

		// The one asking is the Administrator of this server.
		controller.AdminAsking = function ()
		{
			let me = controller.Root ? controller.Root.Me : null;
			return !!me && ( me.Role === 'owner' || me.Admin === true );
		};


		// The one asking manages this server: the Administrator or a Manager.
		controller.ManageAsking = function ()
		{
			let me = controller.Root ? controller.Root.Me : null;
			return controller.AdminAsking() || ( !!me && me.Manager === true );
		};


		// The account shown is the Administrator's or a Manager's: a Manager leaves its details to the Administrator.
		controller.Guarded = function ()
		{
			return controller.IsAdmin || controller.IsManager;
		};


		// The account's place on the server, for the heading: Administrator, Manager or Member (a user's).
		controller.Standing = function ()
		{
			if ( controller.IsAdmin )
			{
				return 'Administrator';
			}
			if ( controller.IsManager )
			{
				return 'Manager';
			}
			return ( controller.User && controller.User.Type === 'user' ) ? 'Member' : null;
		};


		// The Manager switch: the Administrator's, on a user's page.
		controller.MayAssign = function ()
		{
			return controller.AdminAsking() && !!controller.User && controller.User.Type === 'user' && !controller.IsAdmin;
		};


		controller.Mine = function ()
		{
			let me = controller.Root ? controller.Root.Me : null;
			return !!me && !!controller.User && me.Id === controller.User.Id;
		};


		controller.MayEditDetails = function ()
		{
			return controller.AdminAsking() || ( controller.ManageAsking() && !controller.Guarded() );
		};


		controller.MayEditDisplay = function ()
		{
			return controller.ManageAsking() || controller.Mine();
		};


		// An account mints its own tokens; the Administrator a Service account's (and anyone's).
		controller.MayMint = function ()
		{
			if ( !controller.User )
			{
				return false;
			}
			return controller.ManageAsking() || ( controller.Mine() && controller.User.Type !== 'service' );
		};


		controller.MayDelete = function ()
		{
			if ( !controller.User || controller.User.Type === 'owner' )
			{
				return false;
			}
			return controller.AdminAsking() || ( controller.ManageAsking() && !controller.Guarded() );
		};


		// The projects of the root and the account's role in each, from the role folders the page already holds.
		controller.Roles = function ()
		{
			let roles = [];
			if ( !controller.Root || !controller.User )
			{
				return roles;
			}
			for ( let project of controller.Root.Projects || [] )
			{
				let folders = project.Roles || {};
				for ( let role of [ 'Owners', 'Members', 'Service', 'Watchers' ] )
				{
					if ( Array.isArray( folders[ role ] ) && folders[ role ].includes( controller.User.Id ) )
					{
						roles.push( { Project: project, Role: role } );
					}
				}
			}
			return roles;
		};


		//-----------------------------------------------------------------
		// The details

		controller.Changed = function ()
		{
			if ( controller.Form )
			{
				controller.Form.Dirty = true;
				controller.Form.Saved = false;
			}
		};


		controller.Save = async function ()
		{
			let form = controller.Form;
			if ( !form || form.Busy )
			{
				return;
			}
			form.Busy = true;
			form.Problem = null;
			try
			{
				let body = controller.MayEditDetails() ? { Login: form.Login, Display: form.Display, Email: form.Email || null } : { Display: form.Display };
				let answer = await Client.Put( controller.Root, '/api/users/' + encodeURIComponent( controller.Id ), body );
				controller.User = answer.User;
				form.Dirty = false;
				form.Saved = true;
				await Users.For( controller.Root ).Reload();
			}
			catch ( error )
			{
				form.Problem = ( error.Body && error.Body.Error ) || error.message;
			}
			form.Busy = false;
			$scope.$applyAsync();
		};


		// The Manager switch flipped: the Administrator makes the user a Manager, or no longer one.
		controller.SetManager = async function ( Value )
		{
			let assigning = controller.Assigning;
			if ( assigning.Busy || !controller.MayAssign() )
			{
				return;
			}
			assigning.Busy = true;
			assigning.Problem = null;
			try
			{
				let answer = await Client.Put( controller.Root, '/api/users/' + encodeURIComponent( controller.Id ), { Manager: !!Value } );
				controller.User = answer.User;
				controller.IsManager = !!answer.User.Manager;
				await Users.For( controller.Root ).Reload();
			}
			catch ( error )
			{
				assigning.Problem = ( error.Body && error.Body.Error ) || error.message;
			}
			assigning.Busy = false;
			$scope.$applyAsync();
		};


		//-----------------------------------------------------------------
		// The tokens

		controller.Mint = async function ()
		{
			let token = controller.Token;
			if ( token.Busy || !token.Name.trim() )
			{
				return;
			}
			token.Busy = true;
			token.Problem = null;
			token.Shown = null;
			token.Copied = false;
			try
			{
				let answer = await Client.Post( controller.Root, '/api/users/' + encodeURIComponent( controller.Id ) + '/tokens', { Name: token.Name.trim() } );
				token.Shown = { Name: answer.Name, Token: answer.Token };
				token.Name = '';
				await load();
			}
			catch ( error )
			{
				token.Problem = ( error.Body && error.Body.Error ) || error.message;
			}
			token.Busy = false;
			$scope.$applyAsync();
		};


		controller.Copy = async function ()
		{
			let shown = controller.Token.Shown;
			if ( !shown )
			{
				return;
			}
			try
			{
				await $window.navigator.clipboard.writeText( shown.Token );
				controller.Token.Copied = true;
			}
			catch ( error )
			{
				controller.Token.Problem = 'could not copy: ' + error.message;
			}
			$scope.$applyAsync();
		};


		controller.StartRevoke = function ( name )
		{
			controller.Revoking = name;
		};


		controller.Revoke = async function ( name )
		{
			controller.Revoking = null;
			controller.Error = null;
			try
			{
				await Client.Delete( controller.Root, '/api/users/' + encodeURIComponent( controller.Id ) + '/tokens/' + encodeURIComponent( name ) );
				if ( controller.Token.Shown && controller.Token.Shown.Name === name )
				{
					controller.Token.Shown = null;
				}
				await load();
			}
			catch ( error )
			{
				controller.Error = ( error.Body && error.Body.Error ) || error.message;
			}
			$scope.$applyAsync();
		};


		//-----------------------------------------------------------------
		// Delete: the account leaves the registry and every role folder; its tab closes.

		controller.Delete = async function ()
		{
			controller.Deleting = false;
			controller.Error = null;
			let id = controller.Id;
			let root = controller.Root;
			try
			{
				await Client.Delete( root, '/api/users/' + encodeURIComponent( id ) );
				await Users.For( root ).Reload();
				await Roots.LoadList( root );
				let tab = Tabs.List.find( function ( one ) { return one.Kind === 'u' && one.Id === id && one.Root === root.Key; } );
				if ( tab )
				{
					Tabs.Close( tab );
				}
			}
			catch ( error )
			{
				controller.Error = ( error.Body && error.Body.Error ) || error.message;
			}
			$scope.$applyAsync();
		};


		controller.ActivityWords = function ( entry )
		{
			let words = { thread: 'opened a thread', reply: 'replied', resolved: 'resolved a thread', applied: 'applied a thread', revision: 'made revision ' + entry.Revision };
			return words[ entry.Kind ] || entry.Kind;
		};


		$scope.$watch( function () { let open = State.OpenItem; return ( State.View === 'u' && open && open.Kind === 'u' ) ? open.Root + '|' + open.Id : null; }, function ( key )
		{
			if ( key )
			{
				load();
			}
		} );
		$scope.$on( 'changed', function ( event, change, root )
		{
			if ( controller.Root && root === controller.Root && change.Kind === 'users' && State.View === 'u' )
			{
				load();
			}
		} );
	} ],
} );
