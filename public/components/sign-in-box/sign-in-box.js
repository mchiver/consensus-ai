'use strict';

// sign-in-box - Clerk's sign-in form in a popup (plan User Management, Step 4; plan Clerk, Step 3), shown when the
// page's own server signs people in through Clerk and refused a request with 401: the session is Required and
// nobody is signed in. The form is Clerk's, mounted into the box by the clerk-mount directive below; a finished
// sign-in reloads the page (Session). The same directive mounts Clerk's user button in the title bar.
//
// Interface:
//   <sign-in-box></sign-in-box>
//   reads Session.On, Session.Required, Session.SignedIn(), Session.Error; Roots.Of( '' ) for the server's name
//   <element clerk-mount="sign-in"> or <element clerk-mount="user">: Clerk's form or user button mounted on the element

angular.module( 'Consensus' ).component( 'signInBox', {
	templateUrl: '/components/sign-in-box/sign-in-box.html',
	controller: [ 'Session', 'Roots', function ( Session, Roots )
	{
		let controller = this;
		controller.Session = Session;


		controller.Shown = function ()
		{
			return Session.On && Session.Required && !Session.SignedIn();
		};


		controller.Name = function ()
		{
			let root = Roots.Of( '' );
			return ( root && root.Name ) ? root.Name : window.location.host;
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
