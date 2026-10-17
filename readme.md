# Consensus

Collaborative plan building. The User and the LLM work a plan through in discussion, thread by
thread, until every thread is resolved and applied. Plans live in **projects**, beside the documents of
the project's **Context** folder that give everyone the background of the work.

A standalone application: Node and Express on the server, AngularJS, Bootstrap, marked, CodeMirror and Monaco in the
page, plain files in a config folder and a `.consensus` per project folder. The browser is the User. The LLM
takes part through the API, from wherever it runs: an agent session in the codebase works it through the API
and the turn ("your turn in Consensus"), and the server runs LLM connections of its own for you (plan Run
Shapes, Step 3), each a participant, in a project's folder on its machine; the server reads no code on its
own and indexes nothing: a run does, as a tool of the model. The desktop application is the same page in a
window, with a server of its own inside and every saved server beside it, each a root of the tree (plan Run
Shapes, Step 5).

## Starting it

	npm install
	node bin/consensus.js [<path> | --project <folder>] [--config <folder>] [--port 3500] [--scope none|local|public] [--headless]

One program, two entry points over one start module (`src/Start.js`, plan Run Shapes, Step 1): this one, headless,
for a plain node install and the Docker image, and the desktop (below), which opens a window as well. Both read
the global config, `consensus.json` in the config folder: `.consensus` in the user's folder by default, or the
`--config` folder (`--data` is its older name, kept for one release); the projects live there too until Step 2.
The server listens as the settings' `Scope` says: `Local` on 127.0.0.1, `Public` on 0.0.0.0, `None` not at all;
`--scope` overrides it for one start, and `--port` the port (the configured port in use gives way to a free one,
plan Run Shapes, Step 4; a port given on the command line does not). A path, or `--project <folder>`, serves
that project alone, the way an editor opens a folder (Step 4): its `.consensus` is made when missing, named
after the folder, the folder goes first in the settings' `Projects`, and Scope None is taken as Local for it.
It prints its address and scope, the config folder, the settings file and the projects loaded, and says that it
opens no window: this form never does. Open `http://127.0.0.1:3500/` in a browser, or run the desktop (below).

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
  default Draft, Plan, Working, Finished). Anyone changes it at any time from the picker in the heading;
  nothing locks, and a state does not depend on the threads.
- **Documents**: markdown edited in the same editor as plans, with revisions, but with no threads and no state. Documents live
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
belongs to exactly one project. A server's row carries a server icon and its live dot, a project's a folder
with a tab, filled when the project is open (plan UI Tweaks VI). Each
row's actions are in its menu: **⋯** at the row's end (on hover, and on the current row) or a right-click. New
Project, Import and the owner's Settings are in a server row's menu; the title bar's **Menu** has About (the
version, the links, and a summary of every project's threads), Hotkeys and, in the desktop, the window's commands
(Servers…, New window, Open folder in new window, Reload, Quit). Click a folder to make it where new items go. Everything reorders by drag
and drop: drop an item on the top or bottom edge of a row to put it just before or after that row, on the
middle of a folder to move it inside, or on a project's heading to move it to that project's root (the
Context folder stays first); drop a project's heading on another's to reorder the projects. Rename an item
from its menu (a plan or document: only its title changes); copy it (its menu, or Ctrl+C on the open item),
which puts its export json on the system clipboard, and paste it (Paste in a project's or folder's menu, or
Ctrl+V into the open project), which imports what the clipboard holds there, every id new: a plan's text,
threads, revisions and Subplans, a folder's whole contents, a project as a folder named after it (plan UI
Tweaks V; Export in the menu shows the same json for any item). Delete is in the menu only,
confirmed on the row: a plan or document goes to the trash; a project or folder is deleted only when empty
(a project: when it holds only its Context folder and document). Trash is at the bottom of each server's rows.

