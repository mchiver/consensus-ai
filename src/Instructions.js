'use strict';

// Instructions - GET /instructions: what an agent session needs to work with Consensus, as plain text.
// The guide (.guides/build-with-consensus.md, read on each request so an edit shows at once) with a This server
// section put first: the API's address, made from the address the request reached, and how to say who you are
// (plan User Management, Step 2: no token is served; a request with none is the owner on this server, and the
// header "X-Consensus-Service: <name>" names the service, so its posts read "<name> by <owner>"). A run's package
// (plan Run Shapes, Step 3) makes the same text with the run's token and connection, with Guide() and Make( …, Run ).

const PATH = require( 'path' );
const FS = require( 'fs' );
const PARTICIPANTS = require( './Participants.js' );
const TASKS = require( './Tasks.js' );

const GUIDE_PATH = PATH.join( __dirname, '..', '.guides', 'build-with-consensus.md' );


//---------------------------------------------------------------------
// Make( Settings, Base, Guide, Run? ): the page's text. Base is 'http://<host>:<port>' as the request reached us;
// Run ({ Service, Token, Writes? }) is a run's connection, token and level, for its package; the public page has none.

function Make( Settings, Base, Guide, Run )
{
	let owner = PARTICIPANTS.Owner( Settings );
	let lines = [ '# This server', '', '- API: ' + Base + '/api' ];
	if ( Run && Run.Token )
	{
		lines.push( '- Your token, sent as "Authorization: Bearer <token>": ' + Run.Token );
		lines.push( '- What you post reads "' + Run.Service + ' by ' + owner.Display + '": you act for ' + owner.Display + ', the owner, through the LLM connection "' + Run.Service + '".' );
		if ( Run.Writes )
		{
			lines.push( '- Writes: ' + TASKS.WritesLine( Run.Writes ) );
		}
	}
	else
	{
		lines.push( '- No token: a request with none is the owner, ' + owner.Display + ', on this server.' );
		lines.push( '- Say who you are: send the header "' + PARTICIPANTS.SERVICE_HEADER + ': <your name>" (letters, digits, dot, dash and colon) with every request; what you post then reads "<your name> by ' + owner.Display + '".' );
	}
	lines.push( '- These instructions: ' + Base + '/instructions', '', '' );
	return lines.join( '\n' ) + Guide;
}


//---------------------------------------------------------------------
// Guide(): the guide's text, read each time; throws when the file is missing.

async function Guide()
{
	return await FS.promises.readFile( GUIDE_PATH, 'utf8' );
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
			guide = await Guide();
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
	Guide: Guide,
	Attach: Attach,
	GUIDE_PATH: GUIDE_PATH,
};
