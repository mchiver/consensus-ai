# Consensus

Collaborative proposal building. The User and the LLM work a proposal through in discussion, thread by
thread, until every thread is resolved and applied. Proposals live in **projects**, beside the documents of
the project's **Context** folder that give everyone the background of the work.

A standalone application: Node and Express on the server, AngularJS, Bootstrap, marked and Monaco in the
page, plain files in a data folder. The browser is the User. The LLM takes part through the API, from
wherever it runs (plan Consensus Desktop, Step 1): the server itself calls no model, reads no code and
indexes nothing. An agent session in the codebase works it through the API and the turn ("your turn in
Consensus"); the desktop application (Step 2) and local LLMs and workspaces (Step 3) come next.

## Starting it

	npm install
	node bin/consensus.js [--data <folder>] [--port 3500] [--host <address>]

The server listens on the settings' `Host`, `127.0.0.1` by default; `--host` overrides it, and `0.0.0.0`
listens on every interface. It prints its address, the data folder and the settings file. Open
`http://127.0.0.1:3500/` in a browser.

Security is relaxed for now: a request without a token is the owner, so anyone who can reach a server
listening beyond this machine acts as the owner, and reads the llm token at `/instructions`.

An agent session in any repo is started with one line: "read the instructions at
`http://<server>:<port>/instructions`" (with `curl`). That page is `.guides/build-with-consensus.md` with a
**This server** section first: the API's address, as the request reached it, and the llm participant's token.

	npm test

runs every test, including the page in a headless Chrome or Edge (`test/Ui.test.js`, which needs one of
them installed). No test touches the real data folder.

## Projects and what they hold

The sidebar is a tree of projects. One project is open at a time: opening one closes the others, and
opening an item opens its project. A project holds, in folders of any depth:

- **Plans**: what is discussed and commented on. Each has a **state**, one of the settings' `States` (by
  default Proposal, Plan, Working, Finished). Anyone changes it at any time from the picker in the heading;
  nothing locks, and a state does not depend on the threads.
- **Documents**: markdown edited in Monaco with revisions, but with no threads and no state. Documents live
  only in the project's **Context** folder.
- **Folders**, to organize plans.
- **Subplans**: a plan can hold plans, and only plans. A Subplan is a full plan of its own (its own threads,
  state and Subplans); the tie is organizational only. Subplans fold under their parent, and move, copy and
  go to the trash with it. Start one with **New Subplan** in a plan's menu or **New subplan** in its heading (empty),
  **Start a new Subplan** in a thread being written or replied to (it starts with the anchored passage
  quoted and the thread so far; the thread gets a reply linking to it and stays open), or on selected text
  (it starts with that text; the parent is not changed). Dropping a plan on the middle of a plan makes it a
  Subplan.

**The Context folder.** Every project has one, Default included: the first item of its tree, holding the
project's **Context** document (a short account of what the project is and what has been decided, for
everyone who works on it) and any other document. The folder holds documents only, flat, and documents go
nowhere else: **New document** (in the project's menu, or the folder's) puts one there, and a document
dropped elsewhere is refused. Neither the folder nor the Readme is renamed, moved, copied or
deleted; the other documents are items like any other. An agent session reads the folder's documents for the
project's background. The Readme is a document like the others: revisions, no threads, no state.

The **Default** project is created at first start and never deleted; ad-hoc items live there. Every item
belongs to exactly one project. The open project carries a solid green dot, the others a hollow circle. Each
row's actions are in its menu: **⋯** at the row's end (on hover, and on the current row) or a right-click. Click a folder to make it where new items go. Everything reorders by drag
and drop: drop an item on the top or bottom edge of a row to put it just before or after that row, on the
middle of a folder to move it inside, or on a project's heading to move it to that project's root (the
Context folder stays first); drop a project's heading on another's to reorder the projects. Rename an item
from its menu (a plan or document: only its title changes); copy it (its menu, or Ctrl+C on the open item)
and paste it (Paste in a project's or folder's menu, or Ctrl+V into the open project) for a whole copy under
a new id: a plan's text, threads and revisions, a folder's whole contents. Delete is in the menu only,
confirmed on the row: a plan or document goes to the trash; a project or folder is deleted only when empty
(a project: when it holds only its Context folder and document). Trash is at the bottom of the sidebar.

