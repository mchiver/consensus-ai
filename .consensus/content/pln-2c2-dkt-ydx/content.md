# Consensus UI Tweaks

## Done

### Earlier

- (completed) Threads should support markdown.

### Small items (built in 873ee34)

- Plan Header: keep Read/Edit/Revisions on the first line with the title; move the buttons after them (Comment on the whole document, Send to LLM, Delete) to a new line, pulled to the right.
- show/hide button for the threads, remembered per browser.
	- The button sits in the header, so it stays reachable while the threads pane is hidden.
- show/hide button for the markdown preview while editing, remembered per browser.
- Threads can be deleted by the owner (× on the thread, with a confirm). Revisions that applied a deleted thread keep their text and show "(deleted thread)".
	- The × sits on the thread's first line, next to the author and time, with an inline "delete? Yes / No".
- Project tree in the VS Code explorer style: about 16px of indent per level, a thin guide line for each level, chevrons on folders, folder and file icons, and a full-width highlight on the hovered and selected row.
	- Every row is one line: a plan's state and count badges sit at the right end of its title row.
	- Icons are plain Unicode or small inline SVGs, no icon library, with distinct icons for plans, documents, zips and folders.
- Plans and documents get copy and rename icons in their tree row. Rename changes only the Title.
	- Ids become plain ids with no slug: a kind letter plus 8 hex digits (`p…` plans and documents, `z…` zips, `j…` projects; the Default project keeps `default`).
	- Existing ids are converted once by `node bin/consensus.js migrate-ids`, which copies `~data` to `~data-backup-<timestamp>` first. Old links stop working.
	- The same command moves each project's Name out of its `project.json` into the new master `~data/projects.json`, so the id migration and the master file are built together, before the rest of reordering.

### Reordering (built in 873ee34)

- Everything reorders by drag and drop: projects, and folders, plans, documents and zips within and across folders.
	- Each project's `~data/projects/<id>/project.json` holds just its tree: folders, items and their order.
	- A new master file, `~data/projects.json`, holds the projects in display order, each with its Id and Name. Name moves out of `project.json`.
	- The move API takes a position (before or after a row), not only a parent. Dropping on the top or bottom edge of a row places the item before or after it; dropping on the middle of a folder moves it inside; a line or highlight shows where it will land.

## Moved

- Tabs: now its own plan, **Tabs**.
