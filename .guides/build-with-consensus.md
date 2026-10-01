# Build with Consensus

Use Consensus to construct documents and plans with your user. Consensus is where the two of you work them out,
thread by thread: your user (the owner) writes, comments and resolves; you reply, apply what the owner resolves,
draft plans, and build what the plans say in your own repo. What you contribute goes into Consensus through its
API; the chat with the owner carries short summaries and the questions that need an answer before you act.

For an agent session (Claude Code or similar) working on a repo whose plans live in Consensus. Read this with
`curl` (`curl -s http://<server>:<port>/instructions`): a session's web fetch tool may not reach a local or
private address. The plan "Build Workflow" in the Consensus project is where the build loop was agreed, and
"Agent Instructions" where this page was. Since the plan "Consensus Desktop" (Step 1), the server calls no LLM
and reads no code: every LLM takes part through the API, as you do. Consensus Desktop (Step 3) can run a model
once, with this page, the project's Readme and the plan at hand packaged as its prompt: such a one-shot works
exactly as a session does, through the API, and says in the package which plan, project and folder it is for.

## Who does what

- **Agent session** (you): reads and writes the codebase, and works in Consensus through its API. You keep the
  project's Readme, reply and apply, draft plans, and implement plans when the owner asks you to.
- **The owner**: writes, comments, resolves, and says when a plan is to be built. Git is the owner's: you commit
  only as the build loop says, and never branch or push on your own.
- Every LLM posts as the one `llm` participant. Say which model you are in each build log.

## Talking to Consensus

- The API's address and the `llm` participant's token are in **This server**, at the top of this page when the
  server serves it.
- Everything goes through the API; you have no access to the server's files. The API keeps the queues,
  revisions and anchors right.
- **Calling the API:** plain HTTP requests (`curl` or any client) to the address in This server, each with the
  header `Authorization: Bearer <token>` and, for a body, `Content-Type: application/json`. For example, what
  waits on you, then a reply on a thread:

  ```
  curl -s -H "Authorization: Bearer <token>" http://<server>:<port>/api/waiting

  curl -s -X POST -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
    -d '{ "Text": "Agreed; the wording I will apply: ..." }' \
    http://<server>:<port>/api/proposals/<plan id>/threads/<thread id>/replies
  ```

- The useful routes:
  - `GET /api/waiting`: the threads waiting on you, across proposals.
  - `GET /api/projects`: every project with its tree (folders, plans with their states, documents), the id of
    its Readme (`Context`) and of its Context folder (`ContextFolder`).
  - `POST /api/projects` `{ Name }`: a new project.
  - `GET /api/proposals/<id>`: text, revision, threads, project; `Context: true` for a project's Readme.
  - `POST /api/proposals` `{ Title, Text, Project, Parent?, Kind? }`: a new plan (Parent: a folder's or a plan's
    id), or a document (`Kind: "document"`; it goes in the project's Context folder).
  - `POST /api/proposals/<id>/threads` `{ Text, Anchor?: { Text } }`: a new thread (no Anchor: the whole document).
  - `POST /api/proposals/<id>/threads/<tid>/replies` `{ Text }`
  - `POST /api/proposals/<id>/threads/<tid>/apply` `{ Outcome, Revision, Text?, Anchor?: { Text } }`
  - `POST /api/proposals/<id>/threads/<tid>/anchor` `{ Anchor: { Text } }`: re-anchor a thread.
  - `PUT /api/proposals/<id>/state` `{ State }`
  - `PUT /api/proposals/<id>/text` `{ Text, Revision }`: an edit, for example to a project's Readme.
- An anchor's `Text` is matched against the text as it reads, without markdown marks: no backticks or asterisks.

## Finding your project

List the projects (`GET /api/projects`); the one named after your repo is yours. If none or more than one fits,
ask the owner, and remember the answer for the session.

## Loading your context

"Load your context": read your project's Readme (its `Context` id) and the other documents of its
Context folder, its tree of plans with their states, and what waits on you; report it in a few lines.

## What the owner's words mean

- "check consensus", "check again": report what changed and what waits on you, and act on nothing.
- "your turn": act as the llm participant on everything waiting on you (below).
- "build it", "implement it": the build loop (below), for the plan named or just discussed.
- A message holding any question is answered only; its instructions wait for a message with no question.

## "Your turn in Consensus"

1. Find what waits on you (`GET /api/waiting`).
2. Resolved threads: apply each one, one revision each. What resolving means:
   - **Reply and resolve** (the owner's own reply is last): that reply is the outcome, read as the answer to
     the question before it. Apply it directly; no confirming round.
   - **Resolve with no reply:** the owner accepts the outcome, or the recommendation, in your last reply.
     Apply it, and say in the Outcome that the recommendation went in.
   - **Comment and resolve** (a new thread, resolved as it was posted): the comment is the outcome.
3. Contested threads the owner answered: reply. Confirm what you understood and give the wording you will
   apply; ask any follow-up with a recommendation.
4. After changing the text, check for detached threads and re-anchor them.
5. Put comments and questions in Consensus as anchored threads, not in the chat; the chat gets a summary.

## Drafting a plan

Decided defaults go into the text as statements; open threads only for real questions. A request to rework a
document is answered with a reply holding the exact new text, applied once the owner resolves it.

## The build loop

1. **Ready?** Every thread in the plan is resolved and applied. If any is not, list the open threads in the
   chat and stop. Post nothing in Consensus.
2. **Start.** When the owner says to implement the plan, set its state to Working.
3. **Implement** what the plan says, and only that. Run the tests.
4. **Report.** Post one contested whole-document thread on the plan: the build log. Say what was built,
   where (files), how it was checked (tests), and which model built it.
5. **Accepted** (the owner resolved the build log):
   - apply the build log thread, outcome only, no text change;
   - commit the work in your own repo: one commit titled after the plan, with a summary of the build log, no
     attribution trailers;
   - set the plan's state to Finished;
   - bring the project's Readme up to date with what changed.
6. **Sent back** (the owner replied to the build log instead): fix what the reply asks, run the tests, and
   reply on the same thread with the new result. Nothing is committed until it is accepted.

## Starting a project from a codebase

Create the project and write its Readme yourself (`PUT /api/proposals/<context id>/text`), from the
codebase you can read: what the project is, where things live, the conventions, and what has been decided.
After that, plans are drafted and discussed in threads as usual.
