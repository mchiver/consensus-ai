'use strict';

// Theme - light, dark or system, and small, normal or large. Applied before the page renders, from
// localStorage; Bootstrap's data-bs-theme carries the colours and --scale the size. Announces changes
// on the document as a 'consensus-theme' event, so the editor can follow.

( function ()
{
	const THEMES = [ 'light', 'dark', 'system' ];
	const SCALES = { small: 0.875, normal: 1, large: 1.15 };
	let current = { Theme: 'system', Scale: 'normal' };
	let media = window.matchMedia( '(prefers-color-scheme: dark)' );


	function read( key, fallback )
	{
		try
		{
			return window.localStorage.getItem( key ) || fallback;
		}
		catch ( error )
		{
			return fallback;
		}
	}


	function write( key, value )
	{
		try
		{
			window.localStorage.setItem( key, value );
		}
		catch ( error )
		{
			// storage is a convenience only
		}
	}


	function IsDark()
	{
		if ( current.Theme === 'system' )
		{
			return media.matches;
		}
		return current.Theme === 'dark';
	}


	function apply()
	{
		document.documentElement.dataset.bsTheme = IsDark() ? 'dark' : 'light';
		document.documentElement.style.setProperty( '--scale', String( SCALES[ current.Scale ] || 1 ) );
		document.dispatchEvent( new CustomEvent( 'consensus-theme', { detail: { Dark: IsDark(), Scale: current.Scale } } ) );
	}


	function SetTheme( Theme )
	{
		if ( !THEMES.includes( Theme ) )
		{
			return;
		}
		current.Theme = Theme;
		write( 'consensus.theme', Theme );
		apply();
	}


	function SetScale( Scale )
	{
		if ( !SCALES[ Scale ] )
		{
			return;
		}
		current.Scale = Scale;
		write( 'consensus.scale', Scale );
		apply();
	}


	function Get()
	{
		return { Theme: current.Theme, Scale: current.Scale, Dark: IsDark() };
	}


	current.Theme = THEMES.includes( read( 'consensus.theme', 'system' ) ) ? read( 'consensus.theme', 'system' ) : 'system';
	current.Scale = SCALES[ read( 'consensus.scale', 'normal' ) ] ? read( 'consensus.scale', 'normal' ) : 'normal';
	media.addEventListener( 'change', function ()
	{
		if ( current.Theme === 'system' )
		{
			apply();
		}
	} );
	apply();

	window.ConsensusTheme = {
		THEMES: THEMES,
		SCALES: Object.keys( SCALES ),
		SetTheme: SetTheme,
		SetScale: SetScale,
		Get: Get,
		IsDark: IsDark,
	};
} )();
