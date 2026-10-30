# Run the smoke

The smoke looks at the page and the four applications end to end, the way a person would after a build: it is run by hand,
never by `npm test`, because it needs the installed Chrome or Edge and Electron with a screen. The tests under
`test/` stay the record of what must hold; the smoke is the look that follows them.

## When

After a build that touches the page's shell (the title bar, the layout, the tree, the header, the threads pane, the
editors) or an application (`client/main.js`, `desktop/main.js`, their preloads, the Client's chooser), before the build log is posted. The
log says what the smoke found.

## The command

```
npm run smoke                     the page in a headless browser, then the Client, the Server, the Sidecar and the Desktop
npm run smoke -- --no-desktop     the page alone (no Electron, no screen needed)
```

Nothing of yours is touched: the page part runs a temporary server on a temporary data folder with a plan and two
threads; the application parts start Electron on temporary configs and their own `--user-data-dir`s, over their own
DevTools ports (9337 to 9340), and quit them at the end. Every folder is removed after.

Run it alone: beside the whole test suite (several browsers at once) its checks that compare a height within a pixel
or wait on a layout have stopped more than once, and passed on their own.

## What it prints

One line per check, `ok` or `FAIL`, then `SMOKE OK` or `SMOKE FAILED: n check(s)`; the exit code is 1 when any
check failed. The pictures land in `~smoke/` in the checkout (a tilde keeps the folder out of source control):

- `page-light.png`, `page-dark-monaco.png`: the page in a browser, the editor (CodeMirror, the default) in light and
  Monaco mode's Edit view in dark.
- `client-chooser.png`, `client-light.png`, `client-dark.png`, `client-detached.png`, `desktop-top.png` and the
  Server's and Sidecar's: the top 90 pixels of the windows, captured from the screen (Windows only), since the
  window buttons Electron draws over the title bar are not part of the page.

## The checks, and what a failure means

The page:

- **title bar**: the brand, the menu button, the waiting link and the look button are in `<title-bar>`; the menu in a
  browser lists About and Hotkeys only; the look popover has three selects and Escape closes it. A failure here is
  the title-bar or look-controls component, or `help.js`.
- **layout**: the layout grid starts under the bar and ends at the window's bottom, with no page scroll. A failure
  is the body column or `.layout` in `consensus.css`, or a stylesheet that gave the bar a margin.
- **tree, header**: the plan's row is open in the tree; the header shows the title, the location line and the size.
  A failure is the tree components or editor-header.
- **threads, editor**: both threads are listed with the filter at all; the plan opens in the CodeMirror editor with
  the two passages marked by state; it is the Live Preview with the Source button and no preview pane; the heading
  has Source, Revisions and Save and no Read, Edit or edit bar (the one view, plan Markdown Editor); the list renders
  with bullets; a drag along a line offers Copy, Comment and Start a new Subplan. A failure is edit-view,
  `mirror.js`, `live-preview.js`, the anchor map, selection-buttons or editor-header.
- **read, edit (Monaco mode)**: after the Editor setting is switched to Monaco in the popover, the Read view shows
  the two passages marked and Edit opens Monaco. A failure is document-editor, html-view or `editor.js`.
- **console**: no console errors on the page.

The Client:

- **chooser**: the app opens on the chooser with no `--connect`; the chooser has the overlay, its header is the drag
  region, its controls stop before the buttons, the overlay follows the header's height, and it offers the Servers
  alone (Connect to Server, the saved Server with Open; no Open folder, New project or recent folders), with Connect
  to Server enabled before any sign-in (the Server signs the person in). A failure is `connect.css`, `connect.js` or
  the chooser's template in `client/page/`.
- **project**: `Desktop.ServerProjects` tries the temporary server and lists its one project; `Desktop.ConnectServer`
  answers the project, and the page shows one project view, open, with no root head, the one Server root by its
  name, the session's Base `/servers/First`, the Server saved in client.json with that project as its last, and no
  address file in the project folder (the Client starts no server). A failure is `connect_server_here` or
  `save_server` in `client/main.js`, `electron/Servers.js`, or the single mode of `server-row` and `project-view`.
- **overlay**: `navigator.windowControlsOverlay` is visible and its area stops before the window buttons; the bar is
  exactly that wide and as high as the overlay; the bar is the drag region and its buttons are not; the window has
  no native title or menu bar. A failure is `window_options` in `client/main.js`, the chrome message, or
  `title-bar.css`.
- **menu, bridge**: the menu lists New window, Settings, Reload and Quit (Sign in… when the Server offers Clerk) and no
  folder item; `Desktop.NewWindow`, `Desktop.Quit`, `ConsensusDesktop.SetLicense` and `SetChrome` exist and
  `Desktop.PickFolder` does not; About names Consensus Client and lists the window's project alone. A failure is
  `client/preload.js`, `title-bar.js` or `help.js`.
- **theme, size**: the overlay follows a theme change (look at the captures: the buttons take the palette's colours)
  and the large size (the overlay's height follows the bar's). A failure is `ReportChrome` in `theme.js` or the
  chrome handler in `electron/App.js`.
- **detached**: a detached window has the overlay, the bar and no frame. A failure is the window-open handler's
  options in `electron/Windows.js`.
- **close, quit**: with a draft on the open tab, `Desktop.Quit` raises the close prompt naming the plan; Cancel keeps
  the app and the draft; with Confirm on close off, `Desktop.Quit` ends the app. A failure is the close handling in
  `electron/Windows.js`, the preload's `OnCloseRequested` and `CloseDecided`, or `hook_window_close` in `tabs.js`.

The Desktop:

- **signed out**: the window is Edition desktop with no SetLicense and no folder picker, and shows the sign-in box
  alone; the smoke then stands in for the sign-in (the servers are Local). A failure is `desktop/preload.js` or
  `session.js`.
- **the page**: no LLMs, Users or role folders; the menu has Servers… and Sign out and no Settings or folder item; the
  project menu has Explain and no settings, instructions, rename or delete; the server menu has Servers… and Reload;
  the title and About name Consensus Desktop. A failure is `roots.js`, `tree.js`, `title-bar.js` or the
  `client-servers` component.
- **a run**: the task button follows the run, a second press opens its popup with Stop and the output as it comes, a
  notice names the end, Done sits beside the button, and My runs lists it. A failure is the `client-runs` component.
- **Add server**: the second server is saved under its own name, the same address is refused, two roots show after
  the reload, desktop.json holds both Servers and nothing else, and no user.json is written. A failure is
  `add_server` in `desktop/main.js` or `electron/Servers.js`.
- **quit**: `Desktop.Quit` ends the app.

If the project does not open the Client's smoke stops at the chooser: the temporary server did not answer the
probe, which the Client's console says more about (`npm run client -- --config <folder>`).
