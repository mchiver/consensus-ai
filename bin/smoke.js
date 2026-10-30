'use strict';

// smoke - the page and the applications looked at end to end, by hand (plan UI Components, Step 6). Not a test that npm
// test runs: it needs the installed Chrome or Edge, and Electron with a screen. First a temporary server with a plan
// and two threads, and a headless browser through the page: the title bar, the application menu, the look popover,
// the layout filling the window, the tree, the header, the threads pane, the Read view's anchors, the Edit view in
// both engines, no console errors. Then the Client app (plan Review 2026-10-29, Step 5.1: one remote project on one
// Server) on a temporary config and its own --user-data-dir, over its own DevTools port: the chooser with its Servers
// alone, a temporary server's project opened in the window through the bridge, the window controls overlay, the title
// bar as the drag region, the menu's items, the overlay following the theme and the size, a detached window, Quit.
// Then the Server application (plan The Server, Step 3) on a temporary config and its own --user-data-dir: its gate
// closed with no current user (the sign-in with the reason), open for a Personal one (the whole tree, the Users fold),
// and a second launch with --open handed to the first, which registers the folder. Then the Sidecar app (plan Sidecar
// Edition, Step 5) on a temporary folder and its own --user-data-dir: no sign-in, its menus, About and guide, the user
// renamed and the theme set into the project's sidecar.json, Quit, and both back after a restart. Then the Desktop
// (plan Review 2026-10-29, Step 5.1: several Servers at once, one sign-in; the Client's code base of before) over two
// temporary servers: the sign-in box alone, no configuration on the page, its menus and About, a task's run followed
// from the press, Add server, Quit.
// Each check prints ok or FAIL; the exit code is 1 when any failed. Pictures go to ~smoke/ in the checkout (a tilde
// keeps the folder out of source control): the page in both themes, and captures of the windows' tops, from the
// screen, since the window buttons are not part of the page.
//
//   npm run smoke                     the page, then the four applications
//   npm run smoke -- --no-desktop     the page alone (no Client, no Server application, no Sidecar, no Desktop)
//
// Nothing of the real config folder or the real user data is touched: both are temporary and removed after.

const FS = require( 'fs' );
const OS = require( 'os' );
const PATH = require( 'path' );
const CHILD_PROCESS = require( 'child_process' );
const SERVER = require( '../src/Server.js' );
const PARTICIPANTS = require( '../src/Participants.js' );
const CDP = require( '../test/support/Cdp.js' );
const SERVICE = require( '../test/support/Service.js' );

const ROOT = PATH.join( __dirname, '..' );
const OUT = PATH.join( ROOT, '~smoke' );
const DESKTOP_PORT = 9337;
const SERVER_APP_PORT = 9338;
const SIDECAR_APP_PORT = 9339;
const CLIENT_APP_PORT = 9340;
const WIDTH = 1400;
const HEIGHT = 900;
const PLAN_TITLE = 'Smoke plan';
const PLAN_TEXT = '# Smoke plan\n\nThe first paragraph makes a **bold claim** here.\n\n- one list item\n- another one\n\nA closing line.\n';

let failed = 0;


function wait( Ms )
{
	return new Promise( function ( Resolve ) { setTimeout( Resolve, Ms ); } );
}


// One check: a value, and what it should be (or truthy when Expected is left out).
function check( Label, Value, Expected )
{
	let passed = ( Expected === undefined ) ? !!Value : ( Value === Expected );
	if ( !passed )
	{
		failed++;
	}
	console.log( ( passed ? 'ok   ' : 'FAIL ' ) + Label + ': ' + JSON.stringify( Value ) );
}


function count_of( Selector )
{
	return 'document.querySelectorAll( ' + JSON.stringify( Selector ) + ' ).length';
}


function text_of( Selector )
{
	return '( document.querySelector( ' + JSON.stringify( Selector ) + ' ) || { textContent: "" } ).textContent.trim()';
}


async function api( Url, Method, Path, Body )
{
	let options = { method: Method, headers: {} };
	if ( Body !== undefined )
	{
		options.headers[ 'Content-Type' ] = 'application/json';
		options.body = JSON.stringify( Body );
	}
	let response = await fetch( Url + Path, options );
	let json = await response.json().catch( function () { return {}; } );
	if ( !response.ok )
	{
		throw new Error( Method + ' ' + Path + ' answered ' + response.status + ': ' + ( json.Error || '' ) );
	}
	return json;
}


// A plan with a contested and a resolved thread, on the server at Url. Returns the plan.
async function make_plan( Url )
{
	let plan = ( await api( Url, 'POST', '/api/plans', { Title: PLAN_TITLE, Text: PLAN_TEXT } ) ).Plan;
	await api( Url, 'POST', '/api/plans/' + plan.Id + '/threads', { Text: 'Why this claim?', Anchor: { Text: 'bold claim' } } );
	await api( Url, 'POST', '/api/plans/' + plan.Id + '/threads', { Text: 'Keep it.', Anchor: { Text: 'another one' }, Resolve: true } );
	return plan;
}


async function screenshot( Page, Name )
{
	let result = await Page.Send( 'Page.captureScreenshot', { format: 'png' } );
	FS.writeFileSync( PATH.join( OUT, Name + '.png' ), Buffer.from( result.data, 'base64' ) );
	console.log( 'wrote ~smoke/' + Name + '.png' );
}


// The one popup menu's items, as text.
const MENU_ITEMS = '[ ...document.querySelectorAll( "#popup-menu .menu-button" ) ].map( function ( button ) { return button.textContent.trim(); } ).join( "|" )';


// The theme picked in the look popover, by its label, as a person picks it.
function pick_theme( Label )
{
	return '( function () { let select = document.getElementById( "theme-select" ); select.selectedIndex = [ ...select.options ].findIndex( function ( option ) { return option.textContent.trim() === ' + JSON.stringify( Label ) + '; } ); select.dispatchEvent( new Event( "change" ) ); return true; } )()';
}


//---------------------------------------------------------------------
// The page, in a headless browser over a temporary server.

