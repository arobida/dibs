import { expect, test } from "vitest";
import { panel, panelText } from "../src/core/panel.ts";

const t = (id: string, extra: object = {}) => ({ id, name: `task ${id}`, completed: false, started_at: null, blocked_by: [], ...extra }) as any;
const tasks = [t("a"), t("b", { parent: "a", started_at: "x" }), t("c", { completed: true }), t("d")];

test("current view shows touched tasks and their subtasks", () => {
	const p = panel(tasks, "current", new Set(["a"]));
	expect(p.title).toBe("Current tasks (0/2)");
	expect(p.rows.map((r) => [r.id, r.state])).toEqual([["a", "open"], ["b", "started"]]);
});

test("project and completed views, overflow and empty text", () => {
	expect(panel(tasks, "project", new Set()).title).toBe("Project tasks (3 open)");
	expect(panel(tasks, "completed", new Set()).rows[0].state).toBe("done");
	expect(panel(tasks, "project", new Set(), 2).more).toBe(1);
	expect(panelText(panel([], "current", new Set()))).toBe("Current tasks (0/0)\n  No tasks worked on in this session yet");
});
