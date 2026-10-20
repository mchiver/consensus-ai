# The API

Everything the Consensus-AI page does goes through the API, and so does everything an LLM does. It is plain HTTP with JSON bodies. On a Local server every request is the owner; on a Public server a request is a Clerk session or a token, and a bare one is refused (plan User Management, Step 4; plan Clerk, Step 5). A request says who it is with the header `X-Consensus-Service: <name>`, and what it posts is then recorded as the owner through that service, shown as the byline `<name> by <owner>`; a run the server started carries `Authorization: Bearer <run token>`, a token the server made for it and forgets when it ends; a token minted on an account's page (plan User Management, Step 3) makes the request that account, allowed in each project what its role folder there allows (Owners, Members, Service, Watchers), refused with 403 and the reason otherwise; a Clerk session token in the same header is its user, written to the registry from the token's claims at the first sight (Step 4), and refused with `license` when the person's roles need a plan their license lacks (plan Clerk, Step 5: Host for the Administrator, User for an Owner or a Member; the answer carries `Plan`, the plan wanted, and `Has`); any other token is refused. Errors are `{ "Error": "..." }` with the status: 400 a bad body, 401 an unknown token (`sign in` for a missing or stale session, `license` for a plan the person lacks), 403 not allowed, 404 not found, 409 not allowed in this state or a stale revision.

## Four calls

What waits on the caller, across every project:

```
curl -s -H "X-Consensus-Service: <name>" http://127.0.0.1:3500/api/waiting
```

A reply on a thread:

```
curl -s -X POST -H "X-Consensus-Service: <name>" -H "Content-Type: application/json" \
  -d '{ "Text": "Agreed; the wording I will apply: ..." }' \
  http://127.0.0.1:3500/api/plans/<plan id>/threads/<thread id>/replies
```

Applying a resolved thread, with the new text of the whole plan and the revision it was made from:

```
curl -s -X POST -H "X-Consensus-Service: <name>" -H "Content-Type: application/json" \
  -d '{ "Outcome": "The section now says ...", "Revision": 4, "Text": "# The plan\n\n..." }' \
  http://127.0.0.1:3500/api/plans/<plan id>/threads/<thread id>/apply
```

A new thread on a passage of the text:

```
curl -s -X POST -H "X-Consensus-Service: <name>" -H "Content-Type: application/json" \
  -d '{ "Text": "Is this the right default?", "Anchor": { "Text": "the words to anchor to" } }' \
  http://127.0.0.1:3500/api/plans/<plan id>/threads
```

An anchor's `Text` is matched against the text as it reads, without markdown marks: no backticks or asterisks.

## The routes

