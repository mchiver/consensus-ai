# Consensus

Collaborative proposal building. The User and the LLM work a proposal through in discussion, thread by
thread, until every thread is resolved and applied. Proposals live in **projects**, beside the reference
documents and uploaded code that give the LLM the context of the work.

A standalone application: Node and Express on the server, AngularJS, Bootstrap, marked and Monaco in the
page, plain files in a data folder. The browser is the User; Consensus calls the LLM when the User presses
Review, or hands a review or a build to a **worker** that runs beside the code (see Workers).

## Starting it

	npm install
	node bin/consensus.js [--data <folder>] [--port 3500] [--host <address>]

The server listens on the settings' `Host`, `127.0.0.1` by default; `--host` overrides it, and `0.0.0.0`
listens on every interface. It prints its address, the data folder and the settings file. Open
`http://127.0.0.1:3500/` in a browser.

Security is relaxed for now: a request without a token is the owner, so anyone who can reach a server
listening beyond this machine acts as the owner, and reads the llm token at `/instructions`. The server
prints a warning when it does.

An agent session in any repo is started with one line: "read the instructions at
`http://<server>:<port>/instructions`" (with `curl`). That page is `.guides/build-with-consensus.md` with a
**This server** section first: the API's address, as the request reached it, and the llm participant's token.

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
- **Corpora**: zips uploaded to Consensus and kept in the project's folder (Replace zip uploads a new one in
  its place), listed, read, searched and offered to the LLM. Each has its own **Include** and **Exclude**,
  edited in the corpus view (one pattern per line, as in `.gitignore`; an empty Include means every file, and
  Exclude wins), which narrow what reaches the project; the zip's own `.gitignore` files apply too, each to
  its folder and below. (Linked corpora, read through a context server, were retired with the plan Workers: a
  project's code is now its **workspace** on a worker. One left in the data shows as an empty corpus.) Any file let in is read unless it is larger than
  `MaxFileKilobytes` or binary (it holds a NUL byte): there is no list of file types. The view lists every file,
  which were read and why the others were not, and shows a file's text (as plain text, never as HTML).
- **Folders**, to organize any of these.
- **Subplans**: a plan can hold plans, and only plans. A Subplan is a full plan of its own (its own threads,
  state and Subplans); the tie is organizational only. Subplans fold under their parent, and move, copy and
  go to the trash with it. Start one with **New Subplan** in a plan's menu or **New subplan** in its heading (empty),
  **Start a new Subplan** in a thread being written or replied to (it starts with the anchored passage
  quoted and the thread so far; the thread gets a reply linking to it and stays open), or on selected text
  (it starts with that text; the parent is not changed). Dropping a plan on the middle of a plan makes it a
  Subplan.

A project may name a **workspace**: a folder a worker offers (**Workspace** in the project's menu), shown under
the project's name in the tree. A worker's review reads the code there, and a build works there.

The **Default** project is created at first start and never deleted; ad-hoc items live there. Every item
belongs to exactly one project. The open project carries a solid green dot, the others a hollow circle. Each
row's actions are in its menu: **⋯** at the row's end (on hover, and on the current row) or a right-click. Click a folder to make it where new items go. Everything reorders by drag
and drop: drop an item on the top or bottom edge of a row to put it just before or after that row, on the
middle of a folder to move it inside, or on a project's heading to move it to that project's root; drop a
project's heading on another's to reorder the projects. Rename an item from its menu (a plan or
document: only its title changes); copy it (its menu, or Ctrl+C on the open item) and paste it (Paste in a
project's or folder's menu, or Ctrl+V into the open project) for a whole copy under a new id: a plan's text,
threads and revisions, a folder's whole contents. Delete is in the menu only, confirmed on the row: a plan,
document or corpus goes to the trash; a project or folder is deleted only when empty. Trash is at the bottom of the
sidebar.

The heading's **Threads** button hides or shows the threads pane, and the editor's **Preview** button its
preview; each is remembered in the browser. The owner deletes a thread with the × on its first line; a
revision that applied a deleted thread keeps its text and shows "(deleted thread)".

Every item you open (plan, document, context, zip), and Waiting on you and Search, opens in a **tab** above the
document: one tab per item, dragged to reorder, closed with ×. Each tab comes back as you left it, Read, Edit or
Revisions, an unsaved edit included. Open tabs survive a page reload, not a browser restart; with none open, the
start page shows. A tab's menu (▾ beside its ×, or a right-click) has Close, Close others, Close to the right,
Close all, and **Detach**, which opens it in its own browser window (allow pop-ups for the page): the item alone,
without the sidebar. Its tab stays in the strip, ghosted: clicking it does nothing, and its menu has
**Re-attach** (the window comes back as the tab) and Close (the window closes). **Re-attach** in the window does
the same. Opening an item that is out brings its window forward; closing that window closes the item; and if
the main window is gone, Re-attach makes the detached window the main one.

The owner settles a contested thread in one of two ways. **Reply and resolve** posts the owner's reply and
resolves the thread with it: that reply is the outcome the LLM applies. **Resolve** with no reply accepts the
outcome, or the recommendation, in the last reply.

## The data folder

`~data/` beside `package.json` by default, or the `--data` folder. Plain files:

	consensus.json                   settings: Port, Participants, States, Corpus, optional Embedding
	usage.json                       the LLM's tokens per day and model
	projects.json                    { Projects: [ { Id, Name } ] }: every project's name, in display order
	projects/<id>/project.json       { Id, Context, Created, Updated, Version, Items: [ node ], Workspace?: { Worker, Name } }
	proposals/<id>/proposal.json     { Id, Title, Kind: plan | document | context, State, Created, Updated, Revision }
	proposals/<id>/proposal.md       the text at revision Revision
	proposals/<id>/threads.json      the threads
	proposals/<id>/revisions/0001.md, 0001.json    every revision's text and record
	proposals/<id>/index.json        search chunks
	projects/<project>/corpora/<id>/corpus.json    { Id, Kind: corpus, Name, Created, Updated, Version,
	                                 Source: attached, Include, Exclude, Files }
	projects/<project>/corpora/<id>/corpus.zip     an attached zip, as it came; never unpacked to disk
	projects/<project>/corpora/<id>/index.json     an attached zip's search chunks
	trash/<id>/                      a deleted proposal or corpus, moved whole

A project's `Items` is its tree: `{ Kind: "folder", Id, Name, Items }`, `{ Kind: "plan", Id, Items? }` (its
Subplans) or `{ Kind: "document" | "corpus", Id }`, pointing at the proposal or corpus by id. Every write is whole-file and atomic, and writes
to one proposal, corpus or project never interleave; a tree change that names an older `Version` is refused.

A new data folder gets the Default project at its first start, and a new settings file its defaults.

Ids are `<kind>-xxx-xxx-xxx` (plan Global Ids): `prj pln doc ctx fld cor thr rep rev run job` and three groups of
three base36 characters; Default is `default`.

## Settings

`consensus.json` is written at first start and filled in with any setting it lacks:

	{
		"Port": 3500,
		"Host": "127.0.0.1",
		"States": [ "Proposal", "Plan", "Working", "Finished" ],
		"Participants": [
			{ "Name": "user", "Display": "User", "Role": "owner" },
			{ "Name": "llm", "Display": "LLM", "Role": "llm", "Call": { "Kind": "claude-cli", "Command": "claude" } }
		],
		"Corpus": { "MaxZipMegabytes": 50, "MaxFileKilobytes": 512 },
		"Context": { "MaxCharacters": 12000 },
		"Workers": [ { "Name": "Workstation", "Token": "…" } ]
	}

`Host` is the address the server listens on (see Starting it). `States` is the list a plan's state is picked from; a new plan starts in the first. `Corpus` limits
uploads: a zip over `MaxZipMegabytes` is refused, and a file the corpus lets in is read only when it is no larger
than `MaxFileKilobytes` and holds no NUL byte. An `Extensions` list left there from before is ignored, with a
note at start. `Context.MaxCharacters` is the size the LLM
keeps each project's context under. `Workers` are the workers Consensus accepts, each with its own token (see
Workers). Restart the server after editing.

