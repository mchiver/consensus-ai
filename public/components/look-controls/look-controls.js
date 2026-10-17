'use strict';

// look-controls - the theme, the size and the editor (plan UI Components, Step 5; the sidebar's bottom held them
// before): three selects in the title bar's look popover. The theme and the size go to ConsensusTheme (theme.js,
// which keeps them in the browser or the desktop's settings); the editor goes to State.SetEditor, and the Edit view
// takes it when it next opens (Step 3).
//
// Interface:
//   <look-controls></look-controls>
//   reads ConsensusTheme.Get() and State.Editor; sets them through ConsensusTheme.SetTheme, ConsensusTheme.SetScale
//   and State.SetEditor

angular.module( 'Consensus' ).component( 'lookControls', {
	templateUrl: '/components/look-controls/look-controls.html',
	controller: [ '$window', 'State', function ( $window, State )
	{
		let controller = this;
		let theme = $window.ConsensusTheme;
		controller.Theme = theme.Get().Theme;
		controller.Scale = theme.Get().Scale;
		controller.Palettes = theme.PALETTES;
		controller.Editor = State.Editor;


		controller.SetTheme = function ()
		{
			theme.SetTheme( controller.Theme );
		};


		controller.SetScale = function ()
		{
			theme.SetScale( controller.Scale );
		};


		controller.SetEditor = function ()
		{
			State.SetEditor( controller.Editor );
		};
	} ],
} );