The button at the right end of the tab strip hides or shows the threads pane (its mirror at the left end the
tree; Ctrl+Shift+T and Ctrl+Shift+E too); each is remembered in the browser. A selected thread
stays listed whatever the filter; Escape deselects it (in Monaco mode's Read view a click off any highlight does too), and after
the owner's own reply or resolve the selection passes to the next thread in the pane (plan UI Tweaks VI).
Selecting text offers Copy (the text as it reads), Comment and Start
a new Subplan, in the editor as in Monaco mode's Read view. The owner deletes a thread with the × on its first line; a
revision that applied a deleted thread keeps its text and shows "(deleted thread)".

Every item you open (plan or document), and Waiting on you, opens in a **tab** above the document: one tab
per item, dragged to reorder, closed with ×. Each tab comes back as you left it, Read, Edit or Revisions, an
unsaved edit included. Open tabs survive a page reload, not a browser restart; with none open, the start
page shows. A tab's menu (▾ beside its ×, or a right-click) has Close, Close others, Close to the right,
Close all, and **Detach**, which opens it in its own browser window (allow pop-ups for the page): the item alone,
without the sidebar. Its tab stays in the strip, ghosted: clicking it does nothing, and its menu has
**Re-attach** (the window comes back as the tab) and Close (the window closes). **Re-attach** in the window does
the same, and **Hide threads** / **Show threads** beside it hides or shows the window's threads pane, a choice
the window keeps to itself. Opening an item that is out brings its window forward; closing that window closes the item; and if
the main window is gone, Re-attach makes the detached window the main one.

The owner settles a contested thread in one of two ways. **Reply and resolve** posts the owner's reply and
resolves the thread with it: that reply is the outcome the LLM applies. **Resolve** with no reply accepts the
outcome, or the recommendation, in the last reply. On a resolved or applied thread the Reply button reads
**Reply and Contest**: the reply reopens the thread, which stays open and contested.

## The config folder and the project folders

`.consensus` in the user's folder by default, or the `--config` folder, holds the settings; each project is a
folder of its own with a `.consensus` sub-folder that is the project (plan Run Shapes, Step 2), under
`<config>/projects/<name>/` when none was named. Plain files:

	<config>/consensus.json                        settings: Name, Port, Scope, States, Participants, the desktop's fields, and
	                                               Projects: [ { Path } ], the project folders in display order
	<project>/.consensus/project.json              { Id, Name, Context, ContextFolder, Created, Updated, Version, Items: [ node ],
	                                               Archive: [ node ], States, Include, Exclude, Commands }
	<project>/.consensus/content/<id>/content.json { Id, Title, Kind: plan | document, State, Created, Updated, Revision, Head }
	<project>/.consensus/content/<id>/content.md   the text at revision Revision
	<project>/.consensus/content/<id>/threads.json the threads
	<project>/.consensus/content/<id>/revisions/0001.md, 0001.json    every revision's text and record
	<project>/.consensus/archive/<id>/             an archived plan, moved whole; read, never written, until restored
	<project>/.consensus/trash/<id>/               a deleted item, moved whole

A project's `Items` is its tree: `{ Kind: "folder", Id, Name, Items }`, `{ Kind: "plan", Id, Items? }` (its
Subplans) or `{ Kind: "document", Id }`, pointing at the plan by id; `Context` is the id of the Context
document and `ContextFolder` of the folder that holds it, first in `Items`; `Archive` holds the archived plans,
whole, out of the tree; `States` is the project's own list (the settings' is the default for a new project), and
`Include`, `Exclude` and `Commands` travel with the folder. Every write is whole-file and atomic, and writes to
one plan or project never interleave; a tree change that names an older `Version` is refused. The store
(`src/Store.js`) keeps an index of which project folder holds each item, built at start from the folders the
settings list; a copy or a move between projects moves the item's folder; the `.consensus` is meant for source
control, and holds nothing secret.

A config folder with no project gets Default at its first start, and a new settings file its defaults. A settings
file from before Run Shapes, with a `Host`, is brought up to date at the next start (a local address becomes Scope
Local, any other Public; a missing Name becomes the machine's; the retired Corpus, Context and Workers keys are
dropped). A config folder from before Step 2 (projects.json, projects/<id>/, proposals/<id>/ and trash/ in it) is
migrated at the next start, once: each project moves into `<config>/projects/<name>/.consensus/` in the layout
above, Default under a new prj- id (the desktop's workspaces follow it), items in no tree and the old trash into
the first project's trash; a data folder from before Step 1 is migrated on the way (each project's context
plan becomes its Readme in a new Context folder, corpora go to the trash, and the LLM's files are removed).
A listed folder that is missing is skipped with a line and kept in the list (`Missing`); a folder under
`projects/` that the list lacks joins it. The console says what was done.

Ids are `<kind>-xxx-xxx-xxx` (plan Global Ids): `prj pln doc fld thr rep rev` and three groups of three base36
characters; every project has a prj- id since Step 2 (Default was `default` before). A Readme made before Step 1
keeps its `ctx-…` id.

## Settings

`consensus.json` is written at first start:

	{
		"Name": "cube4",
		"Port": 3500,
		"Scope": "Local",
		"States": [ "Draft", "Plan", "Working", "Finished" ],
		"Participants": [
			{ "Name": "user", "Display": "User", "Role": "owner" },
			{ "Name": "llm", "Display": "LLM", "Role": "llm" }
		]
	}

`Name` is the server's, shown to clients in `/api/me`; `Scope` says whether and for whom it listens (see Starting
it) and `Port` its port. `States` is the list a
plan's state is picked from; a new plan starts in the first. A request without an `Authorization` header is
the participant with the `owner` role: the browser. A request with `Authorization: Bearer <token>` is the
participant holding that token; give a participant a `Token` to let it use the API from outside. Roles:
`owner` resolves threads and edits the settings; `llm` is a full participant that is asked to apply resolved
threads; `member` takes part in discussion.

