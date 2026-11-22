# Things 3 adapter

Syncs the dibs store with [Things 3](https://culturedcode.com/things/) on macOS. Writes use the [Things URL scheme](https://culturedcode.com/things/support/articles/2803573/); reads use Things' AppleScript dictionary through `osascript`, because the URL scheme cannot read tasks.

## Connect

1. Install Things 3 on the Mac that runs dibs.
2. Enable the URL scheme and copy the auth token: Things → Settings → General → Enable Things URLs → Manage.
3. Save the token in Pi:
   ```
   /todos connect things <token>
   ```
   Outside Pi, set `DIBS_THINGS_TOKEN` in the environment of the CLI or MCP server. The Pi command writes the token to `~/.dibs/adapters/things.json` with `0600` permissions, never to a `config.json` (which may be committed). `DIBS_THINGS_TOKEN` overrides the file.
4. Turn sync on in a dibs `config.json` (global `~/.dibs/config.json` or the project's):
   ```json
   {"adapters": {"things": {"sync": true}}}
   ```
5. Run `/reload` in Pi, or `npx -y @dibs.ai/dibs sync` from the CLI. On the first read, macOS asks to let your terminal control Things 3 (System Settings → Privacy & Security → Automation); allow it.

To disconnect, set `"sync": false` or remove the entry, and delete `~/.dibs/adapters/things.json`. Tasks already synced stay on both sides.

## Projects

Each dibs project syncs with the Things project of the same name (the project folder's name, or its name in `~/.dibs/projects/projects.jsonl`). dibs creates the Things project with the first new task. Only to-dos in that project sync; to-dos you move out of it stop syncing.

## Capabilities

| Field | dibs → Things | Things → dibs |
|---|---|---|
| Create to-do | yes | yes |
| Name → title (todo.txt priority, `+project`, `@context` stay as text) | yes | yes |
| Description → notes | yes | yes |
| Completed (and un-completed) | yes | yes |

- Two-way, on the schedule in the [main README](../../../../README.md#adapters). Per field, dibs copies across a change made on one side since the last sync, and dibs wins when both sides changed the field.
- Changes made in Things reach dibs on the next sync.
- State: links and last-synced copies live in `sync/things.jsonl` next to the store's `config.json`.

## Limitations

- macOS only.
- Canceled to-dos are skipped.
- Renaming either project breaks the match; dibs then creates a new Things project.
- Not synced: started time, result, parent/subtasks (Things has projects, headings and checklists rather than subtasks), and Things' when/deadline, tags, areas, projects, headings and checklists.
- Deletions are never propagated in either direction.
- The URL scheme does not return the new to-do's id to a command-line caller. dibs tags the notes with a temporary `[dibs:<id>]` marker, waits up to about 5 seconds to find the to-do, then removes the marker. If Things takes longer, the sync fails and retries, and the retry can create a duplicate.
- Adding uses `open -g` so Things stays in the background, but macOS may still launch it.
- No live updates: Things has no folder to watch.
- A sync failure does not block the local change: Pi shows a notice, the MCP server logs to stderr, and `dibs sync` exits 1.
