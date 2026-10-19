'use strict';

// Settings - the server's settings (consensus.json) in a popup, for the owner (plan Consensus Desktop, Step 1): the
// Name, the Scope and Port (applied at the next start; plan Run Shapes, Step 1), the States one per line, the Owner
// (its Name read-only, its Display; plan User Management, Step 2: the participants and their tokens are gone), and the Clerk section (plan User Management, Step 1: the keys of a Public
// server's sign-in, empty for a trusted network; a line beside the Scope says what the two come to). Saved through
// PUT /api/settings; the server's problems are shown and nothing is saved while there are any.

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


.controller( 'SettingsController', [ '$scope', 'State', 'Client', 'SettingsPanel', 'Roots', function ( $scope, State, Client, SettingsPanel, Roots )
{
	const SCOPES = [ 'None', 'Local', 'Public' ];
	const CLERK_FIELDS = [ 'PublishableKey', 'SecretKey', 'WebhookSecret', 'AdminEmail' ];
	$scope.Panel = SettingsPanel;
	$scope.Scopes = SCOPES;


	// The Clerk section as the form holds it: the four fields as strings, empty for none.
	function clerk_form( clerk )
	{
		let form = {};
		for ( let field of CLERK_FIELDS )
		{
			form[ field ] = ( clerk && typeof clerk[ field ] === 'string' ) ? clerk[ field ] : '';
		}
		return form;
	}


	// The settings as the form holds them: the states as text, one per line; the Owner's Name and Display; the Clerk
	// section as four strings.
	function to_form( settings )
	{
		return {
			Name: settings.Name || '',
			Scope: SCOPES.includes( settings.Scope ) ? settings.Scope : 'Local',
			Port: settings.Port,
			StatesText: ( settings.States || [] ).join( '\n' ),
			Owner: { Name: ( settings.Owner && settings.Owner.Name ) || 'user', Display: ( settings.Owner && settings.Owner.Display ) || '' },
			Clerk: clerk_form( settings.Clerk ),
		};
	}


	function from_form( form )
	{
		return {
			Name: form.Name,
			Scope: form.Scope,
			Port: form.Port,
			States: String( form.StatesText || '' ).split( /\r?\n/ ).map( function ( line ) { return line.trim(); } ).filter( function ( line ) { return line; } ),
			Owner: { Name: form.Owner.Name, Display: form.Owner.Display },
			Clerk: form.Clerk,
		};
	}


	// What the form's Scope and Clerk keys come to (plan User Management, Step 1), said beneath the Scope.
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
			return 'Local: this machine only. A request is the owner.';
		}
		let keyed = !!( form.Clerk && form.Clerk.PublishableKey.trim() && form.Clerk.SecretKey.trim() );
		if ( keyed )
		{
			return 'Public with Clerk keys: people will sign in through Clerk and Consensus will hold their roles (plan Clerk, not active yet). Until then every request is the owner.';
		}
		return 'Public without Clerk: a trusted network. Every request is the owner, so anyone who can reach this server acts as the owner.';
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
		SettingsPanel.Form = to_form( answer.Settings );
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
