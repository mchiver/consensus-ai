'use strict';

// preload - what the desktop gives its pages (plan Consensus Desktop, Step 2). Before the page's scripts run it
// asks the main process (main.js) what it is connected to; the Consensus page copy reads window.ConsensusDesktop
// for the API's base URL and the theme, and the connect screen calls window.Desktop.

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
	Server: BOOT.Server,
	Reason: BOOT.Reason || null,
	SetTheme: function ( Theme ) { ELECTRON.ipcRenderer.send( 'theme', { Theme: Theme } ); },
	SetScale: function ( Scale ) { ELECTRON.ipcRenderer.send( 'theme', { Scale: Scale } ); },
} );


// For the connect screen.
ELECTRON.contextBridge.exposeInMainWorld( 'Desktop', {
	Settings: function () { return invoke( 'settings' ); },
	Save: function ( Settings ) { return invoke( 'save', Settings ); },
	Try: function ( Url ) { return invoke( 'try', Url ); },
	Connect: function ( Where ) { return invoke( 'connect', Where ); },
	LocalStart: function ( Data ) { return invoke( 'local-start', Data ); },
	LocalStop: function () { return invoke( 'local-stop' ); },
	LocalStatus: function () { return invoke( 'local-status' ); },
	PickFolder: function ( Current ) { return invoke( 'folder', Current ); },
	NewWindow: function () { return invoke( 'new-window' ); },
} );
