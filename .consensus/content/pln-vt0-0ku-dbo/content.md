# User Management

People besides the owner working on the same server, each as themselves, allowed per project what their role there allows. The owner's design of 2026-10-02 settled the role folders, the Users folder and the Admin; the rewrite of 2026-10-18 settled who the principals are: Clerk identifies people, Consensus manages roles and permissions, and an LLM is never a user. Three subplans divide the rest (the division thread, 2026-10-19): Clerk holds the sign-in, Accounts and Roles the accounts and the project roles, Multiuser the rules among many parties; this plan holds the model, the registry, the tokens, the runs as the presser, the Admin and the migration. The seven decisions of the rewrite were taken on 2026-10-18 (the decisions thread, resolved with no reply): trusted network for Public without Clerk, the person via the connection as a run's author, tokens until revoked, the owner's own named tokens on Local, the Admin by email, old names left in history, and Steps 1 and 2 first.


## The model

- **An account is the principal: a person, or a Service account standing for a system that is nobody's (Accounts and Roles). An LLM never is.** Clerk says who a person is, once, at sign-in. Consensus says what an account may do, per project, through the role folders. Consensus keeps no passwords and no sign-in of its own.
- **An LLM is never a user.** A server LLM connection is a tool: a run is posted as the person who pressed the button, with the connection named in the record, so a thread reads "Claude-CLI by Andre": the service, then the person (the byline, settled 2026-10-19; the three fields of a record are below under A run is the presser's). The run is allowed what that person's role allows, which is what makes a Watcher's Explain read-only. An agent session is the same thing from outside: it holds a token a person minted, and acts as that person.
- **Scope decides whether identity is checked.** Local trusts the machine: no users, no sign-in, a request is the owner, as today. Public authenticates with Clerk when the settings hold a Clerk section; a Public server without one is a **trusted network**, where every request is the owner as today, and the Settings popup says so in plain words beside the Scope.
- **A token is the one credential for anything that is not a browser.** A token belongs to an account and has a name; a request carrying it is that account: a service running on a user's token runs as that user. Every record of what it did carries the user, the token's name and, when the service declares one, the service's name; the logs show all three, the threads and revisions the byline. Every user mints their own, for their sidecars and services; the Administrator mints a Service account's.


## Today

- The participants live in consensus.json, edited in the Settings popup: each has a Name (what threads and revisions record), a Display, a Role (owner, llm or member) and an optional Token. Only the owner resolves threads and writes the settings; only the llm applies; everyone else takes part.
- A request is identified by its token (Authorization: Bearer). A request with no token is the owner. The llm participant's token is served to whoever reads /instructions. Each LLM connection is a participant of its own with a token of its own (Run Shapes Step 3), and the agent session posts with one of those.
- cube4 listens beyond the machine: anyone who can reach it acts as the owner. This plan replaces the Owner Token the Readme named.


## Users

- A Public server with Clerk keeps a registry of its users in `Users.json` in the data folder, beside consensus.json. A user record is the Clerk user id, the email, a login name (the mail's local part; the Admin may change it), a display name, the account type (Accounts and Roles) and the user's tokens. No credentials: Clerk holds those.
- A record is written when Clerk's webhook announces the user, or when a signed-in person reaches the server for the first time; it is removed when Clerk deletes the user, with its roles. A Service account's record is written by the Administrator on the Users folder (Accounts and Roles) and removed there. A user with no role in any project sees the Users folder alone.
- The Users folder at the server level holds an item for each user; clicking one opens a tab page with the user's details, permissions (the projects and the role in each), tokens, and a history of activity on the server (the threads, replies, revisions and state changes by that user, read from the data, newest first). The Users folder is shown to every signed-in user; a user's page to the Admin and to that user; a Service account's page, where its tokens are minted, to the Admin.
- A Local server and a trusted-network server have no registry and no Users folder: the owner is everyone.


## Authorization

- Authorization is per project. The accounts a server knows (Administrator, User, Service) and the four project roles (Owners, Members, Service, Watchers), the role folders they are applied through, what each role allows and which LLM tasks it may press are Accounts and Roles' (moved there on 2026-10-19 by the division thread; the role folders and the three roles of 2026-10-02 are kept as they were decided). Which tasks a role may press is read from the task's Writes level (LLM Tasks).


## LLM runs and agent sessions

- **A run is the presser's.** The run record carries the person and the connection; what the run posts (threads, replies, revisions, applies) is recorded with three fields: **By**, the account; **Token**, the name of the token the request carried (for a run, the run token, named after the task: "Work run"); and **Service**, the name the program declares for itself in a header (`X-Consensus-Service`), which for a server run is the connection's name. The **log** line shows all three: "Andre · token Work run · Claude-CLI". The **byline** in a thread or a revision shows "<Service> by <By>", "Claude-CLI by Andre", falling back to "<Token> by <By>" when no service is declared, and to the account alone when there is no token; the token's name is in the hover. The server gives the one-shot a token of its own making for the run, scoped to that person, that project and the task's Writes level (LLM Tasks), dropped when the run ends; the connection has no participant and no token of its own any more.
- **Tokens.** Every user mints tokens from their own user page (Create token, with a name; Revoke), any number, good until revoked; the page shows each once and lists them after with their last use. A request carrying one is that user, in every project the user has a role in; the record keeps the token's name and the service's, when the service declares one, so the log reads "Andre · token laptop-agent · Claude Code" and the byline "Claude Code by Andre". What a user gives a token to is theirs to choose: an agent session (Claude Code or similar) in its prompt, a desktop window, a script, a service of their own; its turn and build loops are unchanged otherwise. The Administrator mints a Service account's tokens on that account's page the same way.
- **The owner's tokens on a Local server.** The owner has a user page too, under the server's settings, with the same Create token and Revoke, so a thread can say "Claude Code by owner" instead of plain owner. /instructions serves no token; on a Local server a request without one is the owner as today, so an agent session on the same machine keeps working without ceremony.
- **The desktop.** A saved server holds a token the person minted on it, in place of the connection screen's sign-in; the desktop's own local server needs none.


## Administrator

- A Public server with Clerk has one Admin, named by email in the Clerk section of the settings. Only the Admin writes the server's settings, the LLM connections and the LLM tasks, creates and deletes projects, makes Service accounts, and sees every user's page; the rest of what the Admin does is Accounts and Roles'.
- A Local or trusted-network server has no Admin: the owner is the Admin, as today.


## Migration

- At the first start after this plan: the Participants section leaves consensus.json and the Settings popup. The owner participant becomes the server's owner. The llm and member participants are dropped (an agent session gets in with a person's token; members come through Clerk). The LLM connections lose their Token and their participant; their Name and Display stay as the Service of their runs' records.
- Threads and revisions already recorded under the old participant names (user, llm, the connections) keep them as they are; nothing is rewritten.
- `~deploy/cube4.json` and the agent session's instructions change with it (the memory of this is the agent's).


