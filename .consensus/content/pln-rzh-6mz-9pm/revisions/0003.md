# Projects - build plan

How to build **Consensus Project Features** (revision 14, every thread applied). Each step ends with `npm test` passing, the server restarted, and a hand check by the User. Nothing moves to the next step until the User says so, and nothing is committed unless the User asks.

## Decisions this plan makes

Comment on any of these. They are my defaults, not settled.

- **Documents and Plans share the proposal folder.** `proposals/<id>/` stays as it is, and `proposal.json` gains a `Kind`: `plan` or `document`. A Document refuses threads and has no `State`. Send has nothing to act on in it, but its text is indexed with the project and reaches the LLM through search, like any Plan's. The routes stay under `/api/proposals` so nothing that already uses them breaks.
- **Corpus items live in `corpora/<id>/`**: `corpus.json` holding `{ Id, Name, Created, Updated, Files }`, the uploaded `corpus.zip`, and `index.json`. A project's tree points to them by id, the same way it points to documents. Moving or copying an item then never touches the tree's own files.
- **Zip reading uses `yauzl`** (3.4.0, MIT, pure JavaScript, no native build, one dependency: `pend`). It works the same on Windows, macOS and Linux and handles Zip64, file-name encodings and data descriptors. `src/Zip.js` is a thin wrapper over it.
- **Upload is the raw body**: `express.raw( { type: 'application/zip' } )`, with no multipart dependency. The page posts the file's bytes directly.
- **Corpus limits are settings** in `consensus.json`: `"Corpus": { "MaxZipMegabytes": 50, "MaxFileKilobytes": 512, "Extensions": [ ".md", ".txt", ".js", ".json", ".html", ".css", ".py", ".cs", ".sql", ".yml", ".yaml", ".xml", ".sh", ".ps1" ] }`. A file is also skipped if it contains a NUL byte.
- **Thread states are stored under their new names.** At startup, a stored `consensus` becomes `resolved`. Applied stays a record on a resolved thread, so a thread reads as Contested, Resolved (waiting to be applied) or Applied.
- **Plan state replaces Status and Approved.** At startup, an approved proposal becomes `Plan` and any other becomes `Proposal`, and `Approved` is dropped. The first entry of `States` is the state a new Plan starts in.
- **Every folder in the tree has an id** (`f…`), so moves and copies name their target by id. A folder or project can be deleted only when it is empty, and Default can never be deleted. A proposal restored from Trash goes back to the root of Default.
- **A new Plan or Document is created in the open project**, at its root or in the selected folder.
- **"Waiting on you" still counts across every project**, so nothing waiting is hidden by a collapsed project.

## Data folder, after

	consensus.json                   + States, + Corpus limits
	projects/<id>/project.json       { Id, Name, Created, Updated, Version, Items: [ node ] }
	                                 node = { Kind: "folder", Id, Name, Items } | { Kind: "plan" | "document" | "corpus", Id }
	proposals/<id>/proposal.json     + Kind, + State;  - Status, - Approved
	corpora/<id>/corpus.json, corpus.zip, index.json
	trash/<id>/                      as today; corpora too

`Version` on `project.json` guards against two tabs moving things at once: a stale version is refused with 409, and the page reloads, as a stale text revision does today.

## Steps

### 1. States

- `src/Rules.js`: `CanApprove`, `ApproveEffect`, `EditEffect` and `CommentEffect` go. `Tally` loses `Approvable`, and `StateLine` reports the thread counts only. Thread `Status` becomes `contested | resolved`, and `Filter` accepts `resolved` in place of `consensus`.
- `src/Store.js`: `Migrate()`, run once by `Server.Start`, rewrites old proposals and threads to the new fields. It is idempotent and logs what it changed.
- `src/Api.js`: `POST /approve` goes. `PUT /api/proposals/:id/state { State }` checks the value against `States` and allows any participant. `GET /api/proposals?state=` replaces `?status=`.
- `public/js/header.js`: a state picker replaces Approve. The thread filters and badges use the new names.
- Tests: `Rules`, `Store` (migration), `Api`, `Ui`.

### 2. Projects in the store and the API

- `src/Store.js`: `ListProjects`, `ReadProject`, `CreateProject`, `WriteProject` (checking `Version`), `DeleteProject`. The first start creates `projects/default/`. `Migrate()` puts every proposal that no project mentions into the root of Default.
- A new `src/Tree.js` with pure functions over `Items`: `Find`, `Insert`, `Remove`, `Ids` (every item id under a node), and `Validate`. It is tested on its own.
- `src/Api.js`:
  - `GET /api/projects` returns the projects with their trees and each item's title, kind and state.
  - `POST /api/projects { Name }`, `PUT /api/projects/:pid { Name, Version }`, `DELETE /api/projects/:pid` (empty only; never Default).
  - `POST /api/projects/:pid/folders { Name, Parent?, Version }` and `DELETE /api/projects/:pid/folders/:fid` (empty only).
  - `POST /api/proposals` takes `{ Title, Text, Kind?, Project?, Parent? }`. It defaults to a Plan at the root of Default.
  - Deleting a proposal removes its node from the tree.
