# Build with Consensus

For an agent session (Claude Code or similar) working on a repo whose plans live in Consensus. The plan
"Build Workflow" in the Consensus project is where this was agreed.

## Who does what

- **One-shot LLM** (Send to LLM in the page, for example an Ollama model): one packed prompt, one JSON answer.
  It reviews, replies, applies resolved threads and keeps the project's context. It never builds.
- **Agent session** (you): reads and writes the codebase, and works in Consensus through its API. You
  initialize project contexts and implement plans.
- Both post as the one `llm` participant. Say which model you are in each build log.

## Talking to Consensus

- The server: `http://127.0.0.1:<Port>/api`, with `Port` from `~data/consensus.json` (3500 by default).
- Act as the llm participant: `Authorization: Bearer <Token>`, the `Token` of the participant whose Role is
  `llm` in `~data/consensus.json`. Never print the token.
- Always go through the API, never by editing `~data` files: it keeps the queues, revisions and anchors right.
- The routes are in `src/Api.js`; the useful ones:
  - `GET /api/waiting`: the threads waiting on you, across proposals.
  - `GET /api/proposals/<id>`: text, revision, threads, project.
  - `POST /api/proposals/<id>/threads` `{ Text, Anchor?: { Text } }`: a new thread (no Anchor: the whole document).
  - `POST /api/proposals/<id>/threads/<tid>/replies` `{ Text }`
  - `POST /api/proposals/<id>/threads/<tid>/apply` `{ Outcome, Revision, Text?, Anchor?: { Text } }`
  - `PUT /api/proposals/<id>/state` `{ State }`
  - `PUT /api/proposals/<id>/text` `{ Text, Revision }`: an edit, for example to a project's context.

## "Your turn in Consensus"

1. Find what waits on you (`GET /api/waiting`).
2. Resolved threads: apply each one, one revision each. What resolving means:
   - **Reply and resolve** (the owner's own reply is last): that reply is the outcome, read as the answer to
     the question before it. Apply it directly; no confirming round.
   - **Resolve with no reply:** the owner accepts the outcome, or the recommendation, in your last reply.
     Apply it, and say in the Outcome that the recommendation went in.
3. Contested threads the owner answered: reply. Confirm what you understood and give the wording you will
   apply; ask any follow-up with a recommendation.
4. After changing the text, check for detached threads and re-anchor them.
5. Put comments and questions in Consensus as anchored threads, not in the chat; the chat gets a summary.

## The build loop

1. **Ready?** Every thread in the plan is resolved and applied. If any is not, list the open threads in the
   chat and stop. Post nothing in Consensus.
2. **Start.** When the owner says to implement the plan, set its state to Working.
3. **Implement** what the plan says, and only that. Run the tests.
4. **Report.** Post one contested whole-document thread on the plan: the build log. Say what was built,
   where (files), how it was checked (tests), and which model built it.
5. **Accepted** (the owner resolved the build log):
   - apply the build log thread, outcome only, no text change;
   - commit the work: one commit titled after the plan, with a summary of the build log, no attribution
     trailers;
   - set the plan's state to Finished;
   - bring the project's context up to date with what changed.
6. **Sent back** (the owner replied to the build log instead): fix what the reply asks, run the tests, and
   reply on the same thread with the new result. Nothing is committed until it is accepted.

## Starting a project from a codebase

Create the project, upload the codebase as a zip, and initialize its context (**Initialize context** on the
context's page, or write it yourself with `PUT /api/proposals/<context id>/text`). After that, plans are
drafted, reviewed by the one-shot LLM, and discussed in threads as usual.
