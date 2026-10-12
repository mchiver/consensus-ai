# Step 3: Local LLMs and Workspaces

Subplan of Consensus Desktop. LLM connections and workspaces come back, in the desktop application: a project's `Context` folder shows any number of LLM connections and workspaces, as items of the project tree rather than functions of a plan. Step 3 adds nothing to the server: the page in `public/` stays frozen, and the desktop's version goes to 0.3.0.


## Items in the Context folder

- An **LLM connection** is kept once in the desktop's configuration (desktop.json) and shown in the Context folder of every project. Opened from a project, it packages only that project: its Readme and documents, its plans and the threads waiting on it there.
- A **workspace** is a path to a folder, saved in the desktop's configuration with the project it is attached to, so a project shows only its own. The folder may be empty or full; where it came from and where it is going are no concern of Consensus.
- Each opens in a tab of its own, like a plan: a form with its details, the buttons, and its log; it has no text, revisions or threads, and nothing of it is on the server. A row's actions menu holds Open, Rename and Delete; a new one comes from the Context folder's menu (New LLM connection, New workspace).


## LLM page

- **Details**: Name; Kind, `claude-cli` (a command run without a shell, default `claude`) or `ollama` (a Url, default `http://127.0.0.1:11434`, and a Model); Model, optional for claude-cli, required for ollama; Timeout in seconds, default 300; a **Check** button that runs the command or asks the Url for its models. The connection posts as the `llm` participant with the token the connected server serves at /instructions; no token is entered.
- **Packaging**: the items checked go into the one-shot prompt. The desktop builds one prompt as text from the checked items, in this order, each under a heading; the checks are remembered per connection. **Show prompt** opens the packaged text in the log before anything is sent; **Copy** puts it on the clipboard, for a chat.
    - Agent Instructions: the connected server's /instructions page (the guide, with the server's address and token first).
    - Readme: the project's Readme, whole.
    - List of other Context documents: their titles and ids, for the model to read through the API.
    - List of "waiting on llm" threads: from /api/waiting, the threads of the plan at hand, each with its anchor and replies.
    - Review Prompt: take the llm's turn on the plan at hand: read the waiting threads, reply, apply what is resolved, through the API.
    - Build Prompt: build the plan at hand in the workspace, the build loop of the agent guide up to the build log posted as a thread; no git on its own.
    - Session Prompt: appended at the end of every package, after the Review or Build prompt, for further context or instructions.
- The three prompts are editable texts with defaults the desktop ships, kept per connection.
- **Review**, **Build** and **Session** buttons: each packages its one-shot prompt and runs it. Review carries the Review Prompt, Build the Build Prompt, and Session the checked items and the Session Prompt alone, an interactive session when much or all of the context is unchecked. They act on the plan selected in the tree, and carry a workspace (asked for when the project has more than one): the command runs in the workspace's folder, so the model can list, search and read its files for a Review as for a Build. With no workspace, Review and Session run in no folder and Build is not offered.
- **Log**: one record per run, a file in the desktop's configuration folder (`runs/<id>.json`): when, which button, the plan, the workspace, the packaged prompt, the output, the exit status and the duration. The page lists the connection's runs newest first and opens one to read its prompt and output. One run at a time per connection, a **Stop** button while it runs, and "running since" in the row.


## Running a one-shot

- A `claude-cli` one-shot: the command runs once with the package on its standard input, and the model works through the API itself, with the token in the package, as the agent session does today. The desktop runs it, keeps its output in the log, and refreshes the tree when it ends; nothing is parsed.
- The desktop never commits, branches or pushes; git is the owner's.
- `ollama`, with the desktop's tool loop and file tools, is its own Subplan after this one (Step 4: Local Models). The Kind stays in the LLM details so a connection can be entered and Check works, but its buttons say "Step 4" until then.


## Workspace page

- **Details**: Name; Path, a folder picked with the folder picker; Include and Exclude patterns (Include empty means everything; Exclude defaults to `~*/**`, `node_modules/**` and `.git/**`). The patterns are for the file tools of Step 4; in Step 3 the Path is what a one-shot runs in.
