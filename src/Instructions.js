'use strict';

// Instructions - GET /instructions: what an agent session needs to work with Consensus, as plain text.
// The guide (.guides/build-with-consensus.md, read on each request so an edit shows at once) with a This server
// section put first: the API's address, made from the address the request reached, and the llm participant's
// token. Security is relaxed for now: the token is served to whoever reads the page.

const PATH = require( 'path' );
const FS = require( 'fs' );

const GUIDE_PATH = PATH.join( __dirname, '..', '.guides', 'build-with-consensus.md' );


//---------------------------------------------------------------------
// Make( Settings, Base, Guide ): the page's text. Base is 'http://<host>:<port>' as the request reached us.

function Make( Settings, Base, Guide )
{
	let participants = ( Settings && Settings.Participants ) || [];
	let llm = participants.find( function ( participant ) { return participant.Role === 'llm'; } );
	let token = ( llm && llm.Token ) ? llm.Token : null;
	let lines = [
		'# This server',
		'',
		'- API: ' + Base + '/api',
		'- Token of the `' + ( llm ? llm.Name : 'llm' ) + '` participant: ' + ( token || '(none set: the owner gives the llm participant a Token in consensus.json)' ),
		'- Send it as: Authorization: Bearer <token>',
		'- These instructions: ' + Base + '/instructions',
		'',
		'',
	];
	return lines.join( '\n' ) + Guide;
}


//---------------------------------------------------------------------
// Attach( App, { Settings } ): the route.

function Attach( App, Options )
{
	App.get( '/instructions', async function ( request, response )
	{
		let guide = null;
		try
		{
			guide = await FS.promises.readFile( GUIDE_PATH, 'utf8' );
		}
		catch ( error )
		{
			return response.status( 500 ).type( 'text/plain' ).send( 'the guide is missing: ' + GUIDE_PATH + '\n' );
		}
		let base = request.protocol + '://' + request.get( 'host' );
		response.type( 'text/plain; charset=utf-8' ).send( Make( Options.Settings, base, guide ) );
	} );
}


module.exports = {
	Make: Make,
	Attach: Attach,
	GUIDE_PATH: GUIDE_PATH,
};
