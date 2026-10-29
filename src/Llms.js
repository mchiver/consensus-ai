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
//
// Plan Tool calls only, Step 2: the API connections, each a hosted model the Server's tool loop (Loop.js) reaches over
// its API: claude (Anthropic's Messages), chatgpt, gemini and grok (OpenAI's chat completions, Gemini through Google's
// OpenAI-compatible endpoint), and openai-compatible (any other service that speaks it, at the Url given). Each has
// a Url (filled in for the named kinds), a Model (required) and a Key. The Key is write-only: Public and Hidden never
// carry it, only KeySet; a save without a Key keeps the one the connection has. Every kind but claude-cli runs
// through the tool loop (IsLoop), and FormatOf says which adapter speaks for it.

const IDS = require( './Ids.js' );
const PARTICIPANTS = require( './Participants.js' );

const KINDS = [ 'claude-cli', 'ollama', 'claude', 'chatgpt', 'gemini', 'grok', 'openai-compatible' ];
// The API kinds: the format of their requests, and the Url a new connection is given.
const API_KINDS = {
	'claude': { Format: 'anthropic', Url: 'https://api.anthropic.com/v1' },
	'chatgpt': { Format: 'openai', Url: 'https://api.openai.com/v1' },
	'gemini': { Format: 'openai', Url: 'https://generativelanguage.googleapis.com/v1beta/openai' },
	'grok': { Format: 'openai', Url: 'https://api.x.ai/v1' },
	'openai-compatible': { Format: 'openai', Url: '' },
};
const DEFAULT_COMMAND = 'claude';
const DEFAULT_ARGUMENTS = [ '-p', '--output-format', 'text', '--allowedTools', 'Bash,Read,Edit,Write,Glob,Grep,MultiEdit,WebFetch' ];
const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
const DEFAULT_TIMEOUT = 300;
const DEFAULT_CONTEXT = 32768;
const DEFAULT_ROUNDS = 30;
const DEFAULT_PROMPTS = { Session: '' };
const NAME_PATTERN = /^[A-Za-z0-9.:-]+$/;
const PUBLIC_FIELDS = [ 'Id', 'Name', 'Kind', 'Model' ];
const SECRET_FIELDS = [ 'Key' ];


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
// DefaultName( Kind, Model ): the name a new connection is offered: claude-cli, or <kind>-<model> (ollama-llama3,
// claude-sonnet-4-5), or the kind alone without a model.

function DefaultName( Kind, Model )
{
	if ( Kind === 'ollama' || API_KINDS[ Kind ] )
	{
		let model = text_of( Model ).replace( /[^A-Za-z0-9.:-]+/g, '-' );
		return model ? Kind + '-' + model : Kind;
	}
	return 'claude-cli';
}


// IsLoop( Kind ): whether a connection of the kind runs through the Server's tool loop: every kind but claude-cli.
function IsLoop( Kind )
{
	return Kind === 'ollama' || !!API_KINDS[ Kind ];
}


// FormatOf( Kind ): the adapter a loop kind speaks through: ollama, anthropic or openai; null for claude-cli.
function FormatOf( Kind )
{
	if ( Kind === 'ollama' )
	{
		return 'ollama';
	}
	return API_KINDS[ Kind ] ? API_KINDS[ Kind ].Format : null;
}


function default_url( kind )
{
	if ( kind === 'ollama' )
	{
		return DEFAULT_OLLAMA_URL;
	}
	return API_KINDS[ kind ] ? API_KINDS[ kind ].Url : '';
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
		Url: ( text_of( given.Url ) || default_url( kind ) ).replace( /\/+$/, '' ),
		Model: text_of( given.Model ),
		Key: text_of( given.Key ),
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
		if ( IsLoop( llm.Kind ) && !/^https?:\/\/\S+$/.test( llm.Url || '' ) )
		{
			problems.push( what + ': the Url must start with http:// or https://' );
		}
		if ( IsLoop( llm.Kind ) && !llm.Model )
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


// Public( Llm, Settings, Whole ): what a request sees: the whole record (but its Key) for the Administrator and the
// Managers, else the public fields; Speaker is the byline its runs post under.
function Public( Llm, Settings, Whole )
{
	let shown = Whole ? Hidden( Llm ) : {};
	if ( !Whole )
	{
		for ( let field of PUBLIC_FIELDS )
		{
			shown[ field ] = Llm[ field ];
		}
	}
	shown.Speaker = SpeakerDisplay( Llm, Settings );
	return shown;
}


// Hidden( Llm ): the record with no Key, and KeySet saying whether it has one; what any answer carries.
function Hidden( Llm )
{
	let shown = {};
	for ( let field of Object.keys( Llm || {} ) )
	{
		if ( !SECRET_FIELDS.includes( field ) )
		{
			shown[ field ] = Llm[ field ];
		}
	}
	shown.KeySet = !!( Llm && Llm.Key );
	return shown;
}


// Given( Fields ): the fields of a save, an empty Key left out so the connection keeps the one it has.
function Given( Fields )
{
	let given = Object.assign( {}, Fields || {} );
	if ( typeof given.Key !== 'string' || !given.Key.trim() )
	{
		delete given.Key;
	}
	delete given.KeySet;
	return given;
}


module.exports = {
	KINDS: KINDS,
	API_KINDS: API_KINDS,
	DEFAULT_PROMPTS: DEFAULT_PROMPTS,
	DEFAULT_COMMAND: DEFAULT_COMMAND,
	DEFAULT_ARGUMENTS: DEFAULT_ARGUMENTS,
	DEFAULT_OLLAMA_URL: DEFAULT_OLLAMA_URL,
	DEFAULT_TIMEOUT: DEFAULT_TIMEOUT,
	DEFAULT_CONTEXT: DEFAULT_CONTEXT,
	DEFAULT_ROUNDS: DEFAULT_ROUNDS,
	NAME_PATTERN: NAME_PATTERN,
	DefaultName: DefaultName,
	IsLoop: IsLoop,
	FormatOf: FormatOf,
	Hidden: Hidden,
	Given: Given,
	Fill: Fill,
	Problems: Problems,
	SpeakerName: SpeakerName,
	SpeakerDisplay: SpeakerDisplay,
	ById: ById,
	Public: Public,
};
