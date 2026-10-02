'use strict';

// Files - the files a workspace includes (plan UI Tweaks IV): walked from its Path with its Include and Exclude
// patterns, as posix paths relative to it. A pattern is a glob: `**` crosses folders, `*` and `?` stay within a
// name; one without a slash matches at any depth. Include empty means everything. An excluded folder is not
// entered. Links are not followed.
//
//   Walk( Path, Include, Exclude, Limit? ) -> { Count, Files: [ the first Limit paths ], Truncated }
//   Matches( Pattern, Path ) -> boolean

const FS = require( 'fs' );
const PATH = require( 'path' );

const DEFAULT_LIMIT = 500;


//---------------------------------------------------------------------
// A glob as a regular expression over a relative posix path.

function regexp_of( pattern )
{
	let glob = String( pattern || '' ).trim().replace( /\\/g, '/' ).replace( /^\.\//, '' ).replace( /\/+$/, '' );
	let anywhere = !glob.includes( '/' );
	let source = '';
	for ( let index = 0; index < glob.length; index++ )
	{
		let letter = glob[ index ];
		if ( letter === '*' )
		{
			if ( glob[ index + 1 ] === '*' )
			{
				index++;
				if ( glob[ index + 1 ] === '/' )
				{
					index++;
					source += '(?:.*/)?';
				}
				else
				{
					source += '.*';
				}
			}
			else
			{
				source += '[^/]*';
			}
		}
		else if ( letter === '?' )
		{
			source += '[^/]';
		}
		else if ( '\\^$.|+()[]{}'.includes( letter ) )
		{
			source += '\\' + letter;
		}
		else
		{
			source += letter;
		}
	}
	return new RegExp( ( anywhere ? '(?:^|.*/)' : '^' ) + source + '$' );
}


function Matches( Pattern, Path )
{
	return regexp_of( Pattern ).test( String( Path ).replace( /\\/g, '/' ) );
}


function matcher( patterns )
{
	let regexps = ( patterns || [] ).filter( function ( pattern ) { return String( pattern ).trim(); } ).map( regexp_of );
	return function ( path, is_folder )
	{
		for ( let regexp of regexps )
		{
			if ( regexp.test( path ) )
			{
				return true;
			}
			// a folder is excluded when the pattern names it, or everything under it
			if ( is_folder && ( regexp.test( path + '/' ) || regexp.test( path + '/x' ) ) )
			{
				return true;
			}
		}
		return false;
	};
}


//---------------------------------------------------------------------
// Walk

function Walk( Path, Include, Exclude, Limit )
{
	let root = PATH.resolve( String( Path || '' ) );
	let limit = ( Limit === undefined ) ? DEFAULT_LIMIT : Limit;
	let excluded = matcher( Exclude );
	let included = ( Include && Include.filter( function ( pattern ) { return String( pattern ).trim(); } ).length ) ? matcher( Include ) : null;
	let count = 0;
	let files = [];
	if ( !Path || !FS.existsSync( root ) || !FS.statSync( root ).isDirectory() )
	{
		return { Count: 0, Files: [], Truncated: false, Error: Path ? 'not a folder: ' + root : 'no Path' };
	}

	function visit( folder, base )
	{
		let entries = [];
		try
		{
			entries = FS.readdirSync( folder, { withFileTypes: true } );
		}
		catch ( error )
		{
			return;
		}
		entries.sort( function ( a, b ) { return a.name.localeCompare( b.name ); } );
		for ( let entry of entries )
		{
			let relative = base ? base + '/' + entry.name : entry.name;
			if ( entry.isDirectory() )
			{
				if ( !excluded( relative, true ) )
				{
					visit( PATH.join( folder, entry.name ), relative );
				}
			}
			else if ( entry.isFile() )
			{
				if ( excluded( relative, false ) || ( included && !included( relative, false ) ) )
				{
					continue;
				}
				count++;
				if ( files.length < limit )
				{
					files.push( relative );
				}
			}
		}
	}

	visit( root, '' );
	return { Count: count, Files: files, Truncated: count > files.length };
}


module.exports = {
	DEFAULT_LIMIT: DEFAULT_LIMIT,
	Matches: Matches,
	Walk: Walk,
};
