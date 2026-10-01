'use strict';

// Menus - one popup menu for the page, opened by the tree's rows and the tabs. A caller hands Show its items and
// the event that asked (a click on a ⋯ or ▾ button, or a right-click); the menu opens under the button, or at the
// pointer, kept within the window. A click elsewhere, Escape, a scroll or a resize closes it.
//
//   item = { Label, Icon?, Act: function (), Disabled?, Danger? }   or   { Separator: true }

angular.module( 'Consensus' ).factory( 'Menus', [ '$rootScope', function ( $rootScope )
{
	let menu = {
		Open: null,
	};


	// Items, and the event: its button (when it came from one) or its pointer places the menu. Key names what the
	// menu is for, so the page can mark the row or tab it belongs to.
	function Show( Items, Event, Key )
	{
		Event.preventDefault();
		Event.stopPropagation();
		let button = ( Event.type === 'contextmenu' ) ? null : Event.currentTarget;
		let place = null;
		if ( button && button.getBoundingClientRect )
		{
			let rect = button.getBoundingClientRect();
			place = { X: rect.right, Y: rect.bottom + 2, AlignRight: true };
		}
		else
		{
			place = { X: Event.clientX, Y: Event.clientY, AlignRight: false };
		}
		menu.Open = { Items: Items, Place: place, Key: Key || null };
		$rootScope.$broadcast( 'menu-opened' );
	}


	function Close()
	{
		menu.Open = null;
	}


	function IsOpenFor( Key )
	{
		return !!menu.Open && menu.Open.Key === Key;
	}


	menu.Show = Show;
	menu.Close = Close;
	menu.IsOpenFor = IsOpenFor;
	return menu;
} ] )


//---------------------------------------------------------------------
// MenuController: the menu itself, drawn once at the end of the page.

.controller( 'MenuController', [ '$scope', '$timeout', '$window', 'Menus', function ( $scope, $timeout, $window, Menus )
{
	const MARGIN = 4;
	$scope.Menus = Menus;
	let element = document.getElementById( 'popup-menu' );


	// Placed once drawn, when its size is known: under the button's right edge, or at the pointer; inside the window.
	function place()
	{
		if ( !Menus.Open )
		{
			return;
		}
		let spot = Menus.Open.Place;
		let width = element.offsetWidth;
		let height = element.offsetHeight;
		let left = spot.AlignRight ? spot.X - width : spot.X;
		let top = spot.Y;
		left = Math.max( MARGIN, Math.min( left, $window.innerWidth - width - MARGIN ) );
		if ( top + height > $window.innerHeight - MARGIN )
		{
			top = Math.max( MARGIN, $window.innerHeight - height - MARGIN );
		}
		element.style.left = left + 'px';
		element.style.top = top + 'px';
		element.style.visibility = 'visible';
	}


	$scope.$on( 'menu-opened', function ()
	{
		element.style.visibility = 'hidden';
		$timeout( place, 0, false );
	} );


	$scope.Pick = function ( item, event )
	{
		event.stopPropagation();
		if ( item.Disabled || item.Separator )
		{
			return;
		}
		Menus.Close();
		item.Act();
	};


	// Closed at once, then drawn: a close left for the next digest would undo a menu opened in between.
	function close_now()
	{
		if ( Menus.Open )
		{
			Menus.Close();
			$scope.$applyAsync();
		}
	}


	document.addEventListener( 'mousedown', function ( event )
	{
		if ( Menus.Open && !element.contains( event.target ) )
		{
			close_now();
		}
	}, true );
	document.addEventListener( 'keydown', function ( event )
	{
		if ( event.key === 'Escape' )
		{
			close_now();
		}
	} );
	document.addEventListener( 'scroll', close_now, true );
	$window.addEventListener( 'resize', close_now );
	$window.addEventListener( 'blur', close_now );
} ] )


//---------------------------------------------------------------------
// on-context-menu="Handler( $event )": a right-click on the element runs the handler in place of the browser's menu.

.directive( 'onContextMenu', [ function ()
{
	return {
		restrict: 'A',
		link: function ( scope, element, attributes )
		{
			element[ 0 ].addEventListener( 'contextmenu', function ( event )
			{
				scope.$apply( function () { scope.$eval( attributes.onContextMenu, { $event: event } ); } );
			} );
		},
	};
} ] );
