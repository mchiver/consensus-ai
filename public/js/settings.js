'use strict';

// Settings - the server's settings (consensus.json) in a popup, for the owner (plan Consensus Desktop, Step 1): Host
// and Port (applied at the next start), the States one per line, and the participants with their roles and tokens.
// Saved whole through PUT /api/settings; the server's problems are shown and nothing is saved while there are any.

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


.controller( 'SettingsController', [ '$scope', 'State', 'Client', 'SettingsPanel', function ( $scope, State, Client, SettingsPanel )
{
	const ROLES = [ 'owner', 'llm', 'member' ];
	$scope.Panel = SettingsPanel;
	$scope.Roles = ROLES;


	// The settings as the form holds them: the states as text, one per line; each participant with its Token as a
	// string (empty for none).
	function to_form( settings )
	{
		return {
			Host: settings.Host || '',
			Port: settings.Port,
			StatesText: ( settings.States || [] ).join( '\n' ),
			Participants: ( settings.Participants || [] ).map( function ( participant )
			{
				return { Name: participant.Name || '', Display: participant.Display || '', Role: participant.Role || 'member', Token: participant.Token || '' };
			} ),
		};
	}


	function from_form( form )
	{
		return {
			Host: form.Host,
			Port: form.Port,
			States: String( form.StatesText || '' ).split( /\r?\n/ ).map( function ( line ) { return line.trim(); } ).filter( function ( line ) { return line; } ),
			Participants: form.Participants.map( function ( participant )
			{
				return { Name: participant.Name, Display: participant.Display, Role: participant.Role, Token: participant.Token };
			} ),
		};
	}


	// Opened by the sidebar's Settings button: the settings are read afresh each time.
	$scope.$on( 'settings-opened', function ()
	{
		open();
	} );


	async function open()
	{
		SettingsPanel.Problems = [];
		SettingsPanel.Restart = false;
		SettingsPanel.Saved = false;
		SettingsPanel.Form = null;
		SettingsPanel.Open = true;
		let answer = await State.Act( function () { return Client.Get( '/api/settings' ); } );
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


	$scope.AddParticipant = function ()
	{
		SettingsPanel.Form.Participants.push( { Name: '', Display: '', Role: 'member', Token: '' } );
	};


	$scope.RemoveParticipant = function ( index )
	{
		SettingsPanel.Form.Participants.splice( index, 1 );
	};


	// A new token, made here: 24 random bytes as hex, as the server makes them.
	$scope.NewToken = function ( participant )
	{
		let bytes = new Uint8Array( 24 );
		window.crypto.getRandomValues( bytes );
		participant.Token = Array.from( bytes ).map( function ( byte ) { return byte.toString( 16 ).padStart( 2, '0' ); } ).join( '' );
	};


	$scope.CopyToken = function ( participant )
	{
		if ( participant.Token && navigator.clipboard )
		{
			navigator.clipboard.writeText( participant.Token ).catch( function () {} );
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
			let answer = await Client.Put( '/api/settings', { Settings: settings } );
			SettingsPanel.Form = to_form( answer.Settings );
			SettingsPanel.Restart = !!answer.Restart;
			SettingsPanel.Saved = true;
			await State.LoadMe();
		}
		catch ( error )
		{
			SettingsPanel.Problems = ( error.Body && error.Body.Problems ) ? error.Body.Problems : [ error.message ];
		}
		SettingsPanel.Busy = false;
		$scope.$applyAsync();
	};
} ] );
