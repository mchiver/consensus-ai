'use strict';

// The website's page: the theme (light or dark, the system's unless the toggle was used, remembered in the
// browser), the soft entrance of sections as the page scrolls, and the lightbox a screenshot opens in.
// Loaded in the head, so the theme is applied before the page renders.

( function ()
{
	const KEY = 'consensus-site.theme';
	let media = window.matchMedia( '(prefers-color-scheme: dark)' );


	function read()
	{
		try
		{
			return window.localStorage.getItem( KEY );
		}
		catch ( error )
		{
			return null;
		}
	}


	function write( Value )
	{
		try
		{
			window.localStorage.setItem( KEY, Value );
		}
		catch ( error )
		{
			// storage is a convenience only
		}
	}


	function is_dark()
	{
		let saved = read();
		if ( saved === 'light' || saved === 'dark' )
		{
			return saved === 'dark';
		}
		return media.matches;
	}


	function apply()
	{
		document.documentElement.dataset.bsTheme = is_dark() ? 'dark' : 'light';
	}


	function toggle()
	{
		write( is_dark() ? 'light' : 'dark' );
		apply();
	}


	function reveal()
	{
		let sections = document.querySelectorAll( '.reveal' );
		if ( !( 'IntersectionObserver' in window ) )
		{
			sections.forEach( function ( Section ) { Section.classList.add( 'shown' ); } );
			return;
		}
		let observer = new IntersectionObserver( function ( Entries )
		{
			Entries.forEach( function ( Entry )
			{
				if ( Entry.isIntersecting )
				{
					Entry.target.classList.add( 'shown' );
					observer.unobserve( Entry.target );
				}
			} );
		}, { threshold: 0.12 } );
		sections.forEach( function ( Section ) { observer.observe( Section ); } );
	}


	function lightbox()
	{
		let box = document.getElementById( 'lightbox' );
		if ( !box )
		{
			return;
		}
		let image = box.querySelector( 'img' );

		function open( Source, Alt )
		{
			image.src = Source;
			image.alt = Alt || '';
			box.hidden = false;
		}

		function close()
		{
			box.hidden = true;
			image.src = '';
		}

		document.querySelectorAll( 'figure.shot img, .hero-shot img' ).forEach( function ( Shot )
		{
			Shot.addEventListener( 'click', function () { open( Shot.currentSrc || Shot.src, Shot.alt ); } );
		} );
		box.addEventListener( 'click', close );
		document.addEventListener( 'keydown', function ( Event )
		{
			if ( Event.key === 'Escape' && !box.hidden )
			{
				close();
			}
		} );
	}


	apply();
	media.addEventListener( 'change', apply );

	document.addEventListener( 'DOMContentLoaded', function ()
	{
		document.querySelectorAll( '[data-theme-toggle]' ).forEach( function ( Button )
		{
			Button.addEventListener( 'click', toggle );
		} );
		reveal();
		lightbox();
	} );

	window.ConsensusSite = { Toggle: toggle, IsDark: is_dark };
} )();
