# Things 3 adapter

Syncs the dibs store with [Things 3](https://culturedcode.com/things/) on macOS. Writes use the [Things URL scheme](https://culturedcode.com/things/support/articles/2803573/); reads use Things' AppleScript dictionary through `osascript`, because the URL scheme cannot read tasks.

## Connect

1. Install Things 3 on the Mac that runs dibs.
2. Enable the URL scheme and copy the auth token: Things → Settings → General → Enable Things URLs → Manage.
3. Run `dibs init --adapter things` after consenting to enable sync. For an already enabled adapter, run `dibs init --connect`.
4. Enter the token through the hidden TTY prompt. Without a TTY, set `DIBS_THINGS_TOKEN` privately before rerunning. Never put the token in chat or a CLI argument.
5. Allow macOS Automation access if prompted (System Settings → Privacy & Security → Automation). Init probes read access through `.list()` using `osascript`; it never syncs, creates, or updates tasks.

Hidden input saves the token to `~/.dibs/adapters/things.json` with `0600` permissions, never to a `config.json` that may be committed. `DIBS_THINGS_TOKEN` overrides the file. Missing credentials leave connection setup pending. A valid token shape and successful read do not authenticate the token for writes.

The Pi `/todos connect things <token>` helper remains backward compatible, but private `init` input is recommended. Run `/reload` in Pi after configuration changes. Sync explicitly with `dibs sync` when ready; see the [setup reference](../../../../README.md#init-and-doctor) for consent and read-only doctor checks.

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
