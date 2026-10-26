# Getting started

Consensus-AI is a web application you run yourself. It keeps your plans as plain files in a folder, shows them in a browser, and lets an LLM take part through its API. It runs in two modes: the **desktop**, one project in one window with a server of its own inside, which is where you work; and the **Server Host**, one server for several people, from the checkout or in Docker. This page gets the desktop running first, from the Windows installer or from the checkout, then the Host.

The code is public at [github.com/mchiver/consensus-ai](https://github.com/mchiver/consensus-ai). The Windows installer is on the [releases page](https://github.com/mchiver/consensus-ai/releases/latest); everything else starts from the checkout.

Consensus-AI is not [Consensus](https://consensus.app), the research search engine at consensus.app, and has no connection to it. Consensus-AI is a tool for settling a plan with your LLM, thread by thread.

## The desktop

Consensus Desktop is where you work: one project in one window, with a Consensus server of its own inside. The app opens a folder, as an editor does, makes the folder's `.consensus` when it has none, and shows that project's tree. On Windows the [installer](#the-installer) is the quickest way in; from the checkout:

```
npm run desktop
npm run desktop -- W:\projects\tic-tac-toe
npm run desktop -- --connect cube4
```

With no folder the app opens on the **chooser**: **Recent projects** (Open, or Forget to drop one from the list; the folder stays), **Open folder…**, **New project** (a name and the folder to put it in) and the **Hosts** you saved, each opening in this window. Another project is another window: the menu's **New window** opens a chooser, **Open folder in new window…** and the recent folders start one on a folder, and the app is one process per window, so a folder already open in another window is brought to the front, not opened twice.

![The chooser: recent projects, Open folder, New project, and the Hosts.](../images/desktop-connect.png)

The page shows the one project: its tree, open, with the LLM connections, the Users and the Trash of its server beneath it. The window has no frame of its own: the page's title bar is the window's, the minimize, maximize and close buttons sit over its right end in the palette's colours, and the bar drags the window.

![A folder open in the desktop: the one project, with the folds of its server beneath.](../images/desktop-project.png)

### The sidecar

The server inside the window is the **sidecar**: the API and the MCP of the open project, on this machine alone, for the agent session you keep beside the window. It listens on a port hashed from the folder's path into 3600 to 3699, stepping up while the port is taken, and keeps its address in the folder's `.consensus/~sidecar.json` while the project is open, so an agent finds it without a copy and paste.

Two ways to point an agent at it. **LLM Instructions** in the project's menu opens the instructions page the server serves, with the address first and a **Copy** button: paste the one line into your session ("read the instructions at http://127.0.0.1:36xx/instructions with curl") and it knows the rules, the address and the one project it works in. Or give the agent one MCP entry per project, fixed for good:

```
claude mcp add consensus -- consensus mcp W:\projects\tic-tac-toe
```

`consensus mcp <folder>` reads the sidecar's address from the folder at every message and fills in the project for every tool, so the entry keeps working as the project is closed and opened; while the folder is not open, each request is answered with one message saying so. [Working with an LLM](llm.html) has the rest.

### The menu, the account and the tiers

The title bar's **Menu** has New window, Open folder in new window and the recent folders, **Settings** (the server's), **Sign in…**, Reload, the **Server Host** items and Quit; Ctrl+N, Ctrl+Shift+O and Ctrl+R do the same, and F11 goes full screen.

![The desktop's menu: the windows, Settings, Sign in, the Server Host and Quit.](../images/desktop-menu.png)

The desktop is free to use on your own folders with the sidecar as the LLM's way in. **Sign in…** signs you in with your Consensus-AI account, and the license it carries sets the tier the desktop is at, kept for fourteen days offline and shown in About: **Personal** unlocks the LLM connections and tasks in the page, connecting to a Host's project, and **Start the Server Host** on this machine; **Professional** lets that Host listen on the network. When the cache lapses the desktop falls back to Free with a line in About, and nothing you saved is locked away. [The licenses](../pricing.html) lists the tiers; [The Server Host](host.html) is the other mode.

`--connect <host name>` opens a saved Host's project as a thin client: the page works on the Host's server and writes nothing on your machine. `--config <folder>` names the config folder, `--port` and `--scope` apply to the window's server (the sidecar listens on this machine whatever the Scope; None keeps the server for the window and writes no address file), and `--headless` runs the server with no window at all, printing what the command line prints.

## The installer

On Windows, the desktop comes packaged with its server, with nothing to install first: download `Consensus-Setup-<version>.exe` from the [latest release](https://github.com/mchiver/consensus-ai/releases/latest), run it, and pick the folder (the default is under your user profile). It puts Consensus in the Start menu and starts it; the app reads the same config folder, `<user>/.consensus`, as the other ways do, so a checkout and the installed app share the settings and the local server's projects. It also adds **Open with Consensus** to the file explorer's right-click menu of a folder, and of the empty space inside one, which opens the app on that folder's project alone, as `consensus <path>` does; on Windows 11 the entry is under "Show more options". The uninstaller removes it. The installer is not signed yet: Windows SmartScreen warns once ("Windows protected your PC"); More info, then Run anyway, lets it through. A new version is installed over the old one from its own installer; the config folder stays.

## The Server Host

The other mode is one server for several people: it holds a registry of projects, serves the mounted ones to the accounts with a role in them, on this machine or on the network, and runs the LLM connections and tasks the desktop windows use. It is the headless program with the word `serve`, from the checkout or in Docker; the page [The Server Host](host.html) is about it, and [Sharing a server](sharing.html) about its accounts and roles. From the checkout, with Node 22 or later and git:

```
git clone https://github.com/mchiver/consensus-ai.git
cd consensus-ai
npm install
node bin/consensus.js serve
```

The server prints its address and scope, its config folder, its settings file and the projects it loaded, and that it opens no window:

```
Consensus at http://127.0.0.1:3500/ (Scope Local, listening on 127.0.0.1)
config folder C:\Users\you\.consensus
settings written to C:\Users\you\.consensus\consensus.json
project Default at C:\Users\you\.consensus\projects\Default (unmounted)
1 project is unmounted: accounts see mounted projects alone; the Administrator mounts a project in its menu on the Host's page
host address in C:\Users\you\.consensus\~host.json
no window: this is the headless form; open the address in a browser, or run the desktop (npm run desktop); Ctrl+C stops the server
```

Open `http://127.0.0.1:3500/` in a browser. You are the owner, and you see the **Default** project with its Context folder and an empty Readme.

![The page at first start: the Default project and its Readme.](../images/first-start.png)

Across the top runs the **title bar**: the brand, a **Menu** (About, with the version, the links and a summary of every project's threads; Hotkeys; and, in the desktop, the window's commands), **Waiting on you** with the count of threads that wait on you, **Running** while an LLM run is in progress, and a gear for the look: the theme, the size, the editor and Confirm on close.

![The title bar, with the look popover open.](../images/title-bar.png)

The config folder holds the settings and the registry, and the projects that were made with no folder of their own; a project is a folder with a `.consensus` in it (the page [Settings](settings.html) has the layout). The same program with a path is the one-project server the desktop runs, the sidecar, for a window of your own or a browser:

| Option | What it does |
| --- | --- |
| `serve` | the Server Host: every registered project served, the mounted ones to accounts; the bare form with no path means the same |
| `<path>`, or `--project <folder>` | one project alone, the sidecar: the folder's project is served and no other, its `.consensus` made when it has none (named after the folder), its address written to the folder; `consensus .` is the folder you are in |
| `mcp <folder>` | the MCP shim over that folder's sidecar, for an agent's configuration |
| `--config <folder>` | the config folder; `.consensus` in your user folder by default (`--data` is its older name) |
| `--port <port>` | the port; the settings' Port, 3500 by default, for the Host (the port in use gives way to a free one, printed); a sidecar's port is hashed from its folder unless given here |
| `--scope none`, `local` or `public` | for this start, in place of the settings' Scope: `local` listens on this machine only, `public` on every interface, `none` starts no server; a sidecar listens on this machine whatever the Scope |
| `--headless` | accepted here and does nothing: this form never has a window |

Listening beyond your own machine is a decision: a Public server signs people in through Consensus-AI and needs a Professional license to be set Public from the page. Keep the Scope Local unless the server is for a team.

## In Docker

The repository holds a `Dockerfile` and a `compose.yaml`. From the checkout:

```
docker build -t consensus:latest .
docker compose up -d
```

The image runs the Server Host with `serve --config /data --scope public --port 3500 --headless`: it listens on port 3500 and keeps its config and data in the `consensus-data` volume. `docker compose down` stops it; the volume stays. The `compose.yaml` as shipped publishes the port on every IPv4 address of the host, because it is written for a server on a private network; edit it for your own.

## What to do first

1. Open the Readme in the Context folder and write a few lines about what the project is for. Every LLM that works on the project reads it.
2. Make a plan with **New plan** in the project's menu, and write a draft.
3. Select a sentence of the draft and comment on it. That is a thread, and the rest of this guide is about what happens next.
4. Read [Ways of working](ways-of-working.html) for how an LLM takes part: an agent session beside your editor, or a connection the server runs, and the loop you will use with either.
