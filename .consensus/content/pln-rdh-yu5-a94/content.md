# UI Tweaks IX

Sixteen things in the page, found in use after plans LLM Tasks and User Management: the look of the text and its margins, the thread card's buttons, the editor's keys and what a tab remembers, the popups and the menu, the tree, and the two headings that got crowded. Each item says what happens, what was found behind it, and what changes; the decisions are in the text, so the plan builds as it reads, and the few that were the owner's were decided before the build (2026-10-20, the decisions thread resolved with no reply: every recommendation taken, so the text stands as written). One commit for the sixteen, the Ui test and the desktop smoke extended where an item can be checked.


## 1. Text in lists is dimmer

**What happens.** In the editor, the text of a bulleted or numbered list is dimmer than a paragraph's, more so in the dark palettes. The Read view shows lists in the text colour.

**Found.** The editor's highlighter (`mirror.js`) colours the markdown tag `list` in the muted colour, meaning it for the list marks; but the markdown grammar puts the whole of a `BulletList` and `OrderedList` under that tag, its paragraphs included, so every list reads muted. The marks themselves carry `processingInstruction`, muted on its own line.

**The change.** The `list` tag gets no colour of its own: list text is the text colour, the bullets and numbers stay muted as the other marks do. There was no reason for the dimming; the Live Preview replaces the marks with bullets anyway.


## 2. Margins

**What happens.** The text is held to a narrow column (52rem); a maximized window shows wide empty margins on both sides.

**Found.** The width is a `max-width` on the Read view's `.markdown`, on the editor's content (`edit-view.css`, `document-editor.css`), on the Revisions view and, at 60rem, on the LLM page; the report has its own and prints.

