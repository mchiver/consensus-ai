# Tabs

The central document view holds several open items as tabs, and any of them can be detached into its own browser window. This comes from the "Later: tabs" section of UI Tweaks, brought up to date with what was built since (contexts, the two-line header, the threads toggle).

## The tab strip

- Custom tabs above the document view; no Golden Layout. Resizing stays with the existing splitters.
- Every content item opens in a tab: plan, document, zip, and a project's context.
- One tab per item: clicking an item that is already open switches to its tab, or brings its detached window forward.
- Each tab remembers its own view (Read, Edit or Revisions): switching tabs brings each back as it was left, an unsaved edit included.
- Tabs are dragged to reorder, and closed with their ×.
- Waiting on you and Search open in tabs too, one tab each, reused: a new search replaces the Search tab's results.
- The start page shows only when no tabs are open.
- Open tabs survive a page reload (sessionStorage), not a browser restart.

## Headers

Each item kind keeps its own header, as the page has them now:

- **Plans:** title, Read / Edit / Revisions, the Threads toggle; then the state, Comment on the whole, Send to LLM, Delete.
- **Documents:** title, Read / Edit / Revisions, Delete.
- **Contexts:** "Context of <project>", Read / Edit / Revisions, Initialize context.
- **Zips:** name, file count, Rename, Replace, Delete.

## Detached windows

- A tab can be detached into its own browser window, which shows only that item, and re-attached with a button in that window.
- The windows keep each other informed through `BroadcastChannel`, so the main window knows which items are out.
- Closing a detached window closes the item.
- If the main window has been closed, Re-attach turns the detached window into the main window: the sidebar appears and the item becomes its first tab.
