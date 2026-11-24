import { existsSync, readFileSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { Ctx } from "../ctx.ts";
import { clean, toTask, type Task } from "../todo.ts";
import { withLock } from "../util.ts";

function sourceConfigured(cwd: string): boolean {
	for (let dir = resolve(cwd); ; dir = dirname(dir)) {
		if (existsSync(join(dir, ".dex", "config.toml"))) return true;
		if (dirname(dir) === dir) break;
	}
	return existsSync(join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "dex", "dex.toml"));
}

export async function readDexTasks(ctx: Ctx): Promise<Task[]> {
	if (!sourceConfigured(ctx.cwd)) throw new Error("Dex is not configured; refusing to import from temporary storage");
	const result = await ctx.exec("dex", ["list", "--all", "--json"], { cwd: ctx.cwd });
	if (result.code !== 0) throw new Error(result.stderr || result.stdout || `dex exited ${result.code}`);
	let data: unknown;
	try { data = JSON.parse(result.stdout); } catch { throw new Error("Invalid Dex task list JSON"); }
	if (!Array.isArray(data)) throw new Error("Invalid Dex task list");
	return validateDexBatch(data);
}

function validateDexBatch(records: any[]): Task[] {
	const tasks = records.map((record) => {
		if (!record || typeof record !== "object" || typeof record.id !== "string" || !record.id || typeof record.name !== "string" || !record.name.trim() || /[\r\n]/.test(record.name) || typeof record.completed !== "boolean") throw new Error("Invalid Dex task");

		const date = typeof record.completed_at === "string" && /^\d{4}-\d{2}-\d{2}/.test(record.completed_at) ? record.completed_at.slice(0, 10) : undefined;
		if (record.completed && !date) throw new Error(`Dex task ${record.id} has no completion date`);
		const task = toTask({ id: record.id, name: record.name, completed: record.completed, created: record.created_at?.slice(0, 10), completed_date: date, started_at: record.started_at ?? null, description: record.description ?? undefined, parent: record.parent_id ?? undefined, blocked_by: record.blockedBy ?? undefined, result: record.result ?? undefined });
		return clean(task);
	});
	validateGraph(tasks);
	return tasks;
}

function validateGraph(tasks: Task[]): void {
	const byId = new Map<string, Task>();
	for (const task of tasks) {
		toTask(task);
		if (byId.has(task.id)) throw new Error(`Duplicate Dex task id: ${task.id}`);
		byId.set(task.id, task);
	}
	for (const kind of ["parent", "blocked_by"] as const) {
		const done = new Set<string>(), active = new Set<string>();
		const visit = (id: string) => {
			if (active.has(id)) throw new Error(`Dex ${kind} cycle at ${id}`);
			if (done.has(id)) return;
			const task = byId.get(id);
			if (!task) throw new Error(`Dex task has missing ${kind} ${id}`);
			active.add(id);
			for (const ref of kind === "parent" ? (task.parent ? [task.parent] : []) : task.blocked_by ?? []) visit(ref);
			active.delete(id); done.add(id);
		};
		for (const task of tasks) visit(task.id);
	}
}

export async function mergeDexTasks(file: string, imported: Task[], base = dirname(dirname(file))): Promise<number> {
	return withLock(file, () => {
		const original = existsSync(file) ? readFileSync(file, "utf8") : "";
		const existing = original.split("\n").filter(Boolean).map((line) => toTask(JSON.parse(line)));
		const linksFile = join(base, "sync", "dex.jsonl");
		const links = new Map<string, string>();
		if (existsSync(linksFile)) for (const line of readFileSync(linksFile, "utf8").split("\n").filter(Boolean)) {
			const link = JSON.parse(line);
			if (typeof link.remote !== "string" || typeof link.local !== "string" || links.has(link.remote)) throw new Error("Invalid legacy Dex link");
			links.set(link.remote, link.local);
		}
		const remap = (id: string) => links.get(id) ?? id;
		const ids = new Set(existing.map((task) => task.id));
		const mapped = imported.map((task) => clean({ ...task, id: remap(task.id), parent: task.parent && remap(task.parent), blocked_by: task.blocked_by?.map(remap) }));
		const added = mapped.filter((task) => !ids.has(task.id));
		validateGraph([...existing, ...added]);
		if (!added.length) return 0;
		mkdirSync(dirname(file), { recursive: true });
		const temp = `${file}.${randomUUID()}.tmp`;
		writeFileSync(temp, original + (original && !original.endsWith("\n") ? "\n" : "") + added.map((task) => JSON.stringify(clean(task)) + "\n").join(""), { mode: 0o600 });
		renameSync(temp, file);
		return added.length;
	});
}
