# Step 1: The interface definition

The first step of plan MCP Server: every operation of the API defined once and performed by one function, so that the REST API, the MCP server (Step 2) and the run's tools are three faces of one definition. Nothing the server does changes in this step; `test/Api.test.js` is the net under the move.

## The definition

`src/Operations.js` holds the definition and the implementation of every operation the API has today, the sixty-four routes of `src/Api.js`. For each:

- its **name**, a verb phrase in lower_case (`read_plan`, `reply`, `apply`, `set_state`, `create_project`, `export_project`, `mint_token` and so on), the run's tool names kept where they exist today;
- a **description** a model can read, one or two sentences;
- its **parameters**, with their types, which are required, and a sentence each where the name is not enough;
- the **action** `src/Roles.js` checks it against, the same one the route table names today;
- the **function** that performs it: `Operation( Participant, Arguments )`, resolving the JSON the route answers today, or throwing a refusal with the status and the sentence the route answers today.

The functions are the route bodies as they are now, moved out of `Api.js` one by one with their helpers, the store's queue and the events kept inside them. `Operations.js` takes the same context `Api.Attach` takes today (the store, the settings, the events, the runs, the runner, the git, the tokens, the users, Clerk).

## The routing

`src/Api.js` keeps the routing only: each route is its HTTP method and path mapped to an operation, the path parameters, the query and the body folded into one `Arguments` object, the result sent as JSON, a refusal sent with its status. The middleware (identify, authorize, the Clerk routes before identify, the import's body limit) stays where it is. The route table in `src/Roles.js` is unchanged.

## Tests

`test/Operations.test.js`: every route of `Api.js` maps to an operation; every operation has a name, a description, parameters and an action; the names are unique. `test/Api.test.js` unchanged and green through the move; `node --test` green.
