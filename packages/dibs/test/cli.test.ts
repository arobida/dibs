import { expect, test } from "vitest";
import { spawnSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cli = join(import.meta.dirname, "../src/cli/index.ts");
const home = mkdtempSync(join(tmpdir(), "dibs-home-"));
const run = (cwd: string, ...args: string[]) => {
	const p = spawnSync("nub", [cli, ...args], { cwd, env: { ...process.env, DIBS_HOME: home, DIBS_SESSION: "cli-test", DIBS_TRUST: "1", DIBS_SCOPE: "project" } });
	return { out: String(p.stdout), err: String(p.stderr), code: p.status };
};

test("create/list/start/edit/complete/export/import round trip", () => {
	const cwd = mkdtempSync(join(tmpdir(), "dibs-cli-"));
	const id = /task (\S+)/.exec(run(cwd, "create", "Write docs", "--description", "d").out)![1];
	expect(run(cwd, "list").out).toContain(`[ ] ${id} Write docs`);
	expect(run(cwd, "list", "--query", "nomatch").out.trim()).not.toContain(id);
	expect(run(cwd, "start", id).code).toBe(0);
	expect(run(cwd, "list").out).toContain(`[~] ${id}`);
	expect(run(cwd, "edit", id, "--name", "Write more docs").out).toContain("changed name");
	expect(run(cwd, "complete", id, "--result", "ok").out).toContain("Completed");
	expect(run(cwd, "list").out).toContain(`[x] ${id} Write more docs`);
	const json = JSON.parse(run(cwd, "list", "--json").out);
	expect(json.find((t: any) => t.id === id).result).toBe("ok");
	const exported = run(cwd, "export").out;
	expect(exported).toContain("Write more docs");
	const file = join(cwd, "out.txt");
	expect(run(cwd, "export", file).code).toBe(0);
	expect(run(cwd, "export", file).code).toBe(1);
	const other = mkdtempSync(join(tmpdir(), "dibs-cli-"));
	expect(run(other, "import", file).out).toContain("Imported 2");
	expect(run(other, "list").out).toContain("Write more docs");
});

test("unknown command and missing arg exit 1 on stderr", () => {
	const cwd = mkdtempSync(join(tmpdir(), "dibs-cli-"));
	const r = run(cwd, "bogus");
	expect(r.code).toBe(1);
	expect(r.err).toContain("Unknown command");
	expect(run(cwd, "start").code).toBe(1);
	expect(run(cwd, "--help").out).toContain("usage:");
});

test("untrusted dir writes to the temp store, not cwd", () => {
	const cwd = mkdtempSync(join(tmpdir(), "dibs-cli-"));
	const env: Record<string, string | undefined> = { ...process.env, DIBS_HOME: home, DIBS_SESSION: "untrusted-test" };
	delete env.DIBS_TRUST;
	const p = spawnSync("nub", [cli, "create", "Temp task"], { cwd, env });
	expect(p.status).toBe(0);
	expect(readdirSync(cwd)).toEqual([]);
});

test("sync with no adapters enabled", () => {
	const r = run(mkdtempSync(join(tmpdir(), "dibs-cli-")), "sync");
	expect(r.out).toContain("no adapters enabled");
	expect(r.code).toBe(0);
});

test("concurrent creates from separate processes all persist", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "dibs-cli-"));
	const env = { ...process.env, DIBS_HOME: home, DIBS_SESSION: "cli-test", DIBS_TRUST: "1", DIBS_SCOPE: "project" };
	const procs = Array.from({ length: 20 }, (_, i) => new Promise<number | null>((r) => spawn("nub", [cli, "create", `t${i}`], { cwd, env }).on("close", r)));
	expect(await Promise.all(procs)).toEqual(Array(20).fill(0));
	const names = new Set(JSON.parse(run(cwd, "list", "--json").out).map((t: any) => t.name).filter((n: string) => /^t\d+$/.test(n)));
	expect(names.size).toBe(20);
}, 30000);
