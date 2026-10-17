# Editing and revisions

A plan or document opens in **Read**, the rendered text. **Edit** opens the editor beside a live preview; **Revisions** shows the record. The three are in the heading, and Ctrl+E switches between Read and Edit, from the editor too: from Edit it saves first, when there is something to save. The heading also has the location line (server / project / folder / parent plan, each a link that shows its row in the tree), the state, the revision and the text's size: the characters, and about a quarter as many tokens.

![Edit: the editor beside the live preview.](../images/edit.png)

## Editing

The editor is Monaco, the editor of VS Code, or CodeMirror, as the **Editor** setting behind the title bar's gear says; the Edit view takes the setting when it next opens. In both the keys you know work: multiple cursors, find and replace, folding. CodeMirror also marks the threads' passages in the text, by state as Read does, a click on one selects its thread, and its preview starts hidden, since the marks say where the threads are; the comment and reply boxes are a box of the same kind. Ctrl+S saves and stays in the editor, now editing the new revision; a line at the bottom says "Saved, revision N" for a moment. Ctrl+E saves and goes to Read; the Read button goes without saving, keeping the edit as a draft. **Preview** in the editor's heading hides or shows the preview, and the choice is remembered in the browser.

Editing is allowed at any time and makes a new revision. A manual edit changes no thread's status, and the anchors follow the text, so you can tidy a plan while its threads are open.

Two people cannot overwrite each other: a save carries the revision it was made from, and a stale one is refused. The page reloads the newer text rather than losing it.

## Revisions

Every save, and every applied thread, is a revision. **Revisions** lists them, newest first: who, when, which thread was applied and its outcome, and the text as it stood. The document keeps no change log of its own; the revisions and the applied records are the record.

![Revisions: the record, with the text at each one.](../images/revisions.png)

## Tabs

Every item you open, and Waiting on you, opens in a **tab** above the document: one tab per item, dragged to reorder, closed with ×. Each tab comes back as you left it, Read, Edit or Revisions, an unsaved edit included. The thread filter and the highlight are not the tab's: they are the page's, the same in every item, and remembered in the browser. Open tabs come back after a restart, per server; a tab whose item is gone from the server is dropped. With none open, the start page shows.

![The tab strip.](../images/tabs.png)

A tab's menu (the ▾ beside its ×, or a right-click) has Close, Close others, Close to the right, Close all, and **Detach**, which opens the item in its own browser window, without the sidebar; allow pop-ups for the page. Its tab stays in the strip, ghosted, and its menu has **Re-attach** and Close. Re-attach in the window does the same, and **Hide threads** / **Show threads** beside it hides or shows the window's threads pane, a choice the window keeps to itself. Two windows, and two browser tabs, stay in step: every change is pushed live.

## The threads pane and the tree

The small button at the right end of the tab strip hides or shows the threads pane, and its mirror at the left end the project tree (Ctrl+Shift+T and Ctrl+Shift+E do the same); each is remembered in the browser. A document gives the threads pane's room to the text.

The project tree's state per server, the open project, the folded folders and the LLMs fold, is remembered under the server; the sort order, the open tabs, the look of the page, the hidden panes and the pane widths, are the window's, whatever the servers it shows.

Selecting text in Read offers **Copy**, which copies the text as it reads, beside Comment and Start a new Subplan.

## Hotkeys

**Menu > Hotkeys** in the title bar lists them. Ctrl reads as Cmd on a Mac.

| Keys | What |
| --- | --- |
| Ctrl+E | Edit; from Edit, save and read |
| Ctrl+S | Save, staying in Edit |
| Ctrl+C | Copy the open item's export (not while typing, nothing selected) |
| Ctrl+V | Paste into the open project (not while typing) |
| Escape | Close the menu or the popup; deselect the thread |
| Ctrl+Shift+E | Show or hide the project tree |
| Ctrl+Shift+T, or Ctrl+Shift+H | Show or hide the threads |
| Ctrl+Shift+C | Comment on the whole document |
| Ctrl+PgUp, or Alt+PgUp | Previous tab, wrapping to the last |
| Ctrl+PgDn, or Alt+PgDn | Next tab, wrapping to the first |
| Ctrl+Home, or Alt+Home | First tab |
| Ctrl+End, or Alt+End | Last tab |

In a browser, Ctrl+PgUp, Ctrl+PgDn and Ctrl+Shift+T are the browser's own and never reach the page; the second key of each does. In the desktop both work. The tab keys yield to the editor, whose own Ctrl+Home and Ctrl+End are; Ctrl+E and Ctrl+S work in the editor.

The desktop window has keys of its own, listed under the page's in Menu > Hotkeys:

| Keys | What |
| --- | --- |
| Ctrl+R | Reload the page |
| Ctrl+N | New window: a second instance of the app |
| Ctrl+Shift+O | Open folder in new window: that folder's project alone |
| F12, or Ctrl+Shift+I | The developer tools |
| Ctrl+0, Ctrl+=, Ctrl+- | Zoom: reset, in, out |
| F11 | Full screen |
