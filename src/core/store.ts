import type { Ctx } from "./ctx.ts";
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { home, readJsonl, withLock } from "./util.ts";
import { findId, runFile } from "./tasks.ts";

const { name, version } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
// Pinned to this install's version so editors validate against the options it supports. scripts/bump.ts tags releases <name>@<version>.
export { version };
export const schemaUrl = `https://raw.githubusercontent.com/arobida/dibs/v${version}/schema.json`;

// JSONC: drops comments, then trailing commas (second pass catches a comma that sat before a comment); strings are kept as-is.
const stripJsonc = (t: string) => t.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\/|,(\s*[}\]])/g, (_m, str, close) => str ?? close ?? "");
export function parseJsonc(text: string, path: string): any {
	if (!text.trim()) return {};
	let config: any;
	try { config = JSON.parse(stripJsonc(stripJsonc(text))); } catch (error: any) { throw new Error(`Invalid JSON in ${path}: ${error.message}`); }
	if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error(`${path} must hold a JSON object`);
	return config;
}

export const writeConfig = (dir: string, config: object) => writeFileSync(join(dir, "config.json"), JSON.stringify({ $schema: schemaUrl, ...config }, null, 2) + "\n");
const ensureConfig = (dir: string) => { readConfig(dir); if (!existsSync(join(dir, "config.json"))) writeConfig(dir, {}); };

// <dir>/config.json (JSONC). Keeps "$schema" pointed at this version.
export function readConfig(dir: string): { adapters?: Record<string, { sync?: boolean; human?: string }>; file?: string; scope?: string; id?: string } {
	const path = join(dir, "config.json");
	let text: string;
	try { text = readFileSync(path, "utf8"); }
	catch (error: any) { if (error.code === "ENOENT") return {}; throw new Error(`Cannot read ${path}: ${error.message}`); }
	const config = parseJsonc(text, path);
	if (config.backend !== undefined) throw new Error(`"backend" was replaced by "adapters" in ${path}`);
	if (config.adapters !== undefined && (typeof config.adapters !== "object" || Array.isArray(config.adapters) || Object.entries(config.adapters).some(([k, v]: [string, any]) => !["dex", "things"].includes(k) || !v || typeof v !== "object" || (v.sync !== undefined && typeof v.sync !== "boolean") || (v.human !== undefined && (typeof v.human !== "string" || !v.human.trim()))))) throw new Error(`Invalid adapters in ${path}`);
	if (config.file !== undefined && (typeof config.file !== "string" || !config.file.trim())) throw new Error(`Invalid file in ${path}`);
	if (config.scope !== undefined && !["project", "global", "temp"].includes(config.scope)) throw new Error(`Invalid scope in ${path}`);
	if (config.id !== undefined && (typeof config.id !== "string" || !/^[\w-]+$/.test(config.id))) throw new Error(`Invalid id in ${path}`);
	return config;
}

