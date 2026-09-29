'use strict';

// Corpus view - an uploaded zip: its files, which were indexed and why the others were not, one file's text,
// and Replace (a new zip). Rename and Delete are in its row's menu in the tree. A file is
// shown as plain text, never as HTML: a zip can hold anything.

angular.module( 'Consensus' ).controller( 'CorpusController', [ '$scope', '$window', 'State', 'Client', function ( $scope, $window, State, Client )
{
	$scope.State = State;
	$scope.Corpus = null;
	$scope.Project = null;
	$scope.File = null;
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
		let filter_was_edited = $scope.FilterChanged();
		$scope.Corpus = answer ? answer.Corpus : null;
		$scope.Project = answer ? answer.Project : null;
		// An edit in progress is kept over a reload; otherwise the boxes show what is saved.
		if ( !filter_was_edited )
		{
			$scope.ResetFilter();
		}
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


	//-----------------------------------------------------------------
	// Include and Exclude: one pattern per line in the boxes, a list on the corpus.

	$scope.Filter = { Include: '', Exclude: '' };

	function lines_of( patterns )
	{
		return ( patterns || [] ).join( '\n' );
	}


	function patterns_of( text )
	{
		return String( text || '' ).split( /\r?\n/ ).map( function ( line ) { return line.trim(); } ).filter( function ( line ) { return line.length > 0; } );
	}


	$scope.FilterChanged = function ()
	{
		if ( !$scope.Corpus )
		{
			return false;
		}
		return lines_of( patterns_of( $scope.Filter.Include ) ) !== lines_of( $scope.Corpus.Include ) || lines_of( patterns_of( $scope.Filter.Exclude ) ) !== lines_of( $scope.Corpus.Exclude );
	};


	$scope.ResetFilter = function ()
	{
		$scope.Filter = { Include: lines_of( $scope.Corpus ? $scope.Corpus.Include : [] ), Exclude: lines_of( $scope.Corpus ? $scope.Corpus.Exclude : [] ) };
	};


	$scope.SaveFilter = async function ()
	{
		let id = State.CorpusId;
		$scope.Busy = true;
		let answer = await State.Act( function ()
		{
			return Client.Put( path_of( id ) + '/filter', { Include: patterns_of( $scope.Filter.Include ), Exclude: patterns_of( $scope.Filter.Exclude ) } );
		} );
		$scope.Busy = false;
		if ( answer && id === State.CorpusId )
		{
			$scope.Corpus = Object.assign( {}, $scope.Corpus, { Include: answer.Corpus.Include, Exclude: answer.Corpus.Exclude } );
			$scope.ResetFilter();
			await load();
			State.LoadList();
		}
		$scope.$applyAsync();
	};


	$scope.$watchGroup( [ function () { return State.CorpusId; }, function () { return State.View; } ], function ( values, previous )
	{
		if ( values[ 0 ] !== previous[ 0 ] )
		{
			$scope.File = null;
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


} ] );
