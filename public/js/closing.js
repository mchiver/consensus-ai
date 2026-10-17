'use strict';

// Closing - the question asked before tabs with unsaved edits close (plan Markdown Editor, Step 4): one prompt for
// a tab's close, Close others, Close to the right, Close all and the desktop window's close alike, listing the
// documents that would lose their changes. The close-prompt component shows Prompt; whoever asked gets the answer.
//
//   Closing = { Prompt, Ask( Tabs ), Answer( What ) }
//   Prompt   null, or { Entries: [ { Tab, Title, Stale } ], Resolve }
//   Ask      the tabs holding a draft; a promise of 'save', 'discard' or 'cancel'. A draft made from an older
//            revision than the plan's is marked stale: it cannot be saved. A second Ask cancels the first.
//   Answer   the prompt's buttons and keys

angular.module( 'Consensus' ).factory( 'Closing', [ '$q', 'Roots', function ( $q, Roots )
{
	let closing = { Prompt: null };


	// A draft is stale when the plan moved on since it was made from.
	function stale_of( tab )
	{
		let root = Roots.Of( tab.Root || '' );
		let plan = root ? root.Plans.find( function ( candidate ) { return candidate.Id === tab.Id; } ) : null;
		return !!( plan && tab.Draft && plan.Revision !== tab.Draft.Base );
	}


	function Ask( Tabs )
	{
		if ( closing.Prompt )
		{
			closing.Prompt.Resolve( 'cancel' );
		}
		return $q( function ( resolve )
		{
			closing.Prompt = {
				Entries: Tabs.map( function ( tab ) { return { Tab: tab, Title: tab.Title || tab.Id, Stale: stale_of( tab ) }; } ),
				Resolve: resolve,
			};
		} );
	}


	function Answer( What )
	{
		let prompt = closing.Prompt;
		if ( !prompt )
		{
			return;
		}
		closing.Prompt = null;
		prompt.Resolve( What );
	}


	closing.Ask = Ask;
	closing.Answer = Answer;
	return closing;
} ] );
