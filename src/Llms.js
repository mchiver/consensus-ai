'use strict';

// Llms - the LLM connections of a server (plan Run Shapes, Step 3): the Llms list of the global config, which the
// desktop kept before. Each is a connection the server runs one-shots through (Runs.js). A run is the presser's
// (plan User Management, Step 2): what it posts reads "<connection Name> by <owner>", the byline (SpeakerName is
// the key, SpeakerDisplay what the page shows), on a token the server makes for the run; the connection has no
// token of its own any more. The owner sees the whole record, everyone else its public part. What a run is given
// and asked is the task's (plan LLM Tasks, Step 1: Tasks.js); the connection keeps its Session Prompt and the
// documents and threads it leaves out.
//
//   { "Id": "llm-…", "Name": "claude-cli", "Kind": "claude-cli", "Command": "claude", "Arguments": [ "-p", … ],
//     "Url": "", "Model": "sonnet", "Timeout": 300, "Context": 32768, "Rounds": 30,
//     "Unchecked": { "Documents": [ "doc-…" ], "Threads": [ "thr-…" ] },
//     "Prompts": { "Session": "" } }
//   Context (the model's window, Ollama's num_ctx) and Rounds (the most tool rounds a run takes) matter to an ollama
//   connection; Command and Arguments to a claude-cli one.

const IDS = require( './Ids.js' );
const PARTICIPANTS = require( './Participants.js' );

const KINDS = [ 'claude-cli', 'ollama' ];
const DEFAULT_COMMAND = 'claude';
const DEFAULT_ARGUMENTS = [ '-p', '--output-format', 'text', '--allowedTools', 'Bash,Read,Edit,Write,Glob,Grep,MultiEdit,WebFetch' ];
const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
const DEFAULT_TIMEOUT = 300;
const DEFAULT_CONTEXT = 32768;
const DEFAULT_ROUNDS = 30;
const DEFAULT_PROMPTS = { Session: '' };
const NAME_PATTERN = /^[A-Za-z0-9.:-]+$/;
const PUBLIC_FIELDS = [ 'Id', 'Name', 'Kind', 'Model' ];


function text_of( value, fallback )
{
	return ( value === undefined || value === null ) ? ( fallback || '' ) : String( value ).trim();
}


function lines_of( value, fallback )
{
	if ( Array.isArray( value ) )
	{
		return value.map( function ( line ) { return String( line ).trim(); } ).filter( function ( line ) { return line; } );
	}
	if ( typeof value === 'string' )
	{
		return lines_of( value.split( /\r?\n/ ) );
	}
	return ( fallback || [] ).slice();
}


//---------------------------------------------------------------------
// DefaultName( Kind, Model ): the name a new connection is offered: claude-cli, or ollama-<model>.

function DefaultName( Kind, Model )
{
	if ( Kind === 'ollama' )
	{
		let model = text_of( Model ).replace( /[^A-Za-z0-9.:-]+/g, '-' );
		return model ? 'ollama-' + model : 'ollama';
	}
	return 'claude-cli';
}


//---------------------------------------------------------------------
// Fill: one connection with every field present.

function Fill( Llm )
{
	let given = ( Llm && typeof Llm === 'object' ) ? Llm : {};
	let kind = KINDS.includes( given.Kind ) ? given.Kind : KINDS[ 0 ];
	let prompts = {};
	for ( let name of Object.keys( DEFAULT_PROMPTS ) )
	{
		prompts[ name ] = ( given.Prompts && typeof given.Prompts[ name ] === 'string' ) ? given.Prompts[ name ] : DEFAULT_PROMPTS[ name ];
	}
	let timeout = Number( given.Timeout );
	let context = Number( given.Context );
	let rounds = Number( given.Rounds );
	let unchecked = ( given.Unchecked && typeof given.Unchecked === 'object' ) ? given.Unchecked : {};
	return {
		Id: text_of( given.Id ) || IDS.New( IDS.LLM ),
		Name: text_of( given.Name ) || DefaultName( kind, given.Model ),
		Kind: kind,
		Command: text_of( given.Command ) || DEFAULT_COMMAND,
		Arguments: Array.isArray( given.Arguments ) ? given.Arguments.map( function ( argument ) { return String( argument ); } ) : DEFAULT_ARGUMENTS.slice(),
		Url: text_of( given.Url ) || ( ( kind === 'ollama' ) ? DEFAULT_OLLAMA_URL : '' ),
		Model: text_of( given.Model ),
		Timeout: ( Number.isFinite( timeout ) && timeout > 0 ) ? Math.round( timeout ) : DEFAULT_TIMEOUT,
		Context: ( Number.isFinite( context ) && context > 0 ) ? Math.round( context ) : DEFAULT_CONTEXT,
		Rounds: ( Number.isFinite( rounds ) && rounds > 0 ) ? Math.round( rounds ) : DEFAULT_ROUNDS,
		Prompts: prompts,
		Unchecked: { Documents: lines_of( unchecked.Documents, [] ), Threads: lines_of( unchecked.Threads, [] ) },
	};
}


