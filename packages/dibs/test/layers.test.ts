import { expect, test } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const plugins = "../../plugins";
const ts = (dir: string): string[] => readdirSync(dir).filter((n) => n !== "node_modules").flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? ts(p) : p.endsWith(".ts") ? [p] : []; });
const imports = (f: string) => [...readFileSync(f, "utf8").matchAll(/(?:from|import\()\s*["']([^"']+)["']/g)].map((m) => m[1]);

test("src/core imports no host, agent or CLI code", () => {
	for (const f of ts("src/core")) for (const i of imports(f)) expect([f, /@earendil-works|^typebox|plugins|src\/cli|\/cli\//.test(i)]).toEqual([f, false]);
});

test("agents never import another agent", () => {
	for (const a of readdirSync(plugins).filter((n) => n !== "shared" && statSync(join(plugins, n)).isDirectory()))
		for (const f of ts(join(plugins, a))) for (const i of imports(f)) {
			const other = /plugins\/([^/]+)/.exec(i)?.[1];
			expect([f, !other || other === a || other === "shared"]).toEqual([f, true]);
		}
});

const rel = (f: string) => imports(f).filter((i) => i.startsWith(".")).map((i) => resolve(f, "..", i));
const dir = (p: string) => resolve(p) + "/";

test("agents never resolve into another agent", () => {
	for (const a of readdirSync(plugins).filter((n) => n !== "shared" && statSync(join(plugins, n)).isDirectory()))
		for (const f of ts(join(plugins, a))) for (const t of rel(f)) {
			const other = /\/plugins\/([^/]+)/.exec(t)?.[1];
			expect([f, !other || other === a || other === "shared"]).toEqual([f, true]);
		}
});

test("src/core never resolves into agents or src/cli", () => {
	for (const f of ts("src/core")) for (const t of rel(f)) expect([f, t.startsWith(dir(plugins)) || t.startsWith(dir("src/cli"))]).toEqual([f, false]);
});

test("src/cli imports only src/core, node and the MCP SDK", () => {
	for (const f of ts("src/cli")) for (const i of imports(f)) expect([f, i.startsWith("node:") || i.startsWith("@modelcontextprotocol/") || i === "zod" || /^\.\.\/core\//.test(i) || i === "./mcp.ts"]).toEqual([f, true]);
});
