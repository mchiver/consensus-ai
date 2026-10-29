# Step 1: The correctness fixes

The fixes that stand on their own, from the review's Correctness findings. Nothing here changes a design.

## What changes

1. **The Server window's first sign-in** (server/main.js, the set-license handler). The record before the write is read once and compared field by field (Clerk id and Plan) with a null check; no JSON round trip. A first sign-in with no user.json writes the user, checks the gate again and reloads the page as any later one does.
2. **The Client's dead menu item** (electron/Windows.js BuildMenu). BuildMenu leaves out an item whose action is not given: the Client passes no OpenFolderWindow, so neither the item nor Ctrl+Shift+O exists there.
3. **The Desktop-only check in the shared module** (Windows.AskToClose). The connect.html test leaves Windows.js: Attach takes an option, AsksPage( url ), the Desktop giving one that says no for its chooser; without the option every page is asked.
4. **The versions**: desktop/package.json goes to 0.5.1, and a test asserts the four app manifests carry the root's version.
5. **The flaky Details test** (test/Ui.test.js, the connection's Key box): the typed key is awaited in the box before Save, and the connection is deleted in a finally, so a failure no longer leaves a connection for the next test to find.
6. **The Readme's Purpose line**: "Security is relaxed for now: a request with no token is the owner" becomes the present rule: a request with no token is the owner on a project's own server and in the Sidecar; a Server refuses it.

## Checked by

The whole suite; a new test on set-license with no user.json (test/ServerApp.test.js or a unit over the handler's function once it is taken out of attach_handlers); BuildMenu with and without the folder action (test/Desktop.test.js); the versions test.

## Decided before the build

The six items above, as the review decided them. Nothing is open.