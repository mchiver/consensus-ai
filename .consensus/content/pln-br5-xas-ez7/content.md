# Project Import and Export


We need to be able to export and import entire projects at a time.
This can be used for archiving as well as for transfer to another Consensus server.

The export artifact is a json structure representing the Project and all of its items:
its Context, folder structure, all plans and sub-plans, documents, corpora, and all threads for all plans in the project.

The json artifact can be copy-pasted or save-loaded from a file.


## The Export File

One json object, plain and readable, tab indented:

```
{
	"Format": "consensus-project",
	"Version": 1,
	"Exported": "<ISO time>",
	"Project": { "Id", "Name", "Created", "Updated", "Context", "Items" },
	"Proposals": [ { "Proposal", "Text", "Threads", "Revisions" } ],
	"Corpora": [ { corpus.json, less its search index } ],
	"ContextServers": [ { "Name", "Url", "Corpus", "Inference" } ]
}
```

- **Format** and **Version** let an import refuse a file it does not understand. A newer Version is refused with a message; an older one is upgraded.
- **Project** is `project.json` plus the project's Name from `projects.json`. Items is the tree as it is: folders, plans with their Subplans, documents, and corpus nodes. Context is the id of the Context proposal.
- **Proposals** holds every proposal the tree points to, and the Context:
  - Proposal: `proposal.json` (Id, Title, Kind, State, Created, Updated, Revision).
  - Text: `proposal.md`, the current text.
  - Threads: `threads.json` as it is, replies, anchors, resolved and applied records included.
  - Revisions: the full history, `[ { Revision, By, At, Reason, Text } ]`. Threads' Applied records name revisions, so the history travels with them.
- **Corpora** holds each corpus's `corpus.json`: Name, Source, Link, Include, Exclude, Files.
- **ContextServers** lists each context server the project refers to, by Name and Url, with the Corpus and Inference items it offered at export time.

Left out:
- Tokens. No token, for a participant or a context server, is ever written to an export.
- Search indexes (`index.json`). They are rebuilt on import.
- LLM session runs (`runs.json`) and usage. They belong to the server, not the project.
- The trash.
- An attached corpus's zip (see below).


## Exporting

- **API:** `GET /api/projects/:pid/export` returns the json. The owner or the llm participant.
- **UI:** an **Export project** item on the project's menu opens a popup with the json in a read-only text area, and two buttons: **Copy** and **Download**. Download saves `<project name>-<yyyy-mm-dd>.consensus.json`.
- The export is read under each proposal's queue, so a proposal is never caught half written.


## Importing

Everything works over the API first, so an agent session (the llm participant) can carry projects from one Consensus server to another, a remote one included; the page uses the same routes.

- **API:** `POST /api/projects/import` with `{ Export, Mode, Preview }`. The owner or the llm participant. It answers with the project and an import report.
- **UI:** an **Import project** item next to New project opens a popup with a text area to paste into, a **Load file** button, and **Preview**.
- The import is checked whole before anything is written: Format, Version, a tree whose every node has its proposal or corpus in the file, and a Context that is a proposal of Kind context. A bad file writes nothing and says why.
- Participant names in threads and revisions are kept as they are. A name the server does not know is listed in the report; the threads still show it.
- Search indexes are rebuilt for every imported or changed proposal.


## New or Existing Project

What an import does depends only on whether this server already has a project with the export's project Id.

**The project Id is not here.** The project is imported as it is: every id stays intact (project, context, folders, plans, Subplans, documents, corpora, threads). There is nothing to choose.

**The project Id is here.** The user (or the API, with `Mode`) must choose one of:

- **Import as a Copy** (`copy`). A new project named `Copy of <name> (imported <yyyy-mm-dd>)`, for example `Copy of Alpha (imported 2026-09-29)`. Everything in it gets a new id: the project, its context, every folder, plan, Subplan, document and corpus. The tree, the Subplans and the Context pointer are rewritten to the new ids; titles and text are not. The project already here is not touched.
- **Merge Existing** (`merge`). The file is merged into the project here. Nothing here is removed.
  - Plans, documents and the context, matched by Id. One only in the file is added. For one in both, its revisions are matched by their global Id (the Subplan Global Ids), never by number:
    - a revision already here is skipped, so importing the same file again adds nothing;
    - the file's revisions not here are appended in their order, numbered after the ones here, each keeping its Id and its Parent; nothing here is renumbered;
    - when the file's current revision descends from the current one here (following Parent and Merged links), the history simply goes on: the file's text becomes the current text;
    - when the current one here descends from the file's, the file is behind: the text here stays;
    - otherwise both were edited from a common revision: a conflict. A merge revision is added (Reason merge, Parent: the current one here, Merged: the file's current one) whose text is that of the newer of the two by timestamp. Both edits stay in the history, and the report says the plan diverged, naming the common revision. On the next import the other way, that merge revision descends from both, so the other server simply goes on to it, and both servers end with the same text.
  - A thread's Applied record names its revision by RevisionId; one taken from the file gets the number that revision has here.
  - Threads, matched by Id: a thread only in the file is added; for a thread in both, replies only in the file are added, and a Resolved or Applied record only in the file is taken. A thread whose anchor is no longer found is marked detached, as usual.
  - The tree: the tree here is kept, folder names included. Nodes only in the file are added under their parent from the file if that parent is here, otherwise at the root.
  - Corpora, matched by Id: one only in the file is added; one in both is kept as it is here.

**Choosing.** Import starts with a **Preview**: nothing is written, and the popup says whether the project is new or already here. When it is here, the popup offers **Import as a Copy** and **Merge Existing**; otherwise **Import**. Through the API, `Preview: true` answers with that, and an import into a project that is here without `Mode` is refused.

**The report**, shown in the popup when the import finishes, lists: what was made and merged (plans, documents, threads, corpora), each plan that diverged, each corpus's state (below), each context server's state, and unknown participant names.


## Linked and Attached Files

**Linked corpus.** A corpus linked to a Context server exports its Link (Server name and Corpus name), its Include and Exclude, and its file list; the server's Url goes in ContextServers. On import:
- If this server has a context server of that Name in `consensus.json`, the corpus is linked to it, and its file list is checked against the server's: the report lists files missing on the server and files the server has that the export did not.
- If it has none, the corpus is still made, linked but offline, and the report says to add a context server named `<Name>` at `<Url>` to `consensus.json`, with its token. Refresh then brings it online.

**Attached corpus.** An attached corpus exports its Name and file list, but not its zip. On import the corpus is made with that Name and file list and marked as waiting for its zip; its tree node shows that it needs re-attaching. The user re-attaches the zip on it; the new zip replaces the file list and the corpus is indexed as usual.


## Context Server Inference Engines

For a linked inference engine (LLM), export the settings to allow a reconnection. Engines are server wide today, so the export carries the context servers the project refers to (those its linked corpora use, and those its plans' LLM runs were sent to): each server's Name and Url, and each Inference item's Name, Type, and Model. On import, the report says for each whether this server has a context server of that Name, and whether it offers that Inference item.


## Out of Scope

- Exporting or importing a single plan, or a folder. Only whole projects.
- Carrying attached zips inside the export.
- Overwriting a project, or choosing per plan: a project that is here is copied or merged whole.
