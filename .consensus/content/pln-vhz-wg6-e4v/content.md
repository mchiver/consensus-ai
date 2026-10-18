# Usage Scenarios

## Local LLM (Sidecar Mode)

When running both an LLM session and a Consensus session on the same machine, You can use the LLM to control Consensus by directly accessing the Consensus MCP Server.

1. Teach the LLM to use Consensus by having it read the Consensus server's instructions page (e.g. http://localhost:3500/instructions). Or copy the instructions directly into the LLM session.
2. The LLM now understands directions like "check consensus", "your turn in consensus", or simply "your turn".
3. The LLM now has access to the Consensus MCP Server giving it tools to investigate and transform the Project's files.
4. The LLM can also manage Consensus with instructions like "create a new draft in consensus to discuss this new feature" or "build the "New Feature" plan and then mark it as finished".

Changes made by the LLM instantly appear in your Consensus view.
All of your comments and replies are unread by the LLM until you say "your turn".

## Remote LLM

Consensus is running on a different machine from the LLM.
The LLM does not have direct access to Workspace files.
Consensus sends task specific tool usage instructions to the LLM. 

All LLM interaction is triggered manually by the user who can initiate a specific task via button press.

- **Enhance**: Enhance a plan's content with additional detail. User supplied custom instructions steer the enhancements.  Used to fill in the gaps and take a rough idea into a formalized plan. LLM updates plan content and/or posts clarifying questions.
- **Respond**: LLM responds to threads waiting on it. LLM updates plan content and/or posts clarifying questions.
- **Build**: LLM interacts with the Project's workspace. Results in a build log. Checkboxes for git sync and auto-commit. Build log used for any commit notes.

## Planbuilding

1. Start a new draft with a rough sketch or bullet points of an idea.
2. Create a comment that says something like "replace this plan text with a more detailed version. create threads to ask questions for clarity".
3. Force an LLM turn which provides a detailed plan based on the original rough sketch. Any ambiguities are posted as newly contesteed threads.
4. Respond to all contested threads and force an LLM turn. Repeat this step until all threads are resolved. The result is the final plan.



