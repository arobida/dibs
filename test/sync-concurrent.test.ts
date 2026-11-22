import { expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { sync } from "../src/core/adapters/sync.ts";
import { runFile } from "../src/core/tasks.ts";

test("sync: pull does not overwrite a local edit made during sync", async () => {
	const dir = mkdtempSync(`${tmpdir()}/dibs-conc-`), file = `${dir}/t.jsonl`, remote = new Map<string, any>(); let n = 0, hook: (() => Promise<unknown>) | undefined;
	const adapter = { name: "fake",
		list: async () => { const h = hook; hook = undefined; await h?.(); return [...remote.values()].map((t) => ({ ...t })); },
		create: async (t: any) => { const id = `r${n++}`; remote.set(id, { ...t, id }); return id; },
		update: async (id: string, p: any) => { Object.assign(remote.get(id), p); } };
	const desc = async () => JSON.parse(await runFile(file, ["list"]) as string)[0].description;
	try {
		const id = (await runFile(file, ["create", "a", "--description", "old"]) as string).match(/Created task (\S+)/)![1];
		await sync(file, dir, adapter);
		remote.get("r0").description = "remote edit";
		hook = () => Promise.resolve(runFile(file, ["edit", id, "--description", "local edit during sync"]));
		await sync(file, dir, adapter);
		expect(await desc()).toBe("local edit during sync");
		await sync(file, dir, adapter);
		expect(remote.get("r0").description).toBe("local edit during sync");
		expect(await desc()).toBe("local edit during sync");
	} finally { rmSync(dir, { recursive: true, force: true }); }
});
