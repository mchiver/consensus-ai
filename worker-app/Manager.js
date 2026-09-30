'use strict';

// Manager - the app's workers (plan Worker Electron App): starts each one in this process through the worker's
// Start, on a free port, with its settings written in the worker's own format to <user data>/workers/<Name>/
// worker.json (its jobs go in jobs.json beside it); stops it; starts the ones marked AutoStart; and, when the
// app's settings are saved, stops the workers that are gone and rewrites and reloads the ones running. Nothing
// here has a timer: the app asks for Snapshot when it wants the statuses.
//
// Manager( { UserData, Settings, Start, Vendor? } ) -> { Settings, Snapshot, Start, Stop, StartAutomatic, Close }
//   Start is src/Worker.js's Start, or a stand-in for tests: Start( { Settings, SettingsPath, Folder, Vendor } )
//   -> { Url, State, Reload, Close }.

const FS = require( 'fs' );
const NET = require( 'net' );
const PATH = require( 'path' );
const SETTINGS = require( './Settings.js' );

const STOPPED_BY_YOU = 'stopped by you';
const STOPPED_APP_CLOSED = 'the app closed';
const STOPPED_REMOVED = 'removed from the settings';


//---------------------------------------------------------------------
// A free port on 127.0.0.1: opened, read and closed again.

function free_port()
{
	return new Promise( function ( resolve, reject )
	{
		let server = NET.createServer();
		server.once( 'error', reject );
		server.listen( 0, '127.0.0.1', function ()
		{
			let port = server.address().port;
			server.close( function () { resolve( port ); } );
		} );
	} );
}


function Manager( Options )
{
	let user_data = Options.UserData;
	let settings = Options.Settings;
	let start_worker = Options.Start;
	let vendor = Options.Vendor || null;
	let records = {};


	//-----------------------------------------------------------------
	// Records: one per worker name, kept while the worker is in the settings.

	function record_of( name )
	{
		if ( !records[ name ] )
		{
			records[ name ] = { Starting: false, Worker: null, Url: null, Port: null, Started: null, Stopped: null, Error: null };
		}
		return records[ name ];
	}


	function worker_of( name )
	{
		return ( settings.Workers || [] ).find( function ( worker ) { return worker.Name === name; } ) || null;
	}


	function write_worker_settings( worker, port )
	{
		let folder = SETTINGS.WorkerFolder( user_data, worker.Name );
		FS.mkdirSync( folder, { recursive: true } );
		let path = PATH.join( folder, 'worker.json' );
		let built = SETTINGS.WorkerSettings( settings, worker, port );
		FS.writeFileSync( path, JSON.stringify( built, null, '\t' ) + '\n' );
		return { Folder: folder, Path: path, Settings: built };
	}


	//-----------------------------------------------------------------
	// Start: one worker, by name. Throws with the reason when it cannot start; the reason is kept on its record too.

	async function Start( Name )
	{
		let worker = worker_of( Name );
		if ( !worker )
		{
			throw new Error( 'there is no worker named "' + Name + '"' );
		}
		let record = record_of( Name );
		if ( record.Worker || record.Starting )
		{
			return Snapshot().find( function ( entry ) { return entry.Name === Name; } );
		}
		record.Starting = true;
		record.Error = null;
		try
		{
			let port = await free_port();
			let written = write_worker_settings( worker, port );
			let started = await start_worker( { Settings: written.Settings, SettingsPath: written.Path, Folder: written.Folder, Vendor: vendor } );
			record.Worker = started;
			record.Url = started.Url;
			record.Port = port;
			record.Started = new Date().toISOString();
			record.Stopped = null;
		}
		catch ( error )
		{
			record.Error = error.message;
			record.Stopped = { At: new Date().toISOString(), Why: error.message };
			throw error;
		}
		finally
		{
			record.Starting = false;
		}
		return Snapshot().find( function ( entry ) { return entry.Name === Name; } );
	}


	//-----------------------------------------------------------------
	// Stop: one worker; a running job is cancelled by the worker's Close, and Consensus told.

	async function Stop( Name, Why )
	{
		let record = records[ Name ];
		if ( !record || !record.Worker )
		{
			return;
		}
		let worker = record.Worker;
		record.Worker = null;
		record.Url = null;
		record.Port = null;
		record.Stopped = { At: new Date().toISOString(), Why: Why || STOPPED_BY_YOU };
		await worker.Close();
	}


	//-----------------------------------------------------------------
	// StartAutomatic: every worker marked AutoStart; one that fails keeps its reason and the others go on.

	async function StartAutomatic()
	{
		for ( let worker of settings.Workers || [] )
		{
			if ( !worker.AutoStart )
			{
				continue;
			}
			try
			{
				await Start( worker.Name );
			}
			catch ( error )
			{
				// kept on the record
			}
		}
	}


	//-----------------------------------------------------------------
	// Settings: the app's settings saved again. Workers no longer there are stopped; the running ones get their file
	// rewritten and are reloaded (the worker keeps its old settings if the new ones have problems, and says so).

	async function Settings( Fresh )
	{
		settings = Fresh;
		let names = new Set( ( settings.Workers || [] ).map( function ( worker ) { return worker.Name; } ) );
		for ( let name of Object.keys( records ) )
		{
			if ( !names.has( name ) )
			{
				await Stop( name, STOPPED_REMOVED );
				delete records[ name ];
			}
		}
		for ( let worker of settings.Workers || [] )
		{
			let record = records[ worker.Name ];
			if ( !record || !record.Worker )
			{
				continue;
			}
			write_worker_settings( worker, record.Port );
			let problems = record.Worker.Reload();
			record.Error = problems.length ? ( 'not reloaded: ' + problems.join( '; ' ) ) : null;
		}
	}


	//-----------------------------------------------------------------
	// Snapshot: every worker in the settings with its status: stopped, starting, connected, offline, paused or working.

	function Snapshot()
	{
		let entries = [];
		for ( let worker of settings.Workers || [] )
		{
			let record = record_of( worker.Name );
			let entry = {
				Name: worker.Name,
				Root: worker.Root,
				AutoStart: !!worker.AutoStart,
				Status: 'stopped',
				Url: record.Url,
				Started: record.Started,
				Stopped: record.Stopped,
				Error: record.Error,
				Heard: null,
				Working: null,
			};
			if ( record.Starting )
			{
				entry.Status = 'starting';
			}
			else if ( record.Worker )
			{
				let state = record.Worker.State();
				entry.Heard = state.Consensus.Heard;
				entry.Working = state.Current ? state.Current.Title : null;
				if ( state.Current )
				{
					entry.Status = 'working';
				}
				else if ( state.Paused )
				{
					entry.Status = 'paused';
				}
				else if ( state.Consensus.Connected )
				{
					entry.Status = 'connected';
				}
				else
				{
					entry.Status = 'offline';
					entry.Error = state.Consensus.Error || record.Error;
				}
			}
			entries.push( entry );
		}
		return entries;
	}


	//-----------------------------------------------------------------
	// Close: every worker stopped, as when the app closes.

	async function Close()
	{
		for ( let name of Object.keys( records ) )
		{
			await Stop( name, STOPPED_APP_CLOSED );
		}
	}


	return {
		Settings: Settings,
		Snapshot: Snapshot,
		Start: Start,
		Stop: Stop,
		StartAutomatic: StartAutomatic,
		Close: Close,
	};
}


module.exports = {
	Manager: Manager,
	STOPPED_BY_YOU: STOPPED_BY_YOU,
	STOPPED_APP_CLOSED: STOPPED_APP_CLOSED,
	STOPPED_REMOVED: STOPPED_REMOVED,
};
