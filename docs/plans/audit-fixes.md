# Plan: fix the 2026-11-22 audit findings

Status: done. Fixes all 20 findings in [the audit](../audits/2026-11-22-repo-audit.md); finding numbers below are the audit's. Follows AGENTS.md: each task goes to a Haiku or Sonnet subagent with low or no thinking. The lead reviews each diff, runs `nub run build && nub run test` after each wave, and commits with `wt step commit` once the user approves.

## Decisions

- **Work on a branch.** `main` stays untouched until the last wave passes: `git switch -c fix/audit` before task 1, in place, so subagents work in the repo folder.
- **Project root (finding 1).** Walk up from the current folder to the first one holding `.dibs/`, `.agents/dibs/` or `.pi-do/`. Skip a match whose folder is `dibsHome()`: `~/.dibs` is the global home, not a project, and without this check every folder under `~` would count as trusted. Trust, store folder, project name and registration all use that root. An untrusted folder keys its temp store on the resolved current folder, not on the parent process.
- **CLI claims (finding 2).** The CLI claims as `cli:<DIBS_SESSION, else DIBS_AGENT, else "cli">`. `live()` already treats a claim with no numeric pid as alive, so the task stays taken until `complete` or `--force`. Cost, accepted: a CLI agent that dies leaves its task claimed until someone runs `start --force`.
- **Adapters report skipped changes (finding 6).** `Adapter.update` returns `Promise<string[] | void>`: the fields it could not apply. Sync keeps the old base for exactly those fields. Things returns nothing.
- **Conditional pull (finding 9).** `runFile(file, ["put", taskJson, expectJson])`: `put` applies a pulled field only while the stored value still equals the one in `expectJson`, and returns the saved record. A field it skips stays a local change, so the next sync pushes it ("dibs wins").
- **Reads have no side effects (finding 15).** Delete the `$schema` rewrite. New stores still get the current URL from `writeConfig`.
- **CHANGELOG (finding 17).** Remove the two false claims. Do not build `pi*:` tag import: nobody asked for it, and the rename was a breaking release.
- **One tool runner (findings 7, 18).** New `src/core/tools.ts` exports `toolArgs(action, params, { creator, claim, user })`, which returns the `runFile` arguments. MCP and Pi keep their own schemas, claim and execution; only the argument building moves.
- **Tests go in new files per task** (`test/<topic>.test.ts`), so parallel subagents never edit the same test file.

## Tasks

