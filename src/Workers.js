'use strict';

// Workers - Consensus's side of the workers (src/Worker.js, plan Workers) listed in consensus.json:
//
//   "Workers": [ { "Name": "Workstation", "Token": "…" } ]
//
// A worker runs beside the code and connects out to Consensus; Consensus never connects to it. It says what it
// offers (hello), then asks for jobs with a request held open (Next). Consensus queues jobs for it here, and changes
// to its jobs (a build accepted or sent back) to pass on. A worker not heard from in OfflineSeconds is offline.
// Everything here is kept in memory: a restart of Consensus forgets the queue, and the worker says hello again.
// The tokens never leave this module.

const CRYPTO = require( 'crypto' );
const IDS = require( './Ids.js' );

const DEFAULT_OFFLINE_SECONDS = 60;
const DEFAULT_WAIT_SECONDS = 30;
const JOBS_KEPT = 100;


//---------------------------------------------------------------------
// Validate: the problems with the settings' Workers, as sentences.

function Validate( Settings )
{
	let problems = [];
	let workers = Settings ? Settings.Workers : undefined;
	if ( workers === undefined )
	{
		return problems;
	}
	if ( !Array.isArray( workers ) )
	{
		return [ 'Workers must be a list' ];
	}
	let names = new Set();
	let tokens = new Set();
	for ( let worker of workers )
	{
		if ( !worker || typeof worker.Name !== 'string' || !worker.Name.trim() )
		{
			problems.push( 'a worker has no Name' );
			continue;
		}
		if ( worker.Name.includes( '/' ) )
		{
			problems.push( 'worker "' + worker.Name + '": a Name holds no "/"' );
		}
		if ( names.has( worker.Name ) )
		{
			problems.push( 'worker "' + worker.Name + '" is named twice' );
		}
		names.add( worker.Name );
		if ( typeof worker.Token !== 'string' || worker.Token.length < 16 )
		{
			problems.push( 'worker "' + worker.Name + '" needs a Token of 16 characters or more' );
		}
		else if ( tokens.has( worker.Token ) )
		{
			problems.push( 'worker "' + worker.Name + '" shares its Token with another worker' );
		}
		tokens.add( worker.Token );
	}
	let participants = ( Settings && Settings.Participants ) || [];
	for ( let participant of participants )
	{
		if ( participant && participant.Token && tokens.has( participant.Token ) )
		{
			problems.push( 'a worker\'s Token is also the participant "' + participant.Name + '"\'s' );
		}
	}
	return problems;
}


//---------------------------------------------------------------------
// Open( Settings, Options? ) -> the workers. Options = { OfflineSeconds?, WaitSeconds?, Now? }, for tests; Now() is the
// clock in milliseconds.

