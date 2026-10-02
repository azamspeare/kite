# Troubleshooting

- **Something doesn't work** → `./kite doctor` names what's missing and how to fix it; `./kite setup` fixes most of it.
- **An engine doesn't start** → `./kite logs music` (or `sfx`) shows why; `./kite status` shows memory use.
- **The chat says "Not logged in"** → run `claude auth login` for Claude Code or `codex login` for Codex (or run `./kite setup`), then send the message again.
- **Codex asks for an update** → use a current Codex CLI with `exec --ignore-user-config` and `--ignore-rules` (0.159.0 or newer recommended). Kite does not fall back to unrestricted execution.
- **A Codex model is missing from the menu** → run `codex` to refresh the CLI's catalog, then reload the editor; or set `KITE_CODEX_MODEL` to its id when starting Kite.
- **"Port 5199 is used by another program"** → `PORT=5299 ./kite start`.
- **A scene shows a red error panel** → the message is also given to the agent on its next `render_frames`; ask it to fix the error, or undo.
- **"Forbidden" from the API** → open the editor at the address `./kite start` prints. Requests from other websites and other local ports are refused on purpose.
- **Setup stopped halfway** → run `./kite setup` again; it picks up where it left off. `./kite logs setup` shows what the last run did.