async function smoke_page()
{
	console.log( '== the page' );
	let data = FS.mkdtempSync( PATH.join( OS.tmpdir(), 'consensus-smoke-' ) );
	FS.writeFileSync( PATH.join( data, 'consensus.json' ), JSON.stringify( PARTICIPANTS.DefaultSettings( 3500 ), null, '\t' ) );
	let running = await SERVER.Start( { Data: data, Port: 0 } );
	let browser = null;
	try
	{
		let plan = await make_plan( running.Url );
		browser = await CDP.StartBrowser( { Width: WIDTH, Height: HEIGHT } );
		let page = await browser.OpenPage( running.Url + '/#/p/' + plan.Id );
		await page.WaitFor( count_of( '.header .title' ) + ' === 1 && document.querySelector( ".connection" ) !== null && document.querySelector( ".connection" ).classList.contains( "live" )', 30000 );
		await wait( 500 );

		// the title bar
		check( 'title bar: the brand', await page.Evaluate( text_of( 'title-bar .brand' ) ), 'Consensus' );
		check( 'title bar: the menu button, the waiting link and the look button', await page.Evaluate( count_of( '#title-bar #app-menu' ) + ' + ' + count_of( '#title-bar #waiting-link' ) + ' + ' + count_of( '#title-bar #look-button' ) ), 3 );
		check( 'title bar: no Running link while nothing runs', await page.Evaluate( count_of( '#running-link' ) ), 0 );
		await page.Evaluate( 'document.getElementById( "app-menu" ).click(); true' );
		await page.WaitFor( count_of( '#popup-menu .menu-button' ) + ' === 2' );
		check( 'menu: About and Hotkeys, nothing of the desktop', await page.Evaluate( MENU_ITEMS ), 'About|Hotkeys' );
		await page.Press( 'Escape' );
		await page.WaitFor( 'getComputedStyle( document.getElementById( "popup-menu" ) ).display === "none"' );
		await page.Click( '#look-button' );
		await page.WaitFor( count_of( '#look-popover select' ) + ' === 4' );
		check( 'look popover: four selects (theme, size, margins, editor)', await page.Evaluate( count_of( '#look-popover select' ) ), 4 );
		await page.Press( 'Escape' );
		await page.WaitFor( count_of( '#look-popover' ) + ' === 0' );
		check( 'look popover: Escape closes it', await page.Evaluate( count_of( '#look-popover' ) ), 0 );

		// the layout
		let layout = JSON.parse( await page.Evaluate( '( function () { let bar = document.querySelector( "title-bar" ).getBoundingClientRect(); let grid = document.querySelector( ".layout" ).getBoundingClientRect(); return JSON.stringify( { Bar: bar.height, Top: grid.top, Bottom: grid.bottom, Inner: window.innerHeight, Scroll: document.documentElement.scrollHeight } ); } )()' ) );
		check( 'layout: the grid starts under the bar and ends at the window', Math.round( layout.Top ) === Math.round( layout.Bar ) && Math.round( layout.Bottom ) === layout.Inner );
		check( 'layout: no page scroll', layout.Scroll, layout.Inner );

		// the tree and the header (the tree's rows come with the lists, a moment after the page: waited for)
		await page.WaitFor( count_of( '.project.open' ) + ' === 1 && ' + count_of( '.tree-item.open[data-id="' + plan.Id + '"]' ) + ' === 1' );
		check( 'tree: the project is open and the plan is its row', await page.Evaluate( count_of( '.project.open' ) + ' === 1 && ' + count_of( '.tree-item.open[data-id="' + plan.Id + '"]' ) + ' === 1' ), true );
		check( 'header: the title', await page.Evaluate( text_of( '.header .title' ) ), PLAN_TITLE );
		check( 'header: the location line', await page.Evaluate( count_of( '#location .crumb-link' ) ) >= 1 );
		check( 'header: the size', /chars/.test( await page.Evaluate( text_of( '#text-size' ) ) ) );

		// the threads pane and the Read view's anchors
		await page.Evaluate( '( function () { let injector = angular.element( document.body ).injector(); injector.get( "State" ).SetFilter( "all" ); injector.get( "$rootScope" ).$apply(); return true; } )()' );
		await page.WaitFor( count_of( '.thread:not(.compose)' ) + ' === 2' );
		check( 'threads: both threads listed with the filter at all', await page.Evaluate( count_of( '.thread:not(.compose)' ) ), 2 );
		// the editor is the view (CodeMirror, the default since plan Markdown Editor, Step 5), with the two marks
		await page.WaitFor( count_of( '#editor .cm-editor' ) + ' === 1 && ' + count_of( '#editor .cm-content .anchor' ) + ' === 2', 30000 );
		check( 'editor: the two passages are marked', await page.Evaluate( '[ ...document.querySelectorAll( "#editor .cm-content .anchor" ) ].map( function ( mark ) { return mark.className.replace( / selected/, "" ); } ).sort().join( "," )' ), 'anchor contested,anchor resolved' );
		check( 'edit: the Live Preview with the Source button, no preview pane or Preview button (plan Markdown Editor, Step 1)', await page.Evaluate( count_of( '#editor .cm-editor.cm-live' ) + ' + ' + count_of( '#view-source' ) + ' + ' + count_of( '.edit-preview' ) + ' + ' + count_of( '#preview-toggle' ) ), 2 );
		check( 'one view: no Read or Edit; Source, Revisions and Save in the heading; no edit bar (plan Markdown Editor, Step 3)', await page.Evaluate( count_of( '#view-read' ) + ' + ' + count_of( '#view-edit' ) + ' + ' + count_of( '.edit-bar' ) + ' === 0 && ' + count_of( '#view-source' ) + ' + ' + count_of( '#view-revisions' ) + ' + ' + count_of( '.header #save-button' ) + ' === 3' ), true );
		check( 'edit: the list renders with bullets', await page.Evaluate( count_of( '#editor .cm-live-bullet' ) ), 2 );
		// a selection in the editor offers the buttons (plan Markdown Editor, Step 2): the line scrolled to through the view, then dragged along
		await page.Evaluate( '( function () { let view = window.CodeMirror6.EditorView.findFromDOM( document.querySelector( "#editor .cm-editor" ) ); let at = view.state.doc.toString().indexOf( "A closing line." ); view.dispatch( { effects: window.CodeMirror6.EditorView.scrollIntoView( at, { y: "center" } ) } ); return true; } )()' );
		await wait( 300 );
		let line = await page.Evaluate( '( function () { let one = [ ...document.querySelectorAll( "#editor .cm-line" ) ].find( function ( l ) { return l.textContent.trim() === "A closing line."; } ); let r = one.getBoundingClientRect(); let range = document.createRange(); range.selectNodeContents( one ); let t = range.getBoundingClientRect(); return { x1: t.x + 1, x2: t.x + t.width + 4, y: r.y + r.height / 2 }; } )()' );
		await page.Send( 'Input.dispatchMouseEvent', { type: 'mousePressed', x: line.x1, y: line.y, button: 'left', clickCount: 1 } );
		await page.Send( 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: ( line.x1 + line.x2 ) / 2, y: line.y, button: 'left', buttons: 1 } );
		await page.Send( 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: line.x2, y: line.y, button: 'left', buttons: 1 } );
		await page.Send( 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: line.x2, y: line.y, button: 'left', clickCount: 1 } );
		await page.WaitFor( count_of( '.edit-view .comment-button.shown' ) + ' === 3', 5000 );
		check( 'edit: a selection offers Copy, Comment and Start a new Subplan', await page.Evaluate( count_of( '.edit-view .comment-button.shown' ) ), 3 );
		await page.Press( 'Escape' );
		await wait( 300 );
		await screenshot( page, 'page-light' );

		// Monaco mode, through the Editor setting in the look popover (and the dark theme): the Read view, then Edit
		await page.Click( '#look-button' );
		await page.WaitFor( count_of( '#look-popover #editor-select' ) + ' === 1' );
		await page.Evaluate( '( function () { let select = document.getElementById( "editor-select" ); select.value = "monaco"; select.dispatchEvent( new Event( "change" ) ); return true; } )()' );
		await page.Evaluate( pick_theme( 'Dark' ) );
		await page.WaitFor( 'document.documentElement.dataset.theme === "dark"' );
		await page.Click( '#look-button' );
		await page.WaitFor( count_of( '#look-popover' ) + ' === 0' );
		await page.WaitFor( count_of( '#view-edit' ) + ' === 1 && ' + count_of( '#read-view .anchor' ) + ' === 2', 30000 );
		check( 'read: Monaco mode shows the Read view with the two passages marked', await page.Evaluate( '[ ...document.querySelectorAll( "#read-view .anchor" ) ].map( function ( mark ) { return mark.className.replace( / selected/, "" ); } ).sort().join( "," )' ), 'anchor contested,anchor resolved' );
		await page.Click( '#view-edit' );
		await page.WaitFor( count_of( '#editor .monaco-editor' ) + ' === 1', 30000 );
		check( 'edit: Monaco opens', await page.Evaluate( count_of( '#editor .monaco-editor' ) ), 1 );
		await wait( 300 );
		await screenshot( page, 'page-dark-monaco' );
		check( 'console: no errors', JSON.stringify( page.Errors ), '[]' );
	}
	finally
	{
		if ( browser )
		{
			await browser.Close();
		}
		await running.Close();
		FS.rmSync( data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 } );
	}
}


//---------------------------------------------------------------------
// An application's pages, over its DevTools port.

async function app_targets( Port )
{
	try
	{
		let list = await ( await fetch( 'http://127.0.0.1:' + Port + '/json/list' ) ).json();
		return list.filter( function ( target ) { return target.type === 'page' && /^http:\/\/127\.0\.0\.1/.test( target.url ); } );
	}
	catch ( error )
	{
		return [];
	}
}


async function wait_target( Port, Test, TimeoutMs )
{
	let limit = Date.now() + ( TimeoutMs || 30000 );
	while ( Date.now() < limit )
	{
		let found = ( await app_targets( Port ) ).find( Test );
		if ( found )
		{
			return found;
		}
		await wait( 250 );
	}
	throw new Error( 'the app did not show the expected page within ' + ( TimeoutMs || 30000 ) + ' ms' );
}


