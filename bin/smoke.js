'use strict';

// smoke - the page and the desktop looked at end to end, by hand (plan UI Components, Step 6). Not a test that npm
// test runs: it needs the installed Chrome or Edge, and Electron with a screen. First a temporary server with a plan
// and two threads, and a headless browser through the page: the title bar, the application menu, the look popover,
// the layout filling the window, the tree, the header, the threads pane, the Read view's anchors, the Edit view in
// both engines, no console errors. Then the desktop on a temporary config (--config, --port 0) and its own
// --user-data-dir, over its own DevTools port: the window controls overlay, the title bar as the drag region, the
// menu's desktop items, the overlay following the theme and the size, a detached window, the connect screen, Quit.
// Each check prints ok or FAIL; the exit code is 1 when any failed. Pictures go to ~smoke/ in the checkout (a tilde
// keeps the folder out of source control): the page in both themes, and captures of the desktop window's top, from
// the screen, since the window buttons are not part of the page.
//
//   npm run smoke                     the page, then the desktop
//   npm run smoke -- --no-desktop     the page alone
//
// Nothing of the real config folder or the real user data is touched: both are temporary and removed after.

const FS = require( 'fs' );
const OS = require( 'os' );
const PATH = require( 'path' );
const CHILD_PROCESS = require( 'child_process' );
const SERVER = require( '../src/Server.js' );
const PARTICIPANTS = require( '../src/Participants.js' );
const CDP = require( '../test/support/Cdp.js' );

const ROOT = PATH.join( __dirname, '..' );
const OUT = PATH.join( ROOT, '~smoke' );
const DESKTOP_PORT = 9337;
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
		await page.WaitFor( count_of( '#read-view h1' ) + ' === 1 && document.querySelector( ".connection" ) !== null && document.querySelector( ".connection" ).classList.contains( "live" )', 30000 );
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
		await page.WaitFor( count_of( '#look-popover select' ) + ' === 3' );
		check( 'look popover: three selects', await page.Evaluate( count_of( '#look-popover select' ) ), 3 );
		await page.Press( 'Escape' );
		await page.WaitFor( count_of( '#look-popover' ) + ' === 0' );
		check( 'look popover: Escape closes it', await page.Evaluate( count_of( '#look-popover' ) ), 0 );

		// the layout
		let layout = JSON.parse( await page.Evaluate( '( function () { let bar = document.querySelector( "title-bar" ).getBoundingClientRect(); let grid = document.querySelector( ".layout" ).getBoundingClientRect(); return JSON.stringify( { Bar: bar.height, Top: grid.top, Bottom: grid.bottom, Inner: window.innerHeight, Scroll: document.documentElement.scrollHeight } ); } )()' ) );
		check( 'layout: the grid starts under the bar and ends at the window', Math.round( layout.Top ) === Math.round( layout.Bar ) && Math.round( layout.Bottom ) === layout.Inner );
		check( 'layout: no page scroll', layout.Scroll, layout.Inner );

		// the tree and the header
		check( 'tree: the project is open and the plan is its row', await page.Evaluate( count_of( '.project.open' ) + ' === 1 && ' + count_of( '.tree-item.open[data-id="' + plan.Id + '"]' ) + ' === 1' ), true );
		check( 'header: the title', await page.Evaluate( text_of( '.header .title' ) ), PLAN_TITLE );
		check( 'header: the location line', await page.Evaluate( count_of( '#location .crumb-link' ) ) >= 1 );
		check( 'header: the size', /chars/.test( await page.Evaluate( text_of( '#text-size' ) ) ) );

		// the threads pane and the Read view's anchors
		await page.Evaluate( '( function () { let injector = angular.element( document.body ).injector(); injector.get( "State" ).SetFilter( "all" ); injector.get( "$rootScope" ).$apply(); return true; } )()' );
		await page.WaitFor( count_of( '.thread:not(.compose)' ) + ' === 2' );
		check( 'threads: both threads listed with the filter at all', await page.Evaluate( count_of( '.thread:not(.compose)' ) ), 2 );
		check( 'read: the two passages are marked', await page.Evaluate( '[ ...document.querySelectorAll( "#read-view .anchor" ) ].map( function ( mark ) { return mark.className; } ).sort().join( "," )' ), 'anchor contested,anchor resolved' );
		await screenshot( page, 'page-light' );

		// the Edit view in both engines
		await page.Click( '#view-edit' );
		await page.WaitFor( count_of( '#editor .monaco-editor' ) + ' === 1', 30000 );
		check( 'edit: Monaco opens', await page.Evaluate( count_of( '#editor .monaco-editor' ) ), 1 );
		await page.Click( '#view-read' );
		await page.Click( '#look-button' );
		await page.WaitFor( count_of( '#look-popover #editor-select' ) + ' === 1' );
		await page.Evaluate( '( function () { let select = document.getElementById( "editor-select" ); select.value = "codemirror"; select.dispatchEvent( new Event( "change" ) ); return true; } )()' );
		await page.Evaluate( pick_theme( 'Dark' ) );
		await page.WaitFor( 'document.documentElement.dataset.theme === "dark"' );
		await page.Click( '#look-button' );
		await page.WaitFor( count_of( '#look-popover' ) + ' === 0' );
		// in CodeMirror mode the editor is the view (plan Markdown Editor, Step 3): it opens at once
		await page.WaitFor( count_of( '#editor .cm-editor' ) + ' === 1 && ' + count_of( '#editor .cm-content .anchor' ) + ' === 2', 30000 );
		check( 'edit: CodeMirror opens with the two marks', await page.Evaluate( count_of( '#editor .cm-content .anchor' ) ), 2 );
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
		await wait( 300 );
		await screenshot( page, 'page-dark-codemirror' );
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
// The desktop, over its DevTools port.

