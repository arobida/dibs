import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Ctx } from "./ctx.ts";
import { dibsHome } from "./store.ts";

export const agentName = () => process.env.DIBS_AGENT || "cli";

// GitHub username of the person at the keyboard: DIBS_USER, else git config, else gh; cached in <dibsHome>/user so the lookup runs at most once. Never throws.
export async function ghUser(ctx: Ctx): Promise<string | undefined> {
	if (process.env.DIBS_USER) return process.env.DIBS_USER;
	const cache = join(dibsHome(), "user");
	try { const cached = readFileSync(cache, "utf8").trim(); if (cached) return cached; } catch {}
	for (const [cmd, args] of [["git", ["config", "github.user"]], ["gh", ["api", "user", "--jq", ".login"]]] as const) {
		try {
			const r = await ctx.exec(cmd, [...args]), user = r.stdout.trim();
			if (r.code === 0 && user) { try { mkdirSync(dibsHome(), { recursive: true }); writeFileSync(cache, user + "\n"); } catch {} return user; }
		} catch {}
	}
}
