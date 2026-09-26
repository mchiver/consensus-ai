'use strict';

// Corpus view - an uploaded zip: its files, which were indexed and why the others were not, one file's text,
// and Replace (a new zip), Rename and Delete (to the trash). A file is shown as plain text, never as HTML:
// a zip can hold anything.

angular.module( 'Consensus' ).controller( 'CorpusController', [ '$scope', '$window', 'State', 'Client', 'Tabs', function ( $scope, $window, State, Client, Tabs )
{
	$scope.State = State;
	$scope.Corpus = null;
	$scope.Project = null;
	$scope.File = null;
	$scope.Renaming = null;
	$scope.ConfirmingDelete = false;
	$scope.Busy = false;


	function path_of( id )
	{
		return '/api/corpus/' + encodeURIComponent( id );
	}


	async function load()
	{
		let id = State.CorpusId;
		if ( !id || State.View !== 'corpus' )
		{
			return;
		}
		let answer = await State.Act( function () { return Client.Get( path_of( id ) ); } );
		if ( id !== State.CorpusId )
		{
			return;
		}
		$scope.Corpus = answer ? answer.Corpus : null;
		$scope.Project = answer ? answer.Project : null;
		if ( $scope.File && $scope.Corpus && !$scope.Corpus.Files.some( function ( file ) { return file.Path === $scope.File.Path && file.Indexed; } ) )
		{
			$scope.File = null;
		}
		// A search hit asked for one of its files.
		let pending = State.PendingFile;
		State.PendingFile = null;
		let wanted = ( pending && $scope.Corpus ) ? $scope.Corpus.Files.find( function ( file ) { return file.Path === pending; } ) : null;
		if ( wanted )
		{
			await $scope.ShowFile( wanted );
		}
		$scope.$applyAsync();
	}


	// A linked corpus's files, listed again by its context server.
	$scope.Reload = function ()
	{
		load();
	};


	$scope.$watchGroup( [ function () { return State.CorpusId; }, function () { return State.View; } ], function ( values, previous )
	{
		if ( values[ 0 ] !== previous[ 0 ] )
		{
			$scope.File = null;
			$scope.Renaming = null;
			$scope.ConfirmingDelete = false;
		}
		load();
	} );


	$scope.$on( 'changed', function ( event, change )
	{
		if ( change.Corpus && change.Corpus === State.CorpusId )
		{
			if ( change.Kind === 'trashed' )
			{
				// its tab closes (AppController sees the same event)
				return;
			}
			load();
		}
	} );


	$scope.IndexedCount = function ()
	{
		return $scope.Corpus ? $scope.Corpus.Files.filter( function ( file ) { return file.Indexed; } ).length : 0;
	};


	$scope.ShowFile = async function ( file )
	{
		if ( !file.Indexed )
		{
			return;
		}
		let answer = await State.Act( function ()
		{
			return Client.Get( path_of( State.CorpusId ) + '/file?path=' + encodeURIComponent( file.Path ) );
		} );
		$scope.File = answer;
		$scope.$applyAsync();
	};


	$scope.Replace = async function ( File )
	{
		$scope.Busy = true;
		let answer = await State.Act( function () { return Client.Upload( 'PUT', path_of( State.CorpusId ), File ); } );
		$scope.Busy = false;
		if ( answer )
		{
			$scope.File = null;
			await load();
			State.LoadList();
		}
		$scope.$applyAsync();
	};


	$scope.StartRename = function ()
	{
		$scope.Renaming = { Name: $scope.Corpus.Name };
	};


	$scope.CancelRename = function ()
	{
		$scope.Renaming = null;
	};


	$scope.Rename = async function ()
	{
		let name = ( $scope.Renaming && $scope.Renaming.Name || '' ).trim();
		if ( !name )
		{
			return;
		}
		let answer = await State.Act( function () { return Client.Put( path_of( State.CorpusId ) + '/name', { Name: name } ); } );
		if ( answer )
		{
			$scope.Renaming = null;
			await load();
			State.LoadList();
		}
		$scope.$applyAsync();
	};


	$scope.Delete = async function ()
	{
		$scope.Busy = true;
		let id = State.CorpusId;
		let answer = await State.Act( function () { return Client.Delete( path_of( id ) ); } );
		$scope.Busy = false;
		$scope.ConfirmingDelete = false;
		if ( answer )
		{
			Tabs.CloseItem( id );
			State.LoadList();
		}
		$scope.$applyAsync();
	};
} ] );
