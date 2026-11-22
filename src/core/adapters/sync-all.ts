import type { Ctx } from "../ctx.ts";
import type { Settings } from "../store.ts";
import { dexAdapter } from "./dex/index.ts";
import { ghUser } from "../identity.ts";
import { type Adapter, sync } from "./sync.ts";
import { thingsAdapter } from "./things/index.ts";

// Syncs every adapter with `sync` on, in order. A failing adapter doesn't stop the rest; its error is returned.
export async function syncAll(ctx: Ctx, s: Settings, file: string, make: Record<string, () => Adapter> = { dex: () => dexAdapter(ctx), things: () => thingsAdapter(ctx, s.name) }): Promise<{ name: string; error?: unknown; skipped?: boolean }[]> {
	const out: { name: string; error?: unknown; skipped?: boolean }[] = [];
	for (const name of Object.keys(s.adapters).filter((n) => s.adapters[n].sync)) {
		try { const h = s.adapters[name].human, r = await sync(file, s.base, make[name](), h === "me" ? (await ghUser(ctx) ?? (() => { throw new Error('human "me" could not be resolved: set DIBS_USER or git config github.user'); })()) : h); out.push(r === "skipped" ? { name, skipped: true } : { name }); } catch (error) { out.push({ name, error }); }
	}
	return out;
}
