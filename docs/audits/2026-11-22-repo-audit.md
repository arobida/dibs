# dibs repo audit

**What this repo does:** dibs is one task list that several coding agents share. Each project keeps its tasks in a JSONL file (one JSON object per line). Agents reach that file through the `dibs` CLI, an MCP server (`dibs mcp`, a tool server agents talk to over stdin/stdout) or the Pi extension. Optional adapters copy tasks to and from Dex and Things 3.

**Load assumed:** one person on one machine, with two to five agent processes (Pi, Claude Code, Codex, a CLI) working on the same project store at the same time. Not a server, no network users.

**How this was checked:** every file in `src/`, `agents/`, `scripts/` and `test/` was read in full. `nub run test` passes (63 tests, 1 skipped) and `tsc` is clean. A second, adversarial review (Codex) tried to refute each finding and hunt for missed ones; every claim it made was checked again before it went in. Findings marked **verified** were reproduced against the built `lib/` in a scratch folder; **traced** means read from the code but not run.

## Must fix

### 1. The CLI forgets your tasks between two commands (`src/cli/index.ts:35-36`, `src/core/store.ts:73,89-91`) - verified

- **What this is:** A project is "trusted" only when the current folder has `.dibs/` or `.agents/dibs/`, or `DIBS_TRUST=1` is set. An untrusted project uses a temp store under `$TMPDIR/dibs/<hash of session id>/`. For the CLI, the session id is the parent process id (`process.ppid`).
- **Problem:** Agents and `npx` start a new shell for every command, so each command gets a new parent id and a new, empty temp store. Running the README quick start (`create "Write tests"`, then `list`) in a fresh folder prints nothing. Running `dibs` from a subfolder such as `src/` of a trusted project does the same, because trust, store folder and project name all come from the current folder only. Each call also leaves a new temp folder behind: three `panel` calls made three folders, and the Claude Code panel calls `panel` every 3 seconds.
- **Fix:** Find the project root once: walk up from the current folder to the nearest one with `.dibs/` or `.agents/dibs/` (the way `configured()` in `src/core/adapters/dex/index.ts:19-28` walks up for Dex). Use that root for trust, store folder, project name and registration. For untrusted folders, key the temp store on the folder, not the parent process: `sessionId: () => process.env.DIBS_SESSION ?? cwd`.
- **If we skip it:** New users see their first task vanish, and agents that `cd` into a subfolder silently write to a throwaway list.

### 2. CLI agents cannot call dibs on a task (`src/cli/index.ts:81-82`, `src/core/tasks.ts:41,142`) - verified

- **What this is:** `start` stores a claim `<session>:<pid>`. While that pid is alive, `ready` hides the task and other sessions cannot start or complete it without `force`.
- **Problem:** Two holes. First, the CLI claims with its own pid and exits right after `start`, so the claim is dead at once and `dibs ready` lists the started task again (reproduced). Codex, Cursor and the Claude Code skill all work through the CLI, and the skill says "pick from `ready`", so a second agent starts the same task. Second, the ownership check at `tasks.ts:142` runs only when the caller passes a claim, and CLI `complete` passes none, so a CLI agent can complete a task that a live Pi or MCP session owns.
- **Fix:** Give CLI claims an owner that outlives the process: `start` passes `--claim cli:${process.env.DIBS_SESSION ?? agentName()}`. `live()` already treats a claim whose last part is not a number as alive, so the task stays taken until `complete` or `force`. At `tasks.ts:142`, check ownership whenever the task has a live owner, not only when a claim was passed (`owner && owner !== claim`), and add `--force` to the CLI. The check already runs under the file lock, so it is atomic. The cost: a CLI agent that dies leaves its task claimed until someone runs `start --force`.
- **If we skip it:** Parallel agents duplicate work, which is the exact problem dibs exists to stop.

### 3. Changing scope makes the next sync duplicate every task, and can lose a write (`src/core/store.ts:92,147-158`, `src/core/adapters/sync.ts:30`) - traced

