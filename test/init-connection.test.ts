import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { chmodSync, mkdtempSync, existsSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initConnection, promptThingsToken } from "../src/core/init-connection.ts";
import { EventEmitter } from "node:events";
import { saveThingsToken } from "../src/core/adapters/things/index.ts";
import { initStore, settings } from "../src/core/store.ts";
import type { Ctx } from "../src/core/ctx.ts";

let ctx: Ctx;
let path: string;
beforeEach(() => {
	vi.stubEnv("DIBS_HOME", mkdtempSync(join(tmpdir(), "dibs-connection-home-")));
	vi.stubEnv("DIBS_FILE", ""); vi.stubEnv("DIBS_SCOPE", "project"); vi.stubEnv("DIBS_THINGS_TOKEN", "");
	vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
	ctx = { cwd: mkdtempSync(join(tmpdir(), "dibs-connection-")), trusted: () => true, sessionId: () => "connection", exec: vi.fn(async () => ({ code: 0, stdout: "null", stderr: "" })) };
	initStore(ctx); path = join(process.env.DIBS_HOME!, "adapters", "things.json");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
const enabled = () => ({ ...settings(ctx), adapters: { things: { sync: true } } });

test.each(["\r", "\u0003", "\u0004", "end"])("hidden prompt never echoes and restores terminal on %s", async (ending) => {
	const input = Object.assign(new EventEmitter(), { isTTY: true, isRaw: false, setRawMode: vi.fn(), resume: vi.fn(), pause: vi.fn() });
	const output = { isTTY: true, write: vi.fn() };
	vi.spyOn(process, "stdin", "get").mockReturnValue(input as unknown as typeof process.stdin);
	vi.spyOn(process, "stdout", "get").mockReturnValue(output as unknown as typeof process.stdout);
	const result = promptThingsToken();
	input.emit("data", Buffer.from("private-token"));
	if (ending === "end") input.emit("end"); else input.emit("data", Buffer.from(ending));
	expect(await result).toBe(ending === "\r" ? "private-token" : undefined);
	expect(output.write.mock.calls.flat().join("")).not.toContain("private-token");
	expect(input.setRawMode.mock.invocationCallOrder[0]).toBeLessThan(output.write.mock.invocationCallOrder[0]);
	expect(input.setRawMode.mock.calls).toEqual([[true], [false]]);
	expect(input.listenerCount("data")).toBe(0); expect(input.listenerCount("end")).toBe(0);
});

test("disabled performs no credential inspection, prompt or exec even with consent", async () => {
	const promptToken = vi.fn(), confirm = vi.fn();
	const s = enabled(); s.adapters.things.sync = false;
	expect((await initConnection(ctx, s, { consent: true, interactive: true, promptToken, confirm })).status).toBe("disabled");
	expect(promptToken).not.toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled(); expect(ctx.exec).not.toHaveBeenCalled();
});

test("unsupported platform checks before prompts or execution", async () => {
	vi.spyOn(process, "platform", "get").mockReturnValue("linux");
	const promptToken = vi.fn(), confirm = vi.fn();
	expect(await initConnection(ctx, enabled(), { consent: true, interactive: true, promptToken, confirm })).toMatchObject({ status: "pending", message: expect.stringContaining("macOS") });
	expect(promptToken).not.toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled(); expect(ctx.exec).not.toHaveBeenCalled();
});

test("noninteractive requires connection consent even with credentials", async () => {
	vi.stubEnv("DIBS_THINGS_TOKEN", "private-token");
	expect((await initConnection(ctx, enabled(), { interactive: false })).message).toContain("init --connect");
	expect(ctx.exec).not.toHaveBeenCalled();
});

test("noninteractive missing credential gives private setup guidance without hanging", async () => {
	const promptToken = vi.fn();
	const result = await initConnection(ctx, enabled(), { consent: true, interactive: false, promptToken });
	expect(result).toMatchObject({ status: "pending", credential: "missing" });
	expect(result.message).toContain("Never put the token in chat or a CLI argument");
	expect(promptToken).not.toHaveBeenCalled(); expect(ctx.exec).not.toHaveBeenCalled();
});

test.each([undefined, "", "no", "maybe"])("TTY connection answer %s does not consent", async (answer) => {
	const promptToken = vi.fn();
	expect((await initConnection(ctx, enabled(), { interactive: true, confirm: async () => answer, promptToken })).status).toBe("pending");
	expect(promptToken).not.toHaveBeenCalled(); expect(ctx.exec).not.toHaveBeenCalled();
});

test("consented hidden token entry saves privately and only reads Things", async () => {
	const result = await initConnection(ctx, enabled(), { interactive: true, confirm: async () => "yes", promptToken: async () => "private-token" });
	expect(result).toMatchObject({ status: "connected", credential: "shape-valid", read: "connected" });
	expect(result.message).toContain("not authenticated");
	expect(JSON.stringify(result)).not.toContain("private-token");
	expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ token: "private-token" });
	expect(statSync(path).mode & 0o777).toBe(0o600);
	expect(ctx.exec).toHaveBeenCalledOnce();
	const [command, args] = vi.mocked(ctx.exec).mock.calls[0];
	expect(command).toBe("osascript"); expect(args.slice(0, 3)).toEqual(["-l", "JavaScript", "-e"]);
	expect(args.at(-1)).toBe(enabled().name); expect(args.join(" ")).not.toContain("private-token");
	expect(readFileSync(join(enabled().local, "config.json"), "utf8")).not.toContain("private-token");
});

