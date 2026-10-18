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
  http://127.0.0.1:3500/api/plans/<plan id>/threads/<thread id>/replies
```

Applying a resolved thread, with the new text of the whole plan and the revision it was made from:

```
curl -s -X POST -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{ "Outcome": "The section now says ...", "Revision": 4, "Text": "# The plan\n\n..." }' \
  http://127.0.0.1:3500/api/plans/<plan id>/threads/<thread id>/apply
```

A new thread on a passage of the text:

```
curl -s -X POST -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{ "Text": "Is this the right default?", "Anchor": { "Text": "the words to anchor to" } }' \
  http://127.0.0.1:3500/api/plans/<plan id>/threads
```

An anchor's `Text` is matched against the text as it reads, without markdown marks: no backticks or asterisks.

## The routes

```
GET    /api/me                                   who this request is, the participants, the States, the server's Name and Version
GET    /api/settings                             owner; the settings as they are, and the file's path
PUT    /api/settings                             owner; { Settings }  the whole file, checked
GET    /api/projects                             every project with its tree, its Archive, States and Path; Context and ContextFolder
POST   /api/projects                             { Name, Path? }  Path: the project's folder; one holding a project already is opened
PUT    /api/projects/:pid                        { Name?, States?, Include?, Exclude?, Commands?, Version? }  lists, or lines of text
DELETE /api/projects/:pid                        an empty project; never the last one
POST   /api/projects/:pid/folders                { Name, Parent?, Version? }
PUT    /api/projects/:pid/folders/:fid           { Name, Version? }
DELETE /api/projects/:pid/folders/:fid           an empty folder
POST   /api/projects/:pid/move                   { Before }  the project in the display order
GET    /api/projects/:pid/export                 owner or llm; the project as one json object
POST   /api/projects/import                      owner or llm; { Export, Mode?, Preview?, Into? }  Into: { Project, Parent? } writes the file's items there, every id new
GET    /api/items/:id/export                     owner or llm; a folder, plan or document as one json object of the same format
POST   /api/items/:id/move                       { Project, Parent?, Before? }
POST   /api/items/:id/copy                       { Project, Parent? }  a whole copy under a new id
POST   /api/items/:id/archive                    a plan, with its Subplans, into the project's Archive, read-only
POST   /api/items/:id/restore                    back to the project's root
GET    /api/plans[?state=]                   plans and documents with their tallies
POST   /api/plans                            { Title, Text, Kind?, State?, Project?, Parent? }
GET    /api/plans/:id                        text, threads with positions, tally, whose turn
PUT    /api/plans/:id                        { Title }
PUT    /api/plans/:id/state                  { State }
PUT    /api/plans/:id/text                   { Text, Revision }  a manual edit
DELETE /api/plans/:id                        to the trash
GET    /api/plans/:id/revisions[/:n]         the record; a revision's text
GET    /api/plans/:id/report                 the plan, its Subplans and all their threads as one page made for printing
GET    /api/plans/:id/report.md              the same report as markdown
GET    /api/plans/:id/threads[?status=]      all | contested | resolved | applied | reopened | detached | mine
POST   /api/plans/:id/threads                { Anchor: { Text, Prefix?, Suffix? } | null, Text, Resolve? }
POST   /api/plans/:id/threads/:tid/replies   { Text, Resolve? }  reopens a resolved thread
POST   /api/plans/:id/threads/:tid/anchor    { Anchor }  re-anchor
POST   /api/plans/:id/threads/:tid/resolve   owner only
DELETE /api/plans/:id/threads/:tid           owner only
POST   /api/plans/:id/threads/:tid/apply     { Outcome, Revision?, Text?, Anchor? }  resolved threads only
GET    /api/trash                                what is there
DELETE /api/trash                                owner; empties it for good, { Emptied: n }
GET    /api/waiting                              everything waiting on the caller, in every project
GET    /api/llms                                 the LLM connections: Id, Name, Kind, Model, Participant, Running; the owner sees the whole records
POST   /api/llms                                 owner; a connection from its fields, with a new id and token
POST   /api/llms/check                           owner; the connection as typed, tried: { Ok, Result | Error }
PUT    /api/llms/:id                             owner; the fields given over the record
POST   /api/llms/:id/check                       owner; tried as saved, the body's fields over it
DELETE /api/llms/:id                             owner; not while it runs; its participant goes with it
GET    /api/runs/lists?Project=&Plan=&Llm=       the other Context documents, the plan's threads waiting on the connection
POST   /api/runs/package                         { Llm, Kind, Project, Plan?, Overrides? }  the prompt a run would get
POST   /api/runs                                 { Llm, Kind, Project, Plan? }  a run started; not by an llm participant; one per connection at a time
GET    /api/runs[?Llm=]                          the runs, newest first, without their prompts and outputs
GET    /api/runs/:id                             the whole record, the output as it stands
POST   /api/runs/:id/stop                        a running one stopped
GET    /api/events                               Server-Sent Events: { Plan | Project, Kind, Thread? }; { Kind: llms } and { Kind: run, Run, Llm, Status }
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

`GET /api/events` is a stream of Server-Sent Events: one event per change, naming the plan or project and the kind of change. The page uses it to stay in step; a client of your own can too.
