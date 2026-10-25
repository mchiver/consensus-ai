# Rearchitecturation

- Split the current application into two parts:
  - Desktop: the application that works with a single Project (folder) at a time
  - Server Host: the application which exposes Projects to a network. The Server Host owns the per-user machine config, which declares the users and the LLM connections. The Desktop reads that same config and never writes it.

## Desktop

Each instance opens a single project at a time and shows one project tree: the tree is a component (`project-tree` under public/components, taking its project through a binding), of which the Desktop shows one instance.
Can create a consensus project in a new folder, connect to an existing local folder, or connect to a project mounted on a Server Host.
Connected to a Host, the Desktop is a thin client: the same page pointed at the Host's API, signed in as the person's account, writing nothing locally; the Host runs the LLMs.

The Desktop learns its tier by signing in through Clerk (Sign in under the account menu). The license is cached for a grace period of 14 days so the Desktop works offline, and About shows the tier. Free needs no account. Connecting to a Host reuses the same session.

### Sidecar Usage
Exposes the project via API and MCP on localhost for sidecar usage. The port comes from a range, chosen by a hash of the project folder and stepped up when taken, so concurrent instances work; the address of the moment is written to `.consensus/~sidecar.json` (a tilde file, never committed). A stdio MCP shim, `consensus mcp <folder>`, reads that file, so a fixed MCP entry per project keeps working across restarts.
The sidecar API and MCP listen the whole time the project is open. Copying the LLM Instructions into the LLM's session is how a person starts a sidecar session by hand; the instructions carry the address and the one-project rule.

## Server Host

One codebase, two modes: `consensus serve` is the Server Host (headless: the registry, the users, the LLM connections, the web UI), and the desktop app is the Desktop. The Desktop can start the Host mode from a menu on the same machine.
Uses the machine's user folder (`~`) for the settings global to the machine: consensus.json holds the registry, the users, the LLM connections, the tasks and the trust settings, and the Host alone writes it. The Desktop reads it for the connections and tasks, and keeps what is its own (recent projects, theme, windows) in a file of its own beside it.
Manages the project registry for this machine: a registered project is known to the machine, a mounted one is exposed to accounts, and mounting and unmounting are a switch on the entry. A Desktop that opens a folder the local Host has mounted connects through the Host (it reads the registry in the user folder), so one process writes the files.
The Host's page shows an array of project-tree instances, one per registered project, stacked in the one sidebar as the tree is today, each collapsible, with the Administrator's mount switch on each.
Manages Users and permissions for mounted projects.
Manages LLM connections and tasks for mounted projects.

The project data (the `.consensus` folder) does not change: the Desktop opens any such folder as it is. The Host's config stays today's consensus.json with two changes this plan names, a Mounted switch on each registry entry and the Desktop reading the file without writing it; anything more is the first step's design.

## Licensing

Licensing has three tiers, Free, Personal and Professional, each granting what the one before it does and more. The tiers are not roles: a project's roles (Owner, Member, Service, Watcher) stay as they are.

Three reaches, used with these words throughout: **localhost** is this machine alone; **local network** is the machines the trusted network names; **remote** is the Internet.

### Free
- The freely available feature set.
- Can run Desktop to work with projects in local folders.
- Can run the sidecar on localhost: the API and MCP of the open project.
- Can copy Sidecar instructions for project in Desktop.
- No LLM connections and no LLM Tasks: the sidecar is the free tier's LLM path.

### Personal
- Can use the LLM connections and all LLM Tasks in Desktop.
- Can connect Desktop to a Server Hosted project.
- Can run the Server Host bound to localhost.
- Can use Server Host to manage mounted projects.
- Can use Server Host to manage LLM connections.
- Can use Server Host to manage Users.

### Professional
- Can bind the Server Host to the network, local network and remote alike; the trusted-network setting stays on the Host.

## Relation to the other plans

This plan supersedes the readme's license section (Free, Host, User), Monetization (pln-qr1-aed-21x), Accounts and Roles and Teams for the shape of the application. Monetization's pricing folds into Licensing here and that draft is archived; Accounts and Roles stays the roles reference, the roles being unchanged; the readme is brought up to date when the first step is built.

## Steps

Seven steps, each a Subplan of this plan, built in this order, each with its tests and its readme change, and a build log on the Subplan for acceptance:

1. **The two files and the registry.** consensus.json the Host's, desktop.json the Desktop's, the read-only store, Mounted on the registry entry, `consensus serve`.
2. **The Desktop opens one project.** The chooser, one window one project, the `project-view` component, a Host's project as a thin client.
3. **The sidecar.** The hashed port in its range, the address file, `consensus mcp <folder>`, always listening.
4. **LLM connections and tasks in the Desktop.** Read from the Host's file, read-only on the page, the runs.
5. **The Server Host.** Mounting, the array of project trees with the switch, Start the Server Host from the Desktop, a mounted folder routed through the Host.
6. **Licensing.** The tiers in Clerk, what each enforces and where, the Desktop's sign-in with the 14-day cache, the pricing page.
7. **The guide and the close-out.** The website and the readme for the two modes, the superseded plans closed, this plan Finished.
