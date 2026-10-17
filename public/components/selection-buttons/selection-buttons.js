'use strict';

// selection-buttons - the buttons under a selected passage (plan Markdown Editor, Step 2; html-view's own before):
// Copy (the text as it reads), Comment on it (Re-anchor here while a thread is being re-anchored) and, on a plan,
// Start a new Subplan. The host (the Read view's html-view, the CodeMirror editor's edit-view) finds the anchor,
// the text and the place and shows them; the component acts and says when it is done, so the host clears its
// selection.
//
// Interface:
//   <selection-buttons anchor="..." text="..." at="..." main="true" done="..."></selection-buttons>
//   anchor  { Text, Prefix, Suffix } when the selection can take a thread, else null: Copy alone is offered
//   text    the selected text as it reads
//   at      { Top, Left }, where to put them in the host's box; null hides them
//   main    present: the buttons carry the ids #copy-button, #comment-button, #subplan-button
//   done    called after an action
//   reads State.Open, State.Reanchoring; acts through State (the compose, the re-anchor), Client and Subplans

angular.module( 'Consensus' ).component( 'selectionButtons', {
	templateUrl: '/components/selection-buttons/selection-buttons.html',
	bindings: { anchor: '<', text: '<', at: '<', main: '@', done: '&' },
	controller: [ '$scope', '$element', '$timeout', 'State', 'Client', 'Subplans', function ( $scope, $element, $timeout, State, Client, Subplans )
	{
		const GAP = 6;
		let controller = this;
		controller.State = State;
		let buttons = null;


		function is_plan()
		{
			return !!State.Open && ( State.Open.Plan.Kind || 'plan' ) === 'plan';
		}


		// The buttons shown side by side from At, kept inside the host's width; none when At is null.
		function layout()
		{
			if ( !buttons )
			{
				return;
			}
			let shown = [];
			if ( controller.at )
			{
				shown.push( buttons.Copy );
				if ( controller.anchor )
				{
					shown.push( buttons.Comment );
					if ( is_plan() && !State.Reanchoring )
					{
						shown.push( buttons.Subplan );
					}
				}
			}
			for ( let one of [ buttons.Copy, buttons.Comment, buttons.Subplan ] )
			{
				one.classList.toggle( 'shown', shown.includes( one ) );
			}
			if ( !shown.length )
			{
				return;
			}
			let host = $element[ 0 ].parentElement;
			let width = host ? host.clientWidth : Infinity;
			let left = Math.max( 8, Math.min( controller.at.Left, width - buttons.Copy.offsetWidth - 16 ) );
			for ( let one of shown )
			{
				one.style.top = controller.at.Top + 'px';
				one.style.left = left + 'px';
				left += one.offsetWidth + GAP;
			}
		}


		controller.$postLink = function ()
		{
			let host = $element[ 0 ];
			buttons = {
				Copy: host.querySelector( '.copy-selection' ),
				Comment: host.querySelector( '.comment-selection' ),
				Subplan: host.querySelector( '.subplan-selection' ),
			};
			layout();
		};


		controller.$onChanges = function ()
		{
			$timeout( layout, 0, false );
		};


		function finish()
		{
			controller.done();
		}


		// Copy: the text as it reads, to the clipboard.
		controller.Copy = async function ()
		{
			let text = controller.text || '';
			try
			{
				await navigator.clipboard.writeText( text );
			}
			catch ( error )
			{
				document.execCommand( 'copy' );
			}
			finish();
		};


		// Comment: a thread on the passage; while a thread is being re-anchored, its new anchor.
		controller.Comment = async function ()
		{
			let anchor = controller.anchor;
			if ( !anchor )
			{
				return;
			}
			if ( State.Reanchoring )
			{
				let thread_id = State.Reanchoring;
				let answer = await State.Act( function ()
				{
					return Client.Post( '/api/plans/' + encodeURIComponent( State.OpenId ) + '/threads/' + thread_id + '/anchor', { Anchor: anchor } );
				} );
				finish();
				if ( answer )
				{
					State.CancelReanchor();
					await State.Reload();
					State.Select( thread_id );
				}
				$scope.$applyAsync();
				return;
			}
			finish();
			State.StartCompose( anchor );
		};


		controller.Subplan = function ()
		{
			let anchor = controller.anchor;
			if ( !anchor )
			{
				return;
			}
			finish();
			Subplans.FromSelection( anchor );
		};
	} ],
} );