**Settings** in a server row's menu (owner) edits the file in a popup: Name, Scope and Port, the States
one per line, and the participants with their display names, roles and tokens (New makes a token, Copy copies
it). Saving writes these fields, the desktop's untouched, and applies them at once, Scope and Port excepted,
which take effect at the next start (the popup says so). The server's own checks apply: no owner, a name used twice, a state still
used by a plan, and the rest are shown, and nothing is saved while there are problems. The settings are read
once at start, so an edit of the file by hand needs a restart.

Theme and size are not settings: the page keeps them in the browser's storage, per user and per server.
The first state was called Proposal before plan UI Tweaks V: a settings list that still names Proposal and
not Draft is renamed once at start, with every plan in that state.

## How the LLM takes part

Every LLM takes part as a participant with the `llm` role, through the API: the hand-made `llm` participant
of an agent session, or an LLM connection the server runs for you (plan Run Shapes, Step 3; "The desktop"
below), named `<connection>@<server>`. An **agent session** in the codebase (Claude Code, say) reads `/instructions`, finds what waits on it
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
filterable by state and by whose turn it is. Select text in a plan to comment on it. The text is in the editor
(plan Markdown Editor): CodeMirror rendering the markdown in place, the cursor's line showing its source, Source
for the plain markdown (Ctrl+E), the threads' passages highlighted in it and a thread's words in the pane
scrolling to its passage; Ctrl+S saves and makes the revision (a toast says so); a newer revision is taken
silently while the text is clean; a tab with unsaved changes shows a dot and asks before it closes, as the
desktop window does (Confirm on close behind the gear). The Editor setting can pick Monaco instead, with the
Read and Edit views as before. The hotkeys are one table (`public/js/hotkeys.js`) that Menu >
Hotkeys in the title bar lists.
Revisions shows the record. A document gives the threads pane's room to the text. The theme, the size, the
editor and Confirm on close are behind the gear in the title bar, which also counts the threads waiting on you and the LLM runs in progress. Two browser tabs stay
in step: every change is a Server-Sent Event.

## Export and import

