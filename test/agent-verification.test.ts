import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { agentChecks, detectAgent } from "../src/core/agent-verification.ts";
import { doctor } from "../src/core/doctor.ts";
let cwd: string;
beforeEach(() => {
 cwd = mkdtempSync(join(tmpdir(), "dibs-agent-"));
 for (const key of ["PI_CODING_AGENT", "PI_CODING_AGENT_DIR", "AI_AGENT", "CLAUDECODE", "CODEX_THREAD_ID", "DIBS_AGENT", "DIBS_FILE", "DIBS_SCOPE"]) vi.stubEnv(key, "");
 vi.stubEnv("HOME", cwd); vi.stubEnv("DIBS_HOME", join(cwd, "home"));
});
afterEach(() => vi.unstubAllEnvs());
function put(path: string, text: string) { mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, text); }
test("host markers and explicit override do not reinterpret arbitrary creators or API keys", () => {
 expect(homedir()).toBe(cwd);
 vi.stubEnv("DIBS_AGENT", "my-worker"); vi.stubEnv("ANTHROPIC_API_KEY", "secret"); expect(detectAgent()).toBeUndefined();
 vi.stubEnv("PI_CODING_AGENT", "true"); expect(detectAgent()).toBe("pi"); expect(detectAgent("cursor")).toBe("cursor");
 vi.stubEnv("PI_CODING_AGENT", ""); vi.stubEnv("AI_AGENT", "pi"); expect(detectAgent()).toBe("pi");
 vi.stubEnv("AI_AGENT", ""); vi.stubEnv("CLAUDECODE", "1"); expect(detectAgent()).toBe("claude-code");
 vi.stubEnv("CLAUDECODE", ""); vi.stubEnv("CODEX_THREAD_ID", "thread"); expect(detectAgent()).toBe("codex");
 expect(() => detectAgent("other")).toThrow("Unsupported agent");
});
test("missing evidence is actionable and runtime always remains unknown", () => {
 const checks = agentChecks(cwd, "pi"); expect(JSON.stringify(checks)).toContain("dibs init --agent pi --install-agent");
 expect(checks.find((c) => c.name === "agent-runtime")?.status).toBe("warn");
 expect(JSON.stringify(agentChecks(cwd))).toContain("host unknown");
});
test.each(['"npm:@dibs.ai/pi"', '{"source":"npm:@dibs.ai/pi@0.1.7","extensions":[]}'])("Pi package evidence never claims installation or runtime: %s", (entry) => {
 put(join(cwd, ".pi/agent/settings.json"), `{"packages":[${entry}]}`);
 const checks = agentChecks(cwd, "pi"); expect(checks.some((c) => c.status === "pass")).toBe(false);
 expect(JSON.stringify(checks)).toContain("Pi dibs package configured"); expect(JSON.stringify(checks)).toContain("not verified");
});
test("Pi override, project config and local package identity are bounded", () => {
 vi.stubEnv("PI_CODING_AGENT_DIR", join(cwd, "pi-custom"));
 put(join(cwd, "pi-custom/settings.json"), '{"packages":["npm:not-dibs-pi"]}');
 put(join(cwd, "plugin/package.json"), '{"name":"@dibs.ai/pi"}');
 put(join(cwd, ".pi/settings.json"), JSON.stringify({ packages: [{ source: join(cwd, "plugin") }] }));
 expect(JSON.stringify(agentChecks(cwd, "pi"))).toContain("Pi dibs package configured");
});
test("malformed configuration is path-qualified and redacted", () => {
 const path = join(cwd, ".pi/agent/settings.json"); put(path, '{"secret":"never-leak", broken}');
 const text = JSON.stringify(agentChecks(cwd, "pi")); expect(text).toContain(path); expect(text).not.toContain("never-leak");
});
test("Codex skill and exact JSON MCP declarations are evidence only", () => {
 put(join(cwd, ".agents/skills/dibs/SKILL.md"), "dibs");
 expect(JSON.stringify(agentChecks(cwd, "codex"))).toContain("skill file present");
 put(join(cwd, ".cursor/mcp.json"), JSON.stringify({ mcpServers: { dibs: { command: "npx", args: ["-y", "@dibs.ai/dibs", "mcp"] } } }));
 expect(JSON.stringify(agentChecks(cwd, "cursor"))).toContain("MCP declaration present");
 put(join(cwd, ".cursor/mcp.json"), JSON.stringify({ mcpServers: { dibs: { command: "echo", args: ["@dibs.ai/dibs", "mcp"] } } }));
 expect(JSON.stringify(agentChecks(cwd, "cursor"))).not.toContain("MCP declaration present");
});
test("doctor does not exec or create files, including when a package is configured", () => {
 put(join(cwd, ".pi/agent/settings.json"), '{"packages":["npm:@dibs.ai/pi"]}');
 const path = join(cwd, ".pi/agent/settings.json"), before = readFileSync(path, "utf8"), entries = readdirSync(cwd);
 const exec = vi.fn(); doctor({ cwd, trusted: () => true, sessionId: () => "test", exec }, false, "pi");
 expect(exec).not.toHaveBeenCalled(); expect(readdirSync(cwd)).toEqual(entries); expect(readFileSync(path, "utf8")).toBe(before);
});
test("CLI validates override before init writes and returns one JSON document with guidance", () => {
 const run = (...args: string[]) => spawnSync("nub", [join(import.meta.dirname, "../src/cli/index.ts"), ...args], { cwd, env: process.env, encoding: "utf8" });
 vi.stubEnv("PI_CODING_AGENT", ""); vi.stubEnv("AI_AGENT", ""); vi.stubEnv("CLAUDECODE", ""); vi.stubEnv("CODEX_THREAD_ID", ""); vi.stubEnv("DIBS_AGENT", "");
 const before = readdirSync(cwd);
 expect(run("init", "--install-agent", "--json").status).toBe(1); expect(readdirSync(cwd)).toEqual(before);
 expect(run("init", "--agent=bad", "--json").status).toBe(1); expect(readdirSync(cwd)).toEqual(before);
 const result = run("init", "--agent=pi", "--adapter=none", "--json"); expect(result.status).toBe(0);
 const data = JSON.parse(result.stdout); expect(data.agentInstruction).toContain("consent"); expect(data.agentInstruction).toContain("dibs init --agent pi --install-agent");
 expect(JSON.stringify(data.doctor)).toContain("for pi");
 const standalone = JSON.parse(run("doctor", "--agent=cursor", "--json").stdout); expect(JSON.stringify(standalone)).toContain("for cursor");
});
