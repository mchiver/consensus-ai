# Step 3: The Server window on electron/Windows.js

The Server application's window becomes a window of the shared kind: frameless, the window buttons over the page's title bar following the palette, the page asked before a dirty document is lost, the report window with Print to PDF and View in Browser. Its tray, its single instance and its gate stay as they are.

## What changes

- **server/main.js**: create_window uses WINDOWS.Options and WINDOWS.Attach with the Server's preload and icon; WINDOWS.AttachChrome; the print-pdf and view-in-browser handlers through electron/App.js (Step 2). The window's close keeps hiding it (the Server serves from the tray), so Attach takes OnClose: 'hide' for this app; the tray's Quit asks the page first (AskToClose) and quits when it agrees.
- **The page through the page server.** The Server window loads the page from electron/Page.js on its own loopback origin with one root, Key server, forwarded to the Server's address, as the other three windows do; ViewInBrowser then finds the report's address as it does for them, and every edition's window has the same shape. The sign-in in the window keeps working: the forwarder sends X-Forwarded-Host, which Api.js already honours over the loopback.
- **server/preload.js** exposes the same bridge as the other apps: window.ConsensusDesktop with Base, Version, Theme, Scale, Roots, Project null, Remembered, SetTheme, SetScale, Remember, SetChrome, OnCloseRequested, CloseDecided, PrintToPdf, ViewInBrowser, SetLicense and ClearLicense, plus Edition: 'server'. The bridge gains one field everywhere, Edition ('desktop', 'sidecar', 'client', 'server'), which roots.js reads for the product name in place of the three flags Sidecar, Client and the absence of both; window.ConsensusServer goes. The Server's theme and remembered state live in <config>/server.json through the base Settings of Step 2.
- **build/server.json** adds electron/** to its files.

## Checked by

test/ServerApp.test.js: the window options are the shared ones, the preload exposes the bridge with Edition server, the page server forwards to the Server; the Electron smoke over DevTools (bin/smoke.js) opens the Server window and reads the overlay colours and the Edition.

## Decided before the build

The move itself, from the review's thread. Proposed defaults, for the design turn: the page through the page server rather than loaded from the Server's address; the Edition field replacing the Sidecar and Client flags; server.json for the Server's look and remembered state.