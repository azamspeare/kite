# Troubleshooting

- **Something doesn't work** → `./storyboard doctor` names what's missing and how to fix it; `./storyboard setup` fixes most of it.
- **An engine doesn't start** → `./storyboard logs music` (or `sfx`) shows why; `./storyboard status` shows memory use.
- **The chat says "Not logged in"** → run `claude auth login` for Claude Code or `codex login` for Codex (or run `./storyboard setup`), then send the message again.
- **Codex asks for an update** → use a current Codex CLI with `exec --ignore-user-config` and `--ignore-rules` (0.159.0 or newer recommended). Storyboard does not fall back to unrestricted execution.
- **A Codex model is missing from the menu** → run `codex` to refresh the CLI's catalog, then reload the editor; or set `STORYBOARD_CODEX_MODEL` to its id when starting Storyboard.
- **"Port 5199 is used by another program"** → `PORT=5299 ./storyboard start`.
- **A scene shows a red error panel** → the message is also given to the agent on its next `render_frames`; ask it to fix the error, or undo.
- **"Forbidden" from the API** → open the editor at the address `./storyboard start` prints. Requests from other websites and other local ports are refused on purpose.
- **Setup stopped halfway** → run `./storyboard setup` again; it picks up where it left off. `./storyboard logs setup` shows what the last run did.
