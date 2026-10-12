'use strict';

// Sidebar - the project tree: one project open at a time, its folders and items with their tallies;
// new project, plan and folder, rename and delete; the waiting count, Trash and the Settings button at the
// bottom. Items and projects move and reorder by drag and drop.
// Copy, Paste and Export work on export json (plan UI Tweaks V): Copy puts a project's, folder's or item's export
// on the system clipboard, Paste reads the clipboard and imports an export Into a project's root or a folder (every
// id new; a project's file as a folder named after it), and Export opens the popup with the json. Ctrl+C copies
// the open item, Ctrl+V pastes into the open project's root.
// Each project's Context folder comes first, holding its Readme and other documents: neither the folder
// nor the document is renamed, moved, copied or deleted, and New Document goes there. Under the projects the
// server's LLM connections (plan Run Shapes, Step 3; llm.js), with Open, Rename and Delete in their menus and New
// LLM in the list's, the owner's to change. Since plan Run Shapes, Step 5, the tree has a root per server (roots.js):
// a row with the server's name, its live dot, who you are there and its menu (New Project, Import, Settings, the
// servers, Reload), and beneath it that server's projects, LLM connections and Trash; every action goes to the
// root the row belongs to; an item moves within its server, Copy and Paste carry it to another.
// A plan holds its Subplans: they fold under it, and a plan dropped into it becomes one. A click on a folder's
// row folds it; the menus read as plan UI Tweaks V lists them, "New <first state>" making a plan there, the state
// the project's own (plan Run Shapes, Step 2: each project keeps its States, Include, Exclude and Commands, edited
// in its Settings popup, project.js). A plan's Archive moves it, with its Subplans, to the project's Archive folder
// at the bottom of the project, read-only until Restore; a new project may name its folder (the desktop picks one).
// Each row's actions are in its menu (⋯, or a right-click); Delete is there only, confirmed on the row.
// The tree can be sorted (by name, created or updated) and show each item's last update; both remembered here.

const DRAG_TYPE = 'application/x-consensus-item';
const DRAG_PROJECT_TYPE = 'application/x-consensus-project';

