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

A live task panel (views `current`/`project`/`completed`, like the Pi panel) shown above the prompt. It is a TUI-only plugin, so add it to `cli.json` (docs: https://opencode.ai/docs/cli/plugins):

```json
{ "plugins": ["/absolute/path/to/dibs/agents/opencode/plugin/tui.tsx"] }
```

Local plugin entries are documented as directories or package names; if the file path is rejected, point at `/absolute/path/to/dibs/agents/opencode` (its `package.json` exports `./tui`). Install peers there first: `cd agents/opencode && nub add @opencode/plugin @opentui/core @opentui/solid solid-js`.

Keys: `ctrl+shift+v` cycles the view, `ctrl+shift+t` collapses (also `/tasks-view`, `/tasks-toggle`, and the command palette). The panel refreshes every 3 s and after any event mentioning a `todo_*` tool. It runs `dibs` when it is on your PATH and falls back to `npx -y @dibs.ai/dibs`. Not verified against a running opencode.
