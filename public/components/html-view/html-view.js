'use strict';

// html-view - the rendered markdown (plan UI Components, Step 2): the text through marked, and with anchors on,
// each thread's anchored passage highlighted (every thread's, or only the open ones' and the selected one's, as the
// Highlight picker says), a click on a highlight selecting its thread, and a selection offering Copy (the text as
// it reads), Comment (or Re-anchor here while a thread is being re-anchored) and, on a plan, Start a new Subplan.
// The main one (the Read view's) also settles what a search hit or a waiting item asked for once the plan is
// loaded, scrolls to the selected thread's passage, and deselects the thread on a click off any highlight.
//
// Interface:
//   <html-view text="..." anchors="..." main="true"></html-view>
//   text     the markdown to show
//   anchors  true: the threads' highlights and the selection buttons (Copy is offered either way)
//   main     present: the Read view's one (the pending select or scroll, the scroll to a selected thread, the
//            deselecting click), and the buttons carry the ids #copy-button, #comment-button, #subplan-button
//   reads State.Open, State.Selected, State.Highlight, State.Reanchoring; listens to plan-loaded, thread-selected,
//   compose-started, highlight-changed, filter-changed

angular.module( 'Consensus' ).component( 'htmlView', {
	templateUrl: '/components/html-view/html-view.html',
	bindings: { text: '<', anchors: '<', main: '@' },
	controller: [ '$scope', '$element', '$timeout', 'State', 'Render', 'Client', 'Subplans', 'Threads', function ( $scope, $element, $timeout, State, Render, Client, Subplans, Threads )
	{
		let controller = this;
		controller.State = State;
		let host = $element[ 0 ];
		let article = null;
		let copy_button = null;
		let comment_button = null;
		let subplan_button = null;
		let pending_anchor = null;


		function is_main()
		{
			return !!controller.main;
		}


		function highlighted()
		{
			return controller.anchors ? Threads.Highlighted() : [];
		}


		function show()
		{
			hide_buttons();
			if ( !article )
			{
				return;
			}
			Render.Show( article, controller.text || '', highlighted(), State.Selected );
		}


		function hide_buttons()
		{
			if ( !copy_button )
			{
				return;
			}
			copy_button.classList.remove( 'shown' );
			comment_button.classList.remove( 'shown' );
			subplan_button.classList.remove( 'shown' );
			pending_anchor = null;
		}


		// The selection, when it is some of this view's text; else null.
		function view_selection()
		{
			let selection = window.getSelection();
			if ( !State.Open || !selection || selection.isCollapsed || selection.rangeCount === 0 )
			{
				return null;
			}
			let range = selection.getRangeAt( 0 );
			if ( !article.contains( range.commonAncestorContainer ) )
			{
				return null;
			}
			return selection;
		}


		// The buttons under a selection: Copy always; Comment (or Re-anchor here) when the selection anchors, on a
		// plan with anchors on; Start a new Subplan on a plan that is not being re-anchored.
		function offer_buttons()
		{
			let selection = view_selection();
			if ( !selection )
			{
				hide_buttons();
				return;
			}
			let is_document = State.Open.Plan.Kind === 'document';
			let anchor = ( is_document || !controller.anchors ) ? null : Render.SelectionAnchor( article );
			let rect = selection.getRangeAt( 0 ).getBoundingClientRect();
			let host_rect = host.getBoundingClientRect();
			let top = rect.bottom - host_rect.top + 6;
			let left = rect.left - host_rect.left;
			left = Math.max( 8, Math.min( left, host.clientWidth - copy_button.offsetWidth - 16 ) );
			let shown = [ copy_button ];
			pending_anchor = anchor;
			if ( anchor )
			{
				shown.push( comment_button );
				let is_plan = ( State.Open.Plan.Kind || 'plan' ) === 'plan';
				if ( is_plan && !State.Reanchoring )
				{
					shown.push( subplan_button );
				}
			}
			else
			{
				comment_button.classList.remove( 'shown' );
				subplan_button.classList.remove( 'shown' );
			}
			for ( let one of shown )
			{
				one.style.top = top + 'px';
				one.style.left = left + 'px';
				one.classList.add( 'shown' );
				left += one.offsetWidth + 6;
			}
		}


		// Copy: the selected text as it reads, to the clipboard; the selection is cleared, as after Comment.
		controller.CopySelection = async function ()
		{
			let selection = view_selection();
			if ( !selection )
			{
				return;
			}
			let text = selection.toString();
			try
			{
				await navigator.clipboard.writeText( text );
			}
			catch ( error )
			{
				document.execCommand( 'copy' );
			}
			window.getSelection().removeAllRanges();
			hide_buttons();
		};


		controller.SubplanFromSelection = function ()
		{
			if ( !pending_anchor )
			{
				return;
			}
			let anchor = pending_anchor;
			window.getSelection().removeAllRanges();
			hide_buttons();
			Subplans.FromSelection( anchor );
		};


		controller.CommentOnSelection = async function ()
		{
			if ( !pending_anchor )
			{
				return;
			}
			let anchor = pending_anchor;
			window.getSelection().removeAllRanges();
			hide_buttons();
			if ( State.Reanchoring )
			{
				let thread_id = State.Reanchoring;
				let answer = await State.Act( function ()
				{
					return Client.Post( '/api/plans/' + encodeURIComponent( State.OpenId ) + '/threads/' + thread_id + '/anchor', { Anchor: anchor } );
				} );
				if ( answer )
				{
					State.CancelReanchor();
					await State.Reload();
					State.Select( thread_id );
				}
				$scope.$applyAsync();
				return;
			}
			State.StartCompose( anchor );
		};


		// A click on a highlight selects its thread; on a passage of several, the next one each time.
		function on_click( event )
		{
			let mark = event.target.closest( 'mark.anchor' );
			if ( !mark )
			{
				return;
			}
			let selection = window.getSelection();
			if ( selection && !selection.isCollapsed )
			{
				return;
			}
			let ids = mark.dataset.threads.split( ' ' );
			let id = ids[ ids.length - 1 ];
			if ( ids.includes( State.Selected ) )
			{
				let index = ids.indexOf( State.Selected );
				id = ids[ ( index + 1 ) % ids.length ];
			}
			$scope.$applyAsync( function ()
			{
				State.Select( id );
				let card = document.getElementById( 'thread-' + id );
				if ( card )
				{
					card.scrollIntoView( { block: 'nearest', behavior: 'smooth' } );
				}
			} );
		}


		// A click in the view's pane off any highlight deselects the thread: not one that ends a selection (its
		// buttons stay), not on those buttons, and not while a thread is being re-anchored.
		function on_blank_click( event )
		{
			if ( event.target.closest( 'mark.anchor' ) || event.target.closest( '.comment-button' ) || event.target.closest( '.reanchor-hint' ) )
			{
				return;
			}
			let selection = window.getSelection();
			if ( selection && !selection.isCollapsed )
			{
				return;
			}
			if ( State.Reanchoring || !State.Selected )
			{
				return;
			}
			$scope.$applyAsync( function ()
			{
				State.Select( null );
			} );
		}


		// A search hit or a waiting item asked for a thread or a passage once the plan is loaded.
		function settle_pending()
		{
			show();
			let pending = State.Pending;
			if ( !pending || !State.Open || !is_main() )
			{
				return;
			}
			State.Pending = null;
			if ( pending.Select )
			{
				State.Select( pending.Select );
				let card = document.getElementById( 'thread-' + pending.Select );
				if ( card )
				{
					card.scrollIntoView( { block: 'nearest', behavior: 'smooth' } );
				}
			}
			else if ( pending.Scroll )
			{
				Render.ScrollToText( article, pending.Scroll );
			}
			else if ( pending.Compose )
			{
				State.StartCompose( null );
			}
		}


		controller.$postLink = function ()
		{
			article = host.querySelector( 'article' );
			copy_button = host.querySelector( '.copy-selection' );
			comment_button = host.querySelector( '.comment-selection' );
			subplan_button = host.querySelector( '.subplan-selection' );
			host.addEventListener( 'mouseup', function ()
			{
				$timeout( offer_buttons, 0 );
			} );
			host.addEventListener( 'click', on_click );
			if ( is_main() && host.parentNode )
			{
				host.parentNode.addEventListener( 'click', on_blank_click );
			}
			show();
		};


		controller.$onChanges = function ()
		{
			show();
		};


		function on_selection_change()
		{
			let selection = window.getSelection();
			if ( !selection || selection.isCollapsed )
			{
				hide_buttons();
			}
		}

		document.addEventListener( 'selectionchange', on_selection_change );

		controller.$onDestroy = function ()
		{
			document.removeEventListener( 'selectionchange', on_selection_change );
		};


		$scope.$on( 'plan-loaded', settle_pending );
		$scope.$on( 'thread-selected', function ( event, id )
		{
			show();
			if ( is_main() && article )
			{
				Render.ScrollToThread( article, id );
			}
		} );
		$scope.$on( 'compose-started', show );
		$scope.$on( 'highlight-changed', show );
		$scope.$on( 'filter-changed', show );
	} ],
} );
