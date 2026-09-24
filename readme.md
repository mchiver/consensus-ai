# Consensus

Collaborative proposal building and approval. The User and the LLM work a proposal through in discussion,
thread by thread, until every thread reaches consensus and the whole document is approved as a Plan.

A standalone application: Node and Express on the server, AngularJS, Bootstrap, marked and Monaco in the
page, plain files in a data folder. The browser is the User; the LLM takes part over the REST API with a
bearer token and curl. Nothing runs anywhere but this workstation.

## Starting it

	npm install
	node bin/consensus.js [--data <folder>] [--port 3500]

The server listens on `127.0.0.1` only and refuses any other host. It prints its address, the data folder
and the settings file. Open `http://127.0.0.1:3500/` in a browser.

	npm test

runs every test, including the page in a headless Chrome or Edge (`test/Ui.test.js`, which needs one of
them installed). No test touches the real data folder.

## The data folder

`~data/` beside `package.json` by default, or the `--data` folder. Plain files, one folder per proposal:

	consensus.json                   settings: Port, Participants, optional Embedding
	proposals/<id>/proposal.json     { Id, Title, Status, Created, Updated, Revision, Approved }
	proposals/<id>/proposal.md       the text at revision Revision
	proposals/<id>/threads.json      the threads
	proposals/<id>/revisions/0001.md, 0001.json    every revision's text and record
	proposals/<id>/index.json        search chunks
	trash/<id>/                      a deleted proposal, moved whole

Every write is whole-file and atomic, and writes to one proposal never interleave. Delete or copy a
proposal folder to delete or copy the proposal; nothing else refers to it.

## Participants and the LLM's token

`consensus.json` is written at first start with two participants:

	{
		"Port": 3500,
		"Participants": [
			{ "Name": "user", "Display": "User", "Role": "owner" },
			{ "Name": "llm", "Display": "LLM", "Role": "llm", "Token": "<random>" }
		]
	}

A request without an `Authorization` header is the participant with the `owner` role: the browser. A
request with `Authorization: Bearer <token>` is the participant holding that token. Roles: `owner`
resolves threads and approves proposals; `llm` is a full participant that is asked to apply resolved
threads; `member` takes part in discussion. Edit the file to add participants or change names; restart
the server afterwards.

## How the LLM takes part

Everything is a REST call, bodies always from a file (a JSON body passed as a shell argument on Windows
turns non-ASCII into U+FFFD). With the token in `$T`:

	curl -s -H "Authorization: Bearer $T" http://127.0.0.1:3500/api/waiting
	curl -s -H "Authorization: Bearer $T" http://127.0.0.1:3500/api/proposals/<id>
	curl -s -H "Authorization: Bearer $T" -H "Content-Type: application/json" --data-binary @reply.json http://127.0.0.1:3500/api/proposals/<id>/threads/<tid>/replies
	curl -s -H "Authorization: Bearer $T" -H "Content-Type: application/json" --data-binary @apply.json http://127.0.0.1:3500/api/proposals/<id>/threads/<tid>/apply
	curl -s -H "Authorization: Bearer $T" "http://127.0.0.1:3500/api/search?q=words+from+a+thread"

`reply.json` is `{ "Text": "..." }`. `apply.json` is `{ "Outcome": "...", "Revision": 3, "Text": "the whole
new markdown", "Anchor": { "Text": "the words the change produced" } }`; `Text` and `Anchor` are optional,
and `Revision` must be the revision the text was read at, or the apply is refused with 409.

The round trip: `/api/waiting` lists every thread waiting on the caller. The LLM replies in a thread with
its outcome stated plainly: the exact change, or that the comment is dropped. The User resolves. The
thread now waits on the LLM to apply it: a new revision tied to the thread, or the outcome alone.

## The rules, in plain words

- A thread has one status: **contested** or **consensus**. It is contested until the owner resolves it.
  Resolving means agreeing with how the thread was deliberated and decided, and accepts the outcome the
  last reply states.
- A resolved thread is **waiting to be applied** until a participant applies it, so it never looks
  finished before the text shows it. Applying records who, when, the revision and the outcome.
- Any reply to a resolved thread **reopens** it: contested again, marked reopened. Reopening never reverts
  a change already applied; resolving it again makes it wait to be applied again.
- **Whose turn**: a contested thread waits on everyone except the one who replied last. A resolved,
  unapplied thread waits on every `llm` participant. An applied thread waits on nobody.
- **Approving** turns the proposal into a Plan. It needs the owner, nothing contested and nothing waiting
  to be applied.
