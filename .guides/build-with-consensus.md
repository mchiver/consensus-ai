# Build with Consensus

Use Consensus to construct documents and plans with your user. Consensus is where you work them out together,
thread by thread: the people write, comment and resolve; you reply, apply what they resolve, draft plans, and
build what the plans say in your own repo. On a personal server your user is the owner and the only person; on a
shared one the people are a project's Owners, Members, Service accounts and Watchers, and you act for one of
them: the one who runs your session or pressed the button (the plan Multiuser). What you contribute goes into
Consensus through its API; the chat carries short summaries and the questions that need an answer before you act.

For an agent session (Claude Code or similar) working on a repo whose plans live in Consensus: **sidecar mode**,
the session open beside an open Consensus, prompted with "check consensus" or "your turn" instead of the page's
task buttons, with every tool and all the context the session's harness keeps. Sidecar mode is one project's:
the plans are made in Consensus and carried out in the session, and the session works in that project alone, so
the server's other projects, each the business of a session of its own, are not yours. Read this with
`curl` (`curl -s http://<server>:<port>/instructions`): a session's web fetch tool may not reach a local or
private address. The plan "Build Workflow" in the Consensus project is where the build loop was agreed, and
"Agent Instructions" where this page was. Since the plan "Consensus Desktop" (Step 1), the server calls no LLM
and reads no code: every LLM takes part through the API, as you do. Consensus Desktop (Step 3) can run a model
once, with this page, the project's Readme and the plan at hand packaged as its prompt: such a one-shot works
exactly as a session does, through the API, and says in the package which plan, project and folder it is for.
A local model run by the desktop (Step 4) does not call the API itself: the desktop runs its tools, the
Consensus ones included, and gives it this page's rules in its own words.

## Who does what

- **Agent session, or a run** (you): reads and writes the codebase, and works in Consensus through its API. You
  keep the project's Readme, reply and apply, draft plans, and implement plans when asked to.
- **The API, never the files.** The project's `.consensus` folder may sit in the repository you work in; it is the
  server's. Never write a plan, a thread or a revision there by hand: every change goes through the API, which
  keeps the revisions, applies the rules and tells every open page. Read it only when the owner asks.
- **The server is the owner's to run.** Take your turn over the server that answers. When none does, say so
  and ask; do not start one over the project yourself.
- **The people**: write, comment, resolve, and an Owner says when a plan is to be built. Git is theirs: you
  commit only as the build loop says, and never branch or push on your own.
- **The rules among many** (the same on a personal server, where the owner is everyone): a thread is resolved
  by the one who started it or by an Owner of the project, with no vote; anyone with write access applies a
  resolved one, an Owner, a Member or a Service account, which is what you do for them; the plan's State is an
  Owner's; one run per plan at a time. A contested thread waits on its parties, the starter, the Owners,
  everyone who replied in it and the LLM, minus whoever spoke last; a resolved one waits on the LLM alone.
- Every LLM acts for a person, never as a user of its own: an agent session for the account whose server or
  token it uses, a run for the one who pressed the button. Say who you are with the header
  `X-Consensus-Service: <your name>` on every request (letters, digits, dot, dash and colon; "Claude-CLI" for a
  Claude Code session), so that what you post reads "<your name> by <the person>"; and say which model you are
  in each build log. This server, at the top of this page, says whom you act for and what their role allows.

## Talking to Consensus

- The API's address, and how this server knows you, are in **This server**, at the top of this page when the
  server serves it: on a local or trusted-network server a request with no token is the owner; a run the server
  started carries the token it was given.
- Everything goes through the API; you have no access to the server's files. The API keeps the queues,
  revisions and anchors right.
- **Calling the API:** plain HTTP requests (`curl` or any client) to the address in This server, each with the
  header `X-Consensus-Service: <your name>` (and `Authorization: Bearer <token>` when This server gave you a token)
  and, for a body, `Content-Type: application/json`. For example, what waits on you, then a reply on a thread:

  ```
  curl -s -H "X-Consensus-Service: Claude-CLI" http://<server>:<port>/api/waiting

  curl -s -X POST -H "X-Consensus-Service: Claude-CLI" -H "Content-Type: application/json" \
    -d '{ "Text": "Agreed; the wording I will apply: ..." }' \
    http://<server>:<port>/api/plans/<plan id>/threads/<thread id>/replies
  ```