The heading's **Threads** button hides or shows the threads pane, and the editor's **Preview** button its
preview; each is remembered in the browser. The owner deletes a thread with the × on its first line; a
revision that applied a deleted thread keeps its text and shows "(deleted thread)".

Every item you open (plan or document), and Waiting on you, opens in a **tab** above the document: one tab
per item, dragged to reorder, closed with ×. Each tab comes back as you left it, Read, Edit or Revisions, an
unsaved edit included. Open tabs survive a page reload, not a browser restart; with none open, the start
page shows. A tab's menu (▾ beside its ×, or a right-click) has Close, Close others, Close to the right,
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

	consensus.json                   settings: Port, Host, States, Participants
	projects.json                    { Projects: [ { Id, Name } ] }: every project's name, in display order
	projects/<id>/project.json       { Id, Context, ContextFolder, Created, Updated, Version, Items: [ node ] }
	proposals/<id>/proposal.json     { Id, Title, Kind: plan | document, State, Created, Updated, Revision }
	proposals/<id>/proposal.md       the text at revision Revision
	proposals/<id>/threads.json      the threads
	proposals/<id>/revisions/0001.md, 0001.json    every revision's text and record
	trash/<id>/                      a deleted proposal, moved whole

A project's `Items` is its tree: `{ Kind: "folder", Id, Name, Items }`, `{ Kind: "plan", Id, Items? }` (its
Subplans) or `{ Kind: "document", Id }`, pointing at the proposal by id; `Context` is the id of the Context
document and `ContextFolder` of the folder that holds it, first in `Items`. Every write is whole-file and
atomic, and writes to one proposal or project never interleave; a tree change that names an older `Version`
is refused.

A new data folder gets the Default project at its first start, and a new settings file its defaults. A data
folder from before Step 1 is migrated at the first start, once: each project's context proposal becomes its
Readme in a new Context folder, corpora go to the trash, and the LLM's files (`usage.json`,
`runs.json`, `index.json`) are removed; the console says what was done.

Ids are `<kind>-xxx-xxx-xxx` (plan Global Ids): `prj pln doc fld thr rep rev` and three groups of three base36
characters; Default is `default`. A Readme made before Step 1 keeps its `ctx-…` id.

## Settings

`consensus.json` is written at first start:

	{
		"Port": 3500,
		"Host": "127.0.0.1",
		"States": [ "Proposal", "Plan", "Working", "Finished" ],
		"Participants": [
			{ "Name": "user", "Display": "User", "Role": "owner" },
			{ "Name": "llm", "Display": "LLM", "Role": "llm" }
		]
	}

`Host` is the address the server listens on (see Starting it) and `Port` its port. `States` is the list a
plan's state is picked from; a new plan starts in the first. A request without an `Authorization` header is
the participant with the `owner` role: the browser. A request with `Authorization: Bearer <token>` is the
participant holding that token; give a participant a `Token` to let it use the API from outside. Roles:
`owner` resolves threads and edits the settings; `llm` is a full participant that is asked to apply resolved
threads; `member` takes part in discussion.

**Settings** at the bottom of the sidebar (owner) edits the file in a popup: Host and Port, the States one
per line, and the participants with their display names, roles and tokens (New makes a token, Copy copies
it). Saving writes the whole file and applies it at once, Host and Port excepted, which take effect at the
next start (the popup says so). The server's own checks apply: no owner, a name used twice, a state still
used by a plan, and the rest are shown, and nothing is saved while there are problems. The settings are read
once at start, so an edit of the file by hand needs a restart.

Theme and size are not settings: the page keeps them in the browser's storage, per user and per server.

## How the LLM takes part