A project goes out as one json object (**Export** in its menu; `GET /api/projects/:pid/export`):
its Context folder and documents, folders, plans, Subplans, threads and every revision, with no tokens. A
folder, plan or document goes out the same way (`GET /api/items/:id/export`): the same format with that item
as its content and no Readme (`Context: null`); it imports as a project of its own, with an empty Readme, or
into a project (`Into: { Project, Parent? }` in the import's body: every id new, a project's file as a folder
named after it without its Readme and Context folder, a document only into the Context folder), which is
what the tree's Paste does (plan UI Tweaks V).
**Import** (the sidebar's button; `POST /api/projects/import`) brings one in: a project not here comes in as
it is, every id intact; one that is here is imported as a copy ("Copy of <name> (imported <date>)", every id
new) or merged (revisions matched by id; a conflict gets a merge revision with the newer text; nothing here
is removed). An export from before Step 1 is read too: its corpora and workers are dropped, its context
becomes the Readme, and the Context folder is made.

## The desktop

Consensus Desktop (plan Consensus Desktop, Step 2) is an Electron client for any Consensus server, run from the
checkout:

	npm run desktop

Since plan Run Shapes (Step 1) the app is the second entry point over `src/Start.js`: it takes the command
line's path, `--config`, `--port`, `--scope` and `--headless` (from the checkout, `npm run desktop -- --config …`),
starts **this machine's server** from the global config as its Scope says (none with Scope None; the configured
port in use gives way to a free one; a port asked for that is in use leaves the server unstarted, with the
reason on the servers screen), and opens on the page with every server it has (plan Run Shapes, Step 5): this
machine's server first, when it runs, then every saved server, each a **root** of the tree; with a project
folder on the command line (Step 4) it shows this machine's server with that project alone. With `--headless`
there is no window: the server runs and prints what the command line prints. The **servers screen** (the Server
menu's Servers…, and where the app opens when it has no server to show) has the saved servers (Edit, Remove),
**Add server** (a Name and a Url, tried before it is saved; the screen says which Consensus version answers and
warns when it differs from the app's), **This machine**: the app's own server, with its address, scope and
config folder, and **Open the page**. The **Server** menu has Servers…, The page, Reload, **New window**, which
starts another instance of the app (over the same config, on a free port when the configured one is taken), and
**Open folder in new window**, which starts one on a folder alone, as `consensus <path>` does. A tab's Detach
opens a window of the app.

The page the window shows is the server's `public/`, the one page since plan Run Shapes, Step 3 (the desktop's
own copy, `desktop/page/`, developed on while `public/` was frozen, became `public/` again; `desktop/page/`
keeps the connect screen). It is served from the app's own origin on `127.0.0.1` (`desktop/Page.js`), and that
same origin forwards `/servers/<key>/api` (the events stream included) and `/servers/<key>/instructions` to
that root's server (`local` for this machine's, a saved server's Name otherwise): every call of the page names
its root (`public/js/roots.js` holds each root's participants, projects and events; `client.js` prefixes the
root's base; a route carries its root as `#/s/<key>/p/<id>`, a browser's one root keeping `#/p/<id>`), and the
server, which sends no CORS headers, is not changed for the app beyond `/api/me` saying its `Version` and `Name`. What needs
the window stays behind `window.ConsensusDesktop` and `window.Desktop`: the native theme, the folder picker,
the remembered view state. The desktop's settings are its fields of the global config, `consensus.json` in
the config folder (`desktop.json` in Electron's user-data folder before Run Shapes; moved in once at the first
start and renamed `.moved`): `Servers`, `Theme`, `Scale` and `Remembered` (`Local`, `Last` and a theme per server, from before Step 5, are
dropped at the next start); the pages are handed those fields only, never the participants' tokens. `Theme` is
the window's one theme, set from either screen's picker. The page remembers its tree state (the open project,
the folds, the LLMs list folded, the root folded) per server, under the server's address, and the tabs, the
sort and the look (hidden panes, widths) once per window, in the config's `Remembered` (`public/js/stored.js` through the preload's `Remember`:
the page's origin gets a new port at every start, so its localStorage would not survive a restart; in a
browser the same keys are in localStorage); each root's row shows the server's name, a dot green while its
updates are live, who you are there and, in the tooltip, its address, version and, offline, the reason; a
server that does not answer stays in the tree, offline, and is read again when its stream connects. The one
item open at a time, the editor, the threads, the header (which names the root when there are several), the
revisions, the ports and the Settings popup work over its root; Paste into another server's project is an
import there, the way to move a plan between servers; drag and drop between roots is refused with a notice.

