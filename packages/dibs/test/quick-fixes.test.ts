import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sync } from "../src/core/adapters/sync.ts";
import { runFile } from "../src/core/tasks.ts";

const cli = join(import.meta.dirname, "../lib/cli/index.js");
const home = mkdtempSync(join(tmpdir(), "dibs-quick-home-"));
const run = (cwd: string, env: Record<string, string>, ...args: string[]) => {
	const p = spawnSync("nub", [cli, ...args], { cwd, env: { ...process.env, DIBS_HOME: home, DIBS_SESSION: "quick", DIBS_TRUST: "1", DIBS_SCOPE: "project", ...env } });
	return { out: String(p.stdout), err: String(p.stderr), code: p.status };
};

test("scope rejects an invalid scope and leaves the registry alone", () => {
	const cwd = mkdtempSync(join(tmpdir(), "dibs-quick-"));
	mkdirSync(join(cwd, ".dibs"));
	expect(run(cwd, {}, "create", "Scoped task").code).toBe(0);
	const registry = join(home, "projects", "projects.jsonl");
	const before = readFileSync(registry, "utf8");
	const bad = run(cwd, {}, "scope", "banana");
	expect(bad.code).toBe(1);
	expect(bad.err).toContain("Invalid scope: banana");
	expect(readFileSync(registry, "utf8")).toBe(before);
	const list = run(cwd, {}, "list");
	expect(list.code).toBe(0);
	expect(list.out).toContain("Scoped task");
});

test("sync clears started_at when the remote clears it", async () => {
	const dir = mkdtempSync(join(tmpdir(), "dibs-quick-sync-")), file = `${dir}/t.jsonl`, remote = new Map<string, any>(); let n = 0;
	const adapter = { name: "fake", list: async () => [...remote.values()].map((t) => ({ ...t })), update: async (id: string, patch: any) => { Object.assign(remote.get(id), patch); },
		create: async (t: any) => { const id = `r${n++}`; remote.set(id, { ...t, id }); return id; } };
	try {
		await runFile(file, ["create", "started"]);
		const id = JSON.parse(await runFile(file, ["list"]) as string)[0].id;
		await runFile(file, ["start", id]);
		await sync(file, dir, adapter);
		expect(remote.get([...remote.keys()][0]).started_at).toBeTruthy();
		remote.get([...remote.keys()][0]).started_at = null;
		await expect(sync(file, dir, adapter)).resolves.toBeUndefined();
		expect(JSON.parse(await runFile(file, ["list"]) as string)[0].started_at).toBeNull();
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

test("create --human me stores the GitHub user and list --human me finds it", () => {
	const cwd = mkdtempSync(join(tmpdir(), "dibs-quick-"));
	expect(run(cwd, { DIBS_USER: "alice" }, "create", "X", "--human", "me").code).toBe(0);
	const all = JSON.parse(run(cwd, {}, "list", "--json").out);
	expect(all.find((t: any) => t.name === "X")).toMatchObject({ human: "alice" });
	expect(run(cwd, { DIBS_USER: "alice" }, "list", "--human", "me").out).toContain("X @alice");
});
