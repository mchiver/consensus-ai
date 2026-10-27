'use strict';

// preload - what Sidecar gives its page (plan Sidecar Edition, Step 1). The page reads window.ConsensusDesktop, the
// same bridge Desktop gives it, so the page is shared as it is: the window's one root and one project, the API's base
// URL, the look and the remembered view state; Sidecar is true, and there is no license and no recent list. Step 2:
// User, the name the user goes by (the project's sidecar.json), and SetUser, which renames them: { User } or { Error }. The page's
// application menu and folder picker call window.Desktop: New window, Open folder in new window, the folder dialog,
// Quit.

const ELECTRON = require( 'electron' );

const BOOT = ELECTRON.ipcRenderer.sendSync( 'boot' );


function invoke( channel, argument )
{
	return ELECTRON.ipcRenderer.invoke( channel, argument );
}


ELECTRON.contextBridge.exposeInMainWorld( 'ConsensusDesktop', {
	Base: BOOT.Base || '',
	Version: BOOT.Version,
	Theme: BOOT.Theme,
	Scale: BOOT.Scale,
	Roots: BOOT.Roots || [],
	Project: BOOT.Project || null,
	Recent: [],
	License: null,
	Sidecar: true,
	User: BOOT.User || null,
	SetUser: function ( Name ) { return invoke( 'set-user', Name ); },
	Reason: null,
	Remembered: BOOT.Remembered || {},
	SetTheme: function ( Theme ) { ELECTRON.ipcRenderer.send( 'theme', { Theme: Theme } ); },
	SetScale: function ( Scale ) { ELECTRON.ipcRenderer.send( 'theme', { Scale: Scale } ); },
	Remember: function ( Key, Value ) { ELECTRON.ipcRenderer.send( 'remember', { Key: Key, Value: Value } ); },
	SetChrome: function ( Chrome ) { ELECTRON.ipcRenderer.send( 'chrome', { Color: Chrome.Color, Symbol: Chrome.Symbol, Height: Chrome.Height } ); },
	OnCloseRequested: function ( Handler ) { ELECTRON.ipcRenderer.on( 'close-requested', function () { Handler(); } ); },
	CloseDecided: function ( Ok ) { ELECTRON.ipcRenderer.send( 'close-decided', !!Ok ); },
	PrintToPdf: function ( Name ) { return invoke( 'print-pdf', Name ); },
	ViewInBrowser: function () { return invoke( 'view-in-browser' ); },
} );


ELECTRON.contextBridge.exposeInMainWorld( 'Desktop', {
	PickFolder: function ( Current ) { return invoke( 'folder', Current ); },
	NewWindow: function () { return invoke( 'new-window' ); },
	OpenFolderWindow: function () { return invoke( 'open-folder-window' ); },
	OpenRecent: function () { return Promise.resolve( {} ); },
	Quit: function () { return invoke( 'quit' ); },
} );