// A capture of the screen where the window's top is: the overlay buttons are the window's, not the page's.
// Windows only (PowerShell and System.Drawing); elsewhere the capture is skipped.
async function capture_window( Page, Name )
{
	if ( process.platform !== 'win32' )
	{
		console.log( 'no screen capture on ' + process.platform );
		return;
	}
	let rect = JSON.parse( await Page.Evaluate( 'JSON.stringify( { X: window.screenX, Y: window.screenY, W: window.outerWidth, H: 90, R: window.devicePixelRatio } )' ) );
	let file = PATH.join( OUT, Name + '.png' ).replace( /\//g, '\\' );
	let dpi = 'using System; using System.Runtime.InteropServices; public class Dpi { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }';
	let script = [
		'Add-Type -AssemblyName System.Drawing',
		"Add-Type -TypeDefinition '" + dpi + "'",
		'[Dpi]::SetProcessDPIAware() | Out-Null',
		'$b = New-Object System.Drawing.Bitmap ' + Math.round( rect.W * rect.R ) + ', ' + Math.round( rect.H * rect.R ),
		'$g = [System.Drawing.Graphics]::FromImage($b)',
		'$g.CopyFromScreen(' + Math.round( rect.X * rect.R ) + ', ' + Math.round( rect.Y * rect.R ) + ', 0, 0, $b.Size)',
		'$b.Save("' + file + '")',
	].join( '; ' );
	CHILD_PROCESS.execFileSync( 'powershell.exe', [ '-NoProfile', '-Command', script ] );
	console.log( 'wrote ~smoke/' + Name + '.png' );
}


// The titlebar area the overlay leaves, and the bar as drawn.
const AREA = '( function () { let r = navigator.windowControlsOverlay.getTitlebarAreaRect(); return JSON.stringify( { X: r.x, Width: r.width, Height: r.height, Inner: window.innerWidth } ); } )()';
const BAR = '( function () { let r = document.querySelector( ".title-bar" ).getBoundingClientRect(); let host = document.querySelector( "title-bar" ).getBoundingClientRect(); return JSON.stringify( { Width: r.width, Height: host.height, Region: getComputedStyle( document.querySelector( ".title-bar" ) ).webkitAppRegion, Button: getComputedStyle( document.getElementById( "app-menu" ) ).webkitAppRegion } ); } )()';
// No frame above the page: the window is taller than the page by its resize borders alone, as it is wider.
const NO_FRAME = '( window.outerHeight - window.innerHeight ) <= ( window.outerWidth - window.innerWidth ) + 2';


// The Client app (plan Review 2026-10-29, Step 5.1: the desktop code of before, narrowed to one remote project on one
// Server), over its DevTools port: a temporary server with a plan, a temporary config whose client.json names it,
// the chooser (the Servers alone: no Open folder, no New project, no recent folders), the Server's project opened in
// the window through the bridge, the one project's page, the window controls overlay, the title bar as the drag
// region, the menu's items, the overlay following the theme and the size, a detached window, and Quit asking about a
// draft.

async function smoke_client()
{
	console.log( '== the Client app' );
	let electron = require( 'electron' );
	let config = FS.mkdtempSync( PATH.join( OS.tmpdir(), 'consensus-smoke-client-config-' ) );
	let user_data = FS.mkdtempSync( PATH.join( OS.tmpdir(), 'consensus-smoke-client-user-data-' ) );
	let base = FS.mkdtempSync( PATH.join( OS.tmpdir(), 'consensus-smoke-client-server-' ) );
	let folder = PATH.join( base, 'project' );
	FS.mkdirSync( folder );
	// the Server the window connects to: a one-project server on a free port, Local, so the probe and the page need no sign-in
	let server = await SERVER.Start( { Project: folder, Config: PATH.join( base, 'config' ), Port: 0, AddressFile: false } );
	let child = null;
	try
	{
		let plan = await make_plan( server.Url );
		let project = ( await api( server.Url, 'GET', '/api/projects' ) ).Projects[ 0 ];
		FS.writeFileSync( PATH.join( config, 'client.json' ), JSON.stringify( { Servers: [ { Name: 'First', Url: server.Url } ] } ) );
		child = CHILD_PROCESS.spawn( electron, [ 'client', '--config', config, '--user-data-dir=' + user_data, '--remote-debugging-port=' + CLIENT_APP_PORT ], { cwd: ROOT, stdio: 'ignore' } );
		let exited = new Promise( function ( Resolve ) { child.on( 'exit', Resolve ); } );
		let chooser_target = await wait_target( CLIENT_APP_PORT, function () { return true; } );
		check( 'chooser: the app opens on it with no --connect', /connect\.html/.test( chooser_target.url ), true );
		let chooser = await CDP.Attach( chooser_target.webSocketDebuggerUrl );
		await chooser.WaitFor( count_of( '.connect-head' ) + ' === 1 && document.body.textContent.indexOf( "{{" ) < 0 && ' + count_of( '.server-row' ) + ' === 1', 30000 );
		await wait( 500 );
		check( 'chooser: the overlay', await chooser.Evaluate( 'navigator.windowControlsOverlay.visible' ), true );
		check( 'chooser: the header is the drag region', await chooser.Evaluate( 'getComputedStyle( document.querySelector( ".connect-head" ) ).webkitAppRegion' ), 'drag' );
		let fit = JSON.parse( await chooser.Evaluate( '( function () { let r = navigator.windowControlsOverlay.getTitlebarAreaRect(); let c = document.querySelector( ".connect-controls" ).getBoundingClientRect(); return JSON.stringify( { Controls: c.right, Area: r.x + r.width, Height: r.height, Head: document.querySelector( ".connect-head" ).getBoundingClientRect().height } ); } )()' ) );
		check( 'chooser: the controls stop before the buttons', fit.Controls <= fit.Area + 1 );
		check( 'chooser: the overlay follows the header', Math.abs( fit.Height - fit.Head ) <= 1 );
		check( 'chooser: the Servers alone, no folder, no New project, no recent', await chooser.Evaluate( count_of( '#add-server' ) + ' + "/" + ' + count_of( '#open-folder, #new-project, #recent-block, #hosts-block' ) ), '1/0' );
		check( 'chooser: the saved Server, with Open', await chooser.Evaluate( text_of( '.server-row .server-name' ) + ' + "/" + ' + count_of( '.server-row .open-server' ) ), 'First/1' );
		check( 'chooser: Connect to Server asks no sign-in first (the Server signs the person in)', await chooser.Evaluate( 'document.getElementById( "add-server" ).disabled' ), false );
		await capture_window( chooser, 'client-chooser' );
		let tried = JSON.parse( await chooser.Evaluate( 'window.Desktop.ServerProjects( ' + JSON.stringify( server.Url ) + ' ).then( JSON.stringify )' ) );
		check( 'chooser: the Server tried, its one project listed', tried.Ok === true && Array.isArray( tried.Projects ) && tried.Projects.length === 1, true );
		// the project opened in this window: the Server saved with it as its last, the page shown
		let answer = JSON.parse( await chooser.Evaluate( 'window.Desktop.ConnectServer( ' + JSON.stringify( { Name: 'First', Url: server.Url, Project: project.Id, Title: project.Name } ) + ' ).then( JSON.stringify )' ) );
		check( 'chooser: Connect answers the project', answer.Ok === true && answer.Project && answer.Project.Name, project.Name );
		let target = await wait_target( CLIENT_APP_PORT, function ( candidate ) { return !/connect\.html/.test( candidate.url ); } );
		let page = await CDP.Attach( target.webSocketDebuggerUrl );
		await page.WaitFor( 'window.ConsensusDesktop !== undefined && ' + count_of( 'title-bar .brand' ) + ' === 1 && document.querySelector( ".connection" ) !== null && document.querySelector( ".connection" ).classList.contains( "live" )', 30000 );
		check( 'project: the window knows its one project', await page.Evaluate( 'window.ConsensusDesktop.Project && window.ConsensusDesktop.Project.Name' ), project.Name );
		check( 'root: the one Server, by its name', await page.Evaluate( 'JSON.stringify( window.ConsensusDesktop.Roots.map( function ( root ) { return root.Key + ":" + root.Kind; } ) )' ), '["First:server"]' );
		await page.WaitFor( count_of( '.root' ) + ' === 1 && ' + count_of( '.project' ) + ' === 1', 30000 );
		check( 'tree: one project view, open, and no root head', await page.Evaluate( count_of( '.project.single.open' ) + ' + "/" + ' + count_of( '.root-head' ) ), '1/0' );
		check( 'session: the window\'s Server is its own', await page.Evaluate( 'angular.element( document.body ).injector().get( "Session" ).Base' ), '/servers/First' );
		// the window's own address (plan Review 2026-10-29, Step 5.3): the instructions composed for this window over the common guide, the API forwarded as the signed-in person (nobody here: 401), an agent's own token passed as it is
		let origin = await page.Evaluate( 'window.location.origin' );
		let local_instructions = await ( await fetch( origin + '/instructions' ) ).text();
		check( 'local API: /instructions names the Client, the Server and the project', /the local address of this Consensus Client: every call is forwarded to the Server First at /.test( local_instructions ) && local_instructions.indexOf( '- The project: ' + project.Name + ' (' + project.Id + ')' ) >= 0 && local_instructions.indexOf( '\n# Build with Consensus' ) > 0, true );
		check( 'local API: a call with no token and nobody signed in is 401 "sign in"', ( await fetch( origin + '/api/me' ) ).status, 401 );
		check( 'local API: a call with its own token reaches the Server', ( await ( await fetch( origin + '/api/me', { headers: { Authorization: 'Bearer not-a-token-of-the-server' } } ) ).json() ).Error !== 'sign in', true );
		check( 'local API: MCP tools/list answers the tools', ( await ( await fetch( origin + '/api/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer any' }, body: JSON.stringify( { jsonrpc: '2.0', id: 1, method: 'tools/list' } ) } ) ).json() ).result.tools.some( function ( tool ) { return tool.name === 'read_plan'; } ), true );
		let saved = JSON.parse( FS.readFileSync( PATH.join( config, 'client.json' ), 'utf8' ) ).Servers[ 0 ];
		check( 'client.json: the Server with its last project', saved.Name + '/' + saved.Project + '/' + saved.Title, 'First/' + project.Id + '/' + project.Name );
		check( 'no local server: no address file in the project folder', FS.existsSync( PATH.join( folder, '.consensus', '~sidecar.json' ) ), false );
		await page.Evaluate( 'window.location.hash = "#/p/' + plan.Id + '"; true' );
		await page.WaitFor( count_of( '.header .title' ) + ' === 1 && ' + count_of( '#editor .cm-editor' ) + ' === 1', 30000 );
		await wait( 800 );

		// the overlay and the bar
		check( 'overlay: visible', await page.Evaluate( 'navigator.windowControlsOverlay && navigator.windowControlsOverlay.visible' ), true );
		let area = JSON.parse( await page.Evaluate( AREA ) );
		let bar = JSON.parse( await page.Evaluate( BAR ) );
		check( 'overlay: the area stops before the window buttons', area.Width < area.Inner && area.Width > area.Inner - 200 );
		check( 'bar: as wide as the area', Math.round( bar.Width ), Math.round( area.Width ) );
		check( 'bar: the drag region', bar.Region, 'drag' );
		check( 'bar: the menu button is not', bar.Button, 'no-drag' );
		check( 'overlay: as high as the bar', Math.abs( area.Height - bar.Height ) <= 1 );
		check( 'window: no native title or menu bar', await page.Evaluate( NO_FRAME ), true );

		// the menu and the bridge
		await page.Evaluate( 'document.getElementById( "app-menu" ).click(); true' );
		await page.WaitFor( count_of( '#popup-menu .menu-button' ) + ' >= 2' );
		let menu_items = await page.Evaluate( MENU_ITEMS );
		// Sign in… sits before Reload when the Server offers Clerk; no folder items (the Client opens no folder)
		check( 'menu: the Client\'s items', /^About\|Hotkeys\|New window\|Settings\|(Sign in…\|)?Reload\|Quit$/.test( menu_items ), true );
		// while the menu is open the bar is no drag region, so a click on it closes the menu (plan UI Tweaks IX)
		check( 'menu: the bar gives up the drag region while a menu is open', await page.Evaluate( 'getComputedStyle( document.querySelector( ".title-bar" ) ).webkitAppRegion' ), 'no-drag' );
		let bar_spot = JSON.parse( await page.Evaluate( '( function () { let r = document.querySelector( ".title-bar" ).getBoundingClientRect(); return JSON.stringify( { x: r.left + r.width / 2, y: r.top + r.height / 2 } ); } )()' ) );
		await page.Send( 'Input.dispatchMouseEvent', { type: 'mousePressed', x: bar_spot.x, y: bar_spot.y, button: 'left', clickCount: 1 } );
		await page.Send( 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: bar_spot.x, y: bar_spot.y, button: 'left', clickCount: 1 } );
		await page.WaitFor( 'getComputedStyle( document.getElementById( "popup-menu" ) ).display === "none"', 5000 );
		check( 'menu: a click on the bar closed it', await page.Evaluate( 'getComputedStyle( document.getElementById( "popup-menu" ) ).display' ), 'none' );
		check( 'menu: the bar is the drag region again', await page.Evaluate( 'getComputedStyle( document.querySelector( ".title-bar" ) ).webkitAppRegion' ), 'drag' );
		check( 'bridge: NewWindow, Quit, SetLicense, SetChrome; no folder picker', await page.Evaluate( 'typeof window.Desktop.NewWindow + "," + typeof window.Desktop.Quit + "," + typeof window.ConsensusDesktop.SetLicense + "," + typeof window.ConsensusDesktop.SetChrome + "," + typeof window.Desktop.PickFolder' ), 'function,function,function,function,undefined' );
		// About names the Client and lists the window's project alone, not the rest of its Server
		await page.Evaluate( 'document.getElementById( "app-menu" ).click(); true' );
		await page.WaitFor( count_of( '#popup-menu .menu-button' ) + ' >= 2' );
		await page.Evaluate( '[ ...document.querySelectorAll( "#popup-menu .menu-button" ) ].find( function ( button ) { return button.textContent.trim() === "About"; } ).click(); true' );
		await page.WaitFor( count_of( '.about-table' ) + ' === 1' );
		check( 'title: Consensus Client', await page.Evaluate( 'JSON.stringify( [ document.querySelector( "title-bar .brand" ).textContent.trim(), document.title ] )' ), JSON.stringify( [ 'Consensus Client', 'Consensus Client' ] ) );
		check( 'about: names Consensus Client', /^About Consensus Client/.test( await page.Evaluate( text_of( '.help-form .subplan-head' ) ) ), true );
		check( 'about: the window\'s project alone', await page.Evaluate( '[ ...document.querySelectorAll( ".about-table tbody tr" ) ].filter( function ( row ) { return getComputedStyle( row ).display !== "none"; } ).length' ), 1 );
		await page.WaitFor( '!!document.activeElement && !!document.activeElement.closest( ".help-form" )', 5000 );
		await page.Press( 'Escape' );
		await page.WaitFor( count_of( '.help-form' ) + ' === 0' );

		// the overlay follows the theme and the size
		await page.Evaluate( 'window.ConsensusTheme.SetTheme( "light" ); true' );
		await wait( 600 );
		await capture_window( page, 'client-light' );
		await page.Click( '#look-button' );
		await page.WaitFor( count_of( '#look-popover #theme-select' ) + ' === 1' );
		await page.Evaluate( pick_theme( 'Dark' ) );
		await wait( 600 );
		check( 'theme: dark applied', await page.Evaluate( 'document.documentElement.dataset.theme' ), 'dark' );
		await capture_window( page, 'client-dark' );
		await page.Press( 'Escape' );
		await page.Evaluate( 'window.ConsensusTheme.SetScale( "large" ); true' );
		await wait( 600 );
		let large_area = JSON.parse( await page.Evaluate( AREA ) );
		let large_bar = JSON.parse( await page.Evaluate( BAR ) );
		check( 'overlay: follows the large size', Math.abs( large_area.Height - large_bar.Height ) <= 1 && large_bar.Height > bar.Height );
		await page.Evaluate( 'window.ConsensusTheme.SetScale( "normal" ); true' );
		await wait( 300 );

		// a detached window
		await page.Evaluate( 'window.open( window.location.origin + "/?detached=1#/p/' + plan.Id + '", "detached-smoke" ); true' );
		let detached_target = await wait_target( CLIENT_APP_PORT, function ( candidate ) { return /detached=1/.test( candidate.url ); } );
		let detached = await CDP.Attach( detached_target.webSocketDebuggerUrl );
		await detached.WaitFor( count_of( 'title-bar .brand' ) + ' === 1 && ' + count_of( '#editor .cm-editor' ) + ' === 1', 30000 );
		await wait( 500 );
		check( 'detached: the overlay', await detached.Evaluate( 'navigator.windowControlsOverlay.visible' ), true );
		check( 'detached: no native title or menu bar', await detached.Evaluate( NO_FRAME ), true );
		check( 'detached: the bar', await detached.Evaluate( text_of( 'title-bar .brand' ) ), 'Consensus Client' );
		await capture_window( detached, 'client-detached' );
		await detached.Evaluate( 'window.close(); true' );
		await wait( 500 );

		// Quit, from the page reloaded (the reload takes the detached tab back in, so a draft on it shows its dot)
		let back = page;
		await page.Send( 'Page.bringToFront' ).catch( function () {} );
		await page.Evaluate( 'window.DocsOldDocument = true; location.reload(); true' );
		await wait( 1000 );
		await back.WaitFor( '!window.DocsOldDocument && ' + count_of( 'title-bar .brand' ) + ' === 1', 30000 );
		// a dirty tab: Quit asks the page, Cancel keeps the app (plan Markdown Editor, Step 4); Confirm on close off, Quit ends it
		await back.Evaluate( 'window.location.hash = "#/p/' + plan.Id + '"; true' );
		await back.WaitFor( text_of( '.header .title' ) + ' === ' + JSON.stringify( PLAN_TITLE ), 30000 );
		await back.Evaluate( '( function () { let injector = angular.element( document.body ).injector(); injector.get( "Tabs" ).SetDraft( ' + JSON.stringify( plan.Id ) + ', { Text: "A draft at closing time.", Base: 1 } ); injector.get( "$rootScope" ).$apply(); return true; } )()' );
		await back.WaitFor( count_of( '.tab .dirty-dot' ) + ' === 1', 5000 );
		await back.Evaluate( 'window.Desktop.Quit(); true' ).catch( function () {} );
		await back.WaitFor( count_of( '#close-popup .close-form' ) + ' === 1', 10000 );
		check( 'close: Quit asks about the dirty tab', await back.Evaluate( text_of( '#close-popup .subplan-head' ) ), '“' + PLAN_TITLE + '” has unsaved changes' );
		await back.Evaluate( 'document.getElementById( "close-cancel" ).click(); true' );
		await wait( 1000 );
		check( 'close: Cancel keeps the app and the draft', child.exitCode === null && await back.Evaluate( count_of( '.tab .dirty-dot' ) ), 1 );
		await back.Evaluate( '( function () { let injector = angular.element( document.body ).injector(); injector.get( "State" ).SetConfirmClose( false ); injector.get( "$rootScope" ).$apply(); return true; } )()' );
		await back.Evaluate( 'window.Desktop.Quit(); true' ).catch( function () {} );
		let code = await Promise.race( [ exited, wait( 15000 ).then( function () { return 'timeout'; } ) ] );
		check( 'quit: the app ends', code !== 'timeout' );
	}
	finally
	{
		if ( child && child.exitCode === null )
		{
			child.kill();
		}
		await wait( 1000 );
		await server.Close().catch( function () {} );
		FS.rmSync( config, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 } );
		FS.rmSync( user_data, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 } );
		FS.rmSync( base, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 } );
	}
}


