'use strict';

// Corpus - what an attached zip gives a project: its text files, and a reason for each file left out. A file is let
// in by the corpus's Include and Exclude and the zip's own .gitignore files (Filter.js), and read unless it is larger
// than the limit or binary (it holds a NUL byte). The limits come from the settings ("Corpus" in consensus.json):
//
//   { "MaxZipMegabytes": 50, "MaxFileKilobytes": 512 }
//
//   Extract( Zip, Limits, Rules? ) -> { Files: [ { Path, Size, Indexed, Reason? } ], Texts: { Path: text } }
//     Rules = { Include, Exclude }, the corpus entry's
//   ReadFile( Zip, Path ) -> text, or null when the zip has no such file

const PATH = require( 'path' );
const ZIP = require( './Zip.js' );
const FILTER = require( './Filter.js' );

const DEFAULT_LIMITS = {
	MaxZipMegabytes: 50,
	MaxFileKilobytes: 512,
};


//---------------------------------------------------------------------
// Limits: the settings' Corpus, each value defaulted.

function Limits( Settings )
{
	let given = ( Settings && Settings.Corpus ) || {};
	return {
		MaxZipMegabytes: ( given.MaxZipMegabytes > 0 ) ? given.MaxZipMegabytes : DEFAULT_LIMITS.MaxZipMegabytes,
		MaxFileKilobytes: ( given.MaxFileKilobytes > 0 ) ? given.MaxFileKilobytes : DEFAULT_LIMITS.MaxFileKilobytes,
	};
}


//---------------------------------------------------------------------
// Extract: every file of the zip listed; the text of each one that is indexed.

async function Extract( Zip, Limits_, Rules )
{
	let max_bytes = Limits_.MaxFileKilobytes * 1024;
	let is_gitignore = function ( path ) { return PATH.posix.basename( path ) === '.gitignore'; };
	let gitignores = ( await ZIP.Entries( Zip, is_gitignore ) ).filter( function ( entry ) { return is_gitignore( entry.Path ); } ).map( function ( entry )
	{
		let base = PATH.posix.dirname( entry.Path );
		return { Base: ( base === '.' ) ? '' : base, Text: entry.Data ? entry.Data.toString( 'utf8' ) : '' };
	} );
	let why = FILTER.Make( { Include: Rules && Rules.Include, Exclude: Rules && Rules.Exclude, Gitignores: gitignores } );
	let reasons = {};
	function want( path, size )
	{
		let left_out = why( path );
		if ( left_out )
		{
			reasons[ path ] = left_out;
			return false;
		}
		if ( size > max_bytes )
		{
			reasons[ path ] = 'larger than ' + Limits_.MaxFileKilobytes + ' KB';
			return false;
		}
		return true;
	}
	let entries = await ZIP.Entries( Zip, want );
	let files = [];
	let texts = {};
	for ( let entry of entries )
	{
		let file = { Path: entry.Path, Size: entry.Size, Indexed: false };
		if ( entry.Data && entry.Data.includes( 0 ) )
		{
			reasons[ entry.Path ] = 'binary (holds a NUL byte)';
		}
		else if ( entry.Data )
		{
			file.Indexed = true;
			texts[ entry.Path ] = entry.Data.toString( 'utf8' );
		}
		if ( reasons[ entry.Path ] )
		{
			file.Reason = reasons[ entry.Path ];
		}
		files.push( file );
	}
	files.sort( function ( a, b ) { return a.Path.localeCompare( b.Path ); } );
	return { Files: files, Texts: texts };
}


//---------------------------------------------------------------------
// ReadFile: one file's text from the zip.

async function ReadFile( Zip, Path )
{
	let entries = await ZIP.Entries( Zip, function ( path ) { return path === Path; } );
	let entry = entries.find( function ( candidate ) { return candidate.Path === Path; } );
	return entry ? entry.Data.toString( 'utf8' ) : null;
}


module.exports = {
	DEFAULT_LIMITS: DEFAULT_LIMITS,
	Limits: Limits,
	Extract: Extract,
	ReadFile: ReadFile,
};
