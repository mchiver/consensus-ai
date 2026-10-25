# Step 4: LLM connections and tasks in the Desktop

The Desktop runs the LLM Tasks with the connections the Host declares, reading the Host's file and never writing it.

## What is built

- **Read from the Host's file.** The Desktop opens `~/.consensus/consensus.json` read-only (Step 1) for `Llms` and `Tasks`, and re-reads it when the file changes (a watcher with a short debounce), so a connection added on the Host appears in every open window. The LLMs list and the LLM page show them as today.
- **Read-only on the page.** In the Desktop the LLM page's Details and Packaging popups show the connection and refuse to save, with the line "Connections are managed by the Server Host" and a button that starts the Host (Step 5) or opens its page when it runs. New LLM, Rename and Delete leave the Desktop's LLMs menu. The tasks list is the Host's as well; the project's own task switches stay in project.json, the project's.
- **Runs stay the Desktop's.** A run is started by the window's own server in the project's folder, with the connection's record read from the file; its record goes to `~/.consensus/runs/<id>.json` as today, the ids being global, so the Host and every window write there without a clash. The LLM page shows the runs of the connection from that folder.
- **The free tier.** With no license (Step 6) the Desktop shows the LLMs list with the connections and the task buttons disabled, each with the reason "a Personal license"; the sidecar is the free LLM path.
- **A connection's packaging** (the unchecked documents and threads, the Session Prompt) is the connection's record in the Host's file, so it is the Host's to edit too; the Desktop's Preview still packages as the record stands.

## Checks

`test/Desktop.test.js`: the connections read from a prepared consensus.json, a change in the file reaching the page, a save refused with the line. `test/Runs.test.js`: a run record written by a read-only store's server. The readme's LLM section says where connections are edited.
