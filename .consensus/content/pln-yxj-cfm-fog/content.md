# Step 4: Project Tree

The fourth step of plan UI Components: the tree of server/project/item nodes, its sorting and display options, and its popup menus (item 3 of the parent).

Decided: the components are project-tree (the sort and the drop logic), tree-node (recursive, with a Depth binding, replacing the two ng-include templates), server-row (the row, its menu, its create form) and llm-fold. The popup menu stays the Menus service and its one popup element; Settings, Project settings and LLM Instructions stay the panels they are, opened by events.

## Decided before the build

1. A Tree service under the components: sidebar.js's state and actions that every row shares (what is remembered per root: the open project, the folds, the LLMs and Trash folds, a closed root; the sort and the stamps; creating, renaming and deleting with their inline forms; the menus' action lists; Move and the drops; Copy, Paste and Export with the notice; Archive and Restore; the Trash; the Copy and Paste hotkeys; reveal-node) become the Tree service, public/js/tree.js, the controller's functions as they are, its $scope watches on $rootScope, and the three drag directives (drag-item, drag-project, tree-drop) in the same file. The components are thin views over it, with no logic of their own beyond what binds their row.

2. Five components:
   - project-tree: the sort select and the Show updated button, then a server-row per root. No bindings.
   - server-row: root. The root head (chevron, icon, the live dot, the name, who you are, offline, the menu), and the root body: the new-project form, a project-row per project, the llm-fold, the Trash fold with its list.
   - project-row: project, root. The project head (chevron, rename form or name, the stamp, the menu, the inline delete), and the body: the new-plan form, the clipboard notice, the empty line, the tree of tree-nodes, the Archive fold with archived tree-nodes.
   - tree-node: node, project, root, depth, archived. One component for both ng-include templates: a folder (its head, rename form, count, menu and delete, its new-plan form, its children), or a plan or document (the row with its chevron, icon, date, title, badges, stamp, delete and menu, and its Subplans). With archived on, the row is the read-only archived one with the Restore menu and no drag. It includes itself for its children, with depth + 1.
   - llm-fold: root. The LLMs heading with its menu, the new-LLM form, the list of connections with their badges, rename, delete and menu.

3. The structural classes go on the component tags, so the styles and the tests that reach the tree by its shape (.project.open .project-body > .tree > .tree-node > .tree-item, [data-project], [data-id], [data-root]) keep working: the parent template writes `<tree-node class="tree-node" ...>`, `<project-row class="project" data-project="..." ...>`, `<server-row class="root" data-root="..." ...>`, and each template holds the row and the body directly, with no wrapper. The ids (#tree-sort, #show-updated, #root-menu, #llms-heading, #llm-list, #create-name, #create-submit, #clipboard) stay on the same elements.

4. A name-form component for the new-plan form's four appearances (a project, a folder, a new project with its folder picker, a new LLM): bindings for the placeholder, the model (two-way), submit and cancel, and a flag for the project's folder picker. The rename forms stay inline, being one input each.

5. What stays in index.html's aside for now: the sidebar-top with the brand and the Help menu, the Waiting on you link and the bottom controls (theme, size, editor). They are the Application Title's (Step 5), which takes them out of the sidebar. The SidebarController keeps only those few functions until then.

6. Recursion: a component may hold its own tag in its template; Angular compiles each level as its ng-repeat renders it, so tree-node inside tree-node is fine, and the template is fetched once.

7. Styles: the project tree's blocks of consensus.css (the rows, chevrons, icons, badges, folders, drag zones, the forms, the roots, the LLM list, the trash) move to the component stylesheets; the aside's own rules (the sidebar, its top, the waiting link, the bottom controls) stay until Step 5.

8. Behaviour unchanged, including the reveal-node answer, the hotkeys, the drop zones and the remembered state under the same keys; the browser tests, which cover the tree closely, pass as they are, except where a selector names a scope the components no longer have.

9. Checkpoints: (1) the Tree service with the drag directives, and tree-node and project-row over it, the rest of the markup still bound to the shrunken controller; (2) server-row, llm-fold, name-form and project-tree, the aside reduced to the shell and one tag; (3) the styles, the tests and the screenshots.

10. The smoke: the browser tests, and over a temporary server with the Consensus project imported: the tree opened and folded, a plan renamed and moved by drag, a Subplan made from a plan's menu, the LLM list, the archive fold, a crumb of the location line revealing its row; a screenshot of the tree in both palettes.