- **Editing** is allowed at any time and makes a new revision. An edit, a new thread or a reply sets a
  Plan back to contested and returns it to the Proposals list. A manual edit changes no thread's status.
- **Anchors** hold to the visible text, not the markdown source, so bold and links do not break them.
  After every text change each anchor is re-found; one whose words changed a little follows them; one
  that cannot be found is detached, shown first, and can be re-anchored by selecting text.
- The document keeps no change log of its own: the applied records and the revisions are the record.
- **Optimistic concurrency**: a text change carries the revision it was made from; a stale one is refused
  and the page reloads rather than overwriting.

## The page

Proposals and Plans on the left with their tallies and a "waiting on you" count; the rendered proposal in
the middle with each anchored passage highlighted by state (yellow contested, orange reopened, blue
waiting to be applied, green applied); the threads on the right, filterable by state and by whose turn it
is. Select text to comment on it. Edit shows Monaco beside a live preview; Ctrl+S saves. Revisions shows
the record. Light, dark or system theme and three sizes are at the bottom of the sidebar. Two browser tabs
on one proposal stay in step: every change is a Server-Sent Event.

## Search

Every proposal, plan and thread is indexed after every change, by our own lexical index: each paragraph
(a heading with the short paragraphs under it) and each thread is a chunk, tokenized with a light stemmer
and weighed by BM25 across the whole data folder. `GET /api/search?q=&limit=` answers the best chunks
with their proposal, revision and thread; the box in the sidebar is the same search. Measured before it
was built: on the proposals it was written for, it ranked the right passage or thread first on 14 of 14
questions, ahead of three neural embedders.

Ollama vectors are an optional upgrade. Name a model in `consensus.json`:

	"Embedding": { "Url": "http://127.0.0.1:11434", "Model": "nomic-embed-text" }

Chunks are then also embedded through Ollama (only those whose text changed), and the search merges the
cosine ranking with ours by rank. An unreachable Ollama is a logged line; the search still answers.
Nothing in this application feeds a model on its own: the LLM calls the search when it wants context.

## The API

	GET    /api/me                                   who this request is
	GET    /api/proposals[?status=]                  proposals and plans with their tallies
	POST   /api/proposals                            { Title, Text }
	GET    /api/proposals/:id                        proposal, text, threads with positions, tally, whose turn
	PUT    /api/proposals/:id                        { Title }
	PUT    /api/proposals/:id/text                   { Text, Revision }  a manual edit
	DELETE /api/proposals/:id                        to the trash
	GET    /api/trash                                what is there
	POST   /api/proposals/:id/approve                owner; refused while anything is contested or waiting
	GET    /api/proposals/:id/revisions[/:n]         the record; a revision's text
	GET    /api/proposals/:id/threads[?status=]      all | contested | consensus | waiting | applied | reopened | detached | mine
	POST   /api/proposals/:id/threads                { Anchor: { Text, Prefix?, Suffix? } | null, Text }
	POST   /api/proposals/:id/threads/:tid/replies   { Text }  reopens a resolved thread
	POST   /api/proposals/:id/threads/:tid/anchor    { Anchor }  re-anchor
	POST   /api/proposals/:id/threads/:tid/resolve   owner only
	POST   /api/proposals/:id/threads/:tid/apply     { Outcome, Revision?, Text?, Anchor? }  resolved threads only
	GET    /api/search?q=&limit=                     the best chunks: { Proposal, Title, Revision, Chunk, Thread, Text, Score }
	GET    /api/waiting                              everything waiting on the caller
	GET    /api/events                               Server-Sent Events: { Proposal, Kind, Thread? }

Errors are `{ "Error": "..." }` with the status: 400 bad body, 401 unknown token, 403 not allowed for this
role, 404 not found, 409 not allowed in this state or a stale revision (with the current `Revision`).

## Layout of the code

	bin/consensus.js      the command line
	src/Server.js         Start( { Data, Port, Host } )
	src/Api.js            the routes
	src/Rules.js          the consensus rules, pure functions
	src/Anchors.js        visible-text anchors
	src/Index.js          our search index; src/Vectors.js the optional Ollama upgrade
	src/Store.js          the data folder
	src/Participants.js   who is calling
	src/Events.js         Server-Sent Events
	public/               the page: index.html, css/, js/ (one controller per pane)
	test/                 node --test; Ui.test.js drives a headless browser through test/support/Cdp.js
	.plans/               the build plan and the story of this repository
