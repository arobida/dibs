# dibs for opencode

opencode loads skills from `skills/<id>/SKILL.md`, so it uses the shared `dibs` skill unchanged. The skill calls the CLI, which runs as `npx -y @dibs.ai/dibs` if `dibs` is not on your PATH.

## Install

```sh
nub run build:agent opencode        # writes dist/opencode/skills/dibs/SKILL.md

# project-local
mkdir -p .opencode/skills && cp -R dist/opencode/skills/dibs .opencode/skills/

# or global
mkdir -p ~/.config/opencode/skills && cp -R dist/opencode/skills/dibs ~/.config/opencode/skills/
```

Use `ln -s "$PWD/dist/opencode/skills/dibs" <target>/dibs` instead of `cp -R` to follow rebuilds.

To check, start opencode in the project and ask it to load the `dibs` skill, or type `@dibs`. The command `opencode debug skill` does not exist in v2.3.0.

Docs: https://opencode.ai/docs/skills/ (opencode also scans `.claude/skills` and `.agents/skills`).

## Tools (MCP)

The MCP server runs the CLI through `npx -y`. Add this to `opencode.json`:

```json
{"mcp":{"dibs":{"type":"local","command":["npx","-y","@dibs.ai/dibs","mcp"]}}}
```

## Task panel

A live task panel (views `current`/`project`/`completed`, like the Pi panel) appears above the prompt in a session view. It does not show on the start screen. The panel refreshes every 3 seconds.

The panel is a TUI-only plugin, so add it to `cli.json` (docs: https://opencode.ai/docs/cli/plugins):

```json
{ "plugins": ["/absolute/path/to/dibs/plugins/opencode"] }
```

opencode 2.3.2 loads the directory entry (its `package.json` exports `./tui`) and ignores a path to `plugin/tui.tsx`. From a checkout, run `nub install` at the repo root, which links the `@dibs.ai/dibs` dependency, then install the peers: `cd plugins/opencode && nub add @opencode/plugin @opentui/core @opentui/solid solid-js`.

Keys: `ctrl+shift+v` cycles the view, `ctrl+shift+t` collapses (also `/tasks-view`, `/tasks-toggle`, and the command palette). The panel also refreshes after any event mentioning a `todo_*` tool. It reads the store in-process with the dibs core (`@dibs.ai/dibs`, a dependency in `plugins/opencode/package.json`), using the same trust rules as the CLI: `DIBS_TRUST=1` or a folder with `.dibs/`. It does not run `dibs` or `npx`. `nub run test:ui` checks the panel, `/tasks-view` and the refresh on opencode 2.3.2; the `ctrl+shift` keys are not tested.
