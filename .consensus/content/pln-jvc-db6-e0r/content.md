# Teams

Consensus for more than one person. Four plans were found on 2026-10-18 (LLM Tasks was Usage Scenarios then) to be answering one question from different angles: who is acting on a server, where from, on whose behalf, and what follows from the answer for the product and for what is sold. This plan is their master: it states the question and the model once, names each part and what it owns, and gives the order. The parts are its subplans; nothing is built from this page itself. The name, the place of Promotion and Monetization inside it and the order were settled on 2026-10-18 (the decisions thread, resolved with no reply).


*Note (2026-10-25): the shape of the application, the Desktop with its sidecar and the Server Host with mounting, the tiers Free, Personal and Professional, is plan Rearchitecturation's (pln-gkn-zlj-42q), built in its seven Steps; this plan and its subplans keep the model of accounts and roles, which that plan leaves as it is.*

## The question

A server on one machine with one owner needs no answer: a request is the owner, and the owner's agent session is the owner's delegate. The moment a server listens for others, three things have to be known about every request: the account behind it, what that account may do in the project at hand, and, when an LLM made it, which person it acted for. The Free tier never asks the question; the Team and hosted tiers cannot ship without it, and Promotion and Monetization says nothing is sold until it is answered.


## The model

Settled in the chats of 2026-10-18 and 19 and written out in User Management, The model:

- An account is the principal: a person, or a Service account standing for a system that is nobody's. Clerk identifies people, once; Consensus manages roles and permissions, per project, in the role folders. Consensus keeps no passwords and no sign-in of its own.
- An LLM is never a user. A server LLM connection runs as the person who pressed the button; an agent session or a service acts as the user whose token it holds. Every record names the user, the token and, when declared, the service; the log shows all three, a thread the byline "<service> by <user>".
- Scope decides whether identity is checked: Local trusts the machine; Public authenticates with Clerk; Public without Clerk is a trusted network where every request is the owner.
- A token is the one credential for anything that is not a browser: an account's, named, good until revoked; every user mints their own for their sidecars and services.


## The parts

- **User Management** owns the model, the registry (Users.json, keyed by Clerk id, no credentials), the Users folder and user pages, the tokens, runs as the presser, the Admin, and the migration away from the participants in consensus.json. Five steps; Steps 1 and 2 first. Three subplans divide the rest: Clerk, Accounts and Roles, Multiuser.
- **Accounts and Roles**, its subplan, owns the account types (Administrator, User, Service) and the four project roles (Owners, Members, Service, Watchers), the role folders, what each role allows, and the rule that which tasks a role may press is read from the task's Writes level; tasks are defined per server and enabled per project.
- **Multiuser**, its subplan, owns the consensus rules among many parties: a thread is resolved by its starter or an Owner, no vote, who a thread waits on, anyone with write access applies (Answer answers what waits on the presser, as the presser), the plan's State by Owners only, one run per plan at a time.
- **Clerk**, its subplan, owns the sign-in: the Clerk application and its dashboard choices, the session JWT the server verifies, the ClerkJS page, the webhook that fills the registry, the production instance under consensus-ai.liquicode.com. Its Step 1 is the dashboard alone; Steps 2 to 5 are User Management's Step 4.
- **LLM Tasks** owns how an LLM takes part once identity is settled: the LLM tasks as records the owner edits (a name, a package, a writes level that is the permission, a prompt), the default set (Answer, Enhance, Work, Explain, Session), the Work options for git sync and auto-commit, Explain (the read-only conversation with the project, the one task a Watcher has), and the ways-of-working guide page. It assumes a run is the presser's.
- **Promotion and Monetization** owns what is free and what is sold, and the order of revenue. Its Steps 1 to 3 (ready to be seen, distribution, launch) need none of the above and start now; Step 4 (the User, Host and Site licenses, sold through the store) waits on Clerk Step 6, the production instance; Steps 5 and 6 (managed runs, the hosted service) follow. Reconciled with the per-person license model on 2026-10-21.


## The order

1. Promotion and Monetization Steps 1 to 3, alongside everything below.
2. User Management Step 1 (the Clerk settings section and the trusted-network wording; nothing else changes), then Step 2 (the identity change: participants and connection tokens out of consensus.json, run tokens, the byline as the speaker). Little a single user sees changes: a thread header may carry the byline "Claude-CLI by owner".
3. LLM Tasks: the tasks as records, then Enhance and the Work options, which make the single-user loop better before any team exists; Explain, which is what a Watcher is for; the guide page with them. Multiuser Step 3, the run queue, with the tasks.
4. Promotion and Monetization Step 4: the User, Host and Site licenses, the first money, once Clerk Step 6 has the production instance.
5. User Management Step 3, Multiuser Steps 1 and 2 and Clerk Steps 1 to 5: users, the roles of Accounts and Roles, the rules among many parties, sign-in, the production instance.
6. User Management Step 5, then Promotion and Monetization Steps 5 and 6: managed runs, then hosting.


## What stays out

- The Installer plan: signing and auto-update are their own line and gate the desktop license only.
- Workspace Files, Workflows and Plugins: unrelated to who is calling.
