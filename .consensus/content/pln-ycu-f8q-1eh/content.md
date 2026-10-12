# Agent Instructions

Consensus serves the instructions an agent session needs to work with it at one plain link, so any session that can reach the server, in any repo, can be told: "read the instructions at http://<server>:<port>/instructions".

## The link

- `GET /instructions` serves the instructions as plain text (`text/plain; charset=utf-8`), readable as is by `curl` and by a person in the browser. No token is needed to read it.
- The text is `.guides/build-with-consensus.md` (the one source; it stays in the repo), with a short **This server** section put first by the server when it answers:
  - the API's address, made from the address the session reached the server at (`http://<host>:<port>/api`);
  - the `llm` participant's token, to send as `Authorization: Bearer <token>`;
- The owner's line to a new session: "read the instructions at http://<server>:<port>/instructions" (with `curl`: a session's web fetch tool may not reach a local or private address; the guide says so in its first line).

Everything goes through the API; the session has no access to the server's files.

## The listen address

- The server's listen address becomes a setting: `Host` in `consensus.json`, `127.0.0.1` by default (as the context server's `Host`), and `--host` on the command line overrides it. Any address is accepted, `0.0.0.0` for every interface; the refusal of other hosts goes.
- Security is relaxed for now, as agreed: a request without a token is still the owner, so anyone who can reach a server listening beyond this machine acts as the owner. At start, the server prints its address and a warning when it listens beyond this machine.
- The readme's Starting it and Settings sections say so.

## What the guide gains

The guide today covers the API, "your turn" and the build loop. It gains what the owner and the agent have settled in practice:

- **Finding your project.** List the projects (`GET /api/projects`); the one named after your repo (or holding a corpus of it) is yours. If none or more than one fits, ask the owner, and remember the answer for the session.
- **Loading your context** ("load your context"): read the project's context and its tree of plans with their states, and what waits on you; report it in a few lines.
- **What the owner's words mean:**
  - "check consensus", "check again": report what changed and what waits on you, and act on nothing.
  - "your turn": act as the llm participant on everything waiting on you.
  - "build it", "implement it": the build loop, for the plan named or just discussed.
  - A message holding any question is answered only; its instructions wait for a message with no question.
- **Drafting a plan:** decided defaults go into the text as statements; threads only for real questions. A request to rework a document is answered with a reply holding the exact new text, applied once the owner resolves it.
- **Commits:** in your own repo, titled after the plan, no attribution trailers.
- **Calling the API:** plain HTTP requests (`curl` or any client) to the address in This server, each with the header `Authorization: Bearer <token>` and, for a body, `Content-Type: application/json`. For example, what waits on you, then a reply on a thread:

  ```
  curl -s -H "Authorization: Bearer <token>" http://<server>:<port>/api/waiting

  curl -s -X POST -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
    -d '{ "Text": "Agreed; the wording I will apply: ..." }' \
    http://<server>:<port>/api/proposals/<plan id>/threads/<thread id>/replies
  ```

## Checks

An API test: `GET /instructions` answers 200 as plain text; its This server section holds the address the request came to and the `llm` participant's token; and it holds the guide's text.
