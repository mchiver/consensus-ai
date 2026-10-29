# Tool calls only

Every LLM a Server runs works through tool calls the Server carries out itself. No token is handed to a model, written into a prompt, or kept in a run's record.

The `claude-cli` connection is dropped. In its place come API connections to the hosted models: Claude, ChatGPT, Gemini and Grok, and any other service that speaks the OpenAI API. Ollama stays as it is.


## Why

- A `claude-cli` run gets the API's address and a run token in its prompt, and the command calls the API with it. Anyone who can read the run's Prompt (GET /api/runs/<id>) can read the token, and the model can do anything the token allows, by any route it likes.
- An `ollama` run already works the other way: the Server offers the model its tools, runs each call itself and sends the result back (src/Ollama.js, src/Tools.js). The model never sees a token. This plan makes that the only way a run works.
- A command on the Server's machine needs that program installed, signed in and kept up to date there. An API connection needs only an address, a model and a key.


## Connections

- The kinds of connection are:
  - `claude`: Anthropic's Messages API (https://api.anthropic.com).
  - `chatgpt`: OpenAI's API (https://api.openai.com/v1).
  - `gemini`: Google's Gemini API (https://generativelanguage.googleapis.com).
  - `grok`: xAI's API (https://api.x.ai/v1).
  - `openai-compatible`: any other service that speaks OpenAI's chat completions, at the Url given: Mistral, DeepSeek, Groq, OpenRouter, or a model served on the network (LM Studio, vLLM).
  - `ollama`, as today.
- A connection keeps its Name, Kind, Model, Timeout, Rounds, its Session Prompt and what Packaging leaves out, as today. An API connection adds its Url (filled in for the named kinds, and changeable) and its Key. Context stays Ollama's alone. Command and Arguments go.
- The Model is required. Check asks the service for its models with the Key as entered, says whether the Key is good, and offers the models in a list to pick from.
- A new connection is offered the name `<kind>-<model>`, such as `claude-sonnet-4-5`, as `ollama-<model>` is today. Its runs post as `<connection> by <person>`, as before.
- The Administrator and the Managers make, change and delete connections, as today. Nothing changes in who may press a task.


## A run

- Every run is the tool loop that Ollama runs today, moved out of src/Ollama.js into one loop for every kind. A small adapter per wire format turns the Server's tools, the messages and the model's calls into what that service expects and back. There are three formats: Anthropic's Messages, OpenAI's chat completions (ChatGPT, Grok, Gemini and the compatible kind) and Ollama's chat.
- The calls are plain fetch requests from the Server, with no provider's library added.
- The tools are the Server's, as an Ollama run has them now: the file tools over the project's folder (glob, grep, read; write, edit and run when the task writes files) and the Consensus tools from the interface definition, within the run's project and as far as the task's Writes allows. A service's own server-side tools (its web search, its code execution) are not turned on.
- The package's instructions are the tool instructions for every kind. The page at /instructions, with its token line, is for agent sessions and no longer goes into a run's prompt.
- The Consensus tools are performed inside the Server, as the person who pressed, through the connection (the operation's Perform, as MCP does). No run token is minted: the run itself carries the person, the connection's name and the task's Writes, and a write beyond Writes is refused as it is today. A run's record keeps no Token.
- A run's Transcript grows an entry at a time (what the model said, each call and its result, the answer), and the Output is rendered from it, as an Ollama run's is. Nothing streams within a round. Its Usage records the tokens sent and received that the service reports, and the run's popup shows them.
- The Timeout is the deadline of the whole run and Rounds the most requests it makes, for every kind. A refusal from the service (a bad Key, a model it does not have, a limit reached) ends the run Failed with the service's own words.


## The Key

- A connection's Key is kept in the Server's settings with the connection (consensus.json in the config folder), the file the Server already keeps to itself.
- The Key is write-only: no answer of the API, no page, no run record, no log and no prompt carries it. The connection's Details show whether a Key is set, with a box to replace it; a connection saved without a new Key keeps the one it has.
- A Desktop in sidecar mode has no connections, as today, so it reads no Key.


## Dropping claude-cli

- `claude-cli` leaves the kinds, with its Command and Arguments, its spawn in src/Runs.js, LLM.CommandLine and its Check.
- A `claude-cli` connection already in a Server's settings is removed when the Server reads its settings, and the Server's log names it. A project that had chosen it is left with no connection chosen, and its task buttons say so, as for any project that has not chosen one. Today an unknown Kind is read as the first kind; that changes: a connection of a kind the Server does not know is removed, never turned into another kind.
- The tests and the smokes that stand in for a model with a `claude-cli` command running a node script use a stand-in service instead: a small HTTP server in test/support that speaks OpenAI's chat completions, answering from a script, its tool calls included.


## What does not change

- Agent sessions and MCP clients (Claude Code, Codex, Cursor) the person runs themselves still act as that person on the token LLM Instructions mints. This plan is about the runs a Server makes.
- Desktop, Sidecar and the Client change in nothing but the connection's Details on the page. The tasks, their packages, the queue and the run popup stay as they are.


## Steps

1. **One tool loop.** src/Loop.js from src/Ollama.js, with the Ollama adapter; Tools.js performs the Consensus tools inside the Server as the run's person, and runs mint no token. Ollama runs behave as before, and their tests check it.
2. **API connections.** The kinds `claude`, `chatgpt`, `gemini`, `grok` and `openai-compatible`, with the Anthropic and OpenAI adapters; Url, Model and the write-only Key in src/Llms.js; Check with the models list; the connection's Details on the page; the stand-in service in test/support.
3. **claude-cli out.** The kind, its spawn and its Check removed; old connections removed when the settings are read; the tests, bin/smoke.js and bin/docs.js moved to the stand-in service.
4. **The guide.** docs/guide/llm.md (Who an LLM is, Connections and runs), the Features page, getting-started where it names claude-cli, .guides/build-with-consensus.md where it does, and the Readme.
