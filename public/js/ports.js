'use strict';

// Ports - a whole project out and back in (the plan "Project Import and Export"), over the same API an agent uses.
// Export: the project's json in a popup, to copy or download; a folder's, plan's or document's too (plan UI Tweaks
// V, the same format). Import: paste the json or load a file, Preview, then Import. A project that is here already
// is imported as a copy ("Copy of … (imported <date>)", every id new) or merged into the one here; the popup ends
// with the import's report. Paste in the tree (sidebar.js) imports Into a project without this popup.

angular.module( 'Consensus' )

.factory( 'Ports', [ 'Client', 'State', 'Roots', function ( Client, State, Roots )
{
	// Open: null | 'export' | 'import'. Root: the server it works on (plan Run Shapes, Step 5). Project: the exported
	// project { Id, Name }. Json: the text shown or pasted. Preview: what the server said the import would do. Report:
	// what it did. Error: the last refusal.
	let ports = { Open: null, Root: null, Project: null, Json: '', Busy: false, Copied: false, Preview: null, Report: null, Error: '' };


	function reset( open, root )
	{
		ports.Open = open;
		ports.Root = root || State.Root;
		ports.Project = null;
		ports.Json = '';
		ports.Busy = false;
		ports.Copied = false;
		ports.Preview = null;
		ports.Report = null;
		ports.Error = '';
	}


	function Close()
	{
		reset( null, null );
	}


	//-----------------------------------------------------------------
	// Export

	// Item: { Kind: 'project' | 'folder' | 'plan' | 'document', Id, Name }; a project without a Kind is a project. Root:
	// the server it is on.
	async function StartExport( Item, Root )
	{
		reset( 'export', Root );
		ports.Project = { Id: Item.Id, Name: Item.Name };
		ports.Busy = true;
		let path = ( !Item.Kind || Item.Kind === 'project' ) ? '/api/projects/' + encodeURIComponent( Item.Id ) + '/export' : '/api/items/' + encodeURIComponent( Item.Id ) + '/export';
		try
		{
			let exported = await Client.Get( ports.Root, path );
			ports.Json = JSON.stringify( exported, null, '\t' );
		}
		catch ( error )
		{
			ports.Error = error.message;
		}
		ports.Busy = false;
	}


	// An export already fetched, shown to copy or download (the tree's Copy, when the clipboard refused).
	function ShowExport( Exported, Item )
	{
		reset( 'export' );
		ports.Project = { Id: Item.Id, Name: Item.Name };
		ports.Json = JSON.stringify( Exported, null, '\t' );
		ports.Error = 'the clipboard refused: copy the text here';
	}


	async function Copy()
	{
		try
		{
			await navigator.clipboard.writeText( ports.Json );
			ports.Copied = true;
		}
		catch ( error )
		{
			ports.Error = 'the clipboard refused: select the text and copy it';
		}
	}


	function today()
	{
		let now = new Date();
		let month = String( now.getMonth() + 1 ).padStart( 2, '0' );
		let day = String( now.getDate() ).padStart( 2, '0' );
		return now.getFullYear() + '-' + month + '-' + day;
	}


	// <project name>-<yyyy-mm-dd>.consensus.json
	function Download()
	{
		let name = ports.Project.Name.replace( /[\\\/:*?"<>|]+/g, '-' ).trim() || 'project';
		let blob = new Blob( [ ports.Json ], { type: 'application/json' } );
		let link = document.createElement( 'a' );
		link.href = URL.createObjectURL( blob );
		link.download = name + '-' + today() + '.consensus.json';
		document.body.appendChild( link );
		link.click();
		link.remove();
		URL.revokeObjectURL( link.href );
	}


	//-----------------------------------------------------------------
	// Import

	// Import into the root given (the first when none is).
	function StartImport( Root )
	{
		reset( 'import', Root || Roots.List[ 0 ] );
	}


	async function Load( File )
	{
		ports.Json = await File.text();
		ports.Preview = null;
		ports.Error = '';
	}


	// The pasted text as json, or null with the error said.
	function parsed()
	{
		try
		{
			return JSON.parse( ports.Json );
		}
		catch ( error )
		{
			ports.Error = 'this is not json: ' + error.message;
			return null;
		}
	}


	async function Preview()
	{
		ports.Error = '';
		ports.Preview = null;
		let exported = parsed();
		if ( !exported )
		{
			return;
		}
		ports.Busy = true;
		try
		{
			ports.Preview = ( await Client.Post( ports.Root, '/api/projects/import', { Export: exported, Preview: true } ) ).Preview;
		}
		catch ( error )
		{
			ports.Error = error.message;
		}
		ports.Busy = false;
	}


	// Mode: 'copy' | 'merge' for a project that is here; nothing for a new one.
	async function Import( Mode )
	{
		ports.Error = '';
		let exported = parsed();
		if ( !exported )
		{
			return;
		}
		let body = { Export: exported };
		if ( Mode )
		{
			body.Mode = Mode;
		}
		ports.Busy = true;
		try
		{
			ports.Report = ( await Client.Post( ports.Root, '/api/projects/import', body ) ).Report;
			ports.Json = '';
			await Roots.LoadList( ports.Root );
		}
		catch ( error )
		{
			ports.Error = error.message;
		}
		ports.Busy = false;
	}


	ports.Close = Close;
	ports.StartExport = StartExport;
	ports.ShowExport = ShowExport;
	ports.Copy = Copy;
	ports.Download = Download;
	ports.StartImport = StartImport;
	ports.Load = Load;
	ports.Preview = null;
	ports.RunPreview = Preview;
	ports.Import = Import;
	return ports;
} ] )


//---------------------------------------------------------------------
// The popup: the export's json with Copy and Download, or the import's paste box, preview, choice and report.

.controller( 'PortController', [ '$scope', 'Ports', function ( $scope, Ports )
{
	$scope.Ports = Ports;


	async function run( work )
	{
		await work();
		$scope.$applyAsync();
	}


	$scope.Copy = function () { return run( Ports.Copy ); };
	$scope.Download = function () { Ports.Download(); };
	$scope.Load = function ( File ) { return run( function () { return Ports.Load( File ); } ); };
	$scope.Preview = function () { return run( Ports.RunPreview ); };
	$scope.Import = function ( Mode ) { return run( function () { return Ports.Import( Mode ); } ); };
	$scope.Close = function () { Ports.Close(); };


	$scope.Key = function ( event )
	{
		if ( event.key === 'Escape' )
		{
			event.stopPropagation();
			Ports.Close();
		}
	};


	// "3 plans, 1 document, 4 threads", leaving out the noughts.
	$scope.MadeLine = function ( made )
	{
		let parts = [];
		function add( count, one, many )
		{
			if ( count )
			{
				parts.push( count + ' ' + ( ( count === 1 ) ? one : many ) );
			}
		}
		add( made.Plans, 'plan', 'plans' );
		add( made.Documents, 'document', 'documents' );
		add( made.Threads, 'thread', 'threads' );
		return parts.length ? parts.join( ', ' ) : 'nothing new';
	};


	// "+2 revisions, +1 thread, +3 replies", or "no change".
	$scope.MergedLine = function ( merged )
	{
		let parts = [];
		if ( merged.Revisions )
		{
			parts.push( '+' + merged.Revisions + ' revision' + ( ( merged.Revisions === 1 ) ? '' : 's' ) );
		}
		if ( merged.Threads )
		{
			parts.push( '+' + merged.Threads + ' thread' + ( ( merged.Threads === 1 ) ? '' : 's' ) );
		}
		if ( merged.Replies )
		{
			parts.push( '+' + merged.Replies + ' repl' + ( ( merged.Replies === 1 ) ? 'y' : 'ies' ) );
		}
		return parts.length ? parts.join( ', ' ) : 'no change';
	};
} ] );
