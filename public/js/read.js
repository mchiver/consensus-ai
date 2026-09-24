'use strict';

// Read view - the rendered markdown with each anchored passage highlighted; a selection offers Comment
// (or Re-anchor here, while a thread is being re-anchored); clicking a highlight opens its thread.

angular.module( 'Consensus' ).controller( 'ReadController', [ '$scope', '$timeout', 'State', 'Render', 'Client', function ( $scope, $timeout, State, Render, Client )
{
	$scope.State = State;
	let view = document.getElementById( 'read-view' );
	let button = document.getElementById( 'comment-button' );
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
		Render.Show( view, State.Open.Text, State.Open.Threads, State.Selected );
	}


	function hide_button()
	{
		button.classList.remove( 'shown' );
		pending_anchor = null;
	}


	function offer_comment()
	{
		let anchor = Render.SelectionAnchor( view );
		if ( !anchor )
		{
			hide_button();
			return;
		}
		let range = window.getSelection().getRangeAt( 0 );
		let rect = range.getBoundingClientRect();
		let section_rect = section.getBoundingClientRect();
		let top = rect.bottom - section_rect.top + section.scrollTop + 6;
		let left = rect.left - section_rect.left + section.scrollLeft;
		left = Math.max( 8, Math.min( left, section.clientWidth - button.offsetWidth - 16 ) );
		button.style.top = top + 'px';
		button.style.left = left + 'px';
		button.classList.add( 'shown' );
		pending_anchor = anchor;
	}


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
				return Client.Post( '/api/proposals/' + encodeURIComponent( State.OpenId ) + '/threads/' + thread_id + '/anchor', { Anchor: anchor } );
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


	view.addEventListener( 'mouseup', function ()
	{
		$timeout( offer_comment, 0 );
	} );
	view.addEventListener( 'click', on_click );
	document.addEventListener( 'selectionchange', function ()
	{
		let selection = window.getSelection();
		if ( !selection || selection.isCollapsed )
		{
			hide_button();
		}
	} );

	// A search hit or a waiting item asked for a thread or a passage once the proposal is loaded.
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
	}


	$scope.$on( 'proposal-loaded', settle_pending );
	$scope.$on( 'thread-selected', function ( event, id )
	{
		show();
		Render.ScrollToThread( view, id );
	} );
	$scope.$on( 'compose-started', show );
} ] );