## Out of scope

- Sign-in, sign-up, password reset, invitations and multi-factor: Clerk's, in the subplan.
- An audit log beyond the user's activity history, which is read from what threads and revisions already record.
- Project-level sharing between servers.


## Steps

1. **Scope and trust.** The settings alone (re-cut by the design thread of 2026-10-19): the `Clerk` section (publishable key, secret key, webhook secret, the Admin's email), kept, validated and shown in the Settings popup, used by nothing yet; and the trusted-network wording beside the Scope. No identity change: nothing a user or a run sees differs.
2. **Identity.** The whole identity change in one build: the Participants section and the connection tokens leave consensus.json and the Settings popup, with the migration; the server mints a token per run in memory; a request is the owner on a Local or trusted-network server, or a run token, or refused; the `X-Consensus-Service` header is read on every request; records carry the three fields (By, Token, Service), the log line shows all three, the thread header the byline "<Service> by <By>"; /instructions serves no token, and the agent session declares itself with the header ("Claude-CLI by User" where it read "Claude-CLI"); the guide and the agent's own setup follow. Multiuser's speaker rule, the byline as the speaker the rules run over, is built here, since without the participants list the speakers are the bylines. Which tasks a role may press is read from the task's Writes level (LLM Tasks). Decided before the build (the design thread of 2026-10-19, resolved with no reply): every request is the owner until Step 3, bar a run token and an unknown token refused; an `Owner` field (Name kept, Display editable) replaces the owner participant; the speaker is the byline keyed "<Service> by <By>", a plan's speakers being the owner, one per connection and everyone seen in its threads, listed by /api/me in the participants' shape; the run token is minted in memory per run, named after the task; the header follows the connection-name rule and a bad value is ignored; the byline shows in the page and the three fields on the run record, with no HTTP access log; the starter-or-Owner resolve, the narrower waiting rule and State by Owners wait for Step 3 and Multiuser; tests act as a service by header.
3. **Users and roles.** Users.json, the role folders in each project as Accounts and Roles says, the Users folder and the user pages with Create token, the token list with last use, and Revoke; New Service account on the Users folder; the API checks every route against the role; the owner's own user page on Local.
4. **Sign-in.** The subplan Clerk, Steps 2 to 5.
5. **Guide and smoke.** The guide's pages on sharing a server and on roles; the agent instructions page; the smoke covering a Member and a Watcher.