A request without an `Authorization` header is the participant with the `owner` role: the browser. A
request with `Authorization: Bearer <token>` is the participant holding that token; give a participant a
`Token` to let it use the API from outside. Roles: `owner` resolves threads and sends to the LLM; `llm` is
a full participant that is asked to apply resolved threads; `member` takes part in discussion.

## How the LLM takes part

Every LLM takes part as the one `llm` participant. A **review** answers and applies a plan's threads, may open
threads and plans of its own, and keeps the project's context; Consensus calls it, or hands it to a worker. A
**build** implements a plan in its project's workspace, on a worker (see Workers). An **agent session** in the
codebase (Claude Code, say) works through the API; `.guides/build-with-consensus.md` is its guide (served at
`/instructions`).

Consensus calls the LLM only when the owner asks. **Review** in a plan's heading counts the threads waiting
on the LLM and opens the plan's **review panel**, within the plan's content area: each plan, in its own tab,
has its own, and reviews in different tabs run at the same time. Closing the panel or switching tabs does not
stop a review. **Review** on a selected thread opens the same panel for that thread alone: only it is sent, and
the LLM may act on it even when it waits on the owner; **Review the whole plan** in the panel lets it go. A
review of the whole plan runs even with nothing waiting, since it may open threads. In the panel:

