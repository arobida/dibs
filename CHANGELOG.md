# Changelog

## Unreleased

- Find the project from any subfolder: the CLI walks up to the nearest folder with `.dibs/`, `.agents/dibs/` or `.pi-do/`, never the home folder or `~/.dibs`.

- Untrusted folders keep one temp store per folder (`DIBS_SESSION` overrides the key), so tasks persist across CLI calls in the same folder.

- CLI claims: `start` claims a task as `cli:<DIBS_SESSION or DIBS_AGENT or cli>` until `complete` or `--force`, and `ready` hides claimed tasks.

- `start` and `complete` refuse a task claimed by another live owner unless the new `--force` flag is given.

- `dibs scope` moves `sync/` with `todos/`, and a project's own `config.json` applies in both scopes.

- `dibs sync` prints `<adapter>: skipped, another process is syncing` when another process holds that adapter's sync, instead of waiting.

- todo.txt export and import carry blockers as `dibsblocked:` tags.

- `config.json` `$schema` is pinned to the version that created the file and is never rewritten on read.

- `todos/lists.jsonl` is no longer created.

- MCP and Pi `todo_edit` with an empty `human` clears the human; CLI `create` and `edit --human me` resolve to your GitHub user.

- `dibs scope` rejects any word other than `project` or `global`.

- `dibs sync` no longer fails when a remote task is un-started.

- Sync keeps local changes that Dex cannot store: a cleared description is now sent, and result edits on completed tasks stay local.

- Sync no longer overwrites a local edit made while it runs.

- Stale-lock recovery can no longer admit two processes.

- Panels track tasks named by a short id.

- Claude Code and opencode panels run `dibs` from PATH when installed.

- JSR no longer publishes the broken `./cli` export.

- Run the CLI on Node 26+: the package ships compiled JS in `lib/`, so `npx -y @dibs.ai/dibs` works without Bun.

- Agent integrations and MCP configs call `npx -y @dibs.ai/dibs` instead of `bunx @dibs.ai/dibs`.

- Contributors use Nub: `nub install`, `nub run test`, and `nub.lock` replaces `bun.lock`.

- Add `dibs mcp`: an MCP server over stdio (`src/cli/mcp.ts`) with six tools, `todo_list`, `todo_create`, `todo_edit`, `todo_status`, `todo_link` and `todo_resolve`. The Claude Code plugin registers it; the Codex, opencode and Cursor READMEs show the config.

- Add task attribution: `created_by` and `human` fields (todo.txt `dibsby:`/`dibshuman:`), `--human` on `create`/`edit`/`list`/`ready`, `DIBS_AGENT`/`DIBS_USER`, and `adapters.<name>.human` to sync only one human's tasks.
- Add `dibs sync`: syncs every adapter enabled in config; shares `syncAll` (`src/core/adapters/sync-all.ts`) with the Pi extension.
- Add `dibs` CLI (`src/cli`) over the shared core: `list`, `ready`, `create`, `start`, `complete`, `edit`, `import`, `export`, `link`, `scope`, `migrate`. Trusted if `DIBS_TRUST=1` or the project has an `.dibs/` folder; otherwise it uses the temp store.
- Split code into layers: `src/core` (shared, host-free), `src/cli`, `agents/shared` (skill and assets reused by agents), and `agents/<name>` (Pi extension, Claude Code plugin, Codex, opencode and Cursor integrations).
- Add `bun run build:agent <name>`: writes `dist/<name>/` from `agents/shared/`, then `agents/<name>/` on top, so an agent file at the same path replaces the shared one.
- Add Claude Code, Codex, opencode and Cursor integrations shipping the `dibs` skill, which shells out to the CLI.
- Breaking: rename pi-do to dibs: package `dibs`, folders `.dibs/` and `~/.dibs/`, env vars `DIBS_*`, todo.txt tags `dibsid:`/`dibsstart:`/`dibsdesc:`/`dibsparent:`/`dibsresult:`, `dibs://` links. An existing `.pi-do/` or `~/.pi-do/` is still used when the new folder is missing.
- Config is now `config.json` (JSONC) with a `$schema` pinned to the installed version (`schema.json`, plus `src/adapters/<name>/<name>.schema.json` per adapter) for editor autocomplete and validation.
- Add Things 3 adapter (macOS): each pi-do project syncs with a Things project of the same name; two-way sync of name, notes and completion via the Things URL scheme; `/todos connect things <token>` stores the auth token.
- Replace backends with adapters: the pi-do file store always holds tasks; Dex becomes an adapter with two-way `sync` (`"adapters": {"dex": {"sync": true}}`). `backend` config and `PI_DO_BACKEND` are removed.
- Default file backend stores todos in trusted projects at `.pi-do/` (or `.agents/pi-do/` if present): `config.jsonl`, `todos/lists.jsonl` index and `todos/<name>.todos.jsonl`, starting with a "Hello World" todo. Untrusted projects keep the temporary session file.
- Each JSONL line maps 1:1 to a todo.txt line; new `/todos import <path>` complements export (skips duplicate lines and `piid:`s).
- `~/.pi-do/` holds the global `config.jsonl` and `projects/projects.jsonl`, which tracks every project (`id`, `name`, `path`, `scope`, `created`). Projects are matched by the id in their local `config.jsonl`.
- `/todos scope project|global` moves a project's todos to or from `~/.pi-do/projects/<name>.<id>/`.
- `/todos migrate .pi-do|.agents/pi-do` moves the project store between folders. Trusted projects only.
- `--global` on export/import targets the global store.
- Temp and untrusted sessions use the same layout under `$TMPDIR/pi-do/<session-hash>/.pi-do/` and start empty; Hello World is added only on first install (no `~/.pi-do/` yet) or when a new permanent todos file is created.
- Breaking: `config.jsonl` (global < project < `PI_DO_*` env) replaces the `piDo` block in Pi `settings.json`. New env vars `PI_DO_SCOPE`, `PI_DO_HOME`.

## 0.1.0

- Extract the existing Dex task tool and panel into a standalone Pi package; behavior unchanged.
