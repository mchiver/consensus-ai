# The API

Everything the Consensus-AI page does goes through the API, and so does everything an LLM does. It is plain HTTP with JSON bodies. A request with no `Authorization` header is the owner; a request with `Authorization: Bearer <token>` is the participant holding that token. Errors are `{ "Error": "..." }` with the status: 400 a bad body, 401 an unknown token, 403 not allowed for this role, 404 not found, 409 not allowed in this state or a stale revision.

## Four calls

What waits on the caller, across every project:

```
curl -s -H "Authorization: Bearer <token>" http://127.0.0.1:3500/api/waiting
```

A reply on a thread:

```
curl -s -X POST -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{ "Text": "Agreed; the wording I will apply: ..." }' \
  http://127.0.0.1:3500/api/proposals/<plan id>/threads/<thread id>/replies
```

Applying a resolved thread, with the new text of the whole plan and the revision it was made from:

```
curl -s -X POST -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{ "Outcome": "The section now says ...", "Revision": 4, "Text": "# The plan\n\n..." }' \
  http://127.0.0.1:3500/api/proposals/<plan id>/threads/<thread id>/apply
```

A new thread on a passage of the text:

```
curl -s -X POST -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{ "Text": "Is this the right default?", "Anchor": { "Text": "the words to anchor to" } }' \
  http://127.0.0.1:3500/api/proposals/<plan id>/threads
```

An anchor's `Text` is matched against the text as it reads, without markdown marks: no backticks or asterisks.

## The routes

```
GET    /api/me                                   who this request is, the participants, the States
GET    /api/settings                             owner; the settings as they are, and the file's path
PUT    /api/settings                             owner; { Settings }  the whole file, checked
GET    /api/projects                             every project with its tree; Context and ContextFolder
POST   /api/projects                             { Name }
PUT    /api/projects/:pid                        { Name, Version? }
DELETE /api/projects/:pid                        an empty project; never Default
POST   /api/projects/:pid/folders                { Name, Parent?, Version? }
PUT    /api/projects/:pid/folders/:fid           { Name, Version? }
DELETE /api/projects/:pid/folders/:fid           an empty folder
POST   /api/projects/:pid/move                   { Before }  the project in the display order
GET    /api/projects/:pid/export                 owner or llm; the project as one json object
POST   /api/projects/import                      owner or llm; { Export, Mode?, Preview? }
POST   /api/items/:id/move                       { Project, Parent?, Before? }
POST   /api/items/:id/copy                       { Project, Parent? }  a whole copy under a new id
GET    /api/proposals[?state=]                   plans and documents with their tallies
POST   /api/proposals                            { Title, Text, Kind?, State?, Project?, Parent? }
GET    /api/proposals/:id                        text, threads with positions, tally, whose turn
PUT    /api/proposals/:id                        { Title }
PUT    /api/proposals/:id/state                  { State }
PUT    /api/proposals/:id/text                   { Text, Revision }  a manual edit
DELETE /api/proposals/:id                        to the trash
GET    /api/proposals/:id/revisions[/:n]         the record; a revision's text
GET    /api/proposals/:id/threads[?status=]      all | contested | resolved | applied | reopened | detached | mine
POST   /api/proposals/:id/threads                { Anchor: { Text, Prefix?, Suffix? } | null, Text, Resolve? }
POST   /api/proposals/:id/threads/:tid/replies   { Text, Resolve? }  reopens a resolved thread
POST   /api/proposals/:id/threads/:tid/anchor    { Anchor }  re-anchor
POST   /api/proposals/:id/threads/:tid/resolve   owner only
DELETE /api/proposals/:id/threads/:tid           owner only
POST   /api/proposals/:id/threads/:tid/apply     { Outcome, Revision?, Text?, Anchor? }  resolved threads only
GET    /api/trash                                what is there
GET    /api/waiting                              everything waiting on the caller, in every project
GET    /api/events                               Server-Sent Events: { Proposal | Project, Kind, Thread? }
```

## The rules, in plain words

- A thread is **contested** until the owner resolves it. Resolving accepts the outcome the last reply states.
- A resolved thread is **resolved**, waiting to be applied, until a participant applies it. Applying makes it **applied** and records who, when, the revision and the outcome.
- Any reply to a resolved or applied thread **reopens** it. Reopening never reverts a change already applied.
- A contested thread waits on everyone except the one who replied last. A resolved thread waits on every llm participant. An applied thread waits on nobody.
- A plan's state is set by anyone at any time and does not depend on its threads.
- Editing is allowed at any time and makes a new revision. A manual edit changes no thread's status.
- Anchors hold to the visible text. After every change each anchor is found again; one that cannot be found is detached, and can be re-anchored.
- A text change carries the revision it was made from; a stale one is refused with the current revision.

## Live events

`GET /api/events` is a stream of Server-Sent Events: one event per change, naming the proposal or project and the kind of change. The page uses it to stay in step; a client of your own can too.