//---------------------------------------------------------------------
// Problems( Settings ): what is wrong with the settings' Llms, as sentences; none when they are usable. A name is
// letters, digits, dot, dash and colon, used once.

function Problems( Settings )
{
	let problems = [];
	let llms = ( Settings && Settings.Llms ) || [];
	if ( !Array.isArray( llms ) )
	{
		return [ 'Llms must be a list' ];
	}
	let names = new Set();
	let ids = new Set();
	for ( let llm of llms )
	{
		if ( !llm || typeof llm !== 'object' )
		{
			problems.push( 'an LLM connection is not an object' );
			continue;
		}
		let what = 'LLM connection "' + ( llm.Name || '?' ) + '"';
		if ( !llm.Name )
		{
			problems.push( 'an LLM connection has no Name' );
		}
		else if ( !NAME_PATTERN.test( llm.Name ) )
		{
			problems.push( what + ': the Name is letters, digits, dot, dash and colon' );
		}
		else if ( names.has( llm.Name ) )
		{
			problems.push( what + ' is named twice' );
		}
		names.add( llm.Name );
		if ( !llm.Id || ids.has( llm.Id ) )
		{
			problems.push( what + ': the Id is missing or used twice' );
		}
		ids.add( llm.Id );
		if ( !KINDS.includes( llm.Kind ) )
		{
			problems.push( what + ': the Kind is "' + llm.Kind + '", not one of ' + KINDS.join( ', ' ) );
		}
		if ( llm.Kind === 'claude-cli' && !llm.Command )
		{
			problems.push( what + ': a Command is needed' );
		}
		if ( llm.Kind === 'ollama' && !/^https?:\/\/\S+$/.test( llm.Url || '' ) )
		{
			problems.push( what + ': the Url must start with http:// or https://' );
		}
		if ( llm.Kind === 'ollama' && !llm.Model )
		{
			problems.push( what + ': a Model is needed' );
		}
	}
	return problems;
}


//---------------------------------------------------------------------
// SpeakerName( Llm, Settings ): the key a run through the connection speaks as, "<Name> by <owner name>";
// SpeakerDisplay: the byline the page shows, "<Name> by <owner display>".

function SpeakerName( Llm, Settings )
{
	return PARTICIPANTS.Speaker( PARTICIPANTS.Owner( Settings ).Name, ( Llm && Llm.Name ) || '' );
}


function SpeakerDisplay( Llm, Settings )
{
	return PARTICIPANTS.Byline( Settings, { By: PARTICIPANTS.Owner( Settings ).Name, Service: ( Llm && Llm.Name ) || '' } );
}


// ById( Settings, Id ): the connection with that id, or null.
function ById( Settings, Id )
{
	return ( ( Settings && Settings.Llms ) || [] ).find( function ( llm ) { return llm.Id === Id; } ) || null;
}


// Public( Llm, Settings, Whole ): what a request sees: the whole record for the owner, else the public fields;
// Speaker is the byline its runs post under.
function Public( Llm, Settings, Whole )
{
	let shown = {};
	for ( let field of Whole ? Object.keys( Llm ) : PUBLIC_FIELDS )
	{
		shown[ field ] = Llm[ field ];
	}
	shown.Speaker = SpeakerDisplay( Llm, Settings );
	return shown;
}


module.exports = {
	KINDS: KINDS,
	DEFAULT_PROMPTS: DEFAULT_PROMPTS,
	DEFAULT_COMMAND: DEFAULT_COMMAND,
	DEFAULT_ARGUMENTS: DEFAULT_ARGUMENTS,
	DEFAULT_OLLAMA_URL: DEFAULT_OLLAMA_URL,
	DEFAULT_TIMEOUT: DEFAULT_TIMEOUT,
	DEFAULT_CONTEXT: DEFAULT_CONTEXT,
	DEFAULT_ROUNDS: DEFAULT_ROUNDS,
	NAME_PATTERN: NAME_PATTERN,
	DefaultName: DefaultName,
	Fill: Fill,
	Problems: Problems,
	SpeakerName: SpeakerName,
	SpeakerDisplay: SpeakerDisplay,
	ById: ById,
	Public: Public,
};