async function desktop_targets()
{
	try
	{
		let list = await ( await fetch( 'http://127.0.0.1:' + DESKTOP_PORT + '/json/list' ) ).json();
		return list.filter( function ( target ) { return target.type === 'page' && /^http:\/\/127\.0\.0\.1/.test( target.url ); } );
	}
	catch ( error )
	{
		return [];
	}
}


async function wait_target( Test, TimeoutMs )
{
	let limit = Date.now() + ( TimeoutMs || 30000 );
	while ( Date.now() < limit )
	{
		let found = ( await desktop_targets() ).find( Test );
		if ( found )
		{
			return found;
		}
		await wait( 250 );
	}
	throw new Error( 'the desktop did not show the expected page within ' + ( TimeoutMs || 30000 ) + ' ms' );
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


async function smoke_desktop()
{
	console.log( '== the desktop' );
	let electron = require( 'electron' );
	let config = FS.mkdtempSync( PATH.join( OS.tmpdir(), 'consensus-smoke-config-' ) );
	let user_data = FS.mkdtempSync( PATH.join( OS.tmpdir(), 'consensus-smoke-user-data-' ) );
	let child = CHILD_PROCESS.spawn( electron, [ 'desktop', '--config', config, '--port', '0', '--user-data-dir=' + user_data, '--remote-debugging-port=' + DESKTOP_PORT ], { cwd: ROOT, stdio: 'ignore' } );
	let exited = new Promise( function ( Resolve ) { child.on( 'exit', Resolve ); } );
	try
	{
		let target = await wait_target( function () { return true; } );
		if ( /connect\.html/.test( target.url ) )
		{
			throw new Error( 'the desktop opened on the connect screen: its own server did not start' );
		}
		let page = await CDP.Attach( target.webSocketDebuggerUrl );
		await page.WaitFor( 'window.ConsensusDesktop !== undefined && ' + count_of( 'title-bar .brand' ) + ' === 1 && document.querySelector( ".connection" ) !== null && document.querySelector( ".connection" ).classList.contains( "live" )', 30000 );
		let roots = JSON.parse( await page.Evaluate( 'JSON.stringify( window.ConsensusDesktop.Roots )' ) );
		let plan = await make_plan( roots[ 0 ].Url );
		await page.Evaluate( 'window.location.hash = "#/p/' + plan.Id + '"; true' );
		await page.WaitFor( count_of( '#read-view h1' ) + ' === 1', 30000 );
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
		check( 'menu: the desktop items', await page.Evaluate( MENU_ITEMS ), 'About|Hotkeys|Servers…|New window|Open folder in new window…|Reload|Quit' );
		await page.Press( 'Escape' );
		check( 'bridge: OpenFolderWindow, Quit, SetChrome', await page.Evaluate( 'typeof window.Desktop.OpenFolderWindow + "," + typeof window.Desktop.Quit + "," + typeof window.ConsensusDesktop.SetChrome' ), 'function,function,function' );
		await page.Evaluate( 'document.getElementById( "app-menu" ).click(); true' );
		await page.WaitFor( count_of( '#popup-menu .menu-button' ) + ' >= 2' );
		await page.Evaluate( '[ ...document.querySelectorAll( "#popup-menu .menu-button" ) ].find( function ( button ) { return button.textContent.trim() === "Hotkeys"; } ).click(); true' );
		await page.WaitFor( count_of( '.desktop-keys-table tr' ) + ' === 6' );
		check( 'hotkeys: the desktop table is listed', await page.Evaluate( count_of( '.desktop-keys-table tr' ) ), 6 );
		// the popup closes on Escape once it has the focus, which it takes a moment after it opens
		await page.WaitFor( '!!document.activeElement && !!document.activeElement.closest( ".help-form" )', 5000 );
		await page.Press( 'Escape' );
		await page.WaitFor( count_of( '.help-form' ) + ' === 0' );

		// the overlay follows the theme and the size
		await page.Evaluate( 'window.ConsensusTheme.SetTheme( "light" ); true' );
		await wait( 600 );
		await capture_window( page, 'desktop-light' );
		await page.Click( '#look-button' );
		await page.WaitFor( count_of( '#look-popover #theme-select' ) + ' === 1' );
		await page.Evaluate( pick_theme( 'Dark' ) );
		await wait( 600 );
		check( 'theme: dark applied', await page.Evaluate( 'document.documentElement.dataset.theme' ), 'dark' );
		await capture_window( page, 'desktop-dark' );
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
		let detached_target = await wait_target( function ( candidate ) { return /detached=1/.test( candidate.url ); } );
		let detached = await CDP.Attach( detached_target.webSocketDebuggerUrl );
		await detached.WaitFor( count_of( 'title-bar .brand' ) + ' === 1 && ' + count_of( '#read-view h1' ) + ' === 1', 30000 );
		await wait( 500 );
		check( 'detached: the overlay', await detached.Evaluate( 'navigator.windowControlsOverlay.visible' ), true );
		check( 'detached: no native title or menu bar', await detached.Evaluate( NO_FRAME ), true );
		check( 'detached: the bar', await detached.Evaluate( text_of( 'title-bar .brand' ) ), 'Consensus' );
		await capture_window( detached, 'desktop-detached' );
		await detached.Evaluate( 'window.close(); true' );
		await wait( 500 );

		// the connect screen
		await page.Evaluate( 'window.Desktop.Servers(); true' );
		let connect_target = await wait_target( function ( candidate ) { return /connect\.html/.test( candidate.url ); } );
		let connect = await CDP.Attach( connect_target.webSocketDebuggerUrl );
		await connect.WaitFor( count_of( '.connect-head' ) + ' === 1 && document.body.textContent.indexOf( "{{" ) < 0', 30000 );
		await wait( 500 );
		check( 'connect: the overlay', await connect.Evaluate( 'navigator.windowControlsOverlay.visible' ), true );
		check( 'connect: the header is the drag region', await connect.Evaluate( 'getComputedStyle( document.querySelector( ".connect-head" ) ).webkitAppRegion' ), 'drag' );
		let fit = JSON.parse( await connect.Evaluate( '( function () { let r = navigator.windowControlsOverlay.getTitlebarAreaRect(); let c = document.querySelector( ".connect-controls" ).getBoundingClientRect(); return JSON.stringify( { Controls: c.right, Area: r.x + r.width, Height: r.height, Head: document.querySelector( ".connect-head" ).getBoundingClientRect().height } ); } )()' ) );
		check( 'connect: the controls stop before the buttons', fit.Controls <= fit.Area + 1 );
		check( 'connect: the overlay follows the header', Math.abs( fit.Height - fit.Head ) <= 1 );
		await capture_window( connect, 'desktop-connect' );

		// back to the page, and Quit
		await connect.Evaluate( 'window.Desktop.OpenPage(); true' );
		let back_target = await wait_target( function ( candidate ) { return !/connect\.html/.test( candidate.url ); } );
		let back = await CDP.Attach( back_target.webSocketDebuggerUrl );
		await back.WaitFor( count_of( 'title-bar .brand' ) + ' === 1', 30000 );
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
		if ( child.exitCode === null )
		{
			child.kill();
		}
		await wait( 1000 );
		FS.rmSync( config, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 } );
		FS.rmSync( user_data, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 } );
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
	}
	console.log( failed ? 'SMOKE FAILED: ' + failed + ' check(s)' : 'SMOKE OK' );
	process.exit( failed ? 1 : 0 );
}


main().catch( function ( error )
{
	console.error( error.message );
	process.exit( 1 );
} );
