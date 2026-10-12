'use strict';

// The server's start over a data folder (Server.js): the one-time rename of the first state, Proposal to Draft
// (plan UI Tweaks V), in the settings and in the plans, and the lists it leaves alone. Nothing here reads ~data.

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
	let settings = { Name: 'test', Port: 0, Scope: 'Local', States: states, Participants: [ { Name: 'user', Display: 'User', Role: 'owner' } ] };
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


TEST( 'the state Proposal becomes Draft at start: in the settings, and in every plan that was in it', async function ()
{
	let data = temporary_folder();
	write_settings( data, [ 'Proposal', 'Plan', 'Working', 'Finished' ] );
	let first = await SERVER.Start( { Data: data, Port: 0 } );
	ASSERT.deepEqual( first.Settings.States, [ 'Draft', 'Plan', 'Working', 'Finished' ] );
	ASSERT.deepEqual( read_settings( data ).States, [ 'Draft', 'Plan', 'Working', 'Finished' ] );
	await first.Close();

	// A plan left in the old state by an older server, and one in another state.
	write_settings( data, [ 'Proposal', 'Plan', 'Working', 'Finished' ] );
	let second = await SERVER.Start( { Data: data, Port: 0 } );
	let plan = ( await call( second, 'POST', '/api/proposals', { Title: 'Old', Text: '# Old\n' } ) ).Body.Proposal;
	let other = ( await call( second, 'POST', '/api/proposals', { Title: 'Working', Text: '# Working\n' } ) ).Body.Proposal;
	ASSERT.equal( ( await call( second, 'PUT', '/api/proposals/' + other.Id + '/state', { State: 'Working' } ) ).Status, 200 );
	let document = ( await call( second, 'POST', '/api/proposals', { Title: 'Doc', Text: '# Doc\n', Kind: 'document' } ) ).Body.Proposal;
	await second.Close();
	let stored = PATH.join( data, 'projects', 'Default', '.consensus', 'content', plan.Id, 'content.json' );
	let record = JSON.parse( FS.readFileSync( stored, 'utf8' ) );
	record.State = 'Proposal';
	FS.writeFileSync( stored, JSON.stringify( record ) );
	write_settings( data, [ 'Proposal', 'Plan', 'Working', 'Finished' ] );

	let third = await SERVER.Start( { Data: data, Port: 0 } );
	ASSERT.deepEqual( ( await call( third, 'GET', '/api/me' ) ).Body.States, [ 'Draft', 'Plan', 'Working', 'Finished' ] );
	ASSERT.equal( ( await call( third, 'GET', '/api/proposals/' + plan.Id ) ).Body.Proposal.State, 'Draft' );
	ASSERT.equal( ( await call( third, 'GET', '/api/proposals/' + other.Id ) ).Body.Proposal.State, 'Working' );
	ASSERT.equal( ( await call( third, 'GET', '/api/proposals/' + document.Id ) ).Body.Proposal.State, null );
	ASSERT.equal( ( await call( third, 'GET', '/api/proposals/' + plan.Id + '/revisions' ) ).Body.Revisions.length, 1 );
	await third.Close();
} );


TEST( 'a list without Proposal, or with Draft already, is left as the owner wrote it', async function ()
{
	let data = temporary_folder();
	write_settings( data, [ 'Idea', 'Done' ] );
	let first = await SERVER.Start( { Data: data, Port: 0 } );
	ASSERT.deepEqual( first.Settings.States, [ 'Idea', 'Done' ] );
	await first.Close();

	write_settings( data, [ 'Draft', 'Proposal', 'Done' ] );
	let second = await SERVER.Start( { Data: data, Port: 0 } );
	ASSERT.deepEqual( second.Settings.States, [ 'Draft', 'Proposal', 'Done' ] );
	ASSERT.deepEqual( read_settings( data ).States, [ 'Draft', 'Proposal', 'Done' ] );
	await second.Close();
} );
