# Sidecar Edition

We are going to simplify things greatly.

We are going to make a new app, Sidecar, based on Desktop, with no server and no multiuser functionality. Sidecar is added, not replacing anything: Desktop and the Server keep everything they have and go on under their own plans.
This app opens only a local project folder and never connects to a Server.
This app never asks for a user sign-in.
This app is used only in sidecar mode.

This app's settings are stored in the project's `.consensus/sidecar.json` file. Sidecar has nothing to do with the Server or the global config folder.


## What Sidecar is

- A new Electron app in its own folder, `sidecar/`, run from the checkout with `npm run sidecar -- <folder>`. Sidecar shares as much code as it can: `src/` and `public/` are shared with Desktop and the Server through added options, and the parts of Desktop's main process Sidecar needs (the page server, the window, Print to PDF) are made into components that Desktop and Sidecar both use. Desktop and the Server behave as before, and their tests check it.
- A window holds one project folder, its `.consensus` made when missing. Another folder is another window. Started with no folder, Sidecar shows the folder dialog straight away, and the window closes on Cancel; there is no chooser and no recent list.
- The window's server is the sidecar over that folder: it listens on 127.0.0.1 alone, on any free port: the folder's own port, hashed into 52000 to 52999 so that a folder keeps its address between starts, or the next free one up. The range is an option Sidecar passes to the shared server; Desktop keeps 3600 to 3699. Sidecar writes no address file: the user connects an LLM session by copying the project's LLM Instructions from the page, which give the server's address, and pasting them into the session. Each window is its own process, and Sidecar does not check for another window on the same folder: opening a folder twice is the user's responsibility.
- One person uses it: the user named in the project's `sidecar.json`. There is no sign-in, no account, no token and no tier. Sidecar is free: it reads no license.
- There are no LLM connections, tasks or runs: no Answer or Work buttons, no Ollama. The LLM is the agent session beside the app, through the API or MCP, saying who it is with `X-Consensus-Service`; what it posts reads "<service> by <user name>". A request with no token is the user.
- The consensus rules stay as they are, for one person: a thread is resolved by the user, applied by the user or the LLM, and waits on the user and the LLM.


## sidecar.json

- The file is `<project>/.consensus/sidecar.json`, read and written by Sidecar alone. A missing file is the defaults; nothing is carried over from Desktop's or the Server's files.
- Its fields:
  - `User`: the name the user goes by, whatever they type in Settings; by default `<os user>@<machine>` (for example `andre@cube1`). It is the name on everything the user writes and in the LLM's byline.
  - `Theme` and `Scale`: the look (the ten palettes; small, normal, large).
  - `Remembered`: the page's view state (the open item, the folds, the tabs, the sort, the hidden panes, the widths).
- The plan states are not in sidecar.json: they stay in the project's `project.json`, edited from the project's Settings, as in Desktop.
- Sidecar does nothing about git: the guide says to add `.consensus/sidecar.json` to `.gitignore` for anyone who wants it out of source control.
- Sidecar writes nothing else in the project's `.consensus`: no address file.


## What Sidecar does not have

- Connect to Server, the Hosts, the Server routing of Open folder, the chooser's server rows.
- Sign-in, licensing, the tiers, the license line of About.
- Users, roles, the Users page, minted tokens, the LLM session token.
- LLM connections, tasks and runs.


## What Sidecar keeps from Desktop

- Plans, documents, folders, threads, revisions, anchors, the rules, reports and Print to PDF, the editor and the View, the look controls, the project tree, the waiting list, the project settings.
- The API, the MCP (`POST /api/mcp`, or `bin/mcp.js --server <address>`, at the address the LLM Instructions give), and the instructions page, for sidecar mode alone.


## Desktop and the Server

- Desktop, the Server, `consensus <folder>`, `consensus serve` and `consensus mcp <folder>` stay as they are.


## The installer

- A new installer for the new app: product name "Consensus Sidecar", appId `com.mchiver.consensus-sidecar`, `Consensus-Sidecar-Setup-<version>.exe`, its config `build/sidecar.json`, built by `npm run dist` with the other two. It installs beside Desktop and the Server.


## Steps

1. **The app.** The shared components taken out of `desktop/`; `sidecar/`: the main process, the window, the sidecar over the folder, `npm run sidecar`.
2. **sidecar.json.** The user, the look and the view state, read and written in the project's `.consensus`; tests.
3. **The page for Sidecar.** What Sidecar does not have left out of its page: sign-in, servers, users, LLM connections and tasks.
4. **The installer.** `build/sidecar.json` and the dist script.
5. **The guide.** The user guide's Sidecar page, the features page, the Readme and a Sidecar smoke.
