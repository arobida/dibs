import { accessSync, constants, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Ctx } from "./ctx.ts";
import { readThingsToken } from "./adapters/things/index.ts";
import { agentName } from "./identity.ts";
import { dibsHome, localDir, projectRoot, readConfig, settings } from "./store.ts";
import { home } from "./util.ts";
import { toTask } from "./todo.ts";
import { agentChecks, detectAgent, type AgentHost } from "./agent-verification.ts";

export interface DoctorCheck { name: string; status: "pass" | "warn" | "error"; message: string }
export interface DoctorReport {
	ok: boolean;
	checks: DoctorCheck[];
	storage?: { root: string; scope: string; file: string; projectId?: string };
	identity: { creator: string; owner: string; source: string };
}

// Installation verification only: never initializes storage or contacts an adapter.
export function doctor(ctx: Ctx, global = false, agent: AgentHost | undefined = detectAgent()): DoctorReport {
	const checks: DoctorCheck[] = agentChecks(projectRoot(ctx.cwd), agent);
	const add = (name: string, status: DoctorCheck["status"], message: string) => checks.push({ name, status, message });
	const report: DoctorReport = { ok: true, checks, identity: { creator: agentName(), owner: `cli:${process.env.DIBS_SESSION ?? agentName()}`, source: process.env.DIBS_SESSION !== undefined ? "DIBS_SESSION" : "shared fallback" } };
	add("node", Number(process.versions.node.split(".")[0]) >= 26 ? "pass" : "error", `Node ${process.versions.node}; requires Node >=26`);
	if (report.identity.source === "shared fallback") add("identity", "warn", "CLI owner uses a shared fallback; set DIBS_SESSION for a distinct owner.");
	try {
		const s = settings(ctx, global);
		const file = s.file ? resolve(ctx.cwd, home(s.file)) : join(s.base, "todos", `${s.name}.todos.jsonl`);
		const id = ctx.trusted() ? readConfig(s.local).id : undefined;
		report.storage = { root: s.root, scope: s.scope, file, ...(id ? { projectId: id } : {}) };
		add("config", "pass", `Configuration readable: ${join(dibsHome(), "config.json")}, ${join(s.local, "config.json")}, ${join(s.base, "config.json")} (absent configuration uses defaults)`);
		try {
			accessSync(file, constants.R_OK | constants.W_OK);
			const lines = readFileSync(file, "utf8").split("\n");
			for (let i = 0; i < lines.length; i++) {
				if (!lines[i].trim()) continue;
				try { toTask(JSON.parse(lines[i])); }
				catch { throw new Error(`Invalid task JSONL: ${file}:${i + 1}`); }
			}
			add("tasks", "pass", `Task store readable and writable; valid JSONL: ${file}`);
		} catch (error: any) {
			add("tasks", "error", error.message?.startsWith("Invalid task JSONL:") ? error.message : `Task store missing or inaccessible: ${file}. Run dibs init for uninitialized storage; otherwise check permissions.`);
		}
		if (s.file || s.scope === "temp") add("registry", s.scope === "temp" ? "warn" : "pass", `${s.file ? "Explicit-file" : "Temporary"} storage is not registered by design.`);
		else {
			const registry = join(dibsHome(), "projects", "projects.jsonl");
			try {
				const records = readFileSync(registry, "utf8").split("\n").filter((line) => line.trim()).map((line) => {
					const r = JSON.parse(line);
					if (!r || ["id", "name", "path", "scope", "created"].some((k) => typeof r[k] !== "string")) throw new Error();
					return r;
				});
				const r = records.find((r) => r.id === id);
				add("registry", r && r.path === s.root && r.scope === s.scope && r.name === s.name ? "pass" : "error", r && r.path === s.root && r.scope === s.scope && r.name === s.name ? `Project registered: ${registry}` : `Project registration missing or inconsistent: ${registry}. Run dibs init with the intended scope.`);
			} catch { add("registry", "error", `Project registry missing, unreadable or invalid: ${registry}. Run dibs init for uninitialized storage.`); }
		}
		if (s.adapters.dex?.sync) add("dex", "warn", "Dex sync is unsupported. Use dibs init --from dex for a one-time import.");
		if (s.adapters.things?.sync) {
			add("things-platform", process.platform === "darwin" ? "pass" : "warn", "Things requires macOS and Things 3.");
			const token = readThingsToken();
			const path = join(dibsHome(), "adapters", "things.json");
			add("things-credentials", typeof token === "string" && /^[\w-]+$/.test(token) ? "pass" : "warn", typeof token === "string" && /^[\w-]+$/.test(token) ? "Things credential shape valid (not authenticated)." : `Things credential missing, unreadable or invalid: ${path}. Run dibs init --connect for private credential setup.`);
			add("things-connection", "warn", "Things application, Automation permissions and live sync not tested. No commands run; connection unknown. Run dibs init --connect to test read access.");
		} else add("things", "pass", "Things sync disabled; credentials not inspected.");
	} catch (error: any) {
		// Parser errors may quote configuration contents, including accidentally stored secrets.
		const failedPath = /^(?:Invalid JSON in |Cannot read )(.+?)(?=: )/.exec(error.message)?.[1];
		const paths = [...(failedPath ? [failedPath] : []), join(localDir(projectRoot(ctx.cwd)), "config.json"), join(dibsHome(), "config.json"), join(dibsHome(), "projects", "projects.jsonl")];
		add("config", "error", `Configuration or scope invalid or unreadable; check ${paths.join(", ")} and DIBS_SCOPE. For uninitialized storage run dibs init.`);
	}
	report.ok = !checks.some((c) => c.status === "error");
	return report;
}

export const doctorText = (report: DoctorReport): string => [
	...(report.storage ? [`Storage: ${report.storage.scope} ${report.storage.file} (root ${report.storage.root})`] : []),
	`Identity: creator ${report.identity.creator}; owner ${report.identity.owner} (${report.identity.source})`,
	...report.checks.map((c) => `${c.status}: ${c.name}: ${c.message}`),
].join("\n");
