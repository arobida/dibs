# Multi-agent coordination scenarios

These manual tests check whether separate agents can share one dibs store. Each agent runs in its own Rex session. The tests also check that agents respect the `claimed` and `blocked` fields: an agent must not work on a task that another agent has claimed, or on a task whose blocker is still open.

## Setup

- **Orchestrator:** Claude Code with the dibs plugin, whose `.mcp.json` is pinned to the package under test (for example `@dibs.ai/dibs@0.1.8-dev.2`). It's loaded with `--plugin-dir` in the trusted folder `~/.cache/dibs-ui/claude`.
- **Workers:** two Pi agents. Each loads the npm Pi extension at the same version, with the dibs skill, and runs in its own Rex session:
  - `pi --model kimi-coding/kimi-for-coding --thinking low` (agent K)
  - `pi --model openai/gpt-6-luna --thinking low` (agent L)
- **Shared store:** every agent runs in `~/.cache/dibs-ui/claude` with `DIBS_TRUST=1` and the same throwaway `DIBS_HOME`.
- **Identities:** each agent gets a distinct `DIBS_SESSION`, so claims show distinct owners.
- **Tasks:** trivial file edits, so that only coordination is being tested. Task A writes `sN-a.txt`. Task B is blocked by A and runs `test -f sN-a.txt && echo 'B done' >> sN-a.txt`, so it fails if A hasn't run (a bare `>>` would create the file).
- **Store:** start each run from an empty store; leftover tasks show up in every agent's `todo_list`.
- **Observer:** the person running the test, or an agent, watches through `rex capture` and `dibs list --json` and doesn't intervene.

## Scenario 1: sequential handoff

1. Claude creates task A, and task B blocked by A.
2. Claude starts agent K and assigns it A.
3. Claude waits until A is done, then starts agent L and assigns it B.

**Expected:**
- K claims A, completes it, and doesn't touch B.
- L sees that B is ready, claims it and completes it.

## Scenario 2: blocked task assigned early

1. Claude creates task A, and task B blocked by A.
2. Claude starts agent L first and assigns it B while A is still open.
3. Then Claude starts agent K and assigns it A.

**Expected:**
- L reports that B is blocked by A, doesn't claim B, and doesn't do any of B's work while A is open.
- K completes A.
- Once A is done, L can finish B, either on its own initiative or when asked again.

**Failure:** L claims or does B before A is done, or forces past the block.

## Scenario 3: both agents assigned at once

1. Claude creates task A, and task B blocked by A.
2. Claude starts K (assigned A) and L (assigned B) at the same time, telling L to wait for its blocker.

**Expected:**
- L waits, for example by polling `todo_list`, until A is done. Only then does it claim and complete B.
- K's claim on A is never overridden.

**Failure:**
- L starts B early.
- L claims or completes A itself.
- Either agent uses `--force` to take over the other's claim.

## Record for each scenario

- The task IDs, and each task's `status`, claim owner and `blocked_by`, over time.
- Whether any agent did work out of order, and the file contents as evidence.
- What each agent said when it hit a block or a claim.
- A pass or fail verdict, with notes.

## Results

_Filled in after each run._

### Scenario 1, 2026-11-25, `0.1.8-dev.2`: pass

Both workers ran with `--no-extensions --no-skills`, loading only the `0.1.8-dev.2` extension and dibs skill, because the globally installed `@dibs.ai/pi` is `0.1.0`. Identities: `DIBS_SESSION=agent-k` and `agent-l`.

| Task | ID | `blocked_by` | Started | Completed by |
|---|---|---|---|---|
| A | `clau-cb4fdd` | none | 11:05:08Z | K |
| B | `clau-93aa92` | `clau-cb4fdd` | 11:06:12Z | L |

- K claimed A, wrote the file and completed A. It said that B was "now unblocked, but I left it alone as instructed".
- L read `s1-a.txt` before appending to it, then completed B. Its result: "Appended 'B done' to s1-a.txt after confirming the file existed."
- Final `s1-a.txt`: `A done`, then `B done`. Nothing ran out of order.

Notes:
- The store keeps no claim owner after a task is completed, so the owner column above comes from each agent's screen, not from `dibs list --json`.
- `dibs --json create` prints plain text, not JSON.

### Scenario 2, 2026-11-25, `0.1.8-dev.2`: fail

