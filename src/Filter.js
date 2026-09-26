'use strict';

// Filter - which paths of a corpus are let in: Include and Exclude (glob patterns relative to the corpus's root, in
// .gitignore syntax) and the .gitignore files found in it, each applying to its own folder and below. Exclude wins;
// an empty Include means every path. Read with the ignore library.
//
//   Make( { Include, Exclude, Gitignores: [ { Base, Text } ] } ) -> Why( Path ): null when Path is let in, or why not

const PATH = require( 'path' );
const IGNORE = require( 'ignore' );


function Make( Rules )
{
	let rules = Rules || {};
	let exclude = IGNORE().add( list_of( rules.Exclude ) );
	let include = list_of( rules.Include ).length ? IGNORE().add( list_of( rules.Include ) ) : null;
	let gitignores = ( rules.Gitignores || [] ).map( function ( gitignore )
	{
		return { Base: gitignore.Base || '', Matcher: IGNORE().add( String( gitignore.Text || '' ) ) };
	} );

	return function Why( Path )
	{
		let path = String( Path );
		if ( exclude.ignores( path ) )
		{
			return 'left out by Exclude';
		}
		for ( let gitignore of gitignores )
		{
			let below = gitignore.Base ? PATH.posix.relative( gitignore.Base, path ) : path;
			if ( below && !below.startsWith( '..' ) && gitignore.Matcher.ignores( below ) )
			{
				return 'left out by ' + ( gitignore.Base ? gitignore.Base + '/' : '' ) + '.gitignore';
			}
		}
		if ( include && !include.ignores( path ) )
		{
			return 'not in Include';
		}
		return null;
	};
}


// Patterns as a list of non-empty strings.
function list_of( patterns )
{
	return ( Array.isArray( patterns ) ? patterns : [] ).map( function ( pattern ) { return String( pattern ).trim(); } ).filter( function ( pattern ) { return pattern.length > 0; } );
}


module.exports = {
	Make: Make,
	Patterns: list_of,
};
