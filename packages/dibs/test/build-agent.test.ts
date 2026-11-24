import { expect, test } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../../../scripts/build-agent.ts";

test("plugin files override shared skills; unknown plugin throws", () => {
	const r = mkdtempSync(join(tmpdir(), "ba-"));
	mkdirSync(join(r, "packages/dibs/skills"), { recursive: true });
	mkdirSync(join(r, "plugins/x/skills"), { recursive: true });
	writeFileSync(join(r, "packages/dibs/skills/a.md"), "sa");
	writeFileSync(join(r, "packages/dibs/skills/b.md"), "sb");
	writeFileSync(join(r, "plugins/x/skills/b.md"), "xb");
	build("x", r);
	expect(readFileSync(join(r, "dist/x/skills/a.md"), "utf8")).toBe("sa");
	expect(readFileSync(join(r, "dist/x/skills/b.md"), "utf8")).toBe("xb");
	expect(() => build("nope", r)).toThrow();
});
