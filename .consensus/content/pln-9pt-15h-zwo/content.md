# Plan Nomenclature

"Proposal" is deprecated: a plan is a plan, from its first state (Draft) on, and the word "proposal" goes out of the code, the API, the export format, the tests, the page and the documentation. The wide reading, decided 2026-10-14: the API and the export format are renamed too, as a breaking change in one release.

## Vocabulary

- **Plan**: the thing with text, revisions, threads and a state. The first state is Draft; "a draft" is a plan in that state, never a kind of its own.
- **Document**: a Context document, the Readme included; text and revisions, no threads, no state. The store keeps plans and documents the same way, under `Kind: plan | document | context` (context: a Readme made before plan Consensus Desktop; the value stays for old data).
- **In prose**, where a sentence covers both: "a plan or document". In the tree: "item", as the tree already says. The API's umbrella is `plans`: a document is read and written through the plan routes, as it is through the proposal routes today.
- **What keeps its name**: the ids (`pln-`, `doc-`, `ctx-`), the `/api/items/...` routes (a folder, plan or document moved, copied, exported, archived), the page's `#/p/<id>` hash, the store's constants naming the folders of a config from before Step 2 (`proposals/`, read for the migration only), the history note in the settings guide ("the first state was called Proposal before"), and git history.

## The API

- Routes: every `/api/proposals...` route becomes `/api/plans...`, the same verbs, bodies and answers: the list, create, read, title, state, text, delete, revisions, threads, replies, anchor, resolve, thread delete, apply. The old paths are gone (no aliases): every client is in this repository, and an LLM session reads the instructions page afresh each turn.
- Fields: `Proposal` becomes `Plan` and `Proposals` becomes `Plans` wherever a response or an event carries them: the list (`{ Plans }`), create and read (`{ Plan, ... }`), the waiting list (`{ Me, Waiting: [ { Plan, Thread } ] }`), the events stream (`{ Plan | Project, Kind, Thread? }`), and the run package's hints.
- Version: the server's version goes to 0.5.0 (the breaking change). `GET /api/me` says so.

## The export format

- `Format: consensus-project`, `Version: 2`: `Plans: [ { Plan, Text, Threads, Revisions } ]` in place of `Proposals: [ { Proposal, ... } ]`; nothing else changes.
- Import takes Version 1 as well, mapping the old names on the way in, so an export made before this plan still imports (one mapping in ProjectPort.js, with a test over a Version 1 file). Export writes Version 2 only.
- The data on disk needs no migration: a plan's folder (`content.json`, `content.md`, `threads.json`, `revisions/`) and `project.json` carry no "proposal" field today.

## The code

- Server: `Store.js` (`ListPlans`, `ReadPlan`, `CreatePlan`, `UpdatePlan`, `WriteWholePlan`, `CopyPlan`, `MovePlan`, `ArchivePlan`, `RestorePlan`, `TrashPlan`, and the variables), `Api.js` (routes, fields, helpers), `Events.js`, `ProjectPort.js`, `Ids.js` (`ForPlan`), `Package.js` (the documents hint names `GET /api/plans/<id>`), `Runner.js`, `Tools.js` (the tool that reads a plan or document of the project, and the tool instructions a local model gets), `Rules.js`, `Anchors.js` where they say the word; the comments with them.
- Page: `State.Open.Plan` in place of `State.Open.Proposal` through `app.js`, `header.js`, `hotkeys.js`, `tabs.js`, `threads.js`, `waiting.js`, `llm.js` and the rest; the `Delete( 'plan', ... )` kind; the visible texts: "Select a passage of a plan to comment on it" and the state picker's "the plan's state: anyone can change it"; the comments.
- Desktop: nothing names it today; checked as part of the build.
- Tools: `bin/docs.js` (the seeded demo's calls), `bin/consensus.js` if it says the word.
- Tests: every test file that says it (Anchors, Api, Desktop, GlobalIds, ProjectPort, Rules, Server, Store, Tools, Ui): titles, variables, paths and fields; a new test for a Version 1 import.
- Nothing is renamed by a blind replace: `proposal` is the umbrella in places where a document is meant too, and the new word there is "plan" for the API and the store, "plan or document" in a comment that explains the difference.

## The documentation

- `docs/guide/api.md`: the route table and the events paragraph; `docs/guide/export-import.md`: the format's version and the Version 1 note; the other guide pages where the word appears; rebuilt with `bin/docs.js build`, published on the owner's word.
- `.guides/build-with-consensus.md`: the routes list and the note added 2026-10-14 (which then says only that documents go through the plan routes).
- The project Readme's Architecture and Settled decisions lines, and the agent's own memory of the API.

## The build

- One build, one commit, "Plan Nomenclature", in three checkpoints: the server with its tests; the page, the desktop and the tools; the documentation, the instructions and the version. `node --test` green at the end of each (180 tests, plus the Version 1 import test); the Ui test is the check that the page follows the server.
- After the commit, on the owner's word: push, redeploy cube4 (its other projects import unchanged; their files carry no "proposal" field), publish the docs. Any LLM session then reads the new instructions on its next turn.
- Reviewed before the build: a grep for the word, case-insensitive, over `src`, `public`, `desktop`, `bin`, `test`, `docs`, `.guides` is the done check, with only the kept names (the Vocabulary section's last point) left.
