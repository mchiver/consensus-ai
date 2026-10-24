'use strict';

// The server's start over a data folder (Server.js): the settings' States list is read as the owner wrote it.
// Nothing here reads ~data.

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );
const FS = require( 'fs' );
const OS = require( 'os' );
const PATH = require( 'path' );
const SERVER = require( '../src/Server.js' );

let folders = [];


function temporary_folder()
{
	let folder = FS.mkdtempSync( PATH.join( OS.tmpdir(), 'consensus-server-' ) );
	folders.push( folder );
	return folder;
}


function write_settings( folder, states )
{
	let settings = { Name: 'test', Port: 0, Scope: 'Local', States: states, Owner: { Name: 'user', Display: 'User' } };
	FS.writeFileSync( PATH.join( folder, 'consensus.json' ), JSON.stringify( settings, null, '\t' ) );
}


function read_settings( folder )
{
	return JSON.parse( FS.readFileSync( PATH.join( folder, 'consensus.json' ), 'utf8' ) );
}


async function call( server, method, path, body )
{
	let headers = ( body === undefined ) ? {} : { 'Content-Type': 'application/json' };
	let response = await fetch( server.Url + path, { method: method, headers: headers, body: ( body === undefined ) ? undefined : JSON.stringify( body ) } );
	return { Status: response.status, Body: await response.json() };
}


TEST.after( function ()
{
	for ( let folder of folders )
	{
		FS.rmSync( folder, { recursive: true, force: true } );
	}
} );


TEST( 'the States list is left as the owner wrote it', async function ()
{
	let data = temporary_folder();
	write_settings( data, [ 'Idea', 'Done' ] );
	let first = await SERVER.Start( { Data: data, Port: 0 } );
	ASSERT.deepEqual( first.Settings.States, [ 'Idea', 'Done' ] );
	await first.Close();

	write_settings( data, [ 'Draft', 'Plan', 'Done' ] );
	let second = await SERVER.Start( { Data: data, Port: 0 } );
	ASSERT.deepEqual( second.Settings.States, [ 'Draft', 'Plan', 'Done' ] );
	ASSERT.deepEqual( read_settings( data ).States, [ 'Draft', 'Plan', 'Done' ] );
	await second.Close();
} );
