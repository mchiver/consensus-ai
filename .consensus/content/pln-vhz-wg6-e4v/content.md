# LLM Tasks

How a person starts an LLM on a project, and the guide page that explains the ways of working. Identity is User Management's: a run is the person who pressed the button, allowed what their role allows. Since 2026-10-18 the tasks are configuration, not convention: a task is a record the Administrator edits (the owner, on a Local server), Consensus ships a default set, and what a role may press follows from what the task writes. Enhance and Explain, first drafted as features, are two entries of the set. The five decisions of the rewrite were taken on 2026-10-18 (the decisions thread, resolved with no reply): the names Respond and Work (Respond became Answer on 2026-10-19, the owner's word), Session writing files, tasks per server with per-project hiding (defined per server and enabled per project, in the owner's words of 2026-10-19), the prompts on the task, and the tasks as records first.


## LLM Tasks

- **A task is a record**, kept in the settings (consensus.json, a `Tasks` list) and edited in the Settings popup beside the LLM connections: a **Name** (what the button says and what the run record carries), a **Package** (what the one-shot is given: the plan at hand, the threads waiting, the Readme and Context folder, the project's documents, the project folder's files; each a switch, as a connection's Checks are today), a **Writes** level (**none**, **consensus**, or **files**, each including the ones before it), and a **Prompt** (the task's instructions, with the person's own text appended when the button offers a box). The connection keeps its Session Prompt; the task prompts leave it.
- **Writes is the permission.** A task with Writes none is every role's, Watchers included. A task with Writes consensus or files is for Owners and Members; a Service account presses no task at any level (Accounts and Roles). A task with Writes files needs the project to have a folder, and is not offered where there is none. The rule reads the record, never the name, so a task made next year is governed correctly the day it is made.
- **The buttons** are the tasks, in the order of the list, on the project and on the plan at hand; a task whose Package needs a plan is disabled with none selected, as a run is today. A local model through Ollama gets the tools its Writes level allows (Tools.js already divides them so); a one-shot command gets the level in its prompt, and the run-scoped token, which carries the presser's role and the task's Writes level, enforces both at the API.
- **Tasks are defined per server and enabled per project**, as the connections are; a project enables the tasks it has use for in its settings, and adds none. Per-project tasks are a later step if a need appears.
- **Migration.** The connections' Prompts for Review and Build become the Answer and Work tasks' prompts at the first start after this plan, when they differ from the defaults; the Session prompt stays on the connection.


## The default set

| Task | Package | Writes | For |
|---|---|---|---|
| Answer | the plan, the threads waiting on the presser, the Readme and documents, the files | consensus | answer what waits on me, as me: replies on the contested threads, applies the resolved ones (Multiuser); Review's successor |
| Enhance | the plan, the Readme and documents, the person's instructions | consensus | make a plan from a sketch and ask |
| Work | the plan, the Readme and documents, the files | files | carry out the plan in the folder, as Build does today; the Working state |
| Explain | the Readme and documents, every plan with its threads and revisions, the run records, the files; the person's question | none | the conversation with the project |
| Session | the Readme and documents; the person's prompt | files | the open one, no prompt of its own |

The names are plain words that fit a project of any kind: a book, a policy, a research programme or a codebase. Answer and Work are Review and Build renamed; Work's prompt is today's, Answer's says "the threads waiting on you" where Review's said "waiting on the llm participant", since a run is the presser's.


## Enhance Task

- On a Draft, with a text box for the person's instructions ("replace this with a detailed plan; open threads for anything unclear" is the default). It runs the project's chosen LLM connection once with the plan, the Readme and the instructions, as a run of the presser.
- What the run posts is what any turn posts: the new text as a revision, and a contested thread for each question. The person answers the threads and presses Enhance again, or Answer, until the threads are resolved.
- Enhance is Answer with a different package: the one-shot gets the plan and the instructions, not the waiting threads.


## Work Task

- The Work button on a Plan state gets two checkboxes, remembered per project: **Git sync** (pull before the run, push after a commit) and **Auto-commit** (commit the working tree when the build log is accepted, titled after the plan, the build log as the message). Both off by default; both need the project folder to be a git checkout, which the run reports when it is not.
- The build log thread is the commit message's source, as the build loop already says.


## Explain Task

- The one task a Watcher has, and every other role's too. It opens a **conversation tab** for that person and that project: a question at the bottom, the exchange above, newest last. The feature is a conversation with the project, for a supervisor as much as for a member: what the project is, who did what and when, what is planned, why a thread was resolved the way it was.
- A question runs the project's LLM connection once, as a run of the presser, with the project packaged read-only: the Readme and the Context folder, the plans with their states, the threads with who said what and when, the revisions with who applied them, the run records, and the project folder's files as the connection's packaging lists them. The answer goes into the tab and nowhere else: the run posts nothing to any plan.
- It is read-only by construction. Writes none gives a local model the read tools only (no write, no shell), and the run-scoped token, carrying Writes none beside the presser's role, refuses any write at the API whatever the model tries, whoever pressed.
- The conversation is kept with the project, per person, in the project's `.consensus`, and shown to that person and to the project's Owners; the person clears it. A run counts like any run in the quota. (Decided 2026-10-18: the person and the Owners see it, the files are in the package, it is kept in the project.)
- Explain is the LLM Session pane with the project as its subject and no write; the pane's conversation shape is reused.


## The guide page

- `docs/guide/ways-of-working.md`: the ways in prose, each a few paragraphs and one picture: the **agent session** on the same machine (it reads /instructions, understands "check consensus", "your turn", and keeps the project's files; changes appear in Consensus at once; nothing it does not say "your turn" to is read); the **server's LLM connections** (a person presses a task button; Claude Code as a one-shot or a local model through Ollama; the run is theirs); **plan building** (a rough sketch, Enhance, answer the threads, repeat until the plan stands; then Work to carry it out); **Explain**, the conversation with the project that every role has; and a short section on **making your own tasks**, with one example that is not software.
- Linked from Getting started and the Features page.


## Steps

1. Tasks as records: the `Tasks` list, the Settings popup, the buttons from the list, Writes as the permission and the tool set, the migration of the prompts; Answer and Work in place of Review and Build, behaving as today. *Decided before the build (2026-10-19, the design thread resolved with no reply):* the record is `{ Id, Name, Package, Writes, Prompt }`, the Package six switches (Instructions, Readme, Documents, Plan, Threads, Files), the Prompt under "Your task: <Name>" in the package; tasks are edited in a Tasks section of the server's Settings popup (Add, Remove, the list's order the buttons' order, Reset to the default for the shipped three), the connection's Packaging popup keeping what is the connection's: the unchecked documents and threads, the Session Prompt, and the preview of the task picked; Step 1 ships Answer, Work and Session only, Enhance and Explain coming with their steps; the API takes `Task` (the id) in place of `Kind` on POST /api/runs and /api/runs/package, the run record carries `Task: { Id, Name }` (a record from before keeps its Kind and shows it as the name), the run token is named "<Name> run", and GET /api/tasks lists the server's tasks; the run token carries the task's Writes, none refusing every writing route at the API (403, "this run reads only") and giving a local model the read tools only, consensus allowing the Consensus writes and the read-only file tools, files adding the file-writing tools and the project's commands, the role side waiting for User Management Step 3; at the first start the connections' Review and Build prompts become the Answer and Work prompts when they differ from the defaults (the first connection that differs wins, with a start-up line) and the connections' Checks are dropped, Unchecked and the Session Prompt staying; a project's settings popup lists the server's tasks with a checkbox each, project.json keeping `Tasks` (the enabled ids, absent meaning all, so a task added later is on everywhere); one button per enabled task on the LLM page, in the list's order, labelled by its Name, disabled with a reason as today.
2. Enhance, with its package and its smoke check.
3. The Work options.
4. Explain: the conversation tab, the read-only package, the smoke check as a Watcher.
5. The guide page and the pictures.