**The change.** A view setting **Margins**, in the look popover beside Theme, Size and Editor, with the values **Narrow**, **Normal** and **Wide**, naming the margins: Narrow lets the text take the pane (no limit, the pane's padding its only margin), Normal holds it to 68rem, Wide to 52rem as today. The default is Normal. The choice is kept like the editor setting (`stored.js`, this browser or the desktop, every server) and set as one token, `--text-width`, on the root, which the Read view, the editor, the Revisions view and the LLM page use in place of their own numbers. The Ui test sets each value and reads the rendered width.


## 3. Resolve with a reply typed

**What happens.** A reply typed in a thread's box and then **Resolve** pressed: the thread resolves and the text is lost.

**Found.** `thread-actions` has three buttons: **Reply**, **Reply and resolve** (the draft as the outcome) and **Resolve** (the last reply's recommendation as the outcome, the draft ignored).

**The change.** One **Resolve** button: with a draft in the box it posts the draft as the outcome, as Reply and resolve does today; with none it accepts the last reply. Its title says which it will do. The Reply and resolve button goes. The Ui test types a reply, presses Resolve and finds the text as the thread's outcome.


## 4. Re-anchor and Start a new Subplan in the thread's header

**What happens.** The two sit in the reply row among Reply and Resolve, though neither is a reply.

**The change.** They move to `thread-header`, at its right beside the delete button, as icon buttons with titles (the target for Re-anchor, the subplan mark for Start a new Subplan), shown on the selected thread as the reply row is; the reply row keeps Reply and Resolve. The subplan button keeps its rule (plans only, not while busy).


## 5. Anchors in tables

**What happens.** A passage anchored inside a table shows no highlight in the editor's Live Preview; the Read view shows it.

**Found.** The Live Preview replaces a whole table with a widget drawn from its source (`live-preview.js`, `TableWidget`), and the editor's anchor marks are decorations on the text, which a replacing widget hides. The Read view wraps each anchored range in a `mark` (`render.js`), tables included.

**The change.** The table widget takes the anchors that fall within its range and wraps them in the same marks as the Read view does, by the same code (`Render`'s wrapping over the widget's rendered cells), so an anchored passage in a table highlights in the Live Preview, in the thread's state colour, and a click on it selects the thread as elsewhere. The widget is redrawn when the anchors change. The Ui test anchors a thread on a table cell and finds the mark in the preview.


## 6. The tab keys in the editor

**What happens.** With the caret in the editor, the tab-switching keys do nothing.

**Found.** `hotkeys.js` yields the tab rows to the editor by rule ("the tab keys yield to the editor, whose own they are there"). Of them, only Ctrl+Home and Ctrl+End are the editor's (document start and end); Ctrl+PgUp, Ctrl+PgDn, Alt+PgUp, Alt+PgDn, Alt+Home and Alt+End are bound to nothing there.

**The change.** The tab rows fire in the editor too, except Ctrl+Home and Ctrl+End, which stay the editor's; the Hotkeys page's "when" column says so. In a browser Ctrl+PgUp and Ctrl+PgDn remain the browser's own, as noted there.


## 7. Ctrl+Up and Ctrl+Down

**What happens.** In the editor Ctrl+Up and Ctrl+Down do nothing; in most editors they scroll the text one line without moving the caret.

**Found.** CodeMirror's default keymap has no binding for them; Monaco has them built in (scrollLineUp, scrollLineDown).

**The change.** CodeMirror's keymap gets Mod-ArrowUp and Mod-ArrowDown, scrolling the view by one line and leaving the selection where it is. Listed on the Hotkeys page under the editor's keys.


## 8. Formatting keys

**What happens.** Ctrl+B and Ctrl+I do nothing in the editor.

**The change.** In both editors, **Ctrl+B** toggles bold (`**`) and **Ctrl+I** italic (`*`) around the selection, or around the word at the caret when nothing is selected; pressed inside a passage already marked, the marks come off. In CodeMirror as keymap entries, in Monaco as commands. Listed on the Hotkeys page. The Ui test presses each over a word and reads the text.


## 9. A tab remembers its place

**What happens.** Switching tabs and back, the text shows from the top with the caret at the start; the previous tab's scroll and caret are gone.

**Found.** One editor instance serves every tab (`edit-view`, `open`: it sets the new text into the same instance); nothing records where the last tab was. The Read view (Monaco mode) scrolls its own container and keeps nothing either.

**The change.** The tab record (`tabs.js`) gets a `Place`: the editor's scroll position and selection, written when the tab is left (before the next text is set, and when the window closes a detached tab) and restored after the text is set when it is shown again; the Read view's scroll the same way. A place is kept while the tab is open and goes with it. Checked by the Ui test: scroll and place the caret in one tab, switch away and back, read both.


## 10. Menus in the desktop

**What happens.** In the desktop the popup menu stays open after a click elsewhere; Escape closes it. The browser closes it on the click.

**Found, so far.** `menus.js` closes on a document mousedown, captured, outside the menu. The desktop's title bar is a drag region (`-webkit-app-region: drag`): Electron takes every mouse event there for moving the window and the page hears none, so a click on the bar leaves the menu open. Whether a click elsewhere (the editor, the tree) is also lost is found in the build by running the desktop over DevTools with the menu open.

**The change.** While a menu is open the title bar is not a drag region (a `menu-open` class on the page while `Menus.Open`, the bar's drag turned off under it), so the click reaches the page and closes the menu as in the browser; a window move waits the one click. Whatever the build finds for a click elsewhere is fixed the same way, by the cause. The desktop smoke opens a menu and clicks the bar, then the text.


## 11. Every popup closes on Escape and has a close button

**What happens.** Escape closes a popup only while the focus is inside it; a popup opened and then clicked past, or opened by a key, does not close on Escape. No popup has a close button.

**Found.** Each popup handles Escape through `ng-keydown` on its own element, which fires only with the focus inside; the page's hotkey table steps aside while a popup is open. Twelve popups share the `subplan-popup` class and the `subplan-head` title line.

**The change.** Every popup gets an **X** at the top right of its head (one shared style, `popup-close`, the same icon as the thread's delete), which does what its Cancel does. Escape, anywhere on the page, presses the open popup's X: the hotkey table's Escape row finds the one popup shown and clicks its close. The two with a rule of their own keep it: the sign-in box has no X when the server requires a sign-in (a Local server's closes it), and the close prompt's X is its Cancel. The Ui test opens Settings, clicks the text, presses Escape and finds it closed.


## 12. Ctrl+F4 closes a tab

**The change.** A hotkey row closes the active tab through `Tabs.Close` (the unsaved-draft prompt as a click on the tab's X). Ctrl+F4 is the browser's own in Chrome (it closes the browser's tab) and works in the desktop, so the row has a second binding that a browser lets through, as the other tab rows do: **Alt+W**. Listed on the Hotkeys page.


## 13. The Users folder in the tree

**What happens.** A project's fixed Users folder (plan User Management, Step 3) looks like any folder of the owner's.

**The change.** It gets a look of its own: a people icon in the user icon's colour in place of the folder icon, the name in the muted colour with the count, and a hairline above it, placed last among the project's folders, after Archive and Trash. The role folders inside keep the folder icon.


## 14. The tree's default width

**Found.** `--sidebar-width` is 260px; a drag of the splitter is remembered per browser (`layout.js`, `stored.js`), and a remembered width stays.

**The change.** The default becomes 480px. A browser that has dragged the splitter keeps its width; the docs' pictures, made fresh, show the new one.


## 15. The plan page's header

**What happens.** The header's third row holds the state, the revision, the size, the task buttons, New Comment, Report and New subplan; with three tasks enabled it wraps and crowds.

**The change.** The task buttons stay in the row, as one group with room between them (item 16); New Comment, Report and New subplan go under one **Actions** button (⋯, the page's menu through `Menus`, as the tree's rows have), each item with its icon, its title and its rule (New Comment on a plan's Read view or editor, Report and New subplan on plans, none on an archived plan). The state line is unchanged. The Ui test opens the menu and picks New Comment.


## 16. Room between the task buttons

**What happens.** On the LLM page and the plan heading, Answer, Enhance and Work sit too close.

**Found.** Both rows use `.thread-buttons`, whose gap (0.5rem) was set for a thread's Reply and Resolve.

**The change.** The task buttons get a row style of their own, `task-buttons`, with a 0.75rem gap and the Stop button set apart by a margin, on the LLM page and the plan heading alike; the thread cards keep theirs.