//---------------------------------------------------------------------
// The Server application (plan The Server, Step 3), over its own DevTools port.

async function server_app_page( TimeoutMs )
{
	let limit = Date.now() + ( TimeoutMs || 30000 );
	while ( Date.now() < limit )
	{
		try
		{
			let list = await ( await fetch( 'http://127.0.0.1:' + SERVER_APP_PORT + '/json/list' ) ).json();
			let found = list.find( function ( target ) { return target.type === 'page' && /^http:\/\/127\.0\.0\.1:\d+\//.test( target.url ); } );
			if ( found )
			{
				return found;
			}
		}
		catch ( error )
		{
			// not listening yet
		}
		await wait( 300 );
	}
	throw new Error( 'the Server application showed no page within ' + ( ( TimeoutMs || 30000 ) / 1000 ) + ' seconds' );
}


async function smoke_server_app()
{
	console.log( '== the Server application' );
	let electron = require( 'electron' );
	let LICENSE = require( '../src/License.js' );
	let config = FS.mkdtempSync( PATH.join( OS.tmpdir(), 'consensus-smoke-server-config-' ) );
	let user_data = FS.mkdtempSync( PATH.join( OS.tmpdir(), 'consensus-smoke-server-user-data-' ) );
	let project_folder = PATH.join( FS.mkdtempSync( PATH.join( OS.tmpdir(), 'consensus-smoke-server-project-' ) ), 'handed-over' );
	FS.mkdirSync( project_folder );
	let launch = [ 'server', '--config', config, '--port', '0', '--user-data-dir=' + user_data, '--remote-debugging-port=' + SERVER_APP_PORT ];
	let child = null;
	try
	{
		// no current user: the gate closed, the window on the sign-in with the reason
		child = CHILD_PROCESS.spawn( electron, launch, { cwd: ROOT, stdio: 'ignore' } );
		let page = await CDP.Attach( ( await server_app_page() ).webSocketDebuggerUrl );
		await page.WaitFor( 'document.getElementById( "sign-in-closed" ) !== null', 30000 );
		check( 'closed: the sign-in says why', await page.Evaluate( 'document.getElementById( "sign-in-closed" ).textContent.trim()' ), 'the Server needs a Personal or Professional sign-in; the first one becomes its Administrator.' );
		check( 'closed: the window\'s bridge', await page.Evaluate( 'JSON.stringify( [ typeof window.ConsensusServer, typeof window.ConsensusDesktop, window.ConsensusDesktop.Edition, typeof window.ConsensusDesktop.SetLicense, typeof window.Desktop.PickFolder ] )' ), '["undefined","object","server","function","function"]' );
		check( 'closed: the window\'s title', await page.Evaluate( 'document.title' ), 'Consensus Server' );
		page.Close();
		child.kill();
		await wait( 1500 );
		// a Personal current user: open at the next start; the window's page signs its person in, as on any Server (plan The
		// Server, Step 5), which a smoke with no Clerk session cannot: the sign-in shows, with no closed reason
		LICENSE.Write( config, { Email: 'smoke@example.com', Clerk: 'user_smoke', Display: 'Smoke', Plan: 'personal', Until: null, Checked: new Date().toISOString() } );
		child = CHILD_PROCESS.spawn( electron, launch, { cwd: ROOT, stdio: 'ignore' } );
		page = await CDP.Attach( ( await server_app_page() ).webSocketDebuggerUrl );
		await page.WaitFor( count_of( '#sign-in-popup' ) + ' === 1 && document.getElementById( "sign-in-mount" ) !== null', 30000 );
		check( 'open: the sign-in, no closed reason', await page.Evaluate( count_of( '#sign-in-closed' ) ), 0 );
		check( 'open: the Administrator recorded', JSON.parse( FS.readFileSync( PATH.join( config, 'consensus.json' ), 'utf8' ) ).Clerk.AdminEmail, 'smoke@example.com' );
		// the page comes from the page server on the window's own origin (plan Review 2026-10-29, Step 3); the Server is its one root
		check( 'open: the server is the Server', await page.Evaluate( 'location.protocol + "//" + location.hostname + " " + JSON.stringify( window.ConsensusDesktop.Roots.map( function ( root ) { return root.Key + ":" + root.Kind; } ) )' ), 'http://127.0.0.1 ["server:server"]' );
		await screenshot( page, 'server-app' );
		// a second launch with --open: handed to the first, the folder registered and shown
		let second = CHILD_PROCESS.spawnSync( electron, [ 'server', '--config', config, '--user-data-dir=' + user_data, '--open', project_folder ], { cwd: ROOT, encoding: 'utf8', timeout: 30000 } );
		check( '--open: the second launch hands over and ends', second.status, 0 );
		await page.WaitFor( 'Array.from( document.querySelectorAll( ".project" ) ).some( function ( one ) { return one.textContent.indexOf( "handed-over" ) >= 0; } )', 30000 ).catch( function () {} );
		check( '--open: the folder is a project', FS.existsSync( PATH.join( project_folder, '.consensus', 'project.json' ) ), true );
		// the window is sent to the project's page; with no Clerk session here the page stays on its sign-in, so the
		// registry is what is checked
		check( '--open: the Server lists it', JSON.parse( FS.readFileSync( PATH.join( config, 'consensus.json' ), 'utf8' ) ).Projects.some( function ( one ) { return /handed-over$/.test( String( one.Path ).replace( /[\/]+$/, '' ) ); } ), true );
		page.Close();
	}
	finally
	{
		if ( child && child.exitCode === null )
		{
			child.kill();
		}
		await wait( 1000 );
		FS.rmSync( config, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 } );
		FS.rmSync( user_data, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 } );
		FS.rmSync( PATH.dirname( project_folder ), { recursive: true, force: true, maxRetries: 10, retryDelay: 300 } );
	}
}


