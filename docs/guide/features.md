# Features

## Plans and threads

- **Plans with threads.** A plan is a markdown document with a conversation beside it. Each thread is one question, settled in one place. See [Threads](threads.html).
- **Anchored comments.** Select a passage and comment on it; the thread is tied to those words, highlighted in the text, and follows them as the text changes.
- **Three thread states.** Contested while it is discussed, resolved when its starter or an Owner settles it, applied when the LLM has changed the text. The colour of the passage says which.
- **Reply and resolve.** You settle a thread with a reply that becomes the outcome, or resolve it with no reply to accept the last recommendation.
- **Reopening.** Any reply to a settled thread reopens it, marked as such, without undoing what was applied.
- **Whose turn.** Every thread knows who it waits on: its parties, minus whoever spoke last, so a reply or a resolve takes it off your list. The tree, the title bar and the threads pane count what waits on you; **Waiting on you** lists it across every project.
- **Rules for a team.** The same consensus among many people: the starter or an Owner resolves, no vote; anyone with write access applies; the plan's State is an Owner's; one run per plan at a time. See [Threads](threads.html#who-does-what-in-a-team).
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
- **Hotkeys.** One table of keys, listed under Menu, for saving, switching views, commenting, moving between tabs and panes, and closing a tab or a popup; the editor's own for bold, italic and scrolling a line.

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
- **Sidecar mode.** Point Claude Code or any agent at one address, `/instructions`, and it learns the rules, finds what waits on it, replies, applies and drafts plans: an open LLM session beside an open Consensus, prompted with "check consensus" or "your turn" instead of the buttons, with every tool and all the context its harness keeps, on one project at a time. See [Ways of working](ways-of-working.html#sidecar-mode-the-agent-session).
- **MCP.** Every operation of the API as a tool over the Model Context Protocol, in the server at `POST /api/mcp` and as a stdio relay for Claude Code, Cursor, Codex and Claude Desktop, with the same rules, roles and bylines as a request, and no library. One fixed entry per project, `consensus mcp <folder>`, over a folder's one-project server (`consensus <folder>`), which keeps its address in the folder while the project is open; the Sidecar app's address is in its LLM Instructions. See [Working with an LLM](llm.html#through-mcp).- **Your turn in Consensus.** The working loop: the owner comments and resolves, the agent replies and applies, in the plan, not in a chat scroll. See [Ways of working](ways-of-working.html).
- **The build loop.** When every thread is applied, the agent builds exactly that plan and posts its build log as a thread, accepted the same way.
- **LLM connections.** The server runs LLMs for you through their APIs: Claude, ChatGPT, Gemini, Grok, any other service that speaks OpenAI's chat completions, or a local model through Ollama, each posting as `<connection> by <person>`. Check asks the service for its models and says whether the Key is good; the Key stays in the server's settings and is never shown again. See [Working with an LLM](llm.html#connections-and-runs).
- **Tasks as buttons.** A task is a record you edit: what the prompt packages (the Readme, the documents, the plan, the waiting threads, the folder), what the run may write (nothing, Consensus, or files) and what it is asked. Answer, Enhance (a plan from a sketch and your instructions), Work, Explain (a conversation with the project in its own tab: your question, a read-only run, its answer) and Session are shipped; a project enables the ones it uses; one button each on the LLM page, and on a plan's heading for the tasks that take the plan, through the connection the project chose; the LLM page keeps the log. See [Ways of working](ways-of-working.html).
- **Tool calls, never tokens.** Every run gets file tools over the project's folder, held to its Include and Exclude lists, and Consensus tools for reading plans, replying and applying, each set held to the task's Writes. The server carries out every call itself, as the person who pressed, so no token reaches a model, a prompt or a run's record.
- **Packaging you control.** Choose which documents and threads a connection leaves out, give it a prompt of its own, and preview any task's package with its token estimate before it runs.
- **Nothing committed on its own.** No run branches, commits or pushes; Git stays the owner's. The two Work options a project may switch on are the owner's too: Auto-commit commits the build log you resolve, Git sync pulls before the run and pushes after the commit.

## Running it

- **Four applications.** Consensus Sidecar opens one local folder, for you and your agent; Consensus Client one project on one Server; Consensus Desktop several projects at a time from one or more Servers; Consensus Server local folders served to the others, for several people; installed and started apart, sharing the page. See [Getting started](getting-started.html).
- **Consensus Sidecar.** One window over one local folder, its own process, with no Server, sign-in, license, users, LLM connections or tasks: your agent session works beside it through the API or MCP, connected by the project's LLM Instructions pasted into it. The port comes from the folder (52000 to 52999), so the address holds between starts; your name, the look and the view are kept with the project in `.consensus/sidecar.json`. See [Consensus Sidecar](sidecar.html).
- **Consensus Client.** One project on one Server per window, picked in the chooser (the saved Servers, each with its last project, and Connect to Server) or named on the command line (`--connect <server> [<project>]`); the Server signs you in on its page, any account will do, and the sign-in is kept as this machine's signed-in person. No local folder and no server of its own. Settings in `client.json`. See [Consensus Client](client.html).
- **Consensus Desktop.** Projects on one or more Servers in one window, each Server a root of the tree: one Clerk sign-in sent to every Server, which decides by your roles; Servers added by address, renamed and removed; never a local folder, and no configuration, which stays with each Server's Administrator and Managers. A Server's LLM tasks run on the Server, followed from the press: the button's state, the run's output as it comes, a notice when it ends, and My runs across every Server. Settings in `desktop.json`. See [Getting started](getting-started.html#the-desktop).
- **The Server.** One server for a team: a registry of projects, each mounted for its accounts or kept to the Administrator and the Managers, the users, roles, connections and tasks managed on its page; a window of its own with a tray icon, one per machine, or headless as `consensus-server --headless` and `consensus serve`; **Open in Consensus Server** on a folder's right-click menu. See [The Server](server.html).
- **Open a folder.** Start the Sidecar, or `consensus <folder>`, on one project folder from the command line, the way an editor opens a folder, and its `.consensus` is made for you.
- **Four tiers.** Unlicensed is the Sidecar; Registered, free, the Client; Personal the Desktop and the Server on this machine; Professional the Server on the network. See [the licenses](../pricing.html).
- **Docker.** One image, one volume, port 3500, for a box on your network.
- **Scope.** The server listens for this machine only, for the network, or not at all, as the settings say; a Server signs people in either way.
- **Live updates.** Every change is a Server-Sent Event, so every open page, window and server row stays in step.
- **Settings in the app.** Name, scope, port, states, the owner's display, the tasks and the Server's look, edited in a popup by the Administrator and the Managers; Public is offered to a sign-in with a Professional license. A project's own settings (its name, states, lists, Work options, and in the Sidecar its look) open from its menu. See [Settings and themes](settings.html).
- **Themes, scale and margins.** System, light, dark and seven more palettes and three text sizes, yours in the browser; the width the text is held to and the rest of the look kept with the project in the Sidecar, and with the Server on a Server.

## The API

- **Everything over one REST API.** Projects, plans, threads, revisions, runs and settings, the same routes the page uses. See [The API](api.html).
- **Users and roles.** The accounts of a Server (the Administrator, the Managers the Administrator chooses, the users, the Service accounts), each with its page, its tokens made and revoked there, and its activity; a project's Users folder with Owners, Members, Service and Watchers, filled by drag; every request checked against the role, with the reason when refused. See [Sharing a server](sharing.html).
- **Sign in through Consensus-AI.** A Server signs people in through Consensus-AI's Clerk instance, on this machine and on the network, in its window, in the browser, in the Client and in the Desktop alike, with no password of its own and nothing to configure; a first sign-in writes the account to the registry from the token, and Consensus holds the roles. See [Sharing a server](sharing.html).
- **Licenses for people, not servers.** Four tiers: Unlicensed is the Sidecar; Registered, free, the Client, which any sign-in is; Personal the Desktop, which checks the plan at its sign-in (below it, the sign-in box says so and opens nothing), and the Server on this machine, whose Administrator it makes; Professional binds the Server to the network. No project role needs a license: a Server runs under its Administrator's. A site license is an organization whose members carry it. The Server checks the Administrator's plan at its start and at the Scope, and says which plan it wants; the signed-in person is kept on the machine for fourteen days without a check. **LLM session tokens:** a project's LLM Instructions mint a token for you into the text you copy. See [the licenses](../pricing.html).
- **Events.** A stream of what changed, for anything that wants to follow along.
- **MIT licensed.** The code is public and free to use, change and run anywhere.
