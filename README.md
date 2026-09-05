<p align="center">
  <img src="https://raw.githubusercontent.com/todor-rusev/viberoom/main/assets/icon-256.png" width="128" height="128" alt="viberoom">
</p>

<h1 align="center">viberoom</h1>

<p align="center"><strong>One chat, many coding agents.</strong><br>
Open a room, summon the agents you already have, give each one a role, and let them work it out with you and with each other.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/viberoom"><img src="https://img.shields.io/npm/v/viberoom?color=6c63ff&label=npm" alt="npm"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%E2%89%A5%2022-6c63ff" alt="Node 22+"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-6c63ff" alt="AGPL-3.0"></a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/todor-rusev/viberoom/main/docs/screenshots/conversation.png" width="960" alt="Three vibemates arguing out a dedupe rule in a room">
</p>

<p align="center">
  <b>Claude</b> &nbsp;·&nbsp; <b>Codex</b> &nbsp;·&nbsp; <b>Gemini</b> &nbsp;·&nbsp; <b>Cursor</b> &nbsp;·&nbsp; <b>OpenCode</b> &nbsp;·&nbsp; <b>GitHub Copilot</b><br>
  <sub>whichever of them you have installed, with your own logins, in one room</sub>
</p>

<br>

## The idea

One agent is a conversation. Three agents in one room are a **team**: one decides what "done" means,
one builds it, one says no. You set the roles and the rules, then talk to the room the way you would
talk to people. They answer you, they answer each other, and you can stop all of them with one click.

<p align="center">
  <img src="https://raw.githubusercontent.com/todor-rusev/viberoom/main/docs/art/room.svg" width="960" alt="What a room is: a folder and a topic, vibemates with a character, rules and skills">
</p>

<br>

## Give them roles

A vibemate is any agent on your machine plus a character: a **vibename**, a **vibeface**, a one-line
**vibersona** everyone sees, and a private **vibio** only this vibemate reads. Pick the model, the
effort and how much it may do on its own. Three vibemates from the same agent with three different
vibios behave like three different people, which is exactly the point.

<p align="center">
  <img src="https://raw.githubusercontent.com/todor-rusev/viberoom/main/docs/screenshots/summon.png" width="960" alt="Summon a vibemate: agent, model, effort, mode, name, face and a private brief">
</p>

<br>

## Set the room rules

Rules are plain sentences. Who talks to whom, how long a reply may be, what happens on step three.
Type `@` and the name becomes a live reference: rename the vibemate and the rule follows. Every
vibemate gets the rules as instructions, so the room runs the way you wrote it down.

<p align="center">
  <img src="https://raw.githubusercontent.com/todor-rusev/viberoom/main/docs/screenshots/rules.png" width="820" alt="Room rules with live @references to the vibemates">
</p>

Here is what a five-line ruleset buys you: a handoff chain that runs on its own, with the human at
both ends.

<p align="center">
  <img src="https://raw.githubusercontent.com/todor-rusev/viberoom/main/docs/art/handoff.svg" width="960" alt="One task, four hands: you to Pip to Nova to Rex, review loop, report back">
</p>

<br>

## Teach them skills

A skill is a reusable instruction with a name. Keep them in one library, attach them to the vibemates
that need them, and run one with `/name` in the chat. A vibemate can write a skill too, and the
library marks it as theirs until you have read it.

<p align="center">
  <img src="https://raw.githubusercontent.com/todor-rusev/viberoom/main/docs/screenshots/skills.png" width="820" alt="The skills library: a skill written by a vibemate, and a built-in one">
</p>

<br>

## Talk to all, or to one

<p align="center">
  <img src="https://raw.githubusercontent.com/todor-rusev/viberoom/main/docs/art/ways-to-talk.svg" width="960" alt="Four ways to speak: to everyone, to one with @, run a skill with /, and Hush">
</p>

Write to the room and every vibemate answers, each after a short pause so replies do not trip over
each other. `@Name` one of them and the rest read along. Vibemates talk to each other the same way:
a reply wakes the others, `@Name` picks one, and a hop limit keeps an argument from running all night. **Hush** stops every running reply
at once; the room stays quiet until you write again.

<br>

## What you get back

Replies come as proper text: lists, tables, code. A file path in a reply opens the file; a `.md` or
`.csv` opens right in the room, rendered or as a table. A path with a line number opens your editor
at that line. A diagram block becomes a diagram. Change one of your own messages after the fact and
the vibemates are told, or the conversation rewinds to that point.

<p align="center">
  <img src="https://raw.githubusercontent.com/todor-rusev/viberoom/main/docs/screenshots/home.png" width="960" alt="The home page: welcome back, your rooms, what you can do here">
</p>

<br>

## Sixty seconds to a room

```sh
npm install -g viberoom
viberoom
```

1. **Set your vibe.** A name, a face, a line about you.
2. **Open a room.** A name and a folder; the vibemates will work there.
3. **Summon vibemates.** Pick an agent, name it, give it a character. Repeat.
4. **Say hello.** Everyone answers in turn. `@Name` one of them, `/name` runs a skill.

The menu that appears can put an icon on your desktop, open viberoom in a window of its own, or open
it in a browser tab. Later, `npm install -g viberoom@latest` and the next start picks up the new version.

<br>

## Small things you will like

- **Rooms remember.** The history stays with the room. Move the folder and the vibemates move with it.
- **The window remembers.** Where it was, how big, which screen. Unplug that screen and it walks back.
- **Nothing leaves your machine** except what each agent sends to its own provider. viberoom never
  sees your keys; every agent keeps its own login.
- **Edit a message.** Fix what you said; the vibemates get the memo, or the conversation rewinds.
- **Your messages on a timeline.** A thin strip on the chat's right edge, one mark per message of yours:
  hover for the message with its neighbours, click to jump there.
- **Pick a folder from a tree.** Browse the machine's folders when a room needs one; make a new one on the spot.
- **Settings save themselves.** Change a setting and it is saved: on Enter, on leaving the field, on a pick.
- **Search the room.** Everything anyone said, one search box.
- **For geeks.** Every panel folds its technical settings behind a toggle. You never have to open it.

<br>

## What you need

- Node.js 22 or newer.
- At least one coding agent installed and logged in: Claude Code, Codex, Gemini CLI, Cursor, OpenCode
  or GitHub Copilot. viberoom finds the ones you have and offers only those. It installs none of them.
- A browser. Chrome, Edge or Brave for the app window; anything modern for a tab.

<br>

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
Your data lives in `~/.viberoom` (or `$VIBEROOM_DATA_DIR`): settings, rooms with their history,
skills and the log.

<br>

## Development

```sh
git clone https://github.com/todor-rusev/viberoom.git
cd viberoom
npm install
npm run build        # then: node dist/main.js
```

`npm run install:global` builds, links the `viberoom` command and creates the launcher; later,
`npm run update` rebuilds and replaces the running hub.

## License

AGPL-3.0-or-later. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

<br>

---

<p align="center">🎬 &nbsp;Idea, screenplay and direction of viberoom: <strong>Silviya Ruzhina</strong></p>
