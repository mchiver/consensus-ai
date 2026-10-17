# Step 5: Guide, Pictures, Help and Smoke

The last step of plan Markdown Editor: the guide and its pictures, the help, the README and the smoke, brought up to date with the editor; and the default engine for a fresh install.

## Decided in the parent

- The build line: the guide, its pictures, the help, the smoke. Tests: the server's node tests keep passing untouched; the browser tests follow the views they drive; the smoke (npm run smoke) at the end of each step.
- Point 10: out of scope unless the owner says otherwise: Obsidian's other features (wiki links, backlinks, the outline, editing a table in its rendered grid), the removal of Monaco, and any change to how the LLM reads and writes text.

## Decided before the build

1. A fresh install, and a browser with no remembered Editor, opens in CodeMirror; Monaco is the backup behind the Editor setting. The tests that drive Monaco set it first.
2. editing.md rewritten around the one view (Live Preview and Source, what renders in place, the threads in the editor, Save and the dirty dot, the live revision and Stale, closing and the prompt, Confirm on close, a Monaco mode section), its Hotkeys rows as Step 3 changed them; threads.md, getting-started.md, settings.md and readme.md brought along; the html rebuilt.
3. edit.png retaken as the Live Preview; new source.png and close-prompt.png; tabs.png with a dirty dot; title-bar.png with the fourth control; docs.js and Docs.test.js follow. The desktop pictures stay.
4. The Hotkeys popup carries its rows from Step 3; About stays.
5. The whole smoke run (npm run smoke) with the desktop part, what drifted fixed, .guides/run-the-smoke.md updated.
6. The repository's README and the project's Readme; the parent's "What is built" record; the parent Finished and the steps Plan.
7. Out of this plan: tables edited in their grid, wiki links, backlinks, the outline, the removal of Monaco.
