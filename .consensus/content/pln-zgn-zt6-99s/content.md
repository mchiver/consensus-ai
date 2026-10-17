# Step 1: Live Preview

The first step of plan Markdown Editor: the Live Preview in the CodeMirror editor, with the Source toggle, and the preview pane gone from the Edit view in CodeMirror mode (points 1 to 3 of the parent). Monaco mode changes nothing.

## Decided in the parent

- Point 1: with the Editor setting on CodeMirror, Live Preview is the view of a plan or document and a Source toggle switches it to plain markdown, as Obsidian's does. With the setting on Monaco the page keeps today's shape.
- Point 2: CodeMirror is the Live Preview's engine; Monaco stays, with the Editor setting, as the backup; nothing of Monaco or of today's views is removed in this plan.
- Point 3: the first cut renders headings, emphasis, inline code, links, bullet and numbered lists, task checkboxes, blockquotes, fenced code blocks, horizontal rules, tables and images; an image shows as a widget with the source back when the cursor is on its line; a table is a block widget while the cursor is outside it and source while inside, the way fenced code blocks are handled; editing a table in its rendered grid is out.
- The build line: the decorations that render the markdown in place in the CodeMirror editor, with the Source toggle; the preview pane goes from the Edit view.

## Decided before the build

1. public/js/live-preview.js, an ES module beside anchormap.js, imported by codemirror-bundle.js and put on window.CodeMirror6.LivePreview; it exports Extension( Options ). In mirror.js, Create takes Options.Preview and the instance gains SetPreview( On ), a Compartment reconfigured in place, keeping the text, the cursor, the scroll and the undo history; the comment boxes never take it.
2. A StateField of decorations over the whole document, rebuilt when the document changes or the revealed lines change; not a ViewPlugin, since the table and image widgets are block decorations. The tree from syntaxTree, with ensureSyntaxTree and a small budget.
3. A line that any selection range touches shows its source; a fenced code block or a table shows its source whole when a range touches any of its lines. A click into rendered text puts the cursor there and the line reveals. No atomic ranges.
4. Off the cursor's line: headings in the Read view's sizes with the marks hidden (setext underlines too); emphasis, strong and strikethrough marks hidden; inline code monospace on the panel background, backticks hidden; links as their text in the accent, underlined, Ctrl+click (Cmd on a Mac) opening the URL in a new tab; autolinks styled; bullets in place of -, * and +, indentation kept, ordered numbers kept; task markers as checkboxes that toggle the source on click; blockquotes with a left border and the muted colour, the > hidden; fenced code with the fences hidden behind a thin language label, the code monospace on the panel background and editable; horizontal rules as a rule; tables as a block widget of marked's HTML in the Read view's table styles, a click putting the cursor on the first line; images as the image with the alt as tooltip, the alt text on failure; escapes with the backslash hidden.
5. Left as source: HTML blocks and tags, link reference definitions and reference links' labels, entities, hard breaks, footnotes.
6. Live Preview takes the page's prose font and size, no line numbers, no fold gutter, the faint active line kept; Source mode is the editor as today. The anchors' marks look the same in both.
7. A Source button in the edit bar where Monaco's Preview button is (id source-toggle, pressed when on); State.Source remembered under source-mode, shared like the Editor setting; off by default. Step 3 moves it into the heading and gives it Ctrl+E.
8. In CodeMirror mode the Edit view is the editor alone: no preview pane, splitter or Preview button; the key preview-hidden-codemirror goes. Monaco mode keeps all three.
9. The anchors are unchanged: mapped through the anchor map, spanning hidden ranges when they must, the mousedown selecting the thread, off while the text differs from the saved one.
10. The preview's classes (cm-live-h1 to h6, cm-live-code, cm-live-fence, cm-live-quote, cm-live-rule, cm-live-table, cm-live-image, cm-live-check) in edit-view.css over the palette variables and the article's sizes; the font switch in mirror.js's theme.
11. Tests: live-preview.js exports Plan( Source, RevealedLines ), the decorations as ranges with kinds, run in node by test/LivePreview.test.js over a fixture with every construct; browser tests in Ui.test.js for the hidden and revealed marks, the Source toggle and its memory, the checkbox edit, the table widget and its reveal, an image, the thread marks and Save; the smoke checks the Live Preview opens with the Source button and the marks. The node tests and Monaco's path untouched.
12. Out of this step: the heading and the Read and Edit buttons, the threads' functions in the editor, the hotkeys, the guide.

## What this step leaves as it is

The Read and Edit buttons, the edit bar's Save and Discard, the threads' marks and the click that selects a thread (plan UI Components, Step 3), the hotkeys and the heading: Steps 2 to 5 take those. The comment and reply boxes are plain boxes and stay so.
