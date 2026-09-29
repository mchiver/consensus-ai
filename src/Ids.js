'use strict';

// Ids - global ids (the plan Global Ids): `<kind>-xxx-xxx-xxx`, three lowercase letters naming the kind, then three
// groups of three lowercase base36 characters from the crypto random source, about 46 bits. Unique across every
// Consensus server, so a project can travel between them and each item is still known by its id.
//
//   prj project   pln plan   doc document   ctx context   fld folder   cor corpus
//   thr thread    rep reply  rev revision   run an LLM session run
//
// The Default project keeps the id 'default'.

const CRYPTO = require( 'crypto' );

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
const GROUP_LENGTH = 3;
const GROUPS = 3;

const PROJECT = 'prj';
const PLAN = 'pln';
const DOCUMENT = 'doc';
const CONTEXT = 'ctx';
const FOLDER = 'fld';
const CORPUS = 'cor';
const THREAD = 'thr';
const REPLY = 'rep';
const REVISION = 'rev';
const RUN = 'run';
const KINDS = [ PROJECT, PLAN, DOCUMENT, CONTEXT, FOLDER, CORPUS, THREAD, REPLY, REVISION, RUN ];

// A proposal's Kind, as its id's kind.
const PROPOSAL_KINDS = { plan: PLAN, document: DOCUMENT, context: CONTEXT };

const PATTERN = /^([a-z]{3})-[0-9a-z]{3}-[0-9a-z]{3}-[0-9a-z]{3}$/;


//---------------------------------------------------------------------
// New: a new id of Kind.

function New( Kind )
{
	let groups = [];
	for ( let group = 0; group < GROUPS; group++ )
	{
		let characters = '';
		for ( let index = 0; index < GROUP_LENGTH; index++ )
		{
			characters += DIGITS[ CRYPTO.randomInt( DIGITS.length ) ];
		}
		groups.push( characters );
	}
	return Kind + '-' + groups.join( '-' );
}


//---------------------------------------------------------------------
// Is: whether Id has the global form, of Kind when it is given.

function Is( Id, Kind )
{
	let match = PATTERN.exec( String( Id ) );
	if ( !match )
	{
		return false;
	}
	return Kind ? ( match[ 1 ] === Kind ) : KINDS.includes( match[ 1 ] );
}


// ForProposal: the kind of a proposal's id, from its Kind ('plan' when not known).
function ForProposal( Kind )
{
	return PROPOSAL_KINDS[ Kind ] || PLAN;
}


//---------------------------------------------------------------------

module.exports = {
	PROJECT: PROJECT,
	PLAN: PLAN,
	DOCUMENT: DOCUMENT,
	CONTEXT: CONTEXT,
	FOLDER: FOLDER,
	CORPUS: CORPUS,
	THREAD: THREAD,
	REPLY: REPLY,
	REVISION: REVISION,
	RUN: RUN,
	KINDS: KINDS,
	New: New,
	Is: Is,
	ForProposal: ForProposal,
};
