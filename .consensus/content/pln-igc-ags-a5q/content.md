# Step 3: One View

The third step of plan Markdown Editor: in CodeMirror mode a plan or document opens in the editor; Read and Edit give way to the Source toggle, Revisions beside it; read-only for archived plans and old revisions; the live revision taken silently when the text is clean; the dirty dot on the tabs; the hotkeys (points 1, 5, 6 and 9 of the parent). Monaco mode keeps today's Read and Edit behind the Editor setting.

## Decided in the parent

- Point 1: Live Preview is the one view in CodeMirror mode; Reading view goes from that mode.
- Point 5: Read and Edit stay, shown only while the Editor setting is Monaco; in CodeMirror mode the Source toggle stands in their place. Revisions stays as it is, the text at a revision shown in the editor read-only; an archived plan opens read-only. A document opens in the same editor, without threads. Save stays a button, disabled when the text is clean; a dot on the tab's label while it is dirty.
- Point 6: typing never makes a revision; Save (Ctrl+S) does. A new revision arriving while the text is on screen: with no unsaved edit the editor takes it silently, keeping the cursor and the scroll; with an unsaved edit, the Stale banner with Discard. No merge.
- Point 9: Ctrl+E becomes the Source toggle in CodeMirror mode and keeps its meaning in Monaco mode; Ctrl+S stays Save; Ctrl+Shift+C stays.

## Decided before the build

1. State.View keeps read, edit and revisions. In CodeMirror mode read and edit are the one editor: document-editor shows edit-view for both and the html-view section in Monaco mode only; a tab left in Read stays Read in its memory. The checks that read "State.View === 'edit'" become "the editor is shown".
2. The heading: in Monaco mode Read, Edit, Revisions as today; in CodeMirror mode Source (a toggle, id view-source) and Revisions, with Save (id save-button, disabled when clean) and Discard (while dirty) moved from the edit bar into the first row. The edit bar goes in CodeMirror mode; the Stale banner stays above the editor; the "Editing revision N" line goes. Monaco mode keeps its edit bar.
3. An archived plan opens with editing off (a Mirror option), no Save, Source still toggling. Revisions in CodeMirror mode shows the revision's text in a second, read-only Live Preview editor; Monaco mode keeps the html-view. A document opens in the same editor, without marks or buttons but Copy.
4. On plan-loaded with a newer revision: clean, the editor takes the new text as one change leaving the common prefix and suffix alone, the cursor and the scroll staying, the anchors set afresh, no toast; dirty, the Stale banner with Discard. Discard puts the saved text back and stays in the editor; the draft is forgotten.
5. The tab-bar shows a dot (class dirty, before the ×, tooltip "unsaved changes") on a tab holding a Draft; the draft is written on every change, the 150 ms delay staying for the Monaco preview alone.
6. Ctrl+E in CodeMirror mode toggles Source ("Source on or off; in Monaco mode Edit, and from Edit save and read"); Ctrl+S saves whenever the editor is shown and dirty; Ctrl+Shift+C when a plan is open; the popup's rows stay twelve.
7. The Editor setting changed while an item is open takes effect at once; a draft stays in its tab.
8. The heading's new buttons in editor-header.css; the edit bar's rules kept for Monaco mode.
9. Tests: browser, CodeMirror mode: the editor with Source and Revisions and no Read or Edit; Source by button and Ctrl+E; Save from the heading; the dirty dot; a newer revision while clean replacing the text and keeping the cursor; Stale when dirty; archived read-only; Revisions read-only; the Monaco tests unchanged. The smoke: the one view.
10. Out of this step: the close prompts (Step 4), the guide (Step 5).
