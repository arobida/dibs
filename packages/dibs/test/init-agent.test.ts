import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { initAgent } from "../src/core/init-agent.ts";
import type { Ctx } from "../src/core/ctx.ts";
import { spawnSync } from "node:child_process";
import { initStore } from "../src/core/store.ts";
let ctx: Ctx;
beforeEach(() => {
 const root = mkdtempSync(join(tmpdir(), "dibs-agent-"));
 vi.stubEnv("HOME", root); vi.stubEnv("PI_CODING_AGENT_DIR", join(root,"pi")); vi.stubEnv("CODEX_HOME", join(root,"codex"));
 vi.stubEnv("DIBS_HOME", join(root,"dibs-home")); vi.stubEnv("DIBS_FILE", ""); vi.stubEnv("DIBS_SCOPE", "project"); vi.stubEnv("DIBS_THINGS_TOKEN", "");
 ctx = { cwd: join(root,"project"), trusted: () => true, sessionId: () => "test", exec: vi.fn(async (cmd: string, args: string[]) => ({ code: 0, stdout: cmd === "codex" && args[1] === "list" ? "[]" : "", stderr: "" })) };
 mkdirSync(ctx.cwd);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
test.each([undefined, "", "no"])("no consent %s never writes/executes", async answer => {
 expect((await initAgent(ctx,"cursor",{ interactive:true,confirm:async()=>answer })).status).toBe("pending");
 expect(existsSync(join(ctx.cwd,".cursor"))).toBe(false); expect(ctx.exec).not.toHaveBeenCalled();
});
test("nonTTY never installs", async()=> {
 await initAgent(ctx,"pi",{interactive:false}); expect(ctx.exec).not.toHaveBeenCalled();
});
test.each(["pi","claude-code"] as const)("explicit %s commands and no runtime claim",async agent=> {
 const result=await initAgent(ctx,agent,{interactive:false,consent:true});
 expect(result.status).toBe("configured"); expect(result.message).toContain("not proof");
 expect(vi.mocked(ctx.exec).mock.calls.map(c=>[c[0],c[1]])).toEqual(agent === "pi" ? [["pi",["install","@dibs.ai/pi"]]] : [["claude",["plugin","marketplace","add","arobida/dibs"]],["claude",["plugin","install","dibs@dibs"]]]);
});
test("redacts errors and stdout/stderr",async()=> {
 vi.mocked(ctx.exec).mockResolvedValue({code:1,stdout:"SECRET",stderr:"SECRET"});
 const result=await initAgent(ctx,"pi",{interactive:false,consent:true});
 expect(result.status).toBe("error"); expect(JSON.stringify(result)).not.toContain("SECRET"); expect(result.message).toContain("no rollback");
});
test.each(["cursor","opencode"] as const)("%s merges and preserves customized files on explicit rerun",async agent=> {
 const path=join(ctx.cwd,agent==="cursor"?".cursor/mcp.json":"opencode.json"); mkdirSync(dirname(path),{recursive:true}); writeFileSync(path,'{"custom":42}');
 const result=await initAgent(ctx,agent,{consent:true,interactive:false}); expect(result.status).toBe("configured");
 expect(JSON.parse(readFileSync(path,"utf8")).custom).toBe(42);expect(statSync(path).mode & 0o777).toBe(0o600);
 const skill=join(ctx.cwd,`.${agent}/skills/dibs/SKILL.md`);writeFileSync(skill,"custom skill");
 const before=readFileSync(path,"utf8"); await initAgent(ctx,agent,{consent:true,interactive:false});
 expect(readFileSync(path,"utf8")).toBe(before);expect(readFileSync(skill,"utf8")).toBe("custom skill"); expect(ctx.exec).not.toHaveBeenCalled();
 const confirm=vi.fn();expect((await initAgent(ctx,agent,{interactive:true,confirm})).status).toBe("unchanged");expect(confirm).not.toHaveBeenCalled();
});
test.each(['broken', '[]','{"mcpServers":[]}','{"mcpServers":{"dibs":{"command":"custom"}}}'])("preserves unsafe cursor config %s",async content=> {
 const path=join(ctx.cwd,".cursor/mcp.json");mkdirSync(dirname(path),{recursive:true});writeFileSync(path,content);
 expect((await initAgent(ctx,"cursor",{interactive:false,consent:true})).status).not.toBe("configured");expect(readFileSync(path,"utf8")).toBe(content);
});
test("Codex preserves an existing dibs server without parsing or rewriting TOML",async()=> {
 const path=join(process.env.CODEX_HOME!,"config.toml");mkdirSync(dirname(path),{recursive:true});writeFileSync(path,'[mcp_servers.dibs]\ncommand="custom"');
 vi.mocked(ctx.exec).mockResolvedValue({ code: 0, stdout: '[{"name":"dibs"}]', stderr: "" });
 expect((await initAgent(ctx,"codex",{interactive:false,consent:true})).status).toBe("pending");expect(ctx.exec).toHaveBeenCalledExactlyOnceWith("codex",["mcp","list","--json"]);expect(readFileSync(path,"utf8")).toContain('command="custom"');
});
test("Codex adds dibs alongside other servers using the host CLI",async()=> {
 vi.mocked(ctx.exec).mockResolvedValue({ code: 0, stdout: '[{"name":"other"}]', stderr: "" });
 await initAgent(ctx,"codex",{interactive:false,consent:true});expect(ctx.exec).toHaveBeenCalledWith("codex",["mcp","add","dibs","--","npx","-y","@dibs.ai/dibs","mcp"]);
});
test.each(['invalid', '{}', '[{}]'])("Codex inspection %s cannot authorize overwriting configuration",async stdout=> {
 vi.mocked(ctx.exec).mockResolvedValue({ code: 0, stdout, stderr: "" });
 expect((await initAgent(ctx,"codex",{interactive:false,consent:true})).status).toBe("error");expect(ctx.exec).toHaveBeenCalledTimes(1);
});
test("skill asset resolves from source and build and is packaged",()=> {
 for(const base of ["src/core","lib/core"])expect(existsSync(join(process.cwd(),base,"../../skills/dibs/SKILL.md"))).toBe(true);
 expect(JSON.parse(readFileSync("package.json","utf8")).files).toContain("skills/");
});
test.each(["pi", "claude-code"] as const)("configured %s does not reprompt but explicit repair executes",async agent=> {
 const path=agent==="pi" ? join(process.env.PI_CODING_AGENT_DIR!,"settings.json") : join(process.env.HOME!,".claude/plugins/installed_plugins.json");
 mkdirSync(dirname(path),{recursive:true});writeFileSync(path,JSON.stringify(agent==="pi"?{packages:["npm:@dibs.ai/pi"]}:{plugins:{"dibs@dibs":[{scope:"user"}]}}));
 const confirm=vi.fn(); expect((await initAgent(ctx,agent,{interactive:true,confirm})).status).toBe("unchanged");expect(confirm).not.toHaveBeenCalled();expect(ctx.exec).not.toHaveBeenCalled();
 await initAgent(ctx,agent,{interactive:false,consent:true});expect(ctx.exec).toHaveBeenCalled();
});
test("CLI setup from a nested folder writes host files at the resolved project root",()=> {
 initStore(ctx); const nested=join(ctx.cwd,"nested");mkdirSync(nested);
 const run=spawnSync("nub",[join(import.meta.dirname,"../src/cli/index.ts"),"init","--agent=cursor","--install-agent","--adapter=none","--json"],{cwd:nested,env:process.env,encoding:"utf8",timeout:10000});
 expect(run.status).toBe(0);expect(JSON.parse(run.stdout).agentSetup.status).toBe("configured");
 expect(existsSync(join(ctx.cwd,".cursor/mcp.json"))).toBe(true);expect(existsSync(join(nested,".cursor"))).toBe(false);
 expect(JSON.parse(run.stdout).doctor.checks).toContainEqual(expect.objectContaining({name:"agent-config",status:"pass"}));
});
test("thrown command error is redacted",async()=> {
 vi.mocked(ctx.exec).mockRejectedValue(new Error("SECRET"));const result=await initAgent(ctx,"pi",{interactive:false,consent:true});expect(result.status).toBe("error");expect(JSON.stringify(result)).not.toContain("SECRET");
});
