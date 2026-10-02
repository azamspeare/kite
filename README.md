# Kite

A local, prompt-driven motion-design editor. Every scene is a small piece of code; you change it by chatting with Claude Code or Codex next to a live preview, down to the millisecond. Finished videos export to MP4.

![The Kite editor: a live preview, the scene chat, and the filmstrip](docs/screenshot.png)

- **Chat per scene, or about the whole video**, next to a live preview.
- **Music that drives the edit**: beats, bars and phrases are detected, and cuts snap to them.
- **Sound effects** placed on the same timing as the animation.
- **Optional**: Your agent composes the soundtrack and generates realistic sound effects, on your own machine.

## Get started

You need macOS or Linux and [Node.js](https://nodejs.org) 22.12 or newer.

```bash
git clone https://github.com/azamspeare/kite.git
cd kite
./kite setup
./kite start
```

Setup walks you through the rest (ffmpeg, your Claude Code or Codex login, and whether you want music and sound-effect generation) and installs everything inside this folder. Run it again any time to change your choices. It installs packages with `npm ci --ignore-scripts`, so no package's install script ever runs: don't use `npm install` here.

### Using Codex

Install a current [Codex CLI](https://developers.openai.com/codex/cli) (0.159.0 or newer recommended) and run `codex login`. Choose **Codex** in setup or in the chat's agent selector; Claude Code is not required. The model selector reads the models and reasoning levels in Codex's local catalog, with **Codex default** available even before the catalog is populated.

For non-interactive setup: `./kite setup --yes --provider=codex`. To override the default at startup: `KITE_PROVIDER=codex ./kite start`. Both agents remain available in the editor when installed.

### Custom address and port

`./kite setup --yes --host=0.0.0.0 --port=5299` saves the bind address and port (`--ip` also works). Then run `./kite start`, or `./kite restart app` if it is already running. Open `http://<server-LAN-IP>:5299` from another device. The default remains localhost only.

**Network access has no login:** anyone who can reach the port can edit projects and use your agents. Use a trusted network/firewall, never the public internet. See [configuration](docs/configuration.md#bind-address-and-port).

## Commands

| | |
| --- | --- |
| `./kite setup` | Install, or change what's installed |
| `./kite start` | Start Kite in the background |
| `./kite stop` | Stop it |
| `./kite status` | See what's running |
| `./kite logs` | Show the log |
| `./kite doctor` | Check that everything is in place |

## More

- [Using Kite](docs/using-kite.md): the editor, sound effects, and the tools from your terminal
- [Music and sound effects](docs/music-and-sound.md): the optional engines
- [Configuration](docs/configuration.md) · [Troubleshooting](docs/troubleshooting.md)
- [How it works](docs/how-it-works.md) · [Developing Kite](docs/development.md)

## License

[MIT](LICENSE) © 2026 Azam. Kite is built from [Storyboard](https://github.com/saeedvaziry/caleb-video-editor) by Saeed Vaziry, also MIT. The optional music engine, ACE-Step 1.5, has its own MIT license; the optional sound model, Stable Audio Open 1.0, is downloaded from Hugging Face under the Stability AI Community License.