- **Prompt:** the project's context on or off, a Subplan's **Parent plans** on or off (every plan above it,
  the top one first, as its text without threads), search on or off, and which threads: only the waiting ones,
  the open ones (the default: finished threads are left out), or all. The prompt's size shows as tokens
  (characters ÷ 4) and characters, with each part's share; **Preview** shows the prompt itself.
- **Send to:** a destination from the settings (Claude CLI, Ollama with its model picked from what Ollama
  lists), a worker's ("Workstation / Claude CLI": the review runs beside the code, with tools), or **Manual
  copy / paste**: Copy prompt, give it to any LLM anywhere, paste its answer, Carry out.
- **Run log:** each session's steps with their time, duration and size (sent, answered, carried out), kept
  with the plan in `runs.json` (the last 20 sessions).

A session holds the rules, the plan's project and **its context**, the plan's text at the current revision,
its threads (the waiting ones marked), and for each waiting thread the best passages the search finds **in the
plan's own project**: its plans, threads, documents and corpus files. It never holds other plans in full.
It answers with one JSON object,

	{ "Actions": [
		{ "Thread": "thr-…", "Kind": "reply", "Reply": "markdown" },
		{ "Thread": "thr-…", "Kind": "apply", "Outcome": "one sentence", "Text": "the whole new markdown", "Anchor": "a few words" },
		{ "Kind": "context", "Text": "the whole new context", "Reason": "one sentence" },
		{ "Kind": "thread", "Text": "a new comment", "Anchor": "a few words, or none for the whole plan" },
		{ "Kind": "plan", "Title": "…", "Text": "markdown", "Parent": "a folder's name, or a plan's title or id" }
	] }

A `thread` action opens a contested thread by the llm on the reviewed plan; a `plan` action a new plan in its
project, in the first state (a plan as Parent makes it a Subplan; none puts it in the reviewed plan's folder). A
worker's review has read-only tools (see Workers). A review Consensus calls itself has none, but an answer may
instead **ask for more**, with `"Requests"` beside its actions: `list_project`, `read_plan`,
`read_revision`, `list_files` (a corpus's files, or one folder's), `read_file` (a file in a corpus; `Corpus`
names it, and the older `Zip` still works) or `search`, all read-only and within the plan's
project. Consensus answers them in the next prompt of the same session ("What you asked for"), and the LLM
answers again, up to 5 answers; an answer that asks is not carried out, and the last one must act. Each request
and its answer is a step of the run log. With Manual copy / paste, **Carry out** on an answer that asks shows
**Continue**, which copies the next prompt.

The final answer's actions are carried out as the llm participant, through the same rules as the API. An action
that is refused, or a call that fails, leaves a line on its thread (*LLM call failed …*); the next
successful call clears it, and pressing Review again is the retry. Each call is a line in the server
log, and its tokens are added to `usage.json`; the sidebar shows today's, with the rest in its tooltip.

**The project's context.** Every project has one, Default included: a short account of what the project is
and what has been decided, pinned above its tree. Every call includes it, and the LLM keeps it coherent across
discussions: when a call changes what it should say, or the project has none yet, the answer carries a
`context` action with its whole new text. That becomes a new revision at once, with the LLM's reason beside
it in Revisions, and is refused when the context changed since the call was given it. People read and edit
it like a document; it has no threads and no state, and is never moved, copied or deleted on its own. On a
context's page, **Initialize context** (owner) asks the LLM to write it from the project: its plans and
documents by title, the files in its zips, and a few key files (readmes, manifests, CLAUDE.md).

The llm participant's `Destinations` list names where a session can go (an older single `Call` is read as a
list of one):

	"Destinations": [
		{ "Name": "Claude CLI", "Kind": "claude-cli", "Command": "claude", "Model": "sonnet" },
		{ "Name": "Ollama", "Kind": "ollama", "Url": "http://127.0.0.1:11434" }
	]

