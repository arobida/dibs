import { beforeAll, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = join(import.meta.dirname, "..");
const tmp = mkdtempSync(join(tmpdir(), "dibs-npx-"));
const proj = mkdtempSync(join(tmpdir(), "dibs-npx-proj-"));
let tgz = "";
// plain node/npm only: drop nub entries from PATH
const PATH = (process.env.PATH ?? "").split(delimiter).filter((p) => !/nub/i.test(p)).join(delimiter);
const env = { ...process.env, PATH, DIBS_TRUST: "1", DIBS_HOME: join(tmp, "home"), DIBS_SESSION: "npx-test", DIBS_SCOPE: "project", npm_config_yes: "true" } as Record<string, string>;
const run = (cmd: string, args: string[]) => spawnSync(cmd, args, { cwd: proj, env, encoding: "utf8" });

beforeAll(() => {
	const p = spawnSync("nub", ["pack", "--pack-destination", tmp], { cwd: root, encoding: "utf8" });
	expect(p.status, p.stderr).toBe(0);
	tgz = "file:" + join(tmp, readdirSync(tmp).find((f) => f.endsWith(".tgz"))!);
}, 120_000);

test("published package runs via npx on plain node", async () => {
	expect(run("node", ["--version"]).status).toBe(0);
	expect(run("which", ["nub"]).status).not.toBe(0);
	const c = run("npx", ["-y", tgz, "create", "npx task"]);
	expect(c.status, c.stderr).toBe(0);
	expect(c.stdout).toContain("Created task");
	const l = run("npx", ["-y", tgz, "list", "--json"]);
	expect(l.status, l.stderr).toBe(0);
	expect(JSON.stringify(JSON.parse(l.stdout))).toContain("npx task");

	const client = new Client({ name: "test", version: "0" });
	await client.connect(new StdioClientTransport({ command: "npx", args: ["-y", tgz, "mcp"], cwd: proj, env }));
	try { expect((await client.listTools()).tools.length).toBeGreaterThan(0); } finally { await client.close(); }
}, 120_000);
