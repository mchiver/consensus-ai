'use strict';

// preload - what the Server application gives its window (plan The Server, Step 3). The window shows the Server's own
// page at its loopback address, as a browser would, so the page is the whole tree with the management parts; two
// things are added: the machine's current user (a sign-in in the window is written to <config>/user.json, which the
// Server's gate reads), and the folder picker for a new project's folder.

const ELECTRON = require( 'electron' );

const BOOT = ELECTRON.ipcRenderer.sendSync( 'server-boot' );


function invoke( channel, argument )
{
	return ELECTRON.ipcRenderer.invoke( channel, argument );
}


// session.js hands a sign-in's session token here (SetLicense) and a sign-out (ClearLicense), as in the Desktop.
ELECTRON.contextBridge.exposeInMainWorld( 'ConsensusServer', {
	Version: BOOT.Version,
	License: BOOT.License || null,
	SetLicense: function ( Token ) { return invoke( 'set-license', Token ); },
	ClearLicense: function () { return invoke( 'clear-license' ); },
} );


// tree.js offers a folder picker for a new project when window.Desktop.PickFolder is there.
ELECTRON.contextBridge.exposeInMainWorld( 'Desktop', {
	PickFolder: function ( Current ) { return invoke( 'folder', Current ); },
} );