Every LLM takes part as the `llm` participant, through the API, from wherever it runs: the server calls no
model. An **agent session** in the codebase (Claude Code, say) reads `/instructions`, finds what waits on it
(`GET /api/waiting`), replies, applies resolved threads, drafts plans and reads the Context folder; the owner
starts its turn with "your turn in Consensus". `.guides/build-with-consensus.md` is its guide.

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
beside a live preview; Ctrl+S saves, and Ctrl+E switches between Read and Edit (from the editor too).
Revisions shows the record. A document gives the threads pane's room to the text. Light, dark or system
theme and three sizes are at the bottom of the sidebar, with Settings for the owner. Two browser tabs stay
in step: every change is a Server-Sent Event.

## Export and import

A project goes out as one json object (**Export project** in its menu; `GET /api/projects/:pid/export`):
its Context folder and documents, folders, plans, Subplans, threads and every revision, with no tokens.
**Import** (the sidebar's button; `POST /api/projects/import`) brings one in: a project not here comes in as
it is, every id intact; one that is here is imported as a copy ("Copy of <name> (imported <date>)", every id
new) or merged (revisions matched by id; a conflict gets a merge revision with the newer text; nothing here
is removed). An export from before Step 1 is read too: its corpora and workers are dropped, its context
becomes the Readme, and the Context folder is made.

## The desktop

Consensus Desktop (plan Consensus Desktop, Step 2) is an Electron client for any Consensus server, run from the
checkout:

	npm run desktop

It opens on the **connect screen**: the saved servers (Connect, Edit, Remove), **Add server** (a Name and a Url,
tried before it is saved; the screen says which Consensus version answers and warns when it differs from the
app's), and the **Local server**: a data folder (Browse), Start and Stop, and Connect once it runs. A local
server is Consensus itself, started in the app's process over that folder on `127.0.0.1` and the folder's port,
with `consensus.json` written at a first start as the command line does; closing the window stops it. Once
connected, the window shows the desktop's own copy of the Consensus page, pointed at the server's API; the
**Server** menu has Connect to another, Reload, the local server's Start and Stop, and **New window**, which
starts another instance of the app for a second server. A tab's Detach opens a window of the app. What was
open last is reopened at the next start, or the connect screen says why it could not be.

The desktop's page is its own copy, `desktop/page/` (the server's `public/` is frozen after Step 1 and the copy
is developed on from there; `client.js` prefixes the API's base URL the desktop hands it, and `theme.js` keeps
the theme and the scale in the desktop's settings). The copy is served from the app's own origin on
`127.0.0.1`, and that same origin forwards `/api` (the events stream included) and `/instructions` to the
connected server: the base URL stays the page's own origin, and the server, which sends no CORS headers, is not
changed for the app beyond `/api/me` saying its `Version`. Its settings are `desktop.json` in Electron's
user-data folder (`%APPDATA%/consensus-desktop/` on Windows): `Servers`, `Local` (the data folder and its
port), `Last`, `Theme` and `Scale`.

**LLM connections and workspaces** (Step 3) are the desktop's own, kept in desktop.json (`Llms`, `Workspaces`)
and shown in every project's Context folder, never on the server: an LLM connection once per desktop, in every
project; a workspace, a path to a folder, with the project it is attached to. New LLM connection and New
workspace are in the Context folder's menu (whose count includes them); Open, Rename and Delete in the row's.
Each opens in a tab of its own. The **LLM page** (plan UI Tweaks IV) has a head with **Details…** (a popup:
Name; Kind `claude-cli`, a command run without a shell, or `ollama`; Command and Arguments, one per line, before
`--model`; Model; Timeout; for `ollama` Context, the model's window in tokens, and Rounds, the most tool rounds a run
takes; Check, which tries the form as entered and, for `ollama`, says whether the Model calls tools) and **Packaging…** (a popup: the items that
go into the one-shot prompt, in this order: the server's `/instructions`, the project's Readme, the other
Context documents listed by title and each checkable, the threads of the plan at hand waiting on the llm
participant listed by anchor and each checkable; the unchecked ids are remembered per connection, so a new
document or thread is in by default; then the Review, Build and Session Prompts with Reset; Preview packages
the prompt as the form stands, with its character count and an estimated token count at four characters each,
and Copy), then **Run** (the plan at hand in the page's own picker, in the tree's order with its folders and
indentation and each plan's unresolved threads, defaulting to the plan last opened; a workspace; **Review**,
**Build** and **Session** each package their prompt and run it once, disabled only while a run is going or for
what they lack, with the reason shown beside them; Stop while it runs) and the **log** (one
record per run in the user-data folder's `runs/<id>.json`: when, which button, the project, the plan, the
workspace, the prompt, the output, the exit and the duration, and for a local model the rounds and the tokens;
the page shows the project's runs, newest first; a run opens in a popup, its output and prompt rendered as
markdown or shown as source, each with its size and Copy). A `claude-cli` one-shot runs the command once in the workspace's folder
with the package on its standard input; the model works through the API itself, with the token in the
instructions, and nothing is parsed. The default Arguments let a non-interactive `claude` use its tools. The
desktop never commits, branches or pushes.

An `ollama` one-shot (Step 4: Local Models) runs in the desktop: a local model has no tools of its own, so
`Ollama.js` runs the tool loop over Ollama's chat endpoint, one request per round with the connection's Context
as `num_ctx`, and `Tools.js` carries out each call the model makes and sends the result back, until the model
answers without a call, the Rounds run out (one last request without tools asks for the answer), the Timeout
passes, or Stop aborts the request in flight. The tools: over the workspace, `glob`, `grep` and `read` within
its Include and Exclude, and for Build and Session `write`, `edit` (one occurrence, or refused) and `run`,
which executes one of the workspace's **Commands** (one per line on the workspace page, none by default; a
command exactly or with arguments after it; nothing that chains, pipes, redirects or substitutes, on the list or
in a call); over the connected server, as the llm participant with the Token the server's settings hold,
`list_project`, `read_plan`, `read_document`, `waiting`, `reply`, `apply` (the current revision supplied),
`thread` and `set_state`, each held to the project the connection was opened from, a server's refusal going
back to the model as the tool's result. The package is the same, except that the agent instructions (which say
how to call the API with the token) are replaced by the desktop's tool instructions, so the token never enters
a local model's prompt. The run keeps its `Transcript` as entries (a round's text, a call with its arguments, its
whole result and how long it took, the answer) and its Output as the markdown rendered from them (a heading per
round, each call in bold with its result fenced and clipped at 2,000 characters, the answer under its own
heading), both growing with every call; every window hears each call, so the run popup follows a run as it
goes. The popup shows the transcript as blocks per round, each call a row that unfolds to its whole result,
and the answer rendered; Source shows the markdown. A Review gets the read-only file tools, a Build and a Session
every tool the workspace allows; without a workspace, the Consensus tools only. The **workspace page** holds
Name, Path (Browse), Include and Exclude globs (`**` crosses folders; one without a slash matches at any depth;
an excluded folder is not entered), Commands, and below them the files the workspace includes, walked again on
every change (the first 500, with the count).

