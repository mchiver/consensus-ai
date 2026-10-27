# Build with Consensus Sidecar

Use Consensus to construct documents and plans with your user. Consensus is where you work them out together,
thread by thread: your user writes, comments and resolves; you reply, apply what they resolve, draft plans, and
build what the plans say in your own repo. What you contribute goes into Consensus through its API; the chat
carries short summaries and the questions that need an answer before you act.

This is **Consensus Sidecar**: one window over one local project folder, one person (your user), and you, the
agent session (Claude Code or similar) open beside it, prompted with "check consensus" or "your turn". The server
inside the window, the **sidecar**, is that project's API and MCP on this machine. Your user connects you by
pasting these instructions into the session: **This server**, at the top, gives the address. There is no sign-in
and no token; the server calls no LLM and reads no code: you take part through the API. Read this page with `curl`
(`curl -s http://127.0.0.1:<port>/instructions`): a session's web fetch tool may not reach a local address. When
Sidecar is restarted, the folder keeps its port, so the address holds; if it no longer answers, ask your user to
paste the instructions again.

## Who does what

- **You**, the agent session: read and write the codebase, and work in Consensus through its API. You keep the
  project's Readme, reply and apply, draft plans, and implement plans when asked to.
- **The API, never the files.** The project's `.consensus` folder sits in the repository you work in; it is
  Sidecar's. Never write a plan, a thread or a revision there by hand: every change goes through the API, which
  keeps the revisions, applies the rules and tells the open window. Read it only when your user asks.
- **Sidecar is your user's to run.** Take your turn over the server that answers. When none does, say so and
  ask; do not start one over the project yourself.
- **Your user** writes, comments, resolves, and says when a plan is to be built. Git is theirs: you commit only as
  the build loop says, and never branch or push on your own.
- **The rules**: a thread is resolved by your user, with no vote; you apply a resolved one for them. A contested
  thread waits on whoever did not speak last, your user or you; a resolved one waits on you alone. The plan's
  State is your user's to say.
- You act for your user, never as a user of your own. Say who you are with the header
  `X-Consensus-Service: <your name>` on every request (letters, digits, dot, dash and colon; "Claude-CLI" for a
  Claude Code session), so that what you post reads "<your name> by <your user>"; and say which model you are in
  each build log.

## Talking to Consensus

- The API's address is in **This server**, at the top of this page. A request with no token is your user.
- Everything goes through the API. The API keeps the queues, revisions and anchors right.
- **Calling the API:** plain HTTP requests (`curl` or any client) to the address in This server, each with the
  header `X-Consensus-Service: <your name>` and, for a body, `Content-Type: application/json`. For example, what
  waits on you, then a reply on a thread:

  ```
  curl -s -H "X-Consensus-Service: Claude-CLI" http://127.0.0.1:<port>/api/waiting

  curl -s -X POST -H "X-Consensus-Service: Claude-CLI" -H "Content-Type: application/json" \
    -d '{ "Text": "Agreed; the wording I will apply: ..." }' \
    http://127.0.0.1:<port>/api/plans/<plan id>/threads/<thread id>/replies
  ```

