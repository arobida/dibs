> NOTE: The Dex sync adapter is removed. Use the [one-time Dex import](../../../../README.md#dex-import). The historical adapter instructions below are retained for reference.

# Dex adapter

Syncs the dibs store with [Dex](https://github.com/dcramer/dex) through the `dex` CLI.

## Connect

1. Install `dex` and make sure it is on `PATH` (`dex --version`).
2. Optional: run `dex init` (global `~/.config/dex/dex.toml`) or add a project `.dex/config.toml` to choose where Dex stores tasks. Without either, dibs uses temporary per-session Dex storage.
3. Turn sync on in a dibs `config.json` (global `~/.dibs/config.json` or the project's):
   ```json
   {"adapters": {"dex": {"sync": true}}}
   ```
4. Run `/reload` in Pi, or `npx -y @dibs.ai/dibs sync` from the CLI. Existing Dex tasks are pulled into dibs on the first sync, and dibs tasks are pushed to Dex.

To disconnect, set `"sync": false` or remove the entry. Tasks already synced stay on both sides.

## Capabilities

| Field | dibs → Dex | Dex → dibs |
|---|---|---|
| Create task | yes | yes |
| Name (todo.txt priority, `+project`, `@context` as text) | yes | yes |
| Description | yes | yes |
| Parent (subtasks) | yes | yes |
| Started | yes | yes |
| Completed + result | yes | yes |

- Two-way, on the schedule in the [main README](../../../../README.md#adapters). Pi also syncs when Dex's storage folder changes (file storage engine only), so changes other agents make in Dex show up without a dibs action.
- Conflicts: per field, a change on one side since the last sync is copied across. If both sides changed the same field, dibs wins.
- State: links and last-synced copies live in `sync/dex.jsonl` next to the store's `config.json`.
- Completing in Dex uses `--no-commit --force`.

## Limitations

- Deletions are never propagated in either direction.
- Dex cannot un-complete or un-start a task, remove a parent, or change a completed task's result. The adapter reports those changes as skipped, so they stay in dibs and the next sync does not pull the old value back.
- Not synced: Dex's numeric priority, blockers (`blockedBy`/`blocks`), linked commits, metadata, archived tasks, and GitHub/Shortcut sync.
- Dex storage outside the file engine (no local folder) syncs only on dibs actions, not live.
- A sync failure does not block the local change: Pi shows a notice, the MCP server logs to stderr, and `dibs sync` exits 1. dibs retries on the next sync.