- **What this is:** `dibs scope global` moves a project's tasks to `~/.dibs/projects/<name>.<id>/`. Sync keeps its links (which local task is which remote task) in `<store folder>/sync/<adapter>.jsonl`.
- **Problem:** `setScope` copies only `todos/`. The `sync/` folder stays behind, and moving back to project scope deletes the global folder with `rmSync(from, { recursive: true })`, `sync/` included. With no links, the next sync creates every local task again in the adapter and pulls every remote task in again as a new local task. In global scope `settings()` also reads the global store's `config.json` instead of the project's (`store.ts:92`), so adapters turned on in the project config (this repo turns on Things in `.dibs/config.json`) silently stop. Finally, the move takes no lock: a task saved by another agent between the copy and the delete is lost, and the registry is rewritten from a snapshot read before the copy, dropping any project registered meanwhile (that project re-registers on its next run).
- **Fix:** Copy `sync/` along with `todos/` (loop over `["todos", "sync"]` at `store.ts:155`, skipping `*.lock` files). Read the project's local `config.json` in both scopes. Run the copy and delete inside `withLock` on the todos file, and re-read the registry just before `saveRegistry`. Add one test: sync, change scope, sync again, expect no new remote tasks.
- **If we skip it:** One scope change doubles the user's Things or Dex list and their dibs list.

### 4. `dibs scope <typo>` breaks the project until the registry is edited by hand (`src/cli/index.ts:55`, `src/core/store.ts:150,157`) - verified

- **What this is:** `setScope` accepts `project` or `global`. Pi checks the word with a regex first; the CLI passes any word through.
- **Problem:** `setScope` treats every word other than `global` as "move to project", moves the tasks and saves the word in `projects.jsonl`. Then `settings()` rejects it. Reproduced: `dibs scope global`, then `dibs scope banana`: the registry holds `"scope":"banana"` and every later command, `list` included, fails with "Invalid dibs scope: banana".
- **Fix:** First line of `setScope`: `if (scope !== "project" && scope !== "global") throw new Error(...)`.
- **If we skip it:** One typo locks the user out of their tasks.

### 5. Sync breaks for good when a remote task is no longer started (`src/core/tasks.ts:109`, `src/core/adapters/sync.ts:73`) - verified with a fake adapter

- **What this is:** When a field changed only on the remote side, sync writes it locally and turns a cleared value into `""`.
- **Problem:** A cleared `started_at` becomes `""`. `put` keeps it (`??=` only replaces `null` and `undefined`), `clean` then drops the empty field, and `toTask` throws `bad started_at`. The link base never updates, so every later sync with that adapter throws the same error until the task is started again on one side. Whether Dex itself can clear `started_at` was not checked; any adapter that reports a task as not started triggers it.
- **Fix:** At `tasks.ts:109`, change `merged.started_at ??= null` to `merged.started_at ||= null`. One character. Add the fake-adapter case as a test.
- **If we skip it:** One remote edit stops that adapter's sync with an error nobody can act on.

### 6. Sync undoes local changes Dex does not take (`src/core/adapters/sync.ts:72-73`, `src/core/adapters/dex/index.ts:61-65`) - verified

