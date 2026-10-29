'use strict';

// Instructions - GET /instructions: what an agent session needs to work with Consensus, as plain text.
// The guide (.guides/build-with-consensus.md, read on each request so an edit shows at once) with a This server
// section put first: the API's address, made from the address the request reached, and how to say who you are
// (plan User Management, Step 2: no token is served; a request with none is the owner on this server, and the
// header "X-Consensus-Service: <name>" names the service, so its posts read "<name> by <owner>"). A run's package
// (plan Run Shapes, Step 3) makes the same text with the run's token and connection, with Guide() and Make( …, Run ).
// A sidecar (plan Rearchitecturation, Step 3: a one-project server) names its project and the one-project rule.
// Plan The Server, Step 5: on a Server (People) a request needs a token; the text says so, and the page's LLM
// Instructions popup puts a token minted for the person at its top. Plan Sidecar Edition, Step 3: Attach and Guide
// take the guide's path, so the Sidecar app serves its own, .guides/build-with-sidecar.md (SIDECAR_GUIDE_PATH).

const PATH = require( 'path' );
const FS = require( 'fs' );
const PARTICIPANTS = require( './Participants.js' );
const TASKS = require( './Tasks.js' );

const GUIDE_PATH = PATH.join( __dirname, '..', '.guides', 'build-with-consensus.md' );
const SIDECAR_GUIDE_PATH = PATH.join( __dirname, '..', '.guides', 'build-with-sidecar.md' );


//---------------------------------------------------------------------
// Make( Settings, Base, Guide, Run?, Project?, People? ): the page's text. Base is 'http://<host>:<port>' as the request
// reached us; Run ({ Service, Token, Writes? }) is a run's connection, token and level, for its package; the public
// page has none. Project ({ Id, Name, Path }) is a sidecar's one project. People: a Server, where a request needs a token.

function Make( Settings, Base, Guide, Run, Project, People )
{
	let owner = PARTICIPANTS.Owner( Settings );
	let lines = [ '# This server', '', '- API: ' + Base + '/api' ];
	if ( Project )
	{
		lines.push( '- This is a sidecar over one project: ' + Project.Name + ' (' + Project.Id + ')' + ( Project.Path ? ' at ' + Project.Path : '' ) + '. It is the only project here; work in it alone, and give it where an operation takes a Project.' );
	}
	if ( Run && Run.Token )
	{
		lines.push( '- Your token, sent as "Authorization: Bearer <token>": ' + Run.Token );
		let presser = ( Run.By && Run.By.Name ) ? Run.By : { Name: owner.Name, Display: owner.Display, Role: 'owner' };
		let standing = { Owners: 'an Owner of the project', Members: 'a Member of the project', Watchers: 'a Watcher of the project' }[ presser.Role ] || 'the owner';
		lines.push( '- What you post reads "' + Run.Service + ' by ' + ( presser.Display || presser.Name ) + '": you act for ' + ( presser.Display || presser.Name ) + ', ' + standing + ', through the LLM connection "' + Run.Service + '".' );
		if ( Run.Writes )
		{
			lines.push( '- Writes: ' + TASKS.WritesLine( Run.Writes ) );
		}
	}
	else if ( People )
	{
		lines.push( '- Sign in: this server tells people apart, and a request with no token is refused.' );
		lines.push( '- Send "Authorization: Bearer <token>" with every request: the token at the top of this text when it came from a project\'s LLM Instructions, or one minted on your account\'s page (Users in the sidebar). You act as that account, allowed what its role in each project allows.' );
		lines.push( '- Say who you are: send the header "' + PARTICIPANTS.SERVICE_HEADER + ': <your name>" (letters, digits, dot, dash and colon) with every request; what you post then reads "<your name> by <the account>".' );
	}
	else
	{
		lines.push( '- No token: a request with none is the owner, ' + owner.Display + ', on this server.' );
		lines.push( '- Say who you are: send the header "' + PARTICIPANTS.SERVICE_HEADER + ': <your name>" (letters, digits, dot, dash and colon) with every request; what you post then reads "<your name> by ' + owner.Display + '".' );
		if ( !Project )
		{
			lines.push( '- A token minted on an account\'s page (Users in the sidebar), sent as "Authorization: Bearer <token>", makes the request that account instead, allowed what its role in the project allows.' );
		}
	}
	lines.push( '- These instructions: ' + Base + '/instructions', '', '' );
	return lines.join( '\n' ) + Guide;
}


//---------------------------------------------------------------------
// Guide(): the guide's text, read each time; throws when the file is missing.

// Guide( Path? ): the guide's text; Path another guide than GUIDE_PATH.
async function Guide( Path )
{
	return await FS.promises.readFile( Path || GUIDE_PATH, 'utf8' );
}


//---------------------------------------------------------------------
// Attach( App, { Settings, Project?, People?, Guide? } ): the route; Guide the guide's path, GUIDE_PATH when none.

function Attach( App, Options )
{
	App.get( '/instructions', async function ( request, response )
	{
		let guide = null;
		let path = Options.Guide || GUIDE_PATH;
		try
		{
			guide = await Guide( path );
		}
		catch ( error )
		{
			return response.status( 500 ).type( 'text/plain' ).send( 'the guide is missing: ' + path + '\n' );
		}
		let base = request.protocol + '://' + request.get( 'host' );
		response.type( 'text/plain; charset=utf-8' ).send( Make( Options.Settings, base, guide, null, Options.Project || null, !!Options.People ) );
	} );
}


module.exports = {
	Make: Make,
	Guide: Guide,
	Attach: Attach,
	SIDECAR_GUIDE_PATH: SIDECAR_GUIDE_PATH,
};
