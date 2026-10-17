# Step 2: Documents Pane

The second step of plan UI Components: the Tab Bar, the Editor Header, the html-view, the Monaco editor, the Revisions view, and the LLM session and Waiting views as tab contents (items 4, 5.1 to 5.3 of the parent).

## Documents Pane

The pane which displays the detail of the currently selected item in the Project Tree, with a Tab Bar showing tabs for each open item. Selecting a tab shows the Document Editor for that item type.

Decided: the pane picks the component by the tab's kind: document-editor for a plan or a document, llm-session for an LLM session, waiting-list for Waiting on you, and the start page with no tab open. The LLM session and Waiting views are componentized here as tab contents, unchanged inside.

## Editor Header

Item name, location, state, etc., plus the editor buttons.

Decided: a breadcrumb line under the title shows the location (server / project / folder / parent plan), each part a link that selects its node in the tree. Beside the revision, the text's size: the character count and an approximate token count (characters / 4). Read, Edit and Revisions stay as the button group.

## Edit view using Monaco

The editor as it is, a component.

## Formatted view in Html

Displays the colorized text anchors; a click focuses the thread; can be toggled show/hide.

Decided: one html-view component serves both the Read view and the Edit preview, with the anchors, the click to select and the selection buttons in both; the show/hide toggle is the Edit view's Preview button. Read is the html-view alone; Edit is the editor with the html-view beside it.

## Decided before the build

1. The components of this step, and where their code comes from:
   - documents-pane: the main column. Holds the tab-bar, then one of document-editor (a plan or a document is open), llm-session (an LLM connection's tab), waiting-list (Waiting on you) or start-page (no tab). It picks by State.View and State.Open, as the sections do today, so no new State field; the four stay ng-show, not ng-if, so the open document's editor, drafts and scroll positions survive a switch to another tab's kind and back.
   - tab-bar: the tabs row (the tree toggle, the strip, the threads toggle) and the detached bar, from TabsController; the tab-drag directive goes with it into its folder. The Tabs factory stays in public/js/tabs.js as the service, like Threads.
   - editor-header: from header.js, inside document-editor: the title line with Read / Edit / Revisions, the location line, the state line with the size, and New Comment and New subplan. llm-session and waiting-list carry a heading of their own (the LLM connection's name and participant; "Waiting on you" with the count), in the same header markup.
   - document-editor: the open item's views, from the three sections: Read (an html-view), Edit (monaco-edit) and Revisions (revisions-view), and the re-anchor hint. State.View stays the switch, so the tabs' RestoreView, the hotkeys and the LLM's links work unchanged.
   - html-view: the rendered markdown (from read.js and Render.Show): text and anchors bindings. With anchors on it marks each thread's passage as the Highlight picker says, a click on a mark selects the thread, a selection offers Copy, Comment (or Re-anchor here) and Start a new Subplan, and a search hit or a waiting item scrolls and flashes. With anchors off it is the text alone. Read uses it with anchors; the Edit preview with anchors while the editor's text is still the saved text, and without once it is dirty (the server found the positions in the saved text, so they would drift under edits); revisions-view without.
   - monaco-edit: the Edit view from edit.js (the edit bar, the editor, the splitter, the preview html-view). Not "monaco-editor", which is Monaco's own class on every instance and what the hotkeys look for. Step 3's is codemirror-edit.
   - revisions-view: from revisions.js, the text shown in an html-view.
   - llm-session: the LLM view's markup and LlmController moved as they are into the folder; the Llms factory stays in public/js/llm.js. waiting-list: from waiting.js, loading when it appears and on changed. start-page: the "Pick a plan on the left" text.

2. The location line, under the title: server (only when the page shows several) / project / each folder / each parent plan, from the root's project tree (State.Projects, the way the sidebar walks it), ending at the item. The project and folder crumbs reveal their node in the tree (a reveal-node event the sidebar listens to: it unfolds the way down, scrolls the row into view and flashes it); a parent plan's crumb opens that plan. The Readme reads project / Context.

3. The size, beside the revision: the text's characters and about characters / 4 tokens, both with thousands separators, as "12,345 chars, about 3,086 tokens", the title saying how it is counted. Of the open text as saved; the editor's unsaved text is not counted live.

4. Render keeps its character map per container (a WeakMap keyed by the element) instead of one last map, so two html-views (Read and the preview) coexist; SelectionAnchor and ScrollToText take the container as they do and find its map. The html-view listens on its own element for mouseup and click, so the element can carry the id the tests dispatch to (#read-view).

5. Ids and classes stay where the tests and the picture script look for them: #read-view and #edit-preview on the html-view tags, #editor, #save-button, #preview-toggle, #view-read / #view-edit / #view-revisions, #state-line, #revision, #new-comment, #new-subplan, #comment-button, #copy-button, #subplan-button, #document-badge, #archived-badge, .header .title, the tab classes, #tree-toggle, #threads-toggle, #detached-threads, #reattach, #revision-view and the revision rows. The Editor factory keeps its one Edit instance; monaco-edit creates it in $postLink in place of the getElementById at controller start.

6. Styles: the header, read, edit-view, revisions, llm-view, waiting-view and tabs blocks of consensus.css move to the component stylesheets; the grid and the splitters stay.

7. index.html: the main column becomes `<documents-pane>`; the tabs area, the header, the error line and the five sections go. The main-error line moves into documents-pane under the tab bar.

8. The build runs in checkpoints with a note at each: html-view with Render's per-container map, used by Read and the preview; then tab-bar, editor-header with the location and the size, monaco-edit, revisions-view, start-page and documents-pane; then llm-session and waiting-list; then the styles, the tests and the screenshots.

9. The smoke, at the end: the browser tests (the tabs, Read, Edit and save, the preview toggle, Revisions, the LLM page, Waiting on you, detach and re-attach), the location line on a subplan in a folder with each crumb tried, the size beside the revision, the preview showing the highlights until the text is edited, and a screenshot of each.
