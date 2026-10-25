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
	node bin/consensus.js [serve | <path> | --project <folder>] [--config <folder>] [--port 3500] [--scope none|local|public] [--headless]
	node bin/consensus.js mcp <folder> [--service <name>]

One program, two entry points over one start module (`src/Start.js`, plan Run Shapes, Step 1): this one, headless,
for a plain node install and the Docker image, and the desktop (below), which opens a window as well. The word
`serve` (plan Rearchitecturation, Step 1) names the **Server Host**, every registered project served; the bare form
with no path means the same, so the Docker image and `npm start` are unchanged, and `serve` takes no folder. Both read
the global config, `consensus.json` in the config folder: `.consensus` in the user's folder by default, or the
`--config` folder (`--data` is its older name, kept for one release); the projects live there too until Step 2.
The server listens as the settings' `Scope` says: `Local` on 127.0.0.1, `Public` on 0.0.0.0, `None` not at all;
`--scope` overrides it for one start, and `--port` the port (the configured port in use gives way to a free one,
plan Run Shapes, Step 4; a port given on the command line does not). A path, or `--project <folder>`, serves
that project alone, the way an editor opens a folder (Step 4): its `.consensus` is made when missing, named
after the folder, the folder goes first in the settings' `Projects`. That server is the **sidecar** (plan
Rearchitecturation, Step 3; `src/Sidecar.js`): with no `--port` its port is hashed from the folder's absolute path into
3600 to 3699, stepped up by one while taken and wrapping at the end; it listens on this machine alone (Scope Public is
taken as Local, and Scope None keeps the server for the window and turns the sidecar off: no address file); while the
project is open, `<folder>/.consensus/~sidecar.json` holds `{ Url, Port, Pid, Started, Project }`, written at start and
removed at a clean exit, a stale file (its Pid gone) overwritten. A folder already open in a running sidecar is not
opened again: `consensus <folder>` asks that sidecar to bring its window to the front (`POST /api/desktop/activate`,
answered by a Desktop's sidecar alone), prints its address and exits. `consensus mcp <folder>` is the MCP shim over a
folder's sidecar (below).
It prints its address and scope, the config folder, the settings file and the projects loaded, and says that it
opens no window: this form never does. Open `http://127.0.0.1:3500/` in a browser, or run the desktop (below).

Security is relaxed for now: a request without a token is the owner, so anyone who can reach a server
listening beyond this machine acts as the owner, and reads the llm token at `/instructions`.

An agent session in any repo is started with one line: "read the instructions at
`http://<server>:<port>/instructions`" (with `curl`). That page is `.guides/build-with-consensus.md` with a
**This server** section first: the API's address, as the request reached it, and the llm participant's token.
An MCP client (plan MCP Server, 2026-10-23) gets the same operations as tools: `POST /api/mcp` in the server, or the
stdio relay `node bin/mcp.js --server <url or saved Host> [--service <name> | --token <token>] [--project <id or name>]` on its own
machine (a saved Host is a Name from `desktop.json`'s Hosts, its Url taken), or the **shim** over a project's sidecar,
`consensus mcp <folder>` (`node bin/mcp.js <folder>`; plan Rearchitecturation, Step 3): the sidecar's address is read
from `<folder>/.consensus/~sidecar.json` at every message, so one MCP entry per project is fixed,
`{ "command": "consensus", "args": [ "mcp", "<folder>" ] }`, and a folder not open in Consensus answers each request
with one message saying so; the sidecar's one project is filled in for the tools that take one, and its `/instructions`
page names the project and the one-project rule. Every operation of the API is defined once in `src/Operations.js`, which the REST routes, the MCP tools and
a local model's tools are read from.
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
(New window, Open folder in new window, the recent folders, Settings, Reload, Quit). Click a folder to make it where new items go. Everything reorders by drag
and drop: drop an item on the top or bottom edge of a row to put it just before or after that row, on the
middle of a folder to move it inside, or on a project's heading to move it to that project's root (the
Context folder stays first); drop a project's heading on another's to reorder the projects. Rename an item
from its menu (a plan or document: only its title changes); copy it (its menu, or Ctrl+C on the open item),
which puts its export json on the system clipboard, and paste it (Paste in a project's or folder's menu, or
Ctrl+V into the open project), which imports what the clipboard holds there, every id new: a plan's text,
threads, revisions and Subplans, a folder's whole contents, a project as a folder named after it (plan UI
Tweaks V; Export in the menu shows the same json for any item). Delete is in the menu only,
confirmed on the row: a plan or document goes to the trash; a project or folder is deleted only when empty
(a project: when it holds only its Context folder and document). Trash is at the bottom of each server's rows, its
heading counting what is there; Empty Trash in its menu (the owner's) removes it all for good, confirmed under the heading.

The button at the right end of the tab strip hides or shows the threads pane (its mirror at the left end the
tree; Ctrl+Shift+T and Ctrl+Shift+E too); each is remembered in the browser. A selected thread
stays listed whatever the filter; Escape or a click in the text off any highlight deselects it, and after
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

	<config>/consensus.json                        settings: Name, Port, Scope, States, Owner, Llms, Tasks, Clerk, and the registry
	                                               Projects: [ { Path, Mounted } ], the project folders in display order, Mounted
	                                               (plan Rearchitecturation, Step 1) saying whether a Server Host exposes it; the
	                                               Server Host's file, which the desktop reads and never writes
	<config>/desktop.json                          the desktop's own file (Step 1): Recent, Hosts, Theme, Scale, Remembered
	<config>/Users.json                            the accounts: the owner, the users and the Service accounts, with their hashed tokens
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

A config folder with no project gets Default at its first start, and a new settings file its defaults.
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
		"Owner": { "Name": "user", "Display": "User" },
		"Projects": [ { "Path": "C:/Users/you/.consensus/projects/Default", "Mounted": false } ]
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
is removed). An export of another `Version` is refused.

## The desktop

Consensus Desktop (plan Consensus Desktop, Step 2) is an Electron client, run from the checkout:

	npm run desktop -- [<folder> | --connect <host name>] [--config <folder>] [--port <port>] [--scope ...] [--headless]

Since plan Run Shapes (Step 1) the app is the second entry point over `src/Start.js`, taking the same arguments
(from the checkout, `npm run desktop -- --config …`). **A window is one project** (plan Rearchitecturation, Step 2):
with a folder on the command line it starts **this machine's server** over that folder alone, as the headless
`consensus <folder>` does (the folder's `.consensus` made when missing; the configured port in use gives way to a
free one, a port asked for that is in use leaves the project unopened, with the reason on the chooser), and shows
that project's tree; that server is the sidecar (Step 3, `src/Sidecar.js`: the port hashed from the folder into 3600 to
3699, the address in the folder's `.consensus/~sidecar.json`), and a folder already open in another window is not opened
again: that window is brought to the front (`POST /api/desktop/activate`, answered by the sidecar of a window) and a
launch on the folder exits, as VS Code activates the window that has the folder; the chooser's Open folder and Recent
do the same, the chooser saying so; with `--connect <host name>` it opens a saved Host project (desktop.json's Hosts) as a **thin
client**, the page pointed at the Host's API through the app's own origin, signed in as the person or the owner over
localhost on a Local Host, writing nothing locally; with neither it shows the **chooser**: **Recent projects** (Open,
Forget), **Open folder…** (the folder picker), **New project** (a name and a parent folder; the folder is made
empty and opened) and the **Hosts** (the saved Host projects with Open and Remove; **Add host**: a Name and a Url
tried first, then one of the Host's projects picked from a list, the pair saved as an entry with the project's name
as its Title), each opening in this window. Another project is another instance: the page's menu has **New window**
(another chooser), **Open folder in new window…** and the recent folders, each starting one, and the chooser's New
window link does the same; the app is one process per window. With `--headless` there is no window: this machine's
server runs from the config as its Scope says and prints what the command line prints. A tab's Detach opens a
window of the app. The desktop's own `--connect` is taken before `src/Start.js` parses the rest.

The page the window shows is the server's `public/`, the one page since plan Run Shapes, Step 3 (the desktop's
own copy, `desktop/page/`, developed on while `public/` was frozen, became `public/` again; `desktop/page/`
keeps the connect screen). It is served from the app's own origin on `127.0.0.1` (`desktop/Page.js`), and that
same origin forwards `/servers/<key>/api` (the events stream included) and `/servers/<key>/instructions` to
that root's server (`local` for this machine's, a saved server's Name otherwise): every call of the page names
its root (`public/js/roots.js` holds each root's participants, projects and events; `client.js` prefixes the
root's base; a route carries its root as `#/s/<key>/p/<id>`, a browser's one root keeping `#/p/<id>`), and the
server, which sends no CORS headers, is not changed for the app beyond `/api/me` saying its `Version` and `Name`. What needs
the window stays behind `window.ConsensusDesktop` and `window.Desktop`: the native theme, the folder picker,
the remembered view state. The desktop's settings are its own file, `desktop.json` beside `consensus.json` in the
config folder (plan Rearchitecturation, Step 1; they were fields of `consensus.json` before): `Recent` (the project
folders opened, newest first), `Hosts` (the saved Host projects, one entry `{ Name, Url, Project, Title }` per Host
project, Title the project's name as last seen, no tokens: a Host with Scope Local is reached from its own machine, where
a request is the owner, and any other Host is Public and signs the person in through Clerk), `Theme`, `Scale` and
`Remembered`. `desktop/Settings.js` reads and writes that file and nothing else: `consensus.json` is the Server Host's
to write, and the desktop reads it for the server's Name; `desktop/Projects.js` makes a new project's folder, lists a
Host's projects and keys a window's project. `Theme` is the window's one theme, set from either screen's picker. The
page remembers its tree state (the folds, the LLMs list folded) per project, under the window's project key (the
folder, or the Host's address and the project id: `StoredKey` on the root, Step 2; a browser's page keeps the server's
address), and the tabs, the sort and the look (hidden panes, widths) once per window, in `desktop.json`'s `Remembered` (`public/js/stored.js` through the preload's `Remember`:
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
whether the Model calls tools) and **Packaging…** (a popup, the owner's: what the connection leaves out of a
package, the other Context documents listed by title and each checkable, the threads of the plan at hand
waiting on the connection listed by anchor and each checkable, the unchecked ids remembered per connection so
a new document or thread is in by default; its Session Prompt, appended to every package of the connection;
and Preview, one button per task, which packages the task as the form stands, with its character count and
an estimated token count at four characters each, and Copy), then **Run** (the **project**, the sidebar's open one first, whose folder
the run works in with the Include, Exclude and Commands of the project's Settings; the plan at hand in the
page's own picker, in the tree's order with its folders and indentation and each plan's unresolved threads,
defaulting to the plan last opened; one button per **task** the project enables (plan LLM Tasks, Step 1: Answer,
Work and Session shipped, below), in the server's order, each packaging its task and running it once, disabled
only while a run is going or for what it lacks, with the reason shown beside it; Stop while it runs) and the **log** (one record per run in the config folder's
`runs/<id>.json`: when, which task, who asked, the project with its folder, the plan, the prompt, the output,
the exit and the duration, and for a local model the rounds and the tokens; the page shows the connection's
runs, newest first; a run opens in a popup, its output and prompt rendered as markdown or shown as source,
each with its size and Copy; a run's start, progress and end go out over `/api/events` as `{ Kind: "run" }`,
so every page follows it). A run on a project whose folder is not on the server's machine is refused: an LLM
works on the projects of its own machine. A `claude-cli` one-shot runs the command once in the project's
folder with the package on its standard input; the model works through the API itself, with the token in the
instructions, and nothing is parsed. The default Arguments let a non-interactive `claude` use its tools.
Nothing in Consensus commits, branches or pushes on its own: the **Work options** (plan LLM Tasks, Step 3) are
two switches of the project, off by default, shown on the LLM page beneath the task buttons when the project
enables a task that writes files and kept in project.json as `GitSync` and `AutoCommit`. With Git sync on, a run
of a task with Writes files pulls first (`git pull`, a failure refusing the run with git's last lines; the run
record keeps git's words as `Git.Pull`) and a commit is pushed after. With Auto-commit on, the owner's resolve
of a **build log** (a whole-document thread opened by such a run on the plan) commits the working tree
(`git add -A`, `git commit`: the plan's title the subject, the log's opening reply the body, git's ignore rules
and the checkout's own git user) and the thread keeps the record as `Git: { Commit, Branch, Pushed, Error, At }`,
shown as a line in its transcript; a clean tree is "nothing to commit" and a failure leaves the resolve standing.
`src/Git.js` runs git without a shell in the project's folder, never prompts and gives up after 60 seconds.

**The plan page's buttons** (plan LLM Tasks, Step 6): a plan's heading (`public/components/editor-header/`) has one
button per enabled task whose Package has Plan on, run through the project's chosen connection (`Llm` in
project.json, set through PUT /api/projects/:pid and picked in the project's Settings popup; an unknown id is
refused, null clears it, a connection deleted since counts as none); with none chosen the buttons are disabled
and say so, and a server with no connection shows none. The rules are one set, `Llms.Reason` in `public/js/llm.js`,
asked by the LLM page and the heading alike; a task with a Box asks in a popup sharing the LLM page's remembered
text; a toast says the run started and, over the events, that it ended or failed; the log, the run popup and Stop
stay on the LLM page.

**Explain** (plan LLM Tasks, Step 4) is the conversation with a project: a tab per project (`#/x/<project id>`;
Explain in the project's menu, or the Explain button on the LLM page, which opens the tab instead of running;
`public/components/explain-pane/`) with the exchange above and a question box below. Ask starts an Explain run
of the project's chosen connection (Step 6: project.json's `Llm`, picked in the project's Settings popup) with the question as its Text, and the answer
is the run's output, rendered when the run ends. The conversation is the person's Explain runs of the project,
read from the run records (`GET /api/runs?Project=&Task=explain&By=`), so nothing is kept in the project; Clear
deletes them (`DELETE /api/runs/:id`, never a running one). An Explain run has Writes none: it reads the project
through the API or the read tools and is refused every write, so it posts nothing whatever the model tries.

**Users and roles** (plan User Management, Step 3; the model is Accounts and Roles') put people besides the owner
on a server, each allowed per project what their role there allows. The registry is `<config>/Users.json`
(`src/Users.js`): one record per account ({ Id usr-…, Type owner | user | service, Login, Display, Email, Clerk,
Plan, Tokens, Created }), the owner's record made at the first start from the settings' Owner and kept up to it; a
Local server holds the owner's and the Service accounts the owner makes. A token is minted on an account's page with a name, its
value shown once and kept as a sha256; a request carrying it (`Authorization: Bearer`) is that account, the
token's name recorded as Token beside the service header's name, the byline reading "<service> by <login>";
a revoked token is nobody. A bare request is the owner on a Local server (on a Public server it is refused,
Step 4). The
Administrator (the owner; on a Public server the account whose email is the Clerk section's AdminEmail)
makes accounts on the server-level **Users** fold in the sidebar (New user with a login, a display and an email, the
record Clerk completes at the person's first sign-in; New Service account with a name) and mints a Service
account's tokens; an account edits its own display and mints and revokes its own. A project's **Users** folder,
fixed after the Context folder, holds exactly **Owners**, **Members**, **Service** and **Watchers** (project.json's
`Roles`, account ids, an account in one at most): an account is dragged in from the Users fold, between them to
change role, and out with the × on its row, by an Owner of the project or the Administrator
(`PUT /api/projects/:pid/roles`). `src/Roles.js` names the actions (read, write, resolve, state, manage, roles,
press; admin for the server's own routes) and what each role allows: Owners everything in the project; Members
read, write, resolve the threads they started and press by the task's Writes; Service accounts read and write and
press nothing; Watchers read and press the tasks that write nothing; the Administrator the server's routes and
roles anywhere, plus a role folder like anyone's. A middleware after identify (`authorize` in `src/Api.js`) finds
the route's project and the account's role and refuses with 403 and a plain reason ("a Watcher reads only", "no
role in this project", "the Administrator's") before the route runs; the list routes show a non-owner only the
projects with a role; a run's token carries the presser's account and role, so a run is allowed what the presser
is, and its package says who it acts for. The owner account passes every check, so nothing a bare request does
changes. An account's page (`#/u/<id>`, `public/components/user-page/`) holds the details, the projects and the
role in each, the tokens and the activity the threads and revisions record (`GET /api/users/:id/activity`); the
Users fold is `public/components/users-fold/`, the role folders `public/components/roles-folder/`.

**Sign-in through Clerk** (plan User Management, Step 4; the subplan Clerk, Steps 2 to 4) puts people on a shared
server without a password of ours. The built-in publishable key turns it on (the file's optional Clerk section,
hand-edited since it left the Settings popup on 2026-10-20, overrides it and adds the secret key, the webhook
secret and the Administrator's email; PUT /api/settings keeps the section when the body gives none); `src/Clerk.js` needs no package: a Clerk session token is an
RS256 JWT, verified with Node's crypto against the instance's published keys (read from the Frontend API the
publishable key names, cached, read again for an unknown key id), its exp and nbf with a minute's leeway, its
issuer and, when it carries one, its azp against the request's host; a Bearer value that is no token of ours is
tried as one, and its subject is the registry record with that Clerk id. A subject the registry lacks is fetched
once from Clerk's Backend API with the secret key and written: matched by email to a record the Administrator
made by hand, whose Clerk id is filled in, else a new user with a login made from the email (lowercased, other
characters a dash, a number while taken) and no role. On a Public server a bare request is refused with 401
"sign in"; on Local it stays the owner, and a session there is the owner's. The page asks `GET /api/clerk`
(public: On, Required, the publishable key, the Frontend API host, the pricing page; never the secret) and loads
ClerkJS from that host when it is needed; `public/js/session.js` hands every call to the page's own server
the session token, a 401 shows Clerk's sign-in box in a popup (`public/components/sign-in-box/`), the title bar
mounts Clerk's user button (sign out is in its menu), and a sign-in or sign-out reloads the page. The desktop's
own server signs in the same way since Clerk Step 7 (2026-10-20): the session knows the page's own server (the
browser's one root, or the desktop's own under /servers/local), the desktop's page server forwards the window's
host as X-Forwarded-Host, which the API takes from the loopback so the token's azp still matches, and the page
server's port is remembered in desktop.json so the sign-in survives a restart; the desktop's saved Hosts carry no
tokens (Rearchitecturation, Step 1): a Local Host is the owner from its own machine, a Public one signs in. `POST /api/clerk/webhook`, before identify and verified the Svix way (HMAC-SHA256 over id, timestamp and
the raw body with the whsec_ secret, five minutes' window), keeps the registry following Clerk: user.created and
user.updated write or bring up the record, user.deleted removes it and its roles, organizationMembership.created
writes the member with no role, organizationMembership.deleted removes it, organization.created is logged; each
write sends { Kind: 'users' }. The production instance, our own OAuth applications and waitlist mode are dashboard
work (Clerk Step 6); the guide pages are Step 5 of User Management.

**The license** (the subplan Clerk, Step 5, 2026-10-20) belongs to a person, not to a server. Free is the Local
server: no sign-in, the owner's typed name, the owner's and the Service accounts' tokens, unlimited installations.
Paid is a single-user license on a Consensus-AI account, with a kind, its Plan: **Host** runs a Public server and is
its Administrator, **User** is an Owner or a Member in projects; a Watcher needs an account and no license, and a
Service account none, being a token. A site license is a Clerk organization carrying the license for its members,
capped at the seats bought; the sign-in stays personal, the tie is Clerk's invitation, and the page makes the
person's organization active at sign-in so the token carries its license. There is one Clerk instance, ours: its
publishable key is a constant in `src/Clerk.js`, so a Public server needs no Clerk section (the section overrides
the key with another instance's, adds the secret key and the webhook secret on our own servers, and names the
Administrator); the trusted network of before, Public with no keys, is gone, and Trust is local, clerk or none. A
person's email, names and license come from the session token's claims, written there by the instance's session
token template (`email`, `first`, `last`, `username`, `license` from the user's public metadata, `org_license` from
the active organization's: `{ Plan, Until }` or the plan as a string, the higher valid one counting); the Backend
API is asked only when a secret key is there and the claims lack an email. `src/Roles.js` ranks the plans
(`PLANS`, `PlanRank`, `PlanFor`: Owners and Members need User). Three checks, each naming the plan it wants: at
sign-in (`clerk_participant` in `src/Api.js`) the Administrator needs Host and an Owner or a Member of any project
needs User, else 401 `{ Error: 'license', Plan, Has }`, a Watcher-only or unplaced person admitted free, the plan
written on the record (`Plan`, shown by `GET /api/users` and `/api/me`); at `PUT /api/settings`, Scope Public is
saved from a session with a Host plan alone (403 otherwise; a server configured Public from its file or
environment starts and listens, and admits licensed sign-ins alone); at `PUT /api/projects/:pid/roles`, a person
seen without a User plan stays out of Owners and Members (400). On a Public server with no AdminEmail the first
sign-in with a Host plan becomes the Administrator, written to the settings; a Docker server takes
`CONSENSUS_ADMIN` from the environment at start. The settings routes are the Administrator's (the owner on Local).
The page (`public/js/session.js`) loads ClerkJS only when the server requires a sign-in, when this browser
remembers one, or when the Settings popup's Sign in button asks, so a free Local server loads nothing from Clerk;
the popup offers Public to a session with a Host plan alone; the sign-in box shows the license message with the
pricing link and Clerk's sign-out on a 401 license. The production instance, the token template and the pricing
page are Clerk Step 6.

An `ollama` one-shot (plan Consensus Desktop, Step 4: Local Models) runs in the server: a local model has no
tools of its own, so `Ollama.js` runs the tool loop over Ollama's chat endpoint, one request per round with
the connection's Context as `num_ctx`, and `Tools.js` carries out each call the model makes and sends the
result back, until the model answers without a call, the Rounds run out (one last request without tools asks
for the answer), the Timeout passes, or Stop aborts the request in flight. The tools: over the project's
folder, `glob`, `grep` and `read` within its Include and Exclude, and when the task writes files `write`, `edit`
(one occurrence, or refused) and `run`, which executes one of the project's **Commands** (one per line in its
Settings, none by default; a command exactly or with arguments after it; nothing that chains, pipes,
redirects or substitutes, on the list or in a call); over the server itself, as the connection's participant
with its Token, the operations of the definition it may call (plan MCP Server, Step 2: `list_projects`, `read_plan` (a document too),
`list_threads`, `list_revisions`, `read_revision` and `waiting` to read; `thread`, `reply`, `reanchor`, `apply` (the current
revision supplied), `write_text` (the whole text as a revision, the revision supplied), `set_state` and `create_plan` to write), each held to the project the run is on, a server's refusal
going back to the model as the tool's result. The package is the same, except that the agent instructions
(which say how to call the API with the token) are replaced by the server's tool instructions, so the token
never enters a local model's prompt. The run keeps its `Transcript` as entries (a round's text, a call with
its arguments, its whole result and how long it took, the answer) and its Output as the markdown rendered
from them (a heading per round, each call in bold with its result fenced and clipped at 2,000 characters, the
answer under its own heading), both growing with every call; every page hears each call, so the run popup
follows a run as it goes. The popup shows the transcript as blocks per round, each call a row that unfolds to
its whole result, and the answer rendered; Source shows the markdown. The tools follow the task's Writes: none
gets the read tools only (no reply, apply, thread or set_state), consensus the read-only file tools and the
Consensus writers, files every tool the project allows; without a folder, the Consensus tools only.

**LLM tasks** (plan LLM Tasks, Step 1) are what the buttons ask: a task is a record of the settings (`Tasks`),
edited in the Settings popup, one row per task in the buttons' order (Add, Remove, up and down): a **Name**
(what the button says and the run record carries), a **Package** of eight switches (the server's instructions,
the project's Readme, the other Context documents, the plan at hand, the threads waiting on the connection,
the project's folder as the run's working folder, Project, Step 4: the project's shape, every plan and document
as a title, id, state and tally and the last twenty run records, off unless set, and Box, Step 2: a text box on the LLM page for the person's
instructions, kept per project in the browser, sent as `Text` with the run, kept on its record and put under
"Your instructions" after the prompt), a **Writes** level (**none**, **consensus** or
**files**, each including the ones before) and a **Prompt** (the task's instructions, under "Your task:
<name>" in the package; empty, the connection's Session Prompt is the task). Consensus ships **Answer** (every
item but the box, writes consensus: the Review of before), **Enhance** (Step 2: the plan, the Readme, the
documents and the box, no threads and no folder, writes consensus; its prompt has the model replace a sketch
with a detailed plan as one revision and open a thread for each open question), **Work** (no threads, writes
files: the Build of before), **Explain** (Step 4: the instructions, the Readme, the documents, the project's
shape, the files and the box, writes none: the conversation with a project, below) and **Session** (the
instructions, the Readme and the documents, writes files; its prompt is the connection's).
Writes is the permission: the run token carries it, so a none run is refused every writing route (403, "this
run reads only") and a local model gets the read tools only; a task that packages the plan or the threads
needs a plan picked, one that writes or packages files the project's folder on the server's machine. Tasks
are defined per server and enabled per project: a project's Settings lists them with a checkbox each (`Tasks`
in project.json, the enabled ids; absent means all, so a task added later is on everywhere). A file with no
`Tasks` gets the shipped set at start. `TasksVersion` in the settings (3
since Step 4) says which shipped tasks a file has been given: a file below it gets the shipped tasks that came
after its version (each shipped task carries a Since), each after the nearest shipped one before it, once, so a
task the owner removes stays removed. A local model gets
`write_text` (the plan's whole new text as a revision, the current revision supplied) beside the other
Consensus tools, so an Enhance through Ollama can post the text.

The page's **theme** is a palette: System, Light, Sepia, Paper, Solarized Light, Dark, Slate, Solarized Dark,
Nord or Midnight (`data-theme` on the page; `data-bs-theme` light or dark for Bootstrap), and the editor takes
its colours; the desktop's title bar and menu bar follow it light or dark. The editor and the read view scroll
past the end of the text. In the tree a click on a folder folds it, and a folder's menu has New plan and New
folder, which create in it.

Layout: `desktop/main.js` the main process, `desktop/preload.js` its bridge, `desktop/Settings.js` the desktop's
own file, desktop.json, `desktop/Page.js` the server for the page and the
chooser (`desktop/page/connect.html`, `connect.js`, `connect.css`), `desktop/Projects.js` the chooser's work without
Electron; the runs are the server's:
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
	PUT    /api/projects/:pid                        { Name?, States?, Include?, Exclude?, Commands?, Version? }  lists, or lines; a state in use stays; Tasks: the enabled task ids, null for all
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
	GET    /api/plans/:id/report                 the plan, its Subplans and all their threads as one page made for printing (plan Printing and Reporting)
	GET    /api/plans/:id/report.md              the same report as markdown
	GET    /api/plans/:id/threads[?status=]      all | contested | resolved | applied | reopened | detached | mine
	POST   /api/plans/:id/threads                { Anchor: { Text, Prefix?, Suffix? } | null, Text, Resolve? }  not for a document
	POST   /api/plans/:id/threads/:tid/replies   { Text, Resolve? }  reopens a resolved thread
	POST   /api/plans/:id/threads/:tid/anchor    { Anchor }  re-anchor
	POST   /api/plans/:id/threads/:tid/resolve   owner only
	DELETE /api/plans/:id/threads/:tid           owner only
	POST   /api/plans/:id/threads/:tid/apply     { Outcome, Revision?, Text?, Anchor? }  resolved threads only
	GET    /api/trash                                what is there
	DELETE /api/trash                                owner; empties it for good, { Emptied: n }; the pages hear { Kind: "trash" }
	GET    /api/waiting                              everything waiting on the caller, in every project
	GET    /api/tasks[?Project=]                     the tasks, in the buttons' order, or those a project enables; the Writes levels, the Package switches and the shipped Defaults
	GET    /api/llms                                 the LLM connections: Id, Name, Kind, Model, Speaker, Running, the whole records
	POST   /api/llms                                 owner; a connection from its fields, with a new id and token
	POST   /api/llms/check                           owner; the connection as typed, tried: { Ok, Result | Error }
	PUT    /api/llms/:id                             owner; the fields given over the record
	POST   /api/llms/:id/check                       owner; tried as saved, the body's fields over it
	DELETE /api/llms/:id                             owner; not while it runs; its participant goes with it
	GET    /api/runs/lists?Project=&Plan=&Llm=       the other Context documents, the plan's threads waiting on the connection
	POST   /api/runs/package                         { Llm, Task, Project, Plan?, Text?, Overrides? }  the prompt a run would get; Task the task's id, Text the box's text
	POST   /api/runs                                 { Llm, Task, Project, Plan?, Text? }  a run started as the presser through the connection, on a token named after the task that carries its Writes; one per connection and per plan at a time, a press while either has a run on answered 201 with Status queued and Behind the run it waits for, packaged again when its turn comes
	GET    /api/runs[?Llm=]                          the runs, newest first, without their prompts and outputs
	GET    /api/runs/:id                             the whole record, the output as it stands
	POST   /api/runs/:id/stop                        a running one stopped
	GET    /api/events                               Server-Sent Events: { Plan | Project, Kind, Thread? }, { Settings: true, Kind: "settings" }, { Kind: "llms", Llm } and { Kind: "run", Run, Llm, Status }

Errors are `{ "Error": "..." }` with the status: 400 bad body (`Problems` lists them for the settings), 401
unknown token, 403 not allowed for this role, 404 not found, 409 not allowed in this state or a stale
revision or version (with the current `Revision` or `Version`).

## The website

`docs/` is the public site, Consensus-AI's landing page and user guide (plan Documentation), published as it is to
the S3 bucket `consensus-ai.mchiver.com` and served at http://consensus-ai.mchiver.com. The guide is markdown in
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
	src/Server.js         Start( { Config, Port, Scope, Project, Activate } ); a project's server is the sidecar
	src/Sidecar.js        the sidecar's port (hashed from the folder into 3600 to 3699), its address file and Activate
	src/Api.js            the routes
	src/Instructions.js   GET /instructions: the agent guide with This server first
	src/Operations.js     every operation defined once (plan MCP Server): name, description, parameters, action, the function; Route and Definition for a client
	src/Mcp.js            the Model Context Protocol over the operations: initialize, ping, tools/list, tools/call; no transport in it
	bin/mcp.js            the MCP stdio relay to a running server (consensus-mcp); a folder is the shim over its sidecar, --server a Url or a saved Host from desktop.json
	src/Rules.js          the consensus rules, pure functions
	src/Tree.js           a project's tree, pure functions; the Context folder's rules
	src/Anchors.js        visible-text anchors
	src/Store.js          the config folder and the project folders, the archive; Open( Folder, { ReadOnly } ) for the desktop's reading of the Host's config
	src/ProjectPort.js    export and import
	src/Report.js         the report of a plan: Compose, Markdown, Html (plan Printing and Reporting)
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
