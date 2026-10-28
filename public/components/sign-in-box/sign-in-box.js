'use strict';

// sign-in-box - Clerk's sign-in form in a popup (plan User Management, Step 4; plan Clerk, Steps 3 and 5), shown when
// the page's own server refused a request with 401 (the session is Required) and nobody is signed in, or when the
// Settings popup's Sign in button asked for one on a Local server (Asked). The form is Clerk's, mounted into the box
// by the clerk-mount directive below; a finished sign-in reloads the page (Session). When the server refused a
// signed-in person for their license (401 "license"), the box says which plan the person's roles need, links the
// pricing page and offers Clerk's sign-out instead of the form. The same directive mounts Clerk's user button in the
// title bar.
//
// Interface:
//   <sign-in-box></sign-in-box>
//   reads Session.On, Session.Required, Session.Asked, Session.Refusal, Session.SignedIn(), Session.Error,
//   Session.Pricing; Roots.Of( Session.Key ) for the server's name
//   <element clerk-mount="sign-in"> or <element clerk-mount="user">: Clerk's form or user button mounted on the element

angular.module( 'Consensus' ).component( 'signInBox', {
	templateUrl: '/components/sign-in-box/sign-in-box.html',
	controller: [ 'Session', 'Roots', function ( Session, Roots )
	{
		let controller = this;
		controller.Session = Session;


		controller.Shown = function ()
		{
			if ( !Session.On )
			{
				return false;
			}
			if ( Session.Refusal )
			{
				return true;
			}
			return ( Session.Required || Session.Asked ) && !Session.SignedIn();
		};


		// The server signed in to; the Client's one sign-in is good on every Server (plan Client Edition, Step 2).
		controller.Name = function ()
		{
			if ( Session.Every === true )
			{
				return 'Consensus';
			}
			let root = Roots.Of( Session.Key || '' );
			return ( root && root.Name ) ? root.Name : window.location.host;
		};


		// The close (plan UI Tweaks IX): not on a server that requires the sign-in, where nothing is behind the box; on a
		// Local server the box was asked for, and closing it forgets the ask and the license refusal it may show.
		controller.CanClose = function ()
		{
			return !Session.Required;
		};


		controller.Close = function ()
		{
			Session.Asked = false;
			Session.Refusal = null;
		};


		controller.SignOut = function ()
		{
			Session.SignOut();
		};
	} ],
} )


.directive( 'clerkMount', [ 'Session', function ( Session )
{
	return {
		restrict: 'A',
		link: function ( scope, element, attributes )
		{
			let kind = attributes.clerkMount;
			let node = element[ 0 ];
			if ( kind === 'user' )
			{
				Session.MountUserButton( node );
			}
			else
			{
				Session.MountSignIn( node );
			}
			scope.$on( '$destroy', function ()
			{
				Session.Unmount( node, kind );
			} );
		},
	};
} ] );
