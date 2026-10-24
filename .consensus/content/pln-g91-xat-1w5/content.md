# Step 2: The MCP module and the two transports

The second step of plan MCP Server: the Model Context Protocol over the definition Step 1 made, in the server (`POST /api/mcp`) and as a stdio relay on the client's machine (`bin/mcp.js`), written without a library; and the run's tools read from the same definition.

## The module

`src/Mcp.js` holds the protocol, with no transport in it:

- `Handle( Message, Participant )`: one JSON-RPC 2.0 message in, the reply out (or nothing for a notification). `initialize` answers the protocol version (`2025-06-18`, or the client's when it is one we know), the server's name and version, and `capabilities: { tools: {} }`; `ping` answers `{}`; `tools/list` the definition in MCP's form (`name`, `description`, `inputSchema`), every operation a tool; `tools/call` runs the operation as the participant and answers `content: [ { type: "text", text } ]`, with `isError: true` and the refusal's sentence when the operation refused. An unknown method is `-32601`, bad JSON `-32700`, a bad argument `-32602`. A batch (an array) is answered as an array.
- `Project` is a project's id or its name wherever an operation takes one; the tools that take a plan take its id.

## Who the caller is

The same as for any request. The stdio relay says who it is with `--service <name>` (the `X-Consensus-Service` header; `MCP` when none is given, so the byline reads "MCP by User") or `--token <token>` for an account's token on a shared server; the HTTP transport reads the request's own headers, as the API does. On a Local server a relay with neither is the owner. Every operation is then checked by its action, so a Watcher's MCP reads and a Member's replies, as their roles say; the plan's State stays an Owner's.

## The network transport

`POST /api/mcp` on the server, the Streamable HTTP transport in its request-response form: a JSON-RPC request (or a batch) in the body, the response as `application/json`. Nothing is server-initiated, so `GET /api/mcp` answers 405 and no `Mcp-Session-Id` is issued; the server is stateless across calls. The route sits under the API, so identify and authorize cover it (`POST /mcp` allowed to every identified caller in the route table; each operation is checked on its own action), a bare request on a Public server is refused as on every route, and the handler calls the operations in the server's process as the request's participant. A client's configuration is the URL `http://<server>:<port>/api/mcp` with the header it uses.

## The stdio transport

`bin/mcp.js`: `node bin/mcp.js --server http://127.0.0.1:3500 [--service <name> | --token <token>] [--project <id or name>]`, with a `bin` entry in `package.json`. It reads newline-delimited JSON-RPC from stdin, answers on stdout, logs to stderr only (stdout is the protocol), and exits when stdin ends. It runs on the client's machine, so it reaches the operations the way a session does: each message goes to the server's `POST /api/mcp` with the caller's header, and the answer is passed back. `--project` fills `Project` for the tools that take one and leave it out, which is how sidecar mode's one-project rule is set for a client; without it the client names the project, or finds it as the instructions say.

The relay needs a running server, as a session does: when the server does not answer, every call is an error that says so, and the relay does not start one. A client's configuration is one line: for Claude Code `claude mcp add consensus -- node <checkout>/bin/mcp.js --server http://127.0.0.1:3500 --service Claude-CLI`, or the same in `.mcp.json`; Cursor, Codex and Claude Desktop take the same command in their own files.

## The run's tools

The Consensus tools a local model gets (`src/Tools.js`) become the same definition in Ollama's form, held to the task's Writes as today: the reading operations at every level, the writing ones when Writes is not none, the project fixed to the run's. The file tools stay as they are. Nothing a run can do changes; its tool list grows to the operations it may call.

## Tests

`test/Mcp.test.js`: `Handle` as a participant (initialize, ping, tools/list, a call that answers, a call the operation refuses, a batch, bad JSON, an unknown method); the relay over piped streams against a server started in the test on a temporary config (as `test/Tools.test.js` starts one), a thread posted through it carrying the byline; `POST /api/mcp` on the same server, and a bare request refused on a Public one. `test/Tools.test.js` brought to the definition. `node --test` green.
