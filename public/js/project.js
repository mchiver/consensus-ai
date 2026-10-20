'use strict';

// Project settings - a project's own States, Include, Exclude and Commands in a popup (plan Run Shapes, Step 2), one
// per line each, and the tasks it enables (plan LLM Tasks, Step 1: the server's tasks with a checkbox each; all
// checked, the project keeps no list, so a task added later is on), saved through PUT /api/projects/:pid; the server's problems are shown and nothing is saved while
// there are any. Opened from the project's menu (sidebar.js) with the 'project-settings' event.

angular.module( 'Consensus' ).factory( 'ProjectSettings', [ function ()
{
	let panel = {
		Open: false,
		Project: null,
		Form: null,
		Problems: [],
		Busy: false,
		Saved: false,
	};
	return panel;
} ] )


.controller( 'ProjectSettingsController', [ '$scope', 'State', 'Client', 'ProjectSettings', 'Roots', 'Llms', function ( $scope, State, Client, ProjectSettings, Roots, Llms )
{
	$scope.Panel = ProjectSettings;


	// The server's tasks, each with whether the project enables it (no list: all).
	function tasks_form( project )
	{
		let root = Roots.Of( project.Root ) || State.Root;
		return ( Llms.For( root ).Tasks || [] ).map( function ( task )
		{
			return { Id: task.Id, Name: task.Name, Writes: task.Writes, Enabled: !Array.isArray( project.Tasks ) || project.Tasks.includes( task.Id ) };
		} );
	}


	// The server's connections for the picker, and the one the project chose while the server still has it (plan LLM
	// Tasks, Step 6).
	function llms_form( project )
	{
		let root = Roots.Of( project.Root ) || State.Root;
		return ( Llms.For( root ).Llms || [] ).map( function ( llm ) { return { Id: llm.Id, Name: llm.Name }; } );
	}


	function llm_form( project )
	{
		let chosen = Llms.ProjectLlm( Roots.Of( project.Root ) || State.Root, project );
		return chosen ? chosen.Id : null;
	}


	function to_form( project )
	{
		return {
			Tasks: tasks_form( project ),
			Llms: llms_form( project ),
			Llm: llm_form( project ),
			StatesText: ( project.States || [] ).join( '\n' ),
			IncludeText: ( project.Include || [] ).join( '\n' ),
			ExcludeText: ( project.Exclude || [] ).join( '\n' ),
			CommandsText: ( project.Commands || [] ).join( '\n' ),
		};
	}


	function lines_of( text )
	{
		return String( text || '' ).split( /\r?\n/ ).map( function ( line ) { return line.trim(); } ).filter( function ( line ) { return line; } );
	}


	$scope.$on( 'project-settings', function ( event, project )
	{
		ProjectSettings.Project = project;
		ProjectSettings.Form = to_form( project );
		ProjectSettings.Problems = [];
		ProjectSettings.Saved = false;
		ProjectSettings.Open = true;
		$scope.$applyAsync();
	} );


	$scope.Close = function ()
	{
		ProjectSettings.Open = false;
		ProjectSettings.Form = null;
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
		let enabled = form.Tasks.filter( function ( task ) { return task.Enabled; } ).map( function ( task ) { return task.Id; } );
		let body = { States: lines_of( form.StatesText ), Include: lines_of( form.IncludeText ), Exclude: lines_of( form.ExcludeText ), Commands: lines_of( form.CommandsText ), Tasks: ( enabled.length === form.Tasks.length ) ? null : enabled, Llm: form.Llm || null };
		try
		{
			let root = Roots.Of( ProjectSettings.Project.Root ) || State.Root;
			let answer = await Client.Put( root, '/api/projects/' + encodeURIComponent( ProjectSettings.Project.Id ), body );
			answer.Project.Root = root.Key;
			ProjectSettings.Project = answer.Project;
			ProjectSettings.Form = to_form( answer.Project );
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
