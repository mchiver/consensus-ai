# Getting started

Consensus-AI is a web application you run yourself. It keeps your plans as plain files in a folder, shows them in a browser, and lets an LLM take part through its API. This page gets it running in the four ways there are: from the checkout, in Docker, as the desktop application from the checkout, and from the Windows installer.

The code is public at [github.com/mchiver/consensus-ai](https://github.com/mchiver/consensus-ai). The Windows installer is on the [releases page](https://github.com/mchiver/consensus-ai/releases/latest); the other ways start from the checkout.

Consensus-AI is not [Consensus](https://consensus.app), the research search engine at consensus.app, and has no connection to it. Consensus-AI is a tool for settling a plan with your LLM, thread by thread.

## From the checkout

You need Node 22 or later and git.

```
git clone https://github.com/mchiver/consensus-ai.git
cd consensus-ai
npm install
node bin/consensus.js
```

The server prints its address and scope, its config folder, its settings file and the projects it loaded:

```
Consensus at http://127.0.0.1:3500/ (Scope Local, listening on 127.0.0.1)
config folder C:\Users\you\.consensus
settings written to C:\Users\you\.consensus\consensus.json
project Default at C:\Users\you\.consensus\projects\Default
no window: this is the headless form; open the address in a browser, or run the desktop (npm run desktop); Ctrl+C stops the server
```

Open `http://127.0.0.1:3500/` in a browser. You are the owner, and you see the **Default** project with its Context folder and an empty Readme.

![The page at first start: the Default project and its Readme.](../images/first-start.png)

Across the top runs the **title bar**: the brand, a **Menu** (About, with the version, the links and a summary of every project's threads; Hotkeys; and, in the desktop, the window's commands), **Waiting on you** with the count of threads that wait on you on every server, **Running** while an LLM run is in progress, and a gear for the look: the theme, the size, the editor and Confirm on close.

![The title bar, with the look popover open.](../images/title-bar.png)

The config folder holds the settings, and the projects that were made with no folder of their own; a project is a folder with a `.consensus` in it (the page [Settings](settings.html) has the layout). A path and four options change where and how it runs:

| Option | What it does |
| --- | --- |
| `<path>`, or `--project <folder>` | one project alone, the way an editor opens a folder: the folder's project is served and no other, its `.consensus` made when it has none (named after the folder, with an empty Readme), and the folder goes to the top of the settings' project list, so a plain start shows it next time; `consensus .` is the folder you are in |
| `--config <folder>` | the config folder; `.consensus` in your user folder by default (`--data` is its older name) |
| `--port <port>` | the port; the settings' Port, 3500 by default. When that port is in use (another instance), a free one is taken and printed, so two folders can be open at once; a port given here is not given up |
| `--scope none`, `local` or `public` | for this start, in place of the settings' Scope: `local` listens on this machine only, `public` on every interface, `none` starts no server (taken as `local` when a path is given: that project needs its server) |
| `--headless` | accepted here and does nothing: this form never has a window |

Listening beyond your own machine is a decision: anyone who can reach the server acts as the owner. Keep the Scope Local unless the network is yours.

## In Docker

The repository holds a `Dockerfile` and a `compose.yaml`. From the checkout:

```
docker build -t consensus:latest .
docker compose up -d
```

The image runs the server with `--config /data --scope public --port 3500 --headless`: it listens on port 3500 and keeps its config and data in the `consensus-data` volume. `docker compose down` stops it; the volume stays. The `compose.yaml` as shipped publishes the port on every IPv4 address of the host, because it is written for a server on a private network; edit it for your own.

## The desktop

Consensus Desktop is the same page in a window of its own, with a Consensus server of its own inside. A window is one project: the app opens a folder, as an editor does, and shows that project's tree. That server is the **sidecar**: it listens on this machine alone, on a port hashed from the folder into 3600 to 3699, and keeps its address in the folder's `.consensus/~sidecar.json` while the project is open, so an agent finds it without a copy and paste (see [Working with an LLM](llm.html#through-mcp)); a folder already open in another window is brought to the front, not opened twice. It is the other entry point of the one program, taking the same `--config`, `--port`, `--scope` and `--headless`, and it keeps its own settings (the recent folders, the saved Hosts, the theme, the remembered view) in `desktop.json` beside the server's `consensus.json`. From the checkout:

```
npm run desktop
npm run desktop -- W:\projects\tic-tac-toe
npm run desktop -- --connect cube4
npm run desktop -- --config W:\consensus --headless
```

With a folder it starts its own server over that folder alone (a folder without a `.consensus` gets one, named after the folder) and shows the project. With `--connect` and the name of a saved Host it opens that Host's project as a thin client: the page works on the Host's server and writes nothing on your machine. With neither it opens on the **chooser**.

![The chooser: recent projects, Open folder, New project, and the Hosts.](../images/desktop-connect.png)

- **Recent projects** lists the folders you opened, newest first; Open opens one here, Forget drops it from the list (the folder stays).
- **Open folder…** picks a folder; **New project** asks for a name and the folder to put it in, makes the folder and opens it.
- **Hosts** lists the Host projects you saved. **Add host** asks for a name and a URL, tries the address, lists the Host's projects to pick one, and connects; the pair is saved for next time, with the project's name.

The page shows the one project: its tree, open, with the LLM connections, the Users and the Trash of its server beneath it. The window has no frame of its own: the page's title bar is the window's, the minimize, maximize and close buttons sit over its right end in the palette's colours, and the bar drags the window. The title bar's **Menu** has New window (another chooser), Open folder in new window and the recent folders (each starting another instance on that folder, as `consensus <path>` does; the app is one process per window), Settings (the server's), Reload and Quit; Ctrl+N, Ctrl+Shift+O and Ctrl+R do the same, and F11 goes full screen. `--headless` runs the server with no window at all, printing what the command line prints. The LLM connections are the server's, run by it; the page [Working with an LLM](llm.html) covers them.

## The installer

On Windows, the desktop comes packaged with its server, with nothing to install first: download `Consensus-Setup-<version>.exe` from the [latest release](https://github.com/mchiver/consensus-ai/releases/latest), run it, and pick the folder (the default is under your user profile). It puts Consensus in the Start menu and starts it; the app reads the same config folder, `<user>/.consensus`, as the other ways do, so a checkout and the installed app share the settings and the local server's projects. It also adds **Open with Consensus** to the file explorer's right-click menu of a folder, and of the empty space inside one, which opens the app on that folder's project alone, as `consensus <path>` does; on Windows 11 the entry is under "Show more options". The uninstaller removes it. The installer is not signed yet: Windows SmartScreen warns once ("Windows protected your PC"); More info, then Run anyway, lets it through. A new version is installed over the old one from its own installer; the config folder stays.

## What to do first

1. Open the Readme in the Context folder and write a few lines about what the project is for. Every LLM that works on the project reads it.
2. Make a plan with **New plan** in the project's menu, and write a draft.
3. Select a sentence of the draft and comment on it. That is a thread, and the rest of this guide is about what happens next.
4. Read [Ways of working](ways-of-working.html) for how an LLM takes part: an agent session beside your editor, or a connection the server runs, and the loop you will use with either.
