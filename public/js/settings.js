'use strict';

// Settings - the server's settings (consensus.json) in a popup, for the owner (plan Consensus Desktop, Step 1): the
// Name, the Scope and Port (applied at the next start; plan Run Shapes, Step 1), the States one per line, the Owner
// (its Name read-only, its Display; plan User Management, Step 2: the participants and their tokens are gone; the Clerk
// section left the popup on 2026-10-20 and is the file's: the form sends none and the server keeps it), a line beneath
// the Scope saying what the Scope comes to (plan Clerk, Step 5: Public is offered to a session with a Professional license
// alone, the Sign in button beside the line asking for one on a Local server), and the Tasks
// (plan LLM Tasks, Step 1: one row per task, its Name, Writes, the Package switches (Box, Step 2, off for a new one) and its Prompt; Add, Remove,
// up and down, Reset for a shipped one; the levels, the switches and the defaults come from GET /api/tasks). Saved
// through PUT /api/settings; the server's problems are shown and nothing is saved while there are any.

angular.module( 'Consensus' ).factory( 'SettingsPanel', [ function ()
{
	let panel = {
		Open: false,
		Path: '',
		Form: null,
		Problems: [],
		Restart: false,
		Busy: false,
		Saved: false,
	};
	return panel;
} ] )


.controller( 'SettingsController', [ '$scope', 'State', 'Client', 'SettingsPanel', 'Roots', 'Session', function ( $scope, State, Client, SettingsPanel, Roots, Session )
{
	const SCOPES = [ 'None', 'Local', 'Public' ];
	$scope.Panel = SettingsPanel;
	$scope.Scopes = SCOPES;
	$scope.TaskItems = { Writes: [ 'none', 'consensus', 'files' ], Package: [ 'Instructions', 'Readme', 'Documents', 'Plan', 'Threads', 'Files', 'Project', 'Box' ], Off: [ 'Project', 'Box' ], Defaults: [] };


	// The settings as the form holds them: the states as text, one per line; the Owner's Name and Display; the Tasks.
	// The file's Clerk section is not the form's: left out of the save, the server keeps it.
	function to_form( settings )
	{
		return {
			Name: settings.Name || '',
			Scope: SCOPES.includes( settings.Scope ) ? settings.Scope : 'Local',
			Port: settings.Port,
			StatesText: ( settings.States || [] ).join( '\n' ),
			Owner: { Name: ( settings.Owner && settings.Owner.Name ) || 'user', Display: ( settings.Owner && settings.Owner.Display ) || '' },
			Tasks: ( settings.Tasks || [] ).map( task_form ),
		};
	}


	// A task as the form holds it: a copy, its Package a copy too.
	function task_form( task )
	{
		return { Id: task.Id || '', Name: task.Name || '', Writes: task.Writes || 'consensus', Package: Object.assign( {}, task.Package || {} ), Prompt: task.Prompt || '' };
	}


	function from_form( form )
	{
		return {
			Name: form.Name,
			Scope: form.Scope,
			Port: form.Port,
			States: String( form.StatesText || '' ).split( /\r?\n/ ).map( function ( line ) { return line.trim(); } ).filter( function ( line ) { return line; } ),
			Owner: { Name: form.Owner.Name, Display: form.Owner.Display },
			Tasks: ( form.Tasks || [] ).map( task_form ),
		};
	}


	//-----------------------------------------------------------------
	// The Tasks: added at the end (the server gives the id), removed, moved, a shipped one's prompt reset.

	$scope.AddTask = function ()
	{
		let package_ = {};
		for ( let item of $scope.TaskItems.Package )
		{
			package_[ item ] = !( $scope.TaskItems.Off || [ 'Box' ] ).includes( item );
		}
		SettingsPanel.Form.Tasks.push( { Id: '', Name: '', Writes: 'consensus', Package: package_, Prompt: '' } );
	};


	$scope.RemoveTask = function ( index )
	{
		SettingsPanel.Form.Tasks.splice( index, 1 );
	};


	$scope.MoveTask = function ( index, by )
	{
		let tasks = SettingsPanel.Form.Tasks;
		let to = index + by;
		if ( to < 0 || to >= tasks.length )
		{
			return;
		}
		let moved = tasks.splice( index, 1 )[ 0 ];
		tasks.splice( to, 0, moved );
	};


	function default_of( task )
	{
		return $scope.TaskItems.Defaults.find( function ( one ) { return one.Id === task.Id; } ) || null;
	}


	$scope.HasDefault = function ( task )
	{
		return !!default_of( task );
	};


	$scope.ResetTask = function ( task )
	{
		let shipped = default_of( task );
		if ( shipped )
		{
			task.Prompt = shipped.Prompt;
		}
	};


	// What the form's Scope comes to (plan User Management, Step 1; plan Clerk, Step 5), said beneath the Scope.
	$scope.TrustNote = function ()
	{
		let form = SettingsPanel.Form;
		if ( !form )
		{
			return '';
		}
		if ( form.Scope === 'None' )
		{
			return 'None: no server is started; the desktop is a client of other servers only.';
		}
		if ( form.Scope === 'Local' )
		{
			// a Server tells people apart whatever its Scope (plan The Server, Step 5); a project's own server is the owner's
			let people = !!( SettingsPanel.Root && SettingsPanel.Root.People );
			return 'Local: this machine only. ' + ( people ? 'People sign in and act by their roles; a request with no session and no token is refused.' : 'A request is the owner.' ) + ( $scope.ScopeAllowed( 'Public' ) ? '' : ' Public needs a sign-in with a Professional license.' );
		}
		return 'Public: people sign in through Consensus-AI with a license and act by their roles. A request with no session and no token is refused.';
	};


	// The popup opened on the page's own server (Session.Base: the browser's one root, or the desktop's own), not on
	// another root.
	function own_server()
	{
		let base = SettingsPanel.Root ? ( SettingsPanel.Root.Base || '' ) : '';
		return Session.Base !== null && base === Session.Base;
	}


	// Public is offered to a session with a Professional license, and to a server that is Public already.
	$scope.ScopeAllowed = function ( scope )
	{
		if ( scope !== 'Public' || SettingsPanel.WasPublic )
		{
			return true;
		}
		return own_server() && Session.Licensed( 'professional' );
	};


	$scope.CanSignIn = function ()
	{
		return own_server() && Session.On && !Session.SignedIn();
	};


	$scope.SignIn = function ()
	{
		Session.Open();
	};


	// Opened by a root's Settings (the sidebar): that server's settings, read afresh each time.
	$scope.$on( 'settings-opened', function ( event, root )
	{
		open( root || State.Root );
	} );


	async function open( root )
	{
		SettingsPanel.Problems = [];
		SettingsPanel.Restart = false;
		SettingsPanel.Saved = false;
		SettingsPanel.Form = null;
		SettingsPanel.Root = root;
		SettingsPanel.Open = true;
		let answer = await State.Act( function () { return Client.Get( root, '/api/settings' ); } );
		if ( !answer )
		{
			SettingsPanel.Open = false;
			$scope.$applyAsync();
			return;
		}
		SettingsPanel.Path = answer.Path;
		SettingsPanel.WasPublic = ( answer.Settings.Scope === 'Public' );
		SettingsPanel.Form = to_form( answer.Settings );
		try
		{
			let tasks = await Client.Get( root, '/api/tasks' );
			$scope.TaskItems = { Writes: tasks.Writes || $scope.TaskItems.Writes, Package: tasks.Package || $scope.TaskItems.Package, Off: tasks.Off || $scope.TaskItems.Off, Defaults: tasks.Defaults || [] };
		}
		catch ( error )
		{
			// the popup keeps its own lists; Reset is not offered
		}
		$scope.$applyAsync();
	}


	$scope.Close = function ()
	{
		SettingsPanel.Open = false;
		SettingsPanel.Form = null;
	};


	$scope.Key = function ( event )
	{
		if ( event.key === 'Escape' )
		{
			$scope.Close();
		}
	};


	$scope.Save = async function ()
	{
		if ( !SettingsPanel.Form || SettingsPanel.Busy )
		{
			return;
		}
		SettingsPanel.Busy = true;
		SettingsPanel.Problems = [];
		SettingsPanel.Saved = false;
		let settings = from_form( SettingsPanel.Form );
		try
		{
			let answer = await Client.Put( SettingsPanel.Root, '/api/settings', { Settings: settings } );
			SettingsPanel.Form = to_form( answer.Settings );
			SettingsPanel.Restart = !!answer.Restart;
			SettingsPanel.Saved = true;
			await Roots.LoadMe( SettingsPanel.Root || State.Root );
		}
		catch ( error )
		{
			SettingsPanel.Problems = ( error.Body && error.Body.Problems ) ? error.Body.Problems : [ error.message ];
		}
		SettingsPanel.Busy = false;
		$scope.$applyAsync();
	};
} ] );
