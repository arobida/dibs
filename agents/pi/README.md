# dibs for Pi

The Pi extension gives Pi the dibs task tools, a `/todos` command and a task panel above the editor. Pi loads dibs as a library, so it does not need the CLI.

## Install

```sh
pi install @dibs.ai/pi
```

Run `/reload` in Pi after you edit a `config.json`. The Dex adapter also needs `dex` on your PATH.

## Tools

`todo_list`, `todo_create`, `todo_edit`, `todo_status`, `todo_link` and `todo_resolve`. The task fields they read and write are in the [main README](../../README.md#tasks).

## Task panel

The panel sits above the editor and shows one of three views:

| View | Shows |
|---|---|
| `current` | Tasks worked on in this session. New top-level tasks stay in the project backlog until started |
| `project` | Every open task in the project |
| `completed` | Completed tasks |

The panel reloads when another agent changes the store. `ctrl+shift+v` cycles the view and `ctrl+shift+t` collapses or expands the panel.

## Commands

| Command | Effect |
|---|---|
| `/todos [current\|project\|completed]` | Select a view |
| `/todos export <path> [--global]` | Write todo.txt; does not overwrite an existing file |
| `/todos import <path> [--global]` | Read todo.txt; skips `dibsid:`s already in the store |
| `/todos connect things <token>` | Save the Things 3 token (see the [Things adapter](../../src/core/adapters/things/README.md)) |
| `/todos scope project\|global` | Move the todos and sync folders (see [Storage](../../README.md#storage)) |
| `/todos migrate .dibs\|.agents/dibs` | Move the project store folder |
