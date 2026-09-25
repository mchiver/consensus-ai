'use strict';

// Sidebar - the project tree: one project open at a time, its folders and items with their tallies;
// new project, plan and folder, rename and delete; the search box, the waiting count, Trash at the bottom,
// and the LLM's tokens today. Items move by drag and drop and copy by copy and paste.

const DRAG_TYPE = 'application/x-consensus-item';

angular.module( 'Consensus' ).controller( 'SidebarController', [ '$scope', '$window', 'State', 'Client', function ( $scope, $window, State, Client )
{
	const OPEN_PROJECT_KEY = 'consensus.project';
	const FOLDED_KEY = 'consensus.folded';

	$scope.State = State;
	$scope.Creating = null;
	$scope.Renaming = null;
	$scope.Deleting = null;
	$scope.Target = null;
	$scope.ShowingTrash = false;
	$scope.Trash = [];
	$scope.Query = '';
	$scope.Usage = null;
	$scope.Theme = window.ConsensusTheme.Get().Theme;
	$scope.Scale = window.ConsensusTheme.Get().Scale;
	$scope.OpenProjectId = read_stored( OPEN_PROJECT_KEY, 'default' );
	let folded = read_stored( FOLDED_KEY, [] );


	//-----------------------------------------------------------------
	// Remembered in this browser only; a blocked or empty storage falls back to the default.

	function read_stored( key, fallback )
	{
		try
		{
			let value = window.localStorage.getItem( key );
			return ( value === null ) ? fallback : JSON.parse( value );
		}
		catch ( error )
		{
			return fallback;
		}
	}


	function write_stored( key, value )
	{
		try
		{
			window.localStorage.setItem( key, JSON.stringify( value ) );
		}
		catch ( error )
		{
			// not remembered; nothing else depends on it
		}
	}


	//-----------------------------------------------------------------
	// Search, waiting, theme

	// The search box searches the open project; with none open, everything.
	$scope.Search = function ()
	{
		let query = ( $scope.Query || '' ).trim();
		if ( !query )
		{
			return;
		}
		let project = $scope.OpenProject();
		let prefix = project ? encodeURIComponent( project.Id ) + '/' : '';
		$window.location.hash = '#/search/' + prefix + encodeURIComponent( query );
	};


	$scope.OpenProject = function ()
	{
		return State.Projects.find( function ( project ) { return project.Id === $scope.OpenProjectId; } ) || null;
	};


	$scope.SearchPlaceholder = function ()
	{
		let project = $scope.OpenProject();
		return project ? 'Search ' + project.Name : 'Search everything';
	};


	$scope.WaitingCount = function ()
	{
		let count = 0;
		let name = State.Me ? State.Me.Name : null;
		for ( let proposal of State.Proposals )
		{
			count += ( proposal.Tally.WaitingOn[ name ] || 0 );
		}
		return count;
	};


	$scope.SetTheme = function ()
	{
		window.ConsensusTheme.SetTheme( $scope.Theme );
	};


	$scope.SetScale = function ()
	{
		window.ConsensusTheme.SetScale( $scope.Scale );
	};


	//-----------------------------------------------------------------
	// The tree: one project open at a time; folders fold on their own.

	$scope.IsOpen = function ( project )
	{
		return project.Id === $scope.OpenProjectId;
	};


	$scope.ToggleProject = function ( project )
	{
		$scope.OpenProjectId = $scope.IsOpen( project ) ? null : project.Id;
		write_stored( OPEN_PROJECT_KEY, $scope.OpenProjectId );
		$scope.Creating = null;
		$scope.Renaming = null;
		$scope.Deleting = null;
		if ( $scope.Target && $scope.Target.Project !== $scope.OpenProjectId )
		{
			$scope.Target = null;
		}
	};


	// Opening a proposal opens the project that holds it.
	$scope.$watch( function () { return ( State.Open && State.Open.Project ) ? State.Open.Project.Id : null; }, function ( project_id )
	{
		if ( project_id && project_id !== $scope.OpenProjectId )
		{
			$scope.OpenProjectId = project_id;
			write_stored( OPEN_PROJECT_KEY, project_id );
		}
	} );


	$scope.IsFolded = function ( node )
	{
		return folded.includes( node.Id );
	};


	$scope.ToggleFold = function ( node, event )
	{
		event.stopPropagation();
		if ( folded.includes( node.Id ) )
		{
			folded = folded.filter( function ( id ) { return id !== node.Id; } );
		}
		else
		{
			folded = folded.concat( [ node.Id ] );
		}
		write_stored( FOLDED_KEY, folded );
	};


	// A folder picked as where new items go; picking it again goes back to the project's root.
	$scope.PickFolder = function ( project, node )
	{
		if ( $scope.IsTarget( node ) )
		{
			$scope.Target = null;
			return;
		}
		$scope.Target = { Project: project.Id, Folder: node.Id, Name: node.Name };
	};


	$scope.IsTarget = function ( node )
	{
		return !!$scope.Target && $scope.Target.Folder === node.Id;
	};


	function parent_in( project )
	{
		return ( $scope.Target && $scope.Target.Project === project.Id ) ? $scope.Target.Folder : null;
	}


	$scope.ItemCount = function ( items )
	{
		let count = 0;
		for ( let node of items )
		{
			count += ( node.Kind === 'folder' ) ? $scope.ItemCount( node.Items ) : 1;
		}
		return count;
	};


	//-----------------------------------------------------------------
	// Creating: { Kind: 'project' | 'plan' | 'document' | 'folder', Project?, Parent?, Name }

	$scope.StartCreate = function ( kind, project, event )
	{
		if ( event )
		{
			event.stopPropagation();
		}
		$scope.Renaming = null;
		$scope.Deleting = null;
		$scope.Creating = { Kind: kind, Project: project ? project.Id : null, Parent: project ? parent_in( project ) : null, Name: '' };
	};


	$scope.CancelCreate = function ()
	{
		$scope.Creating = null;
	};


	$scope.CreatePlaceholder = function ()
	{
		if ( !$scope.Creating )
		{
			return '';
		}
		let where = ( $scope.Creating.Parent && $scope.Target ) ? ' in ' + $scope.Target.Name : '';
		switch ( $scope.Creating.Kind )
		{
			case 'project': return 'Project name';
			case 'folder': return 'Folder name' + where;
			case 'document': return 'Document title' + where;
			default: return 'Plan title' + where;
		}
	};


	$scope.Create = async function ()
	{
		let creating = $scope.Creating;
		let name = ( creating && creating.Name || '' ).trim();
		if ( !name )
		{
			return;
		}
		let answer = await State.Act( function ()
		{
			if ( creating.Kind === 'project' )
			{
				return Client.Post( '/api/projects', { Name: name } );
			}
			if ( creating.Kind === 'folder' )
			{
				return Client.Post( '/api/projects/' + encodeURIComponent( creating.Project ) + '/folders', { Name: name, Parent: creating.Parent } );
			}
			let kind = ( creating.Kind === 'document' ) ? 'document' : 'plan';
			return Client.Post( '/api/proposals', { Title: name, Text: '# ' + name + '\n\n', Kind: kind, Project: creating.Project, Parent: creating.Parent } );
		} );
		if ( answer )
		{
			$scope.Creating = null;
			if ( creating.Kind === 'project' )
			{
				$scope.OpenProjectId = answer.Project.Id;
				write_stored( OPEN_PROJECT_KEY, answer.Project.Id );
				$scope.Target = null;
			}
			if ( creating.Kind === 'plan' || creating.Kind === 'document' )
			{
				$window.location.hash = '#/p/' + encodeURIComponent( answer.Proposal.Id );
			}
			await State.LoadList();
		}
		$scope.$applyAsync();
	};


	//-----------------------------------------------------------------
	// A zip uploaded into a project (the picked folder, or its root) becomes a corpus item, opened once indexed.

	$scope.Uploading = false;

	$scope.UploadZip = async function ( project, File )
	{
		let name = File.name.replace( /\.zip$/i, '' ) || 'corpus';
		let path = '/api/projects/' + encodeURIComponent( project.Id ) + '/corpus?name=' + encodeURIComponent( name );
		let parent = parent_in( project );
		if ( parent )
		{
			path += '&parent=' + encodeURIComponent( parent );
		}
		$scope.Uploading = true;
		let answer = await State.Act( function () { return Client.Upload( 'POST', path, File ); } );
		$scope.Uploading = false;
		if ( answer )
		{
			await State.LoadList();
			$window.location.hash = '#/c/' + encodeURIComponent( answer.Corpus.Id );
		}
		$scope.$applyAsync();
	};


	//-----------------------------------------------------------------
	// Renaming: { Kind: 'project' | 'folder', Project, Id, Name }

	$scope.StartRename = function ( kind, project, node, event )
	{
		event.stopPropagation();
		$scope.Creating = null;
		$scope.Deleting = null;
		$scope.Renaming = { Kind: kind, Project: project.Id, Id: node.Id, Name: node.Name };
	};


	$scope.IsRenaming = function ( node )
	{
		return !!$scope.Renaming && $scope.Renaming.Id === node.Id;
	};


	$scope.CancelRename = function ()
	{
		$scope.Renaming = null;
	};


	$scope.Rename = async function ()
	{
		let renaming = $scope.Renaming;
		let name = ( renaming && renaming.Name || '' ).trim();
		if ( !name )
		{
			return;
		}
		let path = '/api/projects/' + encodeURIComponent( renaming.Project );
		if ( renaming.Kind === 'folder' )
		{
			path += '/folders/' + encodeURIComponent( renaming.Id );
		}
		let answer = await State.Act( function () { return Client.Put( path, { Name: name } ); } );
		if ( answer )
		{
			$scope.Renaming = null;
			await State.LoadList();
		}
		$scope.$applyAsync();
	};


	//-----------------------------------------------------------------
	// Deleting an empty project or folder, confirmed inline.

	$scope.StartDelete = function ( node, event )
	{
		event.stopPropagation();
		$scope.Creating = null;
		$scope.Renaming = null;
		$scope.Deleting = node.Id;
	};


	$scope.CancelDelete = function ( event )
	{
		event.stopPropagation();
		$scope.Deleting = null;
	};


	$scope.Delete = async function ( kind, project, node, event )
	{
		event.stopPropagation();
		let path = '/api/projects/' + encodeURIComponent( project.Id );
		if ( kind === 'folder' )
		{
			path += '/folders/' + encodeURIComponent( node.Id );
		}
		let answer = await State.Act( function () { return Client.Delete( path ); } );
		$scope.Deleting = null;
		if ( answer )
		{
			if ( $scope.Target && ( $scope.Target.Folder === node.Id || $scope.Target.Project === node.Id ) )
			{
				$scope.Target = null;
			}
			await State.LoadList();
		}
		$scope.$applyAsync();
	};


	//-----------------------------------------------------------------
	// Move: an item dropped on a project (its root) or a folder. Target = { Project, Parent }

	$scope.MoveItem = async function ( id, target )
	{
		if ( id === target.Parent )
		{
			return;
		}
		let answer = await State.Act( function ()
		{
			return Client.Post( '/api/items/' + encodeURIComponent( id ) + '/move', { Project: target.Project, Parent: target.Parent } );
		} );
		if ( answer )
		{
			await State.LoadList();
		}
		$scope.$applyAsync();
	};


	//-----------------------------------------------------------------
	// Copy and paste: the copy button or Ctrl+C takes an item; a paste button or Ctrl+V puts a whole copy of it
	// into a project's root or a folder.

	$scope.Clipboard = null;

	$scope.CopyItem = function ( node, event )
	{
		if ( event )
		{
			event.preventDefault();
			event.stopPropagation();
		}
		$scope.Clipboard = { Id: node.Id, Name: node.Name || node.Title };
	};


	$scope.ClearClipboard = function ()
	{
		$scope.Clipboard = null;
	};


	$scope.Paste = async function ( project, folder, event )
	{
		if ( event )
		{
			event.stopPropagation();
		}
		let clipboard = $scope.Clipboard;
		if ( !clipboard )
		{
			return;
		}
		let answer = await State.Act( function ()
		{
			return Client.Post( '/api/items/' + encodeURIComponent( clipboard.Id ) + '/copy', { Project: project.Id, Parent: folder ? folder.Id : null } );
		} );
		if ( answer )
		{
			$scope.OpenProjectId = project.Id;
			write_stored( OPEN_PROJECT_KEY, project.Id );
			await State.LoadList();
		}
		$scope.$applyAsync();
	};


	// The keys work on the open item and the open project, and leave typing, the editor and selected text alone.
	function is_typing()
	{
		let active = document.activeElement;
		if ( !active )
		{
			return false;
		}
		let tag = active.tagName;
		return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || active.isContentEditable || !!active.closest( '.monaco-editor' );
	}


	function on_key( event )
	{
		if ( !( event.ctrlKey || event.metaKey ) || event.altKey || event.shiftKey || is_typing() )
		{
			return;
		}
		let key = event.key.toLowerCase();
		let selection = window.getSelection();
		if ( key === 'c' && State.Open && ( !selection || selection.isCollapsed ) )
		{
			$scope.$applyAsync( function ()
			{
				$scope.Clipboard = { Id: State.Open.Proposal.Id, Name: State.Open.Proposal.Title };
			} );
		}
		else if ( key === 'v' && $scope.Clipboard )
		{
			let project = State.Projects.find( function ( candidate ) { return candidate.Id === $scope.OpenProjectId; } );
			if ( project )
			{
				event.preventDefault();
				let folder = ( $scope.Target && $scope.Target.Project === project.Id ) ? { Id: $scope.Target.Folder } : null;
				$scope.Paste( project, folder );
			}
		}
	}

	document.addEventListener( 'keydown', on_key );


	//-----------------------------------------------------------------
	// Trash

	async function load_trash()
	{
		let answer = await State.Act( function () { return Client.Get( '/api/trash' ); } );
		$scope.Trash = answer ? answer.Proposals : [];
		$scope.$applyAsync();
	}


	$scope.ToggleTrash = function ()
	{
		$scope.ShowingTrash = !$scope.ShowingTrash;
		if ( $scope.ShowingTrash )
		{
			load_trash();
		}
	};


	$scope.$watch( function () { return State.Proposals; }, function ()
	{
		if ( $scope.ShowingTrash )
		{
			load_trash();
		}
	} );


	//-----------------------------------------------------------------
	// The LLM's tokens: today in the footer, everything in the tooltip. Reloaded after every call.

	async function load_usage()
	{
		try
		{
			$scope.Usage = await Client.Get( '/api/usage' );
		}
		catch ( error )
		{
			$scope.Usage = null;
		}
		$scope.$applyAsync();
	}


	$scope.UsageHint = function ()
	{
		let usage = $scope.Usage;
		if ( !usage )
		{
			return '';
		}
		let lines = [ 'today: ' + usage.Today.Calls + ' calls, ' + usage.Today.Input + ' in, ' + usage.Today.Output + ' out' ];
		lines.push( 'in all: ' + usage.Total.Calls + ' calls, ' + usage.Total.Input + ' in, ' + usage.Total.Output + ' out' );
		for ( let model of Object.keys( usage.Models ) )
		{
			let entry = usage.Models[ model ];
			lines.push( model + ': ' + entry.Calls + ' calls, ' + entry.Input + ' in, ' + entry.Output + ' out' );
		}
		return lines.join( '\n' );
	};


	$scope.$on( 'changed', function ( event, change )
	{
		if ( change.Kind === 'llm-finished' )
		{
			load_usage();
		}
	} );

	load_usage();
} ] )


