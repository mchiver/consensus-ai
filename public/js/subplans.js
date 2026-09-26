'use strict';

// Subplans - a new Subplan under a plan, started from the tree, the header, a thread (new or replied to), or
// selected text. A small form asks for its title; the Subplan is made under its parent with its starting text,
// and a thread it came from gets a reply naming it with a link. The form stays open on a refusal.

angular.module( 'Consensus' )

.factory( 'Subplans', [ 'Client', 'State', '$window', function ( Client, State, $window )
{
	// Pending = { Parent: { Id, Title }, Project, Title, Seed, Compose?: { Anchor, Text }, Thread?: { Id }, Draft? }
	let subplans = { Pending: null, Busy: false };


	//-----------------------------------------------------------------
	// Starting text

	function quote( text )
	{
		return String( text ).split( '\n' ).map( function ( line ) { return '> ' + line; } ).join( '\n' );
	}


	// A thread's anchored passage quoted, then what was said in it, the draft last.
	function thread_seed( anchor, replies, draft )
	{
		let parts = [];
		if ( anchor && anchor.Text )
		{
			parts.push( quote( anchor.Text ) );
		}
		for ( let reply of replies )
		{
			parts.push( '**' + State.DisplayOf( reply.By ) + ':** ' + reply.Text );
		}
		if ( draft && draft.trim() )
		{
			parts.push( '**' + State.DisplayOf( State.Me.Name ) + ':** ' + draft.trim() );
		}
		return parts.join( '\n\n' );
	}


	// The open plan, as a Subplan's parent.
	function open_parent()
	{
		return { Parent: { Id: State.Open.Proposal.Id, Title: State.Open.Proposal.Title }, Project: State.Open.Project ? State.Open.Project.Id : null };
	}


	//-----------------------------------------------------------------
	// Starting

	// Under a plan of the tree, or the open plan when Node is not given; empty.
	function Start( Node, Project )
	{
		let where = Node ? { Parent: { Id: Node.Id, Title: Node.Title }, Project: Project } : open_parent();
		subplans.Pending = Object.assign( where, { Title: '', Seed: '' } );
	}


	// From the thread being composed: the thread is posted with a link to the Subplan.
	function FromCompose( Compose )
	{
		subplans.Pending = Object.assign( open_parent(), { Title: '', Seed: thread_seed( Compose.Anchor, [], Compose.Text ), Compose: Compose } );
	}


	// From a thread: the reply (the draft, if any) carries the link to the Subplan.
	function FromThread( Thread, Draft )
	{
		subplans.Pending = Object.assign( open_parent(), { Title: '', Seed: thread_seed( Thread.Anchor, Thread.Replies, Draft ), Thread: { Id: Thread.Id }, Draft: Draft || '' } );
	}


	// From selected text: the Subplan starts with it; the parent is not changed.
	function FromSelection( Anchor )
	{
		subplans.Pending = Object.assign( open_parent(), { Title: '', Seed: quote( Anchor.Text ) } );
	}


	function Cancel()
	{
		subplans.Pending = null;
	}


	//-----------------------------------------------------------------
	// Creating

	function link_to( title, id )
	{
		return 'Started a new Subplan: [' + title.replace( /[\[\]]/g, '' ) + '](#/p/' + encodeURIComponent( id ) + ')';
	}


	function joined( text, link )
	{
		return ( text && text.trim() ) ? text.trim() + '\n\n' + link : link;
	}


	async function Create()
	{
		let pending = subplans.Pending;
		let title = ( pending && pending.Title || '' ).trim();
		if ( !title || subplans.Busy )
		{
			return;
		}
		subplans.Busy = true;
		let threads = '/api/proposals/' + encodeURIComponent( pending.Parent.Id ) + '/threads';
		let made = await State.Act( function ()
		{
			let text = '# ' + title + '\n\n' + ( pending.Seed ? pending.Seed + '\n' : '' );
			return Client.Post( '/api/proposals', { Title: title, Text: text, Kind: 'plan', Project: pending.Project, Parent: pending.Parent.Id } );
		} );
		if ( made )
		{
			let link = link_to( title, made.Proposal.Id );
			if ( pending.Compose )
			{
				await State.Act( function () { return Client.Post( threads, { Anchor: pending.Compose.Anchor, Text: joined( pending.Compose.Text, link ) } ); } );
				State.CancelCompose();
			}
			if ( pending.Thread )
			{
				await State.Act( function () { return Client.Post( threads + '/' + pending.Thread.Id + '/replies', { Text: joined( pending.Draft, link ) } ); } );
				delete State.Drafts[ pending.Thread.Id ];
			}
			subplans.Pending = null;
			await State.LoadList();
			$window.location.hash = '#/p/' + encodeURIComponent( made.Proposal.Id );
		}
		subplans.Busy = false;
	}


	subplans.Start = Start;
	subplans.FromCompose = FromCompose;
	subplans.FromThread = FromThread;
	subplans.FromSelection = FromSelection;
	subplans.Cancel = Cancel;
	subplans.Create = Create;
	return subplans;
} ] )


//---------------------------------------------------------------------
// The form: the title, what the Subplan starts with, Create and Cancel.

.controller( 'SubplanController', [ '$scope', 'Subplans', function ( $scope, Subplans )
{
	$scope.Subplans = Subplans;


	$scope.Create = async function ()
	{
		await Subplans.Create();
		$scope.$applyAsync();
	};


	$scope.Cancel = function ()
	{
		Subplans.Cancel();
	};


	$scope.Key = function ( event )
	{
		if ( event.key === 'Escape' )
		{
			event.stopPropagation();
			Subplans.Cancel();
		}
	};
} ] );
