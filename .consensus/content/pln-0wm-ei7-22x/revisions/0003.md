# Corpus File Inclusion

A Subplan of "Project Context Server": which files of a corpus are read and indexed.

Today a file must have an extension on the `Corpus.Extensions` list (in `context-server.json`, and in `consensus.json` for zips) before it is read and indexed. With `Include` and `Exclude` on each corpus, that list repeats what they can say (`Include: [ "**/*.md", "**/*.js" ]`), and it shuts out files with no extension: in the "Consensus" corpus, `.gitignore` is listed but not read, as `LICENSE` or `Dockerfile` would be.

## The rule

- `Corpus.Extensions` goes from `context-server.json`. `Include`, `Exclude` and the `.gitignore` files choose a corpus's files.
- Every file a corpus lets in is read and indexed, unless it is larger than `MaxFileKilobytes` or binary (it holds a NUL byte, as images, archives and executables do). Such a file is still listed, with its reason.
- `MaxFileKilobytes` stays, as a guard: it keeps a large generated file (`package-lock.json`, a bundle) out of the index by accident. Minified or generated text under the limit gets in unless `Exclude` names it.
- An `Extensions` key left in an existing settings file is ignored, and the server says so once at start.

## Two kinds of corpus

- An **attached** corpus is a zip uploaded to Consensus and kept by it. A **linked** corpus is a context server's corpus. The project tree marks each one "attached" or "linked".
- Both are represented the same way, as a corpus entry of the project: `{ Id, Name, Source: "attached" | "linked", Link?: { Server, Corpus }, Include: [], Exclude: [] }`. An attached one resolves to its zip, a linked one to its context server.
- Both behave the same: their files are listed, read and searched, and offered to the LLM.

## Include and Exclude on a corpus entry

- The entry's `Include` and `Exclude` narrow what reaches the project, with the same patterns as a context server's. For a linked corpus they apply on top of what the context server already lets in.
- They are edited in the corpus view, one pattern per line, with Save. The file list shows every file, and for each one left out, why.
- For an attached zip, Consensus applies them when it indexes, together with every `.gitignore` inside the zip, each to its own folder and below, as a context server does.
- For a linked corpus, Consensus filters the server's file list and search hits by path, asking the server for more hits so a filtered search still fills a page. `read_file` refuses a path they leave out.
- `Extensions` goes from `consensus.json` too: an attached zip's files are read unless larger than `MaxFileKilobytes` or binary, the same rule as above. An `Extensions` key left there is ignored, with a note at start.

## Where an attached zip is kept

- In the project's data folder: `~data/projects/<project>/corpora/<id>/`, in place of `~data/corpora/<id>/`. Moving a corpus to another project moves its folder; copying copies it.
- At start, an existing data folder is brought up to date once: each zip moves under the project that holds it, and each corpus entry gets `Source: "attached"` and empty `Include` and `Exclude`.

## The LLM finding its way

- A new request, `list_files`: `{ "Tool": "list_files", "Corpus": "<name>", "Folder": "<path>" }` lists a corpus's files, or one folder's, as `Include` and `Exclude` leave them, so the LLM can look around before it reads.
- `read_file` names the corpus with `Corpus`, and still takes the older `Zip`.
