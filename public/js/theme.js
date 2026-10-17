'use strict';

// Theme - a palette (light, dark, system, or one of the assortment: plan UI Tweaks IV) and small, normal or large.
// Applied before the page renders, from localStorage; Bootstrap's data-bs-theme carries light or dark, data-theme
// the palette, and --scale the size. Announces changes on the document as a 'consensus-theme' event, so the editor
// can follow.
// The desktop's copy (plan Consensus Desktop, Step 2): hosted by the desktop (window.ConsensusDesktop), the theme and
// the scale come from its settings and go back to them, in place of the browser's storage.

( function ()
{
	const PALETTES = [
		{ Id: 'system', Label: 'System', Dark: null },
		{ Id: 'light', Label: 'Light', Dark: false },
		{ Id: 'sepia', Label: 'Sepia', Dark: false },
		{ Id: 'paper', Label: 'Paper', Dark: false },
		{ Id: 'solarized-light', Label: 'Solarized Light', Dark: false },
		{ Id: 'dark', Label: 'Dark', Dark: true },
		{ Id: 'slate', Label: 'Slate', Dark: true },
		{ Id: 'solarized-dark', Label: 'Solarized Dark', Dark: true },
		{ Id: 'nord', Label: 'Nord', Dark: true },
		{ Id: 'midnight', Label: 'Midnight', Dark: true },
	];
	const THEMES = PALETTES.map( function ( palette ) { return palette.Id; } );
	const SCALES = { small: 0.875, normal: 1, large: 1.15 };
	let current = { Theme: 'system', Scale: 'normal' };
	let media = window.matchMedia( '(prefers-color-scheme: dark)' );
	let desktop = window.ConsensusDesktop || null;


	function read( key, fallback )
	{
		if ( desktop )
		{
			return ( ( key === 'consensus.theme' ) ? desktop.Theme : desktop.Scale ) || fallback;
		}
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
		if ( desktop )
		{
			if ( key === 'consensus.theme' )
			{
				desktop.SetTheme( value );
			}
			else
			{
				desktop.SetScale( value );
			}
			return;
		}
		try
		{
			window.localStorage.setItem( key, value );
		}
		catch ( error )
		{
			// storage is a convenience only
		}
	}


	function palette_of( id )
	{
		return PALETTES.find( function ( palette ) { return palette.Id === id; } ) || PALETTES[ 0 ];
	}


	function IsDark()
	{
		let palette = palette_of( current.Theme );
		if ( palette.Dark === null )
		{
			return media.matches;
		}
		return palette.Dark;
	}


	// Palette: the palette in effect; for System, light or dark as the system says.
	function Palette()
	{
		if ( current.Theme === 'system' )
		{
			return media.matches ? 'dark' : 'light';
		}
		return current.Theme;
	}


	function apply()
	{
		document.documentElement.dataset.bsTheme = IsDark() ? 'dark' : 'light';
		document.documentElement.dataset.theme = Palette();
		document.documentElement.style.setProperty( '--scale', String( SCALES[ current.Scale ] || 1 ) );
		document.dispatchEvent( new CustomEvent( 'consensus-theme', { detail: { Dark: IsDark(), Theme: Palette(), Scale: current.Scale } } ) );
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
		return { Theme: current.Theme, Scale: current.Scale, Dark: IsDark(), Palette: Palette() };
	}


	// A computed colour as "#rrggbb", which the desktop's overlay takes.
	function hex_of( color )
	{
		let found = /rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/.exec( color || '' );
		if ( !found )
		{
			return '#000000';
		}
		let parts = [ found[ 1 ], found[ 2 ], found[ 3 ] ].map( function ( part )
		{
			return ( '0' + Number( part ).toString( 16 ) ).slice( -2 );
		} );
		return '#' + parts.join( '' );
	}


	// ReportChrome (plan UI Components, Step 5): in the desktop, Electron draws the window buttons over the page's
	// title bar (desktop/main.js, titleBarOverlay); told the bar's background, text colour and height, once it is
	// drawn and after every change here, they follow the palette and the size. Element is the bar; nothing happens
	// in a browser.
	function ReportChrome( Element )
	{
		if ( !desktop || typeof desktop.SetChrome !== 'function' || !Element )
		{
			return;
		}
		let style = window.getComputedStyle( Element );
		desktop.SetChrome( {
			Color: hex_of( style.backgroundColor ),
			Symbol: hex_of( style.color ),
			Height: Math.round( Element.getBoundingClientRect().height ),
		} );
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
		PALETTES: PALETTES,
		SCALES: Object.keys( SCALES ),
		SetTheme: SetTheme,
		SetScale: SetScale,
		Get: Get,
		IsDark: IsDark,
		Palette: Palette,
		ReportChrome: ReportChrome,
	};
} )();