- The useful routes (`plans` in a path is the API's name for plans and documents alike; in the app a plan
  starts as a Draft, and "plan" is not a word of its own):
  - `GET /api/waiting`: the threads waiting on you, across plans and documents.
  - `GET /api/projects`: every project with its tree (folders, plans with their states, documents), the id of
    its Readme (`Context`) and of its Context folder (`ContextFolder`).
  - `POST /api/projects` `{ Name }`: a new project.
  - `GET /api/plans/<id>`: text, revision, threads, project; `Context: true` for a project's Readme.
  - `POST /api/plans` `{ Title, Text, Project, Parent?, Kind? }`: a new plan (Parent: a folder's or a plan's
    id), or a document (`Kind: "document"`; it goes in the project's Context folder).
  - `POST /api/plans/<id>/threads` `{ Text, Anchor?: { Text } }`: a new thread (no Anchor: the whole document).
  - `POST /api/plans/<id>/threads/<tid>/replies` `{ Text }`
  - `POST /api/plans/<id>/threads/<tid>/apply` `{ Outcome, Revision, Text?, Anchor?: { Text } }`
  - `POST /api/plans/<id>/threads/<tid>/anchor` `{ Anchor: { Text } }`: re-anchor a thread.
  - `PUT /api/plans/<id>/state` `{ State }`
  - `PUT /api/plans/<id>/text` `{ Text, Revision }`: an edit, for example to a project's Readme.
  - `GET /api/plans/<id>/report.md`: the plan, its Subplans and all their threads flattened into one markdown
    document (every reply with who and when, the resolve and apply records); `/report` is the same as a page for
    printing.
- An anchor's `Text` is matched against the text as it reads, without markdown marks: no backticks or asterisks.

## Through MCP

The same operations are tools over the Model Context Protocol, for a client that speaks it (Claude Code with an
MCP server configured, Codex, Cursor, Claude Desktop) in place of curl. Nothing else changes: a tool is an
operation of the API under the same name (`waiting`, `read_plan`, `reply`, `apply`, `write_text`, `thread`,
`set_state`, `create_plan` and the rest, every route of this page among them), performed as the person you act
for, checked against their role as a request is, posting with the same byline; `tools/list` describes each with
its arguments, and `instructions` is this page. A project is given by its id or its name. Two transports:

- **stdio**, on your machine: `node <checkout>/bin/mcp.js --server http://<server>:<port> --service <your name>`
  (`--token <token>` on a shared server; `--server <name>` a saved server of the global config; `--project <id or
  name>` fills in the project for the tools that take one, which is how the one-project rule is set for a
  client). For Claude Code: `claude mcp add consensus -- node <checkout>/bin/mcp.js --server
  http://127.0.0.1:3500 --service Claude-CLI --project <your project>`.
- **HTTP**: `POST http://<server>:<port>/api/mcp`, a JSON-RPC message in the body, with the same header a curl
  request carries.

Your user's words mean the same over MCP, the turn and the build loop go the same way, and a thread in another
project is still another session's.

## Finding your project
List the projects (`GET /api/projects`); the one named after your repo is yours. If none or more than one fits,
ask the owner, and remember the answer for the session. Your session is that project's: a thread in another
project on the same server is another session's, and you leave it alone even when the waiting route lists it.

## Loading your context

"Load your context": read your project's Readme (its `Context` id) and the other documents of its
Context folder, its tree of plans with their states, and what waits on you; report it in a few lines.

## What your user's words mean

- "check consensus", "check again": report what changed and what waits on you in your project, and act on
  nothing.
- "your turn": act on everything waiting on you in your project (below). The Answer task of the page is the same turn, taken
  for the one who pressed it.
- "build it", "implement it": the build loop (below), for the plan named or just discussed.
- A message holding any question is answered only; its instructions wait for a message with no question.

## "Your turn in Consensus"

You take it for the person you act for, as their byline: the one whose session this is, or who pressed Answer.
What you post is theirs, within what their role allows (an Owner or a Member applies; a Watcher's Explain reads
only, and so do you then).

1. Find what waits on you (`GET /api/waiting`, which lists every project on the server: keep your own project's):
   the contested threads whose last word is not yours, and the resolved ones to apply.
2. Resolved threads: apply each one, one revision each. What resolving means:
   - **Reply and resolve** (the resolver's own reply is last): that reply is the outcome, read as the answer to
     the question before it. Apply it directly; no confirming round.
   - **Resolve with no reply:** the resolver accepts the outcome, or the recommendation, in the last reply.
     Apply it, and say in the Outcome that the recommendation went in.
   - **Comment and resolve** (a new thread, resolved as it was posted): the comment is the outcome.
   - Whoever resolved it, the starter or an Owner, the outcome is the thread's; apply it as the person you act
     for, who has write access.
3. Contested threads someone answered: reply. Confirm what you understood and give the wording you will
   apply; ask any follow-up with a recommendation. A thread waits on its parties, so a reply hands it to them.
4. After changing the text, check for detached threads and re-anchor them.
5. Put comments and questions in Consensus as anchored threads, not in the chat; the chat gets a summary.

## Drafting a plan

Decided defaults go into the text as statements; open threads only for real questions. **One thread per
question**, anchored at the passage it is about, each with your recommendation: a thread is settled in one place,
and Consensus exists to break a large matter into pieces small enough to settle one at a time. Never bundle the
decisions of a plan, or of a step, into one thread with a numbered list; seven questions are seven threads, each
resolved, answered or left on its own. A request to rework a document is answered with a reply holding the exact
new text, applied once its starter or an Owner resolves it.

## The build loop

1. **Ready?** Every thread in the plan is resolved and applied. If any is not, list the open threads in the
   chat and stop. Post nothing in Consensus.
2. **Start.** When an Owner says to implement the plan, set its state to Working. The State is an Owner's: when
   you act for a Member (a Work run pressed by one), leave it and say so in the log.
3. **Implement** what the plan says, and only that. Run the tests.
4. **Report.** Post one contested whole-document thread on the plan: the build log. Say what was built,
   where (files), how it was checked (tests), and which model built it.
5. **Accepted** (the build log was resolved, by the one who pressed or an Owner):
   - apply the build log thread, outcome only, no text change;
   - commit the work in your own repo: one commit titled after the plan, with a summary of the build log, no
     attribution trailers;
   - set the plan's state to Finished;
   - bring the project's Readme up to date with what changed.
6. **Sent back** (someone replied to the build log instead): fix what the reply asks, run the tests, and
   reply on the same thread with the new result. Nothing is committed until it is accepted.

## Starting a project from a codebase

Create the project and write its Readme yourself (`PUT /api/plans/<context id>/text`), from the
codebase you can read: what the project is, where things live, the conventions, and what has been decided.
After that, plans are drafted and discussed in threads as usual.
