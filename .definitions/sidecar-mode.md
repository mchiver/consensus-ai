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

## The sidecar

The one-project server itself (plan Rearchitecturation, Step 3): the headless `consensus <folder>` runs one over the
folder (the Desktop ran one per window until plan Review 2026-10-29, Step 5.1, the editions cut; the Sidecar app's
server is the same kind, with no address file). It listens on localhost alone, on a port
hashed from the folder's absolute path (lower-cased on Windows) into 3600 to 3699, stepped up by one while the
port is taken and wrapping at the end; `--port` overrides it for one start. While the project is open, the
address is in `<folder>/.consensus/~sidecar.json` as `{ Url, Port, Pid, Started, Project }`, written at start
and removed at a clean exit; a stale file, its Pid gone, is overwritten. A folder already open in a running
sidecar is not opened again: the sidecar is asked to bring its window to the front (`POST /api/desktop/activate`,
answered by a Desktop's sidecar alone) and the launch exits, as VS Code activates the window that has the folder.
Scope None keeps the server for the window and turns the sidecar off: no address file is written.

A session finds it without a copy and paste: `consensus mcp <folder>` (bin/mcp.js) relays stdio to the sidecar
named by the address file, read at every message, so one MCP entry per project is fixed,
`{ "command": "consensus", "args": [ "mcp", "<folder>" ] }`; a folder not open in Consensus answers each request
with one message saying so. The sidecar's `/instructions` page names its one project and the one-project rule.
On a sidecar a request is the owner, with the `X-Consensus-Service` header naming the agent: no users, no tokens,
no Clerk.

The served instructions (`.guides/build-with-consensus.md`, `/instructions`) and the docs' Ways of working
page say so.
