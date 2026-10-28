# Consensus Client

**Consensus Client** is for working in projects that live on one or more Consensus Servers. You sign in once, add the Servers you work with, and each one shows the projects it gives you by your roles. There is no local folder and no server of its own, the Client mints no tokens and has no API or MCP for an agent, and it configures nothing: every Server's projects, roles, LLM connections and tasks are set by that Server's Administrator and Managers. It installs beside Consensus Sidecar, Consensus Desktop and Consensus Server and changes none of them.

## Installing and starting it

On Windows, run `Consensus-Client-Setup-<version>.exe` from the [latest release](https://github.com/mchiver/consensus-ai/releases/latest); it puts **Consensus Client** in the Start menu.

From the command line, or from the checkout:

```
"Consensus Client.exe" [--config <folder>]
npm run client -- [--config <folder>]
```

**New window** (Ctrl+N, or the window's menu) opens another window on the same Servers.

## Signing in

The Client shows nothing but the sign-in box until you sign in with your Consensus-AI account. Any account will do, with a license or without one: the Client checks no tier. The same sign-in goes with every call to every Server, and each Server decides, project by project, what you may see and do.

The sign-in is kept in the Client's own window, so a restart finds you still signed in. **Sign out** is in the window's menu. The Client keeps no current user of the machine, so signing in or out here changes nothing in Desktop or the Server.

## Your Servers

**Servers…**, in the window's menu or in a Server's own menu in the tree, lists the Servers you added:

- **Add server** takes the Server's address (`https://consensus.example.com`, or `http://127.0.0.1:3500` for the Server on this machine). The Client tries it with your sign-in and saves it under the Server's own name; a name you already use gets a number. An address that does not answer, or is already in the list, is refused with the reason.
- **The name** can be changed in place. It is the Server's name in this Client only.
- **Remove** takes the Server out of the list and changes nothing on the Server.
- Each Server shows **online**, or **offline** with the reason. An offline Server stays in the list and comes back by itself when it answers again.

With no Servers yet, the popup opens on its own after you sign in. Every Server is a root of the project tree, with its projects beneath it, and the waiting list and the tabs cover all of them.

## Working in the projects

Plans, documents, folders, threads, revisions, reports, Export and the look all work as they do in Desktop, as far as your role in each project allows. A project's menu has New Folder, New Draft, Copy, Paste, Export and Explain.

A Server's LLM tasks are read from the Server: the buttons on a plan's heading are the tasks the project enables, and the Explain tab is there when the project has it. They run on the Server, as you.

- **At the press**, the button follows the run: **Answer · Running 0:42**, or **Queued behind** the run it waits for. While it runs, a click opens the run instead of pressing again.
- **The run's popup** shows its state and time and its output as it comes in, with **Stop**.
- **When it ends**, a notice in the corner names it and opens it, and the button has **Done**, **Failed** or **Stopped** beside it.
- **My runs**, under the waiting list, holds your own runs on every Server, newest first.

## Settings

The Client keeps its settings in `client.json` in the config folder (`<your home>/.consensus`, unless `--config` names another), beside Desktop's `desktop.json` and the Server's `consensus.json`: your Servers, the theme and the size, and the view as you left it. Nothing is carried over from Desktop's saved Servers.

## What the Client leaves out

The Client is for working in projects, not for running them. It has no Server Settings, no project settings, no New Project, no Mount, no Users, accounts or role folders, no LLM connections or task settings, no LLM page and no LLM Instructions. That holds for a Server's Administrator and Managers too: they configure the Server in [the Server's own window](server.html) or in its page in a browser.
