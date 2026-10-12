# UI Tweaks IV

Tweaks to the desktop's page after Step 3 is in use (plan Consensus Desktop). Everything here is in the desktop's copy of the page, `desktop/page/`, and its main process; the server and `public/` are not touched. Built as one plan, in the order below.


## Project Tree

- Clicking a folder's row expands or collapses it, as the chevron does. Picking a folder as the place for new items (the click's job today, with "New plan in <folder>" in the project's menu) is dropped: new items go where their menu says.
- A folder's menu gets **New folder** and **New plan**, which create in that folder (the inline name box opens under the folder's row). The project's menu keeps New plan, New document in Context and New folder, which create at the root. A plan's menu keeps New Subplan.
- The Context folder's count includes the LLM connections and the project's workspaces it shows.


## LLM Page

The page keeps a short head (the connection's name, kind and model, with **Details…** and **Packaging…** buttons), then Run, then the Log. Each popup is a dialog like the settings popup: Save and Cancel, the problems shown in it, and nothing on the page changes until it is saved. The Run buttons no longer depend on an unsaved form.

- **Details popup**: Name, Kind, Command, Arguments, Url, Model, Timeout, and Check, as the page has them today.
- **Packaging popup**: the items of the prompt, in the order they are packaged:
    - Agent Instructions and Readme, checked or not, as today.
    - **The other Context documents**, listed by title, each checkable on its own: a checked one goes into the package as a title and id (as today's list does).
    - **The threads waiting on the llm participant** of the plan at hand (the one picked in Run), listed by anchor and the first words of the last reply, each checkable on its own: a checked one goes into the package whole.
    - A document or thread is checked unless it was unchecked here; the unchecked ids are remembered per connection, so a new document or thread is in by default.
    - The Review, Build and Session prompts with Reset, as today.
    - A **Preview** button packages the prompt for the plan and workspace picked in Run and shows it in the popup with its **character count and an estimated token count** (characters divided by four, shown as "≈ n tokens"; no tokenizer is run). Copy copies it.
- **Run**:
    - The plan picker is the page's own dropdown list (a panel like the actions menu, since a select element can neither indent nor nest), listing the project's plans in the tree's order, with the same grouping and indentation: a folder is a heading line in the list (not pickable), and a plan is indented under its folder or its parent plan as the tree indents it; the picked one is marked. Documents and the Readme are not listed.
    - The Review, Build and Session buttons are enabled unless a run is going, the connection is ollama (Step 4), or the button lacks what it needs: Review and Build need a plan, Build needs a workspace. The reason is shown as text beside the buttons when one is disabled, not only in a tooltip, and Stop shows while a run is going.
- **Log**:
    - A run opens in a **popup**: its line (status, kind, plan, workspace, when, duration, exit, error), the output and the prompt, each with its **character count and estimated token count**, each with Copy. Refresh while it runs.
    - The output and the prompt are **rendered as markdown**, as a reply is, with a **Source** toggle for the raw text.


## Workspace Page

- Below the details, the **files the workspace includes**: walked from the Path with the Include and Exclude patterns (globs, as the worker's settings had them: `**` crosses folders; Include empty means everything), listed as relative paths with their count, the list updated on every change to Path, Include or Exclude (debounced), before Save. The walk is the main process's (`desktop/Files.js`, from the retired Workspace.js); it skips what Exclude names without entering it, and the list shows the first 500 files with "and n more".


## Monaco Editor

- The editor scrolls past the end of the content (Monaco's `scrollBeyondLastLine`), in the edit view and the preview alike.


## Miscellaneous

- The desktop's **title bar and menu bar follow the theme**: light or dark, through Electron's `nativeTheme`, set from the desktop's Theme (system follows the system). Colours beyond light and dark cannot be put on the native bars; that would need a frameless window with the app's own menu bar, which this plan does not do.
- **Theme variations**: besides Light and Dark, an assortment of palettes, picked in the same Theme control: light ones **Sepia** (warm), **Paper** (high contrast) and **Solarized Light**; dark ones **Slate** (blue-grey), **Solarized Dark**, **Nord** (cool) and **Midnight** (black). A palette is a set of the page's CSS variables under a `data-theme` value, light or dark for Bootstrap and the native bars; Monaco gets a matching theme. The desktop keeps the choice in desktop.json, the browser in its storage, as today.
