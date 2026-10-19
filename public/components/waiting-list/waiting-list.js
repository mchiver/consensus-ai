'use strict';

// waiting-list - everything waiting on you (plan UI Components, Step 2), across plans and across every root
// (plan Run Shapes, Step 5), grouped by plan; each group names its server when the page shows more than one.
// Loaded when its view is shown and on every change.
//
// Interface:
//   <waiting-list></waiting-list>
//   reads Roots.List, State.View; listens to view-changed and changed; a click pends the thread for the plan

angular.module( 'Consensus' ).component( 'waitingList', {
	templateUrl: '/components/waiting-list/waiting-list.html',
	controller: [ '$scope', 'State', 'Client', 'Roots', function ( $scope, State, Client, Roots )
	{
		let controller = this;
		controller.State = State;
		controller.Roots = Roots;
		controller.Items = [];
		controller.Groups = [];
		controller.HashFor = Roots.HashFor;


		async function load()
		{
			let items = [];
			for ( let root of Roots.List )
			{
				let answer = null;
				try
				{
					answer = await Client.Get( root, '/api/waiting' );
				}
				catch ( error )
				{
					continue;
				}
				for ( let item of answer.Waiting || [] )
				{
					item.Root = root;
					items.push( item );
				}
			}
			controller.Items = items;
			let groups = [];
			let by_key = {};
			for ( let item of items )
			{
				let key = item.Root.Key + '|' + item.Plan.Id;
				let group = by_key[ key ];
				if ( !group )
				{
					group = { Plan: item.Plan, Root: item.Root, Items: [] };
					by_key[ key ] = group;
					groups.push( group );
				}
				group.Items.push( item );
			}
			controller.Groups = groups;
			$scope.$applyAsync();
		}


		// The byline of who replied, on the item's own server: "<Service> by <Display>", or the display alone.
		controller.DisplayOn = function ( item, record )
		{
			if ( !record || !record.By )
			{
				return '';
			}
			let participant = ( item.Root.Participants || [] ).find( function ( candidate ) { return candidate.Name === record.By; } );
			let who = participant ? participant.Display : record.By;
			return record.Service ? record.Service + ' by ' + who : who;
		};


		controller.Last = function ( item )
		{
			return item.Thread.Replies[ item.Thread.Replies.length - 1 ];
		};


		controller.Open = function ( item )
		{
			State.Pend( { Select: item.Thread.Id } );
		};


		controller.$onInit = function ()
		{
			if ( State.View === 'waiting' )
			{
				load();
			}
		};


		$scope.$on( 'view-changed', function ( event, view )
		{
			if ( view === 'waiting' )
			{
				load();
			}
		} );

		$scope.$on( 'changed', function ()
		{
			if ( State.View === 'waiting' )
			{
				load();
			}
		} );
	} ],
} );
