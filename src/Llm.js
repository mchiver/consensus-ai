'use strict';

// Llm - an LLM connection's command (plan Consensus Desktop, Step 3): Check says whether it answers (claude-cli: the
// command run with --version, without a shell; ollama: the models its server lists), and CommandLine is what a
// one-shot runs for a claude-cli connection: the Command with its Arguments, and --model when a Model is set; the
// prompt goes on its standard input. An ollama connection's Check also asks whether its Model calls tools (Step 4:
// a local model works through the desktop's tools, so one that cannot call them is checked as a failure).
// Plan Tool calls only, Step 2: an API connection's Check asks the service for the models its Key may use, which
// says whether the Key is good, and answers them as Models for the Model's list; Adapter is the tool loop's adapter
// for a connection of any loop kind (Ollama.js, Anthropic.js, OpenAI.js).
//
//   Check( Llm ) -> { Ok: true, Result, Models? } | { Ok: false, Error, Models? }
//   Adapter( Llm ) -> the adapter Loop.Run takes, or null for a claude-cli connection

const CHILD_PROCESS = require( 'child_process' );
const LLMS = require( './Llms.js' );
const OLLAMA = require( './Ollama.js' );
const ANTHROPIC = require( './Anthropic.js' );
const OPENAI = require( './OpenAI.js' );

const CHECK_TIMEOUT = 15000;
const OLLAMA_TIMEOUT = 5000;
const SERVICE_TIMEOUT = 15000;
const MODELS_SHOWN = 12;


//---------------------------------------------------------------------
// CommandLine( Llm ) -> { Command, Arguments }

function CommandLine( Llm )
{
	let args = ( Llm.Arguments || [] ).slice();
	if ( Llm.Model )
	{
		args.push( '--model', Llm.Model );
	}
	return { Command: Llm.Command || 'claude', Arguments: args };
}


//---------------------------------------------------------------------
// Check( Llm ) -> { Ok: true, Result } | { Ok: false, Error }

async function Check( Llm )
{
	if ( Llm.Kind === 'ollama' )
	{
		return check_ollama( Llm );
	}
	if ( LLMS.API_KINDS[ Llm.Kind ] )
	{
		return check_service( Llm );
	}
	return check_command( Llm );
}


//---------------------------------------------------------------------
// Adapter( Llm ): the tool loop's adapter for the connection's kind.

function Adapter( Llm )
{
	let format = LLMS.FormatOf( Llm && Llm.Kind );
	if ( format === 'ollama' )
	{
		return OLLAMA.ADAPTER;
	}
	if ( format === 'anthropic' )
	{
		return ANTHROPIC.ADAPTER;
	}
	if ( format === 'openai' )
	{
		return OPENAI.ADAPTER( Llm.Kind );
	}
	return null;
}


// An API connection: its models, asked with its Key; the Model among them, when one is set.
async function check_service( llm )
{
	let format = LLMS.FormatOf( llm.Kind );
	let speaker = ( format === 'anthropic' ) ? ANTHROPIC : OPENAI;
	let label = Adapter( llm ).Label;
	if ( !/^https?:\/\/\S+$/.test( llm.Url || '' ) )
	{
		return { Ok: false, Error: 'the Url must start with http:// or https://' };
	}
	if ( !llm.Key && llm.Kind !== 'openai-compatible' )
	{
		return { Ok: false, Error: 'no Key is set: paste the service\'s API key' };
	}
	let request = speaker.Models( llm );
	let answer = null;
	try
	{
		answer = await fetch( request.Url, { headers: request.Headers, signal: AbortSignal.timeout( SERVICE_TIMEOUT ) } );
	}
	catch ( error )
	{
		return { Ok: false, Error: label + ' at ' + llm.Url + ' does not answer: ' + error.message };
	}
	if ( answer.status === 401 || answer.status === 403 )
	{
		return { Ok: false, Error: label + ' refused the Key (' + answer.status + ')' };
	}
	if ( !answer.ok )
	{
		let said = await answer.text().catch( function () { return ''; } );
		return { Ok: false, Error: label + ' answered ' + answer.status + ' ' + said.slice( 0, 200 ).trim() };
	}
	let models = speaker.ModelNames( await answer.json().catch( function () { return {}; } ) ).sort();
	let shown = models.slice( 0, MODELS_SHOWN ).join( ', ' ) + ( models.length > MODELS_SHOWN ? ', …' : '' );
	let result = 'the Key is good; ' + ( models.length ? models.length + ' models: ' + shown : 'no models listed' );
	if ( llm.Model && models.length && !models.includes( llm.Model ) )
	{
		let error = 'the Model "' + llm.Model + '" is not among the ' + models.length + ' models the Key may use';
		return { Ok: false, Result: result, Error: error, Models: models };
	}
	if ( !llm.Model )
	{
		return { Ok: false, Result: result, Error: result + '; pick a Model', Models: models };
	}
	return { Ok: true, Result: result, Models: models };
}