`claude-cli` runs Claude Code headless (`claude -p`) with every tool turned off, on the claude.ai sign-in
of this workstation; `Model` is optional and passed as `--model`. `ollama` posts to Ollama's chat endpoint,
held to the answer's format; its `Model` may be left out and picked in the panel. Both also take `CallsPerHour` (default 20: past it the button is refused until
the hour has passed) and `TimeoutSeconds` (default 300). The `/send` route goes to the first destination with
the default choices. Manual copy / paste needs no setting.

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
beside a live preview; Ctrl+S saves, and Ctrl+E switches between Read and Edit (from the editor too). Revisions shows the record. A document or a corpus gives the threads
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

## Workers

A worker (plan Workers) runs beside the code, on the machine that holds it, and takes jobs from Consensus: a
**review** (plan Review) or a **build** (plan Build). It connects out to Consensus, which never connects to it.
Start one with its own settings file:

	node bin/worker.js [--settings worker.json] [--port 3700]

A missing settings file is written with a new token and no items. It holds:

	{
	  "Name": "Workstation",
	  "Consensus": { "Url": "http://cube4:3500", "Token": "…" },
	  "Web": { "Host": "127.0.0.1", "Port": 3700 },
	  "Items": [
	    { "Kind": "Workspace", "Name": "Code", "Root": "W:/code/app", "Include": [], "Exclude": [ "~data/**" ],
	      "Build": { "Remote": "origin", "Commands": [ "npm test" ] } },
	    { "Kind": "Inference", "Name": "Claude CLI", "Type": "claude-cli", "Command": "claude", "Model": "sonnet" },
	    { "Kind": "Inference", "Name": "Ollama", "Type": "ollama", "Url": "http://127.0.0.1:11434", "Model": "glm-5.3:cloud" }
	  ],
	  "MaxRounds": 20,
	  "TimeoutSeconds": 600
	}

Consensus accepts it by its name and token in `consensus.json`: `"Workers": [ { "Name": "Workstation", "Token":
"…" } ]`. The worker says what it offers (hello), then asks for jobs with a request Consensus holds open 30
seconds; one not heard from in 60 seconds is offline, and its running job fails with the reason on its threads.
Each Inference item is a destination, "Workstation / Claude CLI". It runs one job at a time.

- A **workspace** is a folder read as it is now: the files under `Root` that `Include`, `Exclude` and every
  `.gitignore` let in. Nothing is indexed. A project names one (Workspace, in its menu).
