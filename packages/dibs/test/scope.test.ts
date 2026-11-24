import { expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { sync } from "../src/core/adapters/sync.ts";
import { runFile } from "../src/core/tasks.ts";
import { setScope, settings, storeFile } from "../src/core/store.ts";

const mk = (cfg?: object) => {
	const home = mkdtempSync(`${tmpdir()}/dibs-sc-h-`), cwd = mkdtempSync(`${tmpdir()}/dibs-sc-p-`), prev = process.env.DIBS_HOME;
	process.env.DIBS_HOME = home; mkdirSync(`${cwd}/.dibs`);
	if (cfg) writeFileSync(`${cwd}/.dibs/config.json`, JSON.stringify(cfg));
	const ctx = { cwd, trusted: () => true, sessionId: () => "s", exec: async () => ({ stdout: "", stderr: "", code: 0 }) } as any;
	return { ctx, done: () => { process.env.DIBS_HOME = prev; if (prev === undefined) delete process.env.DIBS_HOME; rmSync(home, { recursive: true, force: true }); rmSync(cwd, { recursive: true, force: true }); } };
};

test("scope move keeps sync links: resync creates no duplicates", async () => {
	const { ctx, done } = mk(), remote = new Map<string, any>(); let n = 0;
	const adapter = { name: "fake", list: async () => [...remote.values()].map((t) => ({ ...t })), update: async () => {},
		create: async (t: any) => { const id = `r${n++}`; remote.set(id, { ...t, id }); return id; } };
	try {
		let s = settings(ctx), file = storeFile(ctx, s);
		await runFile(file, ["create", "a"]); await runFile(file, ["create", "b"]);
		await sync(file, s.base, adapter);
		const count = async (f: string) => (JSON.parse(await runFile(f, ["list"]) as string) as any[]).length, r0 = remote.size, l0 = await count(file);
		for (const sc of ["global", "project"]) {
			await setScope(ctx, sc); s = settings(ctx); file = storeFile(ctx, s);
			await sync(file, s.base, adapter);
			expect([remote.size, await count(file)]).toEqual([r0, l0]);
		}
	} finally { done(); }
});

test("project config adapters still apply in global scope", async () => {
	const { ctx, done } = mk({ id: "pid1", adapters: { things: { sync: true } } });
	try {
		await setScope(ctx, "global");
		expect(settings(ctx).adapters.things.sync).toBe(true);
	} finally { done(); }
});
