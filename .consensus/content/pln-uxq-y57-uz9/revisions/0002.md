# Step 4: Local Models

Subplan of Consensus Desktop. An `ollama` connection runs the Review, Build and Session one-shots that Step 3 left saying "Step 4". A local model has no tools of its own, so the desktop runs the tool loop: it sends the package to Ollama's chat endpoint with a set of tools, carries out each call the model makes (files of the workspace, the Consensus API of the connected server, the workspace's commands) and sends the result back, until the model answers. The `claude-cli` path of Step 3 is unchanged. Nothing is added to the server; the desktop's version goes to 0.4.0.


## What runs

- **Review**: the model takes the llm's turn on the plan at hand: it reads the plan and its waiting threads through the Consensus tools, reads the workspace's files when there is one, replies on the contested threads, applies the resolved ones one revision each, and re-anchors any thread left detached. Its tools are read-only on files.
- **Build**: the model builds the plan at hand in the workspace: it sets the plan Working, reads and edits the files, runs the workspace's commands (the tests), and posts the build log as one contested whole-document thread on the plan. The desktop never commits, branches or pushes; the model has no git tool.
- **Session**: the checked items and the Session Prompt alone, with every tool the picked workspace allows; without a workspace, the Consensus tools only.
- The buttons' rule stays as UI Tweaks IV has it, with "an ollama one-shot is Step 4" gone: a run going, no plan for Review and Build, no workspace for Build.


## Tools

Every tool is run by the desktop, in its own process, and a tool's result is data for the model, never instructions. The model sees the tools in Ollama's `tools` form (a name, a description, a JSON schema of its parameters).

**File tools**, over the picked workspace; a path outside the workspace's folder, or one its Include and Exclude patterns leave out, is refused with a sentence the model can read:

- `glob( Pattern )`: the workspace's paths that match a glob (`**` crosses folders), within its Include and Exclude, at most 500.
- `grep( Pattern, Glob?, IgnoreCase? )`: the lines of the workspace's files matching a regular expression, as `path:line: text`, at most 200 lines; files over 1 MB are skipped.
- `read( Path, Offset?, Limit? )`: a file's lines, numbered; 200 lines unless Limit says otherwise.
- `write( Path, Text )`: writes the file whole, making its folders. Build and Session only.
- `edit( Path, Old, New )`: replaces one occurrence of Old; refused when Old is not found or is found more than once. Build and Session only.
- `run( Command )`: runs one of the workspace's **Commands** (below) in the workspace's folder, without a shell, and returns its exit code and output, clipped to 20,000 characters, after at most 10 minutes. A command that is not on the list, exactly or with arguments after it, is refused. Build and Session only.

**Consensus tools**, over the connected server's API, within the project the connection was opened from, as the `llm` participant with the token the server serves at /instructions (the same token a claude-cli package carries; the token itself never enters a local model's prompt). Once User Management is built, the token goes and the connection carries a username and password of its own, registered by the Admin as any member, so what a model posts is attributed to it:

- `list_project()`: the project's tree: its folders, plans with their states and their threads' tally, and the Context folder's documents.
- `read_plan( Id )`: a plan's text at its current revision and its threads with their replies.
- `read_document( Id )`: a Context document's text.
- `waiting( Plan? )`: the threads waiting on the llm, of one plan or of the project.
- `reply( Thread, Text )`: a reply on a thread.
- `apply( Thread, Outcome, Text?, Anchor? )`: applies a resolved thread, with the new text of the plan when it changed; the desktop supplies the plan's current Revision.
- `thread( Plan, Text, Anchor? )`: a new thread, anchored to a passage or to the whole document.
- `set_state( Plan, State )`: Working, Finished, and the other states the server allows the llm.

The desktop builds the call from the model's arguments and reads the server's answer; an error from the server (a stale revision, an anchor not found) goes back to the model as the tool's result, so it can read again and retry.


## The connection and the workspace

- The LLM details gain, for `ollama`: **Context** (the model's context window in tokens, Ollama's `num_ctx`, default 32768) and **Rounds** (the most tool rounds a run may take, default 30). The Preview's estimated token count stands beside the Context so an oversized package is seen before it is sent.
- **Check** asks Ollama for the model's capabilities (`/api/show`) besides its models, and says whether the model calls tools; a model that does not is checked as a failure with that reason, and a run with it says the same.
- The workspace details gain **Commands**: the commands a run may execute, one per line (`npm test`, `node --test`), empty by default so a workspace allows nothing until the owner says. Nothing that chains, pipes, redirects or substitutes is allowed on the list or in a call, so a listed command cannot carry another one in.


