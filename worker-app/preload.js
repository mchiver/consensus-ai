'use strict';

// preload - the bridge the app's page calls, as window.App (plan Worker Electron App). Each call is one message to
// the main process (main.js); OnWorkers hears the workers' statuses when they change.

const ELECTRON = require( 'electron' );


function invoke( channel, argument )
{
	return ELECTRON.ipcRenderer.invoke( channel, argument );
}


ELECTRON.contextBridge.exposeInMainWorld( 'App', {
	Settings: function () { return invoke( 'settings' ); },
	Save: function ( Settings ) { return invoke( 'save', Settings ); },
	Workers: function () { return invoke( 'workers' ); },
	Start: function ( Name ) { return invoke( 'start', Name ); },
	Stop: function ( Name ) { return invoke( 'stop', Name ); },
	NewToken: function () { return invoke( 'token' ); },
	Check: function ( Item ) { return invoke( 'check', Item ); },
	Models: function ( Url ) { return invoke( 'models', Url ); },
	PickFolder: function ( Current ) { return invoke( 'folder', Current ); },
	OpenBrowser: function ( Url ) { return invoke( 'browser', Url ); },
	Copy: function ( Text ) { return invoke( 'copy', Text ); },
	View: function ( Name, Bounds ) { return invoke( 'view', { Name: Name, Bounds: Bounds } ); },
	OnWorkers: function ( Callback )
	{
		ELECTRON.ipcRenderer.on( 'workers', function ( event, snapshot ) { Callback( snapshot ); } );
	},
} );
