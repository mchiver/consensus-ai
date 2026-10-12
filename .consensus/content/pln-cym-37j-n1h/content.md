# Step 2: Consensus Desktop Application

Subplan of Consensus Desktop. The Consensus Web UI is packaged as an Electron application: a Consensus client that connects to any accessible Consensus web server, and can spawn one local Consensus server from a data folder (which holds that server's configuration file) and connect to it. Connecting to several servers, local or remote, means several instances of the application.

## The app

- Electron, in this repo under `desktop/`: `desktop/main.js`, `desktop/preload.js` and the desktop's page in `desktop/page/`: the connect screen, and the desktop's own copy of the Consensus page. `electron` is a devDependency of the root package and `npm run desktop` starts it from the checkout; packaging (an installer or a portable folder) is a later step, once the app is in daily use.
- **The page is the desktop's own copy.** After Step 1 the server's Web UI (`public/`) is frozen; the desktop starts from a copy of it in `desktop/page/` and develops it on from there, in Steps 2 and 3, without touching the server's page. The copy talks to the connected server's API through a base URL that the desktop sets before the page starts (`client.js` reads it; empty means the page's own origin, as in the browser). The server's version comes from `/api/me`; the connect screen warns when it differs from the page's.
- A request from the app carries no token and is the owner, as a browser is today.
- The app's settings are `desktop.json` in Electron's user-data folder (`%APPDATA%/consensus-desktop/`): `Servers` (each a Name and a Url), `Local` (the data folder, and the port from its `consensus.json`), `Last` (what was open), and `Theme` and `Scale`, which the desktop applies to the page it hosts in place of the browser's storage.

## Connecting

- The app opens on the **connect screen**: the saved servers, each with Connect, Edit and Remove; Add server (Name, Url, tried before it is saved); and **Local server** with the data folder (Browse), Start and Stop. The screen says what it is connected to.
- **Local server:** started in the app's process through `Start` from `src/Server.js` with the chosen data folder, on `127.0.0.1` and the folder's port; a missing `consensus.json` is written with the defaults at that first start, as the command line does. The app connects to it as soon as it listens. Stop closes it; closing the window stops it too.
- Once connected, the window shows the Consensus page, with **Server** in the app's menu: Connect to another (back to the connect screen), Reload, and the local server's Start and Stop. The connect screen is also where an unreachable server lands you, with the reason.
- A second server at the same time is a second instance: **New window** in the Server menu starts another instance of the app with the same `desktop.json`, on its own connect screen.
- A tab's **Detach** opens a new window of the app, as a browser pop-up does today.

## What stays the same

- The server is not changed for the app, beyond `/api/me` saying its version. The desktop is a client: everything it shows comes from the server it is connected to, through the API.

## After Step 2

- Tests: `node --test` for the app's settings module and the local server's start and stop with the real `Start` over a temporary folder; the window checked by hand, as for the worker app.
