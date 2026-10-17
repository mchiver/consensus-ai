'use strict';

// close-prompt - the one prompt before tabs with unsaved edits close (plan Markdown Editor, Step 4): the documents
// listed one per line (a stale one marked, since it cannot be saved), then Save, Discard and Cancel. Enter is
// Save, Escape Cancel. Shown while Closing.Prompt is set; the answer goes back through Closing.
//
// Interface:
//   <close-prompt></close-prompt>
//   reads Closing.Prompt; answers through Closing.Answer

angular.module( 'Consensus' ).component( 'closePrompt', {
	templateUrl: '/components/close-prompt/close-prompt.html',
	controller: [ 'Closing', function ( Closing )
	{
		let controller = this;
		controller.Closing = Closing;


		controller.Heading = function ()
		{
			let prompt = Closing.Prompt;
			if ( !prompt )
			{
				return '';
			}
			if ( prompt.Entries.length === 1 )
			{
				return '“' + prompt.Entries[ 0 ].Title + '” has unsaved changes';
			}
			return prompt.Entries.length + ' documents have unsaved changes';
		};


		// Save needs at least one draft that can be saved.
		controller.CanSave = function ()
		{
			let prompt = Closing.Prompt;
			return !!prompt && prompt.Entries.some( function ( entry ) { return !entry.Stale; } );
		};


		controller.Answer = function ( what )
		{
			Closing.Answer( what );
		};


		controller.Key = function ( event )
		{
			if ( event.key === 'Escape' )
			{
				event.preventDefault();
				Closing.Answer( 'cancel' );
			}
			else if ( event.key === 'Enter' && controller.CanSave() )
			{
				event.preventDefault();
				Closing.Answer( 'save' );
			}
		};
	} ],
} );
