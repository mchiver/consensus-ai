# Step 3: The instructions and the docs

The third step of plan MCP Server: the served instructions, the guide and the readmes say how an MCP client takes part, and the API reference is rendered from the definition so the reference and the tools cannot drift.

## The instructions

The served page (`.guides/build-with-consensus.md`) gains a section, **Through MCP**: the two configurations (the stdio relay for Claude Code, Cursor, Codex and Claude Desktop; the URL `http://<server>:<port>/api/mcp` with the caller's header for an HTTP client), the tools as the same operations as the routes, the words the same ("check consensus", "your turn", "build it"), the one-project rule the same. The `instructions` operation serves the page, so the section is also what an MCP-only client reads first.

## The docs

- `docs/guide/api.md`: the routes it lists are rendered from the definition by `bin/docs.js build`, each with its operation's name, description and parameters, so the reference and the MCP tools are one text.
- `docs/guide/llm.md`: a bullet under "How you hand the page over" for an MCP client, and a section naming the two transports and how a client is configured.
- `docs/guide/features.md`: one line under Working with LLMs.
- The readme's LLM paragraph, and the project's Readme in Consensus (the architecture line for `Operations.js` and `Mcp.js`, the Settled decisions entry).

## Tests

`test/Docs.test.js` builds the site as today; the API page's rendering from the definition is checked in `test/Operations.test.js` (every operation appears on the page). `node bin/docs.js build` clean; `node --test` green.
