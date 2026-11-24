import { expect, test } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("--global is refused for untrusted projects without writing into them", async () => {
 const previousHome = process.env.DIBS_HOME;
 const home = mkdtempSync(join(tmpdir(), "dibs-home-"));
 const cwd = mkdtempSync(join(tmpdir(), "dibs-cwd-"));
 process.env.DIBS_HOME = home;
 try {
  const { settings } = await import("../src/core/store.ts");
  const ctx = { cwd, hasUI: false, trusted: () => false, ui: { notify() {} }, sessionId: () => "s" };
  expect(() => settings(ctx as any, true)).toThrow("requires a trusted project");
  expect(existsSync(join(cwd, ".dibs"))).toBe(false);
 } finally {
  if (previousHome === undefined) delete process.env.DIBS_HOME;
  else process.env.DIBS_HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
 }
});

test("dibs links round-trip, survive a move, and refuse unregistered stores", async () => {
 const { mkdtempSync, renameSync } = await import("node:fs");
 const previous = { home: process.env.DIBS_HOME, file: process.env.DIBS_FILE };
 const home = mkdtempSync(join(tmpdir(), "dibs-home-"));
 const parent = mkdtempSync(join(tmpdir(), "dibs-cwd-"));
 process.env.DIBS_HOME = home;
 const ctxAt = (cwd: string) => ({ cwd, hasUI: false, trusted: () => true, ui: { notify() {} }, sessionId: () => "s" }) as any;
 try {
  const { link, resolveLink, settings, storeFile } = await import("../src/core/store.ts");
  const { runFile } = await import("../src/core/tasks.ts");
  const a = join(parent, "a"), b = join(parent, "b");
  require("node:fs").mkdirSync(a);
  const s = settings(ctxAt(a)), file = storeFile(ctxAt(a), s);
  const id = /Created task (\S+)/.exec(await runFile(file, ["create", "Linked"]))![1];
  const url = link(ctxAt(a), id).match(/\((dibs:[^)]+)\)/)![1];
  expect(link(ctxAt(a), id)).toBe(`[Linked](${url})`);
  expect(resolveLink(url)).toBe("Linked\nState: open\nResult: ");
  expect(() => resolveLink(`dibs://nope/${id}`)).toThrow("Unknown project");
  expect(() => resolveLink(url.replace(id, "nope"))).toThrow("Task not found");
  renameSync(a, b);
  expect(() => resolveLink(url)).toThrow(a);
  storeFile(ctxAt(b), settings(ctxAt(b)));
  expect(resolveLink(url)).toContain("Linked");
  process.env.DIBS_FILE = join(parent, "x.jsonl");
  expect(() => link(ctxAt(b), id)).toThrow("explicit-file");
 } finally {
  for (const [k, v] of [["DIBS_HOME", previous.home], ["DIBS_FILE", previous.file]] as const) v === undefined ? delete process.env[k] : (process.env[k] = v);
  rmSync(home, { recursive: true, force: true });
  rmSync(parent, { recursive: true, force: true });
 }
});

test("link is refused for a store set via config.file", async () => {
 const previous = { home: process.env.DIBS_HOME, file: process.env.DIBS_FILE };
 const home = mkdtempSync(join(tmpdir(), "dibs-home-"));
 const cwd = mkdtempSync(join(tmpdir(), "dibs-cwd-"));
 process.env.DIBS_HOME = home; delete process.env.DIBS_FILE;
 try {
  const { link, settings, storeFile } = await import("../src/core/store.ts");
  const { runFile } = await import("../src/core/tasks.ts");
  require("node:fs").writeFileSync(join(home, "config.json"), JSON.stringify({ file: join(cwd, "x.jsonl") }));
  const ctx = { cwd, hasUI: false, trusted: () => true, ui: { notify() {} }, sessionId: () => "s" } as any;
  const s = settings(ctx);
  expect(s.file).toBeTruthy();
  const id = /Created task (\S+)/.exec(await runFile(storeFile(ctx, s), ["create", "T"]))![1];
  expect(() => link(ctx, id)).toThrow("explicit-file");
 } finally {
  for (const [k, v] of [["DIBS_HOME", previous.home], ["DIBS_FILE", previous.file]] as const) v === undefined ? delete process.env[k] : (process.env[k] = v);
  rmSync(home, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
 }
});

test("falls back to an existing .pi-do folder when .dibs is missing", async () => {
 const { localDir } = await import("../src/core/store.ts");
 const cwd = mkdtempSync(join(tmpdir(), "dibs-cwd-"));
 try {
  expect(localDir(cwd)).toBe(join(cwd, ".dibs"));
  mkdirSync(join(cwd, ".pi-do")); expect(localDir(cwd)).toBe(join(cwd, ".pi-do"));
  mkdirSync(join(cwd, ".dibs")); expect(localDir(cwd)).toBe(join(cwd, ".dibs"));
 } finally { rmSync(cwd, { recursive: true, force: true }); }
});
