# dibs for Cursor

Cursor reads `SKILL.md` skills from `.cursor/skills/` (project) or `~/.cursor/skills/` (user), so it uses the shared skill unchanged. The skill runs the CLI as `npx -y @dibs.ai/dibs` when `dibs` is not on your PATH.

## Install

From the dibs repo:

```sh
nub run build:agent cursor
```

Project install (run in your project root):

```sh
mkdir -p .cursor/skills && cp -R /path/to/dibs/dist/cursor/skills/dibs .cursor/skills/
```

User-wide install:

```sh
mkdir -p ~/.cursor/skills && cp -R /path/to/dibs/dist/cursor/skills/dibs ~/.cursor/skills/
```

Restart Cursor, then look for `dibs` under Customize -> Skills. You can also run `/dibs` in chat.

Docs: https://cursor.com/docs/context/skills

## Tools (MCP)

The MCP server runs the CLI through `npx -y`. Add this to `.cursor/mcp.json`:

```json
{"mcpServers":{"dibs":{"command":"npx","args":["-y","@dibs.ai/dibs","mcp"]}}}
```