**LLM connections and runs** (plan Consensus Desktop, Steps 3 and 4, in the desktop; the server's since plan
Run Shapes, Step 3) are kept in the server's settings (`Llms`) and shown by the page, in a browser and in the
desktop alike: the **LLMs** list under the projects (New LLM in its menu; Open, Rename and Delete in a row's;
the owner's to change, everyone's to see). Each connection is a participant of its server with the `llm` role,
named `<connection Name>@<server Name>` (a Name is letters, digits, dot, dash and colon; `claude-cli` or
`ollama-<model>` offered), with a Token the server makes when it is saved and keeps on it, so every reply and
run says which connection posted it; the hand-made `llm` participant stays for an agent session. Each opens
in a tab of its own. The **LLM page** (plan UI Tweaks IV) has a head with **Details…** (a popup, the owner's:
Name; Kind `claude-cli`, a command run without a shell on the server's machine, or `ollama`; Command and
Arguments, one per line, before `--model`; Model; Timeout; for `ollama` Context, the model's window in tokens,
and Rounds, the most tool rounds a run takes; Check, which tries the form as entered and, for `ollama`, says
whether the Model calls tools) and **Packaging…** (a popup, the owner's: the items that go into the one-shot
prompt, in this order: the server's `/instructions` made for the connection's own participant and token, the
project's Readme, the other Context documents listed by title and each checkable, the threads of the plan at
hand waiting on the connection listed by anchor and each checkable; the unchecked ids are remembered per
connection, so a new document or thread is in by default; then the Review, Build and Session Prompts with
Reset; Preview packages the prompt as the form stands, with its character count and an estimated token count
at four characters each, and Copy), then **Run** (the **project**, the sidebar's open one first, whose folder
the run works in with the Include, Exclude and Commands of the project's Settings; the plan at hand in the
page's own picker, in the tree's order with its folders and indentation and each plan's unresolved threads,
defaulting to the plan last opened; **Review**, **Build** and **Session** each package their prompt and run it
once, for every participant but an llm one, disabled only while a run is going or for what they lack, with the
reason shown beside them; Stop while it runs) and the **log** (one record per run in the config folder's
`runs/<id>.json`: when, which button, who asked, the project with its folder, the plan, the prompt, the output,
the exit and the duration, and for a local model the rounds and the tokens; the page shows the connection's
runs, newest first; a run opens in a popup, its output and prompt rendered as markdown or shown as source,
each with its size and Copy; a run's start, progress and end go out over `/api/events` as `{ Kind: "run" }`,
so every page follows it). A run on a project whose folder is not on the server's machine is refused: an LLM
works on the projects of its own machine. A `claude-cli` one-shot runs the command once in the project's
folder with the package on its standard input; the model works through the API itself, with the token in the
instructions, and nothing is parsed. The default Arguments let a non-interactive `claude` use its tools.
Nothing in Consensus commits, branches or pushes.

An `ollama` one-shot (plan Consensus Desktop, Step 4: Local Models) runs in the server: a local model has no
tools of its own, so `Ollama.js` runs the tool loop over Ollama's chat endpoint, one request per round with
the connection's Context as `num_ctx`, and `Tools.js` carries out each call the model makes and sends the
result back, until the model answers without a call, the Rounds run out (one last request without tools asks
for the answer), the Timeout passes, or Stop aborts the request in flight. The tools: over the project's
folder, `glob`, `grep` and `read` within its Include and Exclude, and for Build and Session `write`, `edit`
(one occurrence, or refused) and `run`, which executes one of the project's **Commands** (one per line in its
Settings, none by default; a command exactly or with arguments after it; nothing that chains, pipes,
redirects or substitutes, on the list or in a call); over the server itself, as the connection's participant
with its Token, `list_project`, `read_plan`, `read_document`, `waiting`, `reply`, `apply` (the current
revision supplied), `thread` and `set_state`, each held to the project the run is on, a server's refusal
going back to the model as the tool's result. The package is the same, except that the agent instructions
(which say how to call the API with the token) are replaced by the server's tool instructions, so the token
never enters a local model's prompt. The run keeps its `Transcript` as entries (a round's text, a call with
its arguments, its whole result and how long it took, the answer) and its Output as the markdown rendered
from them (a heading per round, each call in bold with its result fenced and clipped at 2,000 characters, the
answer under its own heading), both growing with every call; every page hears each call, so the run popup
follows a run as it goes. The popup shows the transcript as blocks per round, each call a row that unfolds to
its whole result, and the answer rendered; Source shows the markdown. A Review gets the read-only file tools,
a Build and a Session every tool the project allows; without a folder, the Consensus tools only.

At the first start after Step 3 a `desktop.json` from before hands its LLM connections to the server (its
`Llms`, when it had none), and its workspaces to the server's migration (`Server.MigrateWorkspaces`): a
workspace on a project's folder gives that project its Include, Exclude and Commands when it has none of its
own, the others are dropped with a line, and the `Workspaces` list is gone from the settings.

The page's **theme** is a palette: System, Light, Sepia, Paper, Solarized Light, Dark, Slate, Solarized Dark,
Nord or Midnight (`data-theme` on the page; `data-bs-theme` light or dark for Bootstrap), and the editor takes
its colours; the desktop's title bar and menu bar follow it light or dark. The editor and the read view scroll
past the end of the text. In the tree a click on a folder folds it, and a folder's menu has New plan and New
folder, which create in it.

