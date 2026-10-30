# Step 5.1: The swap

Part of Step 5: The editions cut, the first of its three builds, built on "build step 5.1", reported in its own build log and committed on its own acceptance. The four editions as the owner cut them on 2026-10-29: Sidecar opens a local folder; Client opens one remote project on one Server; Desktop opens several remote projects at a time from one or more Servers, never a local folder, at Personal; Server opens local folders and serves them to the others. Every edition serves the API, MCP and the instructions on its localhost address.

## What changes

The code has the Client and the Desktop the other way round, so the code bases swap rather than being rewritten:

- **desktop/** takes today's client code (main.js, Settings.js, preload.js): the Servers list, one sign-in through our Clerk instance, every added Server a root with its whole tree, New window on the same list. Titles, settings file (desktop.json: Servers, Theme, Scale, Remembered) and build/desktop.json follow. It sheds nothing of the client code; it gains the Personal check below.
- **client/** takes today's desktop code and is narrowed: one Server and one project per window, picked in the chooser (the Servers section of desktop/page/connect.html, over electron/Servers.js and src/Probe.js) or named on the command line: consensus-client [--connect <server> [<project>]] [--config <folder>], through App.Arguments with Rest false, --connect taking the saved Server's Name (the address is in client.json) and an optional second word, the project's id or name on it, else the Server's last project for that entry, else the chooser's project list; with no --connect the chooser; --port goes (the Client has no server of its own, its page server picks a free port, remembered) and a bare folder is refused as "not an argument the Client knows" (decided 2026-10-29); no local folders (open_folder_here, New project, the recent folders, desktop/Host.js and its routing, START.Run and the sidecar start leave), no Hosts file of its own (client.json: Servers with their last project, Theme, Scale, Remembered). Registered is the minimum, checked as today on the sign-in.
- **sidecar/** and **server/** are unchanged by the swap.
- Nothing shipped carries the old files, so there is no migration: each app reads its own file by its own name, and an older desktop.json with Recent and Hosts is read for Theme, Scale and Remembered alone (Fill leaves Recent and Hosts out and the next save drops them); today's client.json's Servers are the new Desktop's Servers as they are, the file being the same shape (decided 2026-10-29: no migration, the old Hosts are not carried over).

## Also

- The editions table in the Readme and docs/guide/features.md say the cut; the Client's guide and the Desktop's pages say the new roles.
- The Desktop's sidecar of before is gone with the desktop code's routing: the Desktop has no address file; bin/mcp.js's folder form (consensus mcp <folder>) stays for the Sidecar.
- The Electron smoke covers each app's start in its new role (run on the owner's word).

## Checked by

test/Client.test.js and test/Desktop.test.js rewritten for the swapped roles: the Desktop's Servers list and settings file, the Client's one Server and one project, its command line through App.Arguments (--connect with and without the project, --port and a bare folder refused), both settings files over the base Settings; test/Scaffold.test.js's Arguments cases follow the apps. The whole suite.

## Decided before the build

Everything, on Step 5's design turn of 2026-10-29 (its six threads); nothing further to design here.