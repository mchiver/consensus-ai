# Project Context Server

Consensus works best when used in conjunction with a local agent running in a harness like Claude Code. A local agent provides an interactive way to build a context and prompt an inference engine.

Without a local agent, we need a context server that can connect to a file system (corpus) and manage LLM connections (inference).

- The first goal is a live corpus: a folder on disk read as it is now, instead of a zip uploaded again after every change, with the context server on the same machine as Consensus.
- The protocol is plain HTTP with a token, so a Consensus hosted elsewhere can reach a context server later without a redesign.

The context server receives connections from a Consensus server and provides context regarding the corpus. This will be read-only access for now. A context server can also manage connections to local inference resources (e.g. Ollama, Claude CLI).

A context server is configured using an array of json structure containing named filepaths/filespecs that constitute the corpus and named connections that route LLM connections.

Consensus registers running context servers by connecting to them and querying for their Corpus and Inference items. Consensus will offer these items when selecting for "Send LLM" targets and context lookups to satisfy LLM exploratory requests.

- Consensus is told where they are in `consensus.json`: `"ContextServers": [ { "Name": "Workstation", "Url": "http://127.0.0.1:3600", "Token": "…" } ]`. It asks each one for its Corpus and Inference items at start and on Refresh. A server that does not answer shows as offline, and nothing else breaks.
- The context server's bind address is configurable: 127.0.0.1 by default, or a LAN address so a remote Consensus can reach it. It answers only requests carrying its token.
- Read-only: it has no write routes, and a path is refused unless it resolves inside the corpus root, links included.

Corpus:

- A corpus belongs to a project, as a zip does: it is an item in the project's tree, and search and the LLM's requests reach it only from that project's plans.
- It is added by dropping a zip, as now, or by linking one from a context server: pick a server from `ContextServers`, then one of its Corpus names.
- The context server indexes each of its corpora at start and searches them the way Consensus does, with the same code (`src/Index.js`, BM25): Ollama vectors are added only when its settings name an `Embedding` model, as Consensus's do. A file watcher re-indexes what changes.
- Consensus asks the context server to search a linked corpus, and lists those hits beside its own by rank. `read_file` and `list_project` reach the linked files through the server.
- Inference items only pass a prompt to an LLM and return its answer. They never answer requests for more or tool calls: Consensus does that, as now.

Inference:

- An Inference item has the shape of a Destination today: `{ Kind: "Inference", Name, Type: "claude-cli" | "ollama", Url?, Model?, Command? }`, and the context server runs the same callers as `src/Llm.js`. The Claude CLI is offered through a context server too; it runs as whoever started that server.
- The session panel lists them after the local destinations, as "Workstation / Ollama", with the Ollama model picked from that server's Ollama. Local `Destinations` in `consensus.json` stay: a context server is optional.
- A call through a context server is one request that waits for the answer, with the same timeout as a local call.

```js
// Corpus
{
    Kind: "Corpus",
    Name: "", // Unique name on this server
    Root: "", // The corpus folder, absolute (e.g. C:\project)
    Include: [], // Glob patterns relative to Root. If empty, then all files are included.
    Exclude: [], // Glob patterns relative to Root. Exclude wins over Include.
}
// Inference
{
    Kind: "Inference",
    Name: "", // Unique name on this server
    Type: "", // "claude-cli" or "ollama"
    Url: "", Model: "", Command: "", // As a Destination of that Type takes them
}
```

- `Root` is the corpus folder, absolute. `Include` and `Exclude` are glob patterns relative to `Root`: an empty `Include` means everything, and `Exclude` wins over `Include`.
- Nothing is excluded unless the settings say so: `.git` is left out only when `Exclude` lists it (for example `.git/**`).
- Every `.gitignore` under `Root` applies too, each to the folder it is in and below, as git reads them, in addition to `Exclude`. They are read with the `ignore` library.
- Files over the size limit, or not text, are listed but not read, as zips are now.

Where the code lives:

- The same repository, as its own entry point: `bin/context-server.js` and `src/ContextServer.js`, with its own settings file (`context-server.json`), port (3600) and tests. It shares `src/Llm.js`'s callers and the corpus limits.
- `node bin/context-server.js --settings <file>` runs it alone, on this machine or another.
