import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initStore } from "../src/core/store.ts";
import { mergeDexTasks, readDexTasks } from "../src/core/imports/dex.ts";
import type { Ctx } from "../src/core/ctx.ts";

beforeEach(() => { vi.stubEnv("DIBS_HOME", dir()); vi.stubEnv("DIBS_FILE", ""); vi.stubEnv("DIBS_SCOPE", "project"); vi.stubEnv("XDG_CONFIG_HOME", dir()); });
afterEach(() => vi.unstubAllEnvs());
const dir = () => mkdtempSync(join(tmpdir(), "dibs-init-"));
const task = (id: string, extra = {}) => ({ id, name: id, completed: false, started_at: null, ...extra });
test("init creates empty durable store without Hello World", () => {
 const cwd = dir();
 const ctx: Ctx = { cwd, trusted: () => false, sessionId: () => "init", exec: async () => ({ stdout: "", stderr: "", code: 0 }) };
 const file = initStore(ctx);
 expect(readFileSync(file, "utf8")).toBe("");
 expect(existsSync(join(cwd, ".dibs", "config.json"))).toBe(true);
});
test("Dex reader is read-only and validates batch before merge", async () => {
 const cwd = dir(); mkdirSync(join(cwd, ".dex")); writeFileSync(join(cwd, ".dex", "config.toml"), "");
 const calls: string[][] = [];
 const ctx: Ctx = { cwd, trusted: () => true, sessionId: () => "x", exec: async (_cmd, args) => { calls.push(args); return { stdout: JSON.stringify([task("a"), task("b", { parent_id: "a" })]), stderr: "", code: 0 }; } };
 const rows = await readDexTasks(ctx);
 expect(calls).toEqual([["list", "--all", "--json"]]);
 expect(rows[1].parent).toBe("a");
 const file = join(dir(), "todos.jsonl");
 expect(await mergeDexTasks(file, rows)).toBe(2);
 expect(await mergeDexTasks(file, rows)).toBe(0);
 const before = readFileSync(file, "utf8");
 await expect(mergeDexTasks(file, [task("c", { parent: "absent" }) as any])).rejects.toThrow();
 expect(readFileSync(file, "utf8")).toBe(before);
});

 test("Dex source fields and separate relationship graphs", async () => {
 const cwd = dir(); mkdirSync(join(cwd, ".dex")); writeFileSync(join(cwd, ".dex/config.toml"), "");
 const ctx: Ctx = { cwd, trusted: () => true, sessionId: () => "x", exec: async () => ({ code: 0, stderr: "", stdout: JSON.stringify([task("a", { priority: 2, created_at: "2026-01-02T00:00:00Z", blockedBy: ["b"] }), task("b", { parent_id: "a" }), task("done", { completed: true, completed_at: "2026-01-03T12:00:00Z", result: "Shipped", description: "Details" })]) }) };
 const rows = await readDexTasks(ctx);
 expect(rows[0]).toMatchObject({ created: "2026-01-02", blocked_by: ["b"] }); expect(rows[0].priority).toBeUndefined();
 expect(rows[2]).toMatchObject({ completed: true, completed_date: "2026-01-03", result: "Shipped", description: "Details" });
 await expect(mergeDexTasks(join(dir(), "tasks"), rows)).resolves.toBe(3);
 });
 test("legacy Dex links preserve local changes and remap relationships", async () => {
 const base = dir(), file = join(base, "tasks"); mkdirSync(join(base, "sync"));
 const original = JSON.stringify(task("local", { name: "local edit", claimed_by: "session" })) + "\n";
 writeFileSync(file, original); writeFileSync(join(base, "sync/dex.jsonl"), JSON.stringify({ remote: "remote", local: "local" }) + "\n");
 expect(await mergeDexTasks(file, [task("remote"), task("child", { parent: "remote", blocked_by: ["remote"] })], base)).toBe(1);
 expect(readFileSync(file, "utf8")).toContain(original);
 expect(JSON.parse(readFileSync(file, "utf8").trim().split("\n")[1])).toMatchObject({ parent: "local", blocked_by: ["local"] });
 const before = readFileSync(file, "utf8");
 await expect(mergeDexTasks(file, [task("cycle", { blocked_by: ["cycle"] })], base)).rejects.toThrow("cycle");
 expect(readFileSync(file, "utf8")).toBe(before);
 });

test("CLI init flags, subfolders, global durability and explicit files", async () => {
 const { spawnSync } = await import("node:child_process");
 const cli = join(import.meta.dirname, "../src/cli/index.ts"), cwd = dir();
 const run = (at: string, args: string[], env = {}) => spawnSync("nub", [cli, ...args], { cwd: at, env: { ...process.env, ...env }, encoding: "utf8" });
 expect(run(cwd, ["init", "--from=unknown"]).status).toBe(1);
 expect(existsSync(join(cwd, ".dibs"))).toBe(false);
 expect(run(cwd, ["init", "--from", "dex"]).status).toBe(1);
 expect(existsSync(join(cwd, ".dibs"))).toBe(false);
 mkdirSync(join(cwd, ".dex")); writeFileSync(join(cwd, ".dex/config.toml"), "");
 const bin = join(cwd, "bin"); mkdirSync(bin);
 writeFileSync(join(bin, "dex"), '#!/bin/sh\nprintf \'[{"id":"bad"}]\'\n', { mode: 0o755 });
 expect(run(cwd, ["init", "--from=dex"], { PATH: `${bin}:${process.env.PATH}` }).status).toBe(1);
 expect(existsSync(join(cwd, ".dibs"))).toBe(false);
 writeFileSync(join(bin, "dex"), `#!/bin/sh\nprintf '%s' '[{"id":"one","name":"Dex task","completed":false,"priority":1,"blockedBy":[]}]'\n`, { mode: 0o755 });
 expect(run(cwd, ["init", "--from=dex"], { PATH: `${bin}:${process.env.PATH}` }).status).toBe(0);
 expect(run(cwd, ["init"]).status).toBe(0);
 const child = join(cwd, "child"); mkdirSync(child);
 expect(run(child, ["init"]).status).toBe(0); expect(existsSync(join(child, ".dibs"))).toBe(false);
 const custom = join(dir(), "nested/tasks.jsonl");
 expect(run(cwd, ["init"], { DIBS_FILE: custom }).status).toBe(0); expect(readFileSync(custom, "utf8")).toBe("");
 const globalCwd = dir();
 expect(run(globalCwd, ["init", "--global"], { DIBS_SCOPE: "", DIBS_TRUST: "1" }).status).toBe(0);
 const ctx: Ctx = { cwd: globalCwd, trusted: () => true, sessionId: () => "g", exec: async () => ({ code: 0, stdout: "", stderr: "" }) };
 vi.stubEnv("DIBS_SCOPE", "");
 const file = initStore(ctx); expect(file.startsWith(process.env.DIBS_HOME!)).toBe(true);
});

test("removed Dex sync reports an actionable warning and continues Things", async () => {
 const { syncAll } = await import("../src/core/adapters/sync-all.ts");
 const file = join(dir(), "tasks"); writeFileSync(file, "");
 const result = await syncAll({} as Ctx, { adapters: { dex: { sync: true }, things: { sync: true } }, base: dir() } as any, file, { things: () => ({ name: "things", list: async () => [], create: async () => "", update: async () => {} }) });
 expect(String(result[0].error)).toContain("dibs init --from=dex"); expect(result[1]).toEqual({ name: "things" });
});