test("replacing an existing token keeps the new credential file private", () => {
 saveThingsToken("old-token");chmodSync(path,0o644);saveThingsToken("new-token");
 expect(statSync(path).mode & 0o777).toBe(0o600);expect(JSON.parse(readFileSync(path,"utf8"))).toEqual({token:"new-token"});
});

test.each(["env", "file"])("reuses %s token without prompting or needless save", async (source) => {
	if (source === "env") vi.stubEnv("DIBS_THINGS_TOKEN", "private-token"); else saveThingsToken("private-token");
	const promptToken = vi.fn();
	expect((await initConnection(ctx, enabled(), { consent: true, interactive: true, promptToken })).status).toBe("connected");
	expect(promptToken).not.toHaveBeenCalled();
	if (source === "env") expect(existsSync(path)).toBe(false);
});

test.each([undefined, "bad token"])("cancelled/invalid token %s leaves credentials unchanged", async (answer) => {
	saveThingsToken("existing-token"); vi.stubEnv("DIBS_THINGS_TOKEN", "invalid token");
	const before = readFileSync(path, "utf8");
	expect((await initConnection(ctx, enabled(), { consent: true, interactive: true, promptToken: async () => answer })).status).toBe("pending");
	expect(readFileSync(path, "utf8")).toBe(before); expect(ctx.exec).not.toHaveBeenCalled();
});

test.each([false, true])("external failures are redacted (throws=%s) and do not imply rollback", async (throws) => {
	vi.stubEnv("DIBS_THINGS_TOKEN", "private-token");
	vi.mocked(ctx.exec).mockImplementation(async () => { if (throws) throw new Error("private-token"); return { code: 1, stdout: "private-token", stderr: "private-token" }; });
	const result = await initConnection(ctx, enabled(), { consent: true, interactive: false });
	expect(result).toMatchObject({ status: "error", credential: "shape-valid", read: "failed" });
	expect(JSON.stringify(result)).not.toContain("private-token"); expect(result.message).toContain("Automation"); expect(result.message).toContain("no rollback");
});

 test("invalid env override prevents replacement save or probe", async () => {
 saveThingsToken("existing-token"); vi.stubEnv("DIBS_THINGS_TOKEN", "invalid token");
 const before = readFileSync(path, "utf8"), promptToken = vi.fn(async () => "replacement");
 const result = await initConnection(ctx, enabled(), { consent: true, interactive: true, promptToken });
 expect(result.message).toContain("Unset or fix DIBS_THINGS_TOKEN");
 expect(promptToken).not.toHaveBeenCalled(); expect(ctx.exec).not.toHaveBeenCalled(); expect(readFileSync(path,"utf8")).toBe(before);
 });
