# UI Tweaks V

Tweaks to the desktop's page after UI Tweaks IV, with one server change under them: export and import extended from
projects down to folders and items, so that the tree's Copy and Paste work on export json through the system
clipboard. The page work is in the desktop's copy, `desktop/page/`, and its main process; the server is touched
for the Draft state and the item ports only; `public/` stays frozen. Built as one plan, in the order below, each
step with its tests.


## 1. The Draft state (server)

- `DEFAULT_STATES` in `src/Participants.js` becomes Draft, Plan, Working, Finished. A new plan starts in the first
  state, as today.
- **Startup migration**, once, in `Start` (`src/Server.js`) after the settings are read: when `States` names
  Proposal and not Draft, Proposal is replaced by Draft in the settings (written back) and every plan whose State is
  Proposal is set to Draft, through the store, with no revision (a state change makes none today either). A server
  whose owner named other states is left alone. Logged as one line.
- The docs follow: the guide's settings and projects pages, the readme, and the Consensus project's Readme on the
  server after the build.
- Tests: the default list (`Participants.test.js`); the migration over a temporary folder with a plan in Proposal,
  and that a list without Proposal is untouched (`Store.test.js` or a new `Server.test.js`).


## 2. Export and import of folders and items (server)

The project file format (`src/ProjectPort.js`: Format, Version, Exported, Project, Proposals) is reused as it is.

- **`GET /api/items/<id>/export`**: a folder, a plan or a document, as one file. `Project` is a project record
  made for the file: a fresh project id, the item's name as `Name`, `Context: null`, `ContextFolder: null` and
  `Items: [ the node ]`; `Proposals` holds every plan, subplan and document under the node, whole, as a project's
  export holds them. The Readme and the Context folder cannot be exported this way (409, as they cannot be copied).
  The owner or the llm, as for a project.
- **`Check` and `Import` accept a file with `Context: null`**: imported as a new project or as a copy, it gets a
  fresh, empty Readme; merged into a project here, the Readme is left alone.
- **`POST /api/projects/import` gains `Into: { Project, Parent }`**: the file's items are written into that project,
  at its root or in the folder `Parent`, every id new (the id mapping of a copy import), and the file's Readme and
  Context folder are left out. A real project's file (one with a Context) goes in as one new folder named after the
  project, holding its folders and plans; an item's file goes in as its node. `Preview: true` with `Into` answers
  what would be made (the counts) and nothing is written. The answer is the import report, with the ids written, and
  the change events the tree needs.
- `POST /api/items/<id>/copy` stays for the API's own use; the page no longer calls it.
- Tests (`ProjectPort.test.js`, `Api.test.js`): a folder's export holds its subplans and documents; a plan's export
  holds the plan and its subplans; a file imports into a root and into a folder with new ids and the counts in the
  report; a project's file pastes as a folder; a file with `Context: null` imports as a new project with an empty
  Readme; the Readme is refused.


## 3. The clipboard and Export on the page

`desktop/page/js/sidebar.js` and `ports.js`. The in-page clipboard (`$scope.Clipboard`, `{ Id, Name }` and the
server-side copy) goes away.

- **Copy** on a project, folder, plan or document fetches its export (a project's through the project route, an
  item's through the new one) and puts the json on the system clipboard (`navigator.clipboard.writeText`, pretty
  printed with tabs, as the export popup shows it). A short "copied" mark on the row, as the export popup's Copy
  gives.
- **Paste** on a project (its root), the Context folder or a folder reads the clipboard
  (`navigator.clipboard.readText`): text that parses as an export file is imported with `Into` the target; anything
  else is refused with a line under the row ("the clipboard holds no Consensus export"). Paste is always enabled,
  since the clipboard cannot be looked at without reading it. The tree reloads from the import's events; the target
  project becomes the open one.
- **Ctrl+C** on the tree (no text selected, not typing) copies the open item's export; **Ctrl+V** pastes into the
  open project's root. As today, but through the system clipboard.
- **Export** on a project, folder, plan or document opens the export popup (`ports.js`) with the json, to copy or
  download; the file is named after the item. `StartExport` takes the item and its kind.
- A browser that refuses the clipboard (no permission, no focus) shows the export popup instead, so Copy never fails
  silently.
- Tests: the import with `Into` is covered by the API tests. The desktop page has no browser test (`Ui.test.js`
  drives the frozen `public/`): Copy, Paste and Export are checked by hand in the app, and the build log says what
  was tried.


