# Step 5.2: The Personal check

Part of Step 5: The editions cut, the second of its three builds, built on "build step 5.2", reported in its own build log and committed on its own acceptance. The four editions as the owner cut them on 2026-10-29: Sidecar opens a local folder; Client opens one remote project on one Server; Desktop opens several remote projects at a time from one or more Servers, never a local folder, at Personal; Server opens local folders and serves them to the others. Every edition serves the API, MCP and the instructions on its localhost address.

## What changes

The Desktop signs in through Clerk in the page, as the Client does today, and the session's plan is the tier (Session.Plan). Below Personal the page shows the sign-in box with the license message (the Refusal shape session.js already has, Error license, Plan personal) in place of the Servers; the Servers popup and the roots are not loaded. The Desktop also hands the session token to the app (SetLicense), which writes the machine's current user (electron/CurrentUser.js), so the Server application on the same machine sees the sign-in; nothing in the Desktop reads that file for its own gate.

## Also

- docs/guide/features.md says the Desktop's minimum is Personal, the Client's Registered.

## Checked by

The Personal gate in the page: test/Ui.test.js with a stand-in session plan below and at Personal (the sign-in box with the license message in place of the Servers; the Servers popup and the roots not loaded below it); the Desktop's SetLicense writing the machine's current user through electron/CurrentUser.js (test/Desktop.test.js). The whole suite.

## Decided before the build

Everything, on Step 5's design turn of 2026-10-29 (its six threads); nothing further to design here.