## The package for a local model

The package is built as in Step 3, with one difference: the **Agent Instructions** item, which tells a tool-using agent how to call the API with the token, is replaced for an `ollama` run by the desktop's own instructions for its tools: what the tools are, the turn rules (reply on contested threads, apply resolved ones, one revision each, re-anchor), the build loop (Working, implement, run the commands, the build log thread, no git), and the demand for a short summary as the answer. The Readme, the documents list, the waiting threads and the three prompts go in as they do for claude-cli. Preview shows the package as it will be sent.


## The log

- A run's record is the one of Step 3, with **Rounds** taken and **Usage** (the prompt and answer tokens Ollama reports) added.
- The Output is the transcript as it grows: each round's text from the model, each tool call in a few words (`read desktop/Runs.js lines 1 to 200`, `grep "running\[" 4 matches`, `reply thr-… "…"`), each result clipped to a few hundred characters, and the model's final answer whole. The popup's Refresh shows it while the run goes, and the Source toggle the raw text.
- A run ends done when the model answers with no tool call, failed when Ollama refuses, the Timeout passes or the Rounds run out (the transcript says which), and stopped on Stop, which aborts the request in flight and runs no further tool.


## Code

- `desktop/Ollama.js`: `Run( { Llm, Prompt, Tools, Signal, OnProgress } )`, the loop over `/api/chat` with `tools`, `num_ctx` and `stream: false`; one request per round; the deadline from the connection's Timeout; returns `{ Answer, Rounds, Usage }`.
- `desktop/Tools.js`: `Tools( { Workspace, Server, Kind } )` → `{ Definitions, Call( Name, Arguments ) }`: the file tools over `Files.js` (the walk and the matcher it has, a `Within( Path )` check added), the command tool with the allowed-list check, and the Consensus tools over the server's API with `fetch`; which tools are offered depends on Kind and on whether there is a workspace. Pure of Electron, testable against a folder and a fake server.
- `desktop/Runs.js`: a run of an `ollama` connection goes through `Ollama.js` instead of a child process; the same record, Stop through an AbortController, Timeout as today.
- `desktop/Llm.js`: Check reads `/api/show` for the capabilities.
- `desktop/Settings.js`: `Context` and `Rounds` on an LLM connection, `Commands` on a workspace, with their defaults and problems.
- `desktop/main.js` and `Package.js`: the ollama instructions item in place of the agent instructions; the Consensus tools get the server's url and the token the desktop already reads from /instructions.
- `desktop/page/`: the two fields in the LLM details, Commands on the workspace page, the reasons without "Step 4", Rounds and Usage in the run popup.


## Tests

`node --test`, in `test/Desktop.test.js` and a new `test/Tools.test.js`:

- Tools: each file tool against a temporary workspace (a path outside, an excluded path, an edit with two matches, a write making folders), the command tool (a listed command, one with arguments, an unlisted one, a chained one), and the Consensus tools against a Consensus started in the test (list, read, waiting, reply, apply with a stale revision, thread, set_state).
- Ollama: a fake Ollama (an http server in the test) that answers a scripted sequence: a tool call, another, then an answer; the loop carries out the calls and returns the answer; Rounds exhausted, a refusal, a timeout and a Stop each end the run as the log says.
- Runs: an `ollama` connection's run writes the record with its transcript, Rounds and Usage.
- Settings: the new fields' defaults and problems; Check with a fake `/api/show`.
- A smoke of the desktop against the fake Ollama, with its own user-data folder, pressing Review on a plan with a waiting thread.


## Not in this step

- Streaming the model's words as they come; one request per round is enough for a log that refreshes.
- Models reached any other way than Ollama's chat endpoint (an OpenAI-style endpoint, LM Studio); a Kind for them is a later plan.
- A tool loop for `claude-cli`: claude has its own tools and the API, as in Step 3.
- git in any form on the desktop's own account.


## Done when

- The suite is green, the smoke passes.
- A Review and a Build over a local model, each tried by hand on cube4's Test project, with what the model did written in the build log.
- The readme's desktop section says how an ollama connection runs, and the version is 0.4.0.
