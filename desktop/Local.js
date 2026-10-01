'use strict';

// Local - the one local Consensus server the desktop can run (plan Consensus Desktop, Step 2): started in this
// process through Start from src/Server.js over a data folder, on 127.0.0.1 and the folder's port (a missing
// consensus.json is written with the defaults at that first start, as the command line does); stopped with Close.
//
//   Local( { Start? } ) -> { Start( Data ), Stop(), Running(), Close() }   Start is src/Server.js's, or a stand-in.

const PATH = require( 'path' );
const SERVER = require( '../src/Server.js' );

const HOST = '127.0.0.1';


function Local( Options )
{
	let start_server = ( Options && Options.Start ) || SERVER.Start;
	let running = null;
	let starting = null;


	// Start: the server over Data, on the folder's port (Port, when given, overrides it: the tests use 0).
	// Already running over the same folder: as it is; over another: stopped first.
	// Returns { Url, Port, Data, SettingsWritten }, or throws with the reason.
	async function Start( Data, Port )
	{
		let data = PATH.resolve( String( Data || '' ) );
		if ( !Data || !String( Data ).trim() )
		{
			throw new Error( 'a data folder is needed' );
		}
		if ( starting )
		{
			await starting;
		}
		if ( running && running.Data === data )
		{
			return Running();
		}
		if ( running )
		{
			await Stop();
		}
		let options = { Data: data, Host: HOST };
		if ( Port !== undefined )
		{
			options.Port = Port;
		}
		starting = start_server( options );
		try
		{
			let server = await starting;
			running = { Server: server, Url: server.Url, Port: server.Address.Port, Data: data, SettingsWritten: !!server.SettingsWritten, Started: new Date().toISOString() };
		}
		finally
		{
			starting = null;
		}
		return Running();
	}


	async function Stop()
	{
		if ( !running )
		{
			return;
		}
		let server = running.Server;
		running = null;
		await server.Close();
	}


	// Running: { Url, Port, Data, SettingsWritten, Started } or null.
	function Running()
	{
		if ( !running )
		{
			return null;
		}
		return { Url: running.Url, Port: running.Port, Data: running.Data, SettingsWritten: running.SettingsWritten, Started: running.Started };
	}


	async function Close()
	{
		await Stop();
	}


	return {
		Start: Start,
		Stop: Stop,
		Running: Running,
		Close: Close,
	};
}


module.exports = {
	Local: Local,
	HOST: HOST,
};
