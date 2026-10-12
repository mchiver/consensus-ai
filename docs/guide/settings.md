# Settings and themes

**Settings** at the bottom of the sidebar opens the server's settings in a popup, for the owner. Theme and size are beside it, for everyone.

![The settings popup: name, scope and port, the states, the participants.](../images/settings.png)

## Name, scope and port

The server's name, shown to its clients; its Scope, which says whether it listens and for whom: **Local** on this machine only, **Public** on every interface, **None** not at all (the desktop then is a client of other servers only); and its port. Scope and Port take effect at the next start, and the popup says so.

## States

The states a plan's state is picked from, one per line: Draft, Plan, Working and Finished by default. A new plan starts in the first. A state still used by a plan cannot be removed. The first state was called Proposal before; a server whose list still names Proposal and not Draft renames it once at its next start, in the settings and in every plan in that state.

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

The desktop keeps its own fields in the same file (`Servers`, `Last`, `Theme`, `Scale`, `Llms`, `Workspaces`, `Remembered`), which the popup never touches. The file is read once at start, so an edit by hand needs a restart; the popup does not. A file from before, with a `Host`, is brought up to date at the next start: a local address becomes Scope Local, any other Public, and a missing Name becomes the machine's.

## Theme and size

Light, dark or the system's theme, and three sizes, are at the bottom of the sidebar. They are kept in the browser, per user and per server, not in the settings. The desktop offers a wider choice of palettes, from Sepia and Paper to Nord and Midnight, and its title bar follows.

## The config folder

Everything is plain files in the config folder, `.consensus` in your user folder by default, or the one `--config` names:

```
consensus.json                   the settings
projects.json                    every project's name, in display order
projects/<id>/project.json       a project's tree
proposals/<id>/proposal.md       a plan's or document's text
proposals/<id>/threads.json      its threads
proposals/<id>/revisions/        every revision's text and record
trash/<id>/                      a deleted item, moved whole
```

Back it up by copying the folder.
