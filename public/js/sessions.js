'use strict';

// Sessions - the LLM session panel of a plan. Send to LLM opens it within the plan's content area; each plan has
// its own, so sessions in different tabs run at the same time. The panel shapes the prompt (context, parent plans
// for a Subplan, threads, search) and shows its size, picks where it goes (a destination and model, or Manual copy / paste), and shows the
// run log. A session runs on the server: closing the panel or switching tabs does not stop it.
//
//   panel = { Open, Options: { Context, Parents, Threads, Search }, Destination, Model, Size, Preview, Manual, Busy, Result }
//     Size    the prompt's size as the server measures it: { Characters, Tokens, Parts }
//     Manual  { Prompt, Revision, Context, Run, Answer } while a copy / paste session is under way

angular.module( 'Consensus' ).factory( 'Sessions', [ function ()
{
	let panels = {};


	// The panel of the proposal Id, made closed the first time it is asked for.
	function Panel( Id )
	{
		if ( !panels[ Id ] )
		{
			panels[ Id ] = {
				Open: false,
				Options: { Context: true, Parents: true, Threads: 'open', Search: true },
				Destination: null,
				Model: null,
				Size: null,
				Preview: null,
				Manual: null,
				Busy: false,
				Result: null,
			};
		}
		return panels[ Id ];
	}


	function Toggle( Id )
	{
		let panel = Panel( Id );
		panel.Open = !panel.Open;
		return panel;
	}


	return {
		Panel: Panel,
		Toggle: Toggle,
	};
} ] )


//---------------------------------------------------------------------
// SessionController: the panel of the open plan.

