import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { doctor } from "../src/core/doctor.ts";
import { initStore, settings } from "../src/core/store.ts";
import type { Ctx } from "../src/core/ctx.ts";
let ctx: Ctx;
beforeEach(() => {
 const dir = mkdtempSync(join(tmpdir(), "dibs-doctor-"));
 vi.stubEnv("DIBS_HOME", join(dir, "home")); vi.stubEnv("DIBS_FILE", ""); vi.stubEnv("DIBS_SCOPE", "project"); vi.stubEnv("DIBS_THINGS_TOKEN", "");
 ctx = { cwd: join(dir, "project"), trusted: () => true, sessionId: () => dir, exec: vi.fn(async () => { throw new Error("no execution"); }) };
 mkdirSync(ctx.cwd);
});
afterEach(() => vi.unstubAllEnvs());
const run = (...args: string[]) => spawnSync("nub", [join(import.meta.dirname, "../src/cli/index.ts"), ...args], { cwd: ctx.cwd, env: process.env, encoding: "utf8" });
test("absent storage remains absent, without a fabricated persisted ID or exec", () => {
 const before = readdirSync(ctx.cwd);
 const r = doctor(ctx);
 expect(r.ok).toBe(false); expect(r.storage?.projectId).toBeUndefined();
 expect(readdirSync(ctx.cwd)).toEqual(before); expect(existsSync(process.env.DIBS_HOME!)).toBe(false); expect(ctx.exec).not.toHaveBeenCalled();
 expect(run("doctor", "--json").status).toBe(1);
 expect(existsSync(process.env.DIBS_HOME!)).toBe(false);
});
test.each([false, true])("empty initialized store passes read-only, global=%s", (global) => {
 const file = initStore(ctx, global), s = settings(ctx, global);
 const paths = [file, join(s.local, "config.json"), join(process.env.DIBS_HOME!, "projects/projects.jsonl")];
 const before = paths.map((p) => readFileSync(p, "utf8"));
 expect(doctor(ctx, global).ok).toBe(true);
 expect(paths.map((p) => readFileSync(p, "utf8"))).toEqual(before);
 expect(ctx.exec).not.toHaveBeenCalled();
});
test("strict unterminated JSONL and schema errors include path and fail CLI", () => {
 const file = initStore(ctx);
 for (const text of ['{"id":', '{"id":"x"}']) {
 writeFileSync(file, text);
 expect(doctor(ctx).checks).toContainEqual(expect.objectContaining({ name: "tasks", status: "error", message: `Invalid task JSONL: ${file}:1` }));
 const cli = run("doctor", "--json"); expect(cli.status).toBe(1); expect(JSON.parse(cli.stdout).ok).toBe(false);
 }
});
test("config parse errors are redacted and path-qualified", () => {
 initStore(ctx); const path = join(settings(ctx).local, "config.json");
 writeFileSync(path, '{"secret":"never-leak", broken}');
 const text = JSON.stringify(doctor(ctx)); expect(text).toContain(path); expect(text).not.toContain("never-leak"); expect(doctor(ctx).ok).toBe(false);
});
test("Things warns without claiming connectivity and never exposes malformed credentials", () => {
 initStore(ctx); const s = settings(ctx);
 writeFileSync(join(s.local, "config.json"), JSON.stringify({ id: s.id, adapters: { things: { sync: true } } }));
 mkdirSync(join(process.env.DIBS_HOME!, "adapters"));
 writeFileSync(join(process.env.DIBS_HOME!, "adapters/things.json"), '{"token":"secret-never-leak", broken}');
 const r = doctor(ctx); expect(r.ok).toBe(true); expect(JSON.stringify(r)).not.toContain("secret-never-leak");
 expect(r.checks).toContainEqual(expect.objectContaining({ name: "things-credentials", status: "warn" }));
 expect(r.checks).toContainEqual(expect.objectContaining({ name: "things-connection", status: "warn" })); expect(ctx.exec).not.toHaveBeenCalled();
});
test("init emits one JSON document with automatic verification and preserves saved state on failure", () => {
 let result = run("init", "--json", "--adapter=none"); expect(result.status).toBe(0); expect(JSON.parse(result.stdout).doctor.ok).toBe(true);
 writeFileSync(initStore(ctx), "broken");
 result = run("init", "--json"); expect(result.status).toBe(1); expect(JSON.parse(result.stdout).verificationError).toContain("initialization completed");
});
test("nested, explicit-file and temporary paths follow settings", () => {
 initStore(ctx); const s = settings(ctx); const child = join(ctx.cwd, "child"); mkdirSync(child);
 expect(doctor({ ...ctx, cwd: child }).storage?.file).toBe(join(s.base, "todos", `${s.name}.todos.jsonl`));
 vi.stubEnv("DIBS_FILE", "custom.jsonl"); writeFileSync(join(ctx.cwd, "custom.jsonl"), ""); expect(doctor(ctx).storage?.file).toBe(join(ctx.cwd, "custom.jsonl")); expect(doctor(ctx).ok).toBe(true);
 vi.stubEnv("DIBS_FILE", ""); vi.stubEnv("DIBS_SCOPE", "temp");
 expect(doctor(ctx).storage?.scope).toBe("temp"); expect(existsSync(settings(ctx).base)).toBe(false);
});
