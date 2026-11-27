import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFile } from "../src/core/tasks.ts";

const cli = join(import.meta.dirname, "../lib/cli/index.js");
const home = mkdtempSync(join(tmpdir(), "dibs-claims-home-"));
const cwd = mkdtempSync(join(tmpdir(), "dibs-claims-"));
mkdirSync(join(cwd, ".dibs"));
const run = (agent: string, ...args: string[]) => {
	const env = { ...process.env, DIBS_HOME: home, DIBS_TRUST: "1", DIBS_SCOPE: "project", DIBS_AGENT: agent } as Record<string, string | undefined>;
	delete env.DIBS_SESSION;
	const p = spawnSync("nub", [cli, ...args], { cwd, env });
	return { out: String(p.stdout), err: String(p.stderr), code: p.status };
};
const idOf = (name: string) => JSON.parse(run("codex", "list", "--json").out).find((t: any) => t.name === name).id;
const taskFile = () => { const dir = join(cwd, ".dibs", "todos"); return join(dir, readdirSync(dir).find((f) => f.endsWith(".jsonl"))!); };

test("a CLI start claim keeps the task out of ready; other agents need --force", () => {
	run("codex", "create", "T");
	const id = idOf("T");
	expect(run("codex", "start", id).code).toBe(0);
	expect(run("codex", "ready").out).not.toContain(id);
	expect(run("cursor", "start", id).code).toBe(1);
	expect(run("cursor", "start", id, "--force").code).toBe(1); // only the creator may force
	run("cursor", "create", "T2");
	const t2 = idOf("T2");
	run("codex", "start", t2);
	expect(run("cursor", "start", t2, "--force").code).toBe(0);
});

test("the owner completes its own CLI-claimed task", () => {
	run("codex", "create", "U");
	const id = idOf("U");
	run("codex", "start", id);
	expect(run("codex", "complete", id).code).toBe(0);
});

test("complete on a live session-claimed task needs --force", async () => {
	run("codex", "create", "V");
	const id = idOf("V");
	await runFile(taskFile(), ["start", id, "--claim", `s:${process.pid}`]);
	expect(run("codex", "complete", id).code).toBe(1);
	expect(run("codex", "complete", id, "--force").code).toBe(0);
});

test("start refuses a task with an open blocker unless forced", () => {
	run("codex", "create", "Blocker");
	const a = idOf("Blocker");
	run("codex", "create", "Blocked", "--blocked-by", a);
	const b = idOf("Blocked");
	const refused = run("codex", "start", b);
	expect(refused.code).toBe(1);
	expect(refused.err).toContain(a);
	const other = run("cursor", "start", b, "--force");
	expect(other.code).toBe(1); // only the creator may force past a blocker
	expect(other.err).toContain("only its creator (cli:codex)");
	expect(run("codex", "start", b, "--force").code).toBe(0);
	run("codex", "create", "Blocked2", "--blocked-by", a);
	run("codex", "start", a); run("codex", "complete", a);
	expect(run("codex", "start", idOf("Blocked2")).code).toBe(0);
});

test("a non-creator's --force is refused even when nothing needs forcing", () => {
	run("codex", "create", "Free task");
	const id = idOf("Free task");
	const other = run("cursor", "start", id, "--force");
	expect(other.code).toBe(1);
	expect(other.err).toContain("--force refused");
	expect(run("cursor", "start", id).code).toBe(0); // the same start without force succeeds
	run("codex", "create", "Free task 2");
	const t2 = idOf("Free task 2");
	const own = run("codex", "start", t2, "--force"); // creator's force with nothing to override
	expect(own.code).toBe(0);
	expect(own.out).not.toContain("(forced)");
});
