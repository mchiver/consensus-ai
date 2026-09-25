'use strict';

// Corpus - what an uploaded zip gives a project: its text files, and a reason for each file left out.
// The limits come from the settings ("Corpus" in consensus.json), with these defaults:
//
//   { "MaxZipMegabytes": 50, "MaxFileKilobytes": 512, "Extensions": [ ".md", ".txt", ... ] }
//
//   Extract( Zip, Limits ) -> { Files: [ { Path, Size, Indexed, Reason? } ], Texts: { Path: text } }
//   ReadFile( Zip, Path ) -> text, or null when the zip has no such file

const PATH = require( 'path' );
const ZIP = require( './Zip.js' );

const DEFAULT_LIMITS = {
	MaxZipMegabytes: 50,
	MaxFileKilobytes: 512,
	Extensions: [ '.md', '.txt', '.js', '.json', '.html', '.css', '.py', '.cs', '.sql', '.yml', '.yaml', '.xml', '.sh', '.ps1' ],
};


//---------------------------------------------------------------------
// Limits: the settings' Corpus, each value defaulted.

function Limits( Settings )
{
	let given = ( Settings && Settings.Corpus ) || {};
	return {
		MaxZipMegabytes: ( given.MaxZipMegabytes > 0 ) ? given.MaxZipMegabytes : DEFAULT_LIMITS.MaxZipMegabytes,
		MaxFileKilobytes: ( given.MaxFileKilobytes > 0 ) ? given.MaxFileKilobytes : DEFAULT_LIMITS.MaxFileKilobytes,
		Extensions: Array.isArray( given.Extensions ) ? given.Extensions.map( function ( extension ) { return String( extension ).toLowerCase(); } ) : DEFAULT_LIMITS.Extensions.slice(),
	};
}


//---------------------------------------------------------------------
// Extract: every file of the zip listed; the text of each one that is indexed.

async function Extract( Zip, Limits_ )
{
	let max_bytes = Limits_.MaxFileKilobytes * 1024;
	let reasons = {};
	function want( path, size )
	{
		let extension = PATH.posix.extname( path ).toLowerCase();
		if ( !Limits_.Extensions.includes( extension ) )
		{
			reasons[ path ] = 'not a text type: ' + ( extension || 'no extension' );
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
