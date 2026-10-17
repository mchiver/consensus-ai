# Step 4: Closing and Shutdown

The fourth step of plan Markdown Editor: the one Save / Discard / Cancel prompt, listing the documents, on a tab's close, on Close others and Close all, and on the desktop's close over the preload, the last two behind the Confirm on close setting; the browser's beforeunload (points 7 and 8 of the parent). The prompts are the tabs', so they hold in both modes.

## Decided in the parent

- Point 7: closing a tab that holds a draft asks Save / Discard / Cancel; Close others and Close all ask the same when any tab they would close is dirty, the one prompt listing the documents that would lose their changes, one per line; Save saves them all and closes, Discard closes them unsaved, Cancel closes nothing. A detached window's close counts as the tab's.
- Point 8: Confirm on close is an application setting, on by default, kept with the Editor setting behind the title bar's gear. With it on, the desktop's window close asks the page, over the preload, for the dirty tabs and shows the same prompt as Close all; a browser raises its own leave-page prompt from beforeunload. With it off, the window closes and the browser leaves without asking. A headless server cannot prompt anyone. Drafts persist across a restart, so a close that was not asked about loses nothing.

## Decided before the build

1. A close-prompt component, one in the page, opened by a Closing service: Closing.Ask( Tabs ) returns save, discard or cancel. "N documents have unsaved changes" (or the one's title), the titles one per line (a stale one marked "stale, cannot be saved"), Save, Discard and Cancel; Enter is Save, Escape Cancel; the Help popup's backdrop and styles.
2. Tabs.Close, CloseOthers, CloseToTheRight and CloseAll go through Closing with the dirty tabs among those to close: none dirty, they close at once; Cancel, nothing; Discard, the drafts dropped and all close; Save, each draft saved on its root (Tabs.SaveDraft( Tab ): PUT /text with the draft's text and base), then all close; a refused save keeps that tab open with a toast and the rest close. The prune and a detached window's "closed" message do not ask.
3. The draft is current (Step 3 writes it on every change); no flush is needed.
4. Confirm on close, a checkbox under the Editor select in the look popover (State.ConfirmClose, key confirm-close, on by default, remembered where the Editor setting is), guards the window's close and the browser's leave prompt. A tab's close asks regardless.
5. main.js's close handler sends close-requested to the window's page and waits; the preload exposes ConsensusDesktop.OnCloseRequested( Handler ) and CloseDecided( Ok ). The page answers true at once with the setting off or no dirty tab; otherwise the prompt over its dirty tabs, Save saving them all before true, Discard dropping them and true, Cancel false. No answer within three seconds and the window closes anyway. Quit closes each window in turn; detached windows get the same handler.
6. In a browser, with the setting on and a dirty tab, a beforeunload handler sets returnValue; with it off, no handler. The drafts stay in localStorage either way.
7. Discard at the desktop's close drops the drafts before the window goes; a browser's Leave keeps them; a close that was not asked about keeps them.
8. Tests: browser, the × of a dirty tab and the prompt, Cancel, Discard, Save with the revision bumped, Close all with two dirty tabs one stale, the setting toggled and remembered, the beforeunload handler called directly; the desktop smoke, a dirty tab and window.close(): the prompt, Cancel, the setting off and the app ending.
9. Out of this step: the guide (Step 5).
