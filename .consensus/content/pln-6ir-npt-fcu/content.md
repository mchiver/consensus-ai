# Step 5: The Server Host

The Host as the plan names it: today's server, with mounting, the array of project trees, and the Desktop started as a Host or routed through one.

## What is built

- **Mounting.** `PUT /api/projects/:pid/mount` with `{ Mounted }`, the Administrator's, writes the registry entry's switch and sends `{ Kind: "projects" }`. An unmounted project is read and written by the Administrator alone; every other account sees the mounted ones only, in the list routes and the tree. A project registered on the Host's page (New project, Add folder) starts unmounted, and the first start of this version leaves today's entries as they are, unmounted, so a Host serves nothing to accounts until the Administrator mounts; the start log says how many are unmounted.
- **The Host's page.** The web page of the Host shows an array of `project-view` (Step 2), one per registered project, stacked in the one sidebar as the tree is today, each collapsible; the Administrator's project row carries the Mount and Unmount switch in its menu and a mark when unmounted. Users, roles, LLM connections and tasks are managed on this page as they are today (the Users fold, the role folders, the LLMs fold).
- **Starting the Host from the Desktop.** The Server menu's Start the Server Host runs `consensus serve` detached, over the same user folder, with the log in `~/.consensus/~logs/`; the item reads Open the Server Host while it runs, and Stop; a Host already running on the machine, started any other way, is found by its port and shown as running. A Personal license starts it with Scope Local; Professional may set Public (Step 6).
- **A mounted folder opened in the Desktop.** Open folder on a folder the registry lists as mounted, while the Host runs, connects the window to the Host's project instead of opening the folder (the Desktop reads the registry and asks the Host's `/api/me`); the window says so in its title bar. When the Host is not running the folder opens as a plain project.
- **The command line and the image.** `consensus serve` is the Host; the Dockerfile runs it. The `--scope` override and the trust settings stay as they are.

## Checks

`test/Api.test.js`: mount and unmount, the lists for a Member before and after, the Administrator alone on an unmounted project. `test/Ui.test.js`: the array of project-view, the switch. `test/Desktop.test.js`: Start the Server Host over a temporary folder, a mounted folder routed through it. The readme's starting and sharing sections follow.