- **A review** runs the model in the workspace with read-only tools, until it answers or reaches `MaxRounds` or
  `TimeoutSeconds`: glob, grep and read (the workspace's files), and the plan tools list_project, read_plan,
  read_revision and search (answered by Consensus). With `claude-cli` it is `claude -p` in `Root`, restricted
  to Read, Grep and Glob there (`Exclude` denied too), the plan tools through a small MCP server (`bin/worker.js
  --mcp`). With `ollama` the worker runs the tool loop itself, then asks once more with the answer's schema.
- **A build** (claude-cli only) runs `claude -p` in `Root` with Edit and Write too, and Bash for the
  workspace's `Build.Commands` only, held to them by a hook (`bin/worker.js --bash-guard`): nothing chained,
  nothing else. It answers `{ BuildLog, Context, Threads }`. The worker does nothing with git on its own: a build
  changes the files as they are, on whatever is checked out.

**Build** in a plan's heading (owner) is enabled when the project's workspace has `Build` settings on an
online worker, every thread is applied (the build's own aside), and nothing runs for the plan; its hint says
why not. It sets the plan to Working and queues the job. The answer comes back as the **build log**, a contested
whole-document thread (the job's receipt: worker, workspace, model, what was built and how it was checked), with
the threads the build opened. **Resolving** the build log accepts the build: it is applied (outcome only), the
context the build wrote is written, and the plan is Finished. **Replying** sends it back: **Build again** runs
with the reply, and the new log is a reply on the same thread.

The worker's page (`Web.Host:Port`, 127.0.0.1:3700 by default, no token) shows its connection, workspaces and
models, the running job with each tool call as it happens, and the last 50 jobs (kept in `~worker/jobs.json`),
each opening to its calls and its answer. It has **Pause**, **Resume**, **Cancel** and **Reload** (the settings
again), and on an accepted build **Commit** (one commit of the workspace's changes on the checked-out branch,
titled after the plan, the build log below) and **Push** (that branch to `Build.Remote`): the only git the
worker runs, pressed by the owner, one at a time.

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
	GET    /api/proposals/:id                        proposal, project, text, threads with positions, tally, whose turn, Llm, Build
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
	POST   /api/proposals/:id/session                owner; { Destination, Model?, Options: { Context, Parents, Threads, Search, Thread? } }
	POST   /api/proposals/:id/send                   owner; the first destination with the default choices (202, in the background)
	POST   /api/proposals/:id/build                  owner; { Destination?, Model? }  a build on the workspace's worker (202)
	PUT    /api/projects/:pid/workspace              owner; { Worker, Name } one a worker offers, or { Worker: null }
	GET    /api/workers                              the workers, as last heard: online, workspaces, inference (never a token)
	POST   /api/workers/hello                        a worker's token; { Workspaces, Inference }  what it offers
	GET    /api/workers/jobs[?busy=1]                a worker's token; held open: { Job } | { Change } | { Hello } | {}
	POST   /api/workers/jobs/:jid/tool               a worker's token; { Tool, ... }  a plan tool, for the job's project
	POST   /api/workers/jobs/:jid/step               a worker's token; { Text }  a line of the job's run log
	POST   /api/workers/jobs/:jid/answer             a worker's token; { Answer, Usage } | { Error }
	POST   /api/projects/:pid/corpus?name=&parent=   the zip as the body (Content-Type: application/zip)
	GET    /api/corpus/:cid                          the corpus, its files and its project
	GET    /api/corpus/:cid/file?path=               one indexed file's text
	PUT    /api/corpus/:cid                          a new zip as the body, in place of the old one
	PUT    /api/corpus/:cid/name                     { Name }
	PUT    /api/corpus/:cid/filter                   { Include, Exclude }  lists, or one pattern per line
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
	bin/worker.js         a worker, src/Worker.js (its page: public/worker/); src/Workspace.js its file tools;
	                      src/Mcp.js the plan tools for claude; src/Workers.js is Consensus's side
	src/Server.js         Start( { Data, Port, Host } )
	src/Api.js            the routes
	src/Instructions.js   GET /instructions: the agent guide with This server first
	src/Rules.js          the consensus rules, pure functions
	src/Tree.js           a project's tree, pure functions
	src/Anchors.js        visible-text anchors
	src/Llm.js            calling the LLM: the prompt, the answer, claude-cli and ollama
	src/Index.js          our search index; src/Vectors.js the optional Ollama upgrade
	src/Corpus.js         what an attached zip gives a project, within the limits; src/Zip.js reads zips;
	                      src/Filter.js which files a corpus lets in (Include, Exclude, .gitignore)
	src/Store.js          the data folder
	src/Participants.js   who is calling, and the States
	src/Events.js         Server-Sent Events
	public/               the page: index.html, css/, js/ (one controller per pane); worker/ the worker's page
	test/                 node --test; Ui.test.js and WorkerUi.test.js drive a headless browser through test/support/Cdp.js;
	                      test/support/ZipMaker.js builds test zips byte by byte
	.plans/               the build plans and the story of this repository
