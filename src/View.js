'use strict';

// View - the look (plan Project settings, Step 2): the margins, the highlight, the editor, the preview and Source mode,
// show-updated, the hidden panes and the pane widths. In the Desktop (a project's own server: the sidecar, or
// `consensus <folder>`) the look is the project's, project.json's View, shared with everyone who clones the project;
// on a Server it is the Server's, consensus.json's View, one for everyone on it, and a project's View is not read.
// The page reads it from /api/me and writes it through PUT /api/view; on a Server only the Administrator and the
// Managers write it. Each field is optional: the page's own default stands for a missing one.
//
//   View = { Margins: 'narrow' | 'normal' | 'wide', Highlight: 'all' | 'open', Editor: 'codemirror' | 'monaco',
//            PreviewHidden, Source, ThreadsHidden, TreeHidden, ShowUpdated: boolean,
//            SidebarWidth, ThreadsWidth, PreviewWidth: whole pixels from 160 to 900 }
//
//   Clean( Given ) -> { View, Problems }   the fields given, checked; an unknown field is a problem
//   Merge( View, Given ) -> { View, Problems }   the given fields over the view; null clears one

const CHOICES = {
	Margins: [ 'narrow', 'normal', 'wide' ],
	Highlight: [ 'all', 'open' ],
	Editor: [ 'codemirror', 'monaco' ],
};
const SWITCHES = [ 'PreviewHidden', 'Source', 'ThreadsHidden', 'TreeHidden', 'ShowUpdated' ];
const WIDTHS = [ 'SidebarWidth', 'ThreadsWidth', 'PreviewWidth' ];
const WIDTH_MINIMUM = 160;
const WIDTH_MAXIMUM = 900;
const FIELDS = Object.keys( CHOICES ).concat( SWITCHES, WIDTHS );


//---------------------------------------------------------------------
// One field's problem, or null when the value is good.

function problem_of( field, value )
{
	if ( CHOICES[ field ] )
	{
		return CHOICES[ field ].includes( value ) ? null : field + ' must be one of ' + CHOICES[ field ].join( ', ' );
	}
	if ( SWITCHES.includes( field ) )
	{
		return ( typeof value === 'boolean' ) ? null : field + ' must be true or false';
	}
	if ( WIDTHS.includes( field ) )
	{
		let good = Number.isInteger( value ) && value >= WIDTH_MINIMUM && value <= WIDTH_MAXIMUM;
		return good ? null : field + ' must be a whole number of pixels from ' + WIDTH_MINIMUM + ' to ' + WIDTH_MAXIMUM;
	}
	return 'View has no field ' + field;
}


//---------------------------------------------------------------------

function Clean( Given )
{
	let given = ( Given && typeof Given === 'object' && !Array.isArray( Given ) ) ? Given : {};
	let view = {};
	let problems = [];
	for ( let field of Object.keys( given ) )
	{
		let problem = problem_of( field, given[ field ] );
		if ( problem )
		{
			problems.push( problem );
			continue;
		}
		view[ field ] = given[ field ];
	}
	return { View: view, Problems: problems };
}


function Merge( View, Given )
{
	let given = ( Given && typeof Given === 'object' && !Array.isArray( Given ) ) ? Given : {};
	let kept = Clean( View ).View;
	let changes = {};
	for ( let field of Object.keys( given ) )
	{
		if ( given[ field ] === null && FIELDS.includes( field ) )
		{
			delete kept[ field ];
			continue;
		}
		changes[ field ] = given[ field ];
	}
	let clean = Clean( changes );
	return { View: Object.assign( kept, clean.View ), Problems: clean.Problems };
}


module.exports = {
	FIELDS: FIELDS,
	Clean: Clean,
	Merge: Merge,
};
