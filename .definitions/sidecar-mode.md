# Sidecar mode

An open LLM session (Claude Code, or another coding agent with a shell) beside an open instance of Consensus.
Rather than pressing the task buttons in the page, the person prompts the session with "check consensus" or
"your turn", and the session takes the LLM's turn through the API as the person's byline.

It is the more powerful of the two ways an LLM takes part: the session brings every tool and all the context
its own harness keeps (the files, the shell, the tests, its memory of the conversation), where a run from the
page starts from a packaged prompt alone.

Sidecar mode is generally one project's: the plans are made in Consensus and carried out in the session, and
the session works in that project alone. The server's other projects are the business of sessions of their
own; a thread waiting there is left alone even when the waiting route lists it.

The served instructions (`.guides/build-with-consensus.md`, `/instructions`) and the docs' Ways of working
page say so.
