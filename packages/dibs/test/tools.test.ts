import { expect, vi, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("@earendil-works/pi-tui", () => ({ truncateToWidth: (t: string) => t, Text: class { setText() {} render() { return []; } } }));
vi.mock("@earendil-works/pi-coding-agent", () => ({ getAgentDir: () => `${process.env.HOME}/.pi/agent` }));
process.env.DIBS_HOME = mkdtempSync(join(tmpdir(), "dibs-home-"));
const { toolArgs } = await import("../src/core/tools.ts");
const { default: extension } = await import("../../../plugins/pi/index.ts");

const o = { creator: "me-agent", claim: "c1", user: async () => "octo" };

test("edit with only human \"\" clears the assignee", async () => {
	expect(await toolArgs("edit", { id: "x", human: "" }, o)).toEqual(["edit", "x", "--human", ""]);
});
test("empty description on create is dropped; human is the current user", async () => {
	const a = await toolArgs("create", { name: "n", description: "" }, o);
	expect(a).not.toContain("--description");
	expect(a).toEqual(["create", "n", "--created-by", "me-agent", "--claim", "c1", "--human", "octo"]);
});
test("human me resolves via user()", async () => {
	expect(await toolArgs("list", { human: "me" }, o)).toEqual(["list", "--human", "octo"]);
});
test("blocked_by arrays are joined", async () => {
	expect(await toolArgs("edit", { id: "x", blocked_by: ["a", "b"] }, o)).toEqual(["edit", "x", "--blocked-by", "a,b"]);
});
test("status completed adds claim and force", async () => {
	expect(await toolArgs("status", { id: "x", status: "completed", force: true }, o)).toEqual(["complete", "x", "--result", "Completed", "--claim", "c1", "--force"]);
});

test("Pi tracks the full id when started by a short prefix", async () => {
	const dir = mkdtempSync(join(tmpdir(), "dibs-tools-")), prev = process.env.DIBS_FILE;
	process.env.DIBS_FILE = join(dir, "tasks.jsonl");
	try {
		const tools: Record<string, any> = {}, entries: any[] = [];
		extension({ registerTool: (t: any) => (tools[t.name] = t), registerCommand() {}, registerShortcut() {}, on() {}, appendEntry: (_k: string, d: any) => entries.push(d), exec() { throw new Error("no exec"); } } as any);
		const ctx = { cwd: dir, hasUI: false, isProjectTrusted: () => true, ui: { notify() {} }, sessionManager: { getSessionId: () => "s" } };
		const call = async (n: string, p: any) => (await tools[n].execute("c", p, undefined, undefined, ctx)).content[0].text;
		const full = (await call("todo_create", { name: "one", description: "" })).match(/Created task (\S+)/)![1];
		expect(entries).toEqual([]);
		await call("todo_status", { id: full.slice(full.indexOf("-") + 1), status: "started" });
		expect(entries).toEqual([{ id: full }]);
	} finally {
		if (prev === undefined) delete process.env.DIBS_FILE; else process.env.DIBS_FILE = prev;
		rmSync(dir, { recursive: true, force: true });
	}
});