angular.module( 'Consensus' ).controller( 'SidebarController', [ '$scope', '$rootScope', '$window', 'State', 'Client', 'Subplans', 'Tabs', 'Menus', 'Ports', 'Llms', 'Roots', function ( $scope, $rootScope, $window, State, Client, Subplans, Tabs, Menus, Ports, Llms, Roots )
{
	// Remembered per root (stored.js, plan UI Tweaks V; per root since plan Run Shapes, Step 5), and the sort and the
	// stamps once per window.
	const OPEN_PROJECT_KEY = 'project';
	const FOLDED_KEY = 'folded';
	const SORT_KEY = 'tree-sort';
	const SHOW_UPDATED_KEY = 'show-updated';
	const LLMS_SHOWN_KEY = 'llms-shown';
	const ROOT_CLOSED_KEY = 'root-closed';
	const SORTS = [ 'none', 'name', 'created', 'updated' ];

	$scope.State = State;
	$scope.Llms = Llms;
	$scope.Roots = Roots;
	$scope.HashFor = Roots.HashFor;
	$scope.HasDesktop = !!( window.Desktop && typeof window.Desktop.PickFolder === 'function' );
	$scope.Creating = null;
	$scope.Renaming = null;
	$scope.Deleting = null;
	$scope.ShowingArchive = {};
	$scope.Theme = window.ConsensusTheme.Get().Theme;
	$scope.Scale = window.ConsensusTheme.Get().Scale;
	$scope.Palettes = window.ConsensusTheme.PALETTES;
	$scope.Sort = read_shared( SORT_KEY, 'none' );
	if ( !SORTS.includes( $scope.Sort ) )
	{
		$scope.Sort = 'none';
	}
	$scope.ShowUpdated = read_shared( SHOW_UPDATED_KEY, false );
	let per_root = {};		// root key -> { OpenProjectId, Folded, ShowingLlms, Closed, ShowingTrash, Trash }


	//-----------------------------------------------------------------
	// Remembered per root (under the server's address) or once per window; a blocked or empty storage falls back to
	// the default.

	function read_stored( key, fallback, root )
	{
		return window.ConsensusStored.Read( key, fallback, root );
	}


	function write_stored( key, value, root )
	{
		window.ConsensusStored.Write( key, value, root );
	}


	function read_shared( key, fallback )
	{
		return window.ConsensusStored.Read( key, fallback, false );
	}


	// What the sidebar keeps per root, read once from the remembered state.
	function of_root( root )
	{
		if ( !per_root[ root.Key ] )
		{
			per_root[ root.Key ] = {
				OpenProjectId: read_stored( OPEN_PROJECT_KEY, null, root ),
				Folded: read_stored( FOLDED_KEY, [], root ),
				ShowingLlms: read_stored( LLMS_SHOWN_KEY, true, root ),
				Closed: read_stored( ROOT_CLOSED_KEY, false, root ),
				ShowingTrash: false,
				Trash: [],
			};
		}
		return per_root[ root.Key ];
	}


	// The root a project belongs to (each project is marked by roots.js), else the first.
	function root_of( project )
	{
		return ( project && Roots.Of( project.Root ) ) || Roots.List[ 0 ] || null;
	}


	// The root whose tree, archive or Readme holds the item Id, or null.
	function root_holding( id )
	{
		for ( let root of Roots.List )
		{
			for ( let project of root.Projects )
			{
				if ( project.Id === id || ( project.Context && project.Context.Id === id ) || place_of( project.Items, id, null ) || place_of( project.Archive || [], id, null ) )
				{
					return root;
				}
			}
		}
		return null;
	}


	$scope.Of = function ( root )
	{
		return of_root( root );
	};


	//-----------------------------------------------------------------
	// The root rows (plan Run Shapes, Step 5): a server each, folded or not, with its menu.

	$scope.IsRootClosed = function ( root )
	{
		return !!of_root( root ).Closed;
	};


	$scope.ToggleRoot = function ( root )
	{
		let kept = of_root( root );
		kept.Closed = !kept.Closed;
		write_stored( ROOT_CLOSED_KEY, kept.Closed, root );
	};


	// The root's tooltip: live or offline (with the reason), the server's name and address, its version.
	$scope.RootTitle = function ( root )
	{
		let parts = [ root.Live ? 'live updates' : 'offline' + ( root.Error ? ': ' + root.Error : '' ) ];
		parts.push( ( root.Kind === 'local' ) ? 'this machine\'s server' : root.Name );
		if ( root.Url )
		{
			parts.push( root.Url );
		}
		if ( root.Version )
		{
			parts.push( 'Consensus ' + root.Version );
		}
		return parts.join( '; ' );
	};


	// Reload: the root's identity, lists and connections read afresh.
	$scope.ReloadRoot = async function ( root )
	{
		await Roots.LoadMe( root );
		await Roots.LoadList( root );
		await Llms.For( root ).Reload();
		$scope.$applyAsync();
	};


	// The root's menu: New Project and Import (here), Settings (the owner's), the servers (the desktop's connect
	// screen), Reload.
	function root_actions( root )
	{
		let actions = [
			action( 'New Project', 'plus', function () { $scope.StartCreate( 'project', null, QUIET, null, root ); } ),
			action( 'Import', 'upload', function () { $scope.StartImport( root ); } ),
			{ Separator: true },
			action( 'Settings', 'settings', function () { $scope.OpenSettings( root ); }, { Disabled: !is_owner( root ) } ),
		];
		if ( window.Desktop && typeof window.Desktop.Servers === 'function' )
		{
			actions.push( action( 'Servers…', 'link', function () { window.Desktop.Servers(); } ) );
		}
		actions.push( { Separator: true } );
		actions.push( action( 'Reload', 'refresh', function () { $scope.ReloadRoot( root ); } ) );
		return actions;
	}


	//-----------------------------------------------------------------
	// Waiting, theme, settings

	// The open project of a root (the current one when none is named).
	$scope.OpenProject = function ( root )
	{
		let where = root || State.Root;
		if ( !where )
		{
			return null;
		}
		let id = of_root( where ).OpenProjectId;
		return where.Projects.find( function ( project ) { return project.Id === id; } ) || null;
	};


	// Waiting on you, over every root, each with its own participant.
	$scope.WaitingCount = function ()
	{
		let count = 0;
		for ( let root of Roots.List )
		{
			let name = root.Me ? root.Me.Name : null;
			for ( let proposal of root.Proposals )
			{
				count += ( proposal.Tally.WaitingOn[ name ] || 0 );
			}
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


	// The settings popup (settings.js) opens from a root's row or menu, for its owner.
	$scope.OpenSettings = function ( root, event )
	{
		if ( event )
		{
			event.stopPropagation();
		}
		$rootScope.$broadcast( 'settings-opened', root || State.Root );
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
	// The LLM connections (plan Run Shapes, Step 3): the server's, listed once under the projects (llm.js holds them).

	$scope.ToggleLlms = function ( root )
	{
		let kept = of_root( root );
		kept.ShowingLlms = !kept.ShowingLlms;
		write_stored( LLMS_SHOWN_KEY, kept.ShowingLlms, root );
	};


	$scope.IsOpenItem = function ( kind, id, root )
	{
		let open = State.OpenItem;
		return !!open && open.Kind === kind && open.Id === id && ( !root || ( open.Root || '' ) === root.Key );
	};


	$scope.IsRunning = function ( root, llm )
	{
		return !!Llms.For( root ).Running[ llm.Id ];
	};


	function is_owner( root )
	{
		let me = root ? root.Me : State.Me;
		return !!me && me.Role === 'owner';
	}


	function llm_actions( root, llm )
	{
		let actions = [ action( 'Open', 'eye', function () { $window.location.hash = Roots.HashFor( root, '/llm/' + encodeURIComponent( llm.Id ) ); } ) ];
		if ( is_owner( root ) )
		{
			actions.push( action( 'Rename', 'pencil', function () { $scope.StartRename( 'llm', root, llm, QUIET ); } ) );
			actions.push( { Separator: true } );
			actions.push( action( 'Delete', 'trash', function () { $scope.StartDelete( llm, QUIET ); }, { Danger: true, Disabled: $scope.IsRunning( root, llm ) } ) );
		}
		return actions;
	}


	// The list's own menu: New LLM (the owner's).
	function llms_actions( root )
	{
		return [ action( 'New LLM', 'plus', function ()
		{
			of_root( root ).ShowingLlms = true;
			$scope.Renaming = null;
			$scope.Deleting = null;
			$scope.Creating = { Kind: 'llm', Name: '', Root: root.Key };
		}, { Disabled: !is_owner( root ) } ) ];
	}


	// Delete a connection, confirmed inline like the others; its tabs close; its participant goes with it.
	$scope.DeleteLlm = async function ( root, llm, event )
	{
		event.preventDefault();
		event.stopPropagation();
		let answer = await State.Act( function () { return Client.Delete( root, '/api/llms/' + encodeURIComponent( llm.Id ) ); } );
		$scope.Deleting = null;
		if ( answer )
		{
			for ( let tab of Tabs.List.slice() )
			{
				if ( tab.Kind === 'llm' && tab.Id === llm.Id && tab.Root === root.Key )
				{
					Tabs.Close( tab );
				}
			}
			await Llms.For( root ).Reload();
		}
		$scope.$applyAsync();
	};


	//-----------------------------------------------------------------
	// The tree: one project open at a time; folders, and plans with Subplans, fold on their own.

	$scope.IsOpen = function ( project )
	{
		return project.Id === of_root( root_of( project ) ).OpenProjectId;
	};


	function set_open_project( root, id )
	{
		of_root( root ).OpenProjectId = id;
		write_stored( OPEN_PROJECT_KEY, id, root );
	}


	$scope.ToggleProject = function ( project )
	{
		set_open_project( root_of( project ), $scope.IsOpen( project ) ? null : project.Id );
		$scope.Creating = null;
		$scope.Renaming = null;
		$scope.Deleting = null;
	};


	// Opening a proposal opens the project that holds it, on its root.
	$scope.$watch( function () { return ( State.Open && State.Open.Project ) ? State.Open.Project.Id : null; }, function ( project_id )
	{
		if ( project_id && State.Root && project_id !== of_root( State.Root ).OpenProjectId )
		{
			set_open_project( State.Root, project_id );
		}
	} );


	// A remembered project that is no longer there (or the first start, when nothing is remembered): the root's first
	// project opens (plan Run Shapes, Step 2: every project has an id of its own; "default" is gone).
	$scope.$watchCollection( function () { return Roots.List.map( function ( root ) { return root.Projects; } ); }, function ()
	{
		for ( let root of Roots.List )
		{
			let projects = root.Projects;
			let kept = of_root( root );
			if ( !projects || !projects.length || projects.some( function ( project ) { return project.Id === kept.OpenProjectId; } ) )
			{
				continue;
			}
			set_open_project( root, projects[ 0 ].Id );
		}
	} );


	// The folds, kept per root; an id belongs to one root, so a node is folded when any root's list has it.
	function folded_lists()
	{
		return Object.keys( per_root ).map( function ( key ) { return per_root[ key ].Folded; } );
	}


	$scope.IsFolded = function ( node )
	{
		return folded_lists().some( function ( list ) { return list.includes( node.Id ); } );
	};


	$scope.ToggleFold = function ( node, event )
	{
		event.preventDefault();
		event.stopPropagation();
		let root = root_holding( node.Id ) || State.Root || Roots.List[ 0 ];
		let kept = of_root( root );
		if ( kept.Folded.includes( node.Id ) )
		{
			kept.Folded = kept.Folded.filter( function ( id ) { return id !== node.Id; } );
		}
		else
		{
			kept.Folded = kept.Folded.concat( [ node.Id ] );
		}
		write_stored( FOLDED_KEY, kept.Folded, root );
	};


	// A folder is unfolded, so what was just made in it shows.
	function unfold( id )
	{
		for ( let root of Roots.List )
		{
			let kept = of_root( root );
			if ( kept.Folded.includes( id ) )
			{
				kept.Folded = kept.Folded.filter( function ( one ) { return one !== id; } );
				write_stored( FOLDED_KEY, kept.Folded, root );
			}
		}
	}


	// A folder's count: its items.
	$scope.FolderCount = function ( project, node )
	{
		return $scope.ItemCount( node.Items );
	};


	//-----------------------------------------------------------------
	// Sorting and stamps. Sorting only changes what the tree shows; the project's own order is kept.

	$scope.SetSort = function ()
	{
		write_stored( SORT_KEY, $scope.Sort, false );
	};


	$scope.ToggleUpdated = function ()
	{
		$scope.ShowUpdated = !$scope.ShowUpdated;
		write_stored( SHOW_UPDATED_KEY, $scope.ShowUpdated, false );
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


	function create_in( kind, project, parent )
	{
		return function ()
		{
			open_project( project );
			if ( parent )
			{
				unfold( parent );
			}
			$scope.StartCreate( kind, project, QUIET, parent || null );
		};
	}


	// Import project: the popup (ports.js) takes the json, into the root given (the first from the top button).
	$scope.StartImport = function ( root )
	{
		Ports.StartImport( root || Roots.List[ 0 ] );
	};


	// "New Draft": a new plan starts in the first of the project's States (its server's when it has none).
	function new_plan_label( project )
	{
		let states = ( project && Array.isArray( project.States ) && project.States.length ) ? project.States : root_of( project ).States;
		return 'New ' + ( states[ 0 ] || 'Plan' );
	}


	function copy_action( kind, project, node )
	{
		return action( 'Copy', 'copy', function () { $scope.CopyItem( kind, project, node ); } );
	}


	function paste_action( project, folder )
	{
		return action( 'Paste', 'paste', function () { $scope.Paste( project, folder ); } );
	}


	function export_action( kind, project, node )
	{
		return action( 'Export', 'save', function () { $scope.ExportItem( kind, project, node ); } );
	}


	// Project: New Folder, New Draft, ---, Copy, Paste, Rename, Export, ---, Delete.
	function project_actions( project )
	{
		return [
			action( 'New Folder', 'plus', create_in( 'folder', project ) ),
			action( new_plan_label( project ), 'plus', create_in( 'plan', project ) ),
			{ Separator: true },
			copy_action( 'project', project, project ),
			paste_action( project, null ),
			action( 'Rename', 'pencil', function () { $scope.StartRename( 'project', project, project, QUIET ); } ),
			export_action( 'project', project, project ),
			action( 'Settings', 'settings', function () { $scope.OpenProjectSettings( project ); } ),
			{ Separator: true },
			action( 'Delete', 'trash', function () { $scope.StartDelete( project, QUIET ); }, { Danger: true, Disabled: root_of( project ).Projects.length <= 1 || !only_context( project ) || ( project.Archive || [] ).length > 0 } ),
		];
	}


	// Context folder: New Document, ---, Paste.
	// Folder: New Folder, New Draft, ---, Copy, Paste, Rename, Export, ---, Delete.
	function folder_actions( project, node )
	{
		if ( $scope.IsContextFolder( project, node ) )
		{
			let actions = [ action( 'New Document', 'plus', create_in( 'document', project ) ) ];
			actions.push( { Separator: true } );
			actions.push( paste_action( project, node ) );
			return actions;
		}
		return [
			action( 'New Folder', 'plus', create_in( 'folder', project, node.Id ) ),
			action( new_plan_label( project ), 'plus', create_in( 'plan', project, node.Id ) ),
			{ Separator: true },
			copy_action( 'folder', project, node ),
			paste_action( project, node ),
			action( 'Rename', 'pencil', function () { $scope.StartRename( 'folder', project, node, QUIET ); } ),
			export_action( 'folder', project, node ),
			{ Separator: true },
			action( 'Delete', 'trash', function () { $scope.StartDelete( node, QUIET ); }, { Danger: true, Disabled: node.Items.length > 0 } ),
		];
	}


	// Plan: New Subplan, New Comment, ---, Copy, Rename, Export, ---, Delete.
	// Document: Copy, Rename, Export, ---, Delete.
	function item_actions( project, node )
	{
		let kind = 'proposal';
		let actions = [];
		if ( node.Kind === 'plan' )
		{
			actions.push( action( 'New Subplan', 'subplan', function () { $scope.NewSubplan( project, node, QUIET ); } ) );
			actions.push( action( 'New Comment', 'comment', function () { $scope.NewComment( project, node ); } ) );
			actions.push( { Separator: true } );
		}
		actions.push( copy_action( node.Kind, project, node ) );
		actions.push( action( 'Rename', 'pencil', function () { $scope.StartRename( kind, project, node, QUIET ); } ) );
		actions.push( export_action( node.Kind, project, node ) );
		if ( node.Kind === 'plan' )
		{
			actions.push( action( 'Archive', 'archive', function () { $scope.Archive( project, node ); } ) );
		}
		actions.push( { Separator: true } );
		actions.push( action( 'Delete', 'trash', function () { $scope.StartDelete( node, QUIET ); }, { Danger: true } ) );
		return actions;
	}


	// An archived plan (plan Run Shapes, Step 2): Restore, and nothing else; a Subplan of one is restored with it.
	function archived_actions( project, node )
	{
		let top = ( project.Archive || [] ).some( function ( candidate ) { return candidate.Id === node.Id; } );
		return [ action( 'Restore', 'undo', function () { $scope.Restore( project, node ); }, { Disabled: !top } ) ];
	}


	// Kind: 'project' | 'folder' | 'item' | 'archived' | 'llm' | 'llms' (the list itself) | 'root' (a server's row);
	// for root, llms and llm the second argument is the root. A missing item (its record gone) has nothing to do, and
	// nor has the Readme.
	$scope.OpenMenu = function ( kind, project, node, event )
	{
		if ( kind === 'root' || kind === 'llms' )
		{
			event.preventDefault();
			event.stopPropagation();
			Menus.Show( ( kind === 'root' ) ? root_actions( project ) : llms_actions( project ), event, kind + ':' + project.Key );
			return;
		}
		if ( node.Missing || ( kind === 'item' && $scope.IsContextDocument( project, node ) ) )
		{
			event.preventDefault();
			event.stopPropagation();
			return;
		}
		let actions = null;
		if ( kind === 'llm' )
		{
			actions = llm_actions( project, node );
		}
		else if ( kind === 'archived' )
		{
			actions = archived_actions( project, node );
		}
		else
		{
			actions = ( kind === 'project' ) ? project_actions( project ) : ( ( kind === 'folder' ) ? folder_actions( project, node ) : item_actions( project, node ) );
		}
		Menus.Show( actions, event, node.Id );
	};


	//-----------------------------------------------------------------
	// Archive and Restore (plan Run Shapes, Step 2): the plan and its Subplans go to the project's Archive, read-only,
	// and come back to the root. The project's Settings popup (project.js) holds its States, Include, Exclude, Commands.

	$scope.Archive = async function ( project, node )
	{
		let root = root_of( project );
		let answer = await State.Act( function () { return Client.Post( root, '/api/items/' + encodeURIComponent( node.Id ) + '/archive', {} ); } );
		if ( answer )
		{
			$scope.ShowingArchive[ project.Id ] = true;
			await Roots.LoadList( root );
			if ( State.OpenId === node.Id )
			{
				await State.Reload();
			}
		}
		$scope.$applyAsync();
	};


	$scope.Restore = async function ( project, node )
	{
		let root = root_of( project );
		let answer = await State.Act( function () { return Client.Post( root, '/api/items/' + encodeURIComponent( node.Id ) + '/restore', {} ); } );
		if ( answer )
		{
			await Roots.LoadList( root );
			if ( State.OpenId === node.Id )
			{
				await State.Reload();
			}
		}
		$scope.$applyAsync();
	};


	$scope.ToggleArchive = function ( project, event )
	{
		if ( event )
		{
			event.stopPropagation();
		}
		$scope.ShowingArchive[ project.Id ] = !$scope.ShowingArchive[ project.Id ];
	};


	$scope.OpenProjectSettings = function ( project )
	{
		$rootScope.$broadcast( 'project-settings', project );
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
	// Creating: { Kind: 'project' | 'plan' | 'document' | 'folder' | 'llm', Project?, Parent?, Name }
	// Parent is the folder a plan or folder goes in (its menu's New plan or New folder), else the root; a document
	// goes in the project's Context folder.

	// Root: the server a new project is made on (the project's own for the rest).
	$scope.StartCreate = function ( kind, project, event, Parent, Root )
	{
		if ( event )
		{
			event.stopPropagation();
		}
		$scope.Renaming = null;
		$scope.Deleting = null;
		let parent = Parent || null;
		if ( kind === 'document' && project )
		{
			parent = project.ContextFolder || null;
		}
		let root = Root || root_of( project );
		$scope.Creating = { Kind: kind, Project: project ? project.Id : null, Parent: parent, Name: '', Path: '', Root: root ? root.Key : '' };
	};


	// The root a new thing is made on, and whether it is this machine's (its folder can be picked).
	$scope.CreatingRoot = function ()
	{
		return $scope.Creating ? Roots.Of( $scope.Creating.Root ) : null;
	};


	$scope.CreatingIsLocal = function ()
	{
		let root = $scope.CreatingRoot();
		return !!root && root.Kind !== 'server';
	};


	// A new project's folder, picked in the desktop (plan Run Shapes, Step 2): a folder that holds a project already
	// is opened as it is, its name taken from it.
	$scope.PickProjectFolder = async function ()
	{
		if ( !$scope.Creating || !window.Desktop )
		{
			return;
		}
		let picked = await window.Desktop.PickFolder( $scope.Creating.Path || undefined );
		if ( picked )
		{
			$scope.Creating.Path = picked;
			if ( !$scope.Creating.Name )
			{
				$scope.Creating.Name = picked.split( '/' ).filter( function ( part ) { return part; } ).pop() || '';
			}
		}
		$scope.$applyAsync();
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
		switch ( $scope.Creating.Kind )
		{
			case 'project': return 'Project name';
			case 'folder': return 'Folder name';
			case 'document': return 'Document title in Context';
			case 'llm': return 'LLM connection name (letters, digits, dot, dash, colon)';
			default: return 'Plan title';
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
		if ( creating.Kind === 'llm' )
		{
			await create_llm( creating, name );
			return;
		}
		let root = Roots.Of( creating.Root ) || Roots.List[ 0 ];
		let answer = await State.Act( function ()
		{
			if ( creating.Kind === 'project' )
			{
				return Client.Post( root, '/api/projects', { Name: name, Path: creating.Path || undefined } );
			}
			if ( creating.Kind === 'folder' )
			{
				return Client.Post( root, '/api/projects/' + encodeURIComponent( creating.Project ) + '/folders', { Name: name, Parent: creating.Parent } );
			}
			let kind = ( creating.Kind === 'document' ) ? 'document' : 'plan';
			return Client.Post( root, '/api/proposals', { Title: name, Text: '# ' + name + '\n\n', Kind: kind, Project: creating.Project, Parent: creating.Parent } );
		} );
		if ( answer )
		{
			$scope.Creating = null;
			if ( creating.Kind === 'project' )
			{
				set_open_project( root, answer.Project.Id );
			}
			if ( creating.Kind === 'plan' || creating.Kind === 'document' )
			{
				$window.location.hash = Roots.HashFor( root, '/p/' + encodeURIComponent( answer.Proposal.Id ) );
			}
			await Roots.LoadList( root );
		}
		$scope.$applyAsync();
	};




	// A new LLM connection of the server, with the defaults; it opens.
	async function create_llm( creating, name )
	{
		let root = Roots.Of( creating.Root ) || Roots.List[ 0 ];
		let answer = await State.Act( function () { return Client.Post( root, '/api/llms', { Name: name } ); } );
		if ( answer )
		{
			$scope.Creating = null;
			await Llms.For( root ).Reload();
			$window.location.hash = Roots.HashFor( root, '/llm/' + encodeURIComponent( answer.Llm.Id ) );
		}
		$scope.$applyAsync();
	}


	// A new Subplan under a plan of the tree: its title is asked for in the Subplan form.
	$scope.NewSubplan = function ( project, node, event )
	{
		event.preventDefault();
		event.stopPropagation();
		Subplans.Start( node, project.Id, root_of( project ) );
	};


	// New Comment on a plan of the tree: the plan opens in Read (its tab) and a whole-document comment starts, as
	// the header's New Comment does; an open plan starts it at once, another once it is loaded (read.js).
	$scope.NewComment = function ( project, node )
	{
		if ( State.OpenId === node.Id && State.Open )
		{
			State.StartCompose( null );
			return;
		}
		State.Pend( { Compose: true } );
		$window.location.hash = Roots.HashFor( root_of( project ), '/p/' + encodeURIComponent( node.Id ) );
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
		let root = ( kind === 'llm' ) ? project : root_of( project );
		$scope.Renaming = { Kind: kind, Project: ( project && kind !== 'llm' ) ? project.Id : null, Id: node.Id, Name: ( kind === 'proposal' ) ? node.Title : node.Name, Root: root ? root.Key : '' };
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
		let root = Roots.Of( renaming.Root ) || State.Root;
		if ( renaming.Kind === 'llm' )
		{
			let saved = await State.Act( function () { return Client.Put( root, '/api/llms/' + encodeURIComponent( renaming.Id ), { Name: name } ); } );
			if ( saved )
			{
				$scope.Renaming = null;
				await Llms.For( root ).Reload();
			}
			$scope.$applyAsync();
			return;
		}
		let answer = await State.Act( function ()
		{
			if ( renaming.Kind === 'proposal' )
			{
				return Client.Put( root, '/api/proposals/' + encodeURIComponent( renaming.Id ), { Title: name } );
			}
			let path = '/api/projects/' + encodeURIComponent( renaming.Project );
			if ( renaming.Kind === 'folder' )
			{
				path += '/folders/' + encodeURIComponent( renaming.Id );
			}
			return Client.Put( root, path, { Name: name } );
		} );
		if ( answer )
		{
			$scope.Renaming = null;
			await Roots.LoadList( root );
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
		let root = root_of( project );
		let answer = await State.Act( function () { return Client.Delete( root, path ); } );
		$scope.Deleting = null;
		if ( answer )
		{
			if ( kind === 'proposal' )
			{
				Tabs.CloseItem( node.Id, root.Key );
			}
			await Roots.LoadList( root );
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
		let root = Roots.ByProject( target.Project ) || State.Root;
		let from = root_holding( id );
		if ( from && from !== root )
		{
			notice( 'an item moves within its server; Copy and Paste carry it to another', true );
			return;
		}
		let answer = await State.Act( function ()
		{
			return Client.Post( root, '/api/items/' + encodeURIComponent( id ) + '/move', { Project: target.Project, Parent: target.Parent, Before: target.Before || null } );
		} );
		if ( answer )
		{
			await Roots.LoadList( root );
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
		let root = Roots.ByProject( Target.Project ) || State.Root;
		let project = root ? root.Projects.find( function ( candidate ) { return candidate.Id === Target.Project; } ) : null;
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
		let root = Roots.ByProject( target_id ) || State.Root;
		if ( Roots.ByProject( id ) !== root )
		{
			notice( 'a project moves within its server; Copy and Paste carry it to another', true );
			return;
		}
		let ids = root.Projects.map( function ( project ) { return project.Id; } );
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
			return Client.Post( root, '/api/projects/' + encodeURIComponent( id ) + '/move', { Before: before } );
		} );
		if ( answer )
		{
			await Roots.LoadList( root );
		}
		$scope.$applyAsync();
	}


	//-----------------------------------------------------------------
	// Copy, Paste and Export on export json (plan UI Tweaks V). Copy (a menu, or Ctrl+C on the open item) fetches the
	// export and puts it on the system clipboard; Paste (a menu, or Ctrl+V into the open project's root) reads the
	// clipboard and imports an export Into the target; Export opens the popup. Notice is the line under the tree's
	// head: what was copied or pasted, or why the paste was refused.

	$scope.Notice = null;


	function notice( text, is_error )
	{
		$scope.Notice = { Text: text, Error: !!is_error };
		$scope.$applyAsync();
	}


	$scope.ClearNotice = function ()
	{
		$scope.Notice = null;
	};


	// The export of a project, or of a folder, plan or document (Kind as the tree names it), as the server gives it.
	function export_path( kind, node )
	{
		if ( kind === 'project' )
		{
			return '/api/projects/' + encodeURIComponent( node.Id ) + '/export';
		}
		return '/api/items/' + encodeURIComponent( node.Id ) + '/export';
	}


	function name_of( node )
	{
		return node.Name || node.Title || node.Id;
	}


	$scope.CopyItem = async function ( kind, project, node )
	{
		let exported = null;
		try
		{
			exported = await Client.Get( root_of( project ), export_path( kind, node ) );
		}
		catch ( error )
		{
			notice( error.message, true );
			return;
		}
		let json = JSON.stringify( exported, null, '\t' );
		try
		{
			await navigator.clipboard.writeText( json );
			notice( 'copied: ' + name_of( node ) + ' (Paste in a project\'s or folder\'s menu, or Ctrl+V)' );
		}
		catch ( error )
		{
			// The clipboard refused (no focus, no permission): the popup shows the json to copy by hand.
			Ports.ShowExport( exported, { Id: node.Id, Name: name_of( node ) } );
			$scope.$applyAsync();
		}
	};


	$scope.ExportItem = async function ( kind, project, node )
	{
		await Ports.StartExport( { Kind: kind, Id: node.Id, Name: name_of( node ) }, root_of( project ) );
		$scope.$applyAsync();
	};


	// The clipboard's text as an export, or null with the notice said.
	async function clipboard_export()
	{
		let text = '';
		try
		{
			text = await navigator.clipboard.readText();
		}
		catch ( error )
		{
			notice( 'the clipboard could not be read', true );
			return null;
		}
		let exported = null;
		try
		{
			exported = JSON.parse( text );
		}
		catch ( error )
		{
			exported = null;
		}
		if ( !exported || typeof exported !== 'object' || exported.Format !== 'consensus-project' )
		{
			notice( 'the clipboard holds no Consensus export', true );
			return null;
		}
		return exported;
	}


	$scope.Paste = async function ( project, folder )
	{
		let exported = await clipboard_export();
		if ( !exported )
		{
			return;
		}
		let parent = folder ? folder.Id : null;
		let root = root_of( project );
		let answer = await State.Act( function ()
		{
			return Client.Post( root, '/api/projects/import', { Export: exported, Into: { Project: project.Id, Parent: parent } } );
		} );
		if ( answer )
		{
			set_open_project( root, project.Id );
			if ( parent )
			{
				unfold( parent );
			}
			notice( 'pasted: ' + ( exported.Project ? exported.Project.Name : 'the export' ) );
			await Roots.LoadList( root );
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
			event.preventDefault();
			$scope.CopyItem( State.Open.Proposal.Kind || 'plan', Object.assign( {}, State.Open.Project, { Root: State.Root ? State.Root.Key : '' } ), { Id: State.Open.Proposal.Id, Title: State.Open.Proposal.Title } );
		}
		else if ( key === 'v' )
		{
			let project = $scope.OpenProject( State.Root );
			if ( project )
			{
				event.preventDefault();
				$scope.Paste( project, null );
			}
		}
	}

	document.addEventListener( 'keydown', on_key );


	//-----------------------------------------------------------------
	// Trash

	async function load_trash( root )
	{
		let answer = await State.Act( function () { return Client.Get( root, '/api/trash' ); } );
		of_root( root ).Trash = answer ? answer.Proposals : [];
		$scope.$applyAsync();
	}


	$scope.ToggleTrash = function ( root )
	{
		let kept = of_root( root );
		kept.ShowingTrash = !kept.ShowingTrash;
		if ( kept.ShowingTrash )
		{
			load_trash( root );
		}
	};


	$scope.$watchCollection( function () { return Roots.List.map( function ( root ) { return root.Proposals; } ); }, function ()
	{
		for ( let root of Roots.List )
		{
			if ( of_root( root ).ShowingTrash )
			{
				load_trash( root );
			}
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
