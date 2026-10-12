# Global Ids


Every item Consensus keeps gets an id that is unique across every Consensus server, so a project can travel between servers (Project Import and Export) and each item is still known by its id. Numbers such as a revision's number stay, but only as a sequence on one server, never as an identifier.


## Format

`<kind>-xxx-xxx-xxx`

- **kind** is three lowercase letters naming what the id is (below).
- Each `xxx` is three characters of lowercase base36 (`0-9`, `a-z`), drawn from the crypto random source.
- Three groups for every kind: 9 characters, about 46 bits, so ids stay unique across servers that exchange projects (10,000 plans across all servers: about one chance in a million that two share an id).
- A new id is checked against the data folder before it is used, and drawn again on the rare clash.

| Kind | What | Example |
|---|---|---|
| `prj` | project | `prj-4k2-9xa-q7m` |
| `pln` | plan | `pln-0bz-m3c-t8e` |
| `doc` | document | `doc-7rw-e1p-2kd` |
| `ctx` | a project's context | `ctx-h5n-y0v-c3s` |
| `fld` | folder | `fld-2qa-8wd-n6j` |
| `cor` | corpus | `cor-m9t-4ex-z1b` |
| `thr` | thread | `thr-a3f-9kq-0zt` |
| `rep` | reply | `rep-x8c-1mv-r5d` |
| `rev` | revision | `rev-6yb-3ps-j9h` |
| `run` | an LLM session run | `run-q2w-7en-b8c` |

The Default project keeps the id `default`.


## Revisions

A revision record today is `{ Revision, By, At, Reason, Thread?, Note? }`, known only by its number. It becomes:

`{ Id, Parent, Merged?, Revision, By, At, Reason, Thread?, Note? }`

- **Id**: the revision's global id.
- **Parent**: the id of the revision its text was made from; null for the first.
- **Merged**: on a revision an import makes to join two histories, the id of the other one (see Project Import and Export).
- **Revision**: the sequence number on this server, as now. The files stay `revisions/0001.md`, `0001.json`.

Whatever points at a revision points at its id as well as its number:
- a thread's Applied record: `{ By, At, Revision, RevisionId, Outcome }`;
- a text edit keeps sending the Revision it was based on (the stale-edit check stays by number on one server).


## Existing Data

At start, a data folder with old ids is migrated once, and a line says so:

- Every project, plan, document, context, folder, corpus, thread, reply and run gets a new id; proposal and corpus folders are renamed to match.
- Every reference is rewritten: `projects.json`, each project's tree and Context, Subplans, threads' and revisions' Thread, links `#/p/<id>` in every text and every revision's text.
- Existing revisions get an Id, and a Parent: the revision before them. Applied records get the RevisionId of the revision they name.
- Search indexes are rebuilt.
- The old-to-new map is kept in `ids.json`; the API and the page still open an item by its old id, so old bookmarks and links from outside keep working.
- The data folder is copied whole to `~data-before-ids` (beside it) before anything is changed.

