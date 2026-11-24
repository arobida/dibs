import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { initAdapter, adapterInstruction } from "../src/core/init-adapter.ts";
import { initStore, readConfig, settings } from "../src/core/store.ts";
import type { Ctx } from "../src/core/ctx.ts";

const dir = () => mkdtempSync(join(tmpdir(), "dibs-adapter-"));
let ctx: Ctx;
beforeEach(() => {
	vi.stubEnv("DIBS_THINGS_TOKEN", "");
	vi.stubEnv("DIBS_HOME", dir()); vi.stubEnv("DIBS_FILE", ""); vi.stubEnv("DIBS_SCOPE", "project");
	ctx = { cwd: dir(), trusted: () => true, sessionId: () => "adapter", exec: vi.fn(async () => { throw new Error("must not execute external commands"); }) };
});
afterEach(() => vi.unstubAllEnvs());
const initialized = (global = false) => { initStore(ctx, global); return settings(ctx, global); };

test("nonTTY asks AI to get consent without enabling or prompting", async () => {
	const s = initialized(), before = readFileSync(join(s.local, "config.json"), "utf8"), prompt = vi.fn();
	expect(await initAdapter(s, undefined, false, prompt)).toEqual({ adapter: null, instruction: adapterInstruction });
	expect(prompt).not.toHaveBeenCalled();
	expect(readFileSync(join(s.local, "config.json"), "utf8")).toBe(before);
});

test.each([["yes", true], [" Y ", true], ["no", false], ["", false], [undefined, undefined], ["maybe", undefined]])("TTY answer %s never ambiguously enables", async (answer, sync) => {
	const s = initialized(), prompt = vi.fn(async () => answer);
	await initAdapter(s, undefined, true, prompt);
	expect(prompt).toHaveBeenCalledOnce();
	expect(readConfig(s.local).adapters?.things?.sync).toBe(sync);
	expect(ctx.exec).not.toHaveBeenCalled();
});

test.each([true, false])("configured sync=%s does not reprompt", async (sync) => {
	const s = initialized();
	writeFileSync(join(s.local, "config.json"), JSON.stringify({ id: s.id, adapters: { things: { sync } } }));
	const prompt = vi.fn();
	expect((await initAdapter(settings(ctx), undefined, true, prompt)).adapter).toBe(sync ? "things" : "none");
	expect(prompt).not.toHaveBeenCalled();
});

test("explicit choices bypass prompts, preserve config and disable inherited Things only locally", async () => {
	const home = process.env.DIBS_HOME!;
	const global = { scope: "global", secret: "keep-global", adapters: { things: { sync: true, human: "owner", extra: "keep" } } };
	writeFileSync(join(home, "config.json"), JSON.stringify(global));
	vi.stubEnv("DIBS_SCOPE", "");
	const s = initialized(), prompt = vi.fn();
	const local = { ...readConfig(s.local), custom: { secret: "keep-local" }, adapters: { dex: { sync: false }, things: { human: "local-owner", custom: 42 } } };
	writeFileSync(join(s.local, "config.json"), JSON.stringify(local));
	vi.stubEnv("DIBS_THINGS_TOKEN", "never-copy-this-token");
	await initAdapter(settings(ctx), "none", true, prompt);
	expect(settings(ctx).adapters.things.sync).toBe(false);
	expect(readFileSync(join(s.local, "config.json"), "utf8")).not.toContain("keep-global");
	expect(readFileSync(join(s.local, "config.json"), "utf8")).not.toContain('"extra"');
	expect(readConfig(s.local)).toMatchObject({ ...local, adapters: { ...local.adapters, things: { ...local.adapters.things, sync: false } } });
	const enabled = await initAdapter(settings(ctx), "things", true, prompt);
	expect(enabled.instruction).toContain("macOS and Things 3");
	expect(enabled.instruction).toContain("DIBS_THINGS_TOKEN");
	expect(enabled.instruction).toContain("init --connect");
	expect(readConfig(s.local).adapters?.things?.sync).toBe(true);
	expect(readFileSync(join(s.local, "config.json"), "utf8")).not.toContain("never-copy-this-token");
	expect(JSON.parse(readFileSync(join(home, "config.json"), "utf8"))).toEqual(global);
	expect(readConfig(s.base).adapters).toBeUndefined();
	expect(prompt).not.toHaveBeenCalled(); expect(ctx.exec).not.toHaveBeenCalled();
});

test("opting in preserves inherited human filters and other adapters", async () => {
	const s = initialized();
	writeFileSync(join(process.env.DIBS_HOME!, "config.json"), JSON.stringify({ adapters: { things: { human: "owner" }, dex: { sync: false } } }));
	await initAdapter(settings(ctx), "things", false);
	expect(readConfig(s.local).adapters).toEqual({ things: { human: "owner", sync: true }, dex: { sync: false } });
});

test("CLI validates before writes, nonTTY returns guidance, JSON stays JSON and explicit flags work", () => {
	const cli = join(import.meta.dirname, "../src/cli/index.ts");
	const run = (...args: string[]) => spawnSync("nub", [cli, "init", ...args], { cwd: ctx.cwd, env: process.env, encoding: "utf8", timeout: 10000 });
	for (const args of [["--adapter=unknown"], ["--from=unknown", "--adapter=things"], ["--from=dex", "--adapter=unknown"]]) {
		expect(run(...args).status).toBe(1); expect(existsSync(join(ctx.cwd, ".dibs"))).toBe(false);
	}
	const plain = run(); expect(plain.status).toBe(0); expect(plain.stdout).toContain(adapterInstruction);
	const json = run("--json"); expect(json.status).toBe(0); expect(JSON.parse(json.stdout)).toMatchObject({ adapter: null, instruction: adapterInstruction });
	vi.stubEnv("DIBS_THINGS_TOKEN", "");
	const connected = run("--json", "--adapter=things");
	expect(connected.status).toBe(0);
	expect(JSON.parse(connected.stdout)).toMatchObject({ adapter: "things", connection: { status: "pending", read: "not-tested" } });
	expect(settings(ctx).adapters.things.sync).toBe(true);
	const rerun = run("--json", "--connect");
	expect(rerun.status).toBe(0); expect(JSON.parse(rerun.stdout).connection.status).toBe("pending");
	expect(run("--adapter=none").status).toBe(0); expect(settings(ctx).adapters.things.sync).toBe(false);
	expect(JSON.parse(run("--json", "--connect").stdout).connection.status).toBe("disabled");
	expect(run().stdout).not.toContain(adapterInstruction);
});