The page's **theme** is a palette: System, Light, Sepia, Paper, Solarized Light, Dark, Slate, Solarized Dark,
Nord or Midnight (`data-theme` on the page; `data-bs-theme` light or dark for Bootstrap), and the editor takes
its colours; the desktop's title bar and menu bar follow it light or dark. The editor and the read view scroll
past the end of the text. In the tree a click on a folder folds it, and a folder's menu has New plan and New
folder, which create in it.

Layout: `desktop/main.js` the main process, `desktop/preload.js` its bridge, `desktop/Settings.js` desktop.json,
`desktop/Local.js` the local server, `desktop/Page.js` the server for the page copy, `desktop/Package.js` the
one-shot prompt, `desktop/Llm.js` a connection's check and command line, `desktop/Runs.js` the runs and their
records, `desktop/page/` the copy (`js/desktop.js` the items, the LLM page and the workspace page) and the
connect screen (`connect.html`, `connect.js`, `connect.css`); `test/Desktop.test.js` covers the settings, the
page server, the local server with the real `Start`, the package, the check and the runs.

## The API

	GET    /api/me                                   who this request is, the participants, the States
	GET    /api/settings                             owner; the settings as they are, and the file's path
	PUT    /api/settings                             owner; { Settings }  the whole file, checked; Restart says when Host or Port changed
	GET    /api/projects                             every project with its tree, each item with title, state, tally; Context and ContextFolder
	POST   /api/projects                             { Name }
	PUT    /api/projects/:pid                        { Name, Version? }
	DELETE /api/projects/:pid                        an empty project (only its Context folder and document); never Default
	POST   /api/projects/:pid/folders                { Name, Parent?, Version? }  not inside the Context folder
	PUT    /api/projects/:pid/folders/:fid           { Name, Version? }  not the Context folder
	DELETE /api/projects/:pid/folders/:fid           an empty folder; not the Context folder
	POST   /api/projects/:pid/move                   { Before }  the project in the display order
	GET    /api/projects/:pid/export                 owner or llm; the project as one json object
	POST   /api/projects/import                      owner or llm; { Export, Mode?, Preview? }
	POST   /api/items/:id/move                       { Project, Parent?, Before? }  a plan, document or folder; a document only into a Context folder
	POST   /api/items/:id/copy                       { Project, Parent? }  a whole copy under a new id
	GET    /api/proposals[?state=]                   plans and documents with their tallies
	POST   /api/proposals                            { Title, Text, Kind?, State?, Project?, Parent? }  a document with no Parent goes in the Context folder
	GET    /api/proposals/:id                        proposal, project, text, threads with positions, tally, whose turn; Context: true for a Readme
	PUT    /api/proposals/:id                        { Title }  not the Readme
	PUT    /api/proposals/:id/state                  { State }  one of the States; not for a document
	PUT    /api/proposals/:id/text                   { Text, Revision }  a manual edit
	DELETE /api/proposals/:id                        to the trash; not the Readme
	GET    /api/proposals/:id/revisions[/:n]         the record; a revision's text
	GET    /api/proposals/:id/threads[?status=]      all | contested | resolved | applied | reopened | detached | mine
	POST   /api/proposals/:id/threads                { Anchor: { Text, Prefix?, Suffix? } | null, Text, Resolve? }  not for a document
	POST   /api/proposals/:id/threads/:tid/replies   { Text, Resolve? }  reopens a resolved thread
	POST   /api/proposals/:id/threads/:tid/anchor    { Anchor }  re-anchor
	POST   /api/proposals/:id/threads/:tid/resolve   owner only
	DELETE /api/proposals/:id/threads/:tid           owner only
	POST   /api/proposals/:id/threads/:tid/apply     { Outcome, Revision?, Text?, Anchor? }  resolved threads only
	GET    /api/trash                                what is there
	GET    /api/waiting                              everything waiting on the caller, in every project
	GET    /api/events                               Server-Sent Events: { Proposal | Project, Kind, Thread? } and { Settings: true, Kind: "settings" }

Errors are `{ "Error": "..." }` with the status: 400 bad body (`Problems` lists them for the settings), 401
unknown token, 403 not allowed for this role, 404 not found, 409 not allowed in this state or a stale
revision or version (with the current `Revision` or `Version`).

## Layout of the code

	bin/consensus.js      the command line
	src/Server.js         Start( { Data, Port, Host } )
	src/Api.js            the routes
	src/Instructions.js   GET /instructions: the agent guide with This server first
	src/Rules.js          the consensus rules, pure functions
	src/Tree.js           a project's tree, pure functions; the Context folder's rules
	src/Anchors.js        visible-text anchors
	src/Store.js          the data folder, and the migration from before Step 1
	src/ProjectPort.js    export and import
	src/Participants.js   who is calling, the States, and the settings' checks
	src/Ids.js            global ids
	src/Events.js         Server-Sent Events
	public/               the page: index.html, css/, js/ (one controller per pane; settings.js the settings popup)
	test/                 node --test; Ui.test.js drives a headless browser through test/support/Cdp.js
	.plans/               the build plans and the story of this repository
	.guides/              build-with-consensus.md, the agent session's guide
	Dockerfile, compose.yaml    the image (plan Docker Image): the server on port 3500, its data in /data