.controller( 'SessionController', [ '$scope', '$timeout', 'State', 'Client', 'Sessions', function ( $scope, $timeout, State, Client, Sessions )
{
	const DESTINATION_KEY = 'consensus.destination';
	const MODEL_KEY = 'consensus.model.';
	const SIZE_DELAY = 250;
	const MANUAL = 'Manual';

	$scope.State = State;
	$scope.Destinations = [];
	$scope.ManualOffered = false;
	$scope.Models = {};
	$scope.Runs = [];
	$scope.ShowingEarlier = false;
	$scope.MANUAL = MANUAL;
	let size_timer = null;


	function recall( key, fallback )
	{
		try
		{
			let value = window.localStorage.getItem( key );
			return ( value === null ) ? fallback : value;
		}
		catch ( error )
		{
			return fallback;
		}
	}


	function remember( key, value )
	{
		try
		{
			window.localStorage.setItem( key, value );
		}
		catch ( error )
		{
			// not remembered; the panel falls back to the first destination
		}
	}


	// The open plan's panel, or null when the open item is no plan.
	$scope.Panel = function ()
	{
		if ( !State.Open || State.Open.Proposal.Kind === 'document' || State.Open.Proposal.Kind === 'context' )
		{
			return null;
		}
		return Sessions.Panel( State.OpenId );
	};


	$scope.IsShown = function ()
	{
		let panel = $scope.Panel();
		return !!panel && panel.Open;
	};


	// P: the open plan's panel, for the template's inputs.
	$scope.P = null;
	$scope.$watch( function () { return $scope.Panel(); }, function ( panel )
	{
		$scope.P = panel;
	} );


	$scope.ToggleEarlier = function ()
	{
		$scope.ShowingEarlier = !$scope.ShowingEarlier;
	};


	// Back to the center, at its first size.
	$scope.ResetPlace = function ()
	{
		$scope.$broadcast( 'session-reset' );
	};


	$scope.Close = function ()
	{
		let panel = $scope.Panel();
		if ( panel )
		{
			panel.Open = false;
		}
	};


	//-----------------------------------------------------------------
	// Destinations and models

	async function load_destinations()
	{
		try
		{
			let answer = await Client.Get( '/api/llm/destinations' );
			$scope.Destinations = answer.Destinations;
			$scope.ManualOffered = answer.Manual;
		}
		catch ( error )
		{
			$scope.Destinations = [];
		}
		$scope.$applyAsync();
	}


	function destination_named( name )
	{
		return $scope.Destinations.find( function ( destination ) { return destination.Name === name; } ) || null;
	}


	// A panel's destination and model, the last ones picked in this browser when it has none yet.
	function settle_destination( panel )
	{
		if ( !panel.Destination )
		{
			let last = recall( DESTINATION_KEY, null );
			let known = ( last === MANUAL ) || !!destination_named( last );
			panel.Destination = known ? last : ( $scope.Destinations.length ? $scope.Destinations[ 0 ].Name : MANUAL );
		}
		load_models( panel );
	}


	async function load_models( panel )
	{
		let destination = destination_named( panel.Destination );
		if ( !destination )
		{
			return;
		}
		if ( !$scope.Models[ destination.Name ] )
		{
			try
			{
				let answer = await Client.Get( '/api/llm/models?destination=' + encodeURIComponent( destination.Name ) );
				$scope.Models[ destination.Name ] = answer.Models;
			}
			catch ( error )
			{
				$scope.Models[ destination.Name ] = destination.Model ? [ destination.Model ] : [];
			}
		}
		if ( !panel.Model )
		{
			let models = $scope.Models[ destination.Name ];
			let last = recall( MODEL_KEY + destination.Name, null );
			panel.Model = ( last && models.includes( last ) ) ? last : ( destination.Model || models[ 0 ] || null );
		}
		$scope.$applyAsync();
	}


	$scope.IsOllama = function ( panel )
	{
		let destination = destination_named( panel.Destination );
		return !!destination && destination.Kind === 'ollama';
	};


	$scope.PickDestination = function ( panel )
	{
		remember( DESTINATION_KEY, panel.Destination );
		panel.Model = null;
		panel.Manual = null;
		panel.Result = null;
		load_models( panel );
	};


	$scope.PickModel = function ( panel )
	{
		let destination = destination_named( panel.Destination );
		if ( destination && panel.Model )
		{
			remember( MODEL_KEY + destination.Name, panel.Model );
		}
	};


	//-----------------------------------------------------------------
	// The prompt's size, and its preview

	function options_query( options )
	{
		return '?context=' + ( options.Context ? '1' : '0' ) + '&parents=' + ( options.Parents ? '1' : '0' ) + '&threads=' + encodeURIComponent( options.Threads ) + '&search=' + ( options.Search ? '1' : '0' );
	}


	// Whether the node Id sits under a plan in Items: a Subplan.
	function is_subplan( items, id, under_plan )
	{
		for ( let node of items || [] )
		{
			if ( node.Id === id )
			{
				return under_plan;
			}
			if ( node.Items && is_subplan( node.Items, id, node.Kind === 'plan' ) )
			{
				return true;
			}
		}
		return false;
	}


	// The open plan is a Subplan, so the parent plans can go in its prompt.
	$scope.HasParents = function ()
	{
		if ( !State.Open || !State.Open.Project )
		{
			return false;
		}
		let project = ( State.Projects || [] ).find( function ( candidate ) { return candidate.Id === State.Open.Project.Id; } );
		return !!project && is_subplan( project.Items, State.Open.Proposal.Id, false );
	};


	async function measure( id, panel )
	{
		try
		{
			let answer = await Client.Get( '/api/proposals/' + encodeURIComponent( id ) + '/prompt' + options_query( panel.Options ) );
			panel.Size = { Characters: answer.Characters, Tokens: answer.Tokens, Parts: answer.Parts };
			if ( panel.Preview !== null )
			{
				panel.Preview = answer.Prompt;
			}
		}
		catch ( error )
		{
			panel.Size = null;
		}
		$scope.$applyAsync();
	}


	// Any change of choice, and the plan changing, measure the prompt again, a moment later.
	$scope.Measure = function ()
	{
		let panel = $scope.Panel();
		if ( !panel || !panel.Open )
		{
			return;
		}
		let id = State.OpenId;
		if ( size_timer )
		{
			$timeout.cancel( size_timer );
		}
		size_timer = $timeout( function ()
		{
			size_timer = null;
			measure( id, panel );
		}, SIZE_DELAY, false );
	};


	$scope.TogglePreview = function ( panel )
	{
		panel.Preview = ( panel.Preview === null ) ? '' : null;
		$scope.Measure();
	};


	$scope.Share = function ( part, size )
	{
		return size && size.Characters ? Math.round( 100 * part.Characters / size.Characters ) : 0;
	};


	//-----------------------------------------------------------------
	// Sending

	$scope.Send = async function ( panel )
	{
		let id = State.OpenId;
		panel.Busy = true;
		panel.Result = null;
		let answer = await State.Act( function ()
		{
			return Client.Post( '/api/proposals/' + encodeURIComponent( id ) + '/session', { Destination: panel.Destination, Model: panel.Model, Options: panel.Options } );
		} );
		panel.Busy = false;
		if ( answer )
		{
			await State.Reload();
			load_runs( id );
		}
		$scope.$applyAsync();
	};


	// Manual: the prompt is made and copied; the answer comes back through the box.
	$scope.CopyPrompt = async function ( panel )
	{
		let id = State.OpenId;
		panel.Busy = true;
		panel.Result = null;
		let answer = await State.Act( function ()
		{
			return Client.Post( '/api/proposals/' + encodeURIComponent( id ) + '/session', { Destination: MANUAL, Options: panel.Options } );
		} );
		panel.Busy = false;
		if ( answer )
		{
			panel.Manual = { Prompt: answer.Prompt, Revision: answer.Revision, Context: answer.Context, Run: answer.Run, Turn: 1, Answer: '', Copied: false };
			try
			{
				await navigator.clipboard.writeText( answer.Prompt );
				panel.Manual.Copied = true;
			}
			catch ( error )
			{
				// no clipboard (an http page, or a refusal): the prompt is shown to copy by hand
				panel.Manual.Copied = false;
			}
			load_runs( id );
		}
		$scope.$applyAsync();
	};


	$scope.CarryOut = async function ( panel )
	{
		let id = State.OpenId;
		let manual = panel.Manual;
		if ( !manual || !manual.Answer.trim() )
		{
			return;
		}
		panel.Busy = true;
		let answer = await State.Act( function ()
		{
			return Client.Post( '/api/proposals/' + encodeURIComponent( id ) + '/answer', {
				Answer: manual.Answer,
				Revision: manual.Revision,
				ContextRevision: manual.Context ? manual.Context.Revision : null,
				Run: manual.Run,
			} );
		} );
		panel.Busy = false;
		if ( answer && answer.Continue )
		{
			// the LLM asked for more: Consensus answered it, and the next prompt waits for Continue
			manual.Next = { Prompt: answer.Prompt, Revision: answer.Revision, Context: answer.Context, Turn: answer.Turn };
			load_runs( id );
		}
		else if ( answer )
		{
			panel.Result = { Actions: answer.Actions, Refused: Object.keys( answer.Refused ).length };
			panel.Manual = null;
			await State.Reload();
			load_runs( id );
		}
		$scope.$applyAsync();
	};


	// Continue: the next answer's prompt, with what the LLM asked for, goes on the clipboard.
	$scope.Continue = async function ( panel )
	{
		let manual = panel.Manual;
		if ( !manual || !manual.Next )
		{
			return;
		}
		let next = manual.Next;
		panel.Manual = { Prompt: next.Prompt, Revision: next.Revision, Context: next.Context, Run: manual.Run, Turn: next.Turn, Answer: '', Copied: false };
		try
		{
			await navigator.clipboard.writeText( next.Prompt );
			panel.Manual.Copied = true;
		}
		catch ( error )
		{
			panel.Manual.Copied = false;
		}
		$scope.$applyAsync();
	};


	//-----------------------------------------------------------------
	// The run log

	async function load_runs( id )
	{
		try
		{
			let answer = await Client.Get( '/api/proposals/' + encodeURIComponent( id ) + '/runs' );
			if ( id === State.OpenId )
			{
				$scope.Runs = answer.Runs.slice().reverse();
			}
		}
		catch ( error )
		{
			$scope.Runs = [];
		}
		$scope.$applyAsync();
	}


	$scope.Latest = function ()
	{
		return $scope.Runs[ 0 ] || null;
	};


	$scope.Earlier = function ()
	{
		return $scope.Runs.slice( 1 );
	};


	// A step's time, as the page shows it: 12:04:31
	$scope.Clock = function ( at )
	{
		return at ? new Date( at ).toLocaleTimeString( [], { hour: '2-digit', minute: '2-digit', second: '2-digit' } ) : '';
	};


	$scope.Seconds = function ( step )
	{
		return ( typeof step.Seconds === 'number' ) ? step.Seconds.toFixed( 1 ) + ' s' : '';
	};


	$scope.Tokens = function ( step )
	{
		return ( typeof step.Tokens === 'number' ) ? step.Tokens.toLocaleString() + ' tokens' : '';
	};


	//-----------------------------------------------------------------
	// Keeping up

	function shown()
	{
		let panel = $scope.Panel();
		if ( panel && panel.Open )
		{
			settle_destination( panel );
			$scope.Measure();
			load_runs( State.OpenId );
		}
	}


	$scope.$watch( function () { let panel = $scope.Panel(); return ( panel && panel.Open ) ? State.OpenId : null; }, function ( id )
	{
		if ( id )
		{
			shown();
		}
	} );

	$scope.$on( 'proposal-loaded', function ()
	{
		$scope.Measure();
	} );

	$scope.$on( 'changed', function ( event, change )
	{
		if ( change.Proposal && change.Proposal === State.OpenId && ( change.Kind === 'run' || change.Kind === 'llm-finished' ) )
		{
			load_runs( State.OpenId );
		}
	} );

	load_destinations().then( function ()
	{
		shown();
	} );
} ] )