//---------------------------------------------------------------------
// drag-item="<id>": the element can be dragged; the drag carries the item's id.

.directive( 'dragItem', [ function ()
{
	return {
		restrict: 'A',
		link: function ( scope, element, attributes )
		{
			let node = element[ 0 ];
			node.setAttribute( 'draggable', 'true' );
			node.addEventListener( 'dragstart', function ( event )
			{
				event.stopPropagation();
				event.dataTransfer.setData( DRAG_TYPE, scope.$eval( attributes.dragItem ) );
				event.dataTransfer.effectAllowed = 'move';
			} );
		},
	};
} ] )


//---------------------------------------------------------------------
// drop-target="{ Project, Parent }" on-drop="Handler( Id, Target )": a place an item can be dropped.

.directive( 'dropTarget', [ function ()
{
	return {
		restrict: 'A',
		link: function ( scope, element, attributes )
		{
			let node = element[ 0 ];
			function carries_item( event )
			{
				return Array.from( event.dataTransfer.types ).includes( DRAG_TYPE );
			}
			node.addEventListener( 'dragover', function ( event )
			{
				if ( carries_item( event ) )
				{
					event.preventDefault();
					event.stopPropagation();
					event.dataTransfer.dropEffect = 'move';
					node.classList.add( 'drop-over' );
				}
			} );
			node.addEventListener( 'dragleave', function ()
			{
				node.classList.remove( 'drop-over' );
			} );
			node.addEventListener( 'drop', function ( event )
			{
				node.classList.remove( 'drop-over' );
				if ( !carries_item( event ) )
				{
					return;
				}
				event.preventDefault();
				event.stopPropagation();
				let id = event.dataTransfer.getData( DRAG_TYPE );
				let target = scope.$eval( attributes.dropTarget );
				scope.$apply( function () { scope.$eval( attributes.onDrop, { Id: id, Target: target } ); } );
			} );
		},
	};
} ] );
