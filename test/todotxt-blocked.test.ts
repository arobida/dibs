import { expect, test } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkName, parseTodo, todoLine, type Task } from "../src/core/todo.ts";
import { runFile } from "../src/core/tasks.ts";

const base = { started_at: null, completed: false } as const;

test("blocked_by round-trips through todo.txt", () => {
	const task: Task = { ...base, id: "t2", name: "B", blocked_by: ["t1", "t3"] };
	const line = todoLine(task);
	expect(line).toContain("dibsblocked:t1%2Ct3");
	expect(parseTodo(line).blocked_by).toEqual(["t1", "t3"]);
});

test("a task without blockers has no dibsblocked tag", () => {
	expect(todoLine({ ...base, id: "t2", name: "B" })).not.toContain("dibsblocked");
	expect(parseTodo(todoLine({ ...base, id: "t2", name: "B" })).blocked_by).toBeUndefined();
});

test("checkName refuses dibsblocked metadata", () => {
	expect(() => checkName("foo dibsblocked:a")).toThrow("dibsblocked:");
});

test("export then import into a fresh file keeps blocked_by", async () => {
	const dir = mkdtempSync(join(tmpdir(), "todotxt-blocked-"));
	const src = join(dir, "src.jsonl");
	const dst = join(dir, "dst.jsonl");
	writeFileSync(src, [
		{ id: "t1", name: "A", completed: false, started_at: null },
		{ id: "t2", name: "B", completed: false, started_at: null, blocked_by: ["t1"] },
	].map((r) => JSON.stringify(r) + "\n").join(""));
	const { text } = JSON.parse(await runFile(src, ["export"]) as string);
	writeFileSync(dst, "");
	expect(await runFile(dst, ["import", text])).toBe("Imported 2 tasks");
	const tasks = readFileSync(dst, "utf8").trim().split("\n").map((l) => JSON.parse(l));
	expect(tasks.find((t) => t.id === "t2").blocked_by).toEqual(["t1"]);
});
