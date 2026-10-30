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
// take the guide's path, so the Sidecar app serves its own, .guides/build-with-sidecar.md (SIDECAR_GUIDE_PATH). Plan
// Review 2026-10-29, Step 5.3: Local composes the text of the Client's and the Desktop's own address (electron/Proxy.js),
// which forwards to a Server with the signed-in person's token: the local address, the Server behind it, the window's
// project (the Client) or the Desktop's other Servers, the token rule and the MCP's address, over the common guide.

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
// Local( Base, Guide, { Edition, Upstream, Project?, Others?, SignedIn } ): the text at a Client's or a Desktop's own
// address (plan Review 2026-10-29, Step 5.3). Base is the local address as the request reached it; Upstream the Server
// the calls go to now, { Name, Url }, or null; Project the window's one project { Id, Name } (the Client), null for a
// window on a whole Server or in the Desktop; Others the Desktop's Servers' names (the current one among them), reached
// under Base/servers/<name>/api; SignedIn whether a person's token is there to add.

function Local( Base, Guide, About )
{
	let about = About || {};
	let edition = about.Edition || 'application';
	let upstream = about.Upstream || null;
	let lines = [ '# This server', '' ];
	if ( upstream )
	{
		lines.push( '- API: ' + Base + '/api, the local address of this Consensus ' + edition + ': every call is forwarded to the Server ' + ( upstream.Name ? upstream.Name + ' at ' : '' ) + upstream.Url + ', which answers it as its own.' );
	}
	else
	{
		lines.push( '- API: ' + Base + '/api, the local address of this Consensus ' + edition + ': no Server is open in this window yet, so a call answers 503 until one is.' );
	}
	if ( about.Project )
	{
		lines.push( '- The project: ' + about.Project.Name + ' (' + about.Project.Id + '), the one open in this window. Work in it alone, and give it where an operation takes a Project.' );
	}
	else if ( edition === 'Desktop' )
	{
		let others = ( about.Others || [] ).filter( function ( name ) { return !upstream || name !== upstream.Name; } );
		lines.push( '- The current Server: the one whose project is open in the window now; its projects are those the person\'s roles allow (list_projects, GET ' + Base + '/api/projects). The current Server changes as the person opens a project elsewhere: when a call answers an unknown project, read these instructions again before going on.' );
		if ( others.length )
		{
			lines.push( '- The Desktop\'s other Servers are reached under ' + Base + '/servers/<name>/api (and /servers/<name>/instructions): ' + others.join( ', ' ) + '.' );
		}
	}
	else
	{
		lines.push( '- The projects: those of the Server the person\'s roles allow (list_projects, GET ' + Base + '/api/projects).' );
	}
	if ( about.SignedIn )
	{
		lines.push( '- No token: a request with none acts for the person signed in to this window: this address adds their session token. A request carrying its own "Authorization: Bearer <token>" is passed as it is. The Server does the authorizing: you may do what their roles allow.' );
	}
	else
	{
		lines.push( '- No token: a request with none acts for the person signed in to this window, once someone is: until then it is answered 401 "sign in". A request carrying its own "Authorization: Bearer <token>" is passed as it is. The Server does the authorizing: you may do what their roles allow.' );
	}
	lines.push( '- Say who you are: send the header "' + PARTICIPANTS.SERVICE_HEADER + ': <your name>" (letters, digits, dot, dash and colon) with every request; what you post then reads "<your name> by <the person>".' );
	lines.push( '- MCP: POST ' + Base + '/api/mcp, the same tools as on a Server; the stdio shim is node <checkout>/bin/mcp.js --server ' + Base + ' --service <your name>.' );
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
	Local: Local,
	Guide: Guide,
	Attach: Attach,
	SIDECAR_GUIDE_PATH: SIDECAR_GUIDE_PATH,
};
