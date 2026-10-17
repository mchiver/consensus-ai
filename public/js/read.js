'use strict';

// Read view - the rendered markdown with each anchored passage highlighted (every thread's, or only the open ones'
// and the selected one's, as the Highlight picker says); a selection offers Copy (the text as it reads), Comment
// and, on a plan, Start a new Subplan (or Re-anchor here, while a thread is being re-anchored); clicking a highlight
// opens its thread, and a click off any highlight deselects it (plan UI Tweaks VI).

angular.module( 'Consensus' ).controller( 'ReadController', [ '$scope', '$timeout', 'State', 'Render', 'Client', 'Subplans', function ( $scope, $timeout, State, Render, Client, Subplans )
{
	$scope.State = State;
	let view = document.getElementById( 'read-view' );
	let button = document.getElementById( 'comment-button' );
	let subplan_button = document.getElementById( 'subplan-button' );
	let copy_button = document.getElementById( 'copy-button' );
	let section = view.parentNode;
	let pending_anchor = null;


	function show()
	{
		hide_button();
		if ( !State.Open )
		{
			view.innerHTML = '';
			return;
		}
		Render.Show( view, State.Open.Text, highlighted(), State.Selected );
	}


	function highlighted()
	{
		if ( State.Highlight !== 'open' )
		{
			return State.Open.Threads;
		}
		return State.Open.Threads.filter( function ( thread )
		{
			return thread.Status === 'contested' || thread.Id === State.Selected;
		} );
	}


	function hide_button()
	{
		button.classList.remove( 'shown' );
		subplan_button.classList.remove( 'shown' );
		copy_button.classList.remove( 'shown' );
		pending_anchor = null;
	}


	// The selection, when it is some of the view's text; else null.
	function view_selection()
	{
		let selection = window.getSelection();
		if ( !State.Open || !selection || selection.isCollapsed || selection.rangeCount === 0 )
		{
			return null;
		}
		let range = selection.getRangeAt( 0 );
		if ( !view.contains( range.commonAncestorContainer ) )
		{
			return null;
		}
		return selection;
	}


	// The buttons under a selection: Copy always; Comment (or Re-anchor here) when the selection anchors, on a plan;
	// Start a new Subplan on a plan that is not being re-anchored.
	function offer_comment()
	{
		let selection = view_selection();
		if ( !selection )
		{
			hide_button();
			return;
		}
		let is_document = State.Open.Plan.Kind === 'document';
		let anchor = is_document ? null : Render.SelectionAnchor( view );
		let rect = selection.getRangeAt( 0 ).getBoundingClientRect();
		let section_rect = section.getBoundingClientRect();
		let top = rect.bottom - section_rect.top + section.scrollTop + 6;
		let left = rect.left - section_rect.left + section.scrollLeft;
		left = Math.max( 8, Math.min( left, section.clientWidth - copy_button.offsetWidth - 16 ) );
		let shown = [ copy_button ];
		pending_anchor = anchor;
		if ( anchor )
		{
			shown.push( button );
			let is_plan = ( State.Open.Plan.Kind || 'plan' ) === 'plan';
			if ( is_plan && !State.Reanchoring )
			{
				shown.push( subplan_button );
			}
		}
		else
		{
			button.classList.remove( 'shown' );
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
	$scope.CopySelection = async function ()
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
		hide_button();
	};


	$scope.SubplanFromSelection = function ()
	{
		if ( !pending_anchor )
		{
			return;
		}
		let anchor = pending_anchor;
		window.getSelection().removeAllRanges();
		hide_button();
		Subplans.FromSelection( anchor );
	};


	$scope.CommentOnSelection = async function ()
	{
		if ( !pending_anchor )
		{
			return;
		}
		let anchor = pending_anchor;
		window.getSelection().removeAllRanges();
		hide_button();
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


	$scope.CancelReanchor = function ()
	{
		State.CancelReanchor();
	};


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


	// A click in the read view off any highlight deselects the thread: not one that ends a selection (its buttons
	// stay), not on those buttons, and not while a thread is being re-anchored.
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


	view.addEventListener( 'mouseup', function ()
	{
		$timeout( offer_comment, 0 );
	} );
	view.addEventListener( 'click', on_click );
	section.addEventListener( 'click', on_blank_click );
	document.addEventListener( 'selectionchange', function ()
	{
		let selection = window.getSelection();
		if ( !selection || selection.isCollapsed )
		{
			hide_button();
		}
	} );

	// A search hit or a waiting item asked for a thread or a passage once the plan is loaded.
	function settle_pending()
	{
		show();
		let pending = State.Pending;
		if ( !pending || !State.Open )
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
			Render.ScrollToText( view, pending.Scroll );
		}
		else if ( pending.Compose )
		{
			State.StartCompose( null );
		}
	}


	$scope.$on( 'plan-loaded', settle_pending );
	$scope.$on( 'thread-selected', function ( event, id )
	{
		show();
		Render.ScrollToThread( view, id );
	} );
	$scope.$on( 'compose-started', show );
	$scope.$on( 'highlight-changed', show );
	$scope.$on( 'filter-changed', show );
} ] );