- Events: `{ Kind: "project", Project }` on any tree change.

### 3. The sidebar tree

- `public/js/sidebar.js` and `index.html`: the Proposals and Plans lists become a project tree. Only one project is expanded at a time (opening one collapses the others), and the open project is remembered in `localStorage`. A Plan shows its state and its "waiting on you" count, a Document shows a page icon, and a Corpus item shows a box icon.
- Buttons: new project, new folder, new Plan, new Document. Rename and delete are on each node.
- Trash stays at the bottom of the sidebar, below the tree.
- Tests: `Ui` (create a project, create a Plan in it, expand one project and see the others collapse).

### 4. Documents

- `src/Api.js`: thread routes refuse a Document with 409, and Send skips it.
- The page: a Document opens in the read view with the threads pane hidden. Edit and Revisions work as they do for a Plan, and there's no state picker.
- The index takes Documents like Plans (paragraphs as chunks, no thread chunks).

### 5. Move and copy

- `POST /api/items/:id/move { Project, Parent?, Version }` moves any node, folders included, within a project or into another one.
- `POST /api/items/:id/copy { Project, Parent?, Version }` copies:
  - a Plan or Document: its folder (text, threads and revisions) under a new id, with " (copy)" added to the title;
  - a Corpus item: its folder;
  - a folder: everything under it, with new ids throughout.

  Copies are indexed right away.
- The page: HTML5 drag and drop on tree nodes (dropping on a folder or project root moves the item there). Ctrl+C and Ctrl+V on the selected node, plus Copy and Paste buttons for when the keyboard isn't handy.
- Tests: `Tree`, `Api` (moving between projects, copying a Plan with its threads, copying a folder), `Ui` (one drag and drop).

### 6. Corpus

- `package.json`: add `yauzl`.
- `src/Zip.js`: `Entries( Buffer )` returns `[ { Path, Size, Read() } ]` over yauzl's `fromBuffer`. It skips `__MACOSX/` and `.DS_Store`, rejects paths containing `..` or starting at a root, and refuses an encrypted zip with a clear reason.
- `src/Store.js`: `CreateCorpus`, `ReplaceCorpus`, `ReadCorpus`, `ReadCorpusFile`, `TrashCorpus`.
- `src/Api.js`:
  - `POST /api/projects/:pid/corpus?Name=&Parent=` with the zip as the body.
  - `PUT /api/corpus/:cid` replaces the zip and re-indexes it.
  - `GET /api/corpus/:cid` lists the files, marking which were indexed and which skipped, and why.
  - `GET /api/corpus/:cid/file?path=` returns one file's text.
  - `DELETE /api/corpus/:cid` moves the item to Trash.
- `src/Index.js`: corpus chunks carry `Corpus` and `Path`. A markdown file is chunked by paragraphs, as today; any other text file in blocks of about 40 lines.
- The page: an upload button on the tree, and a corpus view listing the files. Clicking a file shows its text (markdown rendered, anything else as code).
- Tests: `Zip` (zips built in the test with `zlib` and `zlib.crc32`: plain, with data descriptors, UTF-8 names, `__MACOSX/` entries, Zip64, and a bad zip), `Api` (upload, replace, list, limits).

### 7. Search and LLM context scoped to the project

- `src/Index.js`: `SearchAll( Store, Query, Limit, Embedder, Ids )` searches only the chunks of the given ids, and BM25 weights are computed over that set.
- `GET /api/search?q=&project=` searches the open project, and the sidebar box sends the open project.
- `src/Api.js` Send: the context passages for each waiting thread come from the thread's own project, covering its Plans, Documents and Corpus files. The prompt names the project.
- Tests: `Index` (the same question in two projects finds only its own project's passage), `Api`.

### 8. Readme and story

- `readme.md`: the data folder, projects, states, documents, corpus, the new routes, and the settings.
- `.plans/story.md`: what was built and decided.

## Files touched

`src/Rules.js`, `src/Store.js`, `src/Api.js`, `src/Index.js`, `src/Server.js`, `src/Llm.js` (the project name in the prompt), new `src/Tree.js` and `src/Zip.js`, `package.json` (`yauzl`); `public/index.html`, `public/css/consensus.css`, `public/js/sidebar.js`, `header.js`, `threads.js`, `read.js`, `app.js`, and a new `public/js/corpus.js`; tests for each, including new `test/Tree.test.js` and `test/Zip.test.js`.

## Verification

1. `npm test` passes, and no test touches `~data`.
2. On a copy of the real `~data`, the first start migrates it. The existing proposals appear in Default with their threads, and an approved one shows as Plan. A second start changes nothing.
3. By hand in Chrome:
   - create project **Consensus**;
   - move this plan and **Consensus Project Features** into it;
   - add a Document and a folder;
   - upload a zip of `src/`, then search for `write_file` in the sidebar and find `Store.js` within the project only;
   - copy a Plan into Default and see its threads come with it;
   - change a Plan's state to Working;
   - Send to LLM on a thread that asks about the code, and see the LLM's reply draw on the uploaded files.
4. Two tabs: a move in one shows up in the other.
