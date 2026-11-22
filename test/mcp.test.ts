import { expect, test } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("mcp server exposes the six task tools", async () => {
	const dir = mkdtempSync(join(tmpdir(), "dibs-mcp-"));
	const client = new Client({ name: "test", version: "0" });
	await client.connect(new StdioClientTransport({
		command: "nub", args: [join(import.meta.dirname, "../src/cli/index.ts"), "mcp"], cwd: dir,
		env: { ...process.env as Record<string, string>, DIBS_HOME: dir, DIBS_TRUST: "1", DIBS_SCOPE: "project", DIBS_SESSION: "mcp-test" },
	}));
	try {
		expect(client.getServerVersion()?.version).toBe(JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf8")).version);
		const text = (r: any) => r.content[0].text as string;
		expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual(["todo_create", "todo_edit", "todo_link", "todo_list", "todo_panel", "todo_resolve", "todo_status"]);
		const created = text(await client.callTool({ name: "todo_create", arguments: { name: "mcp thing", description: "" } }));
		const id = /Created task (\S+)/.exec(created)![1];
		const pan = JSON.parse(text(await client.callTool({ name: "todo_panel", arguments: { view: "project" } })));
		expect(pan.title).toMatch(/^Project tasks \(/);
		expect(JSON.stringify(pan.rows)).toContain("mcp thing");
		expect(text(await client.callTool({ name: "todo_list", arguments: {} }))).toContain("mcp thing");
		expect((await client.callTool({ name: "todo_status", arguments: { id, status: "completed" } })).isError).toBeFalsy();
		expect((await client.callTool({ name: "todo_edit", arguments: { id } })).isError).toBe(true);
	} finally { await client.close(); rmSync(dir, { recursive: true, force: true }); }
}, 30000);
