import { expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { sync } from "../src/core/adapters/sync.ts";
import { runFile } from "../src/core/tasks.ts";

const setup = (update: (remote: Map<string, any>, id: string, p: any) => string[] | void) => {
	const dir = mkdtempSync(`${tmpdir()}/dibs-skip-`), remote = new Map<string, any>(); let n = 0, updates = 0;
	const adapter = { name: "fake", list: async () => [...remote.values()].map((t) => ({ ...t })), create: async (t: any) => { const id = `r${n++}`; remote.set(id, { ...t, id }); return id; },
		update: async (id: string, p: any) => { updates++; return update(remote, id, p); } };
	return { dir, file: `${dir}/t.jsonl`, adapter, updates: () => updates };
};
const list = async (file: string) => JSON.parse(await runFile(file, ["list"]) as string);

test("sync: skipped result stays local", async () => {
	const { dir, file, adapter } = setup((remote, id, p) => { if (p.completed) remote.get(id).result = p.result; else return ["result"]; });
	try {
		const id = (await runFile(file, ["create", "a"]) as string).match(/Created task (\S+)/)![1];
		await runFile(file, ["complete", id, "--result", "first"]); await sync(file, dir, adapter);
		await runFile(file, ["complete", id, "--result", "second"]);
		await sync(file, dir, adapter); await sync(file, dir, adapter);
		expect((await list(file))[0].result).toBe("second");
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

test("sync: adapter-normalized name does not loop", async () => {
	const { dir, file, adapter, updates } = setup((remote, id, p) => { remote.get(id).name = p.name.trim(); });
	try {
		const id = (await runFile(file, ["create", "foo"]) as string).match(/Created task (\S+)/)![1];
		await sync(file, dir, adapter);
		await runFile(file, ["put", JSON.stringify({ id, name: "bar " })]);
		for (let i = 0; i < 3; i++) await sync(file, dir, adapter);
		expect(updates()).toBe(1);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});
