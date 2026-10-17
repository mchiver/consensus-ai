'use strict';

// preload - what the desktop gives its pages (plan Consensus Desktop, Step 2). Before the page's scripts run it
// asks the main process (main.js) what it shows; the Consensus page reads window.ConsensusDesktop for the roots (the
// servers it shows, plan Run Shapes, Step 5), the API's base URL and the theme, and the connect screen calls
// window.Desktop; the page calls it for the folder picker and the servers screen.

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
	Reason: BOOT.Reason || null,
	Remembered: BOOT.Remembered || {},
	SetTheme: function ( Theme ) { ELECTRON.ipcRenderer.send( 'theme', { Theme: Theme } ); },
	SetScale: function ( Scale ) { ELECTRON.ipcRenderer.send( 'theme', { Scale: Scale } ); },
	// The page's remembered state (stored.js, plan UI Tweaks V): a value by key into desktop.json; null forgets it.
	Remember: function ( Key, Value ) { ELECTRON.ipcRenderer.send( 'remember', { Key: Key, Value: Value } ); },
	// The title bar's colours and height (theme.js ReportChrome, plan UI Components, Step 5): the window buttons
	// Electron draws over the bar follow them.
	SetChrome: function ( Chrome ) { ELECTRON.ipcRenderer.send( 'chrome', { Color: Chrome.Color, Symbol: Chrome.Symbol, Height: Chrome.Height } ); },
} );


// For the connect screen (the servers), the page's folder picker and the page's application menu (plan UI
// Components, Step 5); Servers shows the servers screen, OpenPage the page.
ELECTRON.contextBridge.exposeInMainWorld( 'Desktop', {
	Settings: function () { return invoke( 'settings' ); },
	Save: function ( Settings ) { return invoke( 'save', Settings ); },
	Try: function ( Url ) { return invoke( 'try', Url ); },
	Servers: function () { return invoke( 'servers' ); },
	OpenPage: function () { return invoke( 'page' ); },
	LocalStatus: function () { return invoke( 'local-status' ); },
	PickFolder: function ( Current ) { return invoke( 'folder', Current ); },
	NewWindow: function () { return invoke( 'new-window' ); },
	OpenFolderWindow: function () { return invoke( 'open-folder-window' ); },
	Quit: function () { return invoke( 'quit' ); },
} );