function check_command( llm )
{
	return new Promise( function ( resolve )
	{
		let command = llm.Command || 'claude';
		CHILD_PROCESS.execFile( command, [ '--version' ], { timeout: CHECK_TIMEOUT, windowsHide: true }, function ( error, stdout, stderr )
		{
			if ( error )
			{
				let said = String( stderr || error.message ).trim();
				return resolve( { Ok: false, Error: command + ' --version: ' + said } );
			}
			resolve( { Ok: true, Result: command + ' --version: ' + String( stdout || stderr ).trim() } );
		} );
	} );
}


async function check_ollama( llm )
{
	let url = String( llm.Url || '' ).replace( /\/+$/, '' );
	try
	{
		let answer = await fetch( url + '/api/tags', { signal: AbortSignal.timeout( OLLAMA_TIMEOUT ) } );
		if ( !answer.ok )
		{
			return { Ok: false, Error: url + ' answered ' + answer.status };
		}
		let json = await answer.json();
		let models = ( json.models || [] ).map( function ( model ) { return model.name; } ).sort();
		let has_model = !llm.Model || models.includes( llm.Model );
		let result = models.length ? ( models.length + ' models: ' + models.join( ', ' ) ) : 'answered, with no models';
		if ( !has_model )
		{
			result += '; the Model "' + llm.Model + '" is not among them';
			return { Ok: false, Result: result, Error: result };
		}
		if ( llm.Model )
		{
			let tools = await calls_tools( url, llm.Model );
			result += '; ' + llm.Model + ' ' + tools.Said;
			if ( tools.Calls === false )
			{
				return { Ok: false, Result: result, Error: 'the model ' + llm.Model + ' does not call tools; a one-shot needs one that does' };
			}
		}
		return { Ok: true, Result: result };
	}
	catch ( error )
	{
		return { Ok: false, Error: 'Ollama at ' + url + ' does not answer: ' + error.message };
	}
}


// Whether a model calls tools, from its capabilities (/api/show); unknown when an older Ollama does not say.
async function calls_tools( url, model )
{
	try
	{
		let answer = await fetch( url + '/api/show', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify( { model: model } ), signal: AbortSignal.timeout( OLLAMA_TIMEOUT ) } );
		if ( !answer.ok )
		{
			return { Calls: null, Said: 'capabilities unknown (/api/show answered ' + answer.status + ')' };
		}
		let json = await answer.json();
		if ( !Array.isArray( json.capabilities ) )
		{
			return { Calls: null, Said: 'capabilities unknown (this Ollama does not list them)' };
		}
		let calls = json.capabilities.includes( 'tools' );
		return { Calls: calls, Said: calls ? 'calls tools' : 'does not call tools' };
	}
	catch ( error )
	{
		return { Calls: null, Said: 'capabilities unknown (' + error.message + ')' };
	}
}


module.exports = {
	CommandLine: CommandLine,
	Check: Check,
	Adapter: Adapter,
};
