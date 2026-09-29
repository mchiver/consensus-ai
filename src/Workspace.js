'use strict';

// Workspace - a folder read as it is now, for a worker's file tools (plans Workers and Review): glob, grep and read,
// within Root, its Include and Exclude, and every .gitignore under it. Nothing is indexed. A path outside Root is
// refused, links included; a file larger than MaxFileKilobytes, or binary (it holds a NUL byte), is not read.
//
//   { "Kind": "Workspace", "Name": "Consensus", "Root": "W:/code/consensus.git", "Include": [], "Exclude": [ ".git/**" ] }

const FS = require( 'fs' );
const PATH = require( 'path' );
const IGNORE = require( 'ignore' );

const DEFAULT_MAX_FILE_KILOBYTES = 512;
const MAX_GLOB_PATHS = 500;
const MAX_GREP_MATCHES = 200;
const MAX_LINE_LENGTH = 400;
const DEFAULT_READ_LINES = 2000;


//---------------------------------------------------------------------
// Walk: the files under Root that Include, Exclude and the .gitignore files let in, as posix paths relative to Root.
// A folder left out is not walked; .git never is. A link is followed only when it lands inside Root.

function Walk( Root, Include, Exclude )
{
	let root = FS.realpathSync( Root );
	let exclude = IGNORE().add( [ '.git/' ].concat( Exclude || [] ) );
	let include = ( Include && Include.length ) ? IGNORE().add( Include ) : null;
	let paths = [];

	function ignored_by( rules, relative, is_folder )
	{
		let target = is_folder ? relative + '/' : relative;
		if ( exclude.ignores( target ) )
		{
			return true;
		}
		for ( let rule of rules )
		{
			let below = rule.Base ? PATH.posix.relative( rule.Base, relative ) : relative;
			if ( below && !below.startsWith( '..' ) && rule.Matcher.ignores( is_folder ? below + '/' : below ) )
			{
				return true;
			}
		}
		return false;
	}

	function visit( folder, base, rules )
	{
		let here = rules;
		let gitignore = PATH.join( folder, '.gitignore' );
		if ( FS.existsSync( gitignore ) )
		{
			here = rules.concat( [ { Base: base, Matcher: IGNORE().add( FS.readFileSync( gitignore, 'utf8' ) ) } ] );
		}
		let entries = FS.readdirSync( folder, { withFileTypes: true } );
		entries.sort( function ( a, b ) { return a.name.localeCompare( b.name ); } );
		for ( let entry of entries )
		{
			let full = PATH.join( folder, entry.name );
			let relative = base ? base + '/' + entry.name : entry.name;
			let is_folder = entry.isDirectory();
			let is_file = entry.isFile();
			if ( entry.isSymbolicLink() )
			{
				let real = null;
				try
				{
					real = FS.realpathSync( full );
				}
				catch ( error )
				{
					continue;
				}
				if ( !Inside( root, real ) )
				{
					continue;
				}
				let stat = FS.statSync( real );
				is_folder = stat.isDirectory();
				is_file = stat.isFile();
			}
			if ( ignored_by( here, relative, is_folder ) )
			{
				continue;
			}
			if ( is_folder )
			{
				visit( full, relative, here );
			}
			else if ( is_file && ( !include || include.ignores( relative ) ) )
			{
				paths.push( relative );
			}
		}
	}

	visit( root, '', [] );
	return paths;
}


// Whether the real path Path is Root itself or under it.
function Inside( Root, Path )
{
	let relative = PATH.relative( Root, Path );
	return relative === '' || ( !relative.startsWith( '..' ) && !PATH.isAbsolute( relative ) );
}


//---------------------------------------------------------------------
// Open( Item, Options? ) -> { Name, Root, Glob, Grep, Read }. Options = { MaxFileKilobytes }. Each tool answers
// with text for the model; one it refuses says why, starting "refused:".

