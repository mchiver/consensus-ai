'use strict';

// preload - what the Server application gives its window (plan The Server, Step 3; plan Review 2026-10-29, Step 3: the
// same bridge as the other apps). The page reads window.ConsensusDesktop: the window's one root (the Server itself,
// reached through the page server's /servers/server), no project of the window's own (the page shows the whole tree
// with the management parts), the look and the remembered view state, Edition 'server'; the machine's current user
// (a sign-in in the window is written to <config>/user.json, which the Server's gate reads: SetLicense, ClearLicense).
// tree.js offers a folder picker for a new project when window.Desktop.PickFolder is there.

const ELECTRON = require( 'electron' );

const BOOT = ELECTRON.ipcRenderer.sendSync( 'boot' );


function invoke( channel, argument )
{
	return ELECTRON.ipcRenderer.invoke( channel, argument );
}


ELECTRON.contextBridge.exposeInMainWorld( 'ConsensusDesktop', {
	Edition: 'server',
	Base: BOOT.Base || '',
	Version: BOOT.Version,
	Theme: BOOT.Theme,
	Scale: BOOT.Scale,
	Roots: BOOT.Roots || [],
	Project: null,
	Recent: [],
	License: BOOT.License || null,
	SetLicense: function ( Token ) { return invoke( 'set-license', Token ); },
	ClearLicense: function () { return invoke( 'clear-license' ); },
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
	Quit: function () { return invoke( 'quit' ); },
} );
