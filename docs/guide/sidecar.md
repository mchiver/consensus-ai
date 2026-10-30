# Consensus Sidecar

**Consensus Sidecar** is the simplest way to use Consensus: one window over one local project folder, you, and your agent session beside it. It never connects to a Server, never asks you to sign in, and has no users, roles, licenses, LLM connections or tasks. Your agent (Claude Code or any other) works in the project through its API or MCP, and Sidecar is where the two of you settle the plans thread by thread. It installs beside Consensus Client, Consensus Desktop and Consensus Server and changes none of them.

## Installing and starting it

On Windows, run `Consensus-Sidecar-Setup-<version>.exe` from the [latest release](https://github.com/mchiver/consensus-ai/releases/latest); it puts **Consensus Sidecar** in the Start menu. Start it and it asks for a folder: pick your project's folder (the dialog's New folder button makes one), and the window opens on it. Cancel quits. A folder that has no `.consensus` yet gets one, with a Readme in its Context folder.

From the command line, or from the checkout:

```
"Consensus Sidecar.exe" <folder>
npm run sidecar -- <folder> [--port <port>]
```

Each window is a process of its own and holds one project. **New window** (Ctrl+N) and **Open folder in new window…** (Ctrl+Shift+O) in the window's menu start another. Sidecar does not check whether a folder is already open in another window: opening the same folder twice is yours to avoid, since two windows on one folder do not see each other's changes.

## Connecting your agent

The window's server, the sidecar, listens on this machine alone. Its port comes from the folder: a number between 52000 and 52999 worked out from the folder's path, or the next free one when that one is taken, so a folder keeps its address from one start to the next.

To connect an agent session, open the project's menu (the `…` beside its name in the tree), choose **LLM Instructions**, press **Copy**, and paste the text into the session. The text starts with the server's address and the project, then tells the agent how to work: how to say who it is, what "check consensus", "your turn" and "build it" mean, and the build loop. The same text is at `http://127.0.0.1:<port>/instructions`. Nothing is written into the project folder to find the server: the pasted instructions are the connection. If you restart Sidecar and the port has changed, paste them again.

Through MCP, the agent uses the same address: `POST http://127.0.0.1:<port>/api/mcp`, or the stdio relay from a Consensus checkout, for Claude Code:

```
claude mcp add consensus -- node <checkout>/bin/mcp.js --server http://127.0.0.1:<port> --service Claude-CLI
```

What the agent posts reads "Claude-CLI by <your name>". See [Working with an LLM](llm.html) and [Ways of working](ways-of-working.html) for the loop itself.

## Your name and settings

Sidecar keeps its settings with the project, in `.consensus/sidecar.json`:

- **Your name**: the name on everything you write and in your agent's byline. It starts as `<your user name>@<your machine>`, and you can change it to anything in **Settings** (the window's menu) or **Project settings…** (the project's menu). Replies written before a rename keep the name they were written under.
- **The theme and the size**, from the gear in the title bar.
- **The view**: the open plan, the tabs, the folds, the sort, the widths.

The project's own settings (its name and its plan states) stay in `.consensus/project.json`, as everywhere. `sidecar.json` holds your name and the view as you left it, which changes as you click; if you would rather keep it out of source control, add `.consensus/sidecar.json` to your `.gitignore`. Sidecar does nothing with git itself.

## What Sidecar leaves out

Sidecar is the page with everything about servers and people taken away: no Connect to Server, no sign-in, no tiers, no Users or roles, no tokens, no LLM connections, task buttons or Explain. When your project lives on a Server, [Consensus Client](client.html) opens one of its projects and [Consensus Desktop](getting-started.html#the-desktop) several Servers at once; [the Server](server.html) is what serves them.
