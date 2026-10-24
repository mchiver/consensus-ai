# Monetization

What is sold, what stays free, and in what order. Split out of the plan Promotion and Monetization on 2026-10-23 (its Steps 4 to 6, Before any charge, Services and the licensing measures, brought onto the per-person license model on 2026-10-21), to be taken up later, after Clerk Step 6. It rests on three statements:

1. The core stays MIT and free for a single user on their own machine with their own API key. Money comes from the licenses people hold: a User license for an Owner or a Member on any shared server, which is also the solo professional's commercial desktop license; a Host license to run a shared server; a Site license for a team; then from LLM runs performed on our key, and from hosting and support.
2. Nothing is sold before the server knows who is calling. That is met: since Clerk Step 5 a Public server admits a Consensus-AI sign-in or an account's token and nothing else, and reads the person's license from their sign-in; only Clerk Step 6, the production instance, stands before the first sale.
3. Revenue comes in the order of least infrastructure first: the per-person licenses, then managed runs, then hosting. Services (support, workshops) run alongside from the start.

The steps below are in order. Step 1 is the first money and waits on Clerk Step 6 alone; Steps 2 and 3 follow.


## Step 1: The paid line

The licenses, stated once, and the rule for which side of the line a feature falls on: a single person on their own machine with their own key pays nothing; a shared server, a seat on one, or work our servers do for you is paid. A license belongs to a person, not to a server (plan Clerk, The license): it is the `License: { Plan, Until }` public metadata on the person's Consensus-AI account, or on their organization, carried into every session token and read by the server at sign-in, at the Scope and at the drag into a role. A server is bound to nothing and counts nothing.

| Plan | Price | What it holds |
|---|---|---|
| Free | 0 | The whole application on a Local server: no sign-in, any number of installations, own API keys, MIT |
| User | 10 a month, or 99 a year | An Owner or a Member on any Public server where the person holds an account; the commercial desktop license; a monthly quota of managed runs (Step 2) |
| Host | 25 a month, or 249 a year | Runs a Public server and is its Administrator; includes User |
| Site | 8 a seat a month, five seats at least | A Consensus-AI organization carrying User for its members, the seats being Clerk's membership cap; the hoster's Host license is bought beside it |
| Enterprise | by agreement | On-premises terms, SSO through Clerk's enterprise connections, support with an SLA, training |

The prices are a starting point to test against the first hundred users, not a decision; they are in US dollars. A Watcher needs an account and no license; a Service account is a token and has none.

**The commercial desktop ask.** Free is personal and evaluation use. Commercial use on a Local server asks for a User license after thirty days, Sublime style: the application never locks and counts nothing; About shows the license state, and once a week on start an unsigned-in server says that commercial use needs a User license, with the Sign in button and the pricing page. A session holding User or above silences it. There is no key and no module of its own: the check is the Local sign-in Clerk Step 5 built, reading the same claim.

**The store.** Licenses are sold through Lemon Squeezy or Paddle, which handle tax. The store's webhook lands in Consensus itself: `POST /api/store/webhook` in `src/Store.js`, verified by the store's signature, alive only on a server whose settings hold a `Store` section and the Clerk secret key, which is our own server (the docs host or the hosted tier's), never a customer's. On a sale it finds the Clerk user by the buyer's email, or creates one so that the invitation mail is Clerk's, and writes the License through the Backend API; for a Site license it creates the organization with the seats as its membership cap, writes the License on it and makes the buyer its admin; a renewal moves Until, a cancellation leaves Until to run out. The buyer signs in with the same email anywhere.

**The free Public server.** The Docker image and the headless server are free to download and run as Public servers, hold any number of accounts and count nothing. What a free team is short of is licenses: the Administrator needs Host and every Owner and Member a User license, while Watchers read and press the read-only tasks for nothing. That is how Clerk Step 5 is built.


## Step 2: Managed runs

Bring-your-own-key runs stay free and unlimited. A run on a Consensus key cannot be counted by the customer's server alone, since our provider key cannot live in a desktop, so managed runs go through a relay of ours: an LLM connection kind `Consensus-AI` in the Settings popup, pointed at the relay, whose credential is the person's session token (a Local server signs in for it, as it does for going Public). The relay reads the monthly quota from the claim, `License.Runs`, written by the store with the plan (so many runs a month on User, more on Host, pooled on a Site), counts the runs on our side, and refuses over the quota with a plain answer the toast shows; Settings shows the count. Metering by tokens, at the provider's price plus a margin, comes only when the quota is being hit, and is a step of its own then.

What the Team step promised before the license model is elsewhere: shared projects, accounts and roles are the Public server (plans User Management and Accounts and Roles); the Git sync of `.consensus` is Work's options (plan LLM Tasks); the audit log is each account's activity history; backups are the export; SSO and on-premises terms are Enterprise's, by agreement.


## Step 3: Hosted

Consensus-AI Cloud: a Public server run by us, one per customer, projects in a volume, the LLM connections on the customer's keys or on managed runs, billed per month with the Host license included; the customer's team signs in on its own User licenses or a Site's seats. It comes last because it carries the running cost and the on-call, and because by then the licenses have told us what the customers are. The desktop and the hosted server are the same program, so a customer moves between them with an export.


## Services and small money

From the launch on, independent of the steps:

- **Support contracts and on-premises licenses** for any company that asks, priced by agreement, with a page on the docs site that says so.
- **Workshops**: a half-day on planning with an agent, Consensus as the medium, for engineering teams. The starter plans of the promotion work are the material.
- **GitHub Sponsors** linked from the readme, and a paid template pack (industry-specific plan sets) in the desktop's Templates, both expected to be small.


## Before any charge

What must be true before the first key is sold, in order:

1. Clerk Step 6 is done: the production instance under consensus-ai.liquicode.com, the session token template carrying the license, the License metadata the store writes, the pricing page; so a sale lands on an account every server can read.
2. The installers are signed (plan Installer), because a paid download that the OS warns about is a refund.
3. A privacy statement on the docs site: everything is local unless you turn on managed runs or sync; what leaves the machine, and to whom, is listed.
4. Opt-in telemetry, off by default, counting starts, plans, threads and runs, with the question asked once on first start, so the prices and the tiers can be tested against use.
5. Terms of sale and a refund policy on the docs site, written by a lawyer once; the store handles tax.


## Measures

The plan is working when, six months after the launch: a hundred User licenses sold, and five Site licenses. If the licenses do not come but the stars do, the price is wrong or the commercial ask is too soft, and Step 1 is revisited before Step 2 is started.
