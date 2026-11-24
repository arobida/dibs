import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { DoctorCheck } from "./doctor.ts";

export type AgentHost = "pi" | "claude-code" | "codex" | "opencode" | "cursor";
const known = (value: string | undefined): value is AgentHost => ["pi", "claude-code", "codex", "opencode", "cursor"].includes(value ?? "");
export function detectAgent(override?: string): AgentHost | undefined {
	if (override !== undefined) {
		if (!known(override)) throw new Error("Unsupported agent; use --agent pi|claude-code|codex|opencode|cursor");
		return override;
	}
	if (process.env.PI_CODING_AGENT === "true" || process.env.AI_AGENT === "pi") return "pi";
	if (process.env.CLAUDECODE) return "claude-code";
	if (process.env.CODEX_THREAD_ID) return "codex";
	return known(process.env.DIBS_AGENT) ? process.env.DIBS_AGENT : undefined;
}

export function agentSetupInstruction(agent?: AgentHost): string {
	const consent = "Ask for user consent before installing or changing agent configuration. ";
	if (agent) return `${consent}Run dibs init --agent ${agent} --install-agent after consent, then ${agent === "pi" ? "/reload in Pi" : `restart ${agent}`}. Commands/configuration do not prove runtime tool registration.`;
	return "Ask for user consent first, then select --agent pi|claude-code|codex|opencode|cursor and run dibs init --agent <host> --install-agent.";
}

// Only bounded, documented locations are inspected; configuration never proves runtime registration.
export function agentChecks(cwd: string, agent?: AgentHost): DoctorCheck[] {
	const checks: DoctorCheck[] = [];
	const add = (status: DoctorCheck["status"], message: string) => checks.push({ name: "agent-config", status, message });
	const readJson = (path: string): any => {
		try { return JSON.parse(readFileSync(path, "utf8")); }
		catch (error: any) {
			if (error.code !== "ENOENT") add("warn", `Agent configuration unreadable or invalid: ${path}`);
			return undefined;
		}
	};
	let evidence = false;
	if (agent === "pi") {
		for (const path of [join(process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"), "settings.json"), join(cwd, ".pi", "settings.json")]) {
			const config = readJson(path);
			if (!config) continue;
			if (config.packages !== undefined && !Array.isArray(config.packages)) { add("warn", `Invalid Pi packages configuration: ${path}`); continue; }
			for (const entry of config.packages ?? []) {
				const source = typeof entry === "string" ? entry : entry?.source;
				if (typeof source !== "string") continue;
				let matches = /^npm:@dibs\.ai\/pi(?:@[^\s]+)?$/.test(source);
				if (!matches && /^(?:\/|\.\.?\/|~\/)/.test(source)) {
					const local = source.startsWith("~/") ? join(homedir(), source.slice(2)) : resolve(dirname(path), source);
					matches = readJson(join(local, "package.json"))?.name === "@dibs.ai/pi";
				}
				if (!matches) continue;
				evidence = true;
				add("warn", `Pi dibs package configured in ${path}; package installation and extension resource filters are not verified. Configuration is not proof the extension is loaded.`);
			}
		}
	} else if (agent) {
		if (agent === "claude-code") {
			const path = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "plugins/installed_plugins.json");
			const config = readJson(path);
			if (config?.plugins && Object.hasOwn(config.plugins, "dibs@dibs")) {
				evidence = true;
				add("warn", `Claude dibs plugin configured in ${path}; installation and runtime loading not verified.`);
			}
		}
		const folders = agent === "codex" ? [".agents"] : agent === "opencode" ? [".opencode", ".claude", ".agents"] : [agent === "claude-code" ? ".claude" : ".cursor"];
		const paths = folders.flatMap((folder) => [join(cwd, folder, "skills/dibs/SKILL.md"), join(homedir(), agent === "opencode" && folder === ".opencode" ? ".config/opencode" : folder, "skills/dibs/SKILL.md")]);
		for (const path of paths) {
			try {
				readFileSync(path, "utf8"); evidence = true;
				add("pass", `dibs skill file present: ${path}; contents and runtime loading not verified.`);
			} catch (error: any) { if (error.code !== "ENOENT") add("warn", `Skill unreadable: ${path}`); }
		}
		const configs = agent === "claude-code" ? [join(cwd, ".mcp.json")] : agent === "cursor" ? [join(cwd, ".cursor/mcp.json"), join(homedir(), ".cursor/mcp.json")] : agent === "opencode" ? [join(cwd, "opencode.json"), join(homedir(), ".config/opencode/opencode.json")] : [];
		for (const path of configs) {
			const config = readJson(path);
			const server = agent === "opencode" ? config?.mcp?.dibs : config?.mcpServers?.dibs;
			const command = agent === "opencode" ? server?.command : [server?.command, ...(Array.isArray(server?.args) ? server.args : [])];
			if (Array.isArray(command) && command[0] === "npx" && command.slice(1).filter((x: unknown) => x !== "-y").join(" ") === "@dibs.ai/dibs mcp") {
				evidence = true;
				add(server?.enabled === false || server?.disabled === true ? "warn" : "pass", `dibs MCP declaration present: ${path}; enabled state, installed package and live tools not verified.`);
			}
		}
	}
	if (!evidence) add("warn", `No dibs agent configuration evidence found${agent ? ` for ${agent}` : " (host unknown)"}. ${agentSetupInstruction(agent)}`);
	checks.push({ name: "agent-runtime", status: "warn", message: "Current-session tool registration unknown. The agent must check its available todo_list, todo_create, todo_edit, todo_status, todo_link and todo_resolve tool inventory without invoking task tools or syncing. Filesystem configuration is not proof of installed packages or loaded tools." });
	return checks;
}
