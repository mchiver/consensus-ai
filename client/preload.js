'use strict';

// preload - what the Client gives its pages (plan Review 2026-10-29, Step 5.1: the editions cut; the desktop's bridge
// until then, the Client having taken the desktop code of before). Before the page's scripts run it asks the main
// process (main.js) what it shows; the Consensus page reads window.ConsensusDesktop for the root (the window's one
// Server), the window's one project, the API's base URL and the theme; the chooser calls window.Desktop, and the page
// calls it for its menu. There is no folder to pick or open and no recent list.

const ELECTRON = require( 'electron' );

const BOOT = ELECTRON.ipcRenderer.sendSync( 'boot' );


function invoke( channel, argument )
{
	return ELECTRON.ipcRenderer.invoke( channel, argument );
}


// For the Consensus page copy: client.js prefixes Base to every API path; theme.js reads and writes the theme here.
ELECTRON.contextBridge.exposeInMainWorld( 'ConsensusDesktop', {
	// The edition the page runs in (plan Review 2026-10-29, Step 3): desktop, sidecar, client or server; roots.js names the product by it.
	Edition: 'client',
	Base: BOOT.Base || '',
	Version: BOOT.Version,
	Theme: BOOT.Theme,
	Scale: BOOT.Scale,
	Roots: BOOT.Roots || [],
	// The window's one project: { Id, Name, Path: null, Host, Key }, or null on the chooser and on a whole Server.
	Project: BOOT.Project || null,
	Recent: [],
	// The tier (plan Rearchitecturation, Step 6): { Tier, Rank, Days, Line, ... } from the machine's current user (plan
	// The Server, Step 1: <config>/user.json); SetLicense hands a sign-in's session token to the Client, which verifies
	// it, writes it as the current user and answers the tier; ClearLicense removes it (a sign-out).
	License: BOOT.License || null,
	SetLicense: function ( Token ) { return invoke( 'set-license', Token ); },
	ClearLicense: function () { return invoke( 'clear-license' ); },
	Reason: BOOT.Reason || null,
	Remembered: BOOT.Remembered || {},
	SetTheme: function ( Theme ) { ELECTRON.ipcRenderer.send( 'theme', { Theme: Theme } ); },
	SetScale: function ( Scale ) { ELECTRON.ipcRenderer.send( 'theme', { Scale: Scale } ); },
	// The page's remembered state (stored.js, plan UI Tweaks V): a value by key into client.json; null forgets it.
	Remember: function ( Key, Value ) { ELECTRON.ipcRenderer.send( 'remember', { Key: Key, Value: Value } ); },
	// The title bar's colours and height (theme.js ReportChrome, plan UI Components, Step 5): the window buttons
	// Electron draws over the bar follow them.
	SetChrome: function ( Chrome ) { ELECTRON.ipcRenderer.send( 'chrome', { Color: Chrome.Color, Symbol: Chrome.Symbol, Height: Chrome.Height } ); },
	// The window's close (plan Markdown Editor, Step 4): main.js asks the page, which answers once its prompt about
	// the unsaved edits is settled; true closes the window, false keeps it.
	OnCloseRequested: function ( Handler ) { ELECTRON.ipcRenderer.on( 'close-requested', function () { Handler(); } ); },
	CloseDecided: function ( Ok ) { ELECTRON.ipcRenderer.send( 'close-decided', !!Ok ); },
	// A report page's Print (plan Printing and Reporting): the save dialog, then the page as a PDF file; answers
	// { Path } or { Cancelled } or { Error }.
	PrintToPdf: function ( Name ) { return invoke( 'print-pdf', Name ); },
	// A report page's View in Browser: the same page at its server's own address, in the system browser.
	ViewInBrowser: function () { return invoke( 'view-in-browser' ); },
} );


// For the chooser (the saved Servers, Connect to Server) and the page's application menu (plan UI Components, Step 5).
// What opens a project in this window answers { Ok, Project } or { Error } and then shows the page.
ELECTRON.contextBridge.exposeInMainWorld( 'Desktop', {
	Settings: function () { return invoke( 'settings' ); },
	ServerProjects: function ( Url ) { return invoke( 'server-projects', Url ); },
	ConnectServer: function ( Entry ) { return invoke( 'connect-server', Entry ); },
	RemoveServer: function ( Name ) { return invoke( 'remove-server', Name ); },
	NewWindow: function () { return invoke( 'new-window' ); },
	Quit: function () { return invoke( 'quit' ); },
} );
