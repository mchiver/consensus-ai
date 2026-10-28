'use strict';

// preload - what the Client gives its page (plan Client Edition, Step 1). The page reads window.ConsensusDesktop, the
// same bridge Desktop and Sidecar give it, so the page is shared: the Servers as the window's roots (each reached
// through /servers/<name>), the API's base URL, the look and the remembered view state. Client is true; there is no
// project of the window's own, no license, no recent list and no user (the Client has no current user: no SetLicense
// and no SetUser). The page's application menu calls window.Desktop: New window and Quit; there is no folder to pick
// or open. Step 2: Clerk, our instance's publishable key and Frontend API host, for the page's sign-in; and the
// Servers: Servers() the list, AddServer( { Url, Token } ), RenameServer( { Name, To } ), RemoveServer( Name ), each
// answering { Server } or { Error }; a change reloads every window on the new list.

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
	Project: null,
	Recent: [],
	License: null,
	Client: true,
	Clerk: BOOT.Clerk || null,
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
	Servers: function () { return invoke( 'servers' ); },
	AddServer: function ( Fields ) { return invoke( 'add-server', { Url: Fields && Fields.Url, Token: Fields && Fields.Token } ); },
	RenameServer: function ( Fields ) { return invoke( 'rename-server', { Name: Fields && Fields.Name, To: Fields && Fields.To } ); },
	RemoveServer: function ( Name ) { return invoke( 'remove-server', Name ); },
} );


ELECTRON.contextBridge.exposeInMainWorld( 'Desktop', {
	NewWindow: function () { return invoke( 'new-window' ); },
	Quit: function () { return invoke( 'quit' ); },
} );
