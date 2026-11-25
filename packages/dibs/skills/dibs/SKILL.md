---
name: dibs
description: Use when tracking multi-step work, todos, or task lists in this project with the dibs CLI, including breaking a task into subtasks, checking what is unblocked, and marking work started or done.
---

# dibs

Track work as tasks with the `dibs` CLI. Use it for any multi-step job, so progress survives the session.

## When to use

- The request has several steps, or you are about to split work into subtasks.
- You need to know what is next, or what is blocked.
- You finish a unit of work and should record the result.

## Init and doctor

Run `dibs init` for empty durable storage, or `dibs init --from dex` for a one-time Dex import. Before selecting `--adapter things` or `--adapter none`, ask the user whether to enable Things. Noninteractive init leaves the choice pending until you rerun with their answer.

Ask for installation consent before `dibs init --agent <host> --install-agent`. Supported hosts are `pi`, `claude-code`, `codex`, `opencode`, and `cursor`; use `--agent` when detection is unavailable. Pi and Claude setup changes user configuration; Codex changes user MCP configuration and a project skill. Cursor and OpenCode setup writes project skill/MCP files only.

For enabled Things, use `dibs init --connect` after consent. Have the user enter the token through hidden TTY input or set `DIBS_THINGS_TOKEN` privately. Never ask for secrets in chat or pass them as CLI arguments. The read probe does not sync or authenticate the token for writes.

Init runs doctor automatically. Use `dibs doctor --json` for standalone read-only checks without commands, external contacts, locks, or writes. Init errors leave saved state intact; pending setup can exit 0, so inspect `connection`, `agentSetup`, `doctor`, and their instructions in `init --json` output.

After reload/restart, inspect your tool inventory for `todo_list`, `todo_create`, `todo_edit`, `todo_status`, `todo_link`, and `todo_resolve` without invoking task tools or syncing. Report missing tools as unverified setup. Configuration evidence and installed packages do not prove tools loaded in this session. See the [setup reference](https://github.com/arobida/dibs#init-and-doctor).

## Commands

```sh
dibs create "Write parser tests" --description "Cover empty input, nested blocks, and CRLF line endings"
dibs create "Wire CLI flag" --parent a1b2 --blocked-by c3d4,e5f6
dibs list --query parser
dibs ready
dibs start a1b2
dibs complete a1b2 --result "Parser tests added; 3 edge-case bugs fixed"
dibs edit a1b2 --description "Updated scope: include BOM handling"
dibs edit a1b2 --blocked-by c3d4
dibs list --human me   # tasks for the human in the loop; `create` defaults --human to that user, and `--human <user>` overrides
dibs import plan.txt
dibs export tasks.txt
dibs link a1b2
dibs resolve dibs://<project-id>/<task-id>   # a link from `dibs link`
dibs scope global
dibs migrate .agents/dibs
dibs sync
```

If Things sync is enabled in config, run `dibs sync` before reading tasks and after finishing work.

## Rules

- Prefix every command with `DIBS_AGENT=<your agent name>` (e.g. `DIBS_AGENT=claude-code dibs create ...`) so tasks record who created them.
- If `dibs` is not on your PATH, run `npx -y @dibs.ai/dibs` in its place (e.g. `npx -y @dibs.ai/dibs list`).
- Ids accept a unique prefix: `dibs start a1b` works when only one id starts with `a1b`.
- Keep the name short. Put details, context, and acceptance criteria in `--description`.
- Run `start` before you begin a task. A started task stays claimed until `complete`. `start` refuses a task while any of its blockers is open. `--force` overrides another agent's claim or an open block, and only the session that created the task may use it. If you didn't create the task, report the claim or block and stop.
- Run `complete --result "..."` when the task is done. The result states what changed, in one line.
- `ready` lists unblocked work. Pick from it before starting anything else.
- `list` and `ready` print one line per task. Add `--json` for machine-readable output.
- `--global` writes to the global store instead of the project store. Use it only for tasks that span projects.

## Trust and storage

- A project is the nearest folder, from the current folder upward, that has a `.dibs/` or `.agents/dibs/` folder. dibs works from any subfolder of the project.
- A project is trusted when `DIBS_TRUST=1` is set, or when it has such a folder.
- Trusted projects store tasks in the project. Untrusted projects use a temporary session store, which the CLI never writes into the repo.
- `DIBS_SESSION` names the CLI claim owner (`cli:<DIBS_SESSION>`) and keys the temp store, which otherwise uses the current folder.
