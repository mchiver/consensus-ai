# Build

The build job: a worker implements a whole plan in the project's workspace, runs its tests, and reports with a build log (plan Workers). It does what the agent session does in the build loop today, from a button.

The worker does nothing with git on its own: no branches, no worktrees, no commits. A build changes the files in the workspace as they are, on whatever the owner has checked out. The owner handles git outside Consensus, or with the Commit and Push buttons on the worker's page.

## The Build button

- **Build** on the plan page queues a build job. It is enabled when every thread in the plan is applied (the build's own threads aside: its build log and the threads it opened), the project's workspace is on an online worker, and no build of the plan is running.
- Its dialog picks the worker's inference item and model. Only claude-cli builds: the dialog lists a worker's claude-cli items, and Ollama builds wait for a later plan.
- Consensus sets the plan's state to Working when the job is queued.

## Workspace settings for Build

A workspace that builds names what a build may run, and where Push sends:

```
{ "Kind": "Workspace", "Name": "Consensus", "Root": "W:/code-projects/orgs/mchiver/consensus.git",
  "Build": { "Remote": "origin", "Commands": [ "npm test", "node --test" ] } }
```

- **Commands:** the only shell commands the build may run.
- **Remote:** where Push sends the checked-out branch.

## A build

1. The worker runs the model in the workspace's Root. The prompt holds the plan, its parent plans, the project's context, and the build rules: implement what the plan says and only that, run the tests, answer with the build log.
2. **claude-cli:** `claude -p` in the workspace's Root with `--tools "Read,Grep,Glob,Edit,Write,Bash"`, `--allowedTools` for Edit, Write and `Bash(<command>:*)` for each of Commands, `--output-format stream-json`, `--json-schema` for the answer, the plan tools' MCP server as in a review, and `--max-turns` and TimeoutSeconds as limits.
3. The answer: `{ "BuildLog": "<markdown>", "Context": "<the project's context, updated for what was built>", "Threads": [ { "Text": "<the comment>", "Anchor": "<a passage, as it reads>" } ] }`.

## Threads from a build

A build may open threads on the plan it builds, as a review's `thread` action does (plan Review): a question the plan left open, the reading it took of an unclear passage, or a point it did not build. They are opened as contested threads by the `llm` participant when the build log is posted, and the build log lists them. A build creates no plans.

## The build log is the receipt

Consensus posts the build log as one contested whole-document thread on the plan, as the build loop does today. It is the build job's receipt: the job's id, the worker, the workspace, the model, what was built and where (the files it changed, as the model reports them), and how it was checked (the commands run and their results).

- **Accepted** (the owner resolves the build log): Consensus applies it (outcome only, no text change), carries out the Context the answer held, and sets the plan Finished. The worker's page marks the build accepted and enables Commit.
- **Sent back** (the owner replies to the build log): Build on the plan runs again in the workspace, with the reply in its prompt, and the worker replies on the same thread with the new result.

## Commit and Push

Buttons on the worker's page, on an accepted build, pressed by the owner; each is queued and run in order. Nothing reaches git any other way:

- **Commit:** one commit of the workspace's changes on the checked-out branch, titled after the plan, with a summary of the build log, no attribution trailers.
- **Push:** pushes the checked-out branch to Remote.

Each step's result is a run-log step on the plan ("Committed 1a2b3c4", "Pushed master to origin").

## Tests

`node --test`: a build job against a scratch git repository with a fake caller (the files changed in place, no branch made, the answer posted as a contested build log); accept and send back; Commit and Push (to a local bare repository); a command outside Commands refused; the Build button's enabled rules in `test/Ui.test.js`.
