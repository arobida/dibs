# Plan: fix the issues the Rex UI test found

Status: done. Task 5 found no bug: after a mid-session trust, the panel shows and `/todos` switches and collapses it (debug log: `/todos listed`, `command.run` answered, `todo_panel` reply matching the project view). Tasks 1 to 4 shipped, then task 1 was replaced: the panels now use each host's own API instead of a CLI process (see "Panels use host APIs"). `nub run test:ui` passes for Pi, Claude Code and opencode. Revised after an adversarial review by Codex (verdicts below).

## Findings

| # | Finding | Evidence | Severity |
|---|---|---|---|
| 1 | With the dibs plugin, Claude Code exits with status 0 right after startup in a trusted folder when `$SHELL` is zsh and its startup files take about a second. `userPath` (`agents/claude-code/hooks/register.tsx:22`) starts `$SHELL -lic`. With job control on, that zsh moves into its own process group and makes it the terminal's foreground group, so Claude Code is a background job for as long as zsh runs. | In a trusted folder: `claude` alone stays up; with `--plugin-dir dist/claude-code` it exits 0. A `.zshrc` holding only `sleep 1`, or a 1 s builtin loop, reproduces it; `sleep 0.1`, `/usr/bin/true` and an empty `.zshrc` do not. In the user's config, `conf.d/20-styles.zsh`, `28-compinit.zsh` and `30-tools.zsh` each push startup past that point on their own. A terminal probe: during `zsh -f -ic 'sleep 2'` the foreground group is zsh's own; under `zsh -f +m -ic` zsh stays in its parent's group. `+m -lic` and `-lc` both stay up and pass the whole UI test. | Critical: zsh users with a slow startup lose Claude Code. |
| 2 | `zsh +m -lic` returns the same PATH as `-lic` (45 entries); `-lc` drops entries from `.zshrc` (44). bash accepts `+m`. fish, tcsh and nu reject `+m`. tcsh already rejects `-lic` (prints its usage), so `userPath` already returns nothing for tcsh today. | Shell checks on this machine; tcsh and nu from the Codex review, tcsh confirmed. | Shapes the fix for 1. |
| 3 | `userPath` has no time limit of its own (`$.process.run` defaults to 30 s), its stdin is not closed, and it sits outside `refresh`'s `try`, while `session.start` awaits `refresh` before `next(e)`. A slow or prompting rc file delays session start up to 30 s, and a timeout rejects out of the hook. | `register.tsx:22,31,58`; `ProcessRunInit` in the plugin types: `timeoutMs` (30 s default), `stdin`. | Medium. |
| 4 | The opencode README's main instruction, a `cli.json` plugin entry with the path to `plugin/tui.tsx`, does not load the plugin on opencode 2.3.2. The directory `agents/opencode` does. | File path: `/tasks` lists no `/tasks-view`. Directory: `/tasks-view` and `/tasks-toggle` appear and the test passes. | Docs: users following the README get no panel. |
| 5 | The test skips opencode's live-reload check (`live = false`), but the panel polls every 3 s (`tui.tsx`) and passes it. | Run with `live = true`: `ok opencode`. | Test gap. |
| 6 | The test reads PATH from `$SHELL -ic` (`panel.lua:18`): it inherits the shell problems of finding 2, and a CLI-driven panel could run a globally installed `dibs` ahead of the shim (Claude Code's `userPath` rebuilds PATH from rc files), so a pass would not prove the checkout ran. | `panel.lua:18,105`; `register.tsx:22`. | Test reliability. |
| 7 | Unverified: after a user accepts the trust prompt mid-session, the panel may never appear, because plugin modules load after trust ("hooks modules not loaded until workspace trust is accepted") and `session.start` does the first refresh, starts the poll and registers `/todos`. | One observation, made while finding 1 was also present. | Unknown until checked. |

## Decisions

- **Change only the shells that need it (findings 1, 2).** zsh and bash: `$SHELL +m -lic`, which turns off job control and still loads rc files, so PATH matches `-lic`. Every other shell keeps today's `-lic`: fish, dash and bash were verified unaffected, and tcsh never worked. Choose by the basename of `$SHELL` inside the existing `/bin/sh -c` string.
- **Bound PATH discovery (finding 3).** `timeoutMs: 5000` and `stdin: ""`; move the call inside `refresh`'s `try`. Accept the result only when it starts with `/` (nu prints a literal `$PATH`); otherwise use the inherited PATH, as `refresh` already does for an empty result.
- **The test uses its own PATH (finding 6).** `rex do` runs from the user's terminal, so `os.getenv("PATH")` already holds the interactive PATH. The shim appends one line to `$DIR/shim.log` per call; for Claude Code and opencode the test fails when that log is empty.
- **Finding 7 needs a check before code.** Checking it means accepting a trust prompt for a new folder, which writes to `~/.claude.json`, so the user runs it. If the panel is missing, initialization (command registration, first refresh, poll) runs from the first `ui.render` too, behind one guard so it runs once.
- **Rejected: a shell fixture suite** (Codex finding 8). The manual matrix in finding 1 is the record; the real-terminal test is the regression check. `register.tsx` imports the `claude-code` runtime, which vitest cannot load.

## Panels use host APIs

Task 1's `+m` fix kept a design no host asks for: a UI plugin that starts the user's shell and the dibs CLI. Pi's panel never had the bug because it imports the dibs core in-process, as [rpiv-todo](https://pi.dev/packages/@juicesharp/rpiv-todo) does. The other two panels now follow the same rule, through what each host offers:

| Host | Panel reads tasks through | Why |
|---|---|---|
| Pi | the dibs core, imported in-process; `fs.watch` on the store | Pi extensions run in Pi's Node process. |
| Claude Code | `$.mcp.call` to the plugin's own MCP server, tool `todo_panel` (no adapter sync); a `tool.offer` hook keeps it from the model | Mods run without Node and can import only their own files; the MCP server is the dibs core in Node, already connected by the engine. |
| opencode | the dibs core, imported in the TUI plugin (`@dibs.ai/dibs` dependency) | TUI plugins run in opencode's runtime and can import packages. |

This removes `userPath`, the npx fallback and the launcher choice, so findings 1 to 3 no longer apply. The test points the copied Claude Code plugin's `.mcp.json` at the shim, so `shim.log` proves the panel used this checkout. Not verified: that the model's tool list omits `todo_panel`.

## Tasks

| # | Finding | Task | Files | Model | Done when |
|---|---|---|---|---|---|
| 1 | 1, 2, 3 | Per the first two decisions. One comment line: without `+m`, interactive zsh takes the terminal's foreground group and Claude Code exits. | `agents/claude-code/hooks/register.tsx` | Haiku | `nub run build:agent claude-code && rex do test/e2e/panel.lua agent=claude` prints `ok claude`; the lead repeats the `SHELL` matrix (zsh, bash, dash, fish) and each shows the panel. |
| 2 | 5, 6 | Opencode `live = true`; PATH from `os.getenv("PATH")`, delete `user_path` and its comment; shim log and the empty-log check; a `mkdir` lock on `~/.cache/dibs-ui/claude.lock`, released on every exit path, so two runs cannot delete each other's folder. | `test/e2e/panel.lua` | Haiku | `nub run test:ui` prints `ok` for all three. A second run started during the first fails fast with a lock message. |
| 3 | 4 | README task panel section: the `cli.json` entry is the `agents/opencode` directory; remove the file-path example and the "if the file path is rejected" fallback; keep the peer install step; name opencode 2.3.2 as tested. | `agents/opencode/README.md` | Haiku | Lead review; the entry matches `test/e2e/panel.lua`. |
| 4 | docs | CONTRIBUTING: a "UI tests" section: `nub run test:ui`, needs Rex and signed-in `pi`, `claude`, `opencode`; trust `~/.cache/dibs-ui/claude` once. CHANGELOG: the Claude Code startup fix. | `CONTRIBUTING.md`, `CHANGELOG.md` | Haiku | Lead review against the technical-writing skill. |
| 5 | 7 | User check: `mkdir /tmp/dibs-trust-check && cd /tmp/dibs-trust-check && claude --plugin-dir <repo>/dist/claude-code`, accept trust, wait 10 s, run `/todos project` and `/todos toggle`. Code change only if something is missing. | `agents/claude-code/hooks/register.tsx` (only if needed) | Haiku | The panel shows within 5 s of accepting trust, and `/todos` switches and collapses it. |

## Order

Tasks 1 to 4 touch different files and run in parallel. Task 5 waits for task 1, since finding 1 hides finding 7.

## Review verdicts

Codex (read-only, `codex exec`) raised 10 findings against the first draft. Each was checked:

| # | Codex finding | Verdict | Check |
|---|---|---|---|
| 1 | `+m` breaks tcsh and nu | Accepted, narrowed | tcsh already fails `-lic`; `+m` now applies to zsh and bash only. |
| 2 | `fish -lc` skips interactive-only PATH | Accepted, resolved differently | `fish -lic` does not kill Claude Code, so fish keeps `-lic`. |
| 3 | The test's own `$SHELL -ic` | Accepted | Use `os.getenv("PATH")`. |
| 4 | Recovery from `ui.render` would leave `/todos` unregistered | Accepted | Task 5 runs all of `session.start`'s setup and checks `/todos`. |
| 5 | Root cause overstated | Accepted, then measured | A bisect of the user's config and minimal `.zshrc` files show the trigger is startup time, not any one command; a terminal probe shows zsh taking the foreground process group without `+m`. Finding 1 rewritten. |
| 6 | Unbounded shell startup | Accepted | `timeoutMs` and `stdin` exist on `$.process.run`; finding 3 added. |
| 7 | Test may exercise an installed `dibs` | Accepted | Shim log check. No global `dibs` is installed here, so current passes are valid. |
| 8 | Shell fixture tests | Rejected | See decisions. |
| 9 | Concurrent runs share the Claude Code folder | Accepted | `mkdir` lock. |
| 10 | README validation too weak | Partly accepted | Keep the peer step, name the version; no clean-install run. |
