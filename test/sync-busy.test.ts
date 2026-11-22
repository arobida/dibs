import { expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sync } from "../src/core/adapters/sync.ts";
import { syncAll } from "../src/core/adapters/sync-all.ts";
import { runFile } from "../src/core/tasks.ts";

// A live pid holds the fake adapter's lock, so sync must not wait for it.
const setup = () => {
	const base = mkdtempSync(`${tmpdir()}/dibs-busy-`), file = `${base}/t.jsonl`, lock = join(base, "sync", "fake.jsonl.lock");
	mkdirSync(join(base, "sync"));
	writeFileSync(lock, `${process.pid}:x`);
	let calls = 0;
	const adapter = { name: "fake", list: async () => { calls++; return []; }, create: async () => "", update: async () => {} };
	return { base, file, lock, adapter, calls: () => calls };
};

test("sync: skips without waiting when another live process holds the lock", async () => {
	const { base, file, adapter, calls } = setup();
	try {
		const t0 = Date.now();
		expect(await sync(file, base, adapter)).toBe("skipped");
		expect(Date.now() - t0).toBeLessThan(1000);
		expect(calls()).toBe(0);
	} finally { rmSync(base, { recursive: true, force: true }); }
});

test("syncAll: reports a busy adapter as skipped and a failing one as an error", async () => {
	const { base, file, lock, adapter } = setup();
	const s = { adapters: { dex: { sync: true } }, base, name: "x" } as any;
	try {
		expect(await syncAll({} as any, s, file, { dex: () => adapter })).toEqual([{ name: "dex", skipped: true }]);
		rmSync(lock);
		await runFile(file, ["create", "a"]);
		const broken = { ...adapter, list: async () => { throw new Error("boom"); } };
		const [item] = await syncAll({} as any, s, file, { dex: () => broken as any });
		expect(item.name).toBe("dex");
		expect(item.error).toBeInstanceOf(Error);
		expect(item.skipped).toBeUndefined();
	} finally { rmSync(base, { recursive: true, force: true }); }
});
