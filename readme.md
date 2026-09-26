# Consensus

Collaborative proposal building. The User and the LLM work a proposal through in discussion, thread by
thread, until every thread is resolved and applied. Proposals live in **projects**, beside the reference
documents and uploaded code that give the LLM the context of the work.

A standalone application: Node and Express on the server, AngularJS, Bootstrap, marked and Monaco in the
page, plain files in a data folder. The browser is the User; Consensus calls the LLM when the User presses
Send to LLM. Nothing runs anywhere but this workstation, except the LLM the settings name.

## Starting it

	npm install
	node bin/consensus.js [--data <folder>] [--port 3500]

The server listens on `127.0.0.1` only and refuses any other host. It prints its address, the data folder
and the settings file. Open `http://127.0.0.1:3500/` in a browser.

	npm test

runs every test, including the page in a headless Chrome or Edge (`test/Ui.test.js`, which needs one of
them installed). No test touches the real data folder.

## Projects and what they hold

The sidebar is a tree of projects. One project is open at a time: opening one closes the others, and
opening an item opens its project. A project holds, in folders of any depth:

- **Plans**: what is discussed, commented on and sent to the LLM. Each has a **state**, one of the settings'
  `States` (by default Proposal, Plan, Working, Finished). Anyone changes it at any time from the picker in
  the heading; nothing locks, and a state does not depend on the threads.
- **Documents**: markdown edited in Monaco with revisions, but with no threads and no state. The LLM reads
  them through search; it does not edit them.
- **Corpus items**: an uploaded zip whose text files are indexed with the project. The corpus view lists its
  files, which were taken in and why the others were not, and shows a file's text (as plain text, never
  as HTML). Replace zip uploads a new one in its place.
- **Folders**, to organize any of these.

The **Default** project is created at first start and never deleted; ad-hoc items live there. Every item
belongs to exactly one project. Click a folder to make it where new items go. Everything reorders by drag
and drop: drop an item on the top or bottom edge of a row to put it just before or after that row, on the
middle of a folder to move it inside, or on a project's heading to move it to that project's root; drop a
project's heading on another's to reorder the projects. Rename a plan or document with ✎ on its row (only
its title changes); copy it (⧉, or Ctrl+C on the open item) and paste it (a paste button, or
Ctrl+V into the open project) for a whole copy under a new id: a plan's text, threads and revisions, a
folder's whole contents. A project or folder is deleted only when empty. Trash is at the bottom of the
sidebar.

The heading's **Threads** button hides or shows the threads pane, and the editor's **Preview** button its
preview; each is remembered in the browser. The owner deletes a thread with the × on its first line; a
revision that applied a deleted thread keeps its text and shows "(deleted thread)".

## The data folder

`~data/` beside `package.json` by default, or the `--data` folder. Plain files:

	consensus.json                   settings: Port, Participants, States, Corpus, optional Embedding
	usage.json                       the LLM's tokens per day and model
	projects.json                    { Projects: [ { Id, Name } ] }: every project's name, in display order
	projects/<id>/project.json       { Id, Context, Created, Updated, Version, Items: [ node ] }  Context: its context's id
	proposals/<id>/proposal.json     { Id, Title, Kind: plan | document | context, State, Created, Updated, Revision }
	proposals/<id>/proposal.md       the text at revision Revision
	proposals/<id>/threads.json      the threads
	proposals/<id>/revisions/0001.md, 0001.json    every revision's text and record
	proposals/<id>/index.json        search chunks
	corpora/<id>/corpus.json         { Id, Kind: corpus, Name, Created, Updated, Version, Files }
	corpora/<id>/corpus.zip          the upload, as it came; never unpacked to disk
	corpora/<id>/index.json          search chunks
	trash/<id>/                      a deleted proposal or corpus, moved whole

