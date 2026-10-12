# Workflows

Guarded plan States. Put the rules in Rules.js, for example Draft → Plan only when no thread is contested or waiting. Keeping them configurable in consensus.json would fit the project's "configuration over convention" rule.


## Plan States

- Draft
- Plan
- Working: No unresolved threads.
- Contested: Some unresolved threads.
- Finished
- Built
- Commited

## Plan Actions

- Review: LLM reviews and replies to the Plan's open Threads.
    - LLM operates on a single plan at a time.
    - LLM replies to any open threads and/or creates new threads.

- Build: LLM builds the Plan and replies with a build log.
    - LLM operates on a single plan at a time.
    - LLM creates a new thread with the build log and marks the thread as `Build`.
    - User may respond to a `Build` thread with `Reply` or `Resolved`.
    - LLM turns continue until thread is `Resolved`.

## Workspace Actions

- Checkout
- Commit: Commits files and build logs
- Push

## Thread States

- Opened
- Resolved
- Applied
- Build

## Thread Reply Actions

- Ask
- Respond
- Settle
- Decline
- Review