//---------------------------------------------------------------------
// floating-panel="<shown>": the session panel floats in the content area. It opens centered; dragging its heading
// moves it, and the grip in its corner sizes it, both kept within the area. The last place and size are remembered
// in this browser, one for every panel; 'session-reset' puts it back in the center at its first size.

.directive( 'floatingPanel', [ '$timeout', '$window', function ( $timeout, $window )
{
	const BOX_KEY = 'consensus.session-box';
	const MARGIN = 8;
	const MINIMUM_WIDTH = 288;
	const MINIMUM_HEIGHT = 128;

	function read_box()
	{
		try
		{
			let box = JSON.parse( $window.localStorage.getItem( BOX_KEY ) || 'null' );
			return ( box && typeof box.Left === 'number' && typeof box.Top === 'number' ) ? box : null;
		}
		catch ( error )
		{
			return null;
		}
	}


	function write_box( box )
	{
		try
		{
			if ( box )
			{
				$window.localStorage.setItem( BOX_KEY, JSON.stringify( box ) );
			}
			else
			{
				$window.localStorage.removeItem( BOX_KEY );
			}
		}
		catch ( error )
		{
			// not remembered; the panel opens centered
		}
	}


	return {
		restrict: 'A',
		link: function ( scope, element, attributes )
		{
			let panel = element[ 0 ];
			let head = panel.querySelector( '.session-head' );
			let grip = panel.querySelector( '.session-grip' );


			function area()
			{
				return panel.closest( '.content-area' );
			}


			function px( value )
			{
				return Math.round( value ) + 'px';
			}


			// The panel's size as set by the grip, or null while it keeps its first size.
			function sized()
			{
				if ( !panel.style.width || !panel.style.height )
				{
					return null;
				}
				return { Width: panel.offsetWidth, Height: panel.offsetHeight };
			}


			// Keep it within the area: no wider or taller than it, and every edge inside it.
			function fit( left, top )
			{
				let room = area();
				let width = room.clientWidth;
				let height = room.clientHeight;
				if ( panel.style.width && panel.offsetWidth > width - 2 * MARGIN )
				{
					panel.style.width = px( width - 2 * MARGIN );
				}
				if ( panel.style.height && panel.offsetHeight > height - 2 * MARGIN )
				{
					panel.style.height = px( height - 2 * MARGIN );
				}
				let fitted_left = Math.max( MARGIN, Math.min( left, width - panel.offsetWidth - MARGIN ) );
				let fitted_top = Math.max( MARGIN, Math.min( top, height - panel.offsetHeight - MARGIN ) );
				panel.style.left = px( fitted_left );
				panel.style.top = px( fitted_top );
				// with its first size, the panel grows with its content no further than the area's bottom edge
				panel.style.maxHeight = panel.style.height ? '' : px( height - fitted_top - MARGIN );
			}


			function save()
			{
				let box = { Left: panel.offsetLeft, Top: panel.offsetTop };
				let size = sized();
				if ( size )
				{
					box.Width = size.Width;
					box.Height = size.Height;
				}
				write_box( box );
			}


			function center()
			{
				panel.style.width = '';
				panel.style.height = '';
				panel.style.maxHeight = '';
				let room = area();
				fit( ( room.clientWidth - panel.offsetWidth ) / 2, ( room.clientHeight - panel.offsetHeight ) / 2 );
			}


			function place()
			{
				let box = read_box();
				if ( !box )
				{
					center();
				}
				else
				{
					panel.style.width = box.Width ? px( box.Width ) : '';
					panel.style.height = box.Height ? px( box.Height ) : '';
					fit( box.Left, box.Top );
				}
			}


			scope.$watch( attributes.floatingPanel, function ( shown )
			{
				if ( shown )
				{
					$timeout( place, 0 );
				}
			} );

			scope.$on( 'session-reset', function ()
			{
				write_box( null );
				center();
			} );


			// A drag with the left button: Move( dx, dy ) as the pointer goes, then the place and size are saved.
			function drag( down, Move )
			{
				down.preventDefault();
				panel.classList.add( 'moving' );
				function move( event )
				{
					Move( event.clientX - down.clientX, event.clientY - down.clientY );
				}
				function up()
				{
					panel.classList.remove( 'moving' );
					$window.removeEventListener( 'mousemove', move );
					$window.removeEventListener( 'mouseup', up );
					save();
				}
				$window.addEventListener( 'mousemove', move );
				$window.addEventListener( 'mouseup', up );
			}


			// Dragging the heading moves it; its buttons stay buttons.
			head.addEventListener( 'mousedown', function ( down )
			{
				if ( down.button !== 0 || down.target.closest( 'button, input, select, a, label' ) )
				{
					return;
				}
				let start_left = panel.offsetLeft;
				let start_top = panel.offsetTop;
				drag( down, function ( dx, dy )
				{
					fit( start_left + dx, start_top + dy );
				} );
			} );


			// Dragging the grip sizes it, no smaller than a usable minimum and no further than the area's edges.
			grip.addEventListener( 'mousedown', function ( down )
			{
				if ( down.button !== 0 )
				{
					return;
				}
				let start_width = panel.offsetWidth;
				let start_height = panel.offsetHeight;
				let room = area();
				drag( down, function ( dx, dy )
				{
					let most_width = room.clientWidth - panel.offsetLeft - MARGIN;
					let most_height = room.clientHeight - panel.offsetTop - MARGIN;
					panel.style.width = px( Math.max( MINIMUM_WIDTH, Math.min( start_width + dx, most_width ) ) );
					panel.style.height = px( Math.max( MINIMUM_HEIGHT, Math.min( start_height + dy, most_height ) ) );
					panel.style.maxHeight = '';
				} );
			} );


			$window.addEventListener( 'resize', function ()
			{
				if ( panel.offsetParent !== null )
				{
					fit( panel.offsetLeft, panel.offsetTop );
				}
			} );
		},
	};
} ] );
