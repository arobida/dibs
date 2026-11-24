import type { Task } from "./todo.ts";

// The task panel's content, shared by every agent UI (Pi widget, Claude Code mod, opencode plugin).
export const views = ["current", "project", "completed"] as const;
export type View = (typeof views)[number];
export type Row = { id: string; name: string; state: "done" | "started" | "open" };
export type Panel = { title: string; rows: Row[]; more: number; empty: string | null };

// Current = tasks this session touched plus their subtasks from anywhere; unrelated new tasks stay in Project.
export function shown(tasks: Task[], view: View, mine: Set<string>): Task[] {
	if (view === "completed") return tasks.filter((t) => t.completed);
	if (view === "project") return tasks.filter((t) => !t.completed);
	const byId = new Map(tasks.map((t) => [t.id, t]));
	const memo = new Map<string, boolean>();
	const current = (t: Task | undefined, depth = 0): boolean => {
		if (!t || depth >= 50) return false;
		if (!memo.has(t.id)) memo.set(t.id, mine.has(t.id) || current(t.parent ? byId.get(t.parent) : undefined, depth + 1));
		return memo.get(t.id)!;
	};
	return tasks.filter((t) => current(t));
}

export function panel(tasks: Task[], view: View, mine: Set<string>, max = 11): Panel {
	const list = shown(tasks, view, mine);
	const done = list.filter((t) => t.completed).length;
	const label = { current: "Current", project: "Project", completed: "Completed" }[view];
	const count = view === "project" ? `${list.length} open` : view === "completed" ? `${list.length}` : `${done}/${list.length}`;
	return {
		title: `${label} tasks (${count})`,
		rows: list.slice(0, max).map((t) => ({ id: t.id, name: t.name.replace(/\s+/g, " ").trim(), state: t.completed ? "done" : t.started_at ? "started" : "open" })),
		more: Math.max(0, list.length - max),
		empty: list.length ? null : view === "current" ? "No tasks worked on in this session yet" : "None",
	};
}

export const glyph = { done: "✓", started: "◐", open: "○" } as const;

// Plain-text form, for status lines and terminals without a widget API.
export const panelText = (p: Panel) => [p.title, ...(p.empty ? [`  ${p.empty}`] : p.rows.map((r) => `  ${glyph[r.state]} #${r.id} ${r.name}`)), ...(p.more ? [`  +${p.more} more`] : [])].join("\n");