Layout: `desktop/main.js` the main process, `desktop/preload.js` its bridge, `desktop/Settings.js` the desktop's
fields of the config (and the move-in of desktop.json), `desktop/Page.js` the server for the page and the
connect screen (`desktop/page/connect.html`, `connect.js`, `connect.css`); the runs are the server's:
`src/Llms.js` the connections, `src/Runner.js` the package and the start of a run over the store,
`src/Runs.js` the runs and their records, `src/Package.js` the one-shot prompt, `src/Llm.js` a connection's
check and command line, `src/Ollama.js` the tool loop, `src/Tools.js` the tools, `src/Files.js` the files of a
folder; `public/js/llm.js` the LLMs list's data and the LLM page. `test/Desktop.test.js` covers the settings
and the page server; `test/Runs.test.js` the connections, the participants they make, the package, the check
and the runs; `test/Tools.test.js` the tools and the Ollama loop; `test/Api.test.js` the routes;
`test/Start.test.js` the start module and the headless entry point.

## The API

	GET    /api/me                                   who this request is, the participants, the States, the server's Name and Version
	GET    /api/settings                             owner; the settings as they are, and the file's path
	PUT    /api/settings                             owner; { Settings }  the server's fields, checked, the rest kept; Restart says when Scope or Port changed
	GET    /api/projects                             every project with its tree, each item with title, state, tally; its Archive, States, Path; Context and ContextFolder
	POST   /api/projects                             { Name, Path? }  Path: the project's folder; one that holds a project already is opened (200, Opened)
	PUT    /api/projects/:pid                        { Name?, States?, Include?, Exclude?, Commands?, Version? }  lists, or lines; a state in use stays
	DELETE /api/projects/:pid                        an empty project (only its Context folder and document, nothing archived); never the last one
	POST   /api/projects/:pid/folders                { Name, Parent?, Version? }  not inside the Context folder
	PUT    /api/projects/:pid/folders/:fid           { Name, Version? }  not the Context folder
	DELETE /api/projects/:pid/folders/:fid           an empty folder; not the Context folder
	POST   /api/projects/:pid/move                   { Before }  the project in the display order
	GET    /api/projects/:pid/export                 owner or llm; the project as one json object
	POST   /api/projects/import                      owner or llm; { Export, Mode?, Preview?, Into? }  Into: { Project, Parent? } writes the file's items there, every id new
	GET    /api/items/:id/export                     owner or llm; a folder, plan or document as one json object of the same format
	POST   /api/items/:id/move                       { Project, Parent?, Before? }  a plan, document or folder; a document only into a Context folder
	POST   /api/items/:id/copy                       { Project, Parent? }  a whole copy under a new id, in that project's folder
	POST   /api/items/:id/archive                    a plan, with its Subplans, out of the tree into the project's Archive; its writes answer 409 until
	POST   /api/items/:id/restore                    back at the project's root
	GET    /api/plans[?state=]                   plans and documents with their tallies
	POST   /api/plans                            { Title, Text, Kind?, State?, Project?, Parent? }  a document with no Parent goes in the Context folder
	GET    /api/plans/:id                        plan, project, text, threads with positions, tally, whose turn; Context: true for a Readme
	PUT    /api/plans/:id                        { Title }  not the Readme
	PUT    /api/plans/:id/state                  { State }  one of the States; not for a document
	PUT    /api/plans/:id/text                   { Text, Revision }  a manual edit
	DELETE /api/plans/:id                        to the trash; not the Readme
	GET    /api/plans/:id/revisions[/:n]         the record; a revision's text
	GET    /api/plans/:id/threads[?status=]      all | contested | resolved | applied | reopened | detached | mine
	POST   /api/plans/:id/threads                { Anchor: { Text, Prefix?, Suffix? } | null, Text, Resolve? }  not for a document
	POST   /api/plans/:id/threads/:tid/replies   { Text, Resolve? }  reopens a resolved thread
	POST   /api/plans/:id/threads/:tid/anchor    { Anchor }  re-anchor
	POST   /api/plans/:id/threads/:tid/resolve   owner only
	DELETE /api/plans/:id/threads/:tid           owner only
	POST   /api/plans/:id/threads/:tid/apply     { Outcome, Revision?, Text?, Anchor? }  resolved threads only
	GET    /api/trash                                what is there
	GET    /api/waiting                              everything waiting on the caller, in every project
	GET    /api/llms                                 the LLM connections: Id, Name, Kind, Model, Participant, Running; the owner sees the whole records
	POST   /api/llms                                 owner; a connection from its fields, with a new id and token
	POST   /api/llms/check                           owner; the connection as typed, tried: { Ok, Result | Error }
	PUT    /api/llms/:id                             owner; the fields given over the record
	POST   /api/llms/:id/check                       owner; tried as saved, the body's fields over it
	DELETE /api/llms/:id                             owner; not while it runs; its participant goes with it
	GET    /api/runs/lists?Project=&Plan=&Llm=       the other Context documents, the plan's threads waiting on the connection
	POST   /api/runs/package                         { Llm, Kind, Project, Plan?, Overrides? }  the prompt a run would get
	POST   /api/runs                                 { Llm, Kind, Project, Plan? }  a run started; not by an llm participant; one per connection at a time
	GET    /api/runs[?Llm=]                          the runs, newest first, without their prompts and outputs
	GET    /api/runs/:id                             the whole record, the output as it stands
	POST   /api/runs/:id/stop                        a running one stopped
	GET    /api/events                               Server-Sent Events: { Plan | Project, Kind, Thread? }, { Settings: true, Kind: "settings" }, { Kind: "llms", Llm } and { Kind: "run", Run, Llm, Status }

