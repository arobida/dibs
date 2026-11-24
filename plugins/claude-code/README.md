# dibs for Claude Code

This Claude Code plugin ships the shared `dibs` skill. It requires Node 26+; the CLI runs as `npx -y @dibs.ai/dibs`.

## Install

```
/plugin install dibs --marketplace arobida/dibs
```

That needs Claude Code 2.1.275 or later. On older versions, run `/plugin marketplace add arobida/dibs`, then `/plugin install dibs@dibs`. The remote install ships the skill and the MCP tools but not the task panel.

To install from a checkout, with the panel:

```sh
# 1. Build the plugin into dist/claude-code
nub run build:agent claude-code

# 2. Add the local marketplace and install
claude plugin marketplace add ./dist/claude-code
claude plugin install dibs@dibs
```

Verify with `claude plugin validate dist/claude-code`, then restart Claude Code to load the `dibs` skill.

## Tools (MCP)

The plugin registers the MCP server. To add it without the plugin, put this in `.mcp.json`:

```json
{"mcpServers":{"dibs":{"command":"npx","args":["-y","@dibs.ai/dibs","mcp"]}}}
```

## Task panel

A live task panel sits above the prompt. It shows the panel title, then each task as `✓`, `◐` or `○` with its id and name, `+N more` when rows are cut, or an empty-state message. It refreshes at session start, every 3 seconds, and after any `todo_` tool call. The panel reads tasks by calling the plugin's own dibs MCP server with `todo_panel`, a tool that returns the panel as JSON and never syncs adapters. The panel does not run the dibs CLI, `npx`, or a shell. Tasks this session touched are tracked by the full id in each tool reply and passed to `todo_panel` as `mine`. A `tool.offer` hook keeps `todo_panel` from the model, which uses `todo_list`.

Use `/todos` to cycle views, `/todos current|project|completed` to pick one, and `/todos toggle` to collapse or expand the panel.

The panel needs Claude Code 2.1.287 or later. If the dibs MCP server is unavailable or the call fails, the panel is hidden.
