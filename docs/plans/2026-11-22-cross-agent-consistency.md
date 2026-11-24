# Plan: cross-agent consistency

Status: proposed implementation plan, 2026-11-22. See the working-tree observations below for implemented prerequisites.

Keep dibs authoritative for each project across CLI, Pi, and MCP. Use the existing core task operations and sync engine; adapters mirror tasks into actual todo apps.

Delegate each task below to one Haiku/Sonnet worker with low thinking. The lead reviews the diff and acceptance tests before assigning the next task.

## Observed working-tree behavior

These observations describe the inspected working tree, not a released package. Proposed changes begin in the next section.

- `src/core/doctor.ts` and `src/core/agent-verification.ts` implement standalone read-only installation checks in the working tree. Init includes consent-based adapter, connection, and agent setup, then runs doctor. This is not a release claim or completion of the broader diagnosis and consistency tasks below.
- `src/cli/index.ts` implements `init` and `init --from=dex`; `src/core/imports/dex.ts` owns the one-time import. This work is present but unreleased, and is a prerequisite rather than remaining work.
- `src/core/adapters/sync-all.ts` instantiates Things only. A configured removed adapter returns an actionable error. Dex is an import source, not a live sync backend.
- `src/core/store.ts` resolves project roots, scope, explicit files, trust, and legacy `.pi-do` fallback. `storeFile` creates folders, config, registry entries, and sometimes an onboarding task.
- `src/core/identity.ts` can run identity commands and write a user cache. A diagnostic read cannot safely call it indiscriminately.
- `src/core/tools.ts` shares Pi/MCP argument conversion; `src/cli/index.ts` builds arguments separately. Empty edit descriptions disappear in the shared converter, while CLI accepts them.
- The same converter silently resolves an unknown human `me` to an empty value. CLI rejects an unresolved explicit `--human me`.
- `src/core/tasks.ts` locks mutations and enforces claims for start/complete. CLI claims are sticky; other claims use PID liveness, with an acknowledged PID-reuse limit.
- `src/cli/index.ts` uses `cli:${DIBS_SESSION ?? agentName()}`. Pi and MCP append the process PID to their session identity (`agents/pi/index.ts`, `src/cli/mcp.ts`).
- Pi/MCP sync before task-list reads and after mutations. Normal CLI task operations do not sync; CLI has an explicit `sync` command. Panels read locally.
- MCP reports sync errors on stderr; Pi reports returned adapter errors only when a UI exists. Neither provides durable sync-error history.
- `src/core/adapters/sync.ts` uses per-field three-way comparison, favors local changes on conflict, preserves links in `finally`, and retains rejected updates as pending baseline differences.
- `src/core/adapters/things/index.ts` declares name, description, and completion support. Creation polls for its marker; a timeout can leave an unlinked remote task and cause duplicates later.

## Proposed contract

All surfaces resolve the same project store when their trust, scope, environment, and explicit-file overrides agree. Diagnosis must expose differences rather than silently reconcile them.

Task creation, editing, filtering, default completion results, validation, and claim enforcement must share core semantics. Host schemas and presentation remain separate.

Use one sync schedule: before explicit list/ready operations, after successful mutations, and on explicit sync. Panels, links, diagnosis, and UI refreshes remain local reads.

A saved mutation remains successful when subsequent sync fails. Return its original result with a separate warning; never instruct an agent to repeat a persisted mutation.

Preserve sticky CLI ownership and process-bound Pi/MCP ownership. Agent launchers must supply a unique `DIBS_SESSION` once per agent session and reuse it across CLI calls.

Retain the CLI fallback for compatibility, with guidance that agents sharing `DIBS_AGENT` without distinct sessions share ownership. Do not replace CLI identity with a PID.

## Sequential tasks

### 1. Establish shared boundary tests

- Paths: new `test/cross-agent.test.ts`; extend `test/tools.test.ts`, `test/cli-claims.test.ts`, `test/root.test.ts`, `test/mcp.test.ts`, and `test/extension.test.ts`.
- Decision: test public CLI execution, MCP stdio tools, and registered Pi tools against one isolated project. Reuse existing MCP client and Pi mock patterns.
- Acceptance: CLI creates a task, MCP reads its full ID, Pi completes it, and CLI sees the same completed record without force or duplicate creation.
- Acceptance: root and nested-folder calls across all surfaces select the same durable store under equal settings. Explicit-file and temp-scope differences remain intentional.
- Acceptance: two concurrent sessions using the same agent name and distinct session IDs cannot start or complete each other's live claim without force.
- Acceptance: record current differences for empty description clearing, unresolved `me`, and sync scheduling as failing target cases for task 2. Do not weaken existing tests to hide differences.
- Dependencies: unreleased init/import work. Lead keeps the baseline passing tests separate from new target failures until task 2 resolves them.

### 2. Share operation dispatch and sync outcomes