## 4. The tree's menus

`desktop/page/js/sidebar.js`: the menus read exactly as the lists below. "New Draft" is labelled "New " + the first
of the settings' States, so with the defaults it reads "New Draft".

- **Project**: New Folder, New Draft, ---, Copy, Paste, Rename, Export, ---, Delete. New Folder and New Draft create
  at the root. Delete stays disabled for the default project and for a project holding anything but its Context.
- **Context folder**: New Document, New Workspace, New LLM, ---, Paste. New Workspace and New LLM are the desktop's
  items (shown when `DesktopItems.Available`); Paste takes documents into the Context folder and refuses the rest, as
  the import does.
- **Folder**: New Folder, New Draft, ---, Copy, Paste, Rename, Export, ---, Delete. New Folder and New Draft create
  in the folder.
- **Plan**: New Subplan, New Comment, ---, Copy, Rename, ---, Delete. New Comment opens the plan in Read (its tab)
  and starts a whole-document comment, as the header's New Comment does (`State.StartCompose( null )` once the plan
  is open).
- **Document** (a Context document other than the Readme): Copy, Rename, ---, Delete.
- The LLM and workspace rows keep their menus. The Readme has none, as today.


## 5. Threads and the selection

- **The selected thread stays listed** (`threads.js`): `Threads()` returns the filter's matches plus the selected
  thread, at its place in the text order; the watch that deselects a hidden thread is removed. Clicking anchored
  text selects as today (`read.js`); a change of filter keeps the selection.
- **Copy on a selection** (`read.js`, `index.html`): a third button beside Comment and Start a new Subplan, shown
  for plans and documents alike, that puts the selected text on the clipboard as it reads (`selection.toString()`),
  then clears the selection and the buttons. While a thread is being re-anchored, only Re-anchor here shows, as
  today.
- **The threads toggle moves to the tabs row** (`index.html`, `tabs.js`, `consensus.css`): a small icon button at
  the right end of the tabs row, the mirror of the tree toggle at its left (the sidebar icon flipped), shown for a
  plan and hidden for a document; the header's Threads button goes. The same `State.SetThreadsHidden`.
- Checked by hand in the app: the selected thread listed under a filter that leaves it out, Copy's text, the
  toggle in the tabs row.


## 6. The connection panel

`index.html` (the sidebar's bottom) and `consensus.css`: the panel shows the connected server's address without
the scheme (`window.ConsensusDesktop.Server.Url`, `cube4:3500` for example; in a browser, the page's own host),
with the connection's Name and the server's Version in its tooltip. Live or offline stays as the dot's colour and
the first words of the tooltip.


## 7. The view state per server, and the theme

- A **`Stored` service** (`desktop/page/js/stored.js`, loaded first) wraps localStorage with a prefix: per-server
  keys are `consensus.<server url>.<name>`, shared keys `consensus.<name>` as today. The server is
  `window.ConsensusDesktop.Server.Url`; in a browser the prefix is empty, since the origin is the server.
- **Per server**: the open project, the folded folders, the sort and show-updated (`sidebar.js`); the tabs and the
  active one (`tabs.js`, moved from sessionStorage to localStorage, so a restart brings them back). A detached
  window keeps its own copy as today.
- **Shared**: the pane widths (`layout.js`), the hidden panes and the highlight (`app.js`), the scale.
- **Tabs whose item is gone**: once the list is loaded, a remembered tab whose item is in no project (nor among the
  desktop's LLMs and workspaces) is dropped silently; the active tab falls back to the first.
- **The theme**: `desktop/Settings.js` keeps `Theme` as the default and gains a `Theme` on each entry of `Servers`
  and on `Local`. `boot_info` hands the page the connected server's theme, or the default when it has none; the
  page's picker sends `theme` as today and `main.js` stores it on the connected server's entry; the connect screen's
  picker sets the default. The native bars follow the theme in use.
- Tests (`Desktop.test.js`): a server's theme filled, checked and written; the boot theme for a server with and
  without one.


## 8. Docs, readme and the finish

- The guide pages touched: settings (the states and the migration), projects (the menus, the clipboard, the export
  of folders and items), threads (the selected thread, Copy), api (the item export, `Into`).
- The readme's desktop section: the per-server view state and theme, the clipboard.
- All tests run (`node --test`); the build log names the files and the tests, and which model built it.
