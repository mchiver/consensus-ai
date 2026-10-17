# Step 2: The Threads in the Editor

The second step of plan Markdown Editor: everything the Read view does with the threads, done in the CodeMirror editor (point 4 of the parent): the thread card scrolling the editor to its passage, the selection buttons (Copy, Comment or Re-anchor here, Start a new Subplan), the flash from a search hit or a waiting item. Monaco mode and the Read view keep theirs.

## Decided in the parent

- Point 4: the passages highlighted (done), a click selecting the thread and scrolling its card into view (done), the thread card scrolling the editor to its passage, selecting text offering Copy, Comment and Start a new Subplan (or Re-anchor here), and a search hit or a waiting item flashing its passage. Anchors stay the server's, found in the rendered plain text; the anchor map stays the bridge, and a thread whose plain text disagrees is listed without a highlight, as now.

## Decided before the build

1. AnchorMap gains PlainRange( Map, From, To ), the plain characters inside a source span as { Start, End } (null when none), the reverse of SourceRange; the making of { Text, Prefix, Suffix } from a plain range moves out of Render.SelectionAnchor into Render.AnchorOf( Plain, Start, End ), used by both views. PlainRange is tested in node.
2. A selection-buttons component (bindings: anchor, text, at) holds Copy, Comment or Re-anchor here, and Start a new Subplan, with the actions moved out of html-view; html-view and edit-view compute the anchor, the text and the position and show it; the ids stay on the Read view's.
3. The editor offers them on a non-empty main selection once the mouse is up or a keyboard selection rests, under the selection's end; hidden on any edit or a collapsed selection. Copy always, copying the text as it reads; Comment and Start a new Subplan only while the text is the saved one; in Source mode too.
4. A thread-selected that did not come from a mousedown in the editor scrolls the editor to the mark, centred, and flashes it: a flash effect on the anchor field adding a class for a second, the keyframes in edit-view.css. The Read view keeps its scroll.
5. html-view's main one settles State.Pending only when Read is shown; edit-view settles it when Edit is: Select selects, scrolls and flashes; Scroll finds the text in the map's plain and flashes a temporary mark; Compose starts a comment on the whole document.
6. The re-anchor hint moves into document-editor, above whichever view is shown; Re-anchor here among the editor's buttons posts the anchor and selects the thread.
7. New Comment and Ctrl+Shift+C are offered in the CodeMirror Edit view too ("a plan open, not archived").
8. A click off a mark in the editor does not deselect the thread; Escape does.
9. A document: no marks, Copy alone, in both views.
10. Tests: node, PlainRange against SourceRange both ways; browser, the three buttons on a selection, Comment with the anchor's words, Start a new Subplan, Re-anchor here, the header's anchor words scrolling and flashing, a waiting item's flash, Copy alone on a dirty text; the smoke, the buttons on a selection.
11. Out of this step: the Read view's removal in CodeMirror mode (Step 3).

## What this step leaves as it is

The Read view and its html-view keep all of this for Monaco mode; the heading and the views stay until Step 3.
