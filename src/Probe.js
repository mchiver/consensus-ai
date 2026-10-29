'use strict';

// Probe - a Consensus server tried at its address (plan Review 2026-10-29, Step 2): one GET /api/me, in place of the
// four fetch helpers the Desktop, the Client, Host.Status and Projects.HostProjects each had, with four answer shapes.
// A Consensus server answers JSON: Me and its own name when it lets the caller in; 401 with an Error when it asks for a
// sign-in ("sign in") or its gate is closed (Closed) - still a Server, and running. Anything else is not a Consensus
// server, or does not answer.
//
//   Base( Url )                        the address trimmed, its trailing slashes dropped, or null when it is not http(s)
//   Probe( Url, { Token?, Timeout? } ) { Ok: true, SignIn, Closed, Version, Name, Me, Participants, States, Url }
//                                      or { Ok: false, Error }; Token goes as a Bearer; Timeout in ms, TIMEOUT when none
//   TIMEOUT                            5000 ms

const TIMEOUT = 5000;


function Base( Url )
{
	let base = String( Url || '' ).trim().replace( /\/+$/, '' );
	if ( !/^https?:\/\/\S+$/.test( base ) )
	{
		return null;
	}
	return base;
}


async function Probe( Url, Options )
{
	let options = Options || {};
	let timeout = ( Number.isInteger( options.Timeout ) && options.Timeout > 0 ) ? options.Timeout : TIMEOUT;
	let base = Base( Url );
	if ( !base )
	{
		return { Ok: false, Error: 'the Url must start with http:// or https://' };
	}
	let headers = {};
	if ( options.Token )
	{
		headers.Authorization = 'Bearer ' + options.Token;
	}
	let response = null;
	let json = null;
	try
	{
		response = await fetch( base + '/api/me', { headers: headers, signal: AbortSignal.timeout( timeout ) } );
		json = await response.json().catch( function () { return null; } );
	}
	catch ( error )
	{
		let reason = ( error.name === 'TimeoutError' ) ? ( 'no answer within ' + Math.round( timeout / 1000 ) + ' seconds' ) : error.message;
		return { Ok: false, Error: base + ' does not answer: ' + reason };
	}
	if ( !json || typeof json !== 'object' )
	{
		return { Ok: false, Error: base + ' answered ' + response.status + ', and not as a Consensus Server does' };
	}
	if ( response.status === 401 && typeof json.Error === 'string' )
	{
		// a Server (plan The Server, Steps 3 and 5): it answers, and asks for a sign-in or waits behind its gate
		return { Ok: true, SignIn: ( json.Error === 'sign in' ), Closed: !!json.Closed, Version: null, Name: ( typeof json.Server === 'string' ) ? json.Server : null, Me: null, Participants: null, States: null, Url: base };
	}
	if ( !response.ok )
	{
		return { Ok: false, Error: base + ' answered ' + response.status + ( ( typeof json.Error === 'string' ) ? ': ' + json.Error : '' ) };
	}
	if ( !json.Me )
	{
		return { Ok: false, Error: base + ' answered, but not as a Consensus Server does' };
	}
	return {
		Ok: true,
		SignIn: false,
		Closed: false,
		Version: json.Version || null,
		Name: ( typeof json.Server === 'string' ) ? json.Server : null,
		Me: json.Me,
		Participants: json.Participants || null,
		States: json.States || null,
		Url: base,
	};
}


module.exports = {
	TIMEOUT: TIMEOUT,
	Base: Base,
	Probe: Probe,
};