- **What this is:** Sync compares local, remote and the last-synced copy (the "base") field by field. After pushing a local change, it sets the base to the local value, assuming the remote took it.
- **Problem:** When Dex skips the change, the next sync sees the remote differ from the base and pulls the old value back. Two cases. Complete a task with result "first", sync, complete it again with "second", sync twice: the result is "first" again (Dex cannot edit a completed task's result). Clear a task's description locally: sync sends `{ description: undefined }`, `update` tests `patch.description !== undefined` and runs no command (reproduced: zero Dex calls), and the next sync restores the old description. The comment at `dex/index.ts:60` says such changes "stay local"; they do not.
- **Fix:** In the Dex `update`, test `"description" in patch` and send `""`, as the Things adapter already does (`things/index.ts:68`). Then let `update` return the fields it skipped (`result` without a completion, `completed: false`, a cleared `started_at` or `parent`), and keep the old base for exactly those fields. Do not keep the old base for every pushed field: Things trims names, so that would push the same name on every sync.
- **If we skip it:** Agents fix a task and the fix disappears on the next sync.

### 7. MCP and Pi cannot clear a task's human (`src/cli/mcp.ts:23`, `agents/pi/index.ts:83`) - traced

- **What this is:** The `todo_edit` tool says `human: ""` clears the human. Both tool runners first delete every `""` field, because models fill unused fields with `""`.
- **Problem:** `human: ""` is deleted before it is read. If it is the only field, the call fails with "todo_edit needs at least one of name, description, blocked_by, human"; with other fields, the human silently stays.
- **Fix:** Keep `""` for `human`: `if (p[k] === null || (p[k] === "" && k !== "human")) delete p[k]`. Same line in both files (see finding 18).
- **If we skip it:** A task can never be handed back from a person through an agent. Nothing is corrupted, but the tool does not do what it says.

### 8. `dibs create --human me` stores the word "me" (`src/cli/index.ts:73,76,79`) - verified

- **What this is:** `--human me` should mean "my GitHub user". The CLI resolves it into `who`.
- **Problem:** `list` and `ready` use `who`, but `create` and `edit` pass the raw `v.human`. The task gets `human: "me"`, and `list --human me` (which looks for the real user) no longer finds it. The MCP tool resolves "me" on edit, so the same input means two things.
- **Fix:** Use `who` in both: `"--human", who ?? await ghUser(ctx) ?? ""` for `create`, and `...(who === undefined ? [] : ["--human", who])` for `edit`.
- **If we skip it:** Tasks assigned to "me" drop out of the per-person views and the adapter `human` filter.

## Should fix

### 9. Sync overwrites a local edit made while it runs (`src/core/adapters/sync.ts:36,73`, `src/core/tasks.ts:108`) - verified with a fake adapter

- **What this is:** Sync reads the local tasks once, then waits on the adapter (`dex list` or `osascript`), then writes the fields that changed remotely.
- **Problem:** The write does not check whether the local task changed in the meantime. Reproduced: the remote description changes, another agent edits the local description while `adapter.list()` runs, and the sync replaces the agent's edit with the remote one. The rule "both sides changed, dibs wins" is broken in this window.
- **Fix:** Pass the expected old value with each pulled field, and have `put` apply a field only while the stored value still equals it (the check runs under the file lock).
- **If we skip it:** Occasional lost edits when an agent works while another process syncs.

### 10. Sync holds a lock through slow app calls, and every MCP call syncs (`src/core/adapters/sync.ts:32`, `src/cli/mcp.ts:39-41`) - traced

- **What this is:** Sync takes a file lock on its link file for the whole run. The MCP server runs a full sync before every `todo_list` and after every change. The lock waits at most about 11 seconds (`util.ts:13`).
- **Problem:** The Things adapter waits up to 5 seconds per new to-do (`things/index.ts:58-63`). While one agent pushes a few new tasks, every other agent's `todo_list` waits about 11 seconds and then logs "Task file is locked". A first sync of 12 tasks can hold the lock for a minute.
- **Fix:** Do not wait for another sync: `withLock(linksFile, fn, 0)` throws at once if the lock is held. In `syncAll`, report that one error as "skipped, another process is syncing"; let every other error surface as it does now.
- **If we skip it:** With Things on (as in this repo), agents stall on every task list while another agent syncs.

### 11. Stale-lock recovery can let two processes in at once (`src/core/util.ts:22-33`) - traced

- **What this is:** When the lock's pid is dead, a waiter renames the lock away, checks it moved the lock it saw, and puts it back if not.
- **Problem:** Three waiters on a dead lock: A renames it away and takes a fresh lock. B, which read the dead lock earlier, now renames A's live lock away. Before B puts it back, C creates a new lock and enters. B's `linkSync` fails with `EEXIST`, which is swallowed, so A and C both hold the lock and one of their saves is lost. It needs a crashed holder plus three contenders, so it is rare at the assumed load.
- **Fix:** Let only one process at a time do stale recovery: take `<lock>.takeover` with `wx` (treated as stale after 5 seconds), re-read the lock, and `unlink` it only if it still holds the dead pid. A new holder can create the lock only after it is gone, so nothing else can replace it in between.
- **If we skip it:** A rare lost task write after a crash.

### 12. Export and import drop blockers (`src/core/todo.ts:57-58,65`) - verified

- **What this is:** Export writes each task as a todo.txt line with `dibs*:` tags for the dibs fields.
- **Problem:** `blocked_by` has no tag. Reproduced: a task blocked by `t1` exports as `B dibsid:t2` and imports with no blockers, so in a fresh store it shows as ready at once.
- **Fix:** Add a `dibsblocked:` tag holding the comma-joined ids (`encodeURIComponent` already escapes the commas), read it in `parseTodo`, and add it to the token list in `checkName`.
- **If we skip it:** Moving a plan through todo.txt quietly unblocks work that should wait.

### 13. Panels lose tasks you name by a short id (`agents/pi/index.ts:100`, `agents/claude-code/hooks/register.tsx:59-60`, `agents/opencode/plugin/tui.tsx:44`) - traced

- **What this is:** The "current" view shows the tasks this session touched. Each panel records the `id` the tool was called with.
- **Problem:** The tools accept a unique prefix (`a1b2c3` for `proj-a1b2c3`) and their descriptions suggest it, but the panel matches full ids (`panel.ts:17`). Start a task by its prefix and it never appears in "current".
- **Fix:** Record the id from the tool output instead: every reply has the form `... task <full-id> "<name>"`, so `/task (\S+) "/` gives the full id.
- **If we skip it:** The default panel view looks empty while the agent is working.

### 14. The JSR `./cli` export cannot start (`jsr.json:6,10`, `src/core/store.ts:9`) - traced

- **What this is:** `jsr.json` publishes `src/cli/index.ts` as `jsr:@dibs/dibs/cli`.
- **Problem:** The CLI imports `store.ts`, which reads `../../package.json` at import time. `package.json` is not in the JSR `publish.include` list, so the read fails. Running the export was blocked in this audit.
- **Fix:** Remove `"./cli"` from `jsr.json`. The CLI ships on npm; the JSR library export (`tasks.ts`) does not import `store.ts`.
- **If we skip it:** A published entry point crashes for anyone who tries it.

### 15. Reading config writes to disk (`src/core/store.ts:35`) - traced

- **What this is:** Every read of a `config.json` rewrites its `$schema` URL to the installed version.
- **Problem:** `.dibs/config.json` is committed (this repo commits it, pinned at 0.1.4). Two teammates on different dibs versions rewrite the line back and forth, so the file always shows as changed in git. In a read-only checkout the write throws and every command fails.
- **Fix:** Delete line 35 so reads have no side effects, and drop the matching promise in the README Configuration section. Editors keep working with the pinned schema.
- **If we skip it:** A permanent stray diff in team projects, and a CLI that cannot run on read-only files.

### 16. The panels start npm every 3 seconds (`agents/claude-code/hooks/register.tsx:29,51`, `agents/opencode/plugin/tui.tsx:26,69`) - traced

- **What this is:** Both panels poll by running `npx -y @dibs.ai/dibs panel`.
- **Problem:** Each poll starts npm and then node, 20 times a minute per open session, for as long as the session is open. The `dibs panel` work itself takes about 50 ms; the npm start-up cost could not be timed here. Before finding 1 is fixed, each poll in an untrusted folder also leaves a new temp folder (about 1,200 per hour).
- **Fix:** Run `dibs` directly when it is on the user's PATH (`register.tsx` already reads that PATH in `userPath`) and fall back to `npx` only when it is missing.
- **If we skip it:** Steady background process churn on every machine with the plugin.

### 17. The CHANGELOG promises behavior the code does not have (`CHANGELOG.md:3-18`)

- **What this is:** The "Unreleased" section lists what users can rely on.
- **Problem:** It says "import still reads the old `pi*:` tags" and "`config.jsonl` files are converted on first read". `parseTodo` (`todo.ts:45`) reads only `dibs*` tags, and no code reads `config.jsonl`. Importing an old pi-do export keeps `piid:...` text inside task names. The section also still reads "Unreleased" after the 0.1.5 and 0.1.6 tags.
- **Fix:** Remove the two false claims (or add the five `pi*` tag names to the `parseTodo` regex, if old exports matter), and file the shipped entries under their release tags.
- **If we skip it:** Users with old pi-do data import broken task names.

### 18. The Pi and MCP tool runners are near-copies (`agents/pi/index.ts:81-98`, `src/cli/mcp.ts:22-38`)

- **What this is:** Both turn tool input into `runFile` arguments, line for line, apart from the creator name (`"pi"` vs `agentName()`) and the claim. The six tool descriptions are also written twice.
- **Problem:** A fix must land twice; finding 7 is already a bug in both copies.
- **Fix:** Move the argument builder to one function in `src/core` that takes the creator name and claim, and call it from both. About 18 lines go.
- **If we skip it:** The two agents drift apart one bug fix at a time.

## Nice to have

### 19. Dead arguments (`src/core/tasks.ts:118`, `src/cli/index.ts:60,82`, `src/cli/mcp.ts:35`, `agents/pi/index.ts:70,95`)

- **What this is:** Core `complete` calls pass `--no-commit`, and `list` calls pass `--all --json`.
- **Problem:** `runFile` never reads any of them. `--no-commit` is a Dex flag that leaked into the core calls; the real one in `dex/index.ts:64` stays.
- **Fix:** Drop them from the core callers and from the flag check at `tasks.ts:118`.
- **If we skip it:** Readers assume these flags do something.

### 20. `todos/lists.jsonl` is written and never read (`src/core/store.ts:123-124`)

- **What this is:** Each new store appends a record to `todos/lists.jsonl`.
- **Problem:** Nothing in `src/` or `agents/` reads it; only two tests check that it exists.
- **Fix:** Delete the two lines, the README mention and the two test checks.
- **If we skip it:** A file every store carries for no reader.

Four smaller findings were left out: no negative cache when `ghUser` fails, `dibs start ""` starting the only task in a one-task store, the CLI ignoring the legacy `.pi-do/` folder for trust, and pulled tasks getting UUIDs instead of short ids.

Two claims were checked and dropped. Swapping `runFile`'s reader for `readJsonl` (`util.ts:44`) looks like a free merge, but `readJsonl` drops a broken last line and the next save would then delete that task for good. And "every adapter update sends the old `result`" (`sync.ts:72`) is true, but neither shipped adapter reads `result` outside a completion, so it does no harm today.

**Verdict:** fix 1 and 2 first: together they break the shared list and the claim for every agent that uses the CLI. Then 3 to 6, which corrupt or block sync.

**Lean:** -22 lines, -0 dependencies possible.

**Not checked:**
- The Claude Code panel (`register.tsx`) and opencode panel (`tui.tsx`) against their host APIs; both have no tests. If Claude Code puts tool arguments under `e.input` instead of on the event, `register.tsx:57-59` never records a task and the "current" view stays empty.
- The Dex adapter against a real `dex` (not installed) and the Things adapter against Things 3.
- Running the npm and JSR packages (blocked in this session), and the release scripts.
- `docs/`, Windows behavior.
