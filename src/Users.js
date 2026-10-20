'use strict';

// Users - the registry of a server's accounts (plan User Management, Step 3; the model is Accounts and Roles'):
// <config>/Users.json, { Users: [ record ] }, on every server. A Local server holds the owner's record and the Service
// accounts the owner makes; a Public server holds the people Clerk identifies (their records made by the Administrator
// now, completed by Clerk at their first sign-in, plan Clerk) and the Service accounts. No credentials: a token is
// kept as a sha256 of its value, the value shown once when minted. Plan is the license the account's last sign-in
// showed (User or Host, plan Clerk Step 5), null before one.
//
//   record = { Id (usr-…), Type: 'owner' | 'user' | 'service', Login, Display, Email, Clerk, Plan, Tokens: [ { Name, Hash, Created, LastUsed } ], Created }
//   Users( { Folder } ) -> {
//     List(), Get( Id ), ByLogin( Login ), ByToken( Value ) -> { Record, Token } | null,
//     Create( { Type, Login, Display, Email? } ) -> record (throws on a problem),
//     Update( Id, { Login?, Display?, Email?, Clerk?, Plan? } ) -> record,  Delete( Id ) -> true | false,
//     MintToken( Id, Name ) -> value (throws when the name is taken),  RevokeToken( Id, Name ) -> true | false,
//     Touch( Id, Name ): the token's LastUsed, written once a minute at most,
//     Migrate( Settings ) -> lines: the owner's record made or brought up to the settings' Owner,
//     IsAdmin( Settings, Record ), Public( Record ), Path() }

const FS = require( 'fs' );
const PATH = require( 'path' );
const CRYPTO = require( 'crypto' );
const IDS = require( './Ids.js' );
const PARTICIPANTS = require( './Participants.js' );

const FILE = 'Users.json';
const TYPES = [ 'owner', 'user', 'service' ];
const LOGIN = /^[A-Za-z0-9._-]{1,40}$/;
const TOKEN_NAME = /^[A-Za-z0-9 ._:-]{1,40}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOUCH_INTERVAL = 60 * 1000;


function hash_of( value )
{
	return CRYPTO.createHash( 'sha256' ).update( String( value ) ).digest( 'hex' );
}


function now()
{
	return new Date().toISOString();
}


