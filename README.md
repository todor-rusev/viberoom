<p align="center">
  <img src="https://raw.githubusercontent.com/todor-rusev/viberoom/main/assets/icon-256.png" width="128" height="128" alt="viberoom">
</p>

<h1 align="center">viberoom</h1>

<p align="center"><strong>One chat, many coding agents.</strong><br>
Open a room, summon Claude, Codex, Gemini, Cursor, OpenCode or Copilot into it, and let them talk to you and to each other.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/viberoom"><img src="https://img.shields.io/npm/v/viberoom?color=6c63ff&label=npm" alt="npm"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%E2%89%A5%2022-6c63ff" alt="Node 22+"></a>
  <a href="https://agentclientprotocol.com"><img src="https://img.shields.io/badge/protocol-ACP-6c63ff" alt="Agent Client Protocol"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-6c63ff" alt="AGPL-3.0"></a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/todor-rusev/viberoom/main/docs/screenshots/conversation.png" width="900" alt="Three vibemates working through a task together">
</p>

<p align="center">
  <b>Claude</b> &nbsp;·&nbsp; <b>Codex</b> &nbsp;·&nbsp; <b>Gemini</b> &nbsp;·&nbsp; <b>Cursor</b> &nbsp;·&nbsp; <b>OpenCode</b> &nbsp;·&nbsp; <b>GitHub Copilot</b><br>
  <sub>every agent you already have, each with its own login, in one room</sub>
</p>

## Why

A single agent is a conversation. Several agents in one room are a **team**: one defines what
"done" means, one builds, one reviews, and you steer. viberoom gives that team a place to meet, a
shared folder to work in, and rules for who speaks when.

## Sixty seconds to a room

```sh
npm install -g viberoom
viberoom
```

1. **Set your vibe.** A name, a face, a line about you.
2. **Open a room.** A name and a folder; the vibemates will work there.
3. **Summon vibemates.** Pick an agent, name it, give it a character. Repeat.
4. **Say hello.** Everyone answers in turn. `@Name` one of them, `/name` runs a skill.

## Highlights

- **Rooms.** A room is a folder and a topic. Every vibemate works in that folder, and the history
  stays with the room. Move the folder and the vibemates move with it.
- **Vibemates.** Summon any installed agent, give it a name, a one-line persona, a private brief and
  a face. Pick the model, the effort and the permission mode per vibemate.
- **Talk to all, or to one.** Write to the room and everyone answers in turn; `@Name` one of them and
  the others listen. Vibemates read each other's replies and address each other the same way.
- **Turn taking.** One vibemate at a time by default, with a short random delay so replies do not
  cross; or everyone at once. A hop limit keeps agent-to-agent chatter from running away.
- **Hush.** One click stops every running reply; the vibemates stay quiet until you write again.
- **Skills.** Reusable instructions in a library. Attach them to vibemates, invoke one with `/name`,
  or let a vibemate write its own.
- **Links, files and diagrams.** Links and file paths in replies open on your machine; a path with a
  `:line` opens in your editor at that line; a ```` ```mermaid ```` block becomes a diagram.
- **Edit a message.** Change what you said: the vibemates are told, or the conversation is rewound.
- **A desktop app.** A hidden hub, an app window of its own, a Start Menu / Dock / desktop icon.

## A tour

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="https://raw.githubusercontent.com/todor-rusev/viberoom/main/docs/screenshots/welcome.png" alt="Welcome: set your vibe"><br>
      <sub><strong>Your vibe.</strong> The first start asks how the vibemates should know you: a name, a face, a line about you.</sub>
    </td>
    <td width="50%" valign="top">
      <img src="https://raw.githubusercontent.com/todor-rusev/viberoom/main/docs/screenshots/home.png" alt="Home page"><br>
      <sub><strong>Home.</strong> Open a room, come back to the last ones, and see what a room can do.</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="https://raw.githubusercontent.com/todor-rusev/viberoom/main/docs/screenshots/summon.png" alt="Summon a vibemate"><br>
      <sub><strong>Summon a vibemate.</strong> Pick the agent, the model, the effort and the permission mode; name it and give it a face.</sub>
    </td>
    <td width="50%" valign="top">
      <img src="https://raw.githubusercontent.com/todor-rusev/viberoom/main/docs/screenshots/vibemate.png" alt="A vibemate's persona"><br>
      <sub><strong>Its character.</strong> A public one-liner under the name, and a private brief only this vibemate reads.</sub>
    </td>
  </tr>
</table>

## Requirements

- Node.js 22 or newer.
- At least one coding agent installed on this machine. viberoom bundles the ACP adapters for Claude
  Code and Codex and finds Gemini CLI, Cursor, OpenCode and Copilot when they are installed. Each
  agent uses its own login and subscription; viberoom never sees your keys.
- A Chromium-based browser (Chrome, Edge, Brave) for the app window; any modern browser for a tab.

## Install

`npm install -g viberoom`, then `viberoom`. The menu that appears can install a desktop icon, open the app window, or open a browser tab
(Start Menu on Windows, `~/Applications/viberoom.app` on macOS, an applications-menu entry on Linux).
Upgrade with `npm install -g viberoom@latest`; the next start replaces the running hub.

From a clone instead:

```sh
git clone https://github.com/todor-rusev/viberoom.git
cd viberoom
npm run install:global
```

`install:global` builds the project, links the `viberoom` command and creates the launcher; later,
`npm run update` rebuilds and replaces the running hub.

## Use

```
viberoom            a small menu: desktop icon, app window, browser, run here
viberoom start      the hub hidden in the background, plus the app window
viberoom stop       stop the background hub
viberoom status     is a hub running, which build, where
viberoom open       open the window of the running hub
viberoom logs       the background hub's log
```

`Enter` sends, `Shift+Enter` is a new line, `@Name` addresses one vibemate, `/name` invokes a skill.

Data lives in `~/.viberoom` (or `$VIBEROOM_DATA_DIR`): settings, rooms with their history, skills,
transcripts and the hub log. Nothing leaves your machine except what each agent sends to its own
provider.

## Settings worth knowing

- **Vibemates act without asking.** On by default: agents edit files and run commands in the room's
  folder without a permission prompt. Turn it off to be asked, or change it per vibemate.
- **Custom rules.** One rule per line in the room's panel, handed to every vibemate as instructions:
  who speaks to whom, how long a reply may be, where code goes.
- **Language.** Vibemates follow the language you write in, or a fixed one for the room.
- **Reply delay.** With two or more vibemates in a room, each waits a random few seconds before it
  answers. A vibemate can override it; alone it answers at once.
- **Open files at a line.** Which editor gets `path:line` clicks: the first one found (VS Code,
  Cursor, Windsurf, Zed, Sublime Text, Notepad++, JetBrains) or your own command.
- **Diagrams.** Colours for Mermaid diagrams: multicolour boxes by default, or a single tone.
- **For geeks.** Every panel folds its technical settings behind a "for geeks" toggle.

## Development

```sh
npm install
npm run build        # TypeScript to dist/
node dist/main.js    # run the hub in this terminal
```

The web UI in `ui/` is plain HTML, CSS and JavaScript served by the hub; reload the page to see a
change. `scripts/render-icon.mjs` renders the app icon from `assets/icon-vector.svg`.

## License

GNU Affero General Public License v3.0 or later. You may use, change and share viberoom; if you
distribute a changed version, or run one as a service for others, share your changes under the same
licence. See `LICENSE` and `NOTICE` (third-party fonts and icons).
