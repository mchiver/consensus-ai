# Reply and Resolve

Fewer rounds between a question and its answer landing in the text.

## Why

Today a clear answer from the owner takes two turns to land: the owner replies, the LLM confirms the wording, the owner resolves, and only then does the LLM apply it. The confirmation round adds nothing when the answer is already clear.

## Reply and resolve

- The reply box of a contested thread gets a third button, **Reply and resolve**, beside Reply and Resolve. Only the owner sees it, as only the owner resolves.
- It posts the reply and resolves the thread in one request: `POST /api/proposals/<id>/threads/<tid>/replies` takes `Resolve: true`, owner only, and makes one write and one event. Without `Resolve` the route is as it is.
- The thread is then waiting on the LLM to apply, as any resolved thread is. The outcome is what the owner's reply says, read as the answer to the question before it.

## What resolving means

- **Reply and resolve:** the owner's reply is the outcome.
- **Resolve with no reply:** the owner accepts the outcome, or the recommendation, in the LLM's last reply.
- Both are written into the one-shot LLM's rules and into `.guides/build-with-consensus.md`, so every LLM applies them the same way.

## Checks

- API tests: the owner replies and resolves in one request; anyone else asking for it is refused; the thread ends resolved with the reply last.
- A page test: the button shows for the owner on a contested thread, and one click leaves the thread resolved.
