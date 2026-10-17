# Step 3: CodeMirror Editor

The third step of plan UI Components: the Edit view using CodeMirror 6, with its anchors and the Editor setting (item 5.4 of the parent).

## Edit view using CodeMirror 6

Displays the colorized text anchors; a click focuses the thread; can be toggled to replace the Monaco editor; by default hides the Html view.

Decided: this plan builds the CodeMirror 6 editor as a component beside Monaco, in source mode, with the anchors coloured and clickable. The choice of editor is a setting in Settings (Editor: Monaco or CodeMirror), remembered in the browser as the look is. With CodeMirror the preview starts hidden; the Preview button shows it. The anchors' Found positions, which the server finds in the rendered plain text, are mapped onto source offsets by a map built from CodeMirror's markdown syntax tree, deriving the plain text the way the server's Anchors.PlainText does; a thread whose plain text disagrees is shown in the list without a highlight. Monaco does not get the anchors.

The reply and compose boxes (Step 1) follow the same setting, in their plain mode.

## Decided before the build

1. Getting CodeMirror 6 into the page with no build step: its packages (@codemirror/state, view, language, commands, search, lang-markdown; @lezer/common, highlight, markdown, lr; style-mod, w3c-keyname, crelt, @marijn/find-cluster-break) are npm dependencies, pinned like monaco-editor; each package's dist folder is served at /vendor/codemirror/<package>/ from where require resolves it (attach_vendor in Server.js, shared by the desktop's page server); an import map in index.html names the bare specifiers; one module script of ours, public/js/codemirror-bundle.js, imports what the page uses and puts it on window.CodeMirror6 for the plain scripts. Nothing is bundled or copied.

2. One Edit view, two engines: monaco-edit becomes edit-view, the same template and controller, with the editor behind one small interface, Create( Element, Text, OnChange ), Get, Set, Focus, Layout, Dispose, and for the comment boxes Plain( Element, Text, OnChange, OnSubmit ) returning { Get, Set, Focus, Dispose, LineHeight }. Two factories give it: Editor (Monaco, wrapped to the interface) and Mirror (CodeMirror). The setting picks the factory when the view opens; a change of setting takes effect at the next open.

3. The setting is the browser's, like the theme and the size: an Editor select beside Theme and Scale at the bottom of the sidebar (Monaco, CodeMirror), remembered under consensus.editor, default Monaco for now. The preview's hidden flag is remembered per engine: Monaco keeps preview-hidden as it is; CodeMirror has its own, starting hidden, and the Preview button shows it.

4. The anchor map: from the Lezer markdown tree of the source, the text of the content nodes is kept and the syntax skipped (heading, emphasis, code and link marks, URLs, list and quote marks, HTML tags, image syntax), entities and backslash escapes decoded, whitespace collapsed as the server does, and every kept character carries its source offset. The result is checked against the plain text the client computes the server's way (marked is in the page; Anchors.PlainText's regexes port as they are). Equal: each thread's Found Start and End map to source offsets. Not equal: no highlights in the editor for that text (the threads stay listed), and a console line names the first differing position. The map is an ES module of its own, public/js/anchormap.js, used by the bundle and imported by a node test that runs it over a corpus (the docs guide's pages, the Consensus project's texts) against src/Anchors.js's own PlainText.

5. Highlights in the editor: a StateField of mark decorations (class anchor, the state, selected, several, data-threads as the html-view's marks carry), set by an effect when the plan loads, the selection changes or Highlight changes, and mapped through the document's changes as you type, so the marks follow the text until Save, when the server finds the anchors again and the field is reset. A mousedown on a mark selects its thread (the next one on a passage of several, as the html-view does) and scrolls its card into view. No selection buttons in the editor in this step.

6. The CodeMirror editor has line numbers, the fold gutter (headings fold), line wrapping, history, the default and search keymaps (find and replace, Ctrl+F), indent with Tab, multiple selections, the active line, markdown highlighting from the default style; Ctrl+S saves through a keymap, Ctrl+E reaches it through the page's hotkeys, whose in_editor learns .cm-editor beside .monaco-editor. The theme is built from the page's palette variables (background, text, muted, panel, accent) in a Compartment reconfigured on consensus-theme, dark or light as the page is.

7. The comment boxes follow the setting: comment-editor asks the chosen factory for Plain; the CodeMirror box has wrapping, no gutters, Ctrl+Enter in its keymap, the same height and grip. The two Plain boxes share the { Get, Set, Focus, Dispose, LineHeight } shape, so the component does not know which it holds.

8. Styles: CodeMirror's own .cm-editor rules are in the theme (JavaScript); the editor box in edit-view.css takes both engines; the anchor classes inside .cm-content reuse html-view's colours (the same variables) in edit-view.css.

9. Checkpoints: (1) the vendor route, the import map, the bundle module, the Mirror factory with Create and Plain, and the anchor map with its node test; (2) edit-view with the engine interface, the Editor factory wrapped to it, the setting in the sidebar, the per-engine preview flag; (3) the highlights and the click in the editor, comment-editor on the chosen engine, the hotkeys and the theme; (4) the browser tests and the screenshots.

10. The smoke: the anchor map's node test over the corpus; the browser tests gain one: the setting switched to CodeMirror, Edit opens a .cm-editor whose marks count the threads with a position, a mark's click selects the thread, typing before a mark keeps it on its words, Ctrl+S saves and the marks are found again, the preview is hidden by default and shows on the button, the reply box is a CodeMirror box and Ctrl+Enter posts; Monaco's tests unchanged with the setting at Monaco. Screenshots of the CodeMirror Edit view with the marks, light and dark.
