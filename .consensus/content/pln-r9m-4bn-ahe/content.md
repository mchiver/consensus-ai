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
