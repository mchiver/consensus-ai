'use strict';

// Manifests.test - the four application manifests (desktop, sidecar, client, server) carry the root's version (plan
// Review 2026-10-29, Step 1: desktop/package.json had fallen behind).

const TEST = require( 'node:test' );
const ASSERT = require( 'node:assert/strict' );

const ROOT = require( '../package.json' );
const APPS = [ 'desktop', 'sidecar', 'client', 'server' ];


TEST( 'the four application manifests carry the root version', function ()
{
	for ( let app of APPS )
	{
		let manifest = require( '../' + app + '/package.json' );
		ASSERT.equal( manifest.version, ROOT.version, app + '/package.json says ' + manifest.version + ', the root ' + ROOT.version );
	}
} );
