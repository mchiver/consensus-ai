'use strict';

// Sidebar - the project tree: one project open at a time, its folders and items with their tallies;
// new project, plan and folder, rename and delete; the waiting count, Trash and the Settings button at the
// bottom. Items and projects move and reorder by drag and drop; items copy by copy and paste.
// Each project's Context folder comes first, holding its Readme and other documents: neither the folder
// nor the document is renamed, moved, copied or deleted, and New document goes there. In the desktop (plan
// Consensus Desktop, Step 3) it also shows the desktop's LLM connections (every project) and the project's
// workspaces, with Open, Rename and Delete in their menus, and New LLM connection and New workspace in its own.
// A plan holds its Subplans: they fold under it, and a plan dropped into it becomes one.
// Each row's actions are in its menu (⋯, or a right-click); Delete is there only, confirmed on the row.
// The tree can be sorted (by name, created or updated) and show each item's last update; both remembered here.

const DRAG_TYPE = 'application/x-consensus-item';
const DRAG_PROJECT_TYPE = 'application/x-consensus-project';

angular.module( 'Consensus' ).controller( 'SidebarController', [ '$scope', '$rootScope', '$window', 'State', 'Client', 'Subplans', 'Tabs', 'Menus', 'Ports', 'DesktopItems', function ( $scope, $rootScope, $window, State, Client, Subplans, Tabs, Menus, Ports, DesktopItems )
{
	const OPEN_PROJECT_KEY = 'consensus.project';
	const FOLDED_KEY = 'consensus.folded';
	const SORT_KEY = 'consensus.tree-sort';
	const SHOW_UPDATED_KEY = 'consensus.show-updated';
	const SORTS = [ 'none', 'name', 'created', 'updated' ];

	$scope.State = State;
	$scope.Items = DesktopItems;
	$scope.Creating = null;
	$scope.Renaming = null;
	$scope.Deleting = null;
	$scope.Target = null;
	$scope.ShowingTrash = false;
	$scope.Trash = [];
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
	// Waiting, theme, settings

	$scope.OpenProject = function ()
	{
		return State.Projects.find( function ( project ) { return project.Id === $scope.OpenProjectId; } ) || null;
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


	// The settings popup (settings.js) opens on the owner's button.
	$scope.OpenSettings = function ()
	{
		$rootScope.$broadcast( 'settings-opened' );
	};


	//-----------------------------------------------------------------
	// The Context folder and the Readme of a project.

	$scope.IsContextFolder = function ( project, node )
	{
		return !!project && !!node && node.Id === project.ContextFolder;
	};


	$scope.IsContextDocument = function ( project, node )
	{
		return !!project && !!project.Context && !!node && node.Id === project.Context.Id;
	};


	// A project holds only its Context folder with only its Readme: it can be deleted.
	function only_context( project )
	{
		if ( project.Items.length === 0 )
		{
			return true;
		}
		if ( project.Items.length !== 1 || !$scope.IsContextFolder( project, project.Items[ 0 ] ) )
		{
			return false;
		}
		return project.Items[ 0 ].Items.every( function ( node ) { return $scope.IsContextDocument( project, node ); } );
	}


	//-----------------------------------------------------------------
	// The desktop's items in the Context folder (Step 3): the LLM connections, in every project; the project's
	// workspaces. They are the desktop's, never the server's.

	$scope.WorkspacesOf = function ( project )
	{
		return DesktopItems.WorkspacesOf( project.Id );
	};


	$scope.IsOpenItem = function ( kind, project, id )
	{
		let open = State.OpenItem;
		if ( !open || open.Kind !== kind || open.Id !== id )
		{
			return false;
		}
		return ( kind !== 'llm' ) || open.Project === project.Id;
	};


	$scope.IsRunning = function ( llm )
	{
		return !!DesktopItems.Running[ llm.Id ];
	};


	function desktop_actions( kind, project, item )
	{
		let hash = ( kind === 'llm' ) ? '#/llm/' + encodeURIComponent( project.Id ) + '/' + encodeURIComponent( item.Id ) : '#/w/' + encodeURIComponent( item.Id );
		return [
			action( 'Open', 'eye', function () { $window.location.hash = hash; } ),
			action( 'Rename', 'pencil', function () { $scope.StartRename( kind, project, item, QUIET ); } ),
			{ Separator: true },
			action( 'Delete', 'trash', function () { $scope.StartDelete( item, QUIET ); }, { Danger: true, Disabled: ( kind === 'llm' ) && $scope.IsRunning( item ) } ),
		];
	}


	// Delete a desktop item, confirmed inline like the others; its tabs close.
	$scope.DeleteDesktopItem = async function ( kind, item, event )
	{
		event.preventDefault();
		event.stopPropagation();
		if ( kind === 'llm' )
		{
			await window.Desktop.DeleteLlm( item.Id );
		}
		else
		{
			await window.Desktop.DeleteWorkspace( item.Id );
		}
		$scope.Deleting = null;
		for ( let tab of Tabs.List.slice() )
		{
			if ( ( kind === 'llm' && tab.Kind === 'llm' && String( tab.Id ).endsWith( '/' + item.Id ) ) || ( kind === 'workspace' && tab.Kind === 'w' && tab.Id === item.Id ) )
			{
				Tabs.Close( tab );
			}
		}
		await DesktopItems.Reload();
		$scope.$applyAsync();
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


	//-----------------------------------------------------------------
	// The actions menu of a row: a project, a folder, a plan or a document. The actions are the ones the
	// row buttons used to run; they are handed an event that asks for nothing, since the menu already took its own.

	const QUIET = { preventDefault: function () {}, stopPropagation: function () {} };


	function action( label, icon, act, options )
	{
		return Object.assign( { Label: label, Icon: icon, Act: act }, options || {} );
	}


	// A new item goes into an open project, so the project opens first.
	function open_project( project )
	{
		if ( !$scope.IsOpen( project ) )
		{
			$scope.ToggleProject( project );
		}
	}


	function create_in( kind, project )
	{
		return function ()
		{
			open_project( project );
			$scope.StartCreate( kind, project, QUIET );
		};
	}


	// Import project: the popup (ports.js) takes the json.
	$scope.StartImport = function ()
	{
		Ports.StartImport();
	};


	function project_actions( project )
	{
		let where = ( $scope.Target && $scope.Target.Project === project.Id ) ? ' in ' + $scope.Target.Name : '';
		return [
			action( 'New plan' + where, 'plus', create_in( 'plan', project ) ),
			action( 'New document in Context', 'plus', create_in( 'document', project ) ),
			action( 'New folder' + where, 'plus', create_in( 'folder', project ) ),
			{ Separator: true },
			action( $scope.Clipboard ? 'Paste ' + $scope.Clipboard.Name : 'Paste', 'paste', function () { $scope.Paste( project, null, QUIET ); }, { Disabled: !$scope.Clipboard } ),
			action( 'Rename', 'pencil', function () { $scope.StartRename( 'project', project, project, QUIET ); } ),
			action( 'Export project', 'save', function () { Ports.StartExport( project ).then( function () { $scope.$applyAsync(); } ); } ),
			{ Separator: true },
			action( 'Delete', 'trash', function () { $scope.StartDelete( project, QUIET ); }, { Danger: true, Disabled: project.Id === 'default' || !only_context( project ) } ),
		];
	}


	function folder_actions( project, node )
	{
		if ( $scope.IsContextFolder( project, node ) )
		{
			let actions = [
				action( 'New document', 'plus', create_in( 'document', project ) ),
				action( $scope.Clipboard ? 'Paste ' + $scope.Clipboard.Name : 'Paste', 'paste', function () { $scope.Paste( project, node, QUIET ); }, { Disabled: !$scope.Clipboard } ),
			];
			if ( DesktopItems.Available )
			{
				actions.push( { Separator: true } );
				actions.push( action( 'New LLM connection', 'plus', create_in( 'llm', project ) ) );
				actions.push( action( 'New workspace', 'plus', create_in( 'workspace', project ) ) );
			}
			return actions;
		}
		return [
			action( $scope.Clipboard ? 'Paste ' + $scope.Clipboard.Name : 'Paste', 'paste', function () { $scope.Paste( project, node, QUIET ); }, { Disabled: !$scope.Clipboard } ),
			action( 'Copy', 'copy', function () { $scope.CopyItem( node ); } ),
			action( 'Rename', 'pencil', function () { $scope.StartRename( 'folder', project, node, QUIET ); } ),
			{ Separator: true },
			action( 'Delete', 'trash', function () { $scope.StartDelete( node, QUIET ); }, { Danger: true, Disabled: node.Items.length > 0 } ),
		];
	}


	function item_actions( project, node )
	{
		let kind = 'proposal';
		let actions = [];
		if ( node.Kind === 'plan' )
		{
			actions.push( action( 'New Subplan', 'subplan', function () { $scope.NewSubplan( project, node, QUIET ); } ) );
		}
		actions.push( action( 'Rename', 'pencil', function () { $scope.StartRename( kind, project, node, QUIET ); } ) );
		actions.push( action( 'Copy', 'copy', function () { $scope.CopyItem( node ); } ) );
		actions.push( { Separator: true } );
		actions.push( action( 'Delete', 'trash', function () { $scope.StartDelete( node, QUIET ); }, { Danger: true } ) );
		return actions;
	}


	// Kind: 'project' | 'folder' | 'item' | 'llm' | 'workspace'. A missing item (its record gone) has nothing to
	// do, and nor has the Readme.
	$scope.OpenMenu = function ( kind, project, node, event )
	{
		if ( node.Missing || ( kind === 'item' && $scope.IsContextDocument( project, node ) ) )
		{
			event.preventDefault();
			event.stopPropagation();
			return;
		}
		let actions = null;
		if ( kind === 'llm' || kind === 'workspace' )
		{
			actions = desktop_actions( kind, project, node );
		}
		else
		{
			actions = ( kind === 'project' ) ? project_actions( project ) : ( ( kind === 'folder' ) ? folder_actions( project, node ) : item_actions( project, node ) );
		}
		Menus.Show( actions, event, node.Id );
	};


	$scope.MenuOpenFor = function ( node )
	{
		return Menus.IsOpenFor( node.Id );
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
	// Creating: { Kind: 'project' | 'plan' | 'document' | 'folder', Project?, Parent?, Name }  A document goes in the
	// project's Context folder, whatever folder is picked.

	$scope.StartCreate = function ( kind, project, event )
	{
		if ( event )
		{
			event.stopPropagation();
		}
		$scope.Renaming = null;
		$scope.Deleting = null;
		let parent = project ? parent_in( project ) : null;
		if ( kind === 'document' && project )
		{
			parent = project.ContextFolder || null;
		}
		$scope.Creating = { Kind: kind, Project: project ? project.Id : null, Parent: parent, Name: '' };
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
			case 'document': return 'Document title in Context';
			case 'llm': return 'LLM connection name';
			case 'workspace': return 'Workspace name (its folder is picked next)';
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
		if ( creating.Kind === 'llm' || creating.Kind === 'workspace' )
		{
			await create_desktop_item( creating, name );
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


	// A new LLM connection (with the defaults) or workspace (its folder picked now) of the desktop; it opens.
	async function create_desktop_item( creating, name )
	{
		let answer = null;
		if ( creating.Kind === 'llm' )
		{
			answer = await window.Desktop.SaveLlm( { Name: name } );
		}
		else
		{
			let path = await window.Desktop.PickFolder();
			if ( !path )
			{
				$scope.$applyAsync();
				return;
			}
			answer = await window.Desktop.SaveWorkspace( { Name: name, Project: creating.Project, Path: path } );
		}
		if ( answer.Problems )
		{
			State.Error = answer.Problems.join( '; ' );
			$scope.$applyAsync();
			return;
		}
		$scope.Creating = null;
		await DesktopItems.Reload();
		$window.location.hash = ( creating.Kind === 'llm' ) ? '#/llm/' + encodeURIComponent( creating.Project ) + '/' + encodeURIComponent( answer.Item.Id ) : '#/w/' + encodeURIComponent( answer.Item.Id );
		$scope.$applyAsync();
	}


	// A new Subplan under a plan of the tree: its title is asked for in the Subplan form.
	$scope.NewSubplan = function ( project, node, event )
	{
		event.preventDefault();
		event.stopPropagation();
		Subplans.Start( node, project.Id );
	};


	//-----------------------------------------------------------------
	// Renaming: { Kind: 'project' | 'folder' | 'proposal', Project, Id, Name }. A plan or document is renamed by its
	// Title; its Id stays.

	$scope.StartRename = function ( kind, project, node, event )
	{
		event.preventDefault();
		event.stopPropagation();
		$scope.Creating = null;
		$scope.Deleting = null;
		$scope.Renaming = { Kind: kind, Project: project.Id, Id: node.Id, Name: ( kind === 'proposal' ) ? node.Title : node.Name };
		if ( kind === 'llm' || kind === 'workspace' )
		{
			$scope.Renaming.Item = node;
		}
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
		if ( renaming.Kind === 'llm' || renaming.Kind === 'workspace' )
		{
			let renamed = Object.assign( {}, renaming.Item, { Name: name } );
			let saved = ( renaming.Kind === 'llm' ) ? await window.Desktop.SaveLlm( renamed ) : await window.Desktop.SaveWorkspace( renamed );
			if ( saved.Problems )
			{
				State.Error = saved.Problems.join( '; ' );
			}
			else
			{
				$scope.Renaming = null;
				await DesktopItems.Reload();
			}
			$scope.$applyAsync();
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
	// Deleting, confirmed inline: an empty project or folder; a plan or document (to the trash, its tab closed).

	$scope.StartDelete = function ( node, event )
	{
		event.stopPropagation();
		$scope.Creating = null;
		$scope.Renaming = null;
		$scope.Deleting = node.Id;
	};


	$scope.CancelDelete = function ( event )
	{
		event.preventDefault();
		event.stopPropagation();
		$scope.Deleting = null;
	};


	$scope.Delete = async function ( kind, project, node, event )
	{
		event.preventDefault();
		event.stopPropagation();
		let path = '/api/projects/' + encodeURIComponent( project.Id );
		if ( kind === 'folder' )
		{
			path += '/folders/' + encodeURIComponent( node.Id );
		}
		else if ( kind === 'proposal' )
		{
			path = '/api/proposals/' + encodeURIComponent( node.Id );
		}
		let answer = await State.Act( function () { return Client.Delete( path ); } );
		$scope.Deleting = null;
		if ( answer )
		{
			if ( kind === 'proposal' )
			{
				Tabs.CloseItem( node.Id );
			}
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


} ] )


//---------------------------------------------------------------------
// drag-item="<id>": the element can be dragged; the drag carries the item's id. A null id (the Context folder or
// document) leaves the element where it is.

.directive( 'dragItem', [ function ()
{
	return {
		restrict: 'A',
		link: function ( scope, element, attributes )
		{
			let node = element[ 0 ];
			if ( !scope.$eval( attributes.dragItem ) )
			{
				return;
			}
			node.setAttribute( 'draggable', 'true' );
			node.addEventListener( 'dragstart', function ( event )
			{
				event.stopPropagation();
				// A row is a link, so the browser puts its address in the drag; taken out, the drag is ours alone and
				// the browser offers nothing for it (Chrome's "create split view" at the window's edge).
				event.dataTransfer.clearData();
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