Errors are `{ "Error": "..." }` with the status: 400 bad body (`Problems` lists them for the settings), 401
unknown token, 403 not allowed for this role, 404 not found, 409 not allowed in this state or a stale
revision or version (with the current `Revision` or `Version`).

## The website

`docs/` is the public site, Consensus-AI's landing page and user guide (plan Documentation), published as it is to
the S3 bucket `consensus-ai.liquicode.com` and served at http://consensus-ai.liquicode.com. The guide is markdown in
`docs/guide/`, one page each in `pages.json`'s order, rendered into `template.html` by the build, with the rendered
pages committed beside their sources. The screenshots in `docs/images/` are made by a script, never by hand:

	node bin/docs.js build          renders the guide, copies Bootstrap into docs/css/, checks every link and image
	node bin/docs.js screenshots    the 30 pictures, light and dark, from a seeded server and the desktop
	node bin/docs.js publish        build, then aws s3 sync docs/ to the bucket with the default AWS profile

The screenshot script seeds a server over `~docs-demo/` in the checkout with the demo project in `docs/demo/`,
drives a headless Chrome or Edge through `test/support/Cdp.js`, then starts the desktop with its own user-data
folder for its pictures; `test/Docs.test.js` runs both the build and the script over a copy of `docs/`. The official
name is Consensus-AI wherever the site names the product; the prose says Consensus.

## Layout of the code

	bin/consensus.js      the headless entry point
	src/Start.js          the start module both entry points share: the arguments, Run, the lines
	src/Server.js         Start( { Config, Port, Scope } )
	src/Api.js            the routes
	src/Instructions.js   GET /instructions: the agent guide with This server first
	src/Rules.js          the consensus rules, pure functions
	src/Tree.js           a project's tree, pure functions; the Context folder's rules
	src/Anchors.js        visible-text anchors
	src/Store.js          the config folder and the project folders, the archive, and the migrations (before Step 1, before Step 2)
	src/ProjectPort.js    export and import
	src/Participants.js   who is calling, the States, and the settings' checks
	src/Ids.js            global ids
	src/Events.js         Server-Sent Events
	src/Llms.js           the LLM connections, each a participant of the server
	src/Runner.js         a run's lists, package and start over the store
	src/Runs.js           the runs and their records (<config>/runs/)
	src/Package.js        the one-shot prompt
	src/Llm.js            a connection's check and command line
	src/Ollama.js         the tool loop over Ollama's chat endpoint
	src/Tools.js          a local model's tools over the project's folder and the server
	src/Files.js          the files of a folder: globs, Include and Exclude
	public/               the page: index.html, css/, js/ (one controller per pane; roots.js the servers the page shows; settings.js the settings popup; llm.js the LLMs and the runs)
	test/                 node --test; Ui.test.js drives a headless browser through test/support/Cdp.js
	.plans/               the build plans and the story of this repository
	.guides/              build-with-consensus.md, the agent session's guide
	docs/                 the website: index.html, guide/, template.html, css/, js/, images/, demo/
	bin/docs.js           the website's build, screenshots and publish
	Dockerfile, compose.yaml    the image (plan Docker Image): the server on port 3500, its data in /data