- The useful routes (`plans` in a path is the API's name for plans and documents alike; in the app a plan
  starts as a Draft, and "plan" is not a word of its own):
  - `GET /api/waiting`: the threads waiting on you, across plans and documents.
  - `GET /api/projects`: the project with its tree (folders, plans with their states, documents), the id of its
    Readme (`Context`) and of its Context folder (`ContextFolder`).
  - `GET /api/plans/<id>`: text, revision, threads, project; `Context: true` for the project's Readme.
  - `POST /api/plans` `{ Title, Text, Project, Parent?, Kind? }`: a new plan (Parent: a folder's or a plan's
    id), or a document (`Kind: "document"`; it goes in the project's Context folder).
  - `POST /api/plans/<id>/threads` `{ Text, Anchor?: { Text } }`: a new thread (no Anchor: the whole document).
  - `POST /api/plans/<id>/threads/<tid>/replies` `{ Text }`
  - `POST /api/plans/<id>/threads/<tid>/apply` `{ Outcome, Revision, Text?, Anchor?: { Text } }`
  - `POST /api/plans/<id>/threads/<tid>/anchor` `{ Anchor: { Text } }`: re-anchor a thread.
  - `PUT /api/plans/<id>/state` `{ State }`
  - `PUT /api/plans/<id>/text` `{ Text, Revision }`: an edit, for example to the project's Readme.
  - `GET /api/plans/<id>/report.md`: the plan, its Subplans and all their threads flattened into one markdown
    document (every reply with who and when, the resolve and apply records); `/report` is the same as a page for
    printing.
- An anchor's `Text` is matched against the text as it reads, without markdown marks: no backticks or asterisks.

## Through MCP

The same operations are tools over the Model Context Protocol, for a client that speaks it (Claude Code with an
MCP server configured, Codex, Cursor, Claude Desktop) in place of curl. Nothing else changes: a tool is an
operation of the API under the same name (`waiting`, `read_plan`, `reply`, `apply`, `write_text`, `thread`,
`set_state`, `create_plan` and the rest, every route of this page among them), performed as your user, posting with
the same byline; `tools/list` describes each with its arguments, and `instructions` is this page. Two transports,
both at the address in This server:

- **HTTP**: `POST http://127.0.0.1:<port>/api/mcp`, a JSON-RPC message in the body, with the same header a curl
  request carries.
- **stdio**, through the relay in a Consensus checkout: `node <checkout>/bin/mcp.js --server
  http://127.0.0.1:<port> --service <your name>`. For Claude Code: `claude mcp add consensus -- node
  <checkout>/bin/mcp.js --server http://127.0.0.1:<port> --service Claude-CLI`.

Your user's words mean the same over MCP, and the turn and the build loop go the same way.

## Your project

The sidecar serves one project, named in This server: it is yours, and the only one there. Give it where an
operation takes a Project.

## Loading your context

"Load your context": read the project's Readme (its `Context` id) and the other documents of its Context folder,
its tree of plans with their states, and what waits on you; report it in a few lines.

## What your user's words mean

- "check consensus", "check again": report what changed and what waits on you, and act on nothing.
- "your turn": act on everything waiting on you (below).
- "build it", "implement it": the build loop (below), for the plan named or just discussed.
- A message holding any question is answered only; its instructions wait for a message with no question.

## "Your turn in Consensus"

You take it for your user, as their byline.

1. Find what waits on you (`GET /api/waiting`): the contested threads whose last word is not yours, and the
   resolved ones to apply.
2. Resolved threads: apply each one, one revision each. What resolving means:
   - **Reply and resolve** (your user's own reply is last): that reply is the outcome, read as the answer to the
     question before it. Apply it directly; no confirming round.
   - **Resolve with no reply:** your user accepts the outcome, or the recommendation, in the last reply. Apply
     it, and say in the Outcome that the recommendation went in.
   - **Comment and resolve** (a new thread, resolved as it was posted): the comment is the outcome.
3. Contested threads your user answered: reply. Confirm what you understood and give the wording you will apply;
   ask any follow-up with a recommendation. A reply hands the thread back to your user.
4. After changing the text, check for detached threads and re-anchor them.
5. Put comments and questions in Consensus as anchored threads, not in the chat; the chat gets a summary.

## Drafting a plan

Decided defaults go into the text as statements; open threads only for real questions. **One thread per
question**, anchored at the passage it is about, each with your recommendation: a thread is settled in one place,
and Consensus exists to break a large matter into pieces small enough to settle one at a time. Never bundle the
decisions of a plan, or of a step, into one thread with a numbered list; seven questions are seven threads, each
resolved, answered or left on its own. A request to rework a document is answered with a reply holding the exact
new text, applied once your user resolves it.

## The build loop

1. **Ready?** Every thread in the plan is resolved and applied. If any is not, list the open threads in the
   chat and stop. Post nothing in Consensus.
2. **Start.** When your user says to implement the plan, set its state to Working.
3. **Implement** what the plan says, and only that. Run the tests.
4. **Report.** Post one contested whole-document thread on the plan: the build log. Say what was built,
   where (files), how it was checked (tests), and which model built it.
5. **Accepted** (your user resolved the build log):
   - apply the build log thread, outcome only, no text change;
   - commit the work in your own repo: one commit titled after the plan, with a summary of the build log, no
     attribution trailers;
   - set the plan's state to Finished;
   - bring the project's Readme up to date with what changed.
6. **Sent back** (your user replied to the build log instead): fix what the reply asks, run the tests, and reply
   on the same thread with the new result. Nothing is committed until it is accepted.

## Starting a project from a codebase

Write the project's Readme yourself (`PUT /api/plans/<context id>/text`), from the codebase you can read: what the
project is, where things live, the conventions, and what has been decided. After that, plans are drafted and
discussed in threads as usual.