Tasks: A `clau-26ea05`, B `clau-865a00` blocked by A. L was told to claim, do and complete B; unlike scenario 1, the prompt did not say "check it's ready".

| Time (UTC) | Event |
|---|---|
| 11:31:52 | L calls `todo_status started` on B while A is open. Result: "claimed by this session", no warning. |
| 11:31:5x | L sees only `s1-a.txt` in the folder, then runs `printf 'B done' >> s2-a.txt`, which creates the file. |
| 11:31:5x | L completes B. |
| 11:33:24 | K starts A, then uses `write` to create `s2-a.txt`, overwriting L's line. |

Final `s2-a.txt`: `A done` only. The store says B is complete, but its work is gone.

Cause: `start` and `complete` check only for a live claim from another session (`src/core/tasks.ts:145`); neither checks for open blockers. Only `ready` filters blocked tasks (`src/core/tasks.ts:82`). The skill says to pick from `ready` before starting, but nothing enforces it.

### Scenario 2 rerun, 2026-11-25, `0.1.8-dev.2`: pass, by accident

Same setup with new tasks (A `clau-cfdb0f`, B `clau-40b4a6`). This time L was told to "check it's ready".

- L ran `todo_list {query: "clau-40b4a6"}`, then `{query: "40b4a6"}`. Both returned `[]`. It concluded that the task did not exist and stopped without claiming it.
- After K completed A, L was asked again. It found B, claimed it and appended to the file. Final file: `A done`, then `B done`.

L held off on B only because it could not find the task, not because it saw the blocker.

### Scenario 3, 2026-11-25, `0.1.8-dev.2`: pass, with a protocol deviation by K

Tasks: A `clau-ffa70f`, B `clau-bf1fee` blocked by A. Both agents were prompted at 11:37:26; L was told to poll `todo_list` until its blocker was done.

- L polled about every 3 s, saying "Still blocked" each time. It started B at 11:38:00, after A completed at 11:37:58. It guarded the append with `test -f s3-a.txt`. Final file: `A done`, then `B done`. Neither agent used `--force`.
- K could not find A with `todo_list {query: "ffa70f"}`. It then ran `cat .dibs/todos/*` to read the raw store, and claimed and completed A with `npx -y @dibs.ai/dibs start|complete` instead of the extension tools. `npx` resolves the `latest` tag, which is `0.1.7`, so a version other than the one under test wrote to the shared store, and the owner was recorded as `cli:agent-k` instead of the Pi session claim.

### Issues seen across runs

1. **Blockers were not enforced.** Starting or completing a blocked task succeeded silently (scenario 2). Fixed after these runs: `start` now fails with "Task <id> is blocked by open task(s) <ids>; finish them first or pass force to override" (`src/core/tasks.ts`, test in `test/cli-claims.test.ts`). `complete` still does not check blockers, because a task can only be completed after it has been started. Scenarios 2 and 3 need a rerun against a build with the fix.
2. **A task can't be found by its ID.** `list --query` matches only name and description (`src/core/tasks.ts:80`), and `ready` ignores `--query`. Agents given an ID failed this lookup in the scenario 2 rerun and in scenario 3 (both K and L). There is no tool that returns one task by ID.
3. **Agents fall back to unsafe paths.** After failing the lookup, K read the raw JSONL file and ran an unpinned `npx` CLI against the store (scenario 3).
4. **`todo_resolve` gets invoked on made-up URLs.** Every agent first tried `todo_resolve` with `dibs://<prefix>/<id>` and got "Unknown project: clau" or "Unknown project: claude". The ID prefix looks enough like a project name to invite this.
5. **`dibs --json create` prints plain text**, so scripts can't parse the new ID.
6. **Claims are short-lived and cleared on completion,** so claim ownership can only be audited while a task is open. The store keeps no record of who completed a task.
7. **Polling cost.** L's wait loop called `todo_list` with no filter about every 3 s, receiving the whole store each time.
8. **The test's failure check is weak.** `>>` creates a missing file, so "fails if missing" holds only when the agent adds its own guard. Task B should check for the file explicitly, for example `test -f sN-a.txt && echo 'B done' >> sN-a.txt`. The setup above now uses this guard.

The shared store held leftover tasks from an earlier, unfinished scenario 1 attempt (`clau-bc2669`, `clau-144f9f`), a `Hello World` task, `dev2 mcp check`, and a completed `probe: claim visibility` task. These showed up in every agent's `todo_list` output. The store has since been emptied.
