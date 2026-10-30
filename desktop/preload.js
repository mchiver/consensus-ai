'use strict';

// preload - what the Desktop gives its page (plan Review 2026-10-29, Step 5.1: the editions cut; the Client's bridge
// until then, the Desktop having taken the Client's code base). The page reads window.ConsensusDesktop, the same
// bridge every edition gives it, so the page is shared: Edition desktop, which the page reads for its name and for
// the thin page (one sign-in for every Server, no configuration of a Server's); the Servers as the window's roots
// (each reached through /servers/<name>), the API's base URL, the look and the remembered view state; there is no
// project of the window's own and no recent list. License is null: the Desktop's gate is the session's plan in the
// page (Step 5.2, the Personal check); SetLicense( Token ) hands the sign-in to the app, which verifies it and writes
// it as the machine's current user for the Server application beside it, and ClearLicense() removes it at sign-out.
// Clerk is our instance's publishable key and Frontend API host, for the page's sign-in; the Servers: Servers() the
// list, AddServer( { Url, Token } ), RenameServer( { Name, To } ), RemoveServer( Name ), each answering { Server } or
// { Error }; a change reloads every window on the new list. The page's application menu calls window.Desktop: New
// window and Quit; there is no folder to pick or open.

const ELECTRON = require( 'electron' );

const BOOT = ELECTRON.ipcRenderer.sendSync( 'boot' );


function invoke( channel, argument )
{
	return ELECTRON.ipcRenderer.invoke( channel, argument );
}


ELECTRON.contextBridge.exposeInMainWorld( 'ConsensusDesktop', {
	Edition: 'desktop',
	Base: BOOT.Base || '',
	Version: BOOT.Version,
	Theme: BOOT.Theme,
	Scale: BOOT.Scale,
	Roots: BOOT.Roots || [],
	Project: null,
	Recent: [],
	License: null,
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
	SetLicense: function ( Token ) { return invoke( 'set-license', Token ); },
	ClearLicense: function () { return invoke( 'clear-license' ); },
	Servers: function () { return invoke( 'servers' ); },
	AddServer: function ( Fields ) { return invoke( 'add-server', { Url: Fields && Fields.Url, Token: Fields && Fields.Token } ); },
	RenameServer: function ( Fields ) { return invoke( 'rename-server', { Name: Fields && Fields.Name, To: Fields && Fields.To } ); },
	RemoveServer: function ( Name ) { return invoke( 'remove-server', Name ); },
} );


ELECTRON.contextBridge.exposeInMainWorld( 'Desktop', {
	NewWindow: function () { return invoke( 'new-window' ); },
	Quit: function () { return invoke( 'quit' ); },
} );
