import { join } from "node:path";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { type Task, toTask } from "../todo.ts";
import { randomUUID } from "node:crypto";
import { readJsonl, withLock } from "../util.ts";
import { ParentError, runFile } from "../tasks.ts";

// An external todo app. Tasks use dibs's shape; ids are the app's own.
export interface Adapter {
	name: string;
	// Fields the app can hold; others are neither pushed nor pulled. Default: all.
	fields?: readonly (typeof fields)[number][];
	list(): Promise<Task[]>;
	create(task: Task): Promise<string>;
	// Returns the fields it could not apply; sync keeps those as pending local changes.
	update(id: string, patch: Partial<Task>): Promise<string[] | void>;
}

// Each link remembers both ids and the task as of the last sync, so a 3-way compare tells which side changed.
interface Link { local: string; remote: string; base: Task }
const toLink = (r: Record<string, unknown>): Link => {
	if (typeof r.local !== "string" || typeof r.remote !== "string") throw new Error("bad link ids");
	return { local: r.local, remote: r.remote, base: toTask(r.base) };
};
const fields = ["name", "description", "completed", "started_at", "result", "parent"] as const;

// Two-way sync of the dibs todos file with one adapter. Per field: only one side changed -> copy it; both -> dibs wins.
// With `human`, only tasks whose human matches take part; the rest are left untouched.
// Deletions are never propagated: a task missing on one side just stays unlinked.
export async function sync(file: string, base: string, adapter: Adapter, human?: string): Promise<"skipped" | void> {
	const linksFile = join(base, "sync", `${adapter.name}.jsonl`);
	mkdirSync(join(base, "sync"), { recursive: true });
	return withLock(linksFile, async () => {
	const links = readJsonl(linksFile, toLink);
	// Links are saved even if a later step throws, so created tasks are never duplicated next sync.
	try {
	const local: Task[] = JSON.parse(await runFile(file, ["list"])).filter((t: Task) => human === undefined || t.human === human);
	const remote = await adapter.list();
	const byLocal = new Map(local.map((t) => [t.id, t])), byRemote = new Map(remote.map((t) => [t.id, t]));
	const toRemote = new Map(links.map((l) => [l.local, l.remote])), toLocal = new Map(links.map((l) => [l.remote, l.local]));
	const norm = (t: Task): Task => ({ id: t.id, name: t.name, completed: t.completed, started_at: t.started_at ?? null, description: t.description || undefined, parent: t.parent || undefined, result: t.result || undefined });
	// A rejected parent is cleared ("" overrides the stored value) so one bad link doesn't abort the sync. Returns the saved record.
	const put = async (t: Task, expect?: object): Promise<Task> => {
		const x = expect ? [JSON.stringify(expect)] : [];
		try { await runFile(file, ["put", JSON.stringify(t), ...x]); } catch (e) { if (!(e instanceof ParentError)) throw e; await runFile(file, ["put", JSON.stringify({ ...t, parent: "" }), ...x]); }
		return norm(JSON.parse(await runFile(file, ["list"]) as string).find((x: Task) => x.id === t.id));
	};
	// Parents first, so a child's parent is already linked when it is created.
	const depth = (t: Task, m: Map<string, Task>, n = 0): number => t.parent && m.has(t.parent) && n < 50 ? depth(m.get(t.parent)!, m, n + 1) + 1 : 0;
	for (const t of [...local].sort((a, b) => depth(a, byLocal) - depth(b, byLocal))) {
		if (toRemote.has(t.id)) continue;
		// Only synced fields go out, so local-only ones (claimed_by) never reach the adapter.
		const id = await adapter.create({ id: t.id, ...Object.fromEntries((adapter.fields ?? fields).map((f) => [f, t[f]])), parent: t.parent && toRemote.get(t.parent) } as Task);
		toRemote.set(t.id, id); toLocal.set(id, t.id);
		links.push({ local: t.id, remote: id, base: norm(t) });
	}
	for (const r of [...remote].sort((a, b) => depth(a, byRemote) - depth(b, byRemote))) {
		if (toLocal.has(r.id)) continue;
		const t = norm({ ...r, id: crypto.randomUUID(), parent: r.parent && toLocal.get(r.parent) });
		const saved = await put(human === undefined ? t : { ...t, human }); // pulled tasks join the filtered set
		toRemote.set(t.id, r.id); toLocal.set(r.id, t.id);
		links.push({ local: t.id, remote: r.id, base: saved });
	}
	for (const link of links) {
		const l = byLocal.get(link.local), r = byRemote.get(link.remote);
		if (!l || !r) continue;
		const lv = norm(l), rv = norm({ ...r, id: l.id, parent: r.parent && toLocal.get(r.parent) }), b = link.base;
		const push: Partial<Task> = {}, pull: Partial<Task> = {};
		for (const f of adapter.fields ?? fields) {
			// Skip values the remote already has, so adapters needn't re-read to avoid no-op writes.
			if (lv[f] !== b[f]) { if (lv[f] !== rv[f]) (push as Record<string, unknown>)[f] = lv[f]; }
			else if (rv[f] !== b[f]) (pull as Record<string, unknown>)[f] = rv[f];
		}
		const skipped = Object.keys(push).length ? (await adapter.update(r.id, { ...push, parent: push.parent && toRemote.get(push.parent), result: lv.result })) ?? [] : [];
		link.base = Object.keys(pull).length ? await put({ id: lv.id, ...Object.fromEntries(Object.entries(pull).map(([k, v]) => [k, v ?? ""])) } as Task, Object.fromEntries(Object.keys(pull).map((k) => [k, (lv as any)[k] ?? null]))) : { ...lv };
		// Pull refused (local changed meanwhile): keep the old base so the next sync pushes the local value.
		for (const k of Object.keys(pull)) if ((link.base as any)[k] !== (rv as any)[k]) (link.base as any)[k] = (b as any)[k];
		for (const f of skipped) if (f in push) (link.base as any)[f] = (b as any)[f];
	}
	} finally {
		const temp = `${linksFile}.${randomUUID()}.tmp`;
		writeFileSync(temp, links.map((l) => JSON.stringify(l)).join("\n") + "\n");
		renameSync(temp, linksFile);
	}
	}, 0).catch((e: any) => {
		// Another process is already syncing this adapter; its run covers our changes.
		if (e.code === "ELOCKED" && e.lock === `${linksFile}.lock`) return "skipped";
		throw e;
	});
}
