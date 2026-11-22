import { expect, test } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withLock } from "../src/core/util.ts";

test("three waiters on a dead lock never overlap", async () => {
	const dead = spawnSync(process.execPath, ["-e", "0"]).pid;
	let inside = 0, max = 0, ran = 0;
	const run = () => withLock(join(dir, "f"), async () => { max = Math.max(max, ++inside); await new Promise((r) => setTimeout(r, 5)); inside--; ran++; });
	var dir = "";
	for (let i = 0; i < 30; i++) {
		dir = mkdtempSync(join(tmpdir(), "lock-"));
		writeFileSync(join(dir, "f.lock"), `${dead}:x`);
		await Promise.all([run(), run(), run()]);
	}
	expect(max).toBe(1);
	expect(ran).toBe(90);
});
