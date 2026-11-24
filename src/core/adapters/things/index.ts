import type { Ctx } from "../../ctx.ts";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Task } from "../../todo.ts";
import type { Adapter } from "../sync.ts";
import { dibsHome } from "../../store.ts";

// The auth token is a secret: kept in ~/.dibs/adapters/things.json (0600), never in a config.json that may be committed.
const tokenFile = () => join(dibsHome(), "adapters", "things.json");
export function saveThingsToken(token: string): string {
	if (!/^[\w-]+$/.test(token)) throw new Error("Invalid Things auth token");
	mkdirSync(join(dibsHome(), "adapters"), { recursive: true, mode: 0o700 });
	const file = tokenFile(), temp = `${file}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temp, JSON.stringify({ token }) + "\n", { flag: "wx", mode: 0o600 });
		renameSync(temp, file);
	} finally { rmSync(temp, { force: true }); }
	return `Saved Things auth token to ${file}`;
}
export function readThingsToken(): unknown {
	if (process.env.DIBS_THINGS_TOKEN) return process.env.DIBS_THINGS_TOKEN;
	try { return JSON.parse(readFileSync(tokenFile(), "utf8")).token; }
	catch { return undefined; }
}
function token(): string {
	const value = readThingsToken();
	if (typeof value !== "string" || !/^[\w-]+$/.test(value)) throw new Error("Things auth token missing or invalid: run dibs init --connect");
	return value;
}

// Marks a new to-do's notes so the next read can find its Things id (the URL scheme cannot return it to a CLI).
const marker = /\n*\[dibs:([\w-]+)\]\s*$/;
// The URL scheme writes but cannot read, so reads go through Things' AppleScript dictionary (JXA).
// Each dibs project syncs with the Things project of the same name; the name is passed as argv, never spliced into code.
const LIST = `function run([name]) { const p = Application("Things3").projects.whose({ name })(); return p.length ? JSON.stringify(p[0].toDos().map(t => ({ id: t.id(), name: t.name(), notes: t.notes(), status: t.status() }))) : "null"; }`;

export function thingsAdapter(ctx: Ctx, project: string): Adapter {
	if (process.platform !== "darwin") throw new Error("Things adapter needs macOS");
	const open = async (command: string, params: Record<string, string | undefined>) => {
		const query = Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join("&");
		const r = await ctx.exec("open", ["-g", `things:///${command}?${query}`]);
		if (r.code !== 0) throw new Error(r.stderr || `open exited ${r.code}`);
	};
	const read = async () => {
		const r = await ctx.exec("osascript", ["-l", "JavaScript", "-e", LIST, project]);
		if (r.code !== 0) throw new Error(r.stderr || `osascript exited ${r.code}`);
		const data = JSON.parse(r.stdout);
		if (data === null) return null; // project not created yet
		if (!Array.isArray(data)) throw new Error("Invalid Things to-do list");
		return data as { id: string; name: string; notes: string; status: string }[];
	};
	return {
		name: "things",
		fields: ["name", "description", "completed"],
		async list() {
			return ((await read()) ?? []).filter((t) => t.status !== "canceled" && t.name.trim()).map((t) => ({ id: t.id, name: t.name.replace(/[\r\n]+/g, " ").trim(), description: t.notes.replace(marker, "") || undefined, completed: t.status === "completed", started_at: null }));
		},
		async create(task) {
			const auth = token(); // fail before adding, so a missing token can't leave an unlinked to-do
			const key = randomUUID();
			const todo = { title: task.name, notes: `${task.description ?? ""}\n\n[dibs:${key}]`, completed: task.completed || undefined };
			// A missing project is created together with its first to-do in one json call, so the to-do can't land in the Inbox.
			if (await read()) await open("add", { list: project, title: todo.title, notes: todo.notes, completed: task.completed ? "true" : undefined });
			else await open("json", { data: JSON.stringify([{ type: "project", attributes: { title: project, items: [{ type: "to-do", attributes: todo }] } }]) });
			// shortcut: polls up to ~5s for Things to save the new to-do; a slower Things fails this sync and retries later (possible duplicate).
			for (let i = 0; i < 20; i++) {
				const found = ((await read()) ?? []).find((t) => t.notes.match(marker)?.[1] === key);
				if (found) { await open("update", { id: found.id, "auth-token": auth, notes: task.description ?? "" }); return found.id; }
				await new Promise((r) => setTimeout(r, 250));
			}
			throw new Error(`Things did not save "${task.name}"`);
		},
		async update(id, patch) {
			// sync() only sends fields that differ from Things' state, so no re-read here.
			const params = { title: patch.name, notes: "description" in patch ? patch.description ?? "" : undefined, completed: patch.completed === undefined ? undefined : String(patch.completed) };
			if (Object.values(params).every((v) => v === undefined)) return;
			await open("update", { id, "auth-token": token(), ...params });
		},
	};
}
