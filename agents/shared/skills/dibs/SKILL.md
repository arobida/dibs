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

If Dex or Things sync is enabled in config, run `dibs sync` before reading tasks and after finishing work.

## Rules

- Prefix every command with `DIBS_AGENT=<your agent name>` (e.g. `DIBS_AGENT=claude-code dibs create ...`) so tasks record who created them.
- If `dibs` is not on your PATH, run `npx -y @dibs.ai/dibs` in its place (e.g. `npx -y @dibs.ai/dibs list`).
- Ids accept a unique prefix: `dibs start a1b` works when only one id starts with `a1b`.
- Keep the name short. Put details, context, and acceptance criteria in `--description`.
- Run `start` before you begin a task. A started task stays claimed until `complete`. `--force` takes over a task another agent holds; use it only when that agent is gone.
- Run `complete --result "..."` when the task is done. The result states what changed, in one line.
- `ready` lists unblocked work. Pick from it before starting anything else.
- `list` and `ready` print one line per task. Add `--json` for machine-readable output.
- `--global` writes to the global store instead of the project store. Use it only for tasks that span projects.

## Trust and storage

- A project is the nearest folder, from the current folder upward, that has a `.dibs/` or `.agents/dibs/` folder. dibs works from any subfolder of the project.
- A project is trusted when `DIBS_TRUST=1` is set, or when it has such a folder.
- Trusted projects store tasks in the project. Untrusted projects use a temporary session store, which the CLI never writes into the repo.
- `DIBS_SESSION` names the CLI claim owner (`cli:<DIBS_SESSION>`) and keys the temp store, which otherwise uses the current folder.
