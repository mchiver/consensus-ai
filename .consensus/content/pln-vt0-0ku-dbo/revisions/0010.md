# User Management

People besides the owner working on the same server, each as themselves: registered by the Admin, signed in once, allowed per project what their role there allows. The owner's design (2026-10-02) is the statements below; the open points are threads. Nothing is decided until its thread is.


## Today

- The participants live in consensus.json, edited in the Settings popup: each has a Name (what threads and revisions record), a Display, a Role (owner, llm or member) and an optional Token. Only the owner resolves threads and writes the settings; only the llm applies; everyone else takes part.
- A request is identified by its token (Authorization: Bearer). A request with no token is the owner: security is relaxed, so the browser signs nothing and the desktop connects as the owner. The llm participant's token is served to whoever reads /instructions.
- cube4 listens beyond the machine: anyone who can reach it acts as the owner. This plan replaces the Owner Token the Readme named.


## User Registry

- Each server keeps a registry of its users: each user's login name, display name and credentials. It is stored in `Users.json` in the data folder, beside consensus.json.
- Credentials are plain passwords, stored as plain text for now; a password may be blank. The registry may evolve to Clerk (a user registry and authentication service) one day; today it just works.
- The participants of consensus.json become users: at the first start after this plan the registry is made from them. The participant with the owner role becomes the Admin, the members become users, and the llm participant is dropped (an LLM gets in through its connection's username). Each user gets a made-up password, printed once in the server's log at that start, for the Admin to hand out or change. The Participants section leaves consensus.json and the Settings popup; the Admin edits users in their tab pages.
- Every existing project gets its Users folder with the Admin in Owners and nothing else; the Admin adds the LLM usernames (the agent session's, the desktop connections') to Members.


## Authentication

- Users are authenticated globally, once: a sign-in (login name and password) on the server, good for every project the user has a role in. On sign-in the server issues a session token (random, kept in Users.json under the user with the time it was issued); the page keeps it in its storage per server and the desktop in desktop.json, and sends it as Authorization: Bearer, as the API already reads; Sign out drops it; it does not expire until then.
- The browser page has a sign-in box (shown when the API answers 401) and a Sign out; the desktop keeps the sign-in per saved server and signs in when it connects. A request with no sign-in is refused.
- /instructions stops serving a token: it serves the API's address and the guide, and says to sign in with the username the Admin gave; the agent session's turn and build loops do that.
- A local server started by the desktop: its first start makes the Admin (login `admin`, a password the desktop makes up and keeps in desktop.json under Local), and the desktop signs in with it; the connect screen shows the login and lets the password be copied, so a browser on the same machine can sign in too.
- **Sharing a local server.** The connect screen's Local server block has a **Share on the network** switch beside the data folder, off by default. Off: the server listens on 127.0.0.1, as today. On: it listens on 0.0.0.0, and the screen shows the address others use (the machine's name or address and the port), with the note that they sign in with a username the Admin registers. The choice is kept in desktop.json under Local (`Share`) and takes effect at the next start of the local server; a running one says which it is. Others reach it with a browser at that address, or with their own desktop by adding it as a saved server; the Admin (the desktop's own sign-in) adds them to the registry and drags them into a project's role folders. Nothing else changes: the server is the same Consensus, and the firewall is the machine's to open.
- The Project Tree always holds a **Users** folder at the server level, above the projects, with an item for each user with access to the server (users, not proposals: no text, revisions or threads). Clicking a user opens a tab page with the user's details, permissions (the projects and the role in each) and a history of activity on the server (the threads, replies, revisions and state changes by that user, read from the data, newest first).


## Authorization

- Authorization is per project. A project has lists of **Owners**, **Members** and **Watchers**, as three role folders inside its own **Users** folder, a fixed folder after the Context folder holding exactly Owners, Members and Watchers, none of which is renamed, moved or deleted, and which take users by drag only. A user is dragged from the server-level Users folder into one of the role folders to get that role in that project; a user is in one role folder of a project at most, and is dragged between them to change role or out to lose access.
- What a role allows in its project: an **Owner** does what the owner does today (resolves threads, sets states, edits, creates, renames, moves, trashes, exports) and manages the project's Users folder; a **Member** writes and takes part (edits, creates, comments, replies) but does not resolve, manage users or delete the project; a **Watcher** reads only. A project is shown to those with a role in it; the server-level Users folder (the names and display names) to every signed-in user; a user's tab page to the Admin and to that user, since the activity history is personal; a user with no role anywhere sees the Users folder alone.
- An LLM connection has a **username** in its details, with that user's password (blank allowed): it signs in as that user for each one-shot, and so posts, and is allowed, as that user. An LLM is included in a project by adding its username to the project's Members (or Owners); a connection whose username has no role in the project cannot run there. The agent session (Claude Code) is such a user too: it signs in with a username the Admin registers and adds to the project.


## Administrator

- There is one Admin per server. Only the Admin manages the user registry (adds, edits and removes users, sets their passwords) and the server's settings.
- The Admin's own rights in a project come from its role folders like anyone's; the Admin may put themselves in.


## Out of scope

- Hashed passwords, password reset, self-registration, invitations by mail, sessions with expiry: a later plan, or Clerk.
- An audit log beyond the user's activity history, which is read from what threads and revisions already record.