function Open( Item, Options )
{
	let root = FS.realpathSync( Item.Root );
	let max_bytes = ( ( Options && Options.MaxFileKilobytes ) || DEFAULT_MAX_FILE_KILOBYTES ) * 1024;


	function files()
	{
		return Walk( root, Item.Include, Item.Exclude );
	}


	// A path the model gave, as the workspace's posix path, or null when it is not one of its files.
	function known( path )
	{
		let given = String( path || '' ).split( '\\' ).join( '/' ).replace( /^\.\//, '' );
		if ( PATH.isAbsolute( given ) || /^[a-zA-Z]:/.test( given ) )
		{
			let real = null;
			try
			{
				real = FS.realpathSync( given );
			}
			catch ( error )
			{
				return null;
			}
			if ( !Inside( root, real ) )
			{
				return null;
			}
			given = PATH.relative( root, real ).split( PATH.sep ).join( '/' );
		}
		return files().includes( given ) ? given : null;
	}


	// A file's text, or null when it is too large or binary.
	function text_of( path )
	{
		let full = PATH.join( root, path.split( '/' ).join( PATH.sep ) );
		let real = FS.realpathSync( full );
		if ( !Inside( root, real ) )
		{
			return null;
		}
		let stat = FS.statSync( real );
		if ( stat.size > max_bytes )
		{
			return null;
		}
		let data = FS.readFileSync( real );
		return data.includes( 0 ) ? null : data.toString( 'utf8' );
	}


	// Glob { Pattern }: the paths that match, gitignore-style ("**/*.js", "src/*.md", "Api.js").
	function Glob( Pattern )
	{
		let pattern = String( Pattern || '' ).trim();
		if ( !pattern )
		{
			return 'refused: a Pattern is required';
		}
		let matcher = IGNORE().add( pattern );
		let matched = files().filter( function ( path ) { return matcher.ignores( path ); } );
		if ( !matched.length )
		{
			return 'no files match ' + pattern;
		}
		let shown = matched.slice( 0, MAX_GLOB_PATHS );
		let more = ( matched.length > shown.length ) ? '\n… and ' + ( matched.length - shown.length ) + ' more' : '';
		return shown.join( '\n' ) + more;
	}


	// Grep { Pattern, Glob?, IgnoreCase? }: the lines that match a regular expression, as path:line: text.
	function Grep( Pattern, Glob_, IgnoreCase )
	{
		let expression = null;
		try
		{
			expression = new RegExp( String( Pattern || '' ), IgnoreCase ? 'i' : '' );
		}
		catch ( error )
		{
			return 'refused: the Pattern is not a regular expression: ' + error.message;
		}
		if ( !String( Pattern || '' ) )
		{
			return 'refused: a Pattern is required';
		}
		let paths = files();
		if ( Glob_ )
		{
			let matcher = IGNORE().add( String( Glob_ ) );
			paths = paths.filter( function ( path ) { return matcher.ignores( path ); } );
		}
		let lines = [];
		let total = 0;
		for ( let path of paths )
		{
			let text = null;
			try
			{
				text = text_of( path );
			}
			catch ( error )
			{
				continue;
			}
			if ( text === null )
			{
				continue;
			}
			let numbered = text.split( /\r?\n/ );
			for ( let index = 0; index < numbered.length; index++ )
			{
				if ( expression.test( numbered[ index ] ) )
				{
					total++;
					if ( lines.length < MAX_GREP_MATCHES )
					{
						lines.push( path + ':' + ( index + 1 ) + ': ' + clip( numbered[ index ] ) );
					}
				}
			}
		}
		if ( !lines.length )
		{
			return 'no lines match ' + Pattern;
		}
		return lines.join( '\n' ) + ( ( total > lines.length ) ? '\n… and ' + ( total - lines.length ) + ' more' : '' );
	}


	// Read { Path, Offset?, Limit? }: a file's lines, numbered from 1; Offset is the first line to show.
	function Read( Path, Offset, Limit )
	{
		let path = known( Path );
		if ( !path )
		{
			return 'refused: ' + String( Path || '' ) + ' is not a file of the workspace (outside it, left out, or not there)';
		}
		let text = text_of( path );
		if ( text === null )
		{
			return 'refused: ' + path + ' is larger than ' + ( max_bytes / 1024 ) + ' KB, or binary';
		}
		let all = text.split( /\r?\n/ );
		let first = Math.max( 1, parseInt( Offset, 10 ) || 1 );
		let count = Math.max( 1, parseInt( Limit, 10 ) || DEFAULT_READ_LINES );
		let shown = all.slice( first - 1, first - 1 + count );
		let body = shown.map( function ( line, index ) { return String( first + index ).padStart( 6, ' ' ) + '\t' + clip( line ); } ).join( '\n' );
		let last = first - 1 + shown.length;
		let rest = ( last < all.length ) ? '\n… lines ' + ( last + 1 ) + ' to ' + all.length + ' not shown' : '';
		return body + rest;
	}


	return { Name: Item.Name, Root: root, Files: files, Glob: Glob, Grep: Grep, Read: Read };
}


function clip( line )
{
	return ( line.length > MAX_LINE_LENGTH ) ? line.slice( 0, MAX_LINE_LENGTH ) + '…' : line;
}


module.exports = {
	Walk: Walk,
	Inside: Inside,
	Open: Open,
};