A project's `Items` is its tree: `{ Kind: "folder", Id, Name, Items }` or `{ Kind: "plan" | "document" |
"corpus", Id }`, pointing at the proposal or corpus by id. Every write is whole-file and atomic, and writes
to one proposal, corpus or project never interleave; a tree change that names an older `Version` is refused.

At every start the folder is brought up to date and each change is logged: older proposals get a `State`
(an approved one becomes Plan) and a `Kind`, a thread's old `consensus` status becomes `resolved`, missing
settings are written in with their defaults, a proposal or corpus no project holds goes to the root of
Default, and a tree entry whose item is gone is dropped.

Ids are a kind letter and 8 hex digits: `p…` for a plan or document, `z…` for a corpus, `j…` for a project
(Default is `default`). A data folder from before that carries ids made from titles; convert it once, with
the server stopped:

	node bin/consensus.js migrate-ids [--data <folder>]

It first copies the whole folder to `<folder>-backup-<YYYY-MM-DD-HH-mm-ss>` beside it, then renames every
proposal, corpus and project with the places that name it (trees, search chunks), and moves each project's
name into `projects.json`. It refuses to run while a server answers on the settings' port. Links to the old
ids stop working.

## Settings

`consensus.json` is written at first start and filled in with any setting it lacks:

	{
		"Port": 3500,
		"States": [ "Proposal", "Plan", "Working", "Finished" ],
		"Participants": [
			{ "Name": "user", "Display": "User", "Role": "owner" },
			{ "Name": "llm", "Display": "LLM", "Role": "llm", "Call": { "Kind": "claude-cli", "Command": "claude" } }
		],
		"Corpus": { "MaxZipMegabytes": 50, "MaxFileKilobytes": 512, "Extensions": [ ".md", ".txt", ".js", ... ] },
		"Context": { "MaxCharacters": 12000 }
	}

`States` is the list a plan's state is picked from; a new plan starts in the first. `Corpus` limits
uploads: a zip over `MaxZipMegabytes` is refused, and a file is taken in only when its extension is listed,
it is no larger than `MaxFileKilobytes` and it holds no NUL byte. `Context.MaxCharacters` is the size the LLM
keeps each project's context under. Restart the server after editing.

A request without an `Authorization` header is the participant with the `owner` role: the browser. A
request with `Authorization: Bearer <token>` is the participant holding that token; give a participant a
`Token` to let it use the API from outside. Roles: `owner` resolves threads and sends to the LLM; `llm` is
a full participant that is asked to apply resolved threads; `member` takes part in discussion.

## How the LLM takes part

Consensus calls the LLM itself, only when the owner presses **Send to LLM** in a plan's heading. The
button counts the threads waiting on the LLM, is disabled at 0, and reads **LLM working…** while a call
runs. Replying, resolving and new threads only leave work waiting.

One call per press, for everything waiting on the LLM in that plan. The prompt holds the rules, the plan's
project and **its context**, its text at the current revision, every thread with the waiting ones marked, and for each waiting
thread the best passages the search finds **in the plan's own project**: its plans, threads, documents and
corpus files. The LLM has no tools: it answers with one JSON object,

	{ "Actions": [
		{ "Thread": "t…", "Kind": "reply", "Reply": "markdown" },
		{ "Thread": "t…", "Kind": "apply", "Outcome": "one sentence", "Text": "the whole new markdown", "Anchor": "a few words" },
		{ "Kind": "context", "Text": "the whole new context", "Reason": "one sentence" }
	] }

and Consensus carries each action out as the llm participant, through the same rules as the API. An action
that is refused, or a call that fails, leaves a line on its thread (*LLM call failed …*); the next
successful call clears it, and pressing Send to LLM again is the retry. Each call is a line in the server
log, and its tokens are added to `usage.json`; the sidebar shows today's, with the rest in its tooltip.

**The project's context.** Every project has one, Default included: a short account of what the project is
and what has been decided, pinned above its tree. Every call includes it, and the LLM keeps it coherent across
discussions: when a call changes what it should say, or the project has none yet, the answer carries a
`context` action with its whole new text. That becomes a new revision at once, with the LLM's reason beside
it in Revisions, and is refused when the context changed since the call was given it. People read and edit
it like a document; it has no threads and no state, and is never moved, copied or deleted on its own. On a
context's page, **Initialize context** (owner) asks the LLM to write it from the project: its plans and
documents by title, the files in its zips, and a few key files (readmes, manifests, CLAUDE.md).

The `Call` setting on the llm participant chooses the LLM:

	"Call": { "Kind": "claude-cli", "Command": "claude", "Model": "sonnet" }
	"Call": { "Kind": "ollama", "Url": "http://127.0.0.1:11434", "Model": "glm-5.3:cloud" }

`claude-cli` runs Claude Code headless (`claude -p`) with every tool turned off, on the claude.ai sign-in
of this workstation; `Model` is optional and passed as `--model`. `ollama` posts to Ollama's chat endpoint,
held to the answer's format. Both also take `CallsPerHour` (default 20: past it the button is refused until
the hour has passed) and `TimeoutSeconds` (default 300). Without a `Call`, there is no button.

## The rules, in plain words

- A thread is **Contested** until the owner resolves it. Resolving means agreeing with how the thread was
  deliberated and decided, and accepts the outcome the last reply states.
- A resolved thread is **Resolved**, waiting to be applied, until a participant applies it, so it never
  looks finished before the text shows it. Applying makes it **Applied** and records who, when, the
  revision and the outcome.
- Any reply to a resolved or applied thread **reopens** it: contested again, marked reopened. Reopening
  never reverts a change already applied; resolving it again makes it wait to be applied again.
- **Whose turn**: a contested thread waits on everyone except the one who replied last. A resolved thread
  waits on every `llm` participant. An applied thread waits on nobody.
- A plan's **state** is set by anyone at any time and does not depend on its threads.
- **Editing** is allowed at any time and makes a new revision. A manual edit changes no thread's status.
- **Anchors** hold to the visible text, not the markdown source, so bold and links do not break them.
  After every text change each anchor is re-found; one whose words changed a little follows them; one
  that cannot be found is detached, shown first, and can be re-anchored by selecting text.
- The document keeps no change log of its own: the applied records and the revisions are the record.
- **Optimistic concurrency**: a text change carries the revision it was made from; a stale one is refused
  and the page reloads rather than overwriting.

## The page

The project tree on the left with each plan's state, its tallies and a "waiting on you" count; the
rendered plan or document in the middle, with each anchored passage of a plan highlighted by state
(yellow contested, orange reopened, blue resolved, green applied); a plan's threads on the right,
filterable by state and by whose turn it is. Select text in a plan to comment on it. Edit shows Monaco
beside a live preview; Ctrl+S saves. Revisions shows the record. A document or a corpus gives the threads
pane's room to the text. Light, dark or system theme and three sizes are at the bottom of the sidebar. Two
browser tabs stay in step: every change is a Server-Sent Event.

## Search

Every plan, document, thread and corpus file is indexed after every change, by our own lexical index: each
paragraph (a heading with the short paragraphs under it), each thread, and each block of 40 lines of a
non-markdown file is a chunk, tokenized with a light stemmer and weighed by BM25. The search box searches
the open project; `GET /api/search?q=&project=&limit=` does the same over the API, and without `project`
it searches everything. Measured before it was built: on the proposals it was written for, it ranked the
right passage or thread first on 14 of 14 questions, ahead of three neural embedders.

Ollama vectors are an optional upgrade. Name a model in `consensus.json`:

	"Embedding": { "Url": "http://127.0.0.1:11434", "Model": "nomic-embed-text" }

Chunks are then also embedded through Ollama (only those whose text changed), and the search merges the
cosine ranking with ours by rank. An unreachable Ollama is a logged line; the search still answers.

## Zips

A zip is read in memory by `yauzl` (pure JavaScript, the same on Windows, macOS and Linux): Zip64, data
descriptors, and names in UTF-8, flagged or not, or in the old IBM code page. macOS's `__MACOSX/` and
`.DS_Store` entries are left out. A zip holding a name that climbs out (`..`), starts at a root or names a
drive, or an encrypted entry, is refused whole with the reason.

## The API

	GET    /api/me                                   who this request is, the participants, the States
	GET    /api/projects                             every project with its tree, each item with title, state, tally
	POST   /api/projects                             { Name }
	PUT    /api/projects/:pid                        { Name, Version? }
	DELETE /api/projects/:pid                        an empty project; never Default
	POST   /api/projects/:pid/folders                { Name, Parent?, Version? }
	PUT    /api/projects/:pid/folders/:fid           { Name, Version? }
	DELETE /api/projects/:pid/folders/:fid           an empty folder
	POST   /api/items/:id/move                       { Project, Parent? }  a plan, document, corpus or folder
	POST   /api/items/:id/copy                       { Project, Parent? }  a whole copy under a new id
	GET    /api/proposals[?state=]                   plans and documents with their tallies
	POST   /api/proposals                            { Title, Text, Kind?, State?, Project?, Parent? }
	GET    /api/proposals/:id                        proposal, project, text, threads with positions, tally, whose turn, Llm
	PUT    /api/proposals/:id                        { Title }
	PUT    /api/proposals/:id/state                  { State }  one of the States; not for a document
	PUT    /api/proposals/:id/text                   { Text, Revision }  a manual edit
	DELETE /api/proposals/:id                        to the trash
	GET    /api/proposals/:id/revisions[/:n]         the record; a revision's text
	GET    /api/proposals/:id/threads[?status=]      all | contested | resolved | applied | reopened | detached | mine
	POST   /api/proposals/:id/threads                { Anchor: { Text, Prefix?, Suffix? } | null, Text }  not for a document
	POST   /api/proposals/:id/threads/:tid/replies   { Text }  reopens a resolved thread
	POST   /api/proposals/:id/threads/:tid/anchor    { Anchor }  re-anchor
	POST   /api/proposals/:id/threads/:tid/resolve   owner only
	POST   /api/proposals/:id/threads/:tid/apply     { Outcome, Revision?, Text?, Anchor? }  resolved threads only
	POST   /api/proposals/:id/send                   owner; calls the LLM for what waits on it (202, runs in the background)
	POST   /api/projects/:pid/corpus?name=&parent=   the zip as the body (Content-Type: application/zip)
	GET    /api/corpus/:cid                          the corpus, its files and its project
	GET    /api/corpus/:cid/file?path=               one indexed file's text
	PUT    /api/corpus/:cid                          a new zip as the body, in place of the old one
	PUT    /api/corpus/:cid/name                     { Name }
	DELETE /api/corpus/:cid                          to the trash
	GET    /api/trash                                what is there
	GET    /api/search?q=&project=&limit=            the best chunks: { Proposal | Corpus, Path?, Title, Revision, Chunk, Thread, Text, Score }
	GET    /api/usage                                the LLM's tokens: Today, Total, by model
	GET    /api/waiting                              everything waiting on the caller, in every project
	GET    /api/events                               Server-Sent Events: { Proposal | Project | Corpus, Kind, Thread? }

Errors are `{ "Error": "..." }` with the status: 400 bad body, 401 unknown token, 403 not allowed for this
role, 404 not found, 409 not allowed in this state or a stale revision or version (with the current
`Revision` or `Version`), 413 a zip over the size limit.

## Layout of the code

	bin/consensus.js      the command line
	src/Server.js         Start( { Data, Port, Host } )
	src/Api.js            the routes
	src/Rules.js          the consensus rules, pure functions
	src/Tree.js           a project's tree, pure functions
	src/Anchors.js        visible-text anchors
	src/Llm.js            calling the LLM: the prompt, the answer, claude-cli and ollama
	src/Index.js          our search index; src/Vectors.js the optional Ollama upgrade
	src/Corpus.js         what an uploaded zip gives a project, within the limits; src/Zip.js reads zips
	src/Store.js          the data folder
	src/Participants.js   who is calling, and the States
	src/Events.js         Server-Sent Events
	public/               the page: index.html, css/, js/ (one controller per pane)
	test/                 node --test; Ui.test.js drives a headless browser through test/support/Cdp.js;
	                      test/support/ZipMaker.js builds test zips byte by byte
	.plans/               the build plans and the story of this repository
