// Bump all packages in lockstep, tag the repo vX.Y.Z, push, and publish. "dev" cuts a prerelease for testing.
import $ from "dax";
import { readFile, writeFile } from "node:fs/promises";

const files = ["packages/dibs/package.json", "plugins/pi/package.json", "plugins/opencode/package.json", "packages/dibs/jsr.json"];
const [inc] = process.argv.slice(2);
if (!inc) throw new Error("usage: nub run bump <patch|minor|major|dev|x.y.z>");
if ((await $`git status --porcelain`.text()).trim()) throw new Error("commit or stash your changes first");

function next(current: string, inc: string) {
	const [, maj, min, pat, dev] = current.match(/^(\d+)\.(\d+)\.(\d+)(?:-dev\.(\d+))?$/)!.map(Number);
	if (inc === "dev") return dev >= 0 ? `${maj}.${min}.${pat}-dev.${dev + 1}` : `${maj}.${min}.${pat + 1}-dev.0`;
	if (inc === "patch") return dev >= 0 ? `${maj}.${min}.${pat}` : `${maj}.${min}.${pat + 1}`;
	if (inc === "minor") return `${maj}.${min + 1}.0`;
	if (inc === "major") return `${maj + 1}.0.0`;
	if (/^\d+\.\d+\.\d+(-dev\.\d+)?$/.test(inc)) return inc;
	throw new Error(`bad increment ${inc}`);
}

const { version: current } = JSON.parse(await readFile(files[0], "utf8"));
const version = next(current, inc);
const stable = !version.includes("-");
const branch = (await $`git branch --show-current`.text()).trim();
if (stable && branch !== "main") throw new Error("stable releases come from main; use `nub run bump dev` to test from a branch");
await $`git fetch origin`;
if (stable && (await $`git rev-parse HEAD`.text()) !== (await $`git rev-parse origin/main`.text())) throw new Error("main is not in sync with origin/main");

await $`nub run check`;
await $`nub run build`;
for (const f of files) {
	const json = JSON.parse(await readFile(f, "utf8"));
	json.version = version;
	await writeFile(f, `${JSON.stringify(json, null, 2)}\n`);
}
await $`git add ${files}`;
await $`git commit -m ${`Release v${version}`} -- ${files}`;
await $`git tag -a v${version} -m v${version}`;
await $`git push --atomic origin HEAD ${`refs/tags/v${version}`}`;
// --jsr reads the JSR token from the Keychain when JSR_TOKEN is unset
await $`nub scripts/release.ts --jsr`;
