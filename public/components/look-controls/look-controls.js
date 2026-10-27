'use strict';

// look-controls - the theme, the size, the margins, the editor and Confirm on close (plan UI Components, Step 5; the
// sidebar's bottom held the first three before; plan Markdown Editor, Step 4 added the last; plan UI Tweaks IX the
// margins): four selects and a checkbox in the title bar's look popover. The theme and the size go to ConsensusTheme
// (theme.js, which keeps them in the browser or the desktop's settings); the margins to State.SetMargins and the
// editor to State.SetEditor, each taking effect at once; Confirm on close to State.SetConfirmClose. The margins and the
// editor are the look the window's server keeps (plan Project settings, Step 2): shown only to whoever may change it
// (in the Desktop its user; on a Server the Administrator and the Managers).
//
// Interface:
//   <look-controls></look-controls>
//   reads ConsensusTheme.Get(), State.Margins, State.Editor and State.ConfirmClose; sets them through
//   ConsensusTheme.SetTheme, ConsensusTheme.SetScale, State.SetMargins, State.SetEditor and State.SetConfirmClose

angular.module( 'Consensus' ).component( 'lookControls', {
	templateUrl: '/components/look-controls/look-controls.html',
	controller: [ '$window', 'State', function ( $window, State )
	{
		let controller = this;
		let theme = $window.ConsensusTheme;
		controller.Theme = theme.Get().Theme;
		controller.Scale = theme.Get().Scale;
		controller.Palettes = theme.PALETTES;
		controller.Margins = State.Margins;
		controller.Editor = State.Editor;
		controller.ConfirmClose = State.ConfirmClose;


		controller.SetTheme = function ()
		{
			theme.SetTheme( controller.Theme );
		};


		controller.SetScale = function ()
		{
			theme.SetScale( controller.Scale );
		};


		controller.ViewWritable = function ()
		{
			return !!( $window.ConsensusStored && $window.ConsensusStored.ViewWritable() );
		};


		controller.SetMargins = function ()
		{
			State.SetMargins( controller.Margins );
		};


		controller.SetEditor = function ()
		{
			State.SetEditor( controller.Editor );
		};


		controller.SetConfirmClose = function ()
		{
			State.SetConfirmClose( controller.ConfirmClose );
		};
	} ],
} );
