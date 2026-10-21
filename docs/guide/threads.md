# Threads

A thread is a comment on a plan, and the way a plan is settled. You comment on a passage, the LLM replies, you resolve, and the LLM applies the outcome to the text. The plan is done when every thread is applied.

![A plan with its threads: the anchored passages in the text, the threads on the right.](../images/plan.png)

## Starting one

Select text in the plan, click **Comment**, write and post. The thread is **anchored** to the words you selected, which are highlighted in the text. A comment with nothing selected is on the whole document.

![Selected text and the comment being written.](../images/comment.png)

## The three states

Every thread is in one of three states, and the colour of its passage says which.

- **Contested** (yellow): under discussion. The thread waits on everyone except the one who replied last, so a reply hands it over.
- **Resolved** (blue): the owner has settled it, and it waits for the LLM to apply the outcome. It never looks finished before the text shows it.
- **Applied** (green): the LLM changed the text, or confirmed that nothing had to change, and recorded who, when, the revision and the outcome.

![The threads pane: a contested, a resolved and an applied thread.](../images/threads.png)

Any reply to a resolved or applied thread **reopens** it (orange): contested again, marked reopened. Reopening never reverts a change already applied; resolving it again makes it wait to be applied again.

## Resolving

Only the owner resolves, with the one **Resolve** button, in one of two ways:

- With a reply typed in the box, Resolve posts it and resolves the thread with it. Your reply is the outcome the LLM applies, read as the answer to the question before it.
- With nothing typed, Resolve accepts the outcome, or the recommendation, in the last reply.

The selected thread's header has two tools at its right: **Re-anchor** (the target), which puts the thread on a passage you select, and **Start a new Subplan** (on a plan), which replies with a link to a new Subplan that starts from the thread.

On a resolved or applied thread the Reply button reads **Reply and Contest**, in the contested colour: it posts your reply and reopens the thread, which stays open and contested.

Resolving means agreeing with how the thread was deliberated and decided, not with any one line in it: the last reply states what goes in.

## Whose turn

**Waiting on you** in the title bar counts every thread waiting on you, across projects and servers, and opens the Waiting tab; beside it, while an LLM run is in progress on any server, **Running** counts the runs and opens the first one's LLM page. The threads pane filters by state and by whose turn it is, and highlights every thread's passage in the text or the open ones' only (the two pickers stay at the top while the list scrolls); both choices are the page's, the same in every item, and remembered in the browser. A plan's row shows a "you" badge with the count. Clicking an anchored passage selects its thread, and clicking a thread's quoted words in the pane scrolls the text to its passage and flashes it; the selected thread stays listed whatever the filter, until another is picked or the selection is cleared with Escape (in Monaco mode's Read view a click off any highlight clears it too). After your own reply or resolve the selection passes to the next thread in the pane (or the previous one, when it was the last), so you can work down the list.

![The Waiting tab: everything waiting on you.](../images/waiting.png)

## Anchors that follow the text

An anchor holds to the visible words, not the markdown, so bold and links do not break it. After every change to the text each anchor is found again: one whose words changed a little follows them; one that cannot be found is **detached**, shown first in the pane, and can be re-anchored by selecting text.

## Deleting

The owner deletes a thread with the **×** on its first line. A revision that applied a deleted thread keeps its text and shows "(deleted thread)".
