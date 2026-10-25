'use strict';

// preload - what the desktop gives its pages (plan Consensus Desktop, Step 2). Before the page's scripts run it
// asks the main process (main.js) what it shows; the Consensus page reads window.ConsensusDesktop for the root (the
// window's one server, plan Run Shapes, Step 5), the window's one project (plan Rearchitecturation, Step 2), the API's
// base URL and the theme; the chooser calls window.Desktop, and the page calls it for the folder picker and its menu.

const ELECTRON = require( 'electron' );

const BOOT = ELECTRON.ipcRenderer.sendSync( 'boot' );


function invoke( channel, argument )
{
	return ELECTRON.ipcRenderer.invoke( channel, argument );
}


// For the Consensus page copy: client.js prefixes Base to every API path; theme.js reads and writes the theme here.
ELECTRON.contextBridge.exposeInMainWorld( 'ConsensusDesktop', {
	Base: BOOT.Base || '',
	Version: BOOT.Version,
	Theme: BOOT.Theme,
	Scale: BOOT.Scale,
	Roots: BOOT.Roots || [],
	// The window's one project (plan Rearchitecturation, Step 2): { Id, Name, Path, Host, Key }, or null on the chooser.
	Project: BOOT.Project || null,
	// The recent project folders (desktop.json), newest first, for the menu.
	Recent: BOOT.Recent || [],
	Reason: BOOT.Reason || null,
	Remembered: BOOT.Remembered || {},
	SetTheme: function ( Theme ) { ELECTRON.ipcRenderer.send( 'theme', { Theme: Theme } ); },
	SetScale: function ( Scale ) { ELECTRON.ipcRenderer.send( 'theme', { Scale: Scale } ); },
	// The page's remembered state (stored.js, plan UI Tweaks V): a value by key into desktop.json; null forgets it.
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


// For the chooser (plan Rearchitecturation, Step 2: the recent folders, Open folder, New project, the Hosts), the
// page's folder picker and the page's application menu (plan UI Components, Step 5). What opens a project in this
// window answers { Ok, Project } or { Error } (or { Cancelled } from a picker) and then shows the page.
ELECTRON.contextBridge.exposeInMainWorld( 'Desktop', {
	Settings: function () { return invoke( 'settings' ); },
	OpenFolder: function () { return invoke( 'open-folder' ); },
	OpenPath: function ( Path ) { return invoke( 'open-path', Path ); },
	NewProject: function ( Fields ) { return invoke( 'new-project', Fields ); },
	HostProjects: function ( Url ) { return invoke( 'host-projects', Url ); },
	ConnectHost: function ( Entry ) { return invoke( 'connect-host', Entry ); },
	Forget: function ( Path ) { return invoke( 'forget', Path ); },
	RemoveHost: function ( Entry ) { return invoke( 'remove-host', Entry ); },
	Try: function ( Url ) { return invoke( 'try', Url ); },
	PickFolder: function ( Current ) { return invoke( 'folder', Current ); },
	NewWindow: function () { return invoke( 'new-window' ); },
	OpenFolderWindow: function () { return invoke( 'open-folder-window' ); },
	OpenRecent: function ( Path ) { return invoke( 'open-recent', Path ); },
	Quit: function () { return invoke( 'quit' ); },
	// The Server Host (plan Rearchitecturation, Step 5): its status { Running, Url, Ours }, started detached, stopped,
	// its page opened in the system browser.
	HostStatus: function () { return invoke( 'host-status' ); },
	StartHost: function () { return invoke( 'host-start' ); },
	StopHost: function () { return invoke( 'host-stop' ); },
	OpenHost: function () { return invoke( 'host-open' ); },
} );