function Users( Options )
{
	let folder = ( Options || {} ).Folder;
	let path = PATH.join( folder, FILE );
	let users = null;		// the list, read once and kept


	function load()
	{
		if ( users )
		{
			return users;
		}
		try
		{
			let read = JSON.parse( FS.readFileSync( path, 'utf8' ) );
			users = Array.isArray( read.Users ) ? read.Users.map( fill ) : [];
		}
		catch ( error )
		{
			users = [];
		}
		return users;
	}


	function save()
	{
		FS.mkdirSync( folder, { recursive: true } );
		let temporary = path + '.' + process.pid + '.tmp';
		FS.writeFileSync( temporary, JSON.stringify( { Users: users }, null, '\t' ) + '\n' );
		FS.renameSync( temporary, path );
	}


	function fill( record )
	{
		let given = ( record && typeof record === 'object' ) ? record : {};
		return {
			Id: given.Id || IDS.New( IDS.USER ),
			Type: TYPES.includes( given.Type ) ? given.Type : 'user',
			Login: String( given.Login || '' ).trim(),
			Display: String( given.Display || given.Login || '' ).trim(),
			Email: given.Email ? String( given.Email ).trim() : null,
			Clerk: given.Clerk || null,
			Plan: given.Plan || null,
			Tokens: ( Array.isArray( given.Tokens ) ? given.Tokens : [] ).map( function ( token )
			{
				return { Name: String( token.Name || '' ), Hash: String( token.Hash || '' ), Created: token.Created || null, LastUsed: token.LastUsed || null };
			} ),
			Created: given.Created || now(),
		};
	}


	function same_login( a, b )
	{
		return String( a || '' ).toLowerCase() === String( b || '' ).toLowerCase();
	}


	//-----------------------------------------------------------------

	function List()
	{
		return load().slice();
	}


	function Get( Id )
	{
		return load().find( function ( record ) { return record.Id === Id; } ) || null;
	}


	function ByLogin( Login )
	{
		return load().find( function ( record ) { return same_login( record.Login, Login ); } ) || null;
	}


	// The record and the token a value belongs to, or null.
	function ByToken( Value )
	{
		let hash = hash_of( String( Value || '' ).trim() );
		for ( let record of load() )
		{
			let token = record.Tokens.find( function ( one ) { return one.Hash === hash; } );
			if ( token )
			{
				return { Record: record, Token: token };
			}
		}
		return null;
	}


	// Problems with a login, a display and an email, as sentences; Id the record being changed, so its own login passes.
	function problems_of( fields, id )
	{
		let problems = [];
		if ( fields.Login !== undefined )
		{
			let login = String( fields.Login || '' ).trim();
			if ( !LOGIN.test( login ) )
			{
				problems.push( 'the login is letters, digits, dot, dash and underscore, up to 40' );
			}
			else
			{
				let taken = ByLogin( login );
				if ( taken && taken.Id !== id )
				{
					problems.push( 'the login "' + login + '" is taken' );
				}
			}
		}
		if ( fields.Display !== undefined && typeof fields.Display !== 'string' )
		{
			problems.push( 'the display name must be text' );
		}
		if ( fields.Email !== undefined && fields.Email !== null && fields.Email !== '' && !EMAIL.test( String( fields.Email ) ) )
		{
			problems.push( 'the email must be an email address' );
		}
		return problems;
	}


	// Create( { Type, Login, Display?, Email? } ): a user (an email) or a Service account (none); the owner's record is Migrate's.
	function Create( Fields )
	{
		let fields = Fields || {};
		let type = ( fields.Type === 'service' ) ? 'service' : 'user';
		let problems = problems_of( { Login: fields.Login, Display: fields.Display, Email: fields.Email }, null );
		if ( type === 'user' && !( fields.Email && EMAIL.test( String( fields.Email ) ) ) )
		{
			problems.push( 'a user needs an email address' );
		}
		if ( problems.length )
		{
			throw new Error( problems.join( '; ' ) );
		}
		let record = fill( { Type: type, Login: String( fields.Login ).trim(), Display: ( typeof fields.Display === 'string' && fields.Display.trim() ) ? fields.Display.trim() : String( fields.Login ).trim(), Email: ( type === 'user' ) ? String( fields.Email ).trim() : null } );
		load().push( record );
		save();
		return record;
	}


	function Update( Id, Fields )
	{
		let record = Get( Id );
		if ( !record )
		{
			return null;
		}
		let fields = Fields || {};
		let problems = problems_of( fields, Id );
		if ( problems.length )
		{
			throw new Error( problems.join( '; ' ) );
		}
		if ( fields.Login !== undefined && record.Type !== 'owner' )
		{
			record.Login = String( fields.Login ).trim();
		}
		if ( typeof fields.Display === 'string' && fields.Display.trim() )
		{
			record.Display = fields.Display.trim();
		}
		if ( fields.Email !== undefined && record.Type === 'user' )
		{
			record.Email = fields.Email ? String( fields.Email ).trim() : null;
		}
		if ( fields.Clerk !== undefined )
		{
			record.Clerk = fields.Clerk || null;
		}
		if ( fields.Plan !== undefined )
		{
			record.Plan = fields.Plan || null;
		}
		save();
		return record;
	}


	function Delete( Id )
	{
		let list = load();
		let at = list.findIndex( function ( record ) { return record.Id === Id; } );
		if ( at < 0 || list[ at ].Type === 'owner' )
		{
			return false;
		}
		list.splice( at, 1 );
		save();
		return true;
	}


	//-----------------------------------------------------------------
	// Tokens: minted with a name, the value answered once; revoked by name; LastUsed touched as requests come.

	function MintToken( Id, Name )
	{
		let record = Get( Id );
		if ( !record )
		{
			throw new Error( 'no account with the id ' + Id );
		}
		let name = String( Name || '' ).trim();
		if ( !TOKEN_NAME.test( name ) )
		{
			throw new Error( 'a token name is letters, digits, space, dot, dash, underscore and colon, up to 40' );
		}
		if ( record.Tokens.some( function ( token ) { return token.Name === name; } ) )
		{
			throw new Error( 'the token name "' + name + '" is taken; revoke it first' );
		}
		let value = PARTICIPANTS.NewToken();
		record.Tokens.push( { Name: name, Hash: hash_of( value ), Created: now(), LastUsed: null } );
		save();
		return value;
	}


	function RevokeToken( Id, Name )
	{
		let record = Get( Id );
		if ( !record )
		{
			return false;
		}
		let at = record.Tokens.findIndex( function ( token ) { return token.Name === Name; } );
		if ( at < 0 )
		{
			return false;
		}
		record.Tokens.splice( at, 1 );
		save();
		return true;
	}


	function Touch( Id, Name )
	{
		let record = Get( Id );
		let token = record ? record.Tokens.find( function ( one ) { return one.Name === Name; } ) : null;
		if ( !token )
		{
			return;
		}
		let at = now();
		if ( token.LastUsed && ( new Date( at ) - new Date( token.LastUsed ) ) < TOUCH_INTERVAL )
		{
			return;
		}
		token.LastUsed = at;
		save();
	}


	//-----------------------------------------------------------------
	// Migrate( Settings ): the owner's record made at the first start, or its Login and Display brought up to the
	// settings' Owner. Returns the lines to log.

	function Migrate( Settings )
	{
		let lines = [];
		let owner = PARTICIPANTS.Owner( Settings );
		let record = load().find( function ( one ) { return one.Type === 'owner'; } );
		if ( !record )
		{
			record = fill( { Type: 'owner', Login: owner.Name, Display: owner.Display, Email: null } );
			users.unshift( record );
			save();
			lines.push( 'Users.json made with the owner ' + JSON.stringify( owner.Name ) );
		}
		else if ( record.Login !== owner.Name || record.Display !== owner.Display )
		{
			record.Login = owner.Name;
			record.Display = owner.Display;
			save();
			lines.push( 'the owner\'s record brought up to the settings: ' + owner.Name + ', shown as ' + owner.Display );
		}
		return lines;
	}


	// The Administrator: the owner, or on a Public server with Clerk the account whose Email is the AdminEmail.
	function IsAdmin( Settings, Record )
	{
		if ( !Record )
		{
			return false;
		}
		if ( Record.Type === 'owner' )
		{
			return true;
		}
		let clerk = ( Settings && Settings.Clerk && typeof Settings.Clerk === 'object' ) ? Settings.Clerk : null;
		let admin_email = ( clerk && typeof clerk.AdminEmail === 'string' ) ? clerk.AdminEmail.trim().toLowerCase() : '';
		return !!( admin_email && Record.Email && Record.Email.toLowerCase() === admin_email );
	}


	// Public( Record, WithTokens? ): the record as the API shows it; the tokens by name, created and last use, never a hash.
	function Public( Record, WithTokens )
	{
		if ( !Record )
		{
			return null;
		}
		let shown = { Id: Record.Id, Type: Record.Type, Login: Record.Login, Display: Record.Display, Email: Record.Email || null, Clerk: Record.Clerk ? true : false, Plan: Record.Plan || null, Created: Record.Created };
		if ( WithTokens )
		{
			shown.Tokens = Record.Tokens.map( function ( token ) { return { Name: token.Name, Created: token.Created, LastUsed: token.LastUsed }; } );
		}
		return shown;
	}


	function Path()
	{
		return path;
	}


	return {
		List: List,
		Get: Get,
		ByLogin: ByLogin,
		ByToken: ByToken,
		Create: Create,
		Update: Update,
		Delete: Delete,
		MintToken: MintToken,
		RevokeToken: RevokeToken,
		Touch: Touch,
		Migrate: Migrate,
		IsAdmin: IsAdmin,
		Public: Public,
		Path: Path,
	};
}


module.exports = {
	Users: Users,
	TYPES: TYPES,
	FILE: FILE,
};
