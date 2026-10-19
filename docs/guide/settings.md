# Settings and themes

**Settings** in a server row's menu (the ⋯ at the row's end) opens that server's settings in a popup, for the owner. The theme, the size, the editor and Confirm on close are behind the gear at the right end of the title bar, for everyone.

![The settings popup: name, scope and port, the states, the participants.](../images/settings.png)

## Name, scope and port

The server's name, shown to its clients; its Scope, which says whether it listens and for whom: **Local** on this machine only, **Public** on every interface, **None** not at all (the desktop then is a client of other servers only); and its port. Scope and Port take effect at the next start, and the popup says so.

A line beneath them says what the Scope comes to. Local is this machine only, and a request is the owner. Public without Clerk keys is a **trusted network**: every request is the owner, so anyone who can reach the server acts as the owner. Public with Clerk keys will sign people in through Clerk once that plan is built; until then it is a trusted network too.

## States

The states a plan's state is picked from, one per line: Draft, Plan, Working and Finished by default. A new plan starts in the first. A state still used by a plan cannot be removed. The first state was called Proposal before; a server whose list still names Proposal and not Draft renames it once at its next start, in the settings and in every plan in that state.

## Clerk

The sign-in of a Public server (plan Clerk, not active yet): the publishable key, the secret key and the webhook secret of your Clerk instance, and the email of the server's one Administrator. Leave all four empty for a trusted network; an empty section is not written. A key given is checked for its prefix (`pk_`, `sk_`, `whsec_`) and the email for its shape.

## Participants

Each participant has a name, a display name, a role and, for one that calls the API from outside, a token.

- **owner** resolves threads and edits the settings. A request with no token is the owner: the browser.
- **llm** is a full participant that is asked to apply resolved threads.
- **member** takes part in discussion.

**New** makes a token, **Copy** copies it. There must be exactly one owner, and no name twice.

Saving writes these fields and applies them at once, Scope and Port excepted. The server's own checks apply, and nothing is saved while there are problems; the popup lists them.

## The settings file

The settings are `consensus.json` in the config folder, written at first start:

```
{
	"Name": "cube4",
	"Port": 3500,
	"Scope": "Local",
	"States": [ "Draft", "Plan", "Working", "Finished" ],
	"Participants": [
		{ "Name": "user", "Display": "User", "Role": "owner" },
		{ "Name": "llm", "Display": "LLM", "Role": "llm" }
	]
}
```

An optional `Clerk` section holds the four fields above. The server's LLM connections are in the same file (`Llms`, kept through the page's LLM list; see [Working with an LLM](llm.html)), and so are the desktop's own fields (`Servers`, `Theme`, `Scale`, `Remembered`); the popup touches neither. The file is read once at start, so an edit by hand needs a restart; the popup does not. A file from before, with a `Host`, is brought up to date at the next start: a local address becomes Scope Local, any other Public, and a missing Name becomes the machine's.

## Theme and size

The gear at the right end of the title bar opens the look: the theme (light, dark, the system's, or a palette from Sepia and Paper to Nord and Midnight), three sizes, the editor, CodeMirror or Monaco, and Confirm on close (see [Editing](editing.html)). They are kept in the browser, not in the settings; the desktop keeps one theme for its window, whatever the servers it shows, and its window buttons follow the palette.

![The title bar, with the look popover open.](../images/title-bar.png)

## The config folder and the project folders

The config folder, `.consensus` in your user folder by default or the one `--config` names, holds the settings, `consensus.json`, whose `Projects` list the project folders in display order (a folder opened from the command line goes to the top). Each project is a folder of its own, a repository as a rule, with a `.consensus` sub-folder that is the project; a project made with no folder named goes under `projects/` in the config folder. Everything is plain files:

```
<project>/.consensus/project.json          the project: its name and tree, its Archive, its States, Include, Exclude and Commands
<project>/.consensus/content/<id>/content.md    a plan's or document's text
<project>/.consensus/content/<id>/content.json  its record
<project>/.consensus/content/<id>/threads.json  its threads
<project>/.consensus/content/<id>/revisions/    every revision's text and record
<project>/.consensus/archive/<id>/         an archived plan, moved whole
<project>/.consensus/trash/<id>/           a deleted item, moved whole
```

The `.consensus` folder is meant to go into source control with the repository, so the plans and threads travel with the source; nothing secret is written to it, the tokens staying in the config folder's settings. Back a project up by copying its folder. A config folder from before project folders (every project in one data folder) is migrated at the next start, each project into a folder of its own under `projects/`; the console says what moved. A listed folder that is missing, or on a drive not mounted, is skipped with a line and kept in the list; the desktop's connect screen names it.
