'use strict';

// comment-editor - the plain-mode editor box of a reply or a new comment (plan UI Components, Step 1): markdown,
// word wrap, no line numbers, no anchors, no preview, no save. One Monaco instance per box, made when the box
// appears and disposed with it (Editor.Plain). Five lines high to start; the grip under it drags the height, which
// is remembered in the browser under one key for every box.
//
// Interface:
//   <comment-editor text="..." placeholder="..." autofocus="true" submit="..."></comment-editor>
//   text        two-way: the draft, edited in place
//   placeholder shown over the empty box
//   autofocus   present: the box takes the focus when it appears
//   submit      called on Ctrl+Enter in the box (the card's primary button)

angular.module( 'Consensus' ).component( 'commentEditor', {
	templateUrl: '/components/comment-editor/comment-editor.html',
	bindings: { text: '=', placeholder: '@', autofocus: '@', submit: '&' },
	controller: [ '$scope', '$element', 'Editor', function ( $scope, $element, Editor )
	{
		const HEIGHT_KEY = 'comment-height';
		const START_LINES = 5;
		const MINIMUM_LINES = 2;
		const PADDING = 12;
		let controller = this;
		let instance = null;
		let box = null;
		let line_height = 20;


		function recall_height()
		{
			let height = window.ConsensusStored.Read( HEIGHT_KEY, null, false );
			return ( typeof height === 'number' && height > 0 ) ? height : null;
		}


		function remember_height( height )
		{
			window.ConsensusStored.Write( HEIGHT_KEY, height, false );
		}


		function set_height( height )
		{
			let minimum = line_height * MINIMUM_LINES + PADDING;
			height = Math.max( minimum, Math.round( height ) );
			box.style.height = height + 'px';
			if ( instance )
			{
				instance.layout();
			}
			return height;
		}


		// The box's text changed under the keys: the draft follows at once, in a digest of its own unless one is
		// running (as ng-model does), so a button bound to the draft is enabled by the time the key is up.
		function on_change()
		{
			let value = instance.getValue();
			if ( value === controller.text )
			{
				return;
			}
			if ( $scope.$root.$$phase )
			{
				controller.text = value;
				return;
			}
			$scope.$apply( function ()
			{
				controller.text = value;
			} );
		}


		function on_submit()
		{
			$scope.$applyAsync( function ()
			{
				controller.submit();
			} );
		}


		// The grip: a pointer drag sets the height, remembered when the pointer is let go.
		function attach_grip( grip )
		{
			let start_y = 0;
			let start_height = 0;
			grip.addEventListener( 'pointerdown', function ( event )
			{
				start_y = event.clientY;
				start_height = box.offsetHeight;
				grip.setPointerCapture( event.pointerId );
				event.preventDefault();
			} );
			grip.addEventListener( 'pointermove', function ( event )
			{
				if ( !grip.hasPointerCapture( event.pointerId ) )
				{
					return;
				}
				set_height( start_height + ( event.clientY - start_y ) );
			} );
			grip.addEventListener( 'pointerup', function ( event )
			{
				if ( !grip.hasPointerCapture( event.pointerId ) )
				{
					return;
				}
				grip.releasePointerCapture( event.pointerId );
				remember_height( box.offsetHeight );
			} );
		}


		controller.$postLink = async function ()
		{
			box = $element[ 0 ].querySelector( '.comment-editor-box' );
			let grip = $element[ 0 ].querySelector( '.comment-editor-grip' );
			attach_grip( grip );
			instance = await Editor.Plain( box, controller.text || '', on_change, on_submit );
			if ( !box.isConnected )
			{
				// the box went away while Monaco loaded
				instance.dispose();
				instance = null;
				return;
			}
			line_height = instance.getOption( window.monaco.editor.EditorOption.lineHeight ) || line_height;
			set_height( recall_height() || ( line_height * START_LINES + PADDING ) );
			if ( controller.autofocus !== undefined )
			{
				instance.focus();
			}
		};


		// The draft changed from outside (cleared after a post, or set by a test): the box follows.
		$scope.$watch( function () { return controller.text; }, function ( value )
		{
			if ( instance && ( value || '' ) !== instance.getValue() )
			{
				instance.setValue( value || '' );
			}
		} );


		controller.$onDestroy = function ()
		{
			if ( instance )
			{
				instance.dispose();
				instance = null;
			}
		};
	} ],
} );
