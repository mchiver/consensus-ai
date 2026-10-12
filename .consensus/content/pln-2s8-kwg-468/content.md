# Review

The review job: a turn on a plan's threads, run by a worker in the project's workspace (plan Workers). It reads the code and never changes it. It is what Send to LLM does today, with tools instead of Requests, and it may create threads, plans and Subplans.

## The Review buttons

- **Review on the plan** replaces Send to LLM, on the plan page and in its dialog. The dialog is the same: destinations, prompt options (which threads: waiting, open, all), Manual (copy and paste). It reviews the threads the dialog chose, in one job.
- **Review on a thread**, in each thread's actions menu, opens the same dialog for that thread alone. The prompt still carries the whole plan, but only that thread is the model's to act on.
- A worker's destination queues a review job. Any other destination (a model Consensus calls itself, or Manual) runs as a session does today, with Requests.

## A review turn

1. Consensus packs the prompt as today (rules, context, proposal, the chosen threads, plan search hits) and queues a job: the prompt, the answer's schema, the workspace, the inference item and model.
2. The worker takes the job and runs the model in the workspace, with the tools below, until it gives its answer or reaches MaxRounds or TimeoutSeconds.
3. The answer is the same JSON as today (reply, apply, context), with two more actions (below), and Consensus carries it out through the same rules. A review has no Requests: the tools replace them.

## What a review may create

- **thread** `{ "Kind": "thread", "Text": "<the comment>", "Anchor": "<a passage, as it reads>" }`: a new contested thread on the reviewed plan by the `llm` participant; no Anchor for the whole document. An Anchor not found is refused, as an apply's is.
- **plan** `{ "Kind": "plan", "Title": "<title>", "Text": "<markdown>", "Parent": "<a folder's name, or a plan's title or id>" }`: a new plan in the project, in state Proposal. A plan as Parent makes it a Subplan; no Parent puts it in the reviewed plan's folder. A Parent not in the project is refused.
- Both go through the same rules as the API's new thread and new plan, and each is a run-log step and a line on the worker's page.
- The prompt's rules: open a thread only for a point no existing thread covers; create a plan or Subplan only when a thread asks for one or a point is large enough to stand alone, written as Drafting a plan says (decided defaults as statements, threads for real questions).
- These actions are in the answer's schema, so every destination has them, not only workers. There is no `state` action: states stay the owner's.

## Tools

File tools, read-only, within the workspace's Root and its Include and Exclude:

- **glob** `{ Pattern }`: the paths that match.
- **grep** `{ Pattern, Glob?, IgnoreCase? }`: matching lines with their paths and line numbers.
- **read** `{ Path, Offset?, Limit? }`: a file's lines, numbered.

Plan tools, answered by Consensus: list_project, read_plan, read_revision, search.

- **claude-cli:** `claude -p` in the workspace's Root with `--tools "Read,Grep,Glob"`, `--output-format stream-json` (each tool call becomes a run step and a line on the worker's page), `--json-schema` for the answer, `--max-turns` from MaxRounds, and `--strict-mcp-config --mcp-config` naming the plan tools' MCP server: `node bin/worker.js --mcp`, a small stdio JSON-RPC server (initialize, tools/list, tools/call) written without a dependency, which passes each call to the tool route.
- **ollama:** the worker runs the loop itself through `/api/chat` with `tools`: glob, grep, read and the plan tools. After MaxRounds, or when the model stops calling tools, it asks once more with `format` set to the answer's schema.
- No shell, no git, no writing, no web.

## Tests

`node --test`: a review job from queue to carried-out answer, with a fake caller; a review of one thread; the thread and plan actions (a Subplan, a folder, a Parent not in the project refused, an Anchor not found refused); the Ollama loop against a fake Ollama; glob, grep and read refusing paths outside Root or left out by Exclude and .gitignore; both Review buttons and the dialog in `test/Ui.test.js`.
