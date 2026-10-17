# Step 3: CodeMirror Editor

The third step of plan UI Components: the Edit view using CodeMirror 6, with its anchors and the Editor setting (item 5.4 of the parent).

## Edit view using CodeMirror 6

Displays the colorized text anchors; a click focuses the thread; can be toggled to replace the Monaco editor; by default hides the Html view.

Decided: this plan builds the CodeMirror 6 editor as a component beside Monaco, in source mode, with the anchors coloured and clickable. The choice of editor is a setting in Settings (Editor: Monaco or CodeMirror), remembered in the browser as the look is. With CodeMirror the preview starts hidden; the Preview button shows it. The anchors' Found positions, which the server finds in the rendered plain text, are mapped onto source offsets by a map built from CodeMirror's markdown syntax tree, deriving the plain text the way the server's Anchors.PlainText does; a thread whose plain text disagrees is shown in the list without a highlight. Monaco does not get the anchors.

The reply and compose boxes (Step 1) follow the same setting, in their plain mode.
