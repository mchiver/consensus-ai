# Step 4: Project Tree

The fourth step of plan UI Components: the tree of server/project/item nodes, its sorting and display options, and its popup menus (item 3 of the parent).

Decided: the components are project-tree (the sort and the drop logic), tree-node (recursive, with a Depth binding, replacing the two ng-include templates), server-row (the row, its menu, its create form) and llm-fold. The popup menu stays the Menus service and its one popup element; Settings, Project settings and LLM Instructions stay the panels they are, opened by events.
