# Plans and Subplans

Plans often grow in complexity and have the potential to break out into Subplans to address a specific feature.

A Subplan is started in any of four ways:

- **New subplan** on a plan's row and header: an empty Subplan under it, opened in a tab.
- **Drag a plan onto a plan**: it becomes a Subplan. Dropping it before or after a row, or into a folder, takes it out again.
- **Start a new Subplan** from a thread, beside Comment when a thread is created and beside Reply in a thread's reply box. A title is asked for; the Subplan's text starts with the thread's anchored passage quoted, then the thread's text so far. The thread gets a reply from the one who started it, naming the new Subplan with a link to it, and stays open.
- **Start a new Subplan** from selected text, beside Comment. A title is asked for; the Subplan's text starts with the selected passage. The parent's text is not changed, so no revision is made.

A Subplan appears as a child to another plan. This relationship is organizational only and each Subplan operates as a full Plan in its own right, including having additional Subplans under it.

- A plan holds plans only: no documents, zips or folders. A document a Subplan needs stays in a folder.
- Subplans go with their parent: moving a plan moves its Subplans, copying it copies them with their threads, and sending it to the trash takes its Subplans with it.
- In the project tree, a plan with Subplans has a chevron and folds like a folder.

- No rule connects a plan's state to its Subplans' states: a parent can be Finished while a Subplan is Working, and the build loop's ready check looks at one plan's threads only.
- A Subplan stays under its parent, so it cannot be sorted into a different folder from its parent. Each row in the tree shows its plan's state as a small badge.

When a prompt context is developed for a Subplan, it will include context for its parent's Plans.

- That context is every plan up the chain to the top one, each as its current text only, without its threads.
- It is its own prompt part, **Parent plans**, after the project's context and before the plan, with its own checkbox (on by default) and its size in the session panel.
- The other way, a parent's prompt lists its Subplans by title. `list_project` shows the nesting.