// Adds the project id to an existing config by text insert after the opening brace, keeping comments.
function addId(dir: string, id: string) {
	const path = join(dir, "config.json"), config = readConfig(dir);
	if (!existsSync(path)) return writeConfig(dir, { id });
	const text = readFileSync(path, "utf8");
	if (!text.trim()) return writeConfig(dir, { id });
	const comma = Object.keys(config).length ? "," : "";
	writeFileSync(path, text.replace(/^(\s*(?:\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*)\{/, `$1{\n  "id": ${JSON.stringify(id)}${comma}`));
}

// One line of ~/.dibs/projects/projects.jsonl.
export interface Project { id: string; name: string; path: string; scope: string; created: string }
const toProject = (r: Record<string, unknown>): Project => {
	for (const k of ["id", "name", "path", "scope", "created"]) if (typeof r[k] !== "string") throw new Error(`bad ${k}`);
	return r as unknown as Project;
};

// Falls back to the old .pi-do folder when only that exists, so existing stores keep working.
const withLegacy = (dir: string) => existsSync(dir) || !existsSync(dir.replace(/\.dibs$/, ".pi-do")) ? dir : dir.replace(/\.dibs$/, ".pi-do");
export const dibsHome = () => process.env.DIBS_HOME || withLegacy(join(homedir(), ".dibs"));

const registryFile = () => join(dibsHome(), "projects", "projects.jsonl");
function saveRegistry(projects: Project[]) {
	const temp = `${registryFile()}.${randomUUID()}.tmp`;
	writeFileSync(temp, projects.map((p) => JSON.stringify(p) + "\n").join("")); renameSync(temp, registryFile());
}

// Nearest ancestor with a dibs folder; the home dir and the global dibs home are never projects.
export function findRoot(cwd: string): string | undefined {
	const real = (p: string) => { try { return realpathSync(p); } catch { return resolve(p); } }, skip = real(dibsHome()); // real: cwd is symlink-resolved, DIBS_HOME may not be
	for (let dir = resolve(cwd); ; dir = dirname(dir)) {
		const marked = [".agents/dibs", ".dibs", ".pi-do"].some((m) => existsSync(join(dir, m)));
		if (marked && dir !== homedir() && real(join(dir, ".dibs")) !== skip && real(join(dir, ".pi-do")) !== skip) return dir;
		if (dirname(dir) === dir) return undefined;
	}
}
export const projectRoot = (cwd: string) => findRoot(cwd) ?? resolve(cwd);

export interface Settings { root: string; adapters: Record<string, { sync?: boolean; human?: string }>; file?: string; scope: string; base: string; local: string; name: string; id: string; registered: boolean }

export const localDir = (cwd: string) => existsSync(join(cwd, ".agents", "dibs")) ? join(cwd, ".agents/dibs") : withLegacy(join(cwd, ".dibs"));
export const globalDir = (s: { name: string; id: string }) => join(dibsHome(), "projects", `${s.name}.${s.id}`);

// The project's id lives in its local config.json (kept in place across scopes) and keys its projects.jsonl record.
// Scope: forceGlobal > env DIBS_SCOPE > the project's record scope > global config.json > "project".
export function settings(ctx: Ctx, forceGlobal = false): Settings {
	const root = dibsHome(), cwd = projectRoot(ctx.cwd), trusted = ctx.trusted();
	if (forceGlobal && !trusted) throw new Error("--global requires a trusted project");
	const local = localDir(cwd);
	const id: string = (trusted ? readConfig(local).id : undefined) ?? randomUUID();
	const record = readJsonl(join(root, "projects", "projects.jsonl"), toProject).find((p) => p.id === id);
	const globalConfig = readConfig(root);
	const scope = forceGlobal ? "global" : process.env.DIBS_SCOPE || record?.scope || globalConfig.scope || "project";
	if (!["project", "global", "temp"].includes(scope)) throw new Error(`Invalid dibs scope: ${scope}`);
	const name = record?.name ?? basename(cwd);
	// Untrusted projects use a temp store so dibs never writes into them.
	const temp = !trusted && !forceGlobal || scope === "temp";
	// Temp stores use the same layout as project stores, in a per-session folder.
	const base = temp ? join(tmpdir(), "dibs", createHash("sha256").update(ctx.sessionId()).digest("hex"), ".dibs") : scope === "global" ? globalDir({ name, id }) : local;
	const config = { ...globalConfig, ...(base !== local ? readConfig(base) : {}), ...(trusted ? readConfig(local) : {}) };
	return { adapters: config.adapters ?? {}, file: process.env.DIBS_FILE || config.file, scope: temp ? "temp" : scope, root: cwd, base, local, name, id, registered: !!record };
}

export const helloWorld = () => JSON.stringify({ id: randomUUID(), name: "Hello World", completed: false, created: new Date().toISOString().slice(0, 10), started_at: null }) + "\n";

// Explicit initialization creates an empty durable store, never the onboarding task.
export function initStore(ctx: Ctx, global = false): string {
	const trusted = { ...ctx, trusted: () => true };
	const s = settings(trusted, global);
	if (s.scope === "temp") throw new Error("init requires durable storage; unset DIBS_SCOPE=temp");
	const file = storeFile(trusted, s, "");
	mkdirSync(dirname(file), { recursive: true });
	if (!existsSync(file)) writeFileSync(file, "", { flag: "wx", mode: 0o600 });
	return file;
}

// Resolves the todos file, creating the dibs folder, config, list index, project registration and Hello World todo on first use.
export function storeFile(ctx: Ctx, s: Settings, seed?: string): string {
	// ~/.dibs always exists: global config plus the projects registry. Its absence means this run is the installation.
	const installing = !existsSync(join(dibsHome(), "config.json"));
	mkdirSync(join(dibsHome(), "projects"), { recursive: true });
	ensureConfig(dibsHome());
	if (!existsSync(join(dibsHome(), "projects", "projects.jsonl"))) writeFileSync(join(dibsHome(), "projects", "projects.jsonl"), "");
	if (s.file) return resolve(ctx.cwd, home(s.file));
	const todos = join(s.base, "todos"), file = join(todos, `${s.name}.todos.jsonl`);
	// Temp stores never write into the project or the registry.
	if (s.scope !== "temp" && !readConfig(s.local).id) { mkdirSync(s.local, { recursive: true }); addId(s.local, s.id); }
	if (!s.registered && s.scope !== "temp") {
		appendFileSync(join(dibsHome(), "projects", "projects.jsonl"), JSON.stringify({ id: s.id, name: s.name, path: s.root, scope: s.scope, created: new Date().toISOString() }) + "\n");
		s.registered = true;
	} else if (s.scope !== "temp") {
		// Last opened wins: a moved project re-registers its new path.
		const projects = readJsonl(registryFile(), toProject), record = projects.find((p) => p.id === s.id);
		if (record && record.path !== s.root) { record.path = s.root; saveRegistry(projects); }
	}
	if (existsSync(file)) return file;
	mkdirSync(todos, { recursive: true });
	ensureConfig(s.base);
	// Hello World onboards installation and new permanent stores; other temp stores start empty.
	try { writeFileSync(file, seed ?? (s.scope === "temp" && !installing ? "" : helloWorld()), { flag: "wx", mode: 0o600 }); }
	catch (error: any) { if (error.code === "EEXIST") return file; throw error; }
	return file;
}

// Moves the project store between .dibs and .agents/dibs (todos, config, list index); never overwrites.
export function migrate(ctx: Ctx, target: string): string {
	if (!ctx.trusted()) throw new Error("migrate requires a trusted project");
	const s = settings(ctx);
	if (s.scope !== "project" || s.file) throw new Error("migrate only moves a project-scope dibs folder; use /todos scope to change scope");
	const to = join(projectRoot(ctx.cwd), target);
	if (to === s.base) throw new Error(`Already stored in ${to}`);
	if (existsSync(to)) throw new Error(`${to} already exists`);
	mkdirSync(dirname(to), { recursive: true });
	renameSync(s.base, to);
	return `Moved ${s.base} to ${to}`;
}

// Switches scope and moves the todos folder with it; the local config.json (holding the project id) stays put.
export async function setScope(ctx: Ctx, scope: string): Promise<string> {
	if (!ctx.trusted()) throw new Error("scope requires a trusted project");
	if (scope !== "project" && scope !== "global") throw new Error(`Invalid scope: ${scope} (use project or global)`);
	const s = settings(ctx), registry = join(dibsHome(), "projects", "projects.jsonl");
	if (s.file) throw new Error("scope does not apply to an explicit file");
	storeFile(ctx, s); // registers the project and writes its id if needed
	const projects = readJsonl(registry, toProject);
	const record = projects.find((p) => p.id === s.id)!;
	if (record.scope === scope) return `Already ${scope} scope`;
	const [from, to] = scope === "global" ? [s.local, globalDir(s)] : [globalDir(s), s.local];
	const dirs = ["todos", "sync"].filter((d) => existsSync(join(from, d)));
	for (const d of dirs) if (existsSync(join(to, d))) throw new Error(`${join(to, d)} already exists`);
	mkdirSync(to, { recursive: true });
	ensureConfig(to);
	mkdirSync(join(from, "todos"), { recursive: true });
	// The lock stops writers between copy and delete; copy then delete because project and home may be on different disks.
	await withLock(join(from, "todos", `${s.name}.todos.jsonl`), () => {
		for (const d of dirs) cpSync(join(from, d), join(to, d), { recursive: true, errorOnExist: true, force: false, filter: (src) => !src.endsWith(".lock") });
		const fresh = readJsonl(registry, toProject); // re-read: the snapshot above predates the copy
		fresh.find((p) => p.id === s.id)!.scope = scope;
		saveRegistry(fresh);
		for (const d of dirs) rmSync(join(from, d), { recursive: true, force: true });
		if (scope === "project") rmSync(from, { recursive: true, force: true });
	});
	return `Scope set to ${scope}: ${storeFile(ctx, settings(ctx))}`;
}

const findTask = (file: string, id: string): any => {
	const items = JSON.parse(runFile(file, ["list"]) as string);
	return items.find((t: any) => t.id === findId(items, id, file));
};

// `[name](dibs://<project-id>/<task-id>)`; only registered stores can be resolved later.
export function link(ctx: Ctx, id: string): string {
	const s = settings(ctx);
	if (s.scope === "temp" || s.file) throw new Error(`Cannot link: ${s.file ? "explicit-file" : "temp-scope"} stores are not registered, so the link could never be resolved`);
	const t = findTask(storeFile(ctx, s), id);
	return `[${t.name}](dibs://${s.id}/${t.id})`;
}

// Looks the project up in the registry and reads its store; never a stale copy at an old path.
export function resolveLink(url: string): string {
	const m = url.match(/^dibs:\/\/([\w-]+)\/([\w-]+)$/);
	if (!m) throw new Error(`Invalid dibs URL: ${url}`);
	const p = readJsonl(registryFile(), toProject).find((r) => r.id === m[1]);
	if (!p) throw new Error(`Unknown project: ${m[1]}`);
	const local = localDir(p.path);
	if (!existsSync(p.path) || readConfig(local).id !== p.id) throw new Error(`Project ${p.id} is no longer at ${p.path}; open pi in its new location to update the registry`);
	const t = findTask(join(p.scope === "global" ? globalDir(p) : local, "todos", `${p.name}.todos.jsonl`), m[2]);
	return `${t.name}\nState: ${t.completed ? "completed" : t.started_at ? "started" : "open"}\nResult: ${t.result ?? ""}`;
}
