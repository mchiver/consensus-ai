# Features

## Plans and threads

- **Plans with threads.** A plan is a markdown document with a conversation beside it. Each thread is one question, settled in one place. See [Threads](threads.html).
- **Anchored comments.** Select a passage and comment on it; the thread is tied to those words, highlighted in the text, and follows them as the text changes.
- **Three thread states.** Contested while it is discussed, resolved when the owner settles it, applied when the LLM has changed the text. The colour of the passage says which.
- **Reply and resolve.** The owner settles a thread with a reply that becomes the outcome, or resolves it with no reply to accept the last recommendation.
- **Reopening.** Any reply to a settled thread reopens it, marked as such, without undoing what was applied.
- **Whose turn.** Every thread knows who it waits on. The tree, the title bar and the threads pane count what waits on you; **Waiting on you** lists it across every project.
- **Plan states.** Draft, Plan, Working and Finished by default, picked from the heading at any time; the list is yours to change per project.
- **Subplans.** A plan can hold plans. Start one from a thread, from selected text or from the menu, and it carries the passage and the discussion with it.
- **Whole-document threads.** A comment with nothing selected is on the plan as a whole, the place for a review or a build log.

## Writing and revisions

- **A markdown editor with a live preview.** CodeMirror renders the markdown in place, with the cursor's line showing its source; Source view shows the plain text. See [Editing and revisions](editing.html).
- **Threads in the editor.** The anchored passages are highlighted while you edit, and a thread in the pane scrolls the editor to its words.
- **Monaco mode.** A setting swaps the editor for Monaco, with separate Read and Edit views.
- **Revisions.** Every save and every applied thread is a revision, with who, when and why. The plan keeps its own history, so there is no change log to maintain.
- **Safe concurrent edits.** A save carries the revision it was made from; a stale one is refused instead of overwriting someone else's work.
- **Tabs.** Every open item is a tab, reordered by drag, restored as you left it after a reload, and detachable into a window of its own.
- **Hotkeys.** One table of keys, listed under Menu, for saving, switching views, commenting and moving between panes.

## Projects and documents

- **Projects.** Everything lives in a project: plans, documents and folders of any depth, shown as a tree in the sidebar. See [Projects, plans and documents](projects.html).
- **The Context folder.** Every project has one, holding its Readme, a short account of what the project is and what has been decided, and any other background document an LLM should read.
- **Documents.** Markdown with revisions but no threads, for the background material of a project.
- **Drag and drop.** Reorder, move into folders, make a plan a Subplan, and reorder projects, all by dragging in the tree.
- **Copy and paste.** Copy a plan, a folder or a project to the clipboard as JSON and paste it into any project, on any server; every id is new.
- **Archive and trash.** Finished plans go to the archive, out of the tree but kept; deleted items go to the trash.
- **Reports.** A plan, its Subplans and all their threads flattened into one page for review and printing: every reply with who and when, the passages marked and numbered, Subplans as chapters; Print saves it as a PDF, and the same report is served as markdown. See [Export and import](export-import.html#report).
- **Export and import.** A project, folder, plan or document goes out as one JSON file with its threads and every revision, and comes back in as it was, as a copy, or merged. See [Export and import](export-import.html).
- **Plain files you own.** A project is a `.consensus` folder beside your source, meant for source control, with no secrets in it. Back it up by copying it.

## Working with LLMs

- **The LLM as a participant.** Every LLM takes part through the API as a participant of its own, so every reply and every applied change says who made it. See [Working with an LLM](llm.html).
- **Agent sessions.** Point Claude Code or any agent at one address, `/instructions`, and it learns the rules, finds what waits on it, replies, applies and drafts plans.
- **Your turn in Consensus.** The working loop: the owner comments and resolves, the agent replies and applies, in the plan, not in a chat scroll.
- **The build loop.** When every thread is applied, the agent builds exactly that plan and posts its build log as a thread, accepted the same way.
- **LLM connections.** The server runs LLMs for you: Claude Code as a one-shot command, or a local model through Ollama, each posting as `<connection> by <owner>` on a token the server makes for the run.
- **Tasks as buttons.** A task is a record you edit: what the prompt packages (the Readme, the documents, the plan, the waiting threads, the folder), what the run may write (nothing, Consensus, or files) and what it is asked. Answer, Enhance (a plan from a sketch and your instructions), Work and Session are shipped; a project enables the ones it uses; one button each runs it and keeps the log.
- **Tools for local models.** A local model gets file tools over the project's folder, held to its Include and Exclude lists, and Consensus tools for reading plans, replying and applying, each set held to the task's Writes.
- **Packaging you control.** Choose which documents and threads a connection leaves out, give it a prompt of its own, and preview any task's package with its token estimate before it runs.
- **Nothing committed on its own.** No run branches, commits or pushes; Git stays the owner's.

## Running it

- **The browser.** A small Node and Express server and one page; start it and open it. See [Getting started](getting-started.html).
- **The desktop.** The same page in its own window, with a server of its own inside, every saved server beside it, each a root of the tree.
- **Open a folder.** Start Consensus on one project folder from the command line, the way an editor opens a folder, and its `.consensus` is made for you.
- **Docker.** One image, one volume, port 3500, for a box on your network.
- **Scope.** The server listens for this machine only, for the network, or not at all, as the settings say.
- **Live updates.** Every change is a Server-Sent Event, so every open page, window and server row stays in step.
- **Settings in the app.** Name, scope, port, states, the owner's display and the Clerk keys of a Public server, edited in a popup by the owner. See [Settings and themes](settings.html).
- **Themes and scale.** System, light, dark and seven more palettes, and three text sizes, remembered per server.

## The API

- **Everything over one REST API.** Projects, plans, threads, revisions, runs and settings, the same routes the page uses. See [The API](api.html).
- **Roles.** Owner, member and llm, each with what it may do; a token names a participant from outside.
- **Events.** A stream of what changed, for anything that wants to follow along.
- **MIT licensed.** The code is public and free to use, change and run anywhere.
