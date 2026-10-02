'use strict';

// Files - the files a workspace includes (plan UI Tweaks IV): walked from its Path with its Include and Exclude
// patterns, as posix paths relative to it. A pattern is a glob: `**` crosses folders, `*` and `?` stay within a
// name; one without a slash matches at any depth. Include empty means everything. An excluded folder is not
// entered. Links are not followed.
//
//   Walk( Path, Include, Exclude, Limit? ) -> { Count, Files: [ the first Limit paths ], Truncated }
//   Matches( Pattern, Path ) -> boolean
//   Within( Root, Include, Exclude, Path ) -> { Ok: true, Relative, Absolute } | { Ok: false, Error }
//     (Step 4: whether a path a tool names is a file the workspace includes; its folders are checked as the walk does)

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


//---------------------------------------------------------------------
// Within: a path the model names, relative to the workspace or absolute inside it, as the walk would see it.

function Within( Root, Include, Exclude, Path )
{
	let root = PATH.resolve( String( Root || '' ) );
	let given = String( Path || '' ).trim().replace( /\\/g, '/' );
	if ( !given )
	{
		return { Ok: false, Error: 'a Path is needed' };
	}
	let absolute = PATH.resolve( root, given );
	let relative = PATH.relative( root, absolute ).replace( /\\/g, '/' );
	if ( !relative || relative === '..' || relative.startsWith( '../' ) || PATH.isAbsolute( relative ) )
	{
		return { Ok: false, Error: given + ' is outside the workspace' };
	}
	let excluded = matcher( Exclude );
	let parts = relative.split( '/' );
	for ( let index = 1; index < parts.length; index++ )
	{
		if ( excluded( parts.slice( 0, index ).join( '/' ), true ) )
		{
			return { Ok: false, Error: relative + ' is in a folder the workspace excludes' };
		}
	}
	if ( excluded( relative, false ) )
	{
		return { Ok: false, Error: relative + ' is a file the workspace excludes' };
	}
	let patterns = ( Include || [] ).filter( function ( pattern ) { return String( pattern ).trim(); } );
	if ( patterns.length && !matcher( patterns )( relative, false ) )
	{
		return { Ok: false, Error: relative + ' is not a file the workspace includes (' + patterns.join( ', ' ) + ')' };
	}
	return { Ok: true, Relative: relative, Absolute: absolute };
}


module.exports = {
	DEFAULT_LIMIT: DEFAULT_LIMIT,
	Matches: Matches,
	Walk: Walk,
	Within: Within,
};