//---------------------------------------------------------------------
// The Sidecar app (plan Sidecar Edition, Step 5), over its own DevTools port: a window on a temporary folder, no
// sign-in, Sidecar's menus and guide, the user renamed and the theme changed into the project's sidecar.json, both
// back after a restart, and Quit.

async function sidecar_page( TimeoutMs )
{
	let limit = Date.now() + ( TimeoutMs || 30000 );
	while ( Date.now() < limit )
	{
		try
		{
			let list = await ( await fetch( 'http://127.0.0.1:' + SIDECAR_APP_PORT + '/json/list' ) ).json();
			let found = list.find( function ( target ) { return target.type === 'page' && /^http:\/\/127\.0\.0\.1:\d+\/(#.*)?$/.test( target.url ); } );
			if ( found )
			{
				return found;
			}
		}
		catch ( error )
		{
			// not listening yet
		}
		await wait( 300 );
	}
	throw new Error( 'Sidecar showed no page within ' + ( ( TimeoutMs || 30000 ) / 1000 ) + ' seconds' );
}


// In the page: the labels of the menu open now; a service from the page's injector, inside a digest.
const MENU_LABELS = 'JSON.stringify( ( angular.element( document.body ).injector().get( "Menus" ).Open || { Items: [] } ).Items.map( function ( item ) { return item.Separator ? "---" : item.Label; } ) )';
const CLOSE_MENU = '( function () { let injector = angular.element( document.body ).injector(); injector.get( "$rootScope" ).$apply( function () { injector.get( "Menus" ).Close(); } ); return true; } )()';
const PROJECT_MENU = '( function () { let injector = angular.element( document.body ).injector(); let project = injector.get( "Roots" ).List[ 0 ].Projects[ 0 ]; injector.get( "$rootScope" ).$apply( function () { injector.get( "Tree" ).OpenMenu( "project", project, project, { preventDefault: function () {}, stopPropagation: function () {}, currentTarget: document.body, target: document.body, clientX: 10, clientY: 10 } ); } ); return true; } )()';
const SHOW_ABOUT = '( function () { let injector = angular.element( document.body ).injector(); injector.get( "$rootScope" ).$apply( function () { injector.get( "HelpPanel" ).Show( "about" ); } ); return true; } )()';
const CLOSE_ABOUT = '( function () { let injector = angular.element( document.body ).injector(); injector.get( "$rootScope" ).$apply( function () { injector.get( "HelpPanel" ).Close(); } ); return true; } )()';
const PROJECT_SETTINGS = '( function () { let injector = angular.element( document.body ).injector(); let project = injector.get( "Roots" ).List[ 0 ].Projects[ 0 ]; injector.get( "$rootScope" ).$apply( function () { injector.get( "$rootScope" ).$broadcast( "project-settings", project ); } ); return true; } )()';
const RENAME = '( function () { let input = document.getElementById( "project-user" ); input.value = "Smoke Person"; input.dispatchEvent( new Event( "input" ) ); let scope = angular.element( input ).scope(); return scope.Save().then( function () { return JSON.stringify( { Problems: scope.Panel.Problems, Saved: scope.Panel.Saved } ); } ); } )()';


async function smoke_sidecar()
{
	console.log( '== the Sidecar app' );
	let electron = require( 'electron' );
	let user_data = FS.mkdtempSync( PATH.join( OS.tmpdir(), 'consensus-smoke-sidecar-user-data-' ) );
	let project_folder = PATH.join( FS.mkdtempSync( PATH.join( OS.tmpdir(), 'consensus-smoke-sidecar-' ) ), 'sidecar-project' );
	FS.mkdirSync( project_folder );
	let settings_file = PATH.join( project_folder, '.consensus', 'sidecar.json' );
	let launch = [ 'sidecar', project_folder, '--user-data-dir=' + user_data, '--remote-debugging-port=' + SIDECAR_APP_PORT ];
	let child = null;
	try
	{
		child = CHILD_PROCESS.spawn( electron, launch, { cwd: ROOT, stdio: 'ignore' } );
		let page = await CDP.Attach( ( await sidecar_page() ).webSocketDebuggerUrl );
		await page.WaitFor( 'document.body !== null && typeof angular !== "undefined" && document.body.innerText.indexOf( "Readme" ) >= 0', 30000 );
		check( 'window: the folder\'s project', await page.Evaluate( 'window.ConsensusDesktop.Project.Name' ), 'sidecar-project' );
		let port = Number( new URL( await page.Evaluate( 'window.ConsensusDesktop.Roots[ 0 ].Url' ) ).port );
		check( 'server: the port in 52000 to 52999', port >= 52000 && port <= 52999, true );
		check( 'server: no address file', FS.existsSync( PATH.join( project_folder, '.consensus', '~sidecar.json' ) ), false );
		check( 'session: no sign-in', await page.Evaluate( 'angular.element( document.body ).injector().get( "Session" ).On' ), false );
		await page.Evaluate( 'document.getElementById( "app-menu" ).click(); true' );
		await wait( 300 );
		let app_menu = JSON.parse( await page.Evaluate( MENU_LABELS ) );
		check( 'menu: no Sign in, a Quit', app_menu.indexOf( 'Sign in…' ) < 0 && app_menu.indexOf( 'Quit' ) >= 0, true );
		await page.Evaluate( CLOSE_MENU );
		await page.Evaluate( PROJECT_MENU );
		await wait( 200 );
		let project_menu = JSON.parse( await page.Evaluate( MENU_LABELS ) );
		check( 'project menu: LLM Instructions, no Explain', project_menu.indexOf( 'LLM Instructions' ) >= 0 && project_menu.indexOf( 'Explain' ) < 0, true );
		await page.Evaluate( CLOSE_MENU );
		await page.Evaluate( SHOW_ABOUT );
		check( 'title: Consensus Sidecar', await page.Evaluate( 'JSON.stringify( [ document.querySelector( "title-bar .brand" ).textContent.trim(), document.title ] )' ), JSON.stringify( [ 'Consensus Sidecar', 'Consensus Sidecar' ] ) );
		let about = await page.WaitFor( 'document.body.innerText.indexOf( "About Consensus Sidecar" ) >= 0', 5000 ).catch( function () { return false; } );
		check( 'about: names Consensus Sidecar', about, true );
		await page.Evaluate( CLOSE_ABOUT );
		let instructions = await page.Evaluate( 'fetch( "/servers/local/instructions" ).then( function ( r ) { return r.text(); } )' );
		check( 'instructions: Sidecar\'s guide', instructions.indexOf( '# Build with Consensus Sidecar' ) >= 0, true );
		// the project's Settings: Your name, and none of a run's lists
		await page.Evaluate( PROJECT_SETTINGS );
		await page.WaitFor( 'document.getElementById( "project-user" ) !== null', 5000 );
		check( 'settings: Your name, by default <user>@<machine>', await page.Evaluate( 'document.getElementById( "project-user" ).value' ), ( OS.userInfo().username + '@' + OS.hostname() ).toLowerCase() );
		check( 'settings: no Include, Commands or Work', await page.Evaluate( count_of( '#project-include, #project-commands, #project-git-sync' ) ), 0 );
		let saved = JSON.parse( await page.Evaluate( RENAME ) );
		check( 'rename: saved', saved.Saved === true && saved.Problems.length === 0, true );
		check( 'rename: the server\'s owner', await page.Evaluate( 'fetch( "/servers/local/api/me" ).then( function ( r ) { return r.json(); } ).then( function ( j ) { return j.Me.Name; } )' ), 'Smoke Person' );
		await page.Evaluate( 'window.ConsensusDesktop.SetTheme( "dark" ); true' );
		await wait( 800 );
		let written = FS.existsSync( settings_file ) ? JSON.parse( FS.readFileSync( settings_file, 'utf8' ) ) : {};
		check( 'sidecar.json: the name and the theme', written.User + '/' + written.Theme, 'Smoke Person/dark' );
		await capture_window( page, 'sidecar-top' );
		// Quit ends it; the next start has the name and the theme back
		let exited = new Promise( function ( Resolve ) { child.on( 'exit', Resolve ); } );
		await page.Evaluate( 'window.Desktop.Quit(); true' ).catch( function () {} );
		let code = await Promise.race( [ exited, wait( 10000 ).then( function () { return 'timeout'; } ) ] );
		check( 'quit: the app ends', code !== 'timeout' );
		page.Close();
		child = CHILD_PROCESS.spawn( electron, launch, { cwd: ROOT, stdio: 'ignore' } );
		page = await CDP.Attach( ( await sidecar_page() ).webSocketDebuggerUrl );
		await page.WaitFor( 'document.body !== null && typeof angular !== "undefined" && document.body.innerText.indexOf( "Readme" ) >= 0', 30000 );
		check( 'restart: the name and the theme back', await page.Evaluate( 'window.ConsensusDesktop.User + "/" + window.ConsensusDesktop.Theme' ), 'Smoke Person/dark' );
		page.Close();
	}
	finally
	{
		if ( child && child.exitCode === null )
		{
			child.kill();
		}
		await wait( 1000 );
		FS.rmSync( user_data, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 } );
		FS.rmSync( PATH.dirname( project_folder ), { recursive: true, force: true, maxRetries: 10, retryDelay: 300 } );
	}
}


//---------------------------------------------------------------------
// The Desktop (plan Review 2026-10-29, Step 5.1: several Servers at once, one sign-in; the Client's code base of plan
// Client Edition, Step 5, which this part was written for), over its own DevTools port: two temporary servers, one with
// a slow connection to a stand-in service (plan Tool calls only, Step 3: test/support/Service.js, a round every 1.2 s,
// each saying a step and calling a tool), and a temporary config whose desktop.json names the first. Signed out, the
// sign-in box alone; then the smoke stands in for a sign-in (a person signs in through Clerk; the servers are Local, so
// the calls need no token): no configuration on the page, its menus and About, Add server, a task's run followed from
// the press (the button, the popup, the notice, My runs), and Quit.

const DESKTOP_SLOW = [
	{ content: 'step 1', calls: [ [ 'list_projects', {} ] ], delay: 1200 },
	{ content: 'step 2', calls: [ [ 'list_projects', {} ] ], delay: 1200 },
	{ content: 'all done', delay: 1200 },
];
const INJECTOR = 'angular.element( document.body ).injector()';
const FAKE_EVENT = '{ preventDefault: function () {}, stopPropagation: function () {}, currentTarget: document.body, target: document.body, clientX: 10, clientY: 10 }';


// A stand-in for the person's sign-in (plan Review 2026-10-29, Step 5.2): ClerkJS stood in for before the page loads, with
// a user at the plan given (null: signed in with no license), so the session's gate on the plan and the reads at start run
// as they would for a real sign-in; its token is null, so no call carries one and nothing goes to the app's SetLicense.
// Answers the script's identifier, for its removal.
function clerk_stand_in( plan )
{
	return 'window.Clerk = { user: { id: "user_stand_in", publicMetadata: { license: ' + JSON.stringify( plan ) + ' }, organizationMemberships: [] }, organization: null,'
		+ ' session: { getToken: function () { return Promise.resolve( null ); } }, load: function () { return Promise.resolve(); }, addListener: function () {},'
		+ ' setActive: function () { return Promise.resolve(); }, signOut: function () { return Promise.resolve(); },'
		+ ' mountSignIn: function () {}, unmountSignIn: function () {}, mountUserButton: function () {}, unmountUserButton: function () {} };';
}


async function stand_in_sign_in( Page, Plan )
{
	let added = await Page.Send( 'Page.addScriptToEvaluateOnNewDocument', { source: clerk_stand_in( Plan ) } );
	await Page.Send( 'Page.reload' );
	await Page.WaitFor( 'typeof angular !== "undefined" && ' + INJECTOR + ' && ' + INJECTOR + '.get( "Session" ).Loaded', 30000 );
	return added.identifier;
}


async function desktop_page( TimeoutMs )
{
	let limit = Date.now() + ( TimeoutMs || 30000 );
	while ( Date.now() < limit )
	{
		try
		{
			let list = await ( await fetch( 'http://127.0.0.1:' + DESKTOP_PORT + '/json/list' ) ).json();
			let found = list.find( function ( target ) { return target.type === 'page' && /^http:\/\/127\.0\.0\.1:\d+\/(#.*)?$/.test( target.url ); } );
			if ( found )
			{
				return found;
			}
		}
		catch ( error )
		{
			// not listening yet
		}
		await wait( 300 );
	}
	throw new Error( 'the Desktop showed no page within ' + ( ( TimeoutMs || 30000 ) / 1000 ) + ' seconds' );
}


async function desktop_attach()
{
	let page = await CDP.Attach( ( await desktop_page() ).webSocketDebuggerUrl );
	await page.WaitFor( 'typeof angular !== "undefined" && ' + INJECTOR + ' && ' + INJECTOR + '.get( "Session" ).Loaded', 30000 );
	return page;
}


async function local_api( Server, Method, Path, Body )
{
	let response = await fetch( Server.Url + Path, { method: Method, headers: { 'Content-Type': 'application/json' }, body: Body ? JSON.stringify( Body ) : undefined } );
	return response.json();
}


async function smoke_desktop()
{
	console.log( '== the Desktop' );
	let electron = require( 'electron' );
	let base = FS.mkdtempSync( PATH.join( OS.tmpdir(), 'consensus-smoke-desktop-' ) );
	let servers = [];
	let child = null;
	let service = null;
	try
	{
		for ( let name of [ 'first', 'second' ] )
		{
			let folder = PATH.join( base, name );
			FS.mkdirSync( folder );
			servers.push( await SERVER.Start( { Project: folder, Config: PATH.join( base, name + '-config' ), Port: 0, AddressFile: false } ) );
		}
		service = await SERVICE.Start( { Format: 'openai', Script: DESKTOP_SLOW } );
		let llm = ( await local_api( servers[ 0 ], 'POST', '/api/llms', { Name: 'planner', Kind: 'openai-compatible', Url: service.Url, Model: 'stand-in', Timeout: 60 } ) ).Llm;
		let project = ( await local_api( servers[ 0 ], 'GET', '/api/projects' ) ).Projects[ 0 ];
		await local_api( servers[ 0 ], 'PUT', '/api/projects/' + project.Id, { Llm: llm.Id } );
		let plan = ( await local_api( servers[ 0 ], 'POST', '/api/plans', { Title: 'Desktop plan', Text: '# Desktop plan\n\nA sketch.\n', Project: project.Id } ) ).Plan;
		let config = PATH.join( base, 'config' );
		FS.mkdirSync( config );
		let settings_file = PATH.join( config, 'desktop.json' );
		FS.writeFileSync( settings_file, JSON.stringify( { Servers: [ { Name: 'First', Url: servers[ 0 ].Url } ] } ) );
		child = CHILD_PROCESS.spawn( electron, [ 'desktop', '--config', config, '--user-data-dir=' + PATH.join( base, 'user-data' ), '--remote-debugging-port=' + DESKTOP_PORT ], { cwd: ROOT, stdio: 'ignore' } );
		let page = await desktop_attach();
		check( 'window: the Desktop, SetLicense for the Server beside it and no license of its own, no folder picker', await page.Evaluate( 'window.ConsensusDesktop.Edition === "desktop" && typeof window.ConsensusDesktop.SetLicense === "function" && window.ConsensusDesktop.License === null && !window.Desktop.PickFolder && window.ConsensusDesktop.Client === undefined' ), true );
		check( 'window: no native title or menu bar', await page.Evaluate( NO_FRAME ), true );
		await page.WaitFor( 'document.getElementById( "sign-in-popup" ) !== null', 15000 ).catch( function () {} );
		check( 'signed out: the sign-in box alone', await page.Evaluate( 'document.querySelector( ".layout" ).classList.contains( "ng-hide" ) && document.getElementById( "sign-in-popup" ).innerText.indexOf( "Sign in to Consensus" ) >= 0' ), true );
		// the Personal check (plan Review 2026-10-29, Step 5.2): a stand-in sign-in with no license is shown the license message and nothing else
		let below = await stand_in_sign_in( page, null );
		await page.WaitFor( 'document.getElementById( "sign-in-license" ) !== null', 15000 ).catch( function () {} );
		check( 'below Personal: the license message, Sign out, the page hidden, no root read', await page.Evaluate( 'document.querySelector( ".layout" ).classList.contains( "ng-hide" ) && document.getElementById( "sign-in-license" ) !== null && document.getElementById( "sign-in-license" ).innerText.indexOf( "which the Desktop needs" ) >= 0 && document.getElementById( "sign-in-sign-out" ) !== null && !' + INJECTOR + '.get( "Session" ).Admitted() && ' + INJECTOR + '.get( "Roots" ).List.every( function ( root ) { return !root.Loaded; } )' ), true );
		await page.Send( 'Page.removeScriptToEvaluateOnNewDocument', { identifier: below } );
		// a stand-in sign-in at Personal: the page
		await stand_in_sign_in( page, 'personal' );
		await page.WaitFor( INJECTOR + '.get( "Session" ).Admitted() && ' + INJECTOR + '.get( "Roots" ).List.every( function ( root ) { return root.Loaded && root.Me; } )', 20000 );
		check( 'signed in: the page', await page.Evaluate( '!document.querySelector( ".layout" ).classList.contains( "ng-hide" )' ), true );
		check( 'overlay: visible', await page.Evaluate( 'navigator.windowControlsOverlay && navigator.windowControlsOverlay.visible' ), true );
		check( 'no configuration: LLMS, USERS and role folders', await page.Evaluate( count_of( 'llm-fold, users-fold, roles-folder' ) ), 0 );
		await page.Evaluate( 'document.getElementById( "app-menu" ).click(); true' );
		await wait( 300 );
		let app_menu = JSON.parse( await page.Evaluate( MENU_LABELS ) );
		check( 'menu: Servers… and Sign out, no Settings, no folder', app_menu.indexOf( 'Servers…' ) >= 0 && app_menu.indexOf( 'Sign out' ) >= 0 && app_menu.indexOf( 'Settings' ) < 0 && app_menu.indexOf( 'Open folder in new window…' ) < 0, true );
		await page.Evaluate( CLOSE_MENU );
		await page.Evaluate( PROJECT_MENU );
		await wait( 200 );
		let project_menu = JSON.parse( await page.Evaluate( MENU_LABELS ) );
		check( 'project menu: Explain, no settings, instructions, rename or delete', project_menu.indexOf( 'Explain' ) >= 0 && [ 'Project settings…', 'LLM Instructions', 'Rename', 'Delete' ].every( function ( label ) { return project_menu.indexOf( label ) < 0; } ), true );
		await page.Evaluate( CLOSE_MENU );
		await page.Evaluate( '( function () { let root = ' + INJECTOR + '.get( "Roots" ).List[ 0 ]; ' + INJECTOR + '.get( "$rootScope" ).$apply( function () { ' + INJECTOR + '.get( "Tree" ).OpenMenu( "root", root, null, ' + FAKE_EVENT + ' ); } ); return true; } )()' );
		check( 'server menu: Servers… and Reload', await page.Evaluate( MENU_LABELS ), JSON.stringify( [ 'Servers…', '---', 'Reload' ] ) );
		await page.Evaluate( CLOSE_MENU );
		await page.Evaluate( SHOW_ABOUT );
		check( 'title: Consensus Desktop', await page.Evaluate( 'JSON.stringify( [ document.querySelector( "title-bar .brand" ).textContent.trim(), document.title ] )' ), JSON.stringify( [ 'Consensus Desktop', 'Consensus Desktop' ] ) );
		check( 'about: names Consensus Desktop', await page.WaitFor( 'document.body.innerText.indexOf( "About Consensus Desktop" ) >= 0', 5000 ).catch( function () { return false; } ), true );
		await page.Evaluate( CLOSE_ABOUT );
		// a task's run, from the press
		await page.Evaluate( 'window.location.hash = "#/s/First/p/' + plan.Id + '"; true' );
		await page.WaitFor( 'document.getElementById( "plan-task-answer" ) !== null && !document.getElementById( "plan-task-answer" ).disabled', 20000 );
		await page.Click( '#plan-task-answer' );
		let running = await page.WaitFor( '/Running|Queued/.test( document.getElementById( "plan-task-answer" ).textContent )', 10000 ).catch( function () { return false; } );
		check( 'press: the button follows the run', running, true );
		await page.Click( '#plan-task-answer' );
		check( 'press again: the run\'s popup, with Stop', await page.WaitFor( 'document.getElementById( "client-run-popup" ) !== null && document.getElementById( "client-run-stop" ).offsetParent !== null', 5000 ).catch( function () { return false; } ), true );
		check( 'popup: the output as it comes', await page.WaitFor( 'document.getElementById( "client-run-rendered" ).innerText.indexOf( "step 1" ) >= 0', 8000 ).catch( function () { return false; } ), true );
		await page.Evaluate( '( function () { ' + INJECTOR + '.get( "$rootScope" ).$apply( function () { ' + INJECTOR + '.get( "ClientRuns" ).Close(); } ); return true; } )()' );
		check( 'end: the notice', await page.WaitFor( 'document.querySelector( ".client-run-notice" ) !== null && document.querySelector( ".client-run-notice" ).innerText.indexOf( "Answer on Desktop plan: done" ) >= 0', 20000 ).catch( function () { return false; } ), true );
		check( 'end: Done beside the button', await page.WaitFor( 'document.getElementById( "plan-task-state-answer" ) !== null && document.getElementById( "plan-task-state-answer" ).textContent.indexOf( "Done" ) === 0', 5000 ).catch( function () { return false; } ), true );
		await page.Evaluate( 'window.location.hash = "#/waiting"; true' );
		check( 'My runs: the run', await page.WaitFor( 'document.querySelectorAll( "#my-runs .client-run.done" ).length === 1', 10000 ).catch( function () { return false; } ), true );
		await capture_window( page, 'desktop-top' );
		// Add server: the second, under its own name; the window reloads on the new list
		let added = JSON.parse( await page.Evaluate( 'window.ConsensusDesktop.AddServer( { Url: "' + servers[ 1 ].Url + '/" } ).then( JSON.stringify )' ) );
		check( 'add server: saved under the Server\'s name', !!( added.Server && added.Server.Url === servers[ 1 ].Url ), true );
		check( 'add server: the same address refused', /in the list already/.test( JSON.parse( await page.Evaluate( 'window.ConsensusDesktop.AddServer( { Url: "' + servers[ 0 ].Url + '" } ).then( JSON.stringify )' ) ).Error || '' ), true );
		await wait( 1500 );
		page.Close();
		page = await desktop_attach();
		check( 'add server: two roots after the reload', await page.Evaluate( INJECTOR + '.get( "Roots" ).List.length' ), 2 );
		check( 'desktop.json: both Servers, nothing else', JSON.stringify( Object.keys( JSON.parse( FS.readFileSync( settings_file, 'utf8' ) ) ).sort() ) + '/' + JSON.parse( FS.readFileSync( settings_file, 'utf8' ) ).Servers.length, '["Remembered","Scale","Servers","Theme"]/2' );
		check( 'no user.json in the config folder', FS.existsSync( PATH.join( config, 'user.json' ) ), false );
		let exited = new Promise( function ( Resolve ) { child.on( 'exit', Resolve ); } );
		await page.Evaluate( 'window.Desktop.Quit(); true' ).catch( function () {} );
		let code = await Promise.race( [ exited, wait( 10000 ).then( function () { return 'timeout'; } ) ] );
		check( 'quit: the app ends', code !== 'timeout' );
		page.Close();
	}
	finally
	{
		if ( child && child.exitCode === null )
		{
			child.kill();
		}
		for ( let server of servers )
		{
			await server.Close().catch( function () {} );
		}
		if ( service )
		{
			await service.Close();
		}
		await wait( 1000 );
		FS.rmSync( base, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 } );
	}
}


//---------------------------------------------------------------------

async function main()
{
	FS.mkdirSync( OUT, { recursive: true } );
	await smoke_page();
	if ( !process.argv.includes( '--no-desktop' ) )
	{
		await smoke_desktop();
		await smoke_server_app();
		await smoke_sidecar();
		await smoke_client();
	}
	console.log( failed ? 'SMOKE FAILED: ' + failed + ' check(s)' : 'SMOKE OK' );
	process.exit( failed ? 1 : 0 );
}


main().catch( function ( error )
{
	console.error( error.message );
	process.exit( 1 );
} );
