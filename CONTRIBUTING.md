# Contributing to dibs

Issues and pull requests are welcome. Keep changes small and covered by tests.

## Tech stack

- TypeScript (ESM). Pi loads `agents/pi/index.ts` directly, and that file imports core from `lib/`, which `nub run build` writes.
- Node 26+ and [Nub](https://nubjs.com/docs) for development, tests, and packaging.
- Peer dependencies: `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, `typebox`.

## Project structure

```
agents/pi/index.ts      Extension entry point: tools, /todos command, shortcuts, panel, watcher
src/core/todo.ts        Task type and todo.txt line parse/format/validation
src/core/store.ts       Settings, scopes, store paths, project registry, migrate/scope moves
src/core/identity.ts    Agent name and GitHub user resolution
src/core/util.ts        Shared helpers: ~ expansion, file lock, JSONL reader
src/core/tasks.ts       Actions on the dibs JSONL todos file (the one store)
src/core/panel.ts       Task panel views shared by the agents
src/core/tools.ts       Task tool params to store actions, shared by the MCP server and Pi
src/core/ctx.ts         Ctx: host-neutral cwd/trust/session/exec
src/cli/index.ts        dibs CLI
src/cli/mcp.ts          dibs mcp: task tools over MCP (stdio)
agents/shared/          Shared skills/hooks; agents/<name>/ overrides same paths
agents/<name>/          Per-agent integration (pi, claude-code, codex, opencode, cursor)
scripts/build-agent.ts  Builds dist/<name> = shared + agent overrides
src/core/adapters/sync.ts    Adapter interface and 3-way two-way sync engine
src/core/adapters/sync-all.ts  Syncs every adapter enabled in config
src/core/adapters/dex/       Dex adapter: CLI calls, Dex-to-Task mapping, watch folders
src/core/adapters/things/    Things 3 adapter: URL scheme writes, JXA reads, auth token file
test/*.test.ts          Vitest test suite
CHANGELOG.md            Release notes
```

## Local development

Install Nub with `npm install -g @nubjs/nub` (see https://nubjs.com/docs), then:

```sh
nub install
nub run test
nub run pack:check
pi install "$PWD/agents/pi"
```

`nub install` builds `lib/` through the `prepare` script. Run `nub run build` after editing `src/`.

Run `/reload` in Pi after source changes. Pi loads `agents/pi/index.ts` directly. Install this package once, and remove any standalone `dex-panel.ts` copy first.

Generate a codebase summary for agents with `nubx repomix --ignore "node_modules/**,nub.lock"` (repomix is not installed globally). Delete `repomix-output.xml` when done.

The package is MIT licensed (see `LICENSE`), and contributions fall under the same license.

## Releasing

```sh
nub run bump <patch|minor|major|x.y.z> [. | agents/pi | agents/opencode]
```

The package directory defaults to `.`. [`scripts/bump.ts`](scripts/bump.ts) requires a clean tree, runs the tests, bumps `package.json` and `jsr.json`, commits `Release <name>@<version>`, tags `<name>@<version>`, pushes, and runs [`scripts/release.ts`](scripts/release.ts). That publishes the package to npm, and the core package to JSR too; run `nub login` first. If publishing fails, fix the cause and run `nub run release`: it skips versions already live and fails loudly on any that did not publish.

JSR has no stored login. Save a JSR token in the macOS Keychain once with `security add-generic-password -U -a "$USER" -s jsr-token -w`, then run `nub run release --jsr` to publish with it. `JSR_TOKEN=<token> nub run release` works too.

Configs point `$schema` at `https://raw.githubusercontent.com/arobida/dibs/@dibs.ai/dibs@<version>/schema.json` ([`src/core/store.ts`](src/core/store.ts)), the core package's release tag, so that URL returns 404 until the tag is pushed.

## Documentation

User docs start at the [README](README.md). Load the `technical-writing` skill before editing any of them. `docs/` holds internal plans, ideas and research.
