# Step 1: Consensus Web Server Rework

Subplan of Consensus Desktop. Remove all LLM connectivity and Workspaces from the existing Consensus server. The server's Web UI and API support the core Consensus functionality only: the Project Tree and its items, direct editing, and the turn-based Thread/Reply mechanism. The Review and Build buttons, the indexing and the RAG functionality go. The LLM still takes part through manual updates to Consensus and a "your turn in Consensus" prompt.

## What goes away

- **Code:** `src/Llm.js` (callers, prompts, sessions, runs, usage), `src/Workers.js`, `src/Worker.js`, `src/Workspace.js`, `src/Mcp.js`, `bin/worker.js`, the worker's page `public/worker/`, the worker app `worker-app/`, `src/Index.js`, `src/Vectors.js`, and the corpora: `src/Corpus.js`, `src/Zip.js`, `src/Filter.js`. Git history keeps them; Step 3 draws on the worker's code. The dependencies `yauzl` and `ignore` go with them, and `electron` until Step 2.
- **Routes:** every `/api/workers/*` and `/api/llm/*` route; on a proposal `session`, `send`, `build`, `answer`, `prompt` and `runs`; `/api/projects/:pid/workspace` and `/api/projects/:pid/context/initialize`; `/api/projects/:pid/corpus` and `/api/corpus/*`; `/api/usage`; `/api/search`. `/api/waiting`, `/api/events`, the project, folder, item, proposal, thread, revision, trash, export and import routes stay as they are.
- **The page:** Review, Build, Initialize context and the Review pane (`sessions.js`, `build.js`), the search box and view, the corpus view and Upload zip, the LLM usage line, the project's Workspace picker and line. Waiting on you stays: it is the turn.
- **Settings:** the llm participant's `Call`, `Workers`, `Corpus`, `Context.MaxCharacters` and `Embedding`. The participants stay, roles and tokens included: the llm participant is still the one an agent session posts as.
- **Data:** `usage.json`, every `index.json`, `runs.json` and `projects/<id>/corpora/`. Export and import carry no corpora, destinations or runs; an export from before still imports, with those parts dropped.
- **Tests:** `Llm`, `Workers`, `Worker`, `WorkerUi`, `WorkerApp`, `Index`, `Vectors`, `Zip` and `Filter`; `Api` and `Ui` lose their LLM, worker and corpus cases.
- **The guide** `.guides/build-with-consensus.md` (and `GET /instructions`) stays, rewritten for what remains: the API, the turn, the build loop of an agent session. Review, Build and workers come out of it.

## The settings modal

- The server's data folder holds its configuration file, `consensus.json`, as today.
- **Settings** in the header (owner only) opens a modal over `consensus.json`: `Host` and `Port` (applied at the next start, said so in the modal), `States` (the list, one per line; a state in use by a plan cannot be removed) and `Participants` (Name, Display, Role; a token shown, copied or renewed per participant).
- The modal reads and writes through two new routes, `GET /api/settings` and `PUT /api/settings` (owner only; the whole object, checked as at start). Everything but Host and Port applies at once.
- The modal shows the same problems the server would report at start; nothing is saved while there are problems.

## Theme and style

- Theme (light, dark or system) and scale (small, normal or large) are not server settings. The web page keeps them in the browser's storage, per user and per server, as today; the desktop app keeps them in its own configuration (Step 2).

## The Context folder

- Every project has a folder named **Context** at its root, first in the tree, holding its **Context** document. The folder is not renamed, moved or deleted, and nor is the document; both are made with the project. The folder holds documents only, no folders and no plans, and stays flat, which also discourages overuse of the Context folder; **New Document** is offered there and nowhere else. The rest of the tree holds folders and plans (Subplans included).
- The kind `context` goes: the Context document is a document like any other, with revisions and no threads. `project.json` keeps `Context` as the id of that document.
- At the server's first start on existing data, each project's context proposal becomes the Context document in a new Context folder; there are no other documents to move. Corpora in the tree go to the trash. The migration runs once and says what it did on the console.
- An agent session reads the Context folder's documents for the project's background (plan Agent Instructions says how), as it reads the context today.

## After Step 1

- `npm test` is the remaining suites; the Docker image is rebuilt and loaded on cube4, which migrates its data at start.
- `readme.md` and `.guides/build-with-consensus.md` describe the server as it then is.
