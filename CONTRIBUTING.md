# Contributing to dibs

Issues and pull requests are welcome. Keep changes small and covered by tests.

## Tech stack

- TypeScript (ESM). Pi loads `plugins/pi/index.ts` directly, and that file imports core from `packages/dibs/lib/`, which `nub run build` writes.
- Node 26+ and [Nub](https://nubjs.com/docs) for development, tests, and packaging.
- Peer dependencies: `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, `typebox`.

## Project structure

```
plugins/pi/index.ts      Extension entry point: tools, /todos command, shortcuts, panel, watcher
packages/dibs/src/core/todo.ts        Task type and todo.txt line parse/format/validation
packages/dibs/src/core/store.ts       Settings, scopes, store paths, project registry, migrate/scope moves
packages/dibs/src/core/identity.ts    Agent name and GitHub user resolution
packages/dibs/src/core/init-adapter.ts   Consent-based project adapter selection
packages/dibs/src/core/init-connection.ts  Private Things credentials and read-only connection probe
packages/dibs/src/core/init-agent.ts     Consent-based host installation and configuration
packages/dibs/src/core/agent-verification.ts  Host detection and configuration evidence
packages/dibs/src/core/doctor.ts      Read-only installation, storage, and identity checks
packages/dibs/src/core/util.ts        Shared helpers: ~ expansion, file lock, JSONL reader
packages/dibs/src/core/tasks.ts       Actions on the dibs JSONL todos file (the one store)
packages/dibs/src/core/panel.ts       Task panel views shared by the agents
packages/dibs/src/core/tools.ts       Task tool params to store actions, shared by the MCP server and Pi
packages/dibs/src/core/ctx.ts         Ctx: host-neutral cwd/trust/session/exec
packages/dibs/src/cli/index.ts        dibs CLI
packages/dibs/src/cli/mcp.ts          dibs mcp: task tools over MCP (stdio)
packages/dibs/skills/     Shared skill; plugins/<name>/ overrides same paths
plugins/<name>/          Per-agent integration (pi, claude-code, codex, opencode, cursor)
scripts/build-agent.ts  Builds dist/<name> = shared + agent overrides
packages/dibs/src/core/adapters/sync.ts    Adapter interface and 3-way two-way sync engine
packages/dibs/src/core/adapters/sync-all.ts  Syncs every adapter enabled in config
packages/dibs/src/core/imports/dex.ts     One-time read-only Dex import, validation and merge
packages/dibs/src/core/adapters/things/    Things 3 adapter: URL scheme writes, JXA reads, auth token file
packages/dibs/test/*.test.ts          Vitest test suite
CHANGELOG.md            Release notes
```

## Local development

Install Nub with `npm install -g @nubjs/nub` (see https://nubjs.com/docs), then:

```sh
nub install
nub run test
nub run pack:check
pi install "$PWD/plugins/pi"
```

`nub install` builds `packages/dibs/lib/` through the `prepare` script. Run `nub run build` after editing `packages/dibs/src/`.

Run `/reload` in Pi after source changes. Pi loads `plugins/pi/index.ts` directly. Install this package once, and remove any standalone `dex-panel.ts` copy first.

Generate a codebase summary for agents with `nubx repomix --ignore "node_modules/**,nub.lock"` (repomix is not installed globally). Delete `repomix-output.xml` when done.

The package is MIT licensed (see `LICENSE`), and contributions fall under the same license.

## UI tests

`nub run test:ui` builds the core and the Claude Code plugin, then runs `packages/dibs/test/e2e/panel.lua` with `rex do`. The script opens a throwaway Rex session. For Pi, Claude Code and opencode, it starts the agent with this checkout's plugin, checks that the task panel shows, switches to the project view, and checks that a task added from the CLI appears. The test sends no prompts, so it uses no model tokens.

`nub run test:ui` is not part of `nub run test`. It needs:

- Rex. Run the test from a Rex terminal.
- `pi`, `claude` and `opencode` on `PATH`, each signed in.

Claude Code loads plugin modules only in a trusted folder. Trust the test folder once:

```sh
mkdir -p ~/.cache/dibs-ui/claude && cd ~/.cache/dibs-ui/claude && claude
```

Accept the trust prompt, then run `/exit`.

To test one agent, run `rex do packages/dibs/test/e2e/panel.lua agent=pi|claude|opencode`. Runs share the Claude Code folder, so a second run started during the first stops with a lock error.

## Releasing

All three packages (`@dibs.ai/dibs`, `@dibs.ai/pi`, `@dibs.ai/opencode`) share one version, and each release is a repo tag `v<version>`. Run `nub login` first.

```sh
nub run bump dev                        # prerelease X.Y.Z-dev.N from any branch, npm dist-tag "dev"
nub run bump <patch|minor|major|x.y.z>  # stable release from main, npm dist-tag "latest"
```

Test a dev release with `npm install @dibs.ai/dibs@dev` (or `@dibs.ai/pi@dev`, `@dibs.ai/opencode@dev`). A dev release never moves `latest`. JSR has no dist-tags, so core dev versions go to JSR as prereleases, which JSR does not pick for an unpinned import.

[`scripts/bump.ts`](scripts/bump.ts) requires a clean tree; a stable bump also requires being on `main` in sync with `origin/main`. It runs type checks, tests and build, writes the new version to every `package.json` and `jsr.json`, commits, tags `v<version>`, atomically pushes the commit and tag to `origin`, and runs [`scripts/release.ts`](scripts/release.ts). Core is published first, then the agent packages; core also goes to JSR.

If publishing fails, stay on the release commit and run `nub run release`. It requires a clean tree, matching versions in every package, and a `v<version>` tag that points to HEAD and matches `origin`; a stable version must also be the tip of `origin/main`. It skips registry versions already live. A failed push can be retried with `git push --atomic origin HEAD refs/tags/v<version>` before running the release command.

JSR has no stored login. Save a JSR token in the macOS Keychain with `security add-generic-password -U -a "$USER" -s jsr-token -w`; `bump` reads it from there. `JSR_TOKEN` overrides the Keychain. To retry a release by hand, run `nub run release --jsr`.

Configs point `$schema` at `https://raw.githubusercontent.com/arobida/dibs/v<version>/packages/dibs/schema.json` ([`packages/dibs/src/core/store.ts`](packages/dibs/src/core/store.ts)), the release tag, so that URL returns 404 until the tag is pushed.

## Documentation

User docs start at the [README](README.md). Load the `technical-writing` skill before editing any of them. `docs/` holds internal plans, ideas and research.
