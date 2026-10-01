'use strict';

// Llm - an LLM connection's command (plan Consensus Desktop, Step 3): Check says whether it answers (claude-cli: the
// command run with --version, without a shell; ollama: the models its server lists), and CommandLine is what a
// one-shot runs for a claude-cli connection: the Command with its Arguments, and --model when a Model is set; the
// prompt goes on its standard input. An ollama connection is entered and checked here, but its one-shots are Step 4.

const CHILD_PROCESS = require( 'child_process' );

const CHECK_TIMEOUT = 15000;
const OLLAMA_TIMEOUT = 5000;


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
	return check_command( Llm );
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
		}
		return { Ok: has_model, Result: result, Error: has_model ? undefined : result };
	}
	catch ( error )
	{
		return { Ok: false, Error: 'Ollama at ' + url + ' does not answer: ' + error.message };
	}
}


module.exports = {
	CommandLine: CommandLine,
	Check: Check,
};
