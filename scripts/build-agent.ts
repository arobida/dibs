import { cpSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

export function build(name: string, root = resolve(import.meta.dirname, "..")) {
	if (!existsSync(join(root, "plugins", name))) throw new Error(`unknown agent: ${name}`);
	const out = join(root, "dist", name);
	rmSync(out, { recursive: true, force: true });
	cpSync(join(root, "packages/dibs/skills"), join(out, "skills"), { recursive: true });
	cpSync(join(root, "plugins", name), out, { recursive: true }); // plugin wins on same path
}

if (import.meta.main) try { build(process.argv[2] ?? ""); } catch (e) { console.error((e as Error).message); process.exit(1); }
