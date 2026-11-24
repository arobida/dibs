import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cli = join(import.meta.dirname, "../lib/cli/index.js");
const tmp = () => mkdtempSync(join(tmpdir(), "dibs-root-"));
const run = (cwd: string, home: string, ...args: string[]) => {
	const env: Record<string, string | undefined> = { ...process.env, DIBS_HOME: home, DIBS_SCOPE: "project" };
	delete env.DIBS_SESSION; delete env.DIBS_TRUST; delete env.DIBS_SCOPE;
	const p = spawnSync("nub", [cli, ...args], { cwd, env: env as any });
	return { out: String(p.stdout), err: String(p.stderr), code: p.status };
};

test("untrusted folder keeps one temp store across calls", () => {
	const cwd = tmp(), home = tmp();
	expect(run(cwd, home, "create", "A").code).toBe(0);
	expect(run(cwd, home, "list").out).toContain("A");
});

test("subfolder of a trusted project uses the project store", () => {
	const root = tmp(), home = tmp(), src = join(root, "src");
	mkdirSync(join(root, ".dibs")); mkdirSync(src);
	expect(run(root, home, "create", "B").code).toBe(0);
	expect(run(src, home, "list").out).toContain("B");
	expect(run(src, home, "list").code).toBe(0);
	const reg = readFileSync(join(home, "projects", "projects.jsonl"), "utf8");
	expect(reg).toContain(JSON.stringify(root.replace(/^\/private/, "")).slice(1, -1));
});

test("the global dibs home is not a project", () => {
	const h = tmp(), proj = join(h, "proj");
	mkdirSync(join(h, ".dibs"), { recursive: true }); mkdirSync(proj);
	writeFileSync(join(h, ".dibs", "config.json"), "{}");
	expect(run(proj, join(h, ".dibs"), "create", "C").code).toBe(0);
	expect(existsSync(join(h, ".dibs", "todos"))).toBe(false);
});
