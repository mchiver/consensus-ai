'use strict';

// Sidebar - the project tree: one project open at a time, its folders and items with their tallies;
// new project, plan and folder, rename and delete; the search box, the waiting count, Trash at the bottom,
// and the LLM's tokens today. Items and projects move and reorder by drag and drop; items copy by copy and paste.
// A plan holds its Subplans: they fold under it, and a plan dropped into it becomes one.
// The tree can be sorted (by name, created or updated) and show each item's last update; both remembered here.

const DRAG_TYPE = 'application/x-consensus-item';
const DRAG_PROJECT_TYPE = 'application/x-consensus-project';

angular.module( 'Consensus' ).controller( 'SidebarController', [ '$scope', '$window', 'State', 'Client', 'Subplans', function ( $scope, $window, State, Client, Subplans )
{
	const OPEN_PROJECT_KEY = 'consensus.project';
	const FOLDED_KEY = 'consensus.folded';
	const SORT_KEY = 'consensus.tree-sort';
	const SHOW_UPDATED_KEY = 'consensus.show-updated';
	const SORTS = [ 'none', 'name', 'created', 'updated' ];

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
	$scope.Sort = read_stored( SORT_KEY, 'none' );
	if ( !SORTS.includes( $scope.Sort ) )
	{
		$scope.Sort = 'none';
	}
	$scope.ShowUpdated = read_stored( SHOW_UPDATED_KEY, false );


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
	// The tree: one project open at a time; folders, and plans with Subplans, fold on their own.

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
		event.preventDefault();
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


	//-----------------------------------------------------------------
	// Sorting and stamps. Sorting only changes what the tree shows; the project's own order is kept.

	$scope.SetSort = function ()
	{
		write_stored( SORT_KEY, $scope.Sort );
	};


	$scope.ToggleUpdated = function ()
	{
		$scope.ShowUpdated = !$scope.ShowUpdated;
		write_stored( SHOW_UPDATED_KEY, $scope.ShowUpdated );
	};


	$scope.IsSorted = function ()
	{
		return $scope.Sort !== 'none';
	};


	function name_of( node )
	{
		return String( ( node.Kind === 'folder' ) ? node.Name : ( node.Title || node.Id ) ).toLowerCase();
	}


	function date_of( node )
	{
		return ( $scope.Sort === 'created' ) ? ( node.Created || '' ) : ( node.Updated || '' );
	}


	// Folders first, by name; then the other items by name, or by date (oldest first) and then name.
	function compare( a, b )
	{
		let a_folder = ( a.Kind === 'folder' );
		let b_folder = ( b.Kind === 'folder' );
		if ( a_folder !== b_folder )
		{
			return a_folder ? -1 : 1;
		}
		if ( !a_folder && $scope.Sort !== 'name' )
		{
			let a_date = date_of( a );
			let b_date = date_of( b );
			if ( a_date !== b_date )
			{
				return ( a_date < b_date ) ? -1 : 1;
			}
		}
		return name_of( a ).localeCompare( name_of( b ) );
	}


	// The items of one level as the tree shows them.
	$scope.Sorted = function ( items )
	{
		if ( !items || !$scope.IsSorted() )
		{
			return items;
		}
		return items.slice().sort( compare );
	};


	// The date shown before an item's name when sorted by created or updated, or ''.
	$scope.DateOf = function ( node )
	{
		if ( node.Kind === 'folder' || ( $scope.Sort !== 'created' && $scope.Sort !== 'updated' ) )
		{
			return '';
		}
		return date_of( node );
	};


	$scope.ItemCount = function ( items )
	{
		let count = 0;
		for ( let node of items )
		{
			if ( node.Kind === 'folder' )
			{
				count += $scope.ItemCount( node.Items );
				continue;
			}
			count += 1 + ( node.Items ? $scope.ItemCount( node.Items ) : 0 );
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
		$scope.Linking = null;
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


	// A new Subplan under a plan of the tree: its title is asked for in the Subplan form.
	$scope.NewSubplan = function ( project, node, event )
	{
		event.preventDefault();
		event.stopPropagation();
		Subplans.Start( node, project.Id );
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
	// Linking: a corpus a context server offers becomes an item of the project (the picked folder, or its root).
	// Linking = { Project, Parent, Servers, Choices: [ { Label, Server, Corpus } ], Picked, Loaded }

	$scope.Linking = null;

	function choices_of( servers )
	{
		let choices = [];
		for ( let server of servers )
		{
			for ( let corpus of server.Corpus )
			{
				choices.push( { Label: server.Name + ' / ' + corpus.Name + ' (' + corpus.Files + ' files)', Server: server.Name, Corpus: corpus.Name } );
			}
		}
		return choices;
	}


	function show_servers( servers )
	{
		if ( !$scope.Linking )
		{
			return;
		}
		$scope.Linking.Servers = servers;
		$scope.Linking.Choices = choices_of( servers );
		$scope.Linking.Picked = $scope.Linking.Choices[ 0 ] || null;
		$scope.Linking.Loaded = true;
	}


	$scope.StartLink = async function ( project, event )
	{
		event.stopPropagation();
		$scope.Creating = null;
		$scope.Renaming = null;
		$scope.Deleting = null;
		$scope.Linking = { Project: project.Id, Parent: parent_in( project ), Servers: [], Choices: [], Picked: null, Loaded: false };
		let answer = await State.Act( function () { return Client.Get( '/api/context-servers' ); } );
		if ( answer )
		{
			show_servers( answer.Servers );
		}
		$scope.$applyAsync();
	};


	$scope.RefreshServers = async function ()
	{
		let answer = await State.Act( function () { return Client.Post( '/api/context-servers/refresh' ); } );
		if ( answer )
		{
			show_servers( answer.Servers );
		}
		$scope.$applyAsync();
	};


	$scope.CancelLink = function ()
	{
		$scope.Linking = null;
	};


	$scope.Link = async function ()
	{
		let linking = $scope.Linking;
		if ( !linking || !linking.Picked )
		{
			return;
		}
		let answer = await State.Act( function ()
		{
			return Client.Post( '/api/projects/' + encodeURIComponent( linking.Project ) + '/corpus-link', { Server: linking.Picked.Server, Corpus: linking.Picked.Corpus, Parent: linking.Parent } );
		} );
		if ( answer )
		{
			$scope.Linking = null;
			await State.LoadList();
			$window.location.hash = '#/c/' + encodeURIComponent( answer.Corpus.Id );
		}
		$scope.$applyAsync();
	};


	//-----------------------------------------------------------------
	// Renaming: { Kind: 'project' | 'folder' | 'proposal', Project, Id, Name }. A plan or document is renamed by
	// its Title; its Id stays.

	$scope.StartRename = function ( kind, project, node, event )
	{
		event.preventDefault();
		event.stopPropagation();
		$scope.Creating = null;
		$scope.Deleting = null;
		$scope.Renaming = { Kind: kind, Project: project.Id, Id: node.Id, Name: ( kind === 'proposal' ) ? node.Title : node.Name };
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
		let answer = await State.Act( function ()
		{
			if ( renaming.Kind === 'proposal' )
			{
				return Client.Put( '/api/proposals/' + encodeURIComponent( renaming.Id ), { Title: name } );
			}
			let path = '/api/projects/' + encodeURIComponent( renaming.Project );
			if ( renaming.Kind === 'folder' )
			{
				path += '/folders/' + encodeURIComponent( renaming.Id );
			}
			return Client.Put( path, { Name: name } );
		} );
		if ( answer )
		{
			$scope.Renaming = null;
			await State.LoadList();
			if ( renaming.Kind === 'proposal' && renaming.Id === State.OpenId )
			{
				await State.Reload();
			}
		}
		$scope.$applyAsync();
	};


	// Escape in a rename box gives up the rename.
	$scope.RenameKey = function ( event )
	{
		if ( event.key === 'Escape' )
		{
			event.stopPropagation();
			$scope.Renaming = null;
		}
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
	// Move: an item goes into a project's root or a folder, at the end or just before a child of it.
	// Target = { Project, Parent, Before? }

	$scope.MoveItem = async function ( id, target )
	{
		if ( id === target.Parent || id === target.Before )
		{
			return;
		}
		let answer = await State.Act( function ()
		{
			return Client.Post( '/api/items/' + encodeURIComponent( id ) + '/move', { Project: target.Project, Parent: target.Parent, Before: target.Before || null } );
		} );
		if ( answer )
		{
			await State.LoadList();
		}
		$scope.$applyAsync();
	};


	// Where the node Id sits in Items: { Parent (a folder's or a plan's id, or null for the root), Next (the id of
	// the node after it, or null) }, or null.
	function place_of( items, id, parent )
	{
		for ( let index = 0; index < items.length; index++ )
		{
			let node = items[ index ];
			if ( node.Id === id )
			{
				let next = ( index + 1 < items.length ) ? items[ index + 1 ].Id : null;
				return { Parent: parent, Next: next };
			}
			if ( node.Items )
			{
				let found = place_of( node.Items, id, node.Id );
				if ( found )
				{
					return found;
				}
			}
		}
		return null;
	}


	// A drop on the tree. Drag = { Kind: 'item' | 'project', Id }; Target = { Kind: 'project' | 'folder' | 'plan' |
	// 'item', Project, Id }; Zone = 'before' | 'after' | 'into'. Into a plan makes a Subplan; the server refuses
	// anything but a plan there.
	$scope.TreeDrop = function ( Drag, Target, Zone )
	{
		if ( Drag.Kind === 'project' )
		{
			move_project( Drag.Id, Target.Project, Zone );
			return;
		}
		if ( Zone === 'into' )
		{
			let parent = ( Target.Kind === 'folder' || Target.Kind === 'plan' ) ? Target.Id : null;
			$scope.MoveItem( Drag.Id, { Project: Target.Project, Parent: parent } );
			return;
		}
		let project = State.Projects.find( function ( candidate ) { return candidate.Id === Target.Project; } );
		let place = project ? place_of( project.Items, Target.Id, null ) : null;
		if ( !place || Drag.Id === Target.Id )
		{
			return;
		}
		let before = ( Zone === 'before' ) ? Target.Id : place.Next;
		if ( before === Drag.Id )
		{
			return;
		}
		$scope.MoveItem( Drag.Id, { Project: Target.Project, Parent: place.Parent, Before: before } );
	};


	// A project dropped before or after another in the order.
	async function move_project( id, target_id, zone )
	{
		let ids = State.Projects.map( function ( project ) { return project.Id; } );
		let index = ids.indexOf( target_id );
		if ( id === target_id || index < 0 )
		{
			return;
		}
		let before = ( zone === 'before' ) ? target_id : ( ids[ index + 1 ] || null );
		if ( before === id )
		{
			return;
		}
		let answer = await State.Act( function ()
		{
			return Client.Post( '/api/projects/' + encodeURIComponent( id ) + '/move', { Before: before } );
		} );
		if ( answer )
		{
			await State.LoadList();
		}
		$scope.$applyAsync();
	}


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
// drag-project="<id>": a project's head can be dragged, to reorder the projects.

.directive( 'dragProject', [ function ()
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
				event.dataTransfer.setData( DRAG_PROJECT_TYPE, scope.$eval( attributes.dragProject ) );
				event.dataTransfer.effectAllowed = 'move';
			} );
		},
	};
} ] )


//---------------------------------------------------------------------
// tree-drop="{ Kind: 'project' | 'folder' | 'plan' | 'item', Project, Id }" on-tree-drop="Handler( Drag, Target, Zone )":
// a row of the tree things are dropped on. Where the pointer is on the row picks the zone, shown by a line or
// an outline:
//   an item on a project's head           into its root
//   an item on a folder or a plan         before (top quarter), after (bottom quarter), or into (the middle)
//   an item on an item                    before (top half) or after (bottom half)
//   a project on a project's head         before (top half) or after (bottom half)
// While the tree is sorted (the target has Sorted: true), an item only moves into a folder or a plan: there is
// no order to put it in.

.directive( 'treeDrop', [ function ()
{
	const ZONE_CLASSES = [ 'drop-before', 'drop-after', 'drop-into' ];

	function dragged_kind( event )
	{
		let types = Array.from( event.dataTransfer.types );
		if ( types.includes( DRAG_TYPE ) )
		{
			return 'item';
		}
		if ( types.includes( DRAG_PROJECT_TYPE ) )
		{
			return 'project';
		}
		return null;
	}


	// The zone for a drag of Kind at the event's height on the row, or null when it cannot drop there.
	function zone_of( event, node, target, kind )
	{
		let rect = node.getBoundingClientRect();
		let share = ( rect.height > 0 ) ? ( event.clientY - rect.top ) / rect.height : 0.5;
		if ( target.Kind === 'project' )
		{
			if ( kind === 'item' )
			{
				return 'into';
			}
			return ( share < 0.5 ) ? 'before' : 'after';
		}
		if ( kind !== 'item' )
		{
			return null;
		}
		if ( target.Sorted )
		{
			return ( target.Kind === 'folder' || target.Kind === 'plan' ) ? 'into' : null;
		}
		if ( target.Kind === 'folder' || target.Kind === 'plan' )
		{
			if ( share < 0.25 )
			{
				return 'before';
			}
			return ( share > 0.75 ) ? 'after' : 'into';
		}
		return ( share < 0.5 ) ? 'before' : 'after';
	}


	return {
		restrict: 'A',
		link: function ( scope, element, attributes )
		{
			let node = element[ 0 ];

			function show( zone )
			{
				for ( let name of ZONE_CLASSES )
				{
					node.classList.toggle( name, name === 'drop-' + zone );
				}
			}

			node.addEventListener( 'dragover', function ( event )
			{
				let kind = dragged_kind( event );
				let zone = kind ? zone_of( event, node, scope.$eval( attributes.treeDrop ), kind ) : null;
				if ( !zone )
				{
					return;
				}
				event.preventDefault();
				event.stopPropagation();
				event.dataTransfer.dropEffect = 'move';
				show( zone );
			} );
			node.addEventListener( 'dragleave', function ()
			{
				show( null );
			} );
			node.addEventListener( 'drop', function ( event )
			{
				show( null );
				let kind = dragged_kind( event );
				let target = scope.$eval( attributes.treeDrop );
				let zone = kind ? zone_of( event, node, target, kind ) : null;
				if ( !zone )
				{
					return;
				}
				event.preventDefault();
				event.stopPropagation();
				let id = event.dataTransfer.getData( ( kind === 'item' ) ? DRAG_TYPE : DRAG_PROJECT_TYPE );
				let drag = { Kind: kind, Id: id };
				scope.$apply( function () { scope.$eval( attributes.onTreeDrop, { Drag: drag, Target: target, Zone: zone } ); } );
			} );
		},
	};
} ] );
