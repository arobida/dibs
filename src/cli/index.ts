#!/usr/bin/env node
/**
 * The `dibs` command-line interface. Run `dibs --help` for usage.
 * @module
 */
import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { checkName } from "../core/todo.ts";
import { home } from "../core/util.ts";
import { findRoot, link, migrate, resolveLink, setScope, settings, storeFile } from "../core/store.ts";
import { agentName, ghUser } from "../core/identity.ts";
import { runFile } from "../core/tasks.ts";
import { syncAll } from "../core/adapters/sync-all.ts";
import type { Ctx } from "../core/ctx.ts";
import { panel, panelText, views, type View } from "../core/panel.ts";

const usage = `usage: dibs [--global] [--json] <command>
  list [--query q] [--human u|me] | ready [--human u|me]
  create <name> [--description d] [--parent id] [--blocked-by a,b] [--human u]
  start <id> [--force] | complete <id> [--result r] [--force]
  edit <id> [--name n] [--description d] [--blocked-by a,b] [--human u ("" clears)]
  import <file> | export [file]
  sync                      sync enabled adapters (dex, things)
  link <id> | resolve <url>
  panel [current|project|completed] [--mine a,b]   task panel text (--json: rows)
  mcp                       serve the task tools over MCP (stdio)
  scope project|global | migrate .dibs|.agents/dibs
env: DIBS_AGENT names the creator; DIBS_USER sets your GitHub user; DIBS_TRUST=1 trusts cwd; DIBS_SESSION overrides the session id`;

const cwd = process.cwd();
const ctx: Ctx = {
	cwd,
	trusted: () => process.env.DIBS_TRUST === "1" || !!findRoot(cwd),
	sessionId: () => process.env.DIBS_SESSION ?? cwd, // one temp store per folder: every CLI call has a new parent process
	exec: (cmd, args, opts) => new Promise((ok) => execFile(cmd, args, { cwd: opts?.cwd ?? cwd, signal: opts?.signal, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
		if (!err) ok({ stdout, stderr, code: 0 });
		else if (typeof err.code === "string") ok({ stdout: "", stderr: err.message, code: 127 }); // could not start (ENOENT, ...)
		else ok({ stdout, stderr, code: err.code ?? 1 });
	})),
};

const cliClaim = `cli:${process.env.DIBS_SESSION ?? agentName()}`;
try {
	const { values: v, positionals: [cmd, arg] } = parseArgs({
		allowPositionals: true,
		options: { global: { type: "boolean" }, json: { type: "boolean" }, help: { type: "boolean" }, query: { type: "string" }, description: { type: "string" }, parent: { type: "string" }, "blocked-by": { type: "string" }, human: { type: "string" }, name: { type: "string" }, result: { type: "string" }, mine: { type: "string" }, force: { type: "boolean" } },
	});
	if (v.help || !cmd) { console.log(usage); process.exit(0); }
	const need = () => arg ?? (() => { throw new Error(`${cmd} needs an argument`); })();
	const out = (s: string) => console.log(s);
	if (cmd === "mcp") await (await import("./mcp.ts")).serveMcp(ctx);
	else if (cmd === "link") out(link(ctx, need()));
	else if (cmd === "resolve") out(resolveLink(need()));
	else if (cmd === "scope") out(await setScope(ctx, need()));
	else if (cmd === "migrate") out(migrate(ctx, need()));
	else if (cmd === "panel") {
		const view = (arg ?? "project") as View;
		if (!views.includes(view)) throw new Error(`panel view must be one of ${views.join(", ")}`);
		const tasks = JSON.parse(await runFile(storeFile(ctx, settings(ctx, v.global)), ["list"]));
		const p = panel(tasks, view, new Set(v.mine?.split(",").filter(Boolean)));
		out(v.json ? JSON.stringify(p) : panelText(p));
	}
	else if (cmd === "sync") {
		const s = settings(ctx, v.global), res = await syncAll(ctx, s, storeFile(ctx, s));
		for (const r of res) (r.error ? console.error : out)(r.error ? `${r.name}: sync failed: ${(r.error as Error).message ?? r.error}` : r.skipped ? `${r.name}: skipped, another process is syncing` : `${r.name}: synced`);
		if (!res.length) out("no adapters enabled");
		if (res.some((r) => r.error)) process.exit(1);
	}
	else {
		const opt = (k: string, flag = k) => v[k as "name"] === undefined ? [] : [`--${flag}`, v[k as "name"]!];
		let args: string[];
		const who = v.human === "me" ? await ghUser(ctx) ?? (() => { throw new Error("Cannot resolve --human me: set DIBS_USER or git config github.user"); })() : v.human;
		if (cmd === "list") args = ["list", ...opt("query"), ...(who === undefined ? [] : ["--human", who])];
		else if (cmd === "ready") args = ["ready", ...(who === undefined ? [] : ["--human", who])];
		else if (cmd === "create") { checkName(need()); args = ["create", arg, ...opt("description"), ...opt("parent"), ...opt("blocked-by"), "--created-by", agentName(), "--human", who ?? await ghUser(ctx) ?? ""]; }
		else if (cmd === "edit") {
			if (!v.name && v.description === undefined && v["blocked-by"] === undefined && v.human === undefined) throw new Error("edit needs --name, --description, --blocked-by or --human");
			args = ["edit", need(), ...opt("name"), ...opt("description"), ...opt("blocked-by"), ...(who === undefined ? [] : ["--human", who])];
		}
		else if (cmd === "start") args = ["start", need(), "--claim", cliClaim, ...(v.force ? ["--force"] : [])];
		else if (cmd === "complete") args = ["complete", need(), "--result", v.result || "Completed", "--claim", cliClaim, ...(v.force ? ["--force"] : [])];
		else if (cmd === "import") args = ["import", readFileSync(resolve(cwd, home(need())), "utf8")];
		else if (cmd === "export") args = ["export"];
		else throw new Error(`Unknown command: ${cmd}\n${usage}`);
		const raw = await runFile(storeFile(ctx, settings(ctx, v.global)), args);
		if (cmd === "export") {
			const { text, skipped } = JSON.parse(raw);
			if (arg) writeFileSync(resolve(cwd, home(arg)), text, { flag: "wx" }); // wx: never overwrite
			else process.stdout.write(text);
			if (skipped.length) console.error(`Not exported (todo.txt would misread these names):\n${skipped.join("\n")}`);
		} else if (cmd === "list" || cmd === "ready") {
			out(v.json ? raw : JSON.parse(raw).map((t: any) => `[${t.completed ? "x" : t.started_at ? "~" : " "}] ${t.id} ${t.name}${t.human ? ` @${t.human}` : ""}`).join("\n"));
		} else out(raw);
	}
} catch (e: any) {
	console.error(e.message ?? String(e));
	process.exit(1);
}
