'use strict';

// editor-header - the open item's heading (plan UI Components, Step 2), three lines. The first: the title (with
// its server when the page shows several) and the views: Read / Edit / Revisions in Monaco mode; in CodeMirror mode
// (plan Markdown Editor, Step 3) Source and Revisions, with Save and Discard, since the editor is the one view there. The second: the location, server / project
// / folders / parent plans / the item, the project and folder crumbs revealing their node in the tree, a parent
// plan's opening it. The third: the state picker and the one-line state, the revision and the text's size, then
// New Comment and New subplan. Delete is in the item's menu in the tree. Ctrl+E (hotkeys.js) switches between
// Edit and Read.
//
// Interface:
//   <editor-header></editor-header>
//   reads State.Open, State.View, State.Root, State.Projects, State.Editor, State.Source, State.Editing; sets the
//   view, the Source mode and the state through State, saves and discards through State.Editing; sends
//   reveal-node { Root, Project, Id } for the tree

angular.module( 'Consensus' ).component( 'editorHeader', {
	templateUrl: '/components/editor-header/editor-header.html',
	controller: [ '$scope', '$rootScope', 'State', 'Client', 'Subplans', 'Roots', function ( $scope, $rootScope, State, Client, Subplans, Roots )
	{
		let controller = this;
		controller.State = State;
		controller.Busy = false;
		controller.PickedState = null;
		let crumbs = { Key: null, List: [] };


		// The open item's server, named beside the title when the page shows several (plan Run Shapes, Step 5).
		controller.RootName = function ()
		{
			return ( Roots.Several() && State.Root ) ? State.Root.Name : '';
		};


		controller.SetView = function ( view )
		{
			State.SetView( view );
		};


		// CodeMirror mode: the editor is the one view; Source and Revisions, Save and Discard in the heading.
		controller.CodeMirror = function ()
		{
			return State.Editor === 'codemirror';
		};


		// Source on or off; from Revisions it also brings the editor back.
		controller.ToggleSource = function ()
		{
			State.SetSource( !State.Source );
			if ( State.View === 'revisions' )
			{
				State.SetView( 'read' );
			}
		};


		// Revisions beside the editor: pressed again, the editor comes back.
		controller.ToggleRevisions = function ()
		{
			State.SetView( State.View === 'revisions' ? 'read' : 'revisions' );
		};


		controller.CanSave = function ()
		{
			let editing = State.Editing;
			return !!editing && editing.Dirty && !editing.Stale && !editing.Busy && !controller.IsArchived() && State.MirrorShown();
		};


		controller.Save = function ()
		{
			if ( controller.CanSave() )
			{
				State.Editing.Save();
			}
		};


		// A plan has threads; a document has none.
		controller.HasThreads = function ()
		{
			return !!State.Open && State.Open.Plan.Kind !== 'document';
		};


		// A plan (not a document) takes Subplans.
		controller.IsPlan = function ()
		{
			return !!State.Open && ( State.Open.Plan.Kind || 'plan' ) === 'plan';
		};


		controller.NewSubplan = function ()
		{
			Subplans.Start();
		};


		// The open document is its project's Readme.
		controller.IsContext = function ()
		{
			return !!State.Open && !!State.Open.Context;
		};


		controller.CommentOnWhole = function ()
		{
			State.StartCompose( null );
		};


		// An archived plan (plan Run Shapes, Step 2) is read and never written until it is restored from the tree.
		controller.IsArchived = function ()
		{
			return !!( State.Open && State.Open.Plan && State.Open.Plan.Archived );
		};


		//-------------------------------------------------------------
		// The location: the way down the project's tree to the item, found again when the item or the lists change.

		function path_to( items, id, trail )
		{
			for ( let node of items || [] )
			{
				if ( node.Id === id )
				{
					return trail.concat( [ node ] );
				}
				if ( node.Items && node.Items.length )
				{
					let found = path_to( node.Items, id, trail.concat( [ node ] ) );
					if ( found )
					{
						return found;
					}
				}
			}
			return null;
		}


		function build_crumbs()
		{
			let list = [];
			if ( !State.Open || !State.Open.Project )
			{
				return list;
			}
			let project = State.Projects.find( function ( candidate ) { return candidate.Id === State.Open.Project.Id; } );
			if ( !project )
			{
				return list;
			}
			if ( Roots.Several() && State.Root )
			{
				list.push( { Kind: 'server', Label: State.Root.Name } );
			}
			list.push( { Kind: 'project', Label: project.Name, Project: project.Id, Id: project.Id } );
			let path = path_to( project.Items, State.OpenId, [] ) || [];
			for ( let node of path )
			{
				if ( node.Id === State.OpenId )
				{
					list.push( { Kind: 'item', Label: node.Title || node.Name } );
				}
				else if ( node.Kind === 'folder' )
				{
					list.push( { Kind: 'folder', Label: node.Name, Project: project.Id, Id: node.Id } );
				}
				else
				{
					list.push( { Kind: 'plan', Label: node.Title, Id: node.Id, Hash: Roots.HashFor( State.Root, '/p/' + node.Id ) } );
				}
			}
			return list;
		}


		controller.Crumbs = function ()
		{
			let key = [ State.OpenId, State.Open ? State.Open.Plan.Title : '', State.Projects, Roots.Several() ];
			let same = crumbs.Key && key.every( function ( part, index ) { return part === crumbs.Key[ index ]; } );
			if ( !same )
			{
				crumbs = { Key: key, List: build_crumbs() };
			}
			return crumbs.List;
		};


		// A project or folder crumb: the tree shows its node.
		controller.Reveal = function ( crumb )
		{
			$rootScope.$broadcast( 'reveal-node', { Root: State.Root, Project: crumb.Project, Id: crumb.Id } );
		};


		//-------------------------------------------------------------
		// The size of the text as saved: its characters, and about a quarter as many tokens.

		controller.Size = function ()
		{
			if ( !State.Open )
			{
				return '';
			}
			let characters = ( State.Open.Text || '' ).length;
			let tokens = Math.round( characters / 4 );
			return characters.toLocaleString() + ' chars, about ' + tokens.toLocaleString() + ' tokens';
		};


		//-------------------------------------------------------------
		// The state picker: any of the settings' States, by anyone, at any time.

		$scope.$watch( function () { return State.Open ? State.Open.Plan.State : null; }, function ( current )
		{
			controller.PickedState = current;
		} );


		// The project's States (the settings' when it has none; plan Run Shapes, Step 2), plus the plan's own when
		// the list no longer names it.
		controller.StateOptions = function ()
		{
			let states = State.States;
			let project = ( State.Open && State.Open.Project ) ? State.Projects.find( function ( candidate ) { return candidate.Id === State.Open.Project.Id; } ) : null;
			if ( project && Array.isArray( project.States ) && project.States.length )
			{
				states = project.States;
			}
			if ( !State.Open || states.includes( State.Open.Plan.State ) )
			{
				return states;
			}
			return states.concat( [ State.Open.Plan.State ] );
		};


		controller.SetState = async function ()
		{
			let wanted = controller.PickedState;
			if ( !State.Open || wanted === State.Open.Plan.State )
			{
				return;
			}
			controller.Busy = true;
			let answer = await State.Act( function ()
			{
				return Client.Put( '/api/plans/' + encodeURIComponent( State.OpenId ) + '/state', { State: wanted } );
			} );
			controller.Busy = false;
			if ( answer )
			{
				await State.Reload();
				State.LoadList();
			}
			else
			{
				controller.PickedState = State.Open ? State.Open.Plan.State : null;
			}
			$scope.$applyAsync();
		};
	} ],
} );
