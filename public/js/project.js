'use strict';

// Project settings - a project's own settings in a popup (plan Run Shapes, Step 2; plan Project settings, Step 3): its
// Name, its States, Include, Exclude and Commands, one per line each, its Work options GitSync and AutoCommit, and on a
// Server the LLM connection and the tasks it enables (plan LLM Tasks, Step 1: the server's tasks with a checkbox each;
// all checked, the project keeps no list, so a task added later is on), saved through PUT /api/projects/:pid; the
// server's problems are shown and nothing is saved while there are any. In the Desktop (a project's own server, where
// GET /api/view says the look is kept with the project) it holds the look too (view-settings), saved through PUT
// /api/view; the Desktop's sidecar has no connections or tasks, so those rows are not shown there. On a Server the look
// is the Server's and never here. Opened from the project's menu (tree.js) with the 'project-settings' event, and in
// the Desktop's sidecar from Settings.

angular.module( 'Consensus' ).factory( 'ProjectSettings', [ function ()
{
	let panel = {
		Open: false,
		Project: null,
		Form: null,
		View: null,		// { Shape, Form, Start } when the look is kept with the project and may be changed
		Sidecar: false,
		Problems: [],
		Busy: false,
		Saved: false,
	};
	return panel;
} ] )


.controller( 'ProjectSettingsController', [ '$scope', 'State', 'Client', 'ProjectSettings', 'Roots', 'Llms', 'ViewForm', function ( $scope, State, Client, ProjectSettings, Roots, Llms, ViewForm )
{
	$scope.Panel = ProjectSettings;


	function root_of( project )
	{
		return Roots.Of( project.Root ) || State.Root;
	}


	// The server's tasks, each with whether the project enables it (no list: all).
	function tasks_form( project )
	{
		return ( Llms.For( root_of( project ) ).Tasks || [] ).map( function ( task )
		{
			return { Id: task.Id, Name: task.Name, Writes: task.Writes, Enabled: !Array.isArray( project.Tasks ) || project.Tasks.includes( task.Id ) };
		} );
	}


	// The server's connections for the picker, and the one the project chose while the server still has it (plan LLM
	// Tasks, Step 6).
	function llms_form( project )
	{
		return ( Llms.For( root_of( project ) ).Llms || [] ).map( function ( llm ) { return { Id: llm.Id, Name: llm.Name }; } );
	}


	function llm_form( project )
	{
		let chosen = Llms.ProjectLlm( root_of( project ), project );
		return chosen ? chosen.Id : null;
	}


	function to_form( project )
	{
		return {
			Name: project.Name || '',
			Tasks: tasks_form( project ),
			Llms: llms_form( project ),
			Llm: llm_form( project ),
			StatesText: ( project.States || [] ).join( '\n' ),
			IncludeText: ( project.Include || [] ).join( '\n' ),
			ExcludeText: ( project.Exclude || [] ).join( '\n' ),
			CommandsText: ( project.Commands || [] ).join( '\n' ),
			GitSync: project.GitSync === true,
			AutoCommit: project.AutoCommit === true,
		};
	}


	function lines_of( text )
	{
		return String( text || '' ).split( /\r?\n/ ).map( function ( line ) { return line.trim(); } ).filter( function ( line ) { return line; } );
	}


	// The look, when the project's server keeps it with the project and this page may change it.
	async function load_view( root )
	{
		ProjectSettings.View = null;
		try
		{
			let answer = await Client.Get( root, '/api/view' );
			if ( answer.Kept === 'project' && answer.Writable === true && answer.Shape )
			{
				ProjectSettings.View = { Shape: answer.Shape, Form: ViewForm.From( answer.View, answer.Shape ), Start: ViewForm.From( answer.View, answer.Shape ) };
			}
		}
		catch ( error )
		{
			// no look in the popup
		}
		$scope.$applyAsync();
	}


	$scope.$on( 'project-settings', function ( event, project )
	{
		if ( !project )
		{
			return;
		}
		let root = root_of( project );
		ProjectSettings.Project = project;
		ProjectSettings.Sidecar = !!( root && root.Sidecar );
		ProjectSettings.Form = to_form( project );
		ProjectSettings.View = null;
		ProjectSettings.Problems = [];
		ProjectSettings.Saved = false;
		ProjectSettings.Open = true;
		$scope.$applyAsync();
		load_view( root );
	} );


	$scope.Close = function ()
	{
		ProjectSettings.Open = false;
		ProjectSettings.Form = null;
		ProjectSettings.View = null;
		ProjectSettings.Project = null;
	};


	$scope.Key = function ( event )
	{
		if ( event.key === 'Escape' )
		{
			$scope.Close();
		}
	};


	$scope.Save = async function ()
	{
		if ( !ProjectSettings.Form || ProjectSettings.Busy )
		{
			return;
		}
		ProjectSettings.Busy = true;
		ProjectSettings.Problems = [];
		ProjectSettings.Saved = false;
		let form = ProjectSettings.Form;
		let body = { Name: form.Name, States: lines_of( form.StatesText ), Include: lines_of( form.IncludeText ), Exclude: lines_of( form.ExcludeText ), Commands: lines_of( form.CommandsText ), GitSync: form.GitSync === true, AutoCommit: form.AutoCommit === true };
		if ( !ProjectSettings.Sidecar )
		{
			let enabled = form.Tasks.filter( function ( task ) { return task.Enabled; } ).map( function ( task ) { return task.Id; } );
			body.Tasks = ( enabled.length === form.Tasks.length ) ? null : enabled;
			body.Llm = form.Llm || null;
		}
		let root = root_of( ProjectSettings.Project );
		try
		{
			let answer = await Client.Put( root, '/api/projects/' + encodeURIComponent( ProjectSettings.Project.Id ), body );
			answer.Project.Root = root.Key;
			ProjectSettings.Project = answer.Project;
			ProjectSettings.Form = to_form( answer.Project );
			let view = ProjectSettings.View;
			let changes = view ? ViewForm.Changes( view.Form, view.Start, view.Shape ) : {};
			if ( Object.keys( changes ).length )
			{
				let saved = await Client.Put( root, '/api/view', { View: changes } );
				view.Form = ViewForm.From( saved.View, view.Shape );
				view.Start = ViewForm.From( saved.View, view.Shape );
				await Roots.LoadMe( root );
			}
			ProjectSettings.Saved = true;
			await Roots.LoadList( root );
		}
		catch ( error )
		{
			ProjectSettings.Problems = ( error.Body && error.Body.Problems ) ? error.Body.Problems : [ ( error.Body && error.Body.Error ) || error.message ];
		}
		ProjectSettings.Busy = false;
		$scope.$applyAsync();
	};
} ] );
