# Multi-agent coordination scenarios

These manual tests check whether separate agents can share one dibs store. Each agent runs in its own Rex session. The tests also check that agents respect the `claimed` and `blocked` fields: an agent must not work on a task that another agent has claimed, or on a task whose blocker is still open.

## Setup

- **Orchestrator:** Claude Code with the dibs plugin, whose `.mcp.json` is pinned to the package under test (for example `@dibs.ai/dibs@0.1.8-dev.4`). It's loaded with `--plugin-dir` in the trusted folder `~/.cache/dibs-ui/claude`.
- **Workers:** two Pi agents. Each loads the npm Pi extension at the same version, with the dibs skill, and runs in its own Rex session:
  - `pi --model kimi-coding/kimi-for-coding --thinking low` (agent K)
  - `pi --model openai/gpt-6-luna --thinking low` (agent L)
- **Identities:** each agent gets a distinct `DIBS_SESSION`, so claims show distinct owners.
- **Scenario folder:** each scenario runs in its own folder, created by `run-scenario.sh setup <name>`. The script lives in this directory; its subcommands are `setup`, `agent`, `say`, `watch`, `collect` and `teardown`. The folder holds its own store, `DIBS_HOME`, a `bin/dibs` wrapper pinned to `DIBS_VERSION`, and `evidence/`. It starts with no leftover tasks. Delete it afterwards.
- **Package under test:** `0.1.8-dev.4` or later (`start` refuses tasks with open blockers; the list query matches ids). Set `DIBS_VERSION` to a published version to install it from npm, or to `local` to test this checkout without a release: `setup` then runs `nub run build`, packs `packages/dibs` and `plugins/pi` with `nub pack`, and installs both tarballs. Packing rewrites Pi's `workspace:*` dependency, so Pi uses the local core. A local pack keeps the version in `package.json`, so `npm ls` can't tell it from the published release.
- **Pinned CLI on PATH:** the agents' `dibs` resolves to the version under test. Reading the store file (`todos.jsonl`) directly, or running an unpinned `npx @dibs.ai/dibs`, counts as a protocol violation.
- **Evidence:** `watch` logs store changes each second (status, `started_at`, `claimed_by`). `collect` extracts each agent's tool calls with timestamps from its Pi session log, prints automatic checks, and writes them with the evidence to `results/YYYY-MM-DDTHHMMSSZ-<scenario>.md` (UTC). Screen captures are not evidence.
- **Repeats:** run each scenario once. Run it 3 times, and report the pass count (for example 3/3), only when a result needs further investigation, such as a failure or a pass that may be accidental.
- **Tasks:** trivial file edits, so that only coordination is being tested. Task A writes `sN-a.txt`. Task B is blocked by A and runs `test -f sN-a.txt && echo 'B done' >> sN-a.txt`.

### Prompts

Send these verbatim with `run-scenario.sh say`, substituting the ids:

- Assign A: `Work on dibs task <A> only. Use the dibs task tools to claim it, do it, and complete it. Don't touch other tasks.`
- Assign B: `Work on dibs task <B> only. Use the dibs task tools to claim it, do it, and complete it. Don't touch other tasks.`
- Scenario 3, B adds: ` It is blocked by <A>, which another agent is doing. Wait until its blocker is done (poll todo_list), then claim it.`
- Re-ask B (scenario 2): `Try dibs task <B> again: claim it, do it, and complete it.`

The prompts deliberately do not say "check it's ready", so the dibs tools, not the prompt, must stop out-of-order work.

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

## Scenario 4: blocked start refused

1. Claude creates task A, and task B blocked by A.
2. Claude starts agent L and assigns it B while A is open. There is no agent K.

**Expected:**
- `todo_status started` on B fails and names A.
- L reports the block and stops. It does not retry with `force` and does not do B's work.

**Failure:** L passes `force`, does B's work, or works around the tool.

## Scenario 5: task links in a Markdown file

Agents get their work from a `dibs://` link in a shared Markdown file instead of a task ID in the prompt.

1. Claude creates task A, and task B blocked by A.
2. Claude runs `source env.sh && dibs link <A>` in the scenario folder and writes `work/plan.md`:

   ```markdown
   ## Next
   - <the link to A>

   ## Handoff
   ```

3. Claude starts agent K and sends: `Read plan.md. Do the dibs task linked under Next: read it with the dibs task tools, claim it, do it, and complete it. Then add a Markdown dibs link to task <B> under Handoff in plan.md.`
4. After A is done, Claude starts agent L and sends: `Read plan.md. Do the dibs task linked under Handoff: read it with the dibs task tools, claim it, do it, and complete it. Don't touch other tasks.`

**Expected:**
- K reads A with `todo_resolve` on the link from `plan.md`, then claims and completes A.
- K gets B's link from `todo_link` and writes it under Handoff as `[name](dibs://<project-id>/<B>)`.
- L reads B with `todo_resolve` on the link K wrote, then claims and completes B.

**Failure:**
- An agent builds a `dibs://` URL by hand, or writes a link that doesn't resolve.
- An agent reads `plan.md`'s target from the raw store or does the wrong task.
- L starts B before A is done.

`collect` copies `plan.md` into `evidence/` and adds three checks when it exists: `plan.md` links to B, `todo_resolve` was called on a `dibs://` link at least twice, and `todo_link` was used.

## Record for each scenario

- The evidence files: `prompts.log`, `store.log`, `<agent>-tools.log` and the copied file.
- The automatic check output from `collect`.
- The task IDs, and each task's `status`, claim owner and `blocked_by`, over time (from `store.log`).
- What each agent said when it hit a block or a claim.
- A pass or fail verdict per run, the pass count if it was repeated, and notes.

## Results

Each run gets a dated Markdown report in [`results/`](results/), named `YYYY-MM-DDTHHMMSSZ-<scenario>.md` (UTC), so repeated runs each keep their own report. `collect` writes it with the check output and the evidence inline; add the verdict and notes by hand. Earlier runs are in [`results/2026-11-25-runs.md`](results/2026-11-25-runs.md).
