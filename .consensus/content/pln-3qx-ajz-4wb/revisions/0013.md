# Promotion and Monetization

Consensus is at 0.5.1: MIT licensed, local-first, a desktop application and a Docker image, documented publicly as Consensus-AI, with signed installers waiting on a certificate. Nobody outside this project uses it yet. This plan says how it gets seen, where it is distributed, what stays free, what is sold, and in what order. It rests on five statements:

1. The pitch is one sentence: *work the plan through with your AI, thread by thread, before any code is written.* Everything public leads with the loop (write, the agent comments in threads, resolve, apply, a revision trail), not with the feature list.
2. The audience is people who already code with agents: Claude Code, Codex and Cursor users, solo developers first, small teams second. Consensus is distributed where they already are, inside the agent ecosystem, not on a landing page they have to find.
3. The core stays MIT and free for a single user on their own machine with their own API key. Money comes from the licenses people hold: a User license for an Owner or a Member on any shared server, which is also the solo professional's commercial desktop license; a Host license to run a shared server; a Site license for a team; then from LLM runs performed on our key, and from hosting and support.
4. Nothing is sold before the server knows who is calling. That is met: since Clerk Step 5 a Public server admits a Consensus-AI sign-in or an account's token and nothing else, and reads the person's license from their sign-in; only Clerk Step 6, the production instance, stands before the first sale.
5. Revenue comes in the order of least infrastructure first: the per-person licenses, then managed runs, then hosting. Services (support, workshops) run alongside from the start.

The steps below are in order; Steps 1 to 3 cost no infrastructure. The paid line, the managed runs and the hosted tier (Steps 4 to 6 as this plan had them, brought onto the per-person license model on 2026-10-21, with Services, Before any charge and the licensing measures) moved on 2026-10-23 into the plan **Monetization** (pln-qr1-aed-21x), to be taken up after Clerk Step 6; this plan was closed the same day, Steps 1 to 3 standing as written for whenever the launch is taken up.


## The name

Consensus is also a funded research search product (consensus.app), so the bare name is not ours in search results or as a trademark. The public name stays **Consensus-AI** in docs, listings and the installer, with Consensus in prose, as the docs do today. Before Step 3 we check the trademark registers for Consensus-AI in software, and the handles (npm, GitHub organization, Docker Hub, X, Bluesky, Discord). If any of these fails, the name is changed before the launch, not after; a rename later costs every link and listing.

Whatever the check says, the docs carry a short disambiguation paragraph, on the landing page and in Getting started, that names the other Consensus plainly ("Consensus-AI is not Consensus, the research search engine at consensus.app"), links to it, and says in one line what this one is. It is a defensive measure: it answers the confusion before it is raised, and it is on record that we made the distinction ourselves.


## Step 1: Ready to be seen

What a stranger meets in the first minute, done before any announcement:

- **The one sentence** from statement 1 at the top of the readme, the docs front page, the npm page and the desktop's About.
- **One recording**, 60 to 90 seconds, no voice-over needed: a plan is written, an agent session reads `/instructions` and posts anchored threads, the owner replies and resolves, the agent applies, the revision trail shows the change. A GIF of it in the readme, a video on the docs front page. Recorded with the smoke harness so it can be re-recorded after UI changes.
- **A public demo project**, read-only, at a stable URL under the docs: this project's own plans, with their threads and revisions, as they are. The demo folder under `docs/` is its seed. The story of building Consensus with Consensus is the best evidence the product works.
- **Starter plans**: a `Templates` folder in a new project, holding an RFC, an architecture decision record, a design document, a sprint plan and a build plan with steps, each a short plan with the headings and a line on how to work it. New Plan offers them. They are also pages in the docs guide, one each, because each is a search query.
- **A changelog** at `CHANGELOG.md` and a Releases page on GitHub, with one line per plan finished, from the Finished folder backwards.


## Step 2: Distribution

Where it is installed from, each a listing that brings its own traffic:

- **`npx consensus-ai <folder>`**: the npm package, published, so the headless server is one line in any repository. The `bin` already exists; the package gets the public name, the readme and the keywords.
- **The Docker image** on Docker Hub and GHCR under the public name, with the compose file in the readme.
- **A Claude Code plugin** that carries the `build-with-consensus` guide as a skill and the "your turn in Consensus" workflow, so an agent session in any repository learns the API from the marketplace rather than from a curl. Listed in the plugin marketplace.
- **An MCP server** over the same API (`src/Mcp.js` or a separate small package), with the plan, thread, reply and apply routes as tools, so Codex, Cursor and the desktop's local models reach Consensus the same way. Listed in the MCP registries.
- **Package managers for the desktop**: winget and scoop on Windows, Homebrew cask on the Mac, an AppImage and a `.deb` on Linux, once the installers are signed (plan Installer).
- **Awesome lists**: awesome-claude-code, awesome-mcp-servers, awesome-ai-tools, with the one sentence and the GIF.


## Step 3: Launch

Posted in one week, each with the recording and a link to the demo project:

- **Show HN** on a Tuesday morning US time, the title plain: "Show HN: Consensus-AI, work a plan through with your AI before writing code". The first comment is ours: why threads and not chat, what is local, what is MIT.
- **Product Hunt** two days later, with the same assets.
- **Communities**: r/ClaudeAI, r/ExperiencedDevs, r/LocalLLaMA (for the local models), Lobsters, the Claude Developers Discord, the Cursor forum. Each post is written for that place, not cross-posted.
- **The Anthropic developer showcase** and a "built with Claude" write-up.
- **Content, monthly after the launch**: a write-up of one feature argued out with an agent, with the plan, its threads and the build log shown as they are. The first three: Run Shapes, Markdown Editor, and this plan. Published on the docs site under `/blog`, syndicated to dev.to and Hacker News.
- **A Discord server** and GitHub Discussions, linked from About, with a `good first issue` label on a dozen small items the day of the launch.

What counts: stars, npm and Docker pulls, desktop downloads, Discord members, and the number of public repositories with a `.consensus` folder (a GitHub code search), checked weekly in a document in the Context folder.


## Measures

The plan is working when, six months after the launch: a thousand GitHub stars and a hundred public repositories with a `.consensus` folder. The licensing measures went with the plan Monetization.

## Marketing
### Feature/Tag Lines

Sprinkled throughout the public docs and advertisements.

- Consensus-AI uses less tokens. Rather then send all of the context, we send only the right context.
- Stakeholders can view and interrogate a Project's status.
- "An AI Harness with style"
- Build better, faster, and cheaper. (Explain)
- "Would you buy a home without an inspection? No? Then why would you ship a mission critical system into production that nobody understands?"
- Consensus-AI unleashes colaboration while enforcing accountability.
- Keep track of the what, when, who, and why of everything built.

