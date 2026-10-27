'use strict';

// view-settings - the look as a form (plan Project settings, Step 3): the margins, the highlight and the editor as
// selects, the hidden panes, Source and show-updated as checkboxes, the pane widths as whole pixels (empty: the page's
// own). Shown in the Desktop's project settings (the project's View) and in a Server's settings (the Server's View);
// the popup that holds it saves it through PUT /api/view. The fields, their choices and defaults come from GET
// /api/view's Shape (src/View.js).
//
// Interface:
//   <view-settings form="..." shape="..."></view-settings>
//   form    the look as ViewForm.From made it, changed in place
//   shape   the Shape GET /api/view answered
//
//   ViewForm.From( View, Shape ) -> form       every field filled: a choice's default, false, or null for a width
//   ViewForm.Body( form, Shape ) -> View       every field for PUT /api/view: an empty width null (the page's own)
//   ViewForm.Changes( form, Start, Shape )     the fields changed since Start, for PUT /api/view

angular.module( 'Consensus' ).factory( 'ViewForm', [ function ()
{
	function From( View, Shape )
	{
		let view = View || {};
		let form = {};
		for ( let field of Object.keys( Shape.Choices ) )
		{
			form[ field ] = Shape.Choices[ field ].includes( view[ field ] ) ? view[ field ] : Shape.Defaults[ field ];
		}
		for ( let field of Shape.Switches )
		{
			form[ field ] = ( view[ field ] === true );
		}
		for ( let field of Shape.Widths )
		{
			form[ field ] = Number.isInteger( view[ field ] ) ? view[ field ] : null;
		}
		return form;
	}


	function Body( Form, Shape )
	{
		let body = {};
		for ( let field of Object.keys( Shape.Choices ) )
		{
			body[ field ] = Form[ field ];
		}
		for ( let field of Shape.Switches )
		{
			body[ field ] = ( Form[ field ] === true );
		}
		for ( let field of Shape.Widths )
		{
			let given = Form[ field ];
			body[ field ] = ( given === '' || given === null || given === undefined ) ? null : Number( given );
		}
		return body;
	}


	// The fields the form changed since Start (a form From made), for PUT /api/view; none, an empty object.
	function Changes( Form, Start, Shape )
	{
		let now = Body( Form, Shape );
		let then = Body( Start, Shape );
		let changes = {};
		for ( let field of Object.keys( now ) )
		{
			if ( now[ field ] !== then[ field ] )
			{
				changes[ field ] = now[ field ];
			}
		}
		return changes;
	}


	return { From: From, Body: Body, Changes: Changes };
} ] )


.component( 'viewSettings', {
	templateUrl: '/components/view-settings/view-settings.html',
	bindings: {
		form: '<',
		shape: '<',
	},
	controller: [ function ()
	{
		let controller = this;
		const LABELS = {
			Margins: 'Margins',
			Highlight: 'Highlight',
			Editor: 'Editor',
			PreviewHidden: 'Preview hidden',
			Source: 'Source mode',
			ThreadsHidden: 'Threads hidden',
			TreeHidden: 'Tree hidden',
			ShowUpdated: 'Show updated',
			SidebarWidth: 'Sidebar',
			ThreadsWidth: 'Threads',
			PreviewWidth: 'Preview',
		};


		controller.Label = function ( field )
		{
			return LABELS[ field ] || field;
		};


		controller.ChoiceFields = function ()
		{
			return controller.shape ? Object.keys( controller.shape.Choices ) : [];
		};
	} ],
} );
