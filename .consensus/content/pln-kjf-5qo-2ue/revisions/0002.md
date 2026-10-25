# Step 7: The guide and the close-out

The website and the readme tell the new shape, and the plans this one supersedes are closed.

## What is built

- **The guide.** Getting started is rewritten around the Desktop (install, open a folder, the sidecar and the Copy instructions button, the MCP entry); a new page, The Server Host (`docs/guide/host.md`), takes the registry, mounting, the users and roles, the LLM connections and `consensus serve`, while Sharing a server stays its own page after it in the pages order, rewritten for mounting so its links hold; the LLM page says where connections are edited; Settings and themes lists the two files; Features gains the Desktop, the sidecar and the tiers; the pricing page is Step 6's. New pictures from the seeded Desktop and Host, light and dark.
- **The readme.** Starting it, The config folder, The desktop and The API are rewritten for the two modes; the license paragraph names the three tiers; Layout of the code lists the new files (`project-view`, the shim's folder form, desktop.json).
- **The instructions.** `.guides/build-with-consensus.md` and the served page say sidecar first, Host second, with the one-project rule and the MCP entry.
- **The plans.** Monetization (pln-qr1-aed-21x) is archived with a closing thread pointing here; Accounts and Roles stays as the roles reference; Teams and the Clerk subplan get a note that the shape is this plan's. This plan is set Finished when the guide is published.

## Checks

`test/Docs.test.js` over the new page and pictures; `node bin/docs.js build` clean; the docs published to the bucket on the owner's word.
