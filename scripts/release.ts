// Publish every package at the repo tag v<version> on HEAD, skipping registry versions already live.
// Stable versions go to npm "latest" from main; X.Y.Z-dev.N versions go to npm "dev" from any branch.
import $ from "dax";
import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

const dirs = ["packages/dibs", "plugins/pi", "plugins/opencode"];
if ((await $`git status --porcelain`.text()).trim()) throw new Error("commit or stash your changes first");
const { version } = JSON.parse(await readFile("packages/dibs/package.json", "utf8"));
for (const f of [...dirs.slice(1).map((d) => `${d}/package.json`), "packages/dibs/jsr.json"]) {
	const v = JSON.parse(await readFile(f, "utf8")).version;
	if (v !== version) throw new Error(`${f} version ${v} does not match ${version}`);
}
const tag = `v${version}`;
const head = (await $`git rev-parse HEAD`.text()).trim();
const tagCommit = (await $`git rev-list -n 1 ${tag}`.noThrow().text()).trim();
if (tagCommit !== head) throw new Error(`${tag} does not point to HEAD`);
const localTag = (await $`git rev-parse ${`refs/tags/${tag}`}`.text()).trim();
const remoteTag = (await $`git ls-remote --tags origin ${`refs/tags/${tag}`}`.text()).trim().split(/\s+/)[0];
if (localTag !== remoteTag) throw new Error(`${tag} is not pushed to origin or differs from the remote tag`);
const stable = !version.includes("-");
if (stable && head !== (await $`git ls-remote origin refs/heads/main`.text()).trim().split(/\s+/)[0]) throw new Error(`stable ${tag} must be the tip of origin/main`);
const distTag = stable ? "latest" : "dev";

// An expired npm token makes publish fail with a misleading 404, so check the login first.
if ((await $`nub whoami`.quiet().noThrow()).code) throw new Error("not logged in to npm: run `nub login`");
// A package that requires 2FA may stage a token-only publish; pass NPM_OTP to release it.
const otp = process.env.NPM_OTP ? ["--otp", process.env.NPM_OTP] : [];
// JSR has no stored login: pass JSR_TOKEN, or --jsr to read it from the macOS Keychain (security add-generic-password -U -a "$USER" -s jsr-token -w)
const jsrToken = process.env.JSR_TOKEN ?? (process.argv.includes("--jsr") ? (await $`security find-generic-password -s jsr-token -w`.text()).trim() : "");
const npmLive = async (name: string, version: string, tries = 1) => {
	for (let i = 0; i < tries; i++) {
		if (i) await sleep(3000); // a token publish is staged and goes live after about two minutes
		// ask the registry directly: nub view serves cached metadata and misses a fresh publish for minutes
		const meta = await fetch(`https://registry.npmjs.org/${name.replace("/", "%2F")}`, { headers: { "cache-control": "no-cache" } });
		if (!meta.ok && meta.status !== 404) throw new Error(`npm registry returned ${meta.status} for ${name}`);
		if (meta.ok && version in ((await meta.json()).versions ?? {})) return true;
	}
	return false;
};
const jsrLive = async (name: string, version: string) => {
	const meta = await fetch(`https://jsr.io/${name}/meta.json`, { headers: { "cache-control": "no-cache" } });
	if (!meta.ok && meta.status !== 404) throw new Error(`JSR returned ${meta.status} for ${name}`);
	return version in (meta.ok ? (await meta.json()).versions ?? {} : {});
};


// core first: the agent packages depend on it
for (const dir of dirs) {
	const { name } = JSON.parse(await readFile(`${dir}/package.json`, "utf8"));
	if (await npmLive(name, version)) { console.log(`npm ${name}@${version}: already published, skipping`); continue; }
	await $`nub publish --access public --tag ${distTag} ${otp} ${stable ? [] : ["--no-git-checks"]}`.cwd(dir).noThrow(); // trust the registry, not the exit code
	console.log(`waiting for npm to release ${name}@${version}…`);
	if (!(await npmLive(name, version, 60))) throw new Error(`npm ${name}@${version} did not publish; if 2FA is required, rerun with NPM_OTP=<code> nub run release`);
}

// Only core goes to JSR: Pi and opencode install plugins from npm, and JSR can't resolve their host-provided imports.
// JSR has no dist-tags, but it never resolves a bare import to a prerelease, so dev versions are safe there.
const jsr = JSON.parse(await readFile("packages/dibs/jsr.json", "utf8"));
if (await jsrLive(jsr.name, version)) console.log(`jsr ${jsr.name}@${version}: already published, skipping`);
else {
	await $`cp README.md CHANGELOG.md LICENSE packages/dibs/`; // JSR does not run prepack
	await $`nub dlx jsr publish ${jsrToken ? ["--token", jsrToken] : []}`.cwd("packages/dibs");
}
