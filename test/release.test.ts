import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, test } from "vitest";

const script = resolve("scripts/release.ts");
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function fixture() {
	const dir = mkdtempSync(join(tmpdir(), "dibs-release-"));
	dirs.push(dir);
	const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
	git("init", "-q");
	git("config", "user.email", "test@example.com");
	git("config", "user.name", "Test");
	for (const d of [".", "agents/pi", "agents/opencode"]) { mkdirSync(join(dir, d), { recursive: true }); writeFileSync(join(dir, d, "package.json"), JSON.stringify({ name: `test-${d}`, version: "1.0.0" })); }
	writeFileSync(join(dir, "jsr.json"), JSON.stringify({ name: "@test/package", version: "1.0.0" }));
	git("add", ".");
	git("commit", "-qm", "test");
	return { dir, git, run: (...args: string[]) => spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: "utf8" }) };
}

test("release rejects packages out of lockstep", () => {
	const { dir, git, run } = fixture();
	writeFileSync(join(dir, "agents/pi/package.json"), JSON.stringify({ name: "pi", version: "0.9.0" }));
	git("commit", "-qam", "drift");
	expect(run().stderr).toContain("does not match 1.0.0");
});

test("release rejects a dirty tree before publishing", () => {
	const { dir, run } = fixture();
	writeFileSync(join(dir, "extra"), "uncommitted");
	expect(run().stderr).toContain("commit or stash your changes first");
});

test("release rejects a tag that points to another commit", () => {
	const { git, run } = fixture();
	git("tag", "v1.0.0");
	git("commit", "--allow-empty", "-qm", "new commit");
	expect(run().stderr).toContain("does not point to HEAD");
});

test("release rejects a tag not pushed to origin", () => {
	const { git, run } = fixture();
	const remote = mkdtempSync(join(tmpdir(), "dibs-remote-"));
	dirs.push(remote);
	execFileSync("git", ["init", "--bare", "-q", remote]);
	git("remote", "add", "origin", remote);
	git("tag", "v1.0.0");
	expect(run().stderr).toContain("is not pushed to origin");
});
