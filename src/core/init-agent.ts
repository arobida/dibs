import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import type { Ctx } from "./ctx.ts";
import { agentChecks, agentSetupInstruction, type AgentHost } from "./agent-verification.ts";

export interface AgentSetupResult {
	status: "pending" | "configured" | "error" | "unchanged";
	message: string;
	changedPaths: string[];
}

async function confirmSetup(agent: AgentHost): Promise<string | undefined> {
	const scope = ["pi", "claude-code", "codex"].includes(agent) ? "USER/global agent configuration (Codex also writes a project skill)" : "project skill and MCP files";
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		return await new Promise((resolve) => {
			rl.once("close", () => resolve(undefined)); rl.once("SIGINT", () => resolve(undefined));
			rl.question(`Set up dibs for ${agent}? Changes ${scope}; downstream security prompts are not bypassed. [y/N] `, resolve);
		});
	} finally { rl.close(); }
}

export async function initAgent(ctx: Ctx, agent: AgentHost | undefined, options: {
	consent?: boolean; interactive: boolean; confirm?: () => Promise<string | undefined>;
}): Promise<AgentSetupResult> {
	const changedPaths: string[] = [];
	const result = (status: AgentSetupResult["status"], message: string): AgentSetupResult => ({ status, message, changedPaths });
	if (!agent) return result("pending", agentSetupInstruction());
	const instruction = agentSetupInstruction(agent);
	const checks = agentChecks(ctx.cwd, agent);
	if (!options.consent && checks.some(c => c.name === "agent-config" && /(?:present:|configured in)/.test(c.message))) return result("unchanged", `Existing agent configuration preserved. ${instruction}`);
	if (!options.consent) {
		if (!options.interactive) return result("pending", instruction);
		const answer = (await (options.confirm ?? (() => confirmSetup(agent)))())?.trim().toLowerCase();
		if (answer !== "y" && answer !== "yes") return result("pending", `Agent setup deferred; no agent files changed. ${instruction}`);
	}
	let command = "agent setup";
	try {
		const exec = async (cmd: string, args: string[]) => {
			command = `${cmd} ${args.join(" ")}`;
			const response = await ctx.exec(cmd, args);
			if (response.code !== 0) throw new Error("command failed");
		};
		if (agent === "pi") await exec("pi", ["install", "@dibs.ai/pi"]);
		else if (agent === "claude-code") {
			await exec("claude", ["plugin", "marketplace", "add", "arobida/dibs"]);
			await exec("claude", ["plugin", "install", "dibs@dibs"]);
		} else {
			const skill = join(ctx.cwd, agent === "codex" ? ".agents" : `.${agent}`, "skills/dibs/SKILL.md");
			if (!existsSync(skill)) {
				const content = readFileSync(join(import.meta.dirname, "../../agents/shared/skills/dibs/SKILL.md"));
				mkdirSync(dirname(skill), { recursive: true });
				try { writeFileSync(skill, content, { flag: "wx" }); changedPaths.push(skill); }
				catch (error: any) { if (error.code !== "EEXIST") throw error; }
			}
			if (agent === "codex") {
				command = "codex mcp list --json";
				const listed = await ctx.exec("codex", ["mcp", "list", "--json"]);
				if (listed.code !== 0) throw new Error("Cannot inspect Codex MCP configuration");
				const servers: unknown = JSON.parse(listed.stdout);
				if (!Array.isArray(servers) || servers.some(server => !server || typeof server.name !== "string")) throw new Error("Invalid Codex MCP configuration");
				if (servers.some(server => server.name === "dibs")) return result("pending", "Project skill preserved/installed. Existing dibs MCP server preserved; review it in Codex before making changes. Restart Codex; runtime tools remain unverified.");
				await exec("codex", ["mcp", "add", "dibs", "--", "npx", "-y", "@dibs.ai/dibs", "mcp"]);
			} else {
				const path = join(ctx.cwd, agent === "cursor" ? ".cursor/mcp.json" : "opencode.json");
				const object = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
				const config = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
				const key = agent === "cursor" ? "mcpServers" : "mcp";
				if (!object(config) || (config[key] !== undefined && !object(config[key]))) return result("pending", `Invalid MCP object; ${path} preserved. Repair manually, then rerun init. Runtime tools unverified.`);
				if (Object.hasOwn(config[key] ?? {}, "dibs")) return result("pending", `Existing dibs MCP entry in ${path} preserved; review conflicts manually. Restart the host; runtime tools unverified.`);
				config[key] = { ...config[key], dibs: agent === "cursor" ? { command: "npx", args: ["-y", "@dibs.ai/dibs", "mcp"] } : { type: "local", command: ["npx", "-y", "@dibs.ai/dibs", "mcp"], enabled: true } };
				mkdirSync(dirname(path), { recursive: true });
				const temp = `${path}.${randomUUID()}.tmp`;
				try { writeFileSync(temp, `${JSON.stringify(config, null, 2)}\n`, { flag: "wx", mode: 0o600 }); renameSync(temp, path); }
				finally { if (existsSync(temp)) unlinkSync(temp); }
				changedPaths.push(path);
			}
		}
		return result("configured", `Setup commands/files completed; not proof of installed or runtime tools. ${agent === "pi" ? "Run /reload in Pi" : `Restart ${agent}`}. ${["codex", "cursor", "opencode"].includes(agent) ? "Skill and MCP setup only; no native panel installed." : ""}`);
	} catch {
		return result("error", `Agent setup failed during ${command}; check executable availability, permissions and host security prompts, then retry with --install-agent. Subprocess output withheld. Existing conflicting or malformed configuration was not replaced. Storage initialization was saved; no rollback performed.`);
	}
}
