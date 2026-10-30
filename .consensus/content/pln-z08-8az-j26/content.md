# Step 5.3: The local API, MCP and instructions

Part of Step 5: The editions cut, the third of its three builds, built on "build step 5.3", reported in its own build log and committed on its own acceptance. The four editions as the owner cut them on 2026-10-29: Sidecar opens a local folder; Client opens one remote project on one Server; Desktop opens several remote projects at a time from one or more Servers, never a local folder, at Personal; Server opens local folders and serves them to the others. Every edition serves the API, MCP and the instructions on its localhost address.

## What changes

On the page server of the Client and the Desktop, beside /servers/<key>/api:

- **/api/*** forwards to the window's upstream: the Client's one Server; in the Desktop the current root, the one whose project is open (remembered as a page key, the first Server until one opens; decided 2026-10-29). The upstream changes as the person opens a project elsewhere, so an agent mid-task reads the instructions again when a call answers an unknown project; the instructions say so. A request with no Authorization gets the person's session token: session.js calls the bridge's SetToken with every token it gets (at load and at every refresh; Clerk refreshes it about once a minute), the main process keeps the latest and its expiry, and with no token yet (nobody signed in) the proxy answers 401 "sign in", as a Server would (decided 2026-10-29); a request carrying its own token is passed as it is. The header X-Consensus-Service is passed through, so an agent beside the window posts as "<service> by <person>".
- **/instructions** is composed locally with Instructions.Make: This server names the local address, the window's project (the Client's one; the Desktop's current one, with the note that the others are reached under /servers/<key>), and says a request with no token acts for the signed-in person; the guide is the common one, build-with-consensus.md, for the Client and the Desktop alike, no third guide: what the agent does on a plan is the same, and the local address and the proxy's rule are said in the composed text above it (decided 2026-10-29).
- **/api/mcp** is Mcp.js over a remote operations adapter: the definitions from Operations.Definition, Perform( name, participant, args ) turning the call into the upstream REST request through Operations.Route with the token; initialize, ping, tools/list and tools/call as on a server. The stdio shim reaches it as it reaches any server, with --server http://127.0.0.1:<page port>.
- The upstream does the authorizing; the proxy refuses nothing of its own.

## Also

- The guides name the local address for every edition; the common guide, build-with-consensus.md, is the Client's and the Desktop's.
- Step 5 is set Finished on this subplan's acceptance.

## Checked by

New tests on the proxy (a forwarded call carries the person's token; an agent's own token passes as it is; no token yet answers 401 "sign in"; X-Consensus-Service passes through; /instructions names the local address and the window's project; an MCP tools/call becomes the upstream request), over a stand-in upstream as test/Probe.test.js has. The whole suite.

## Decided before the build

Everything, on Step 5's design turn of 2026-10-29 (its six threads); nothing further to design here.