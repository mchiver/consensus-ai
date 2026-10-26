# The Server Host

Consensus-AI runs in two modes. The **desktop** opens one project in one window, with a server of its own inside, the sidecar, for you and your agent on this machine; [Getting started](getting-started.html) is about that. The **Server Host** is the other mode: one server that holds a registry of projects and serves them to people, each with a role, on this machine or on the network. This page is the Host: how it starts, what it serves, who manages what on it, and how the desktop works with it. [Sharing a server](sharing.html) follows with the accounts, the roles and the tokens.

## Starting it

The Host is the headless program with the word `serve`:

```
node bin/consensus.js serve [--config <folder>] [--port 3500] [--scope local|public]
```

It reads the config folder (`.consensus` in your user folder, or the one `--config` names), listens as its Scope says, and serves every project its registry lists. The bare form, with no word and no path, means the same, so `npm start` and the Docker image run a Host. While it runs it writes its address to `<config>/~host.json`, so the desktop on the same machine finds it.

```
Consensus at http://127.0.0.1:3500/ (Scope Local, listening on 127.0.0.1)
config folder C:\Users\you\.consensus
settings from C:\Users\you\.consensus\consensus.json
project Recipe Box at C:\Users\you\projects\recipe-box (unmounted)
1 project is unmounted: accounts see mounted projects alone; the Administrator mounts a project in its menu on the Host's page
host address in C:\Users\you\.consensus\~host.json
```

From the desktop, the menu's **Start the Server Host** runs the same program detached over the same config folder, with its log in `<config>/~logs/`; it outlives the window. While a Host answers on this machine the item reads **Open the Server Host**, which opens its page in your browser, and **Stop the Server Host** ends the one the desktop started. A Host started any other way is found by its port and shown as running. A Personal license starts it with Scope Local; a Professional license leaves the Host the Scope its settings name, so it may listen on the network. In Docker the image runs `serve --config /data --scope public --port 3500`.

## The registry and mounting

The Host's settings file, `consensus.json`, holds the registry: the project folders it knows, in display order, each with a **Mounted** switch. The Host's page shows every registered project as a tree of its own in the one sidebar, each collapsible, with the LLM connections, the Users fold and the Trash beneath them.

A project registered on the Host, with **New project** or **Add folder**, starts unmounted: read and written by the Administrator alone, marked "unmounted" in its row, and not there for anyone else, in the lists, the tree and the API. **Mount** in the project's menu opens it to the accounts that hold a role in it; **Unmount** takes it back without touching the roles. A server brought up to this version finds its projects unmounted too, and its start log counts them, so nothing is served to a team until the Administrator says so.

![The Host's page: a project's menu with Unmount, the project mounted for its accounts.](../images/host-mount.png)

## Who manages what

Users, roles, LLM connections and tasks are managed on the Host's page, as [Sharing a server](sharing.html) and [Working with an LLM](llm.html) describe: the Administrator makes accounts and places anyone in a project's roles, defines the connections and the tasks in Settings, and mounts the projects; a project's Owners place people in its roles. The desktop reads the Host's `consensus.json` for the connections and the tasks and never writes it: in the desktop the LLM page shows a connection and says "Connections are managed by the Server Host", with a button to the Host's page.

## The desktop and the Host

A desktop window reaches a Host in two ways. **Connect to Host** on the chooser (Add host: a name and the address, then one of the Host's projects) opens that project as a thin client: the page works on the Host's server, signed in as you, and writes nothing on your machine; the pair is saved for next time. And **Open folder** on a folder the Host's registry lists as mounted, while the Host runs, connects the window to the Host's project instead of opening the folder as a plain project, so the Host stays the one writer of that folder; when the Host is not running the folder opens as usual. Both need a Personal license; a Public Host signs you in through Consensus-AI and applies its own checks.

An agent session beside a Host project is the relay's `--server` form: `node bin/mcp.js --server http://<host>:<port> --service <your name>` with a token minted on your page, or the instructions page at `/instructions` with curl. The sidecar's fixed entry, `consensus mcp <folder>`, is the desktop's own; see [Working with an LLM](llm.html#through-mcp).
