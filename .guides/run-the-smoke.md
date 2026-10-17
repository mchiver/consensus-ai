# Run the smoke

The smoke looks at the page and the desktop end to end, the way a person would after a build: it is run by hand,
never by `npm test`, because it needs the installed Chrome or Edge and Electron with a screen. The tests under
`test/` stay the record of what must hold; the smoke is the look that follows them.

## When

After a build that touches the page's shell (the title bar, the layout, the tree, the header, the threads pane, the
editors) or the desktop (`desktop/main.js`, `preload.js`, the connect screen), before the build log is posted. The
log says what the smoke found.

## The command

```
npm run smoke                     the page in a headless browser, then the desktop
npm run smoke -- --no-desktop     the page alone (no Electron, no screen needed)
```

Nothing of yours is touched: the page part runs a temporary server on a temporary data folder with a plan and two
threads; the desktop part starts Electron on a temporary config (`--config`, `--port 0`) and its own
`--user-data-dir`, over its own DevTools port (9337), and quits it at the end. Both folders are removed after.

Run it alone: beside the whole test suite (several browsers at once) its checks that compare a height within a pixel
or wait on a layout have stopped more than once, and passed on their own.

## What it prints

One line per check, `ok` or `FAIL`, then `SMOKE OK` or `SMOKE FAILED: n check(s)`; the exit code is 1 when any
check failed. The pictures land in `~smoke/` in the checkout (a tilde keeps the folder out of source control):

- `page-light.png`, `page-dark-monaco.png`: the page in a browser, the editor (CodeMirror, the default) in light and
  Monaco mode's Edit view in dark.
- `desktop-light.png`, `desktop-dark.png`, `desktop-detached.png`, `desktop-connect.png`: the top 90 pixels of the
  desktop window, captured from the screen (Windows only), since the window buttons Electron draws over the title
  bar are not part of the page.

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

The desktop:

- **overlay**: `navigator.windowControlsOverlay` is visible and its area stops before the window buttons; the bar is
  exactly that wide and as high as the overlay; the bar is the drag region and its buttons are not; the window has
  no native title or menu bar. A failure is `window_options` in `desktop/main.js`, the chrome message, or
  `title-bar.css`.
- **menu, bridge, hotkeys**: the menu lists the desktop items; `Desktop.OpenFolderWindow`, `Desktop.Quit` and
  `ConsensusDesktop.SetChrome` exist; Help > Hotkeys lists the desktop's six rows. A failure is `preload.js` or
  `hotkeys.js`.
- **theme, size**: the overlay follows a theme change (look at the captures: the buttons take the palette's colours)
  and the large size (the overlay's height follows the bar's). A failure is `ReportChrome` in `theme.js` or the
  chrome handler in `main.js`.
- **detached**: a detached window has the overlay, the bar and no frame. A failure is the window-open handler's
  options.
- **connect**: the connect screen has the overlay, its header is the drag region, its controls stop before the
  buttons, and the overlay follows the header's height. A failure is `connect.css` or `connect.js`.
- **close, quit**: with a draft on the open tab, `Desktop.Quit` raises the close prompt naming the plan; Cancel keeps
  the app and the draft; with Confirm on close off, `Desktop.Quit` ends the app. A failure is `ask_page_to_close`
  in `main.js`, the preload's `OnCloseRequested` and `CloseDecided`, or `hook_window_close` in `tabs.js`.

If the desktop opens on the connect screen the smoke stops: its own server did not start on the temporary config,
which the desktop's console says more about (`npm run desktop -- --config <folder> --port 0`).