| # | Findings | Task | Files | Model | Done when |
|---|---|---|---|---|---|
| 1 | 4, 5, 8, 14, 19, 20 | One-line fixes: validate the scope word first in `setScope`; `merged.started_at ||= null`; use `who` for `create` and `edit` in the CLI; remove `"./cli"` from `jsr.json`; drop `--no-commit` and `--all --json` from core callers and the flag check at `tasks.ts:118`; delete the `lists.jsonl` write and its two test checks. | `store.ts`, `tasks.ts`, `cli/index.ts`, `mcp.ts`, `pi/index.ts`, `jsr.json`, `test/extension.test.ts`, `test/quick-fixes.test.ts` | Haiku | New tests: `scope banana` leaves the registry unchanged and `list` works; a remote-cleared `started_at` syncs; `create --human me` stores the real user. Full suite green. |
| 2 | 1 | Project root and temp-store key, per the decision above. | `store.ts` (`localDir`, `settings`), `cli/index.ts` (`trusted`, `sessionId`) | Sonnet | New tests: `create` then `list` from two separate shells in an untrusted folder shows the task; `list` from `src/` of a trusted project shows its tasks; a folder under a fake `DIBS_HOME` parent is not trusted because of `.dibs`. |
| 3 | 9 | Conditional pull: `put` takes `expectJson` and returns the saved record; sync passes the snapshot values. | `tasks.ts` (`put`), `sync.ts` | Sonnet | New test: a local edit made during `adapter.list()` survives the sync (the audit's M1 repro). Existing sync tests green. |
| 4 | 6 | Dex `update` tests `"description" in patch` and returns skipped fields; sync keeps the old base for them. | `dex/index.ts`, `sync.ts`, `sync.ts` `Adapter` type | Sonnet | New tests with a fake `ctx.exec`: clearing a description sends `dex edit --description ""`; re-completing with a new result keeps the new result after two syncs; a Things-style trimmed name causes no repeat push. |
| 5 | 3 | Scope move: copy `sync/` with `todos/` (skip `*.lock`); read the project's local `config.json` in both scopes; run copy and delete inside `withLock` on the todos file; re-read the registry before `saveRegistry`. | `store.ts` (`setScope`, `settings`) | Sonnet | New test with a fake adapter: sync, `scope global`, sync, `scope project`, sync: no new remote or local tasks. Adapter config in `.dibs/config.json` still applies in global scope. |
| 6 | 2 | CLI claims, per the decision above: `start` claims `cli:...`; ownership is checked whenever the task has a live owner (`owner && owner !== claim`); CLI gains `--force` for `start` and `complete`. | `tasks.ts:140-142`, `cli/index.ts` | Sonnet | New tests: after CLI `start`, `ready` hides the task; a second session's `start` fails without `--force`; CLI `complete` of a task a live pid owns fails without `--force`. Existing claim tests green. |
| 7 | 7, 13 (Pi), 18 | Add `src/core/tools.ts` with `toolArgs`; MCP and Pi call it. Keep `human: ""` through the empty-field scrub. Pi tracks the full id parsed from the reply (`/task (\S+) "/`), not the id it was called with. | `src/core/tools.ts`, `mcp.ts`, `pi/index.ts` | Sonnet | New tests: `todo_edit` with only `human: ""` clears the human (MCP and Pi); Pi's current view shows a task started by its prefix. `test/layers.test.ts` green. |
| 8 | 11 | Stale-lock takeover through `<lock>.takeover` (`wx`, stale after 5 s): re-read the lock and `unlink` it only if it still holds the dead pid. | `util.ts` | Sonnet | Existing lock tests green; new test: three waiters on a dead lock never run `fn` at the same time (repeat 50 times). |
| 9 | 12 | `dibsblocked:` todo.txt tag: write comma-joined ids in `todoLine`, read in `parseTodo`, add to the `checkName` token list and the README tag list. | `todo.ts`, `README.md` | Haiku | New test: a task blocked by `t1` round-trips through export and import with `blocked_by: ["t1"]`. |
| 10 | 13 (panels), 16 | Claude Code and opencode panels: record the full id from the tool reply; run `dibs` from PATH when present, else `npx -y @dibs.ai/dibs`. | `register.tsx`, `tui.tsx` | Haiku | Lead review of the diff (no test harness exists for these hosts); `tsc` green. |
| 11 | 10 | Sync takes its lock with `tries = 0`; `syncAll` reports only the lock-held error as `skipped`, other errors as now. CLI prints `<name>: skipped, another process is syncing` and exits 0 for it. | `sync.ts`, `sync-all.ts`, `cli/index.ts` | Haiku | New test: a sync started while another holds the links lock returns `skipped` at once; an adapter error still returns `error`. |
| 12 | 15 | Delete the `$schema` rewrite in `readConfig`; update the test that expects it and the README Configuration sentence. | `store.ts:35`, `test/extension.test.ts`, `README.md` | Haiku | Reading an old config leaves the file byte-for-byte unchanged; a read-only `config.json` no longer makes commands fail. |
| 13 | 17, docs | Load the `technical-writing` skill. CHANGELOG: remove the two false claims, add entries for these fixes. README: quick start works in a fresh folder, project root rule, CLI claims and `--force`, `dibsblocked:`. `SKILL.md`: `--force`, claims last until `complete`. | `CHANGELOG.md`, `README.md`, `agents/shared/skills/dibs/SKILL.md` | Haiku | Lead review; no em or en dashes; every behavior named exists in code. |

## Order

Files decide the waves: two tasks that edit the same file never run at the same time.

1. **Wave 1:** task 1 alone (it touches many files).
2. **Wave 2, in parallel:** 2 (`store.ts`, `cli/index.ts`), 4 (`dex`, `sync.ts`), 7 (`mcp.ts`, `pi/index.ts`), 8 (`util.ts`), 9 (`todo.ts`), 10 (panels).
3. **Wave 3, in parallel:** 3 (`tasks.ts`, `sync.ts`), 5 (`store.ts`).
4. **Wave 4, in parallel:** 6 (`tasks.ts`, `cli/index.ts`), 12 (`store.ts`).
5. **Wave 5:** 11.
6. **Wave 6:** 13.

After each wave the lead runs `nub run build && nub run test` and `tsc`, and reads every diff before the next wave starts.

**Final check:** rerun the audit's reproductions (untrusted `create` then `list`, CLI `start` then `ready`, `scope banana`, the sync fakes) against the built `lib/`; all must show the fixed behavior. Then a `ponytail-review` of the branch diff.

## Skipped

The four smaller items the audit left out (`ghUser` negative cache, `start ""`, `.pi-do/` trust in the CLI beyond the root walk, UUID ids for pulled tasks). Importing `pi*:` tags (see Decisions).

## Risks

- **The root walk changes which store an existing user sees** when they run dibs from a subfolder that has its own stray `.dibs/`: the nearest one wins, as with git.
- **Sticky CLI claims** can strand a task after a crashed CLI agent; `start --force` is the way out, and `SKILL.md` must say so.
- **`Adapter.update` changes its return type.** Both adapters live in this repo, so nothing outside breaks.
- **Panels (task 10) cannot be tested here.** They need a manual check in Claude Code and opencode after release.
