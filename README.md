# Storyboard

⚠️ This is a personal software. No contribution accepted. Fork it and make changes for yourself if you want to

A local, prompt-driven motion-design editor. A video is a list of scenes; every scene is a small React component that renders one frame for a given time `t`. You describe changes in a chat next to a live preview — Claude edits the scene, renders frames to check its own work, and the preview updates instantly. Finished videos export to MP4.

Inspired by [Caleb Porzio's tweet](https://x.com/calebporzio/status/2104945478055989489) about the little editor he vibe-coded for his video: prompt Opus for each scene down to the millisecond, drag in audio, detect the downbeats and phrases of the track and snap animations to them.

![The Storyboard editor with the bundled example project: a live preview, the scene chat, and the filmstrip with a 0% seam at every cut](docs/screenshot.png)

- **Per-scene chat** with Claude, down to the millisecond ("hold the headline a full second longer, then slide the card in from the right").
- **Project chat** for the video as a whole: add, reorder and restyle scenes, keep them consistent, follow the **art direction** doc.
- **Music**: drop in a track; beats, downbeats (bars), phrases and sections are detected. Snap cuts to bars, and key animations to `music.beat(n)` / `music.bar(n)` so they stay locked to the music.
- **Music by Claude** (optional): with the local music engine running, Claude composes original soundtracks itself, measures each take against the edit, picks the best fit and snaps the cuts to it. Ask for changes in the Project chat.
- **Seam checker**: pixel-compares the last frame of each scene with the first frame of the next, so cuts can be made invisible.
- **Undo** Claude's last change, **Present** full-screen, **Render** H.264 MP4 (up to 4K, 24/30/60 fps).
- **MCP server**: the same tools work from a normal `claude` session in your terminal.

## Requirements

- macOS or Linux. Developed on macOS (Apple Silicon); Linux should work; Windows is untested.
- [Node.js](https://nodejs.org) 22.12 or newer (`nvm install` picks the version in `.nvmrc`)
- [ffmpeg](https://ffmpeg.org) with x264: `brew install ffmpeg` (macOS) or `sudo apt install ffmpeg` (Debian/Ubuntu)
- [Claude Code](https://code.claude.com), installed and logged in (`claude`, then `/login`). Storyboard drives your local Claude Code in headless mode, so it uses your existing Claude Code login; there are no API keys to configure.

## Getting started

```bash
git clone https://github.com/saeedvaziry/caleb-video-editor.git
cd caleb-video-editor
npm ci --ignore-scripts   # exact versions from package-lock.json; package install scripts never run
npm run setup             # one-time: downloads the headless Chromium used for frame capture and rendering
npm run doctor            # checks Node, ffmpeg, Chromium, the Claude Code login and the port
npm run dev               # → http://127.0.0.1:5199
```

On Linux, run `npm run setup -- --with-deps` instead, which also installs the system libraries Chromium needs (asks for sudo).

Open the **Example: Storyboard teaser** project, pick a scene in the filmstrip and type a change into the chat.

> [!IMPORTANT]
> **Install with `npm ci --ignore-scripts`, never with `npm install`.** Any package in a dependency tree can ship an install script that runs on your machine the moment it's installed, a common way compromised npm packages attack developer machines. `--ignore-scripts` stops those scripts; Storyboard doesn't need any of them. `npm ci` installs exactly the versions in `package-lock.json`, checked against their integrity hashes, while `npm install` may pull in newer versions nobody has reviewed. As a second line of defense, the repo's `.npmrc` sets `ignore-scripts=true`, so even a plain `npm install` in this folder won't run install scripts.

**Or let your coding agent set it up.** Open the cloned folder in Claude Code (or any agent that reads [`AGENTS.md`](AGENTS.md)) and ask it to set up and start Storyboard. It follows the steps in `AGENTS.md` and uses `npm run doctor` to know when everything is in place. Logging in to Claude Code is the one step you do yourself.

Your projects are folders in `projects/`. Git ignores everything there except the bundled example, so your own work never ends up in a commit. Set `STORYBOARD_PROJECTS` to keep them somewhere else.

## Using it

| Where | What |
| --- | --- |
| Filmstrip | Click a scene to open it; drag to reorder; **+ Add scene**. Badges between scenes show how many pixels change at each cut (0% = invisible). |
| Stage | **This scene** (loops) or **Whole video**. Space = play/pause, ←/→ = one frame (Shift: 1 s), ↑/↓ = previous/next scene. Beat ticks and phrase marks appear on the scrubber when there is music. |
| Scene tab | Chat about the selected scene; Claude may only edit that scene's file and duration. Double-click the name to rename; click the duration to type a new one. **Undo** reverts Claude's last change. |
| Project tab | Soundtrack (drop an audio file anywhere, set where the video starts in the track, snap cuts to beats/bars/phrases), **Check seams**, and the project chat. |
| Art direction | Palette, type scale, motion rules — Claude reads it before every edit. |
| Copy path | Copies the scene file path (or project folder) for your editor or terminal. |
| Render | Export an MP4 to `projects/<id>/renders/`. |

The selectors next to **Send** choose the model (Opus 5.5 by default; Sonnet 5.5 is quicker for small tweaks) and the effort — how much Claude thinks (low → max). Your playhead position is sent with each message, so "make this part slower" refers to what you're looking at.

## Music engine (optional)

Claude composes soundtracks with [ACE-Step 1.5](https://github.com/ace-step/ACE-Step-1.5), an open music model that runs on your own machine (MIT-licensed; its authors state the generated music can be used commercially). It lives outside this repo and needs [uv](https://docs.astral.sh/uv/).

**One-time install** (pinned commit, locked dependencies, no package build scripts):

```bash
git clone https://github.com/ace-step/ACE-Step-1.5.git ~/Tools/ace-step
cd ~/Tools/ace-step && git checkout ca1e85f
uv sync --locked --no-build
uv run --no-sync acestep-download     # ~10 GB of models
```

With enough memory (about 48 GB+) the engine also fetches its larger 4B planning model on its first start (~8 GB, once). To install it somewhere else, set `ACESTEP_DIR`.

**Start and stop it** from this folder:

```bash
npm run music start      # runs in the background; ready in ~25 s
npm run music status     # state, models, memory (~9–16 GB while running)
npm run music logs -f
npm run music stop       # stops only the engine this CLI started
npm run music restart
```

Storyboard checks the engine every few seconds. While it's ready, the Project chat gets the music tools (`generate_music`, `wait_for_music`, `list_music_takes`, `describe_music_take`, `use_music_take`, `repaint_music`); while it's stopped, Claude doesn't see them and will ask you to start it if you want music. Claude can't hear audio, so every take comes back measured (tempo, bar grid, sections, strongest hits, loudness, how its bars line up with the cuts) plus a spectrogram image. All takes are kept in `projects/<id>/music/`, and switching the soundtrack is undoable.

**On another machine** (e.g. a Linux box): run ACE-Step there with `ACESTEP_API_KEY=<key> uv run acestep-api --host 0.0.0.0 --port 8001`, then start Storyboard with `STORYBOARD_MUSIC_URL=http://<host>:8001 STORYBOARD_MUSIC_API_KEY=<key>`. The CLI then only reports its status.

## Using the tools from your terminal

While the app is running:

```bash
claude mcp add --transport http storyboard http://127.0.0.1:5199/mcp
cd projects/<project-id>
claude
```

`projects/CLAUDE.md` (written by the app) teaches Claude the scene contract and the runtime API, and the `storyboard` MCP tools (`render_frames`, `check_seams`, `get_music_context`, `set_scene_duration`, `create_scene`, …) let it see and verify its work. The editor reloads live as files change.

## How it works

```
Editor (React, Vite)  ── SSE ──┐
Scene frames (iframes) ─ HMR ──┤
                               │
Node server ── Vite (dev) ─────┤  /api  REST           server/api.ts
            ├─ ProjectStore     │  /mcp  MCP tools      server/mcp.ts
            ├─ Capturer (headless Chromium: frames, seams)      server/capture.ts
            ├─ Renderer (parallel pages → ffmpeg H.264)         server/render.ts
            ├─ Music analysis (beats, bars, phrases, sections)  server/music/
            └─ ChatManager → AgentProvider (Claude Code headless) server/chat.ts, server/agents/
```

- **Scenes** (`projects/<id>/scenes/*.tsx`) import helpers from `storyboard` (`src/runtime/`): `progress`, `interpolate`, `keyframes`, `spring`, easings, colors, seeded `random`/`noise`, `SplitText`, and the `music` beat grid. Every frame is a pure function of `t`, so scrubbing, rendering and seam checks are exact.
- **`frame.html`** (`src/frame/main.tsx`) loads a project's scenes and renders any time on demand. The editor preview, the thumbnails, the agent's `render_frames` and the MP4 renderer all use this same page, so what you see is what renders.
- **The agent** is your local Claude Code, run per turn as `claude -p --output-format stream-json --restricted --permission-mode dontAsk --allowedTools …` with the Storyboard MCP server attached. A scene chat can only edit that scene's file (enforced by Claude Code permission rules and by the MCP server). Each chat keeps its own Claude Code session; **Clear chat** starts a fresh one.
- **Undo**: before each turn the project's code is snapshotted to `.storyboard/undo/`; Undo restores the files that turn changed.

## Configuration

Set these as environment variables when starting, e.g. `STORYBOARD_EFFORT=high npm run dev`.

| Variable | Default | |
| --- | --- | --- |
| `PORT` | `5199` | |
| `STORYBOARD_PROJECTS` | `./projects` | Where projects live |
| `STORYBOARD_MODEL` | `claude-opus-5-5` | Model the in-app agent uses |
| `STORYBOARD_EFFORT` | `medium` | Default effort (the UI remembers your choice) |
| `CLAUDE_PATH` / `FFMPEG_PATH` | `claude` / `ffmpeg` | Binaries |
| `STORYBOARD_USE_API_KEY` | unset | By default `ANTHROPIC_API_KEY` is removed from the agent's environment so Claude Code uses your login; set this to keep it |
| `STORYBOARD_AGENT_LOG` | unset | Path of a file to append the agent's raw stream-json to (debugging) |
| `STORYBOARD_MUSIC_URL` | `http://127.0.0.1:8001` | Where the music engine answers |
| `STORYBOARD_MUSIC_API_KEY` | random key in `~/.config/storyboard/music-api-key` | Shared by the CLI and the app |
| `ACESTEP_DIR` / `UV_PATH` | `~/Tools/ace-step` / `uv` | The local engine install used by `npm run music` |

## Project folder layout

```
projects/<id>/
  project.json          name, canvas, fps, scene order + durations, soundtrack reference
  scenes/<scene>.tsx    one component per scene
  components/           optional shared components
  assets/               images and SVGs (asset('file.png'))
  art-direction.md      the look every scene follows
  music/                soundtrack takes (takes.json) with cached beat analysis
  renders/              exported MP4s
  .storyboard/          chats, undo snapshots, frames the agent looked at (internal)
```

## Troubleshooting

- **Something doesn't work** → run `npm run doctor`; it names what's missing and how to fix it.
- **"Could not start headless Chromium"** → run `npm run setup`. On Linux, run `npm run setup -- --with-deps` once so Chromium's system libraries are installed too (asks for sudo).
- **The chat says "Not logged in"** → run `claude` in a terminal, use `/login`, and send the message again.
- **A scene shows a red error panel** → the message is also given to Claude on its next `render_frames`; ask it to fix the error, or undo.
- **"Forbidden" from the API** → open the editor at the address `npm run dev` prints. Requests from other websites and other local ports are refused on purpose.
- **Music analysis** assumes 4/4 time; `npm run analyze -- <file>` prints what it detects.

## Developing Storyboard

Coding agents: [`AGENTS.md`](AGENTS.md) has the setup steps, a map of the code and the conventions. People: the same file is a good tour.

Edits to `src/` apply live (Vite); restart `npm run dev` after editing `server/`. Before sending a change:

```bash
npm run typecheck
npm test
npm run format
```

Adding or upgrading a dependency is the only time to use `npm install`, and then always as `npm install --ignore-scripts <package>@<version>`. Check the `package-lock.json` diff before committing it; everyone else installs exactly what it pins with `npm ci --ignore-scripts`.

**Adding another agent provider**: providers implement `AgentProvider` (`server/agents/types.ts`): take an `AgentTurn` (working directory, prompt, system prompt, session, model/effort, allowed tools, MCP servers, abort signal) and yield `AgentEvent`s (text deltas, tool starts/ends, done). `server/agents/claudeCode.ts` is the reference implementation; register a new one in `server/index.ts`. Because the tools are an MCP server, any MCP-capable agent can use them.

## Security

Storyboard is a single-user local tool. It listens on `127.0.0.1` only; `/api` and `/mcp` refuse requests with a non-local `Host` (DNS rebinding) and browser requests from other websites or other local ports (CSRF), since those could start agent turns. Don't expose it to a network. The in-app agent runs your Claude Code with a fixed tool list, can only write inside the project it's working on, and a scene chat only that scene's file.

## License

[MIT](LICENSE) © 2026 Saeed Vaziry. The optional music engine, ACE-Step 1.5, is a separate project with its own MIT license.