```
GET    /api/me                                   who this request is (Name, Display, Speaker, Service), the speakers, the States, the server's Name and Version
GET    /api/settings                             owner; the settings as they are, and the file's path
PUT    /api/settings                             owner; { Settings }  the whole file, checked
GET    /api/projects                             every project with its tree, its Archive, States and Path; Context and ContextFolder
POST   /api/projects                             { Name, Path? }  Path: the project's folder; one holding a project already is opened
PUT    /api/projects/:pid                        { Name?, States?, Include?, Exclude?, Commands?, Version? }  lists, or lines of text; Tasks: the enabled task ids, null for all; GitSync, AutoCommit: the Work options, true or false
DELETE /api/projects/:pid                        an empty project; never the last one
POST   /api/projects/:pid/folders                { Name, Parent?, Version? }
PUT    /api/projects/:pid/folders/:fid           { Name, Version? }
DELETE /api/projects/:pid/folders/:fid           an empty folder
POST   /api/projects/:pid/move                   { Before }  the project in the display order
GET    /api/projects/:pid/export                 owner; the project as one json object
POST   /api/projects/import                      owner; { Export, Mode?, Preview?, Into? }  Into: { Project, Parent? } writes the file's items there, every id new
GET    /api/items/:id/export                     owner; a folder, plan or document as one json object of the same format
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
POST   /api/plans/:id/threads/:tid/resolve   owner only; a build log of a project with AutoCommit on is committed (and pushed with GitSync), the thread's Git the record
DELETE /api/plans/:id/threads/:tid           owner only
POST   /api/plans/:id/threads/:tid/apply     { Outcome, Revision?, Text?, Anchor? }  resolved threads only
GET    /api/trash                                what is there
DELETE /api/trash                                owner; empties it for good, { Emptied: n }
GET    /api/waiting                              everything waiting on the caller, in every project
GET    /api/tasks[?Project=]                     the tasks, in the buttons' order, or those a project enables; the Writes levels, the Package switches (and which are Off unless set) and the shipped Defaults
GET    /api/llms                                 the LLM connections: Id, Name, Kind, Model, Speaker, Running, the whole records
POST   /api/llms                                 owner; a connection from its fields, with a new id
POST   /api/llms/check                           owner; the connection as typed, tried: { Ok, Result | Error }
PUT    /api/llms/:id                             owner; the fields given over the record
POST   /api/llms/:id/check                       owner; tried as saved, the body's fields over it
DELETE /api/llms/:id                             owner; not while it runs; its speaker goes with it
GET    /api/runs/lists?Project=&Plan=&Llm=       the other Context documents, the plan's threads waiting on the connection
POST   /api/runs/package                         { Llm, Task, Project, Plan?, Text?, Overrides? }  the prompt a run would get; Task the task's id, Text the box's text
POST   /api/runs                                 { Llm, Task, Project, Plan?, Text? }  a run started as the presser through the connection, on a token named after the task that carries its Writes (a none run is refused every write); one per connection at a time; a run that writes files pulls first when the project's GitSync is on, and is refused when the pull fails
GET    /api/runs[?Llm=&Project=&Task=&By=]       the runs, newest first, without their prompts and outputs; a person's Explain runs of a project are its conversation
GET    /api/runs/:id                             the whole record, the output as it stands
POST   /api/runs/:id/stop                        a running one stopped
DELETE /api/runs/:id                             the record removed (Clear in the Explain tab); not a running one
GET    /api/events                               Server-Sent Events: { Plan | Project, Kind, Thread? }; { Kind: llms }, { Kind: users } and { Kind: run, Run, Llm, Status }
GET    /api/users                                the accounts of the server (Users.json): Id, Type, Login, Display, Email; Admin: whether you are the Administrator
POST   /api/users                                Administrator; { Type: user | service, Login, Display?, Email? }  a user needs an email
GET    /api/users/:id                            the account's own page or the Administrator's: the record with its tokens' names, created and last use
PUT    /api/users/:id                            { Login?, Display?, Email? }  the Administrator; an account its own Display
DELETE /api/users/:id                            Administrator; out of every role folder, its tokens gone; never the owner
POST   /api/users/:id/tokens                     { Name } -> { Token, Name }  the value, shown once; an account's own, a Service account's by the Administrator
DELETE /api/users/:id/tokens/:name               revoked
GET    /api/users/:id/activity                   the threads, replies, resolves, applies and revisions by the account, newest first
GET    /api/clerk                                everyone, before identify: { On, Required, PublishableKey, FrontendApi, Pricing }  how people sign in through Clerk, Required on a Public server (never the secret)
POST   /api/clerk/webhook                        Clerk's events, signed (svix-id, svix-timestamp, svix-signature over the raw body); the registry follows them
PUT    /api/projects/:pid/roles                  { Owners?, Members?, Service?, Watchers? }  account ids, one folder each; an Owner of the project or the Administrator; a person seen without a User license stays out of Owners and Members (400, Plan)
```

## The rules, in plain words

- A thread is **contested** until the owner resolves it. Resolving accepts the outcome the last reply states.
- A resolved thread is **resolved**, waiting to be applied, until someone applies it. Applying makes it **applied** and records who, when, the revision and the outcome.
- Any reply to a resolved or applied thread **reopens** it. Reopening never reverts a change already applied.
- A contested thread waits on every speaker except the one who replied last; the speaker is the byline, so a run's reply as `Claude-CLI by User` is a different speaker from `User`, and a question the LLM asks you still waits on you. A plan's speakers are the owner, one per LLM connection, and everyone seen in its threads. A resolved thread waits on every speaker but the owner: the LLMs and the services. An applied thread waits on nobody.
- A plan's state is set by anyone at any time and does not depend on its threads.
- Editing is allowed at any time and makes a new revision. A manual edit changes no thread's status.
- Anchors hold to the visible text. After every change each anchor is found again; one that cannot be found is detached, and can be re-anchored.
- A text change carries the revision it was made from; a stale one is refused with the current revision.

## Live events

`GET /api/events` is a stream of Server-Sent Events: one event per change, naming the plan or project and the kind of change. The page uses it to stay in step; a client of your own can too.