- Paths: `src/core/tools.ts`, `src/core/identity.ts`, `src/cli/index.ts`, `src/cli/mcp.ts`, `agents/pi/index.ts`; new `test/dispatch.test.ts`; update task 1 tests.
- Decision: extend the existing tools module with a small shared operation runner around `runFile`, store resolution, and `syncAll`. Avoid a backend interface or host registry.
- Keep CLI parsing, MCP schemas, Pi tracking, and rendering at their current boundaries. Pass each host's existing creator and claim identity explicitly.
- Preserve empty strings where they clear editable values; normalize omitted/null tool values separately. Reject unresolved explicit `me` consistently; retain optional default identity lookup for creation.
- Apply the proposed schedule to list/ready, create/edit/start/complete, and import. Export remains local; internal release and sync engine puts must not trigger recursive sync.
- Return operation output plus sync outcomes. Catch both adapter results and thrown sync failures after persistence; do not catch a failed mutation as success.
- CLI prints sync warnings to stderr while successful mutations exit successfully. Explicit `dibs sync` retains failure exit status.
- MCP keeps list output parseable and adds warning text separately without `isError` for a successful mutation. Pi returns warnings even without UI and may also notify its UI.
- Report lock-contention skips as skipped, not synced. No automatic mutation replay or new retry loop; keep Pi's existing serialization and engine locks.
- Acceptance: injected sync failure leaves exactly one saved create and a successful task result on every surface; mutation errors still fail. Warnings are visible in headless Pi and MCP responses.
- Acceptance: list/ready sync before reading, each successful mutation syncs once afterward, and panels/export do not sync. Task 1 target cases pass.
- Dependencies: task 1. Preserve existing `runFile` callers and low-level sync tests.

### 3. Add read-only storage and owner diagnosis

- Paths: `src/core/store.ts`, `src/core/identity.ts`, `src/cli/index.ts`; new `src/core/doctor.ts` and `test/doctor.test.ts`; extend `test/root.test.ts`.
- Decision: add `dibs doctor`, using the existing `--global` and `--json` options only. Share pure path resolution with `storeFile` where necessary; never call its initialization path.
- Report cwd, resolved project root, trust, effective scope, selection reasons, selected config paths, overrides, effective task-file path, and existence without creating missing artifacts.
- Report project ID as absent when absent; never present a newly generated settings UUID as a persisted project identity.
- Show effective owner mode/value and identity source, distinguishing `created_by`, human assignee, and `claimed_by`. Read existing claims and explain sticky versus process liveness.
- Warn when CLI agent ownership falls back to a shared name. Explain unique session setup and intentional force takeover without changing existing claims.
- Show enabled adapters and existing link-file paths. Report last sync error as “not recorded”; add no timestamps, history metadata, or status store.
- Read cached/environment identity only. Do not call `ghUser`, execute commands, contact Things, register projects, rewrite config, acquire write locks, or migrate legacy storage.
- Acceptance: absent home/project, existing project/global/temp/explicit-file stores, nested folders, untrusted roots, and `.pi-do` fallback all produce accurate reports.
- Acceptance: snapshot files before/after diagnosis and assert identical content and directory entries; stub execution to throw if invoked. Malformed config reports its path without repair.
- Dependencies: task 2. An explicit network-check option is deferred; no `doctor --check` in this scope.

### 4. Expose integration capabilities and pending changes

- Paths: `src/core/adapters/sync.ts`, `src/core/adapters/sync-all.ts`, `src/core/adapters/things/index.ts`, `src/core/doctor.ts`; extend `test/sync.test.ts`, `test/sync-skipped.test.ts`, `test/doctor.test.ts`.
- Decision: derive reporting from the existing adapter fields and link baselines. Keep Things as the only implemented todo-app adapter; do not introduce a universal capability framework.
- Doctor reports Things mappings: name to title, description to notes, completion to status. Parent, start time, result, blockers, creator, human, and claims remain local-only.
- Separate unsupported local-only fields from supported updates that remain pending after adapter refusal. Expose pending fields through sync outcomes and read-only link inspection where evidence exists.
- Do not infer successful delivery from a link-file timestamp. If current remote state is required, label it unknown until explicit sync; never fabricate historical failures.
- Acceptance: unsupported fields survive a Things-shaped pull and never leak into create/update payloads. Rejected supported fields remain pending; successful updates clear pending differences.
- Acceptance: a second unchanged sync makes no duplicate tasks or unnecessary updates; a concurrent local edit survives a delayed pull and is pushed on the next sync.
- Acceptance: injected failure after a known remote ID preserves that link. Document the existing Things timeout duplicate risk without claiming this test solves remote creation ambiguity.
- Dependencies: task 3. Reuse fake adapters; no real Things writes in automated tests.

### 5. Publish session and operation guidance

- Paths: `README.md`, `agents/pi/README.md`, `agents/shared/skills/dibs/SKILL.md`; extend `test/cross-agent.test.ts`, `test/cli-claims.test.ts`, `test/mcp.test.ts`, `test/extension.test.ts` only for remaining boundary gaps.
- Decision: document the shared schedule, warning handling, doctor output, unique-session setup, and compatibility fallback. Explain that independent sessions must not reuse the same `DIBS_SESSION`.
- Document sticky CLI claims surviving command exit, process-bound Pi/MCP claims, safe force takeover, and the current PID-reuse limitation. Do not promise MCP shutdown release that is not implemented.
- Acceptance: examples reuse one session value across CLI calls and use different values for simultaneous agents; workflow tests cover both modes without changing legacy claim strings.
- Dependencies: task 4. Lead loads the technical-writing skill before editing guidance and verifies every example against implemented behavior.

## Review gate and exclusions

After every implementation task, run `nub run build` before `nub run test`, because Pi and CLI tests can consume built core files. The lead reviews each worker's exact paths and boundary evidence before continuing.

Final acceptance requires the cross-surface workflow, two-session contention, nested-root selection, sync idempotency, local-edit preservation, and doctor no-write tests. Review warnings separately from operation failures.

Costs: normal CLI reads can contact enabled integrations and take longer; sticky ownership still requires launcher discipline; diagnosis cannot explain unrecorded historical sync failures.

Out of scope: Todoist/Beads adapters, backend frameworks, new config formats, automatic claim rewriting, silent `.pi-do` migration/deletion, and durable sync-error history. Keep the unreleased Dex import behavior intact.
