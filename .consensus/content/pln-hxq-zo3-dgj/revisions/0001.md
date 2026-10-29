# Step 4: The dead code out

What the review found nothing reads, taken out. Nothing changes in what the apps do.

## What goes

- public/js/stored.js: ServerKey and the page's-own-server scope (Read, Write or Remove with true); key_of takes a root or the shared scope alone.
- desktop/main.js: the fs require and overlay_for_theme (both leave with Step 5's rewrite in any case; they go here if this Step is built first).
- sidecar/preload.js: the OpenRecent stub.
- Off the export lists, used inside their module alone: Windows.js WebPreferences, IsReportUrl, AskToClose and CLOSE_ANSWER_WAIT; Page.js DEFAULT_FOLDER (and the Folder field Serve answers); Host.js Probe (superseded by src/Probe.js in Step 2); License.js FromClaims; Instructions.js GUIDE_PATH.
- The constants nothing reads stay exported, as the review decided: an export line documents a module's vocabulary.
- desktop/Host.js loses its name clash with src/Host.js by leaving with Step 5 (the Desktop no longer routes folders); if this Step is built first it is renamed desktop/ServerStatus.js.

## Checked by

The whole suite; the dead-export check of the review run again (a script over module.exports and every reader outside the module) shows no function exported and unread.

## Decided before the build

The list above, from the review. Nothing is open.