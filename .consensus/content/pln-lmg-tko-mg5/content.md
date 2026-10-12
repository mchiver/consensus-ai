# LLM Tool Usage

How Consensus supports tool use by LLMs today, and how it could go further for an LLM that cannot reach the Consensus server itself.

## Today

Two kinds of LLM take part, both as the `llm` participant.

**The agent session** (Claude Code on this machine) has direct access: it reads and writes the codebase with its own tools, and works in Consensus through the REST API with the llm participant's token (`.guides/build-with-consensus.md`). Anything the page can do, it can do.

**The one-shot LLM** (Send to LLM) has no tools at all:

- `claude-cli` runs `claude -p` with every tool turned off (`--tools ''`, `--strict-mcp-config`); `ollama` is a single chat request.
- Everything it gets is packed into one prompt: the rules, the project's context, the proposal at its current revision, every thread, and for each thread waiting on it the 3 best search hits in its project, each clipped to 600 characters.
- Its only "tool call" is the answer itself: one JSON object held to a schema (`--json-schema` for claude, `format` for Ollama), with three actions: reply, apply, and context. The server carries them out through the same rules as the API.

What the one-shot LLM cannot do:

- **Look further.** It cannot read another plan whole, an older revision, a whole file from a zip, or run its own search. The server picks what it sees, from the anchor words and the last reply. The rules tell it to ask in a reply when it needs more, which costs a round.
- **Act beyond the three actions.** It cannot open a new thread (a review can only answer threads that exist), set a state, or create a plan.
- **Be reached any other way.** Only a model Consensus can call (claude on this machine, or Ollama) takes part; a chat LLM in a browser cannot.

## Going further, without direct access

In every option the server stays the only thing that touches the data: it runs each tool, within the plan's project, and a tool's result is data for the model, never instructions.

1. **Copy prompt / paste answer.** A button copies the packed prompt; a box takes the JSON answer back, and it is carried out as if the call had made it. Any LLM anywhere (claude.ai, a phone app) can then take a turn, with nothing to install. The smallest change, and it works with every model.
2. **A "need" action.** The answer may ask for more instead of acting: `{ "Kind": "need", "Items": [ a plan, a revision, a file, a search ] }`. The server gathers them and calls again with them in the prompt, up to a few rounds. Works with any model that can follow the JSON format; no tool-calling support needed.
3. **More actions.** `thread` (a new comment on a passage or the whole document), so a review can raise its own points; perhaps `state`. Small, and it makes one-shot reviews much more useful.
4. **A tool loop in the server.** For models with native tool calling: Ollama's `tools`, and claude through an MCP config pointing at a small Consensus MCP server that `claude -p` launches. Read-only tools (search, read a plan, a revision, a file, list the project) run by the server in a loop until the model gives its answer. The most capable, and the most work: a loop, limits on rounds and tokens, and models that differ in how well they call tools.
5. **A Consensus MCP server for any client.** The API as MCP tools, over stdio or HTTP with a token, so an MCP client elsewhere (Claude Desktop, another agent) can work in Consensus directly. That is direct access by another road, and it needs the server reachable, so it does not fit "no direct access"; worth it later.

## Recommendation

In order: **3** (new threads from a review) and **2** (the need action) first, since both are small, work with every model, and fix the two biggest limits; then **1** (copy and paste) for LLMs Consensus cannot call; then **4** if the one-shot reviews still need more. Leave **5** until something needs it.

## Where the options went

- **1** (copy prompt / paste answer): built, as Manual in the session dialog.
- **2** (the need action): built, as Requests.
- **3** (more actions): moved to the plan Review, as its `thread` action.
- **4** (a tool loop): became the plan Workers, where the loop runs on a worker beside the code instead of in the server.
- **5** (a Consensus MCP server for any client): left for later, when something needs it.

This plan is finished; the work goes on in Workers.