function Open( Settings, Options )
{
	let options = Options || {};
	let offline_seconds = options.OfflineSeconds || DEFAULT_OFFLINE_SECONDS;
	let wait_seconds = options.WaitSeconds || DEFAULT_WAIT_SECONDS;
	let clock = options.Now || Date.now;
	let listed = ( Settings && Settings.Workers ) || [];
	let known = {};
	let jobs = [];
	let waiters = {};
	let changes = {};
	let on_offline = null;

	for ( let worker of listed )
	{
		known[ worker.Name ] = { Name: worker.Name, Heard: null, Said: false, Workspaces: [], Inference: [] };
		waiters[ worker.Name ] = null;
		changes[ worker.Name ] = [];
	}

	// A worker that goes quiet is found out here, and its running jobs fail through OnOffline.
	let sweeper = setInterval( sweep, 5000 );
	sweeper.unref();


	//-----------------------------------------------------------------
	// Who is asking: the worker's name for an Authorization header, or null.

	function Identify( Authorization )
	{
		let match = /^Bearer\s+(.+)$/i.exec( String( Authorization || '' ).trim() );
		if ( !match )
		{
			return null;
		}
		let given = match[ 1 ].trim();
		let worker = listed.find( function ( candidate ) { return same( given, candidate.Token ); } );
		return worker ? worker.Name : null;
	}


	function Heard( Name )
	{
		if ( known[ Name ] )
		{
			known[ Name ].Heard = clock();
		}
	}


	function Online( Name )
	{
		let worker = known[ Name ];
		return !!worker && worker.Heard !== null && ( clock() - worker.Heard ) < offline_seconds * 1000;
	}


	// What a worker offers: { Workspaces: [ { Name, Build? } ], Inference: [ { Name, Type, Model?, Models? } ] }
	function Hello( Name, Offer )
	{
		let offer = Offer || {};
		known[ Name ].Workspaces = ( Array.isArray( offer.Workspaces ) ? offer.Workspaces : [] ).filter( named ).map( function ( workspace )
		{
			return { Name: workspace.Name, Build: !!workspace.Build };
		} );
		known[ Name ].Inference = ( Array.isArray( offer.Inference ) ? offer.Inference : [] ).filter( named ).map( function ( item )
		{
			return {
				Name: item.Name,
				Type: String( item.Type || '' ),
				Model: item.Model || null,
				Models: Array.isArray( item.Models ) ? item.Models.map( String ) : [],
			};
		} );
		known[ Name ].Said = true;
		Heard( Name );
	}


	// Whether the worker has said what it offers since Consensus started.
	function Said( Name )
	{
		return !!known[ Name ] && known[ Name ].Said;
	}


	function named( value )
	{
		return value && typeof value.Name === 'string' && value.Name.trim();
	}


	// The workers as the page shows them: [ { Name, Online, Heard, Workspaces, Inference, Running } ]
	function List()
	{
		return listed.map( function ( worker )
		{
			let entry = known[ worker.Name ];
			let running = jobs.filter( function ( job ) { return job.Worker === worker.Name && ( job.Status === 'queued' || job.Status === 'taken' ); } ).length;
			return {
				Name: entry.Name,
				Online: Online( entry.Name ),
				Heard: entry.Heard ? new Date( entry.Heard ).toISOString() : null,
				Workspaces: entry.Workspaces,
				Inference: entry.Inference,
				Jobs: running,
			};
		} );
	}


	function Has( Worker, Workspace )
	{
		let entry = known[ Worker ];
		return entry ? ( entry.Workspaces.find( function ( workspace ) { return workspace.Name === Workspace; } ) || null ) : null;
	}


	function Inference( Worker, Name )
	{
		let entry = known[ Worker ];
		return entry ? ( entry.Inference.find( function ( item ) { return item.Name === Name; } ) || null ) : null;
	}


	//-----------------------------------------------------------------
	// Jobs: Queue adds one for a worker; Next hands a worker its next job or change, waiting up to WaitSeconds.
	// A job is { Id, Kind, Worker, Status: queued | taken | done | failed, Created, Taken?, Done?, ...what Queue was given }.

	function Queue( Worker, Job )
	{
		let job = Object.assign( {}, Job, { Id: IDS.New( IDS.JOB ), Worker: Worker, Status: 'queued', Created: new Date().toISOString() } );
		jobs.push( job );
		trim();
		wake( Worker );
		return job;
	}


	// A change to one of the worker's jobs, passed on with its next ask: { Job, Change, ... }
	function Notify( Worker, Change )
	{
		if ( !changes[ Worker ] )
		{
			return;
		}
		changes[ Worker ].push( Change );
		wake( Worker );
	}


	// Resolves with { Job } (taken now), { Change }, or null after WaitSeconds. Busy: the worker is running a job,
	// so it is given changes only. A newer ask replaces an older one still waiting, which answers null.
	function Next( Worker, Busy )
	{
		Heard( Worker );
		let ready = take( Worker, Busy );
		if ( ready )
		{
			return Promise.resolve( ready );
		}
		if ( waiters[ Worker ] )
		{
			waiters[ Worker ].Resolve( null );
		}
		return new Promise( function ( resolve )
		{
			let waiter = {
				Busy: !!Busy,
				Resolve: function ( value )
				{
					clearTimeout( waiter.Timer );
					if ( waiters[ Worker ] === waiter )
					{
						waiters[ Worker ] = null;
					}
					Heard( Worker );
					resolve( value );
				},
				Timer: null,
			};
			waiter.Timer = setTimeout( function () { waiter.Resolve( null ); }, wait_seconds * 1000 );
			waiters[ Worker ] = waiter;
		} );
	}


	// Hands a waiting worker what is ready for it.
	function wake( Worker )
	{
		let waiter = waiters[ Worker ];
		if ( !waiter )
		{
			return;
		}
		let ready = take( Worker, waiter.Busy );
		if ( ready )
		{
			waiter.Resolve( ready );
		}
	}


	function take( Worker, Busy )
	{
		if ( changes[ Worker ] && changes[ Worker ].length )
		{
			return { Change: changes[ Worker ].shift() };
		}
		if ( Busy )
		{
			return null;
		}
		let job = jobs.find( function ( candidate ) { return candidate.Worker === Worker && candidate.Status === 'queued'; } );
		if ( !job )
		{
			return null;
		}
		job.Status = 'taken';
		job.Taken = new Date().toISOString();
		return { Job: job };
	}


	function Job( Id )
	{
		return jobs.find( function ( job ) { return job.Id === Id; } ) || null;
	}


	// A taken job back in the queue: the worker's ask closed before the job reached it.
	function Requeue( Id )
	{
		let job = Job( Id );
		if ( job && job.Status === 'taken' )
		{
			job.Status = 'queued';
			delete job.Taken;
		}
	}


	// A job is over: Status done or failed.
	function Finish( Id, Status )
	{
		let job = Job( Id );
		if ( job )
		{
			job.Status = Status || 'done';
			job.Done = new Date().toISOString();
		}
		return job;
	}


	// The jobs not yet over, for a proposal or all.
	function Running( Proposal )
	{
		return jobs.filter( function ( job )
		{
			return ( job.Status === 'queued' || job.Status === 'taken' ) && ( !Proposal || job.Proposal === Proposal );
		} );
	}


	// Called with each job that fails because its worker went offline.
	function OnOffline( Handler )
	{
		on_offline = Handler;
	}


	function sweep()
	{
		for ( let job of jobs )
		{
			if ( ( job.Status === 'queued' || job.Status === 'taken' ) && known[ job.Worker ].Heard !== null && !Online( job.Worker ) )
			{
				Finish( job.Id, 'failed' );
				if ( on_offline )
				{
					on_offline( job );
				}
			}
		}
	}


	function trim()
	{
		while ( jobs.length > JOBS_KEPT )
		{
			let index = jobs.findIndex( function ( job ) { return job.Status === 'done' || job.Status === 'failed'; } );
			if ( index < 0 )
			{
				break;
			}
			jobs.splice( index, 1 );
		}
	}


	function Close()
	{
		clearInterval( sweeper );
		for ( let name of Object.keys( waiters ) )
		{
			if ( waiters[ name ] )
			{
				waiters[ name ].Resolve( null );
			}
		}
	}


	return {
		Identify: Identify,
		Heard: Heard,
		Online: Online,
		Hello: Hello,
		Said: Said,
		List: List,
		Has: Has,
		Inference: Inference,
		Queue: Queue,
		Notify: Notify,
		Next: Next,
		Job: Job,
		Requeue: Requeue,
		Finish: Finish,
		Running: Running,
		OnOffline: OnOffline,
		Sweep: sweep,
		Close: Close,
	};
}


// A token compared in constant time.
function same( given, expected )
{
	let a = Buffer.from( String( given ) );
	let b = Buffer.from( String( expected ) );
	return a.length === b.length && CRYPTO.timingSafeEqual( a, b );
}


module.exports = {
	Validate: Validate,
	Open: Open,
};